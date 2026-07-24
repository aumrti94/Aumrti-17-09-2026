/**
 * billStatus — how a bill's payment_status is DISPLAYED, and what it means for money owed.
 *
 * Why this exists
 * ---------------
 * `bills.payment_status` allows 'unpaid' | 'partial' | 'paid' | 'refund_pending' | 'refunded'
 * (20260323042425), but every display map in the app listed only the first three-plus-one and
 * fell back to `unpaid` for anything unknown. A refunded bill therefore rendered as a red
 * **Unpaid** badge — telling the cashier the patient still owes money that had already been
 * handed back to them.
 *
 * It reads worse than a wrong label: RefundApprovalsInbox sets `paid_amount = 0` and
 * `balance_due = total_amount` on refund, so the same bill also showed "₹51,500 due" and was
 * counted in the Billing header's "pending" total. Nothing is due on a refunded bill — the
 * money went out, not in.
 *
 * Every surface that shows a bill's payment state reads its label from here.
 */

/**
 * Statuses that mean the money has gone back to the patient (or is on its way).
 * Exported for query filters — see CollectionsTab, which must not dun a refunded bill.
 */
export const REFUND_PAYMENT_STATUSES = ["refunded", "refund_pending"] as const;
const REFUND_STATUSES: readonly string[] = REFUND_PAYMENT_STATUSES;

export interface BillStatusDisplay {
  label: string;
  /** Tailwind classes for the badge pill. */
  badge: string;
  /** Tailwind class for the card's left border accent. */
  border: string;
}

const DISPLAY: Record<string, BillStatusDisplay> = {
  unpaid:         { label: "Unpaid",   badge: "bg-destructive/10 text-destructive", border: "border-l-destructive" },
  partial:        { label: "Partial",  badge: "bg-accent/10 text-accent",           border: "border-l-accent" },
  paid:           { label: "Paid ✓",   badge: "bg-success/10 text-success",         border: "border-l-success" },
  // Distinguishable on sight: an approved refund is settled, a pending one still needs action.
  refunded:       { label: "Refunded", badge: "bg-violet-100 text-violet-700",      border: "border-l-violet-500" },
  refund_pending: { label: "Refund pending", badge: "bg-amber-100 text-amber-700",  border: "border-l-amber-500" },
  cancelled:      { label: "Cancelled", badge: "bg-muted text-muted-foreground",    border: "border-l-muted-foreground" },
  draft:          { label: "Draft",    badge: "bg-muted text-muted-foreground",     border: "border-l-muted-foreground" },
};

/**
 * PURE. Badge label and styling for a payment status.
 *
 * An UNRECOGNISED status renders as itself in neutral grey — never as "Unpaid". Defaulting an
 * unknown state to "Unpaid" is what hid 'refunded' for as long as it did: the screen asserted
 * a debt the data never claimed.
 */
export function billStatusDisplay(status: string | null | undefined): BillStatusDisplay {
  const key = String(status || "").toLowerCase();
  if (DISPLAY[key]) return DISPLAY[key];
  return {
    label: key ? key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Unknown",
    badge: "bg-muted text-muted-foreground",
    border: "border-l-muted-foreground",
  };
}

/** PURE. Has this bill's money been (or is it being) returned to the patient? */
export function isRefundStatus(status: string | null | undefined): boolean {
  return REFUND_STATUSES.includes(String(status || "").toLowerCase());
}

/**
 * PURE. The amount the patient still owes on this bill.
 *
 * Zero for a refunded bill whatever `balance_due` says. The refund flow rewrites
 * `balance_due` back up to the full total (paid_amount drops to 0, balance = total − 0), so
 * reading the column raw reports a refunded bill as fully collectable — which inflates the
 * "pending" figure on the Billing header by the exact amount that was just paid back.
 */
export function outstandingAmount(bill: {
  payment_status?: string | null;
  balance_due?: number | null;
}): number {
  if (isRefundStatus(bill.payment_status)) return 0;
  const n = Number(bill.balance_due ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** PURE. Sum of what is genuinely still collectable across a list of bills. */
export function totalOutstanding(
  bills: Array<{ payment_status?: string | null; balance_due?: number | null }>
): number {
  return (bills || []).reduce((sum, b) => sum + outstandingAmount(b), 0);
}
