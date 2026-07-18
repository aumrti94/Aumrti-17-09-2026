/**
 * Day-closure cash reconciliation — pure aggregation, so the money logic is
 * testable without a database.
 *
 * A closure answers one question per tender: how much of it physically moved
 * today? That means each bucket must be NET — receipts, advances taken in, and
 * refunds paid out all land in the mode they actually moved through.
 *
 * Previously advances and refunds were lump sums bolted onto the grand total
 * with no mode attribution, so a ₹5,000 UPI advance left UPI reading ₹0 while a
 * ₹3,500 cash refund never came off Cash. The grand total still came out right,
 * but only by coincidence — and the per-mode figures are the ones a supervisor
 * physically counts.
 */

export interface SystemTotals {
  cash: number;
  upi: number;
  card: number;
  cheque: number;
  net_banking: number;
  insurance: number;
  other: number;
  /** Refunds processed today (refund_payables, status='processed') — informational; already inside the mode buckets. */
  refunds: number;
  /** Advance deposits received today but not yet mirrored into bill_payments — informational; already inside the mode buckets. */
  advances: number;
  total: number;
}

export interface ModedAmount {
  mode: string | null;
  amount: number;
}

export interface DayClosureInput {
  /** bill_payments rows for the day (any mode, including internal transfers). */
  payments: ModedAmount[];
  /** refund_payables rows processed today, by refund_mode. */
  refunds: ModedAmount[];
  /** ipd_advances deposit rows created today, by payment_mode. */
  advanceDeposits: ModedAmount[];
  /** bill_payments rows for the day with is_advance = true (the mirrored slice of the above). */
  mirroredAdvances: ModedAmount[];
}

/**
 * Not a tender: 'advance_adjust' applies an already-collected advance to a bill.
 * No money changes hands, so counting it as a receipt double-counts the original
 * deposit — and, as a mirror row, it must not cancel out an unmirrored deposit.
 */
export const INTERNAL_TRANSFER_MODE = "advance_adjust";

export const EMPTY_TOTALS: SystemTotals = {
  cash: 0, upi: 0, card: 0, cheque: 0, net_banking: 0,
  insurance: 0, other: 0, refunds: 0, advances: 0, total: 0,
};

/** Map a raw payment/refund mode string onto its SystemTotals bucket. */
export function bucketForMode(mode: string | null): keyof SystemTotals {
  const m = (mode || "").toLowerCase();
  if (m === "cash") return "cash";
  if (m === "upi") return "upi";
  if (m === "card") return "card";
  if (m === "cheque") return "cheque";
  if (m === "net_banking") return "net_banking";
  if (m === "insurance" || m === "pmjay" || m === "cghs" || m === "echs") return "insurance";
  return "other";
}

const isInternal = (mode: string | null) => (mode || "").toLowerCase() === INTERNAL_TRANSFER_MODE;

function sumByMode(rows: ModedAmount[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of rows) {
    if (isInternal(r.mode)) continue;
    const m = (r.mode || "unknown").toLowerCase();
    acc[m] = (acc[m] || 0) + Number(r.amount || 0);
  }
  return acc;
}

export function computeDayClosureTotals(input: DayClosureInput): SystemTotals {
  const totals: SystemTotals = { ...EMPTY_TOTALS };
  const add = (mode: string | null, amount: number) => {
    const bucket = bucketForMode(mode);
    (totals[bucket] as number) += amount;
  };

  // Real tenders received. Internal transfers move no money.
  for (const p of input.payments) {
    if (isInternal(p.mode)) continue;
    add(p.mode, Number(p.amount || 0));
  }

  // Refunds paid out — money OUT of the tender it left by.
  // Note: ipd_advances also carries a mirror 'refund' row for the same
  // disbursement (RefundApprovalsInbox writes it on approval). Only
  // refund_payables is read, or every refund would be subtracted twice.
  for (const r of input.refunds) {
    const amt = Number(r.amount || 0);
    totals.refunds += amt;
    add(r.mode, -amt);
  }

  // Advance deposits. syncAdvanceToBill mirrors these into bill_payments once a
  // draft IPD bill exists but skips silently when none does, so the deposit is
  // otherwise invisible. Dedupe PER MODE: the mirrored slice is already counted
  // above, the remainder is not.
  const deposited = sumByMode(input.advanceDeposits);
  const mirrored = sumByMode(input.mirroredAdvances);
  for (const [mode, amount] of Object.entries(deposited)) {
    const unmirrored = Math.max(0, amount - (mirrored[mode] || 0));
    if (unmirrored === 0) continue;
    totals.advances += unmirrored;
    add(mode, unmirrored);
  }

  // Buckets are already net of advances in and refunds out — adding those again
  // would double-count them.
  totals.total = totals.cash + totals.upi + totals.card + totals.cheque
    + totals.net_banking + totals.insurance + totals.other;

  return totals;
}
