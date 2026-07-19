/**
 * ipdConsultationCharge — manually post a doctor's IPD consultation ("doctor round") charge.
 *
 * WHY THIS EXISTS. autoPullAdmissionCharges (lib/ipdBilling.ts) derives one chargeable
 * consultation per doctor per day SOLELY from ward_round_notes. A hospital that visits its
 * IPD patients but never records a SOAP round note therefore never gets a consultation line —
 * the doctor's fee silently vanishes from the bill. This lets a user add that charge by hand
 * from the Ledger & Advance tab.
 *
 * IT SHARES THE SWEEP'S DEDUPE CONTRACT. The line is written with source_module 'ipd_visit'
 * and dedupe key `ipd_visit:{doctorId}:{date}` — byte for byte what autoPullAdmissionCharges
 * writes. So the two can never double-charge the same doctor+day: if a ward round is later
 * saved for that doctor on that date, the sweep DELETEs this key and re-inserts its own line.
 * For the same reason this function is itself idempotent — it deletes any existing line under
 * the key before inserting, so re-adding a day's round just replaces it.
 */

import { supabase } from "@/integrations/supabase/client";
import { calcGST } from "@/lib/currency";
import { findOrCreateAdmissionBill } from "@/lib/admissionBill";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";

export interface AddConsultationOpts {
  hospitalId: string;
  patientId: string;
  admissionId: string;
  doctorId: string;
  doctorName: string;
  /** Service date in YYYY-MM-DD. The dedupe key is per doctor per date. */
  date: string;
  /** Number of visits/rounds on that date. */
  visits: number;
  /** Per-visit consultation fee (before GST). */
  fee: number;
  gstPercent?: number;
  hsnCode?: string;
  /** users.id of whoever recorded the charge. */
  orderedBy?: string | null;
}

export interface AddConsultationResult {
  ok: boolean;
  billId?: string;
  amount?: number;
  error?: string;
}

export async function addManualConsultationCharge(
  opts: AddConsultationOpts
): Promise<AddConsultationResult> {
  const {
    hospitalId, patientId, admissionId, doctorId, doctorName,
    date, visits, fee, gstPercent = 0, hsnCode = "999312", orderedBy,
  } = opts;

  if (!hospitalId || !patientId || !admissionId) {
    return { ok: false, error: "Hospital, patient, or admission missing" };
  }
  if (!doctorId) return { ok: false, error: "Select a doctor" };
  const qty = Math.max(1, Math.floor(visits) || 1);
  if (!(fee > 0)) return { ok: false, error: "Consultation fee must be greater than zero" };

  try {
    // Resolve the admission's own bill (ipd or daycare) — creating it if this is the first
    // charge, so a manual consultation works even before any bill exists (the estimate path).
    const { id: billId } = await findOrCreateAdmissionBill(hospitalId, patientId, admissionId);

    const dedupeKey = `ipd_visit:${doctorId}:${date}`;

    // Idempotent replace — mirrors autoPullAdmissionCharges so a re-add or a later ward-round
    // sweep never stacks a second line for the same doctor+day.
    await (supabase as any)
      .from("bill_line_items")
      .delete()
      .eq("bill_id", billId)
      .eq("source_dedupe_key", dedupeKey);

    const taxable = fee * qty;
    const gstAmount = calcGST(taxable, gstPercent);
    const total = taxable + gstAmount;

    const { error: lie } = await (supabase as any)
      .from("bill_line_items")
      .insert({
        hospital_id: hospitalId,
        bill_id: billId,
        item_type: "consultation",
        description: qty > 1
          ? `Consultation: Dr. ${doctorName} (${date}) — ${qty} visits`
          : `Consultation: Dr. ${doctorName} (${date})`,
        quantity: qty,
        unit_rate: fee,
        taxable_amount: taxable,
        gst_percent: gstPercent,
        gst_amount: gstAmount,
        total_amount: total,
        hsn_code: hsnCode,
        source_module: "ipd_visit",
        source_record_id: doctorId, // a real UUID, matching the sweep
        source_dedupe_key: dedupeKey,
        ordered_by: orderedBy || null,
        service_date: date,
      });

    if (lie) return { ok: false, error: lie.message };

    const recalc = await recalculateBillTotalsSafe(billId);
    if (!recalc.ok) return { ok: false, billId, error: recalc.error || "Bill recalculation failed" };

    return { ok: true, billId, amount: total };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Failed to post consultation charge" };
  }
}

export interface DoctorConsultOption {
  doctorId: string;
  doctorName: string;
  /** Best available per-visit fee: ipd_consultation_fee, else fee. May be 0. */
  fee: number;
  gstPercent: number;
  hsnCode: string;
}

/**
 * The doctors a manual consultation can be booked against, with their configured IPD fee.
 *
 * Sourced from service_master consultation rows (item_type LIKE 'consultation%') so each
 * doctor's fee/GST prefill matches exactly what the discharge sweep would have billed. The
 * admission's own attending doctor is folded in even without a configured service, so a round
 * can always be charged for the doctor actually on the case.
 */
export async function fetchConsultationDoctors(
  hospitalId: string,
  admissionId?: string
): Promise<DoctorConsultOption[]> {
  const byId = new Map<string, DoctorConsultOption>();

  const { data: svcs } = await (supabase as any)
    .from("service_master")
    .select("doctor_id, fee, ipd_consultation_fee, gst_percent, gst_applicable, hsn_code")
    .eq("hospital_id", hospitalId)
    .not("doctor_id", "is", null)
    .ilike("item_type", "consultation%");

  const doctorIds = new Set<string>();
  (svcs || []).forEach((s: any) => s.doctor_id && doctorIds.add(s.doctor_id));

  // Fold in the admission's attending doctor so there's always at least one option.
  let attendingId: string | null = null;
  if (admissionId) {
    const { data: adm } = await (supabase as any)
      .from("admissions")
      .select("admitting_doctor_id")
      .eq("id", admissionId)
      .maybeSingle();
    attendingId = adm?.admitting_doctor_id || null;
    if (attendingId) doctorIds.add(attendingId);
  }

  if (doctorIds.size === 0) return [];

  const { data: users } = await supabase
    .from("users")
    .select("id, full_name")
    .in("id", [...doctorIds]);
  const nameById = new Map<string, string>(
    (users || []).map((u: any) => [u.id, u.full_name || "Doctor"])
  );

  (svcs || []).forEach((s: any) => {
    if (!s.doctor_id || byId.has(s.doctor_id)) return;
    let fee = 0;
    if (s.ipd_consultation_fee !== null && s.ipd_consultation_fee !== undefined) {
      fee = Number(s.ipd_consultation_fee);
    } else if (s.fee) {
      fee = Number(s.fee);
    }
    byId.set(s.doctor_id, {
      doctorId: s.doctor_id,
      doctorName: nameById.get(s.doctor_id) || "Doctor",
      fee,
      gstPercent: s.gst_applicable ? Number(s.gst_percent) || 0 : 0,
      hsnCode: s.hsn_code || "999312",
    });
  });

  // Attending doctor with no configured consultation service — offer at ₹0 to be filled in.
  if (attendingId && !byId.has(attendingId)) {
    byId.set(attendingId, {
      doctorId: attendingId,
      doctorName: nameById.get(attendingId) || "Doctor",
      fee: 0,
      gstPercent: 0,
      hsnCode: "999312",
    });
  }

  return [...byId.values()].sort((a, b) => a.doctorName.localeCompare(b.doctorName));
}
