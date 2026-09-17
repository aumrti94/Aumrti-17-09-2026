/**
 * Insurance claim KPIs — the calculation, split from the presentation.
 *
 * WHY. `pendingAmount`, `avgSettlementDays`, `recoveryRate` and the whole per-TPA
 * performance table were computed inline inside `PaymentReconciliation.tsx`'s `loadKPIs` and
 * `loadTpaPerformance`, interleaved with the queries that fetch their inputs. These are the
 * numbers a CFO reads to decide which TPA to escalate and how much cash to expect this
 * month — the same calculation/presentation split `billTotals.ts` already establishes for
 * bills applies here.
 *
 * Every function below takes rows and returns numbers. No Supabase, no clock reads except
 * where a `now` is passed in explicitly.
 */

export interface PendingClaimRow {
  claimed_amount?: number | string | null;
}

export interface ReconciliationRow {
  tpa_paid_amount?: number | string | null;
  hospital_claimed_amount?: number | string | null;
  payment_date?: string | null;
  created_at?: string | null;
}

export interface ClaimKpis {
  /** Approved but unreconciled, at the amount claimed. */
  pendingAmount: number;
  pendingCount: number;
  receivedThisMonth: number;
  /** Sum of (claimed − paid) across disputed underpayments. Never negative. */
  underpaymentDisputed: number;
  underpaymentDisputedCount: number;
  /** Null — not 0 — when there is no settled history to average. */
  avgSettlementDays: number | null;
  /** Null — not 0 — when nothing has been claimed. */
  recoveryRate: number | null;
  /**
   * How many settled rows were excluded from avgSettlementDays as implausible.
   *
   * The original filter silently dropped negative and >365-day gaps. Silently is the
   * problem: a TPA whose advice dates are systematically wrong would show a healthy average
   * computed from the handful of rows that happened to parse, with nothing on screen saying
   * most of the data was discarded.
   */
  settlementOutliersExcluded: number;
}

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const sum = (rows: unknown[] | null | undefined, pick: (r: never) => unknown): number =>
  (rows ?? []).reduce<number>((s, r) => s + num(pick(r as never)), 0);

/** Settlement gaps outside this range are treated as data errors, not performance. */
export const MAX_PLAUSIBLE_SETTLEMENT_DAYS = 365;

/** Whole days between two ISO timestamps, or null when either is unusable. */
export function settlementDays(createdAt: string | null | undefined, paymentDate: string | null | undefined): number | null {
  if (!createdAt || !paymentDate) return null;
  const from = Date.parse(createdAt);
  const to = Date.parse(paymentDate);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

/** True when a settlement gap is usable for an average. */
export function isPlausibleSettlement(days: number | null): days is number {
  return days !== null && days >= 0 && days < MAX_PLAUSIBLE_SETTLEMENT_DAYS;
}

export interface ClaimKpiInput {
  /** status = approved AND reconciled = false. */
  pendingClaims?: PendingClaimRow[] | null;
  /** payment_date within the current month. */
  receivedThisMonth?: ReconciliationRow[] | null;
  /** dispute_raised = true AND reconciled = false. */
  disputedUnderpayments?: ReconciliationRow[] | null;
  /** reconciled = true. Drives the average and the recovery rate. */
  settled?: ReconciliationRow[] | null;
}

export function computeClaimKpis(input: ClaimKpiInput): ClaimKpis {
  const pendingAmount = sum(input.pendingClaims, (r: PendingClaimRow) => r.claimed_amount);
  const pendingCount = (input.pendingClaims ?? []).length;
  const receivedThisMonth = sum(input.receivedThisMonth, (r: ReconciliationRow) => r.tpa_paid_amount);

  const disputed = input.disputedUnderpayments ?? [];
  // Clamped at zero per row, not on the total: a TPA that OVERPAID one claim must not net
  // off another claim's genuine shortfall, or the figure the hospital disputes is too low.
  const underpaymentDisputed = disputed.reduce(
    (s, r) => s + Math.max(0, num(r.hospital_claimed_amount) - num(r.tpa_paid_amount)),
    0,
  );

  const settled = input.settled ?? [];
  const allDays = settled.map((r) => settlementDays(r.created_at, r.payment_date ?? r.created_at));
  const plausible = allDays.filter(isPlausibleSettlement);

  const avgSettlementDays = plausible.length
    ? Math.round(plausible.reduce((a, b) => a + b, 0) / plausible.length)
    : null;

  const totalClaimed = sum(settled, (r: ReconciliationRow) => r.hospital_claimed_amount);
  const totalPaid = sum(settled, (r: ReconciliationRow) => r.tpa_paid_amount);
  const recoveryRate = totalClaimed > 0 ? Math.round((totalPaid / totalClaimed) * 100) : null;

  return {
    pendingAmount,
    pendingCount,
    receivedThisMonth,
    underpaymentDisputed,
    underpaymentDisputedCount: disputed.length,
    avgSettlementDays,
    recoveryRate,
    settlementOutliersExcluded: settled.length - plausible.length,
  };
}

// ── Per-TPA performance ──────────────────────────────────────────────────────

export interface ClaimRow {
  id?: string | null;
  tpa_name?: string | null;
  claimed_amount?: number | string | null;
  status?: string | null;
}

export interface TpaReconciliationRow extends ReconciliationRow {
  claim_id?: string | null;
}

export interface TpaPerformance {
  tpa_name: string;
  totalClaims: number;
  approvedClaims: number;
  approvalRate: number;
  avgSettlementDays: number | null;
  totalClaimed: number;
  totalPaid: number;
  underpaymentCount: number;
  underpaymentRate: number;
}

/**
 * Per-TPA performance, sorted by claim volume.
 *
 * `underpaymentRate` is expressed against APPROVED claims, not total claims: a rejected claim
 * was never going to be paid, so counting it in the denominator flatters every TPA that
 * rejects a lot.
 */
export function computeTpaPerformance(
  claims: ClaimRow[] | null | undefined,
  reconciliations: TpaReconciliationRow[] | null | undefined,
): TpaPerformance[] {
  const reconByClaim = new Map<string, TpaReconciliationRow>();
  for (const r of reconciliations ?? []) {
    if (r?.claim_id) reconByClaim.set(r.claim_id, r);
  }

  const byTpa = new Map<
    string,
    { total: number; approved: number; claimed: number; paid: number; days: number[]; underpay: number }
  >();

  for (const c of claims ?? []) {
    const name = c?.tpa_name?.trim();
    // A claim with no TPA cannot be attributed. Bucketing it under "Unknown" would invent a
    // payer that does not exist and put it in a performance ranking.
    if (!name) continue;

    let t = byTpa.get(name);
    if (!t) {
      t = { total: 0, approved: 0, claimed: 0, paid: 0, days: [], underpay: 0 };
      byTpa.set(name, t);
    }

    t.total += 1;
    t.claimed += num(c.claimed_amount);
    if (c.status === "approved") t.approved += 1;

    const rc = c.id ? reconByClaim.get(c.id) : undefined;
    if (!rc) continue;

    const paid = num(rc.tpa_paid_amount);
    const claimed = num(rc.hospital_claimed_amount);
    t.paid += paid;
    if (claimed > paid) t.underpay += 1;

    const days = settlementDays(rc.created_at, rc.payment_date);
    if (isPlausibleSettlement(days)) t.days.push(days);
  }

  return [...byTpa.entries()]
    .map(([tpa_name, t]) => ({
      tpa_name,
      totalClaims: t.total,
      approvedClaims: t.approved,
      approvalRate: t.total > 0 ? Math.round((t.approved / t.total) * 100) : 0,
      avgSettlementDays: t.days.length ? Math.round(t.days.reduce((a, b) => a + b, 0) / t.days.length) : null,
      totalClaimed: t.claimed,
      totalPaid: t.paid,
      underpaymentCount: t.underpay,
      underpaymentRate: t.approved > 0 ? Math.round((t.underpay / t.approved) * 100) : 0,
    }))
    .sort((a, b) => b.totalClaims - a.totalClaims || a.tpa_name.localeCompare(b.tpa_name));
}
