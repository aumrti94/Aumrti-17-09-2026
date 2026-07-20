import { supabase } from "@/integrations/supabase/client";

/**
 * Shared rules for raising a patient refund request.
 *
 * A refund must be raised ONCE. Every surface used to insert into
 * refund_payables directly, and only settleAdmissionAdvance bothered to check
 * for an existing one — so clicking "Process Refund" twice stacked two pending
 * rows for the same bill in the approval inbox, and approving both would pay
 * the patient twice.
 *
 * The database is the real guarantee (partial unique indexes, migration
 * 20261008000153). These helpers exist so the UI can disable the action and
 * explain itself, rather than letting the user click into a constraint error.
 */

/**
 * Statuses that mean "this refund is still live".
 * 'processed' is excluded deliberately: a settled refund must not block a
 * later, genuinely new overpayment on the same bill. 'rejected' is dead.
 */
export const OPEN_REFUND_STATUSES = ["pending_approval", "approved"] as const;

export interface OpenRefund {
  id: string;
  amount: number;
  status: string;
  refund_mode: string | null;
  created_at: string;
}

/**
 * The live refund request against this bill (or, when no bill is linked, this
 * admission), or null. Mirrors the scope of the DB unique indexes: pharmacy
 * credit-note refunds are excluded, since several can legitimately be open.
 */
export async function fetchOpenRefund(opts: {
  billId?: string | null;
  admissionId?: string | null;
}): Promise<OpenRefund | null> {
  const { billId, admissionId } = opts;
  if (!billId && !admissionId) return null;

  let query = (supabase as any)
    .from("refund_payables")
    .select("id, amount, status, refund_mode, created_at")
    .is("credit_note_id", null)
    .in("status", OPEN_REFUND_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1);

  if (billId) {
    query = query.eq("bill_id", billId);
  } else {
    // .eq() never matches NULL in PostgREST — the guard that let discharge-time
    // auto-raises double up when no bill was linked. .is() is required.
    query = query.is("bill_id", null).eq("admission_id", admissionId);
  }

  const { data } = await query;
  return ((data as OpenRefund[]) || [])[0] ?? null;
}

/**
 * Any live refund for this admission, whether or not a bill is linked.
 * Used at discharge, where a refund may already have been raised by hand in
 * RefundModal (bill-linked) or by an earlier settlement attempt (not linked).
 * Credit-note refunds are excluded — a pharmacy return is separate money and
 * must not suppress the excess-advance refund.
 */
export async function fetchOpenAdmissionRefund(
  admissionId: string | null | undefined
): Promise<OpenRefund | null> {
  if (!admissionId) return null;
  const { data } = await (supabase as any)
    .from("refund_payables")
    .select("id, amount, status, refund_mode, created_at")
    .eq("admission_id", admissionId)
    .is("credit_note_id", null)
    .in("status", OPEN_REFUND_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data as OpenRefund[]) || [])[0] ?? null;
}

/** True when a unique-index violation came from the one-open-refund rule. */
export function isDuplicateRefundError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "23505" || /refund_payables_one_open_per/.test(e.message || "");
}

export const DUPLICATE_REFUND_MESSAGE =
  "A refund for this bill is already awaiting approval. Approve or reject it in Billing → Refunds first.";
