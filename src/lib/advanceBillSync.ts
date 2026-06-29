/**
 * advanceBillSync
 *
 * Single source-of-truth for recording an IPD advance deposit as a real
 * payment against the admission's draft bill.
 *
 * Responsibilities:
 *  1. Find the draft IPD bill for the admission.
 *  2. Insert a bill_payments row (is_advance = true) — idempotent guard
 *     prevents double-insertion if called twice for the same receipt.
 *  3. Increment bills.paid_amount and recalculate balance_due / payment_status.
 *
 * Called from:
 *  - AdvanceReceiptModal   (when admissionId is known)
 *  - IPDFinancialTab       (handleDeposit)
 *  - AdvanceApplicationTab (backward-compat path for old admissions)
 */

import { supabase } from "@/integrations/supabase/client";

export async function syncAdvanceToBill(params: {
  admissionId: string;
  hospitalId:  string;
  amount:      number;
  paymentMode: string;
  userId?:     string | null;
  referenceNo?: string | null;
  notes?:      string | null;
}): Promise<string | null> {
  const { admissionId, hospitalId, amount, paymentMode, userId, referenceNo, notes } = params;

  // 1. Find the IPD bill for this admission
  const { data: bill } = await (supabase as any)
    .from("bills")
    .select("id, paid_amount, total_amount, balance_due")
    .eq("admission_id", admissionId)
    .eq("hospital_id",  hospitalId)
    .eq("bill_type",    "ipd")
    .maybeSingle();

  if (!bill) return null; // No bill yet — skip silently

  // 2. Guard: skip if an is_advance payment of this exact amount already exists
  //    (prevents double-counting when utility is called more than once)
  const { data: existing } = await (supabase as any)
    .from("bill_payments")
    .select("id, amount")
    .eq("bill_id",    bill.id)
    .eq("is_advance", true);

  const alreadySynced = (existing || []).reduce(
    (s: number, p: any) => s + Number(p.amount || 0), 0
  );

  if (alreadySynced >= amount) return bill.id; // Already fully synced

  const toSync = amount - alreadySynced; // Only add the delta

  // 3. Insert bill_payments
  await (supabase as any).from("bill_payments").insert({
    hospital_id:    hospitalId,
    bill_id:        bill.id,
    payment_mode:   paymentMode === "neft" || paymentMode === "cheque" ? "net_banking" : paymentMode,
    amount:         toSync,
    payment_date:   new Date().toISOString().split("T")[0],
    payment_time:   new Date().toISOString(),
    received_by:    userId ?? undefined,
    transaction_id: referenceNo ?? undefined,
    notes:          notes || "IPD advance deposit",
    is_advance:     true,
  });

  // 4. Update bills.paid_amount, balance_due, payment_status
  const newPaid    = Number(bill.paid_amount   || 0) + toSync;
  const totalAmt   = Number(bill.total_amount  || 0);
  const newBalance = Math.max(0, totalAmt - newPaid);
  const newStatus  = newBalance <= 0 && newPaid > 0 ? "paid"
                   : newPaid > 0                     ? "partial"
                                                     : "unpaid";

  await (supabase as any).from("bills").update({
    paid_amount:    newPaid,
    balance_due:    newBalance,
    payment_status: newStatus,
  }).eq("id", bill.id);

  return bill.id;
}
