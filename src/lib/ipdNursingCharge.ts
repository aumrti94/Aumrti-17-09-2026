/**
 * ipdNursingCharge — manually post a SPECIAL / private-duty nursing charge for an admission.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE DAILY NURSING CHARGE. Routine nursing accrues
 * automatically inside autoPullAdmissionCharges (lib/ipdBilling.ts) next to the room charge,
 * priced from the ward's own nursing_rate_per_day, so it follows the length of stay without
 * anyone clicking anything. What it CANNOT know is when a patient was put on one-to-one /
 * private-duty nursing for a few days — that is a clinical decision someone has to record.
 * This is that path.
 *
 * IT IS BILLABLE TO EVERY PAYER, UNLIKE THE DAILY CHARGE. The automatic daily line is
 * suppressed for CGHS/ESI/TPA payers because those schemes bundle nursing into room rent
 * (see lib/payerTypes.ts). Special nursing is different: IRDAI lists it as a NON-PAYABLE
 * item, which means the insurer will not reimburse it — not that the hospital may not
 * charge it. It is a legitimate cash item and is therefore never suppressed here.
 *
 * DEDUPE. The key is `ipd_nursing_special:{date}` — deliberately distinct from the sweep's
 * daily key `ipd:nursing:{admissionId}` and from the procedure sweep's `nursing:{id}`, so a
 * re-pull never deletes a manually added special-nursing line and the three can coexist on
 * one bill. Re-adding the same date replaces that day's line rather than stacking a second.
 */

import { supabase } from "@/integrations/supabase/client";
import { findOrCreateAdmissionBill } from "@/lib/admissionBill";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { getWardNursingRate } from "@/lib/wardNursingRate";

export interface AddNursingChargeOpts {
  hospitalId: string;
  patientId: string;
  admissionId: string;
  /** Service date in YYYY-MM-DD. The dedupe key is per date. */
  date: string;
  /** Number of days covered from that date. */
  days: number;
  /** Per-day special nursing rate (GST-exempt). */
  rate: number;
  /** users.id of whoever recorded the charge. */
  orderedBy?: string | null;
}

export interface AddNursingChargeResult {
  ok: boolean;
  billId?: string;
  amount?: number;
  error?: string;
}

export async function addSpecialNursingCharge(
  opts: AddNursingChargeOpts
): Promise<AddNursingChargeResult> {
  const { hospitalId, patientId, admissionId, date, days, rate, orderedBy } = opts;

  if (!hospitalId || !patientId || !admissionId) {
    return { ok: false, error: "Hospital, patient, or admission missing" };
  }
  const qty = Math.max(1, Math.floor(days) || 1);
  if (!(rate > 0)) return { ok: false, error: "Nursing rate must be greater than zero" };

  try {
    // Resolve the admission's own bill (ipd or daycare), creating it if this is the first
    // charge — so nursing can be added before any bill exists, like a manual consultation.
    const { id: billId } = await findOrCreateAdmissionBill(hospitalId, patientId, admissionId);

    const dedupeKey = `ipd_nursing_special:${date}`;

    await (supabase as any)
      .from("bill_line_items")
      .delete()
      .eq("bill_id", billId)
      .eq("source_dedupe_key", dedupeKey);

    const total = rate * qty;

    const { error: lie } = await (supabase as any)
      .from("bill_line_items")
      .insert({
        hospital_id: hospitalId,
        bill_id: billId,
        item_type: "nursing",
        description: qty > 1
          ? `Special Nursing (1:1) — ${date} — ${qty} days`
          : `Special Nursing (1:1) — ${date}`,
        quantity: qty,
        unit_rate: rate,
        taxable_amount: total,
        // Healthcare services by a clinical establishment are GST-exempt; gstRules puts
        // nursing at 0%. Set explicitly so this never inherits another slab.
        gst_percent: 0,
        gst_amount: 0,
        total_amount: total,
        hsn_code: "999312",
        source_module: "ipd_nursing_special",
        // No source record exists for a manual charge, and the column is a uuid — a
        // composite string here would be rejected outright.
        source_record_id: null,
        source_dedupe_key: dedupeKey,
        ordered_by: orderedBy || null,
        service_date: date,
      });

    if (lie) return { ok: false, error: lie.message };

    const recalc = await recalculateBillTotalsSafe(billId);
    if (!recalc.ok) return { ok: false, billId, error: recalc.error || "Bill recalculation failed" };

    return { ok: true, billId, amount: total };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Failed to post nursing charge" };
  }
}

export interface WardNursingRate {
  /** The ward's configured nursing rate/day. 0 when nursing is bundled into room rent. */
  rate: number;
  wardName: string;
}

/**
 * The admission ward's configured nursing rate, used only to PREFILL the manual form.
 * Special nursing is usually dearer than routine nursing, so the field stays editable —
 * this is a starting point, not a ceiling.
 */
export async function fetchWardNursingRate(admissionId: string): Promise<WardNursingRate> {
  const { data } = await (supabase as any)
    .from("admissions")
    .select("ward_id, wards(name)")
    .eq("id", admissionId)
    .maybeSingle();

  // The rate itself comes from getWardNursingRate, which survives a database that has not
  // had migration 20261011000091 applied — joining the column here would blank this query.
  return {
    rate: await getWardNursingRate(data?.ward_id),
    wardName: data?.wards?.name || "",
  };
}
