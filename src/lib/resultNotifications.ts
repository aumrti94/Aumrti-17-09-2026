/**
 * "Your patient's report is ready" — addressed to the doctor who ordered it.
 *
 * clinical_alerts was hospital-wide: every alert went to everyone, and only critical values
 * fired at all. So a routine CRP or a normal chest X-ray came back to nobody, and the doctor
 * had to remember to go and look. These helpers raise ONE alert per released report,
 * addressed to lab_orders.ordered_by / radiology_orders.ordered_by, which the notification
 * bell and the doctor's Results Ready queue both read.
 *
 * Design constraints, from Dr. Ramesh's alert-fatigue rule:
 *   * one alert per ORDER, never per test — a 12-test profile is one notification;
 *   * de-duplicated against any still-unacknowledged alert for the same order, because the
 *     manual-validate, pathologist-validate and auto-verify paths all reach the same release
 *     funnel and would otherwise each raise one;
 *   * severity is 'medium' for an ordinary result — the pre-existing critical_lab_value /
 *     critical_radiology alerts still fire separately and hospital-wide for genuine
 *     emergencies, and this must not dilute them.
 *
 * Every function is fire-and-forget by contract: a notification failure must never roll back
 * or block a clinically completed release. Errors are logged without PHI.
 */

import { supabase } from "@/integrations/supabase/client";

type Severity = "low" | "medium" | "high" | "critical";

interface AlertRow {
  hospital_id: string;
  patient_id: string | null;
  alert_type: string;
  severity: Severity;
  alert_message: string;
  recipient_user_id: string | null;
  created_by?: string | null;
  lab_order_id?: string | null;
  radiology_order_id?: string | null;
  external_referral_id?: string | null;
}

/** Is there already an open alert for this order? Prevents duplicate release notifications. */
async function alreadyNotified(column: string, value: string): Promise<boolean> {
  const { data } = await (supabase as any)
    .from("clinical_alerts")
    .select("id")
    .eq(column, value)
    .eq("is_acknowledged", false)
    .limit(1);
  return !!(data && data.length > 0);
}

async function raise(row: AlertRow, dedupeColumn: string, dedupeValue: string): Promise<void> {
  try {
    if (!row.recipient_user_id) return; // nobody to tell — a desk order with no doctor on it
    if (await alreadyNotified(dedupeColumn, dedupeValue)) return;
    const { error } = await (supabase as any).from("clinical_alerts").insert(row);
    if (error) console.error("Result-ready alert insert failed:", error.message);
  } catch (e: any) {
    console.error("Result-ready alert error:", e?.message);
  }
}

/** Patient descriptor for the alert text — matches the existing critical-alert convention. */
async function patientLabel(patientId: string | null): Promise<string> {
  if (!patientId) return "patient";
  const { data } = await supabase
    .from("patients")
    .select("full_name, uhid")
    .eq("id", patientId)
    .maybeSingle();
  return data ? `${data.full_name} (${data.uhid})` : "patient";
}

/* ─────────────────────────── Laboratory ─────────────────────────── */

/**
 * Who should be told the result landed.
 *
 * `ordered_by` is whoever keyed the order in — at the lab bench or the radiology desk that is
 * a receptionist, not a clinician, and RLS forces it to stay that way (the insert policies
 * assert ordered_by = the calling user). `referring_doctor_id` carries the clinician who
 * actually asked for the investigation, and is null when the two are the same person.
 */
export const resultRecipient = (order: { referring_doctor_id?: string | null; ordered_by?: string | null }) =>
  order.referring_doctor_id ?? order.ordered_by ?? null;

/**
 * Called from LabResultWorkspace's release funnel (finalizeReleasedOrder), which every lab
 * release path passes through — manual validate-all, pathologist validation, and
 * auto-verification.
 */
export async function notifyOrderingDoctorLabResult(
  orderId: string,
  releasedBy?: string | null,
): Promise<void> {
  const { data: order } = await (supabase as any)
    .from("lab_orders")
    .select(`
      id, hospital_id, patient_id, ordered_by, referring_doctor_id,
      lab_order_items(result_flag, lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name))
    `)
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;

  const items: any[] = order.lab_order_items || [];
  const names = items.map((i) => i.lab_test_master?.test_name).filter(Boolean);
  const abnormal = items.filter((i) => i.result_flag && i.result_flag !== "N").length;
  const hasCritical = items.some((i) => i.result_flag === "CH" || i.result_flag === "CL");
  const who = await patientLabel(order.patient_id);

  const summary = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3} more` : names.join(", ");

  await raise(
    {
      hospital_id: order.hospital_id,
      patient_id: order.patient_id,
      alert_type: "lab_result_ready",
      severity: hasCritical ? "critical" : "medium",
      alert_message:
        `Lab report ready for ${who}: ${summary || "investigation"}` +
        (abnormal > 0 ? ` — ${abnormal} abnormal result${abnormal !== 1 ? "s" : ""}` : ""),
      recipient_user_id: resultRecipient(order),
      created_by: releasedBy || null,
      lab_order_id: order.id,
    },
    "lab_order_id",
    order.id,
  );
}

/* ────────────────────── Microbiology / culture ────────────────────── */

/**
 * A culture finalises days after the rest of its order was released, so it needs its own
 * notification — and the parent order's review stamp is cleared, otherwise a doctor who
 * already acknowledged the scalar results would never be shown the organism.
 */
export async function notifyOrderingDoctorMicrobiology(
  labResultId: string,
  releasedBy?: string | null,
): Promise<void> {
  const { data: res } = await (supabase as any)
    .from("lab_results")
    .select("id, hospital_id, patient_id, order_id, organism_identified, specimen_type, report_status")
    .eq("id", labResultId)
    .maybeSingle();
  if (!res || res.report_status !== "final") return;

  const { data: order } = await (supabase as any)
    .from("lab_orders")
    .select("id, hospital_id, patient_id, ordered_by, referring_doctor_id")
    .eq("id", res.order_id)
    .maybeSingle();
  if (!order) return;

  // Re-open the parent order for review — see the doc comment above.
  await (supabase as any)
    .from("lab_orders")
    .update({ results_reviewed_at: null, results_reviewed_by: null })
    .eq("id", order.id);

  const who = await patientLabel(order.patient_id);
  await raise(
    {
      hospital_id: order.hospital_id,
      patient_id: order.patient_id,
      alert_type: "lab_result_ready",
      severity: "medium",
      alert_message:
        `Culture report final for ${who}${res.specimen_type ? ` (${res.specimen_type})` : ""}: ` +
        `${res.organism_identified || "no growth"}`,
      recipient_user_id: resultRecipient(order),
      created_by: releasedBy || null,
      lab_order_id: order.id,
    },
    "lab_order_id",
    order.id,
  );
}

/* ────────────────────── Histopathology / cytology ────────────────────── */

/**
 * Fired on sign-out and again on amendment. An amended case clears its own review stamp so
 * it returns to the doctor's queue — a corrected diagnosis the ordering clinician never sees
 * is the worst failure mode this feature has.
 */
export async function notifyOrderingDoctorPathology(
  caseId: string,
  releasedBy?: string | null,
): Promise<void> {
  const { data: kase } = await (supabase as any)
    .from("pathology_cases")
    .select("id, hospital_id, patient_id, lab_order_id, case_number, case_type, status, impression")
    .eq("id", caseId)
    .maybeSingle();
  if (!kase) return;

  const amended = kase.status === "amended";
  if (amended) {
    await (supabase as any)
      .from("pathology_cases")
      .update({ results_reviewed_at: null, results_reviewed_by: null })
      .eq("id", kase.id);
  }

  // The requesting clinician is recorded on the parent lab order, not on the case.
  let orderedBy: string | null = null;
  if (kase.lab_order_id) {
    const { data: order } = await (supabase as any)
      .from("lab_orders").select("ordered_by, referring_doctor_id").eq("id", kase.lab_order_id).maybeSingle();
    orderedBy = order ? resultRecipient(order) : null;
  }

  const who = await patientLabel(kase.patient_id);
  await raise(
    {
      hospital_id: kase.hospital_id,
      patient_id: kase.patient_id,
      alert_type: "pathology_report_ready",
      severity: amended ? "high" : "medium",
      alert_message:
        `${amended ? "AMENDED " : ""}${kase.case_type === "cytology" ? "Cytology" : "Histopathology"} ` +
        `report ${amended ? "re-issued" : "signed out"} for ${who} — ${kase.case_number}`,
      recipient_user_id: orderedBy,
      created_by: releasedBy || null,
      lab_order_id: kase.lab_order_id,
    },
    "lab_order_id",
    kase.lab_order_id,
  );
}

/* ────────────────────── Referred-out tests ────────────────────── */

export async function notifyOrderingDoctorExternalLab(
  referralId: string,
  releasedBy?: string | null,
): Promise<void> {
  const { data: ref } = await (supabase as any)
    .from("external_lab_referrals")
    .select("id, hospital_id, patient_id, referred_by, lab_name, tests_ordered, report_received_at")
    .eq("id", referralId)
    .maybeSingle();
  if (!ref || !ref.report_received_at) return;

  const who = await patientLabel(ref.patient_id);
  const tests = (ref.tests_ordered || []).join(", ");
  await raise(
    {
      hospital_id: ref.hospital_id,
      patient_id: ref.patient_id,
      alert_type: "external_lab_report_ready",
      severity: "medium",
      alert_message: `External lab report received for ${who}${tests ? `: ${tests}` : ""}${ref.lab_name ? ` — ${ref.lab_name}` : ""}`,
      recipient_user_id: ref.referred_by,
      created_by: releasedBy || null,
      external_referral_id: ref.id,
    },
    "external_referral_id",
    ref.id,
  );
}

/* ─────────────────────────── Radiology ─────────────────────────── */

export async function notifyOrderingDoctorRadiologyReport(
  orderId: string,
  releasedBy?: string | null,
): Promise<void> {
  const { data: order } = await (supabase as any)
    .from("radiology_orders")
    .select(`
      id, hospital_id, patient_id, ordered_by, referring_doctor_id, study_name, modality_type,
      radiology_reports(impression, is_critical, critical_finding)
    `)
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;

  const report = Array.isArray(order.radiology_reports)
    ? order.radiology_reports[0] || null
    : order.radiology_reports || null;
  const who = await patientLabel(order.patient_id);

  await raise(
    {
      hospital_id: order.hospital_id,
      patient_id: order.patient_id,
      alert_type: "radiology_report_ready",
      severity: report?.is_critical ? "critical" : "medium",
      alert_message:
        `Imaging report ready for ${who}: ${order.study_name || order.modality_type || "study"}` +
        (report?.is_critical ? " — CRITICAL FINDING" : ""),
      recipient_user_id: resultRecipient(order),
      created_by: releasedBy || null,
      radiology_order_id: order.id,
    },
    "radiology_order_id",
    order.id,
  );
}
