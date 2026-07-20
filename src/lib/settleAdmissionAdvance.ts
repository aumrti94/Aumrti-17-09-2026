import { supabase } from "@/integrations/supabase/client";
import { syncAdvanceToBill } from "@/lib/advanceBillSync";
import { fetchOpenAdmissionRefund } from "@/lib/refundRequests";

/**
 * Pure split of an advance balance at discharge: cover the bill first, refund the rest.
 * Extracted so the money arithmetic is unit-testable without a database.
 * Negative/NaN inputs clamp to 0 — never invent money.
 */
export function planAdvanceSettlement(
  balance: number,
  billBalanceDue: number | null | undefined,
): { applied: number; refund: number } {
  const bal = Math.max(Number(balance) || 0, 0);
  if (bal <= 0) return { applied: 0, refund: 0 };
  const due = Math.max(Number(billBalanceDue) || 0, 0);
  const applied = Math.min(bal, due);
  return { applied, refund: bal - applied };
}

export interface SettleAdvanceResult {
  /** Advance applied against the admission's bill. */
  applied: number;
  /** Excess advance raised as a refund request (pending a second person's approval). */
  refundRequested: number;
  /** Set when nothing needed doing. */
  skipped?: string;
}

/**
 * Settle an admission's advance at discharge so the ledger doesn't follow the patient
 * into their next stay:
 *   1. apply the advance against the admission's outstanding bill, then
 *   2. raise any EXCESS as a refund request for approval.
 *
 * Deliberately does NOT write the `ipd_advances` 'refund' row, update the bill for the
 * refund, or post to the GL — the Refund Approval Inbox does all three when a second
 * person approves (see RefundApprovalsInbox.approveRefund). Doing it here too would
 * double-count the refund and disburse before approval.
 *
 * Idempotent: the balance check makes the apply-step self-limiting, and an existing
 * pending/processed refund for the admission suppresses a duplicate request. Safe to
 * re-run (discharge can be retried).
 *
 * Throws on write failure — callers should surface it WITHOUT blocking discharge; an
 * accounting hiccup (e.g. a locked day) must not trap a patient in a bed.
 */
export async function settleAdmissionAdvance(params: {
  admissionId: string;
  hospitalId: string;
  patientId: string;
  refundMode?: string;
  settledBy?: string | null;
}): Promise<SettleAdvanceResult> {
  const { admissionId, hospitalId, patientId, refundMode = "cash", settledBy = null } = params;

  // 1. What's left on THIS admission's advance (view is grouped by admission_id).
  const { data: bal } = await (supabase as any)
    .from("ipd_advance_balances")
    .select("balance")
    .eq("admission_id", admissionId)
    .maybeSingle();

  let balance = Number(bal?.balance || 0);
  if (balance <= 0) return { applied: 0, refundRequested: 0, skipped: "no advance balance" };

  // 2. The admission's bill (same lookup the ledger tab uses).
  const { data: bill } = await (supabase as any)
    .from("bills")
    .select("id, total_amount, paid_amount, balance_due")
    .eq("admission_id", admissionId)
    .eq("hospital_id", hospitalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let applied = 0;

  if (bill?.id) {
    const billBalance = Number(
      bill.balance_due ?? Math.max(Number(bill.total_amount || 0) - Number(bill.paid_amount || 0), 0),
    );
    const { applied: applyAmount } = planAdvanceSettlement(balance, billBalance);

    if (applyAmount > 0) {
      const { error: txErr } = await (supabase as any).from("ipd_advances").insert({
        hospital_id: hospitalId,
        admission_id: admissionId,
        patient_id: patientId,
        amount: applyAmount,
        transaction_type: "service_debit",
        description: `Applied to bill ${String(bill.id).slice(0, 8).toUpperCase()} on discharge`,
        collected_by: settledBy,
      });
      if (txErr) throw txErr;

      // Only mirror the portion that wasn't already synced to bill_payments when the
      // advance was collected — otherwise paid_amount double-counts (same guard as
      // AdvanceApplicationTab.applyAdvance).
      const { data: advPmts } = await (supabase as any)
        .from("bill_payments")
        .select("amount")
        .eq("bill_id", bill.id)
        .eq("is_advance", true);
      const alreadySynced = (advPmts || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

      if (alreadySynced < applyAmount) {
        await syncAdvanceToBill({
          admissionId,
          hospitalId,
          amount: applyAmount - alreadySynced,
          paymentMode: "advance_adjust",
          notes: "Advance settled on discharge",
        });
      }

      applied = applyAmount;
      balance -= applyAmount;
    }
  }

  // 3. Anything still held is the patient's money → raise a refund for approval.
  let refundRequested = 0;
  if (balance > 0) {
    // A refund already raised (here or by hand in RefundModal) — never stack
    // another. This guard previously missed 'approved' rows and counted
    // pharmacy credit-note refunds as if they were this one. The DB enforces
    // it too (migration 153) in case two discharges race.
    const existing = await fetchOpenAdmissionRefund(admissionId);

    if (!existing) {
      const { error: rpErr } = await (supabase as any).from("refund_payables").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        admission_id: admissionId,
        bill_id: bill?.id ?? null,
        credit_note_id: null,
        amount: balance,
        refund_mode: refundMode,
        status: "pending_approval",
        requested_by: settledBy,
        notes: "Excess advance — auto-raised on discharge",
      });
      if (rpErr) throw rpErr;
      refundRequested = balance;
    }
  }

  return { applied, refundRequested };
}
