/**
 * Phase 2 — extraction 3 (PHASED_TEST_PLAN.md §8, Phase 2).
 *
 * The plan names one case specifically: "underpayment where `approved_amount < claimed_amount`
 * stays visible in pending and raising a dispute does not zero it before resolution." That is
 * the assertion set this file is built around — a disputed shortfall that quietly disappears
 * from the dashboard is money the hospital stops chasing.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_PLAUSIBLE_SETTLEMENT_DAYS,
  computeClaimKpis,
  computeTpaPerformance,
  isPlausibleSettlement,
  settlementDays,
} from "@/lib/claimKpis";

const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T00:00:00.000Z`;

describe("settlementDays", () => {
  it("counts whole days between raising and payment", () => {
    expect(settlementDays(day(1), day(15))).toBe(14);
    expect(settlementDays(day(1), day(1))).toBe(0);
  });

  it("returns null when either end is missing or unparseable", () => {
    // Null, not 0. A missing payment date is "we do not know", and averaging it as a
    // same-day settlement would make every TPA look faster than it is.
    expect(settlementDays(null, day(5))).toBeNull();
    expect(settlementDays(day(5), null)).toBeNull();
    expect(settlementDays("not-a-date", day(5))).toBeNull();
    expect(settlementDays(day(5), "")).toBeNull();
  });

  it("returns a negative value when payment predates the claim", () => {
    // Surfaced rather than swallowed — it is a data error worth seeing, and
    // isPlausibleSettlement is what decides whether it enters an average.
    expect(settlementDays(day(15), day(1))).toBe(-14);
  });
});

describe("isPlausibleSettlement", () => {
  it("accepts same-day and anything under a year", () => {
    expect(isPlausibleSettlement(0)).toBe(true);
    expect(isPlausibleSettlement(364)).toBe(true);
  });

  it("rejects negatives, a year or more, and null", () => {
    expect(isPlausibleSettlement(-1)).toBe(false);
    expect(isPlausibleSettlement(MAX_PLAUSIBLE_SETTLEMENT_DAYS)).toBe(false);
    expect(isPlausibleSettlement(null)).toBe(false);
  });
});

describe("computeClaimKpis — the pending figure", () => {
  it("sums approved-but-unreconciled claims at the amount claimed", () => {
    const k = computeClaimKpis({
      pendingClaims: [{ claimed_amount: 50000 }, { claimed_amount: "25000" }],
    });
    expect(k.pendingAmount).toBe(75000);
    expect(k.pendingCount).toBe(2);
  });

  it("counts the full claimed amount, not the approved amount", () => {
    // THE CASE THE PLAN NAMES. A ₹1,00,000 claim approved at ₹80,000 is still ₹1,00,000
    // outstanding until the hospital accepts the shortfall — showing ₹80,000 would silently
    // write off the ₹20,000 it intends to dispute.
    const k = computeClaimKpis({ pendingClaims: [{ claimed_amount: 100000 }] });
    expect(k.pendingAmount).toBe(100000);
  });

  it("is zero with no pending claims, not null", () => {
    const k = computeClaimKpis({});
    expect(k.pendingAmount).toBe(0);
    expect(k.pendingCount).toBe(0);
  });
});

describe("computeClaimKpis — disputed underpayments", () => {
  it("sums the shortfall across disputed rows", () => {
    const k = computeClaimKpis({
      disputedUnderpayments: [
        { hospital_claimed_amount: 100000, tpa_paid_amount: 80000 },
        { hospital_claimed_amount: 50000, tpa_paid_amount: 45000 },
      ],
    });
    expect(k.underpaymentDisputed).toBe(25000);
    expect(k.underpaymentDisputedCount).toBe(2);
  });

  it("does not let an overpayment net off another claim's shortfall", () => {
    // Clamped per row, not on the total. A TPA that overpaid one claim by ₹30,000 must not
    // erase a genuine ₹20,000 shortfall on another — the hospital would dispute ₹0 and never
    // recover it.
    const k = computeClaimKpis({
      disputedUnderpayments: [
        { hospital_claimed_amount: 100000, tpa_paid_amount: 80000 }, // −20,000
        { hospital_claimed_amount: 50000, tpa_paid_amount: 80000 }, // +30,000
      ],
    });
    expect(k.underpaymentDisputed).toBe(20000);
  });

  it("keeps a disputed shortfall visible — raising a dispute does not zero it", () => {
    // The second half of the plan's case. The dispute is the act of chasing the money, so the
    // figure must persist while it is being chased, not disappear the moment it is raised.
    const k = computeClaimKpis({
      disputedUnderpayments: [{ hospital_claimed_amount: 100000, tpa_paid_amount: 80000 }],
    });
    expect(k.underpaymentDisputed).toBeGreaterThan(0);
    expect(k.underpaymentDisputedCount).toBe(1);
  });

  it("treats a missing paid amount as nothing received, not as fully paid", () => {
    const k = computeClaimKpis({
      disputedUnderpayments: [{ hospital_claimed_amount: 100000, tpa_paid_amount: null }],
    });
    expect(k.underpaymentDisputed).toBe(100000);
  });
});

describe("computeClaimKpis — settlement speed", () => {
  it("averages plausible settlement gaps", () => {
    const k = computeClaimKpis({
      settled: [
        { created_at: day(1), payment_date: day(11) }, // 10
        { created_at: day(1), payment_date: day(21) }, // 20
      ],
    });
    expect(k.avgSettlementDays).toBe(15);
    expect(k.settlementOutliersExcluded).toBe(0);
  });

  it("returns null rather than 0 when there is no settled history", () => {
    // "0 days" reads as instant payment on a dashboard. Null renders as "—".
    const k = computeClaimKpis({ settled: [] });
    expect(k.avgSettlementDays).toBeNull();
  });

  it("excludes implausible gaps AND reports how many were excluded", () => {
    // The original filter dropped these silently. A TPA whose advice dates are systematically
    // wrong would have shown a healthy average computed from the two rows that happened to
    // parse, with nothing on screen saying the rest were discarded.
    const k = computeClaimKpis({
      settled: [
        { created_at: day(1), payment_date: day(11) }, // 10 — kept
        { created_at: day(15), payment_date: day(1) }, // negative — dropped
        { created_at: day(1), payment_date: "2030-01-01T00:00:00.000Z" }, // >365 — dropped
        { created_at: day(1), payment_date: null }, // falls back to created_at → 0, kept
      ],
    });
    expect(k.avgSettlementDays).toBe(5); // (10 + 0) / 2
    expect(k.settlementOutliersExcluded).toBe(2);
  });

  it("falls back to created_at when payment_date is missing", () => {
    // Matches the original `r.payment_date ?? r.created_at`. Pinned because it means a
    // reconciled row with no advice date counts as a same-day settlement, which flatters the
    // average — worth knowing before anyone treats this KPI as an SLA measurement.
    const k = computeClaimKpis({ settled: [{ created_at: day(1), payment_date: null }] });
    expect(k.avgSettlementDays).toBe(0);
    expect(k.settlementOutliersExcluded).toBe(0);
  });
});

describe("computeClaimKpis — recovery rate", () => {
  it("is paid over claimed, as a whole percentage", () => {
    const k = computeClaimKpis({
      settled: [{ hospital_claimed_amount: 100000, tpa_paid_amount: 92000 }],
    });
    expect(k.recoveryRate).toBe(92);
  });

  it("is null rather than 0 when nothing was claimed", () => {
    // 0% recovery reads as a catastrophe. Null reads as "no data", which is what it is.
    expect(computeClaimKpis({ settled: [] }).recoveryRate).toBeNull();
    expect(computeClaimKpis({ settled: [{ hospital_claimed_amount: 0, tpa_paid_amount: 0 }] }).recoveryRate).toBeNull();
  });

  it("can exceed 100 when a TPA overpays", () => {
    // Not clamped: a recovery rate above 100% is a reconciliation error worth seeing, and
    // capping it at 100 would hide it.
    const k = computeClaimKpis({ settled: [{ hospital_claimed_amount: 100, tpa_paid_amount: 120 }] });
    expect(k.recoveryRate).toBe(120);
  });

  it("aggregates across rows rather than averaging per-row rates", () => {
    // A ₹10 claim paid in full and a ₹1,00,000 claim paid at 50% is 50.0% recovery, not 75%.
    // Averaging per-row rates would let one tiny claim mask a large shortfall.
    const k = computeClaimKpis({
      settled: [
        { hospital_claimed_amount: 10, tpa_paid_amount: 10 },
        { hospital_claimed_amount: 100000, tpa_paid_amount: 50000 },
      ],
    });
    expect(k.recoveryRate).toBe(50);
  });
});

describe("computeClaimKpis — money received", () => {
  it("sums what the TPA actually paid this month", () => {
    const k = computeClaimKpis({
      receivedThisMonth: [{ tpa_paid_amount: 40000 }, { tpa_paid_amount: "12500.50" }],
    });
    expect(k.receivedThisMonth).toBe(52500.5);
  });

  it("never produces NaN from an unparseable amount", () => {
    const k = computeClaimKpis({ receivedThisMonth: [{ tpa_paid_amount: "abc" }, { tpa_paid_amount: 100 }] });
    expect(k.receivedThisMonth).toBe(100);
  });
});

// ── Per-TPA performance ──────────────────────────────────────────────────────

describe("computeTpaPerformance", () => {
  const claims = [
    { id: "c1", tpa_name: "Star Health", claimed_amount: 100000, status: "approved" },
    { id: "c2", tpa_name: "Star Health", claimed_amount: 50000, status: "approved" },
    { id: "c3", tpa_name: "Star Health", claimed_amount: 20000, status: "rejected" },
    { id: "c4", tpa_name: "MediAssist", claimed_amount: 80000, status: "approved" },
  ];

  it("groups by TPA and sorts by claim volume", () => {
    const perf = computeTpaPerformance(claims, []);
    expect(perf.map((p) => p.tpa_name)).toEqual(["Star Health", "MediAssist"]);
    expect(perf[0].totalClaims).toBe(3);
    expect(perf[0].approvedClaims).toBe(2);
    expect(perf[0].approvalRate).toBe(67);
  });

  it("expresses underpayment against APPROVED claims, not total claims", () => {
    // A rejected claim was never going to be paid. Counting it in the denominator flatters
    // every TPA that rejects a lot — the opposite of what this table is for.
    const perf = computeTpaPerformance(claims, [
      { claim_id: "c1", hospital_claimed_amount: 100000, tpa_paid_amount: 80000 },
    ]);
    const star = perf.find((p) => p.tpa_name === "Star Health")!;
    expect(star.underpaymentCount).toBe(1);
    expect(star.underpaymentRate).toBe(50); // 1 of 2 approved, not 1 of 3 total
  });

  it("counts an exact-match payment as no underpayment", () => {
    const perf = computeTpaPerformance(
      [{ id: "c1", tpa_name: "T", claimed_amount: 100, status: "approved" }],
      [{ claim_id: "c1", hospital_claimed_amount: 100, tpa_paid_amount: 100 }],
    );
    expect(perf[0].underpaymentCount).toBe(0);
  });

  it("skips a claim with no TPA rather than inventing a payer", () => {
    // Bucketing these under "Unknown" would put a payer that does not exist into a
    // performance ranking a CFO uses to decide who to escalate to.
    const perf = computeTpaPerformance(
      [
        { id: "c1", tpa_name: null, claimed_amount: 100, status: "approved" },
        { id: "c2", tpa_name: "  ", claimed_amount: 100, status: "approved" },
        { id: "c3", tpa_name: "Real TPA", claimed_amount: 100, status: "approved" },
      ],
      [],
    );
    expect(perf.map((p) => p.tpa_name)).toEqual(["Real TPA"]);
  });

  it("returns null settlement days for a TPA that has never settled", () => {
    const perf = computeTpaPerformance(claims, []);
    expect(perf[0].avgSettlementDays).toBeNull();
  });

  it("averages only plausible settlement gaps per TPA", () => {
    const perf = computeTpaPerformance(
      [
        { id: "c1", tpa_name: "T", claimed_amount: 100, status: "approved" },
        { id: "c2", tpa_name: "T", claimed_amount: 100, status: "approved" },
      ],
      [
        { claim_id: "c1", created_at: day(1), payment_date: day(11) }, // 10
        { claim_id: "c2", created_at: day(15), payment_date: day(1) }, // negative, dropped
      ],
    );
    expect(perf[0].avgSettlementDays).toBe(10);
  });

  it("breaks a volume tie alphabetically so the order is stable", () => {
    // An unstable sort makes the table reshuffle between refreshes for no reason.
    const perf = computeTpaPerformance(
      [
        { id: "a", tpa_name: "Zeta", claimed_amount: 1, status: "approved" },
        { id: "b", tpa_name: "Alpha", claimed_amount: 1, status: "approved" },
      ],
      [],
    );
    expect(perf.map((p) => p.tpa_name)).toEqual(["Alpha", "Zeta"]);
  });

  it("ignores a reconciliation row that matches no claim", () => {
    const perf = computeTpaPerformance(claims, [{ claim_id: "unknown", tpa_paid_amount: 999999 }]);
    expect(perf.reduce((s, p) => s + p.totalPaid, 0)).toBe(0);
  });

  it("still counts a claim with no id, but attaches no reconciliation to it", () => {
    // It is a real claim for volume and approval-rate purposes; it simply cannot be matched
    // to a payment. Dropping it entirely would understate the TPA's claim count.
    const perf = computeTpaPerformance(
      [{ id: null, tpa_name: "T", claimed_amount: 500, status: "approved" }],
      [{ claim_id: "c1", tpa_paid_amount: 400, hospital_claimed_amount: 500 }],
    );
    expect(perf[0].totalClaims).toBe(1);
    expect(perf[0].totalClaimed).toBe(500);
    expect(perf[0].totalPaid).toBe(0);
    expect(perf[0].underpaymentCount).toBe(0);
  });

  it("handles null inputs", () => {
    expect(computeTpaPerformance(null, null)).toEqual([]);
    expect(computeTpaPerformance(undefined, undefined)).toEqual([]);
  });

  it("reports 0% approval for a TPA whose claims were all rejected", () => {
    const perf = computeTpaPerformance(
      [{ id: "c1", tpa_name: "T", claimed_amount: 100, status: "rejected" }],
      [],
    );
    expect(perf[0].approvalRate).toBe(0);
    expect(perf[0].underpaymentRate).toBe(0); // no division by zero
  });
});
