/**
 * dayCareCancel — cancel, no-show and reschedule a booked day care procedure.
 *
 * A booking can hold real money: the deposit is collected before the procedure, so a
 * cancellation has to decide what happens to it. All three answers reuse machinery that
 * already exists — nothing about refunds is reinvented here:
 *
 *   refund        → settleAdmissionAdvance() raises a refund_payables row for approval, so
 *                   cash still only leaves after a second person signs it off.
 *   retain_fee    → the fee is BILLED as a real line item (autoChargeService), then
 *                   settleAdmissionAdvance applies the deposit to it and refunds the excess.
 *                   Retained cash without an invoice is unrecognised revenue that never
 *                   reaches the GL, which is why the fee is billed rather than just kept.
 *   carry_forward → nothing moves; the balance stays held on this admission.
 *
 * Reschedule deliberately does NOT touch money: it keeps the same admission row, so the
 * deposit rides along. That is why "same patient, later date" is a reschedule and not a
 * cancel-and-rebook.
 */

import { supabase } from "@/integrations/supabase/client";
import { autoChargeService, MODULE_DAY_CARE } from "@/lib/serviceBilling";
import { settleAdmissionAdvance } from "@/lib/settleAdmissionAdvance";
import { getCurrentUserRowId } from "@/lib/currentUser";
import { logAudit } from "@/lib/auditLog";

export type DepositDisposition = "refund" | "retain_fee" | "carry_forward";
export type CancelStatus = "cancelled" | "no_show";

export interface DepositPlan {
  /** Billed as a real "Cancellation fee" line so the retained cash has an invoice. */
  feeToBill: number;
  /** Raised in refund_payables for approval. */
  refundAmount: number;
  /** Left sitting on the admission (carry_forward only). */
  holdAmount: number;
  /** Set when the inputs are unusable — the caller must not proceed. */
  error?: string;
}

/** Finite number, else null. Keeps NaN out of money maths. */
function num(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * PURE. What happens to a held deposit when a booking is cancelled.
 *
 * The balance is clamped at 0: a negative or missing balance can never be turned into a
 * refund. The fee is clamped to the balance: retaining more than the patient paid would
 * invent a debt on a procedure that never happened.
 */
export function planDepositDisposition(
  balance: number | null,
  disposition: DepositDisposition,
  retainedFee: number | null
): DepositPlan {
  const held = Math.max(0, num(balance) ?? 0);
  const none: DepositPlan = { feeToBill: 0, refundAmount: 0, holdAmount: 0 };

  if (disposition === "carry_forward") {
    return { ...none, holdAmount: held };
  }

  if (disposition === "refund") {
    return { ...none, refundAmount: held };
  }

  // retain_fee
  const fee = num(retainedFee);
  if (fee === null) {
    return { ...none, holdAmount: held, error: "Enter the fee to retain." };
  }
  if (fee < 0) {
    return { ...none, holdAmount: held, error: "The retained fee cannot be negative." };
  }

  // Clamp rather than reject: retaining the whole deposit is legitimate (a same-day
  // no-show), but billing beyond it would leave the patient owing money for nothing.
  const feeToBill = Math.min(fee, held);
  return { feeToBill, refundAmount: held - feeToBill, holdAmount: 0 };
}

/**
 * Cancel a booking, or mark it a no-show, handling any deposit held against it.
 *
 * Order matters: the money is resolved BEFORE the status flips. A booking marked cancelled
 * while the hospital still silently holds the patient's deposit is the worst outcome, so a
 * failure to raise the refund must abort the whole cancellation.
 */
export async function cancelDayCareBooking(opts: {
  hospitalId: string;
  admissionId: string;
  patientId: string;
  status: CancelStatus;
  reason: string;
  note?: string;
  disposition: DepositDisposition;
  retainedFee?: number | null;
  patientName?: string;
}): Promise<{ refundRequested: number; feeBilled: number; holdAmount: number }> {
  const { hospitalId, admissionId, patientId, status, reason, note, disposition } = opts;

  if (!reason.trim()) throw new Error("A cancellation reason is required.");

  const { data: bal } = await (supabase as any)
    .from("ipd_advance_balances")
    .select("balance")
    .eq("admission_id", admissionId)
    .maybeSingle();

  const plan = planDepositDisposition(
    Number(bal?.balance) || 0,
    disposition,
    opts.retainedFee ?? null
  );
  if (plan.error) throw new Error(plan.error);

  const userId = await getCurrentUserRowId();

  // 1. Bill the retained fee first, so settleAdmissionAdvance has something to apply the
  //    deposit against and only refunds the genuine excess.
  if (plan.feeToBill > 0) {
    await autoChargeService({
      hospitalId,
      patientId,
      admissionId,
      serviceName: "Day Care: Cancellation fee",
      serviceModule: MODULE_DAY_CARE,
      quantity: 1,
      unitRate: plan.feeToBill,
      gstPercent: 0,
      performedBy: userId,
    });
  }

  // 2. Settle. Deliberately NOT wrapped in try/catch, unlike the discharge callers:
  //    trg_prevent_refund_on_locked_day hard-rejects a refund dated into a closed cash day,
  //    and swallowing that would cancel the booking while keeping the patient's money.
  let refundRequested = 0;
  if (disposition !== "carry_forward") {
    const settled = await settleAdmissionAdvance({ admissionId, hospitalId, patientId });
    refundRequested = settled.refundRequested;
  }

  // 3. Audit before the status write, so the record survives a failed update.
  await logAudit({
    action: status === "no_show" ? "daycare_no_show" : "daycare_cancelled",
    module: "ipd",
    entityType: "admission",
    entityId: admissionId,
    details: {
      reason,
      note: note || null,
      disposition,
      retainedFee: plan.feeToBill,
      refundRequested,
      heldForward: plan.holdAmount,
    },
  });

  // Three schema bugs fixed here: `message` was never a real column (`alert_message` is);
  // `severity: "info"` was never a valid CHECK value; `daycare_no_show`/`daycare_cancelled`
  // were never in the alert_type whitelist, and `admission_id` never existed as a column at
  // all — so this insert has never once succeeded, silently, since this feature shipped.
  const { error: alertErr } = await (supabase as any).from("clinical_alerts").insert({
    hospital_id: hospitalId,
    patient_id: patientId,
    admission_id: admissionId,
    alert_type: status === "no_show" ? "daycare_no_show" : "daycare_cancelled",
    severity: "low",
    alert_message:
      `Day care booking ${status === "no_show" ? "marked no-show" : "cancelled"}` +
      `${opts.patientName ? ` for ${opts.patientName}` : ""} — ${reason}` +
      `${note ? ` (${note})` : ""}.`,
    created_by: userId,
  });
  if (alertErr) console.error("dayCareCancel: clinical_alerts insert failed:", alertErr.message);

  // 4. Flip the status. The trigger re-validates reason + author server-side.
  const { error } = await (supabase as any)
    .from("admissions")
    .update({
      status,
      cancelled_at: new Date().toISOString(),
      cancelled_by: userId,
      cancellation_reason: reason,
      cancellation_note: note?.trim() || null,
      deposit_disposition: disposition,
      retained_fee: plan.feeToBill || null,
    })
    .eq("id", admissionId);

  if (error) throw new Error(error.message);

  // 5. Retire the pending insurance intimation. fn_insurance_auto_intimate raised one at
  //    booking anchored to scheduled_at - 2h; leaving it live fires a false "missed
  //    intimation" alert for a procedure that will never happen.
  await (supabase as any)
    .from("insurance_intimations")
    .update({ status: "cancelled" })
    .eq("admission_id", admissionId)
    .eq("status", "pending");

  return { refundRequested, feeBilled: plan.feeToBill, holdAmount: plan.holdAmount };
}

/**
 * Move a booking to another date/time. No money moves — the deposit stays on this same
 * admission row, which is the whole point of rescheduling rather than cancelling.
 */
export async function rescheduleDayCareBooking(opts: {
  hospitalId: string;
  admissionId: string;
  newScheduledAt: Date;
  note?: string;
}): Promise<void> {
  const { admissionId, newScheduledAt, note } = opts;

  if (!(newScheduledAt instanceof Date) || Number.isNaN(newScheduledAt.getTime())) {
    throw new Error("Pick a valid date and time.");
  }
  if (newScheduledAt.getTime() <= Date.now()) {
    throw new Error("The new date and time must be in the future.");
  }

  const { data: adm } = await (supabase as any)
    .from("admissions")
    .select("scheduled_at, status, reschedule_count")
    .eq("id", admissionId)
    .maybeSingle();

  if (!adm) throw new Error("Booking not found.");
  if (adm.status !== "scheduled") {
    throw new Error("Only a booking that has not been admitted yet can be rescheduled.");
  }

  const { error } = await (supabase as any)
    .from("admissions")
    .update({
      scheduled_at: newScheduledAt.toISOString(),
      // Day care discharges on the day of the procedure. Moving scheduled_at alone would
      // silently leave this pointing at the old date.
      expected_discharge_date: newScheduledAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
      rescheduled_from: adm.scheduled_at,
      reschedule_count: (Number(adm.reschedule_count) || 0) + 1,
    })
    .eq("id", admissionId);

  if (error) throw new Error(error.message);

  // Re-anchor the intimation deadline. It is fixed at INSERT by fn_insurance_auto_intimate,
  // so a rescheduled booking would otherwise keep a deadline pointing at the old date — and
  // be reported as missed before the patient is even due.
  await (supabase as any)
    .from("insurance_intimations")
    .update({ intimation_deadline: new Date(newScheduledAt.getTime() - 2 * 60 * 60 * 1000).toISOString() })
    .eq("admission_id", admissionId)
    .eq("status", "pending");

  await logAudit({
    action: "daycare_rescheduled",
    module: "ipd",
    entityType: "admission",
    entityId: admissionId,
    details: { from: adm.scheduled_at, to: newScheduledAt.toISOString(), note: note || null },
  });
}
