import { supabase } from "@/integrations/supabase/client";

/**
 * The one place that answers "how much advance credit does this admission hold?".
 *
 * MUST be scoped to THIS admission. Scoping by patient pulled in every advance
 * the patient ever paid — including ones already recorded and settled on a
 * previous stay — which double-counted them and invented a bogus "refund due"
 * on the current admission. That bug was fixed in IPDFinancialTab and
 * AdvanceApplicationTab but never back-ported to BillEditor and LineItemsTab,
 * so it resurfaced as a phantom ₹29,000 "Refund Due to Patient". Four copies of
 * this query is what let two of them drift; there is now one.
 *
 * Two ledgers feed the balance:
 *  • `ipd_advance_balances` — the view over ipd_advances (deposits, adjustments,
 *    service debits, refunds), already netted.
 *  • `advance_receipts` — legacy rows, counted only when not already mirrored
 *    into ipd_advances (matched on receipt_number → reference_no), else the same
 *    money is counted twice.
 */

export interface AdvanceLedger {
  /** Net balance from the ipd_advance_balances view (deposits − debits − refunds). */
  viewBalance: number;
  totalDeposited: number;
  /** Advance already applied to a bill. */
  totalDebited: number;
  /** Legacy advance_receipts not yet mirrored into ipd_advances. */
  unmirroredReceipts: number;
  /**
   * Total advance credit to set against the bill, GROSS of application.
   * viewBalance + totalDebited + unmirroredReceipts.
   */
  netAdvance: number;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Pure. `totalDebited` is added back deliberately: billMoney's `patientPayable`
 * is gross of advance, so advance already applied to the bill must still count
 * as a credit or it is silently lost from the settlement.
 */
export function computeNetAdvance(p: {
  viewBalance: unknown;
  totalDebited: unknown;
  unmirroredReceipts: unknown;
}): number {
  return num(p.viewBalance) + num(p.totalDebited) + num(p.unmirroredReceipts);
}

/** Pure. Legacy receipts whose receipt_number is not already mirrored into ipd_advances. */
export function filterUnmirroredReceipts<R extends { receipt_number?: string | null }>(
  receipts: R[],
  mirroredRefs: (string | null | undefined)[]
): R[] {
  const mirrored = new Set(mirroredRefs.filter(Boolean));
  return (receipts || []).filter((r) => !r.receipt_number || !mirrored.has(r.receipt_number));
}

const EMPTY: AdvanceLedger = {
  viewBalance: 0, totalDeposited: 0, totalDebited: 0, unmirroredReceipts: 0, netAdvance: 0,
};

/** I/O. Always admission-scoped — see the module comment for why. */
export async function fetchAdvanceLedger(
  admissionId: string | null | undefined,
  hospitalId: string | null | undefined
): Promise<AdvanceLedger> {
  if (!admissionId || !hospitalId) return { ...EMPTY };

  const [balRes, receiptsRes, refsRes] = await Promise.all([
    (supabase as any)
      .from("ipd_advance_balances")
      .select("balance, total_deposited, total_debited")
      .eq("admission_id", admissionId)
      .eq("hospital_id", hospitalId)
      .maybeSingle(),
    (supabase as any)
      .from("advance_receipts")
      .select("amount, receipt_number")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", admissionId),
    (supabase as any)
      .from("ipd_advances")
      .select("reference_no")
      .eq("admission_id", admissionId)
      .not("reference_no", "is", null),
  ]);

  const mirroredRefs = ((refsRes as any)?.data || []).map((r: any) => r.reference_no);
  const unmirroredReceipts = filterUnmirroredReceipts(
    ((receiptsRes as any)?.data || []) as { amount?: unknown; receipt_number?: string | null }[],
    mirroredRefs
  ).reduce((s: number, r: any) => s + num(r.amount), 0);

  const view = (balRes as any)?.data || {};
  const viewBalance = num(view.balance);
  const totalDebited = num(view.total_debited);

  return {
    viewBalance,
    totalDeposited: num(view.total_deposited) + unmirroredReceipts,
    totalDebited,
    unmirroredReceipts,
    netAdvance: computeNetAdvance({ viewBalance, totalDebited, unmirroredReceipts }),
  };
}
