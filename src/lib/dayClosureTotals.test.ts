/**
 * Phase 1 (PHASED_TEST_PLAN.md §8) — pure money aggregation.
 *
 * A day closure answers one question per tender: how much of it physically moved today? The
 * per-mode figures are the ones a supervisor physically counts against a drawer, so "the
 * grand total came out right" is not an assertion — the documented defect here had a correct
 * grand total and wrong per-mode figures, which is the harder failure to notice.
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_TOTALS,
  INTERNAL_TRANSFER_MODE,
  UNATTRIBUTED_KEY,
  UNATTRIBUTED_LABEL,
  bucketForMode,
  computeDayClosureTotals,
  groupTotalsByCashier,
  type DayClosureInput,
  type SystemTotals,
} from "@/lib/dayClosureTotals";

const empty: DayClosureInput = { payments: [], refunds: [], advanceDeposits: [], mirroredAdvances: [] };
const input = (partial: Partial<DayClosureInput>): DayClosureInput => ({ ...empty, ...partial });

describe("bucketForMode", () => {
  it.each([
    ["cash", "cash"],
    ["upi", "upi"],
    ["card", "card"],
    ["cheque", "cheque"],
    ["net_banking", "net_banking"],
  ])("%s maps to the %s bucket", (mode, bucket) => {
    expect(bucketForMode(mode)).toBe(bucket);
  });

  it.each(["insurance", "pmjay", "cghs", "echs"])("%s maps to the insurance bucket", (mode) => {
    // Scheme settlements are not cash in a drawer; pooling them keeps the countable tenders
    // countable.
    expect(bucketForMode(mode)).toBe("insurance");
  });

  it("matches case-insensitively", () => {
    expect(bucketForMode("CASH")).toBe("cash");
    expect(bucketForMode("Net_Banking")).toBe("net_banking");
  });

  it("sends anything unrecognised to 'other' rather than dropping it", () => {
    // A mode nobody anticipated must still appear in the closure. Dropping it makes the
    // system total disagree with the takings by exactly that amount, silently.
    expect(bucketForMode("wallet")).toBe("other");
    expect(bucketForMode("razorpay")).toBe("other");
    expect(bucketForMode(null)).toBe("other");
    expect(bucketForMode("")).toBe("other");
  });
});

describe("computeDayClosureTotals — receipts", () => {
  it("returns all zeroes for a day with no activity", () => {
    expect(computeDayClosureTotals(empty)).toEqual(EMPTY_TOTALS);
  });

  it("does not mutate EMPTY_TOTALS", () => {
    // It is a module-level singleton spread into every result; mutating it would corrupt
    // every subsequent closure for the life of the process.
    computeDayClosureTotals(input({ payments: [{ mode: "cash", amount: 5000 }] }));
    expect(EMPTY_TOTALS.cash).toBe(0);
    expect(EMPTY_TOTALS.total).toBe(0);
  });

  it("banks each receipt in its own tender bucket", () => {
    const t = computeDayClosureTotals(
      input({ payments: [{ mode: "cash", amount: 1000 }, { mode: "upi", amount: 500 }, { mode: "card", amount: 250 }] }),
    );
    expect(t.cash).toBe(1000);
    expect(t.upi).toBe(500);
    expect(t.card).toBe(250);
    expect(t.total).toBe(1750);
  });

  it("excludes advance_adjust — it moves no money", () => {
    // Applying an already-collected advance to a bill is not a tender. Counting it as a
    // receipt double-counts the original deposit.
    const t = computeDayClosureTotals(
      input({ payments: [{ mode: "cash", amount: 1000 }, { mode: INTERNAL_TRANSFER_MODE, amount: 9999 }] }),
    );
    expect(t.cash).toBe(1000);
    expect(t.total).toBe(1000);
  });

  it("accumulates several deposits of the same mode before deduping", () => {
    const t = computeDayClosureTotals(
      input({
        advanceDeposits: [
          { mode: "cash", amount: 3000 },
          { mode: "cash", amount: 2000 },
          { mode: "cash", amount: null as unknown as number },
        ],
        mirroredAdvances: [
          { mode: "cash", amount: 1000 },
          { mode: "cash", amount: 500 },
        ],
      }),
    );
    expect(t.advances).toBe(3500); // (3000 + 2000 + 0) − (1000 + 500)
    expect(t.cash).toBe(3500);
  });

  it("treats a refund with no amount as zero rather than NaN", () => {
    // One NaN anywhere turns the whole closure into "NaN" on screen and the supervisor
    // cannot reconcile anything.
    const t = computeDayClosureTotals(
      input({
        payments: [{ mode: "cash", amount: 1000 }],
        refunds: [{ mode: "cash", amount: null as unknown as number }],
      }),
    );
    expect(t.cash).toBe(1000);
    expect(t.refunds).toBe(0);
    expect(Number.isNaN(t.total)).toBe(false);
  });

  it("coerces string and null amounts", () => {
    const t = computeDayClosureTotals(
      input({ payments: [{ mode: "cash", amount: "1000" as unknown as number }, { mode: "cash", amount: null as unknown as number }] }),
    );
    expect(t.cash).toBe(1000);
  });
});

describe("computeDayClosureTotals — refunds go out of the tender they left by", () => {
  it("subtracts a cash refund from the cash bucket", () => {
    // The documented defect: a ₹3,500 cash refund never came off Cash, so the drawer count
    // was ₹3,500 short against a system figure that looked right in total.
    const t = computeDayClosureTotals(
      input({ payments: [{ mode: "cash", amount: 5000 }], refunds: [{ mode: "cash", amount: 3500 }] }),
    );
    expect(t.cash).toBe(1500);
    expect(t.refunds).toBe(3500);
    expect(t.total).toBe(1500);
  });

  it("subtracts from the refund's own mode, not from cash by default", () => {
    const t = computeDayClosureTotals(
      input({
        payments: [{ mode: "cash", amount: 5000 }, { mode: "upi", amount: 5000 }],
        refunds: [{ mode: "upi", amount: 2000 }],
      }),
    );
    expect(t.cash).toBe(5000);
    expect(t.upi).toBe(3000);
    expect(t.total).toBe(8000);
  });

  it("allows a bucket to go negative when more went out than came in", () => {
    // A refund of yesterday's payment is a real event. Clamping to zero would hide a genuine
    // net outflow and make the closure un-reconcilable.
    const t = computeDayClosureTotals(input({ refunds: [{ mode: "cash", amount: 1000 }] }));
    expect(t.cash).toBe(-1000);
    expect(t.total).toBe(-1000);
  });

  it("reports refunds informationally without double-counting them in the total", () => {
    const t = computeDayClosureTotals(
      input({ payments: [{ mode: "cash", amount: 5000 }], refunds: [{ mode: "cash", amount: 3500 }] }),
    );
    expect(t.refunds).toBe(3500);
    expect(t.total).toBe(t.cash + t.upi + t.card + t.cheque + t.net_banking + t.insurance + t.other);
  });
});

describe("computeDayClosureTotals — advance deposits", () => {
  it("counts an unmirrored deposit in its own mode", () => {
    // The other half of the documented defect: a ₹5,000 UPI advance left UPI reading ₹0
    // because advances were a lump sum with no mode attribution.
    const t = computeDayClosureTotals(input({ advanceDeposits: [{ mode: "upi", amount: 5000 }] }));
    expect(t.upi).toBe(5000);
    expect(t.advances).toBe(5000);
    expect(t.total).toBe(5000);
  });

  it("does not double-count a deposit that was already mirrored into bill_payments", () => {
    const t = computeDayClosureTotals(
      input({
        payments: [{ mode: "upi", amount: 5000 }],
        advanceDeposits: [{ mode: "upi", amount: 5000 }],
        mirroredAdvances: [{ mode: "upi", amount: 5000 }],
      }),
    );
    expect(t.upi).toBe(5000);
    expect(t.advances).toBe(0);
    expect(t.total).toBe(5000);
  });

  it("counts only the unmirrored remainder when a deposit is partly mirrored", () => {
    const t = computeDayClosureTotals(
      input({
        payments: [{ mode: "cash", amount: 4000 }],
        advanceDeposits: [{ mode: "cash", amount: 10000 }],
        mirroredAdvances: [{ mode: "cash", amount: 4000 }],
      }),
    );
    expect(t.cash).toBe(10000);
    expect(t.advances).toBe(6000);
  });

  it("dedupes PER MODE, so a cash mirror cannot cancel a UPI deposit", () => {
    // The reason sumByMode exists. Deduping on a lump sum would let unrelated modes cancel.
    const t = computeDayClosureTotals(
      input({
        payments: [{ mode: "cash", amount: 5000 }],
        advanceDeposits: [{ mode: "upi", amount: 5000 }],
        mirroredAdvances: [{ mode: "cash", amount: 5000 }],
      }),
    );
    expect(t.cash).toBe(5000);
    expect(t.upi).toBe(5000);
    expect(t.advances).toBe(5000);
    expect(t.total).toBe(10000);
  });

  it("never lets an over-mirror produce a negative advance", () => {
    const t = computeDayClosureTotals(
      input({
        advanceDeposits: [{ mode: "cash", amount: 1000 }],
        mirroredAdvances: [{ mode: "cash", amount: 4000 }],
      }),
    );
    expect(t.advances).toBe(0);
    expect(t.cash).toBe(0);
  });

  it("ignores an advance_adjust mirror row so it cannot cancel a real deposit", () => {
    // An advance_adjust row is a mirror of an application, not of a deposit. Letting it
    // dedupe would erase a deposit that genuinely came in today.
    const t = computeDayClosureTotals(
      input({
        advanceDeposits: [{ mode: "cash", amount: 5000 }],
        mirroredAdvances: [{ mode: INTERNAL_TRANSFER_MODE, amount: 5000 }],
      }),
    );
    expect(t.cash).toBe(5000);
    expect(t.advances).toBe(5000);
  });

  it("ignores an advance_adjust DEPOSIT row too", () => {
    const t = computeDayClosureTotals(
      input({ advanceDeposits: [{ mode: INTERNAL_TRANSFER_MODE, amount: 5000 }] }),
    );
    expect(t.advances).toBe(0);
    expect(t.total).toBe(0);
  });

  it("buckets a deposit with no mode into 'other' and still dedupes it", () => {
    const both = computeDayClosureTotals(
      input({ advanceDeposits: [{ mode: null, amount: 800 }], mirroredAdvances: [{ mode: null, amount: 800 }] }),
    );
    expect(both.other).toBe(0);
    const unmirrored = computeDayClosureTotals(input({ advanceDeposits: [{ mode: null, amount: 800 }] }));
    expect(unmirrored.other).toBe(800);
  });
});

describe("computeDayClosureTotals — the grand total", () => {
  it("is the sum of the tender buckets and nothing else", () => {
    const t = computeDayClosureTotals(
      input({
        payments: [{ mode: "cash", amount: 12000 }, { mode: "pmjay", amount: 30000 }],
        refunds: [{ mode: "cash", amount: 2000 }],
        advanceDeposits: [{ mode: "upi", amount: 5000 }],
      }),
    );
    expect(t.cash).toBe(10000);
    expect(t.insurance).toBe(30000);
    expect(t.upi).toBe(5000);
    expect(t.total).toBe(45000);
    // refunds and advances are informational, already inside the buckets above
    expect(t.refunds).toBe(2000);
    expect(t.advances).toBe(5000);
    expect(t.total).not.toBe(45000 + 5000 - 2000);
  });
});

// ── Per-cashier breakdown ─────────────────────────────────────────────────────

const sumTotals = (rows: SystemTotals[], key: keyof SystemTotals) =>
  rows.reduce((s, r) => s + (r[key] as number), 0);

describe("groupTotalsByCashier", () => {
  const ASHA = "aaaaaaaa-0000-4000-8000-000000000001";
  const BHAVANI = "bbbbbbbb-0000-4000-8000-000000000002";

  it("splits the same rows by the user who took them", () => {
    // The single hospital-wide total cannot tell you how much cash each drawer should hold.
    const out = groupTotalsByCashier({
      payments: [
        { mode: "cash", amount: 1000, cashierId: ASHA, cashierName: "Asha Reddy" },
        { mode: "cash", amount: 400, cashierId: BHAVANI, cashierName: "Bhavani Rao" },
        { mode: "upi", amount: 600, cashierId: ASHA, cashierName: "Asha Reddy" },
      ],
      refunds: [],
      advanceDeposits: [],
      mirroredAdvances: [],
    });
    expect(out).toHaveLength(2);
    const asha = out.find((g) => g.cashierId === ASHA)!;
    expect(asha.cashierName).toBe("Asha Reddy");
    expect(asha.totals.cash).toBe(1000);
    expect(asha.totals.upi).toBe(600);
    expect(asha.totals.total).toBe(1600);
  });

  it("pools rows with no collector and sorts that group last", () => {
    const out = groupTotalsByCashier({
      payments: [
        { mode: "card", amount: 700, cashierId: null },
        { mode: "cash", amount: 100, cashierId: BHAVANI, cashierName: "Bhavani Rao" },
      ],
      refunds: [],
      advanceDeposits: [],
      mirroredAdvances: [],
    });
    expect(out[out.length - 1].cashierId).toBeNull();
    expect(out[out.length - 1].cashierName).toBe(UNATTRIBUTED_LABEL);
    expect(out[out.length - 1].totals.card).toBe(700);
  });

  it("sorts named collectors alphabetically", () => {
    const out = groupTotalsByCashier({
      payments: [
        { mode: "cash", amount: 1, cashierId: BHAVANI, cashierName: "Bhavani Rao" },
        { mode: "cash", amount: 1, cashierId: ASHA, cashierName: "Asha Reddy" },
        { mode: "cash", amount: 1, cashierId: null },
      ],
      refunds: [],
      advanceDeposits: [],
      mirroredAdvances: [],
    });
    expect(out.map((g) => g.cashierName)).toEqual(["Asha Reddy", "Bhavani Rao", UNATTRIBUTED_LABEL]);
  });

  it("upgrades 'Unknown user' when the name arrives on a later row", () => {
    const out = groupTotalsByCashier({
      payments: [
        { mode: "cash", amount: 100, cashierId: ASHA },
        { mode: "cash", amount: 100, cashierId: ASHA, cashierName: "Asha Reddy" },
      ],
      refunds: [],
      advanceDeposits: [],
      mirroredAdvances: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].cashierName).toBe("Asha Reddy");
    expect(out[0].totals.cash).toBe(200);
  });

  it("falls back to 'Unknown user' for an id with no name anywhere", () => {
    const out = groupTotalsByCashier({
      payments: [{ mode: "cash", amount: 100, cashierId: ASHA, cashierName: "   " }],
      refunds: [],
      advanceDeposits: [],
      mirroredAdvances: [],
    });
    expect(out[0].cashierName).toBe("Unknown user");
  });

  it("uses a reserved key for the unattributed pool that cannot collide with a user id", () => {
    expect(UNATTRIBUTED_KEY).toBe("__unattributed__");
  });

  it("applies the same net computation per cashier — refunds come off that cashier's drawer", () => {
    const out = groupTotalsByCashier({
      payments: [{ mode: "cash", amount: 5000, cashierId: ASHA, cashierName: "Asha Reddy" }],
      refunds: [{ mode: "cash", amount: 1500, cashierId: ASHA, cashierName: "Asha Reddy" }],
      advanceDeposits: [],
      mirroredAdvances: [],
    });
    expect(out[0].totals.cash).toBe(3500);
    expect(out[0].totals.refunds).toBe(1500);
  });

  it("returns an empty array for a day with no rows", () => {
    expect(groupTotalsByCashier({ payments: [], refunds: [], advanceDeposits: [], mirroredAdvances: [] })).toEqual([]);
  });
});

describe("the documented per-cashier invariant", () => {
  const ASHA = "aaaaaaaa-0000-4000-8000-000000000001";
  const BHAVANI = "bbbbbbbb-0000-4000-8000-000000000002";

  it("sums back to the hospital-wide total when deposit and mirror share a group", () => {
    // The invariant stated in the module: per-cashier totals reconcile to
    // computeDayClosureTotals over the same rows. This is what makes the breakdown usable
    // as a reconciliation tool rather than just a display.
    const rows = {
      payments: [
        { mode: "cash", amount: 12000, cashierId: ASHA, cashierName: "Asha Reddy" },
        { mode: "upi", amount: 3000, cashierId: BHAVANI, cashierName: "Bhavani Rao" },
        { mode: "card", amount: 900, cashierId: null },
      ],
      refunds: [{ mode: "cash", amount: 2000, cashierId: ASHA, cashierName: "Asha Reddy" }],
      // Deposit and its mirror both unattributed — the condition the invariant depends on.
      advanceDeposits: [{ mode: "upi", amount: 8000, cashierId: null }],
      mirroredAdvances: [{ mode: "upi", amount: 5000, cashierId: null }],
    };

    const global = computeDayClosureTotals(rows);
    const perCashier = groupTotalsByCashier(rows).map((g) => g.totals);

    for (const key of ["cash", "upi", "card", "cheque", "net_banking", "insurance", "other", "refunds", "advances", "total"] as const) {
      expect(sumTotals(perCashier, key), key).toBe(global[key]);
    }
  });

  it("breaks when a deposit and its mirror land in DIFFERENT groups — the stated limitation", () => {
    // The module says the invariant holds "as long as a deposit and its mirror row land in
    // the SAME group". Asserted explicitly so the condition is a tested contract rather than
    // a comment: if a future change starts attributing deposits to a collector, the mirror
    // must be attributed the same way or the breakdown stops reconciling.
    const rows = {
      payments: [],
      refunds: [],
      advanceDeposits: [{ mode: "upi", amount: 5000, cashierId: ASHA, cashierName: "Asha Reddy" }],
      mirroredAdvances: [{ mode: "upi", amount: 5000, cashierId: null }],
    };

    const global = computeDayClosureTotals(rows);
    const perCashier = groupTotalsByCashier(rows).map((g) => g.totals);

    expect(global.advances).toBe(0); // globally deduped
    expect(sumTotals(perCashier, "advances")).toBe(5000); // per-cashier, not deduped
    expect(sumTotals(perCashier, "total")).not.toBe(global.total);
  });
});
