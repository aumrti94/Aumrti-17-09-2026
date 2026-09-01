/**
 * Which episode of care does a lab/radiology order belong to?
 *
 * Orders raised from the Lab or Radiology worklist used to be saved with encounter_id AND
 * admission_id NULL — the modals only ever received a link when they were opened from the
 * "Pending from OPD" tab. An order with no episode on it can never appear in the doctor's
 * Reports tab, and since `ordered_by` was also set to the logged-in lab technician rather
 * than the treating doctor, there was nobody to notify when the result came back either.
 *
 * This resolves both from the patient: the episode that was open when the order was raised,
 * and the doctor responsible for it. Callers show the answer as an editable chip rather than
 * applying it silently — a genuine walk-in with no episode is a legitimate case, and staff
 * must be able to see and clear a wrong guess.
 */

import { supabase } from "@/integrations/supabase/client";

export type EncounterLinkKind = "admission" | "encounter" | "none";

export interface EncounterLink {
  kind: EncounterLinkKind;
  admissionId: string | null;
  encounterId: string | null;
  /** The treating doctor — consultant for an admission, the consulting doctor for OPD. */
  doctorId: string | null;
  doctorName: string | null;
  /** Human-readable chip text, e.g. "IPD · ADM-2026-0142 · Dr Rao". */
  label: string;
}

const NONE: EncounterLink = {
  kind: "none",
  admissionId: null,
  encounterId: null,
  doctorId: null,
  doctorName: null,
  label: "Not linked to a visit",
};

function fmt(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/**
 * Resolve the episode of care to attach an order to.
 *
 * Inpatient wins over outpatient: if the patient is admitted, an investigation raised today
 * belongs to that admission even if they also had an OPD encounter earlier the same day —
 * the admission is the active episode and the ward doctor is the one waiting on the result.
 *
 * @param onDate  YYYY-MM-DD the order is being raised for. Defaults to today.
 */
export async function resolveActiveEncounterLink(
  hospitalId: string,
  patientId: string,
  onDate?: string,
): Promise<EncounterLink> {
  if (!hospitalId || !patientId) return NONE;
  const date = onDate || new Date().toISOString().slice(0, 10);

  // ── Open admission covering the date ──
  const { data: admissions } = await (supabase as any)
    .from("admissions")
    .select(`
      id, admission_number, admitted_at, discharged_at, status,
      consultant_doctor_id, admitting_doctor_id,
      consultant:users!admissions_consultant_doctor_id_fkey(full_name),
      admitter:users!admissions_admitting_doctor_id_fkey(full_name)
    `)
    .eq("hospital_id", hospitalId)
    .eq("patient_id", patientId)
    .is("discharged_at", null)
    .neq("status", "discharged")
    .neq("status", "cancelled")
    .order("admitted_at", { ascending: false })
    .limit(1);

  const adm = admissions?.[0];
  if (adm && (!adm.admitted_at || adm.admitted_at.slice(0, 10) <= date)) {
    const doctorId = adm.consultant_doctor_id || adm.admitting_doctor_id || null;
    const doctorName = adm.consultant?.full_name || adm.admitter?.full_name || null;
    return {
      kind: "admission",
      admissionId: adm.id,
      encounterId: null,
      doctorId,
      doctorName,
      label: `IPD · ${adm.admission_number || "admission"}${doctorName ? ` · Dr ${doctorName}` : ""}`,
    };
  }

  // ── OPD encounter on the date ──
  const { data: encounters } = await (supabase as any)
    .from("opd_encounters")
    .select(`
      id, visit_date, doctor_id, created_at,
      doctor:users!opd_encounters_doctor_id_fkey(full_name)
    `)
    .eq("hospital_id", hospitalId)
    .eq("patient_id", patientId)
    .eq("visit_date", date)
    .order("created_at", { ascending: false })
    .limit(1);

  const enc = encounters?.[0];
  if (enc) {
    const doctorName = enc.doctor?.full_name || null;
    return {
      kind: "encounter",
      admissionId: null,
      encounterId: enc.id,
      doctorId: enc.doctor_id || null,
      doctorName,
      label: `OPD · ${fmt(enc.visit_date)}${doctorName ? ` · Dr ${doctorName}` : ""}`,
    };
  }

  return NONE;
}

export const NO_ENCOUNTER_LINK = NONE;

/**
 * The treating doctor for a context that has ALREADY been resolved.
 *
 * The Lab and Radiology order modals resolve their own encounter/admission link via
 * getPrescribedPending, so they do not need resolveActiveEncounterLink — what they were
 * missing is the clinician. Both wrote `ordered_by` = the logged-in lab or radiology user,
 * which meant the result had no doctor to go back to and every "who ordered this?" question
 * answered "the lab technician". This closes that gap without duplicating the link lookup.
 *
 * Returns nulls rather than throwing: a missing doctor must not stop an order being raised.
 */
export async function resolveTreatingDoctor(
  ctx: { encounterId?: string | null; admissionId?: string | null },
): Promise<{ doctorId: string | null; doctorName: string | null }> {
  const empty = { doctorId: null, doctorName: null };
  try {
    if (ctx.admissionId) {
      const { data } = await (supabase as any)
        .from("admissions")
        .select(`
          consultant_doctor_id, admitting_doctor_id,
          consultant:users!admissions_consultant_doctor_id_fkey(full_name),
          admitter:users!admissions_admitting_doctor_id_fkey(full_name)
        `)
        .eq("id", ctx.admissionId)
        .maybeSingle();
      if (!data) return empty;
      return {
        doctorId: data.consultant_doctor_id || data.admitting_doctor_id || null,
        doctorName: data.consultant?.full_name || data.admitter?.full_name || null,
      };
    }
    if (ctx.encounterId) {
      const { data } = await (supabase as any)
        .from("opd_encounters")
        .select("doctor_id, doctor:users!opd_encounters_doctor_id_fkey(full_name)")
        .eq("id", ctx.encounterId)
        .maybeSingle();
      if (!data) return empty;
      return { doctorId: data.doctor_id || null, doctorName: data.doctor?.full_name || null };
    }
    return empty;
  } catch (err) {
    console.error("resolveTreatingDoctor failed:", err);
    return empty;
  }
}
