import { describe, it, expect } from "vitest";
import { computeDayClosureTotals, bucketForMode, type DayClosureInput } from "./dayClosureTotals";

/**
 * Day-closure reconciliation regression suite.
 *
 * The headline case is real data from "sriji hospitals" on 2026-07-16, which is
 * how the bug was reported: a ₹5,000 UPI advance showed UPI as ₹0, and a ₹3,500
 * cash refund was never deducted from Cash. Reference figures below are derived
 * from the actual money movement, not copied from the old output.
 */

const empty: DayClosureInput = { payments: [], refunds: [], advanceDeposits: [], mirroredAdvances: [] };

describe("computeDayClosureTotals — sriji 2026-07-16 (the reported bug)", () => {
  // Real rows: ₹5,000 UPI advance deposit (never mirrored to bill_payments),
  // ₹1,500 of it applied to the bill via 'advance_adjust', ₹3,500 refunded in
  // cash, plus ₹2,177 of ordinary cash bill payments.
  const input: DayClosureInput = {
    payments: [
      { mode: "cash", amount: 500 },
      { mode: "cash", amount: 500 },
      { mode: "cash", amount: 677 },
      { mode: "cash", amount: 500 },
      { mode: "advance_adjust", amount: 1500 },
    ],
    refunds: [{ mode: "cash", amount: 3500 }],
    advanceDeposits: [{ mode: "upi", amount: 5000 }],
    mirroredAdvances: [{ mode: "advance_adjust", amount: 1500 }],
  };
  const t = computeDayClosureTotals(input);

  it("puts the ₹5,000 UPI advance in UPI (was ₹0)", () => {
    expect(t.upi).toBe(5000);
  });

  it("deducts the ₹3,500 cash refund from Cash, which goes negative", () => {
    // ₹2,177 in − ₹3,500 out. Net cash movement is genuinely negative.
    expect(t.cash).toBe(-1323);
  });

  it("keeps 'advance_adjust' out of the drawer entirely (was ₹1,500 in Other)", () => {
    expect(t.other).toBe(0);
  });

  it("still totals ₹3,677 — the one figure the old code got right", () => {
    // 5000 UPI in + 2177 cash in − 3500 cash out.
    expect(t.total).toBe(3677);
  });

  it("reports advances/refunds for display without double-counting them", () => {
    // The whole ₹5,000 is unmirrored: bill_payments has no UPI tender row for it.
    // The old code reported ₹3,500 here only because it counted the ₹1,500
    // 'advance_adjust' as a mirrored *receipt* of the deposit — it is an
    // application of it, which is a different thing entirely.
    expect(t.advances).toBe(5000);
    expect(t.refunds).toBe(3500);
    // Grand total is the sum of the buckets alone.
    expect(t.total).toBe(t.cash + t.upi + t.card + t.cheque + t.net_banking + t.insurance + t.other);
  });
});

describe("computeDayClosureTotals — advance mirroring dedupe", () => {
  it("does not double-count an advance already mirrored into bill_payments", () => {
    // The other hospital's shape: the UPI advance WAS mirrored, so bill_payments
    // already carries it and ipd_advances must not add it again.
    const t = computeDayClosureTotals({
      ...empty,
      payments: [{ mode: "upi", amount: 5000 }],
      advanceDeposits: [{ mode: "upi", amount: 5000 }],
      mirroredAdvances: [{ mode: "upi", amount: 5000 }],
    });
    expect(t.upi).toBe(5000);
    expect(t.advances).toBe(0);
    expect(t.total).toBe(5000);
  });

  it("counts only the unmirrored remainder when an advance is partly mirrored", () => {
    const t = computeDayClosureTotals({
      ...empty,
      payments: [{ mode: "upi", amount: 2000 }],
      advanceDeposits: [{ mode: "upi", amount: 5000 }],
      mirroredAdvances: [{ mode: "upi", amount: 2000 }],
    });
    expect(t.upi).toBe(5000); // 2000 counted via payments + 3000 remainder
    expect(t.advances).toBe(3000);
  });

  it("dedupes per mode — a mirrored cash advance must not mask an unmirrored UPI one", () => {
    // The old global sum-difference would have cancelled these against each other.
    const t = computeDayClosureTotals({
      ...empty,
      payments: [{ mode: "cash", amount: 4000 }],
      advanceDeposits: [{ mode: "cash", amount: 4000 }, { mode: "upi", amount: 6000 }],
      mirroredAdvances: [{ mode: "cash", amount: 4000 }],
    });
    expect(t.cash).toBe(4000);
    expect(t.upi).toBe(6000);
    expect(t.advances).toBe(6000);
    expect(t.total).toBe(10000);
  });
});

describe("computeDayClosureTotals — refunds by mode", () => {
  it("subtracts each refund from its own tender", () => {
    const t = computeDayClosureTotals({
      ...empty,
      payments: [{ mode: "cash", amount: 5000 }, { mode: "upi", amount: 5000 }],
      refunds: [{ mode: "upi", amount: 1000 }],
    });
    expect(t.cash).toBe(5000);
    expect(t.upi).toBe(4000);
    expect(t.total).toBe(9000);
  });

  it("counts a refund once — the ipd_advances mirror row is not an input", () => {
    const t = computeDayClosureTotals({
      ...empty,
      payments: [{ mode: "cash", amount: 5000 }],
      refunds: [{ mode: "cash", amount: 3500 }],
    });
    expect(t.refunds).toBe(3500);
    expect(t.cash).toBe(1500);
  });
});

describe("bucketForMode", () => {
  it.each([
    ["cash", "cash"], ["upi", "upi"], ["card", "card"],
    ["cheque", "cheque"], ["net_banking", "net_banking"],
    ["insurance", "insurance"], ["pmjay", "insurance"], ["cghs", "insurance"], ["echs", "insurance"],
  ])("%s → %s", (mode, bucket) => {
    expect(bucketForMode(mode)).toBe(bucket);
  });

  it("is case-insensitive", () => {
    expect(bucketForMode("UPI")).toBe("upi");
    expect(bucketForMode("Cash")).toBe("cash");
  });

  it("falls back to 'other' for unknown and null modes", () => {
    expect(bucketForMode("crypto")).toBe("other");
    expect(bucketForMode(null)).toBe("other");
  });
});
