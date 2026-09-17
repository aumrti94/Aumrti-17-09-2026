import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side mirror of the day-closure lock triggers.
 *
 * The authority is SQL — `prevent_bill_on_locked_day` and
 * `prevent_payment_on_locked_bill_day`, see
 * supabase/migrations/20261008000152_draft_admission_bill_locked_day_exemption.sql.
 * This module exists so callers can fail BEFORE doing destructive work, rather
 * than discovering the block halfway through a multi-statement write and
 * leaving the bill in a half-updated state (that was the "Recalculate IPD"
 * bug: line items inserted, source rows flagged billed, then the totals UPDATE
 * rejected).
 *
 * `isLockExempt` must stay in step with the SQL predicate. UNGUARDED as of 2026-09-05 —
 * lockedDay.test.ts, which enumerated the same cases the migration header lists, was
 * removed with the rest of the suite. If you change one, change both by hand.
 */

export interface LockContext {
  billDate: string | null;
  billStatus: string | null;
  admissionId: string | null;
}

/**
 * Bill states that mean "this bill is closed" — the running bill has become a
 * final document and the day-closure lock applies again.
 */
const FINALISED_STATUSES = ["final", "irn_locked", "cancelled", "refunded"];

/**
 * True while a bill is still an open worksheet that should keep accruing charges.
 *
 * Same "not finalised" rule as isLockExempt below and for the same reason — a
 * running IPD bill legitimately leaves 'draft' mid-stay (requesting a discount
 * sets 'pending_approval'), and a strict draft test stops the stay's room and
 * nursing charges accruing from that moment on.
 *
 * A MISSING status counts as running here, where isLockExempt refuses to exempt
 * on one. The two are not in conflict: this drives whether to recompute charges
 * (open by default), isLockExempt guards a write against a day-closure lock and
 * so fails closed.
 */
export function isRunningBill(billStatus: string | null | undefined): boolean {
  return !billStatus || !FINALISED_STATUSES.includes(billStatus);
}

/**
 * True when the DB triggers will let this bill through even on a locked day.
 *
 * Exempt: an admission's RUNNING bill, up until it is finalised. An IPD bill
 * accrues charges every day of the stay and keeps its admission-day
 * `bill_date` throughout, so charges from later days would otherwise become
 * unpostable the moment the admission day is closed. Day closure reconciles
 * against bill_payments / bill_line_items, never against `bills`, so
 * recomputing a running bill's totals cannot move a closed day's figures.
 *
 * Keyed on "not finalised" rather than `bill_status === "draft"`: a running
 * bill legitimately leaves 'draft' mid-stay (requesting a discount sets
 * 'pending_approval'), and a strict draft test re-locked the bill mid-admission.
 *
 * NOT exempt (deliberately): finalised bills, non-admission bills, and — since
 * the caller can only ever exempt a totals update — anything that changes
 * `bill_date`, `hospital_id` or `bill_status`. Those are enforced SQL-side.
 */
export function isLockExempt(ctx: LockContext): boolean {
  if (!ctx.admissionId) return false;
  if (!ctx.billStatus) return false;
  return !FINALISED_STATUSES.includes(ctx.billStatus);
}

/** One wording for every surface, matching the SQL trigger's text. */
export function lockedDayMessage(billDate: string): string {
  return `Day ${billDate} is locked (cash closure). Reopen it first: Billing → Day Closure → Reopen Day.`;
}

/** Whether the hospital's cash closure for `date` is locked. */
export async function isDayLocked(hospitalId: string, date: string): Promise<boolean> {
  const { data } = await supabase
    .from("daily_cash_closure")
    .select("status")
    .eq("hospital_id", hospitalId)
    .eq("closure_date", date)
    .maybeSingle();
  return (data as any)?.status === "locked";
}

/**
 * Combined check for "may I write to this bill right now?".
 * Returns an error message when the write would be refused, else null.
 */
export async function checkBillWritable(
  hospitalId: string,
  ctx: LockContext
): Promise<string | null> {
  if (!ctx.billDate) return null;
  if (isLockExempt(ctx)) return null;
  if (await isDayLocked(hospitalId, ctx.billDate)) return lockedDayMessage(ctx.billDate);
  return null;
}
