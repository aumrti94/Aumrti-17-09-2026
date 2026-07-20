import { describe, it, expect } from "vitest";
import { computeNetAdvance, filterUnmirroredReceipts } from "./advanceLedger";

describe("computeNetAdvance", () => {
  it("adds already-applied advance back as credit", () => {
    // billMoney's patientPayable is gross of advance, so advance debited to the
    // bill is still a credit. Omitting totalDebited under-credited the patient
    // by exactly the amount already applied.
    expect(computeNetAdvance({ viewBalance: 5000, totalDebited: 15000, unmirroredReceipts: 0 })).toBe(20000);
  });

  it("includes legacy unmirrored receipts", () => {
    expect(computeNetAdvance({ viewBalance: 2000, totalDebited: 0, unmirroredReceipts: 3000 })).toBe(5000);
  });

  it("treats missing values as zero", () => {
    expect(computeNetAdvance({ viewBalance: null, totalDebited: undefined, unmirroredReceipts: "" })).toBe(0);
  });

  it("coerces string amounts", () => {
    expect(computeNetAdvance({ viewBalance: "1000", totalDebited: "500", unmirroredReceipts: 0 })).toBe(1500);
  });
});

describe("filterUnmirroredReceipts", () => {
  it("drops receipts already mirrored into ipd_advances", () => {
    const receipts = [
      { receipt_number: "ADV-1", amount: 10000 },
      { receipt_number: "ADV-2", amount: 5000 },
    ];
    const kept = filterUnmirroredReceipts(receipts, ["ADV-1"]);
    expect(kept).toEqual([{ receipt_number: "ADV-2", amount: 5000 }]);
  });

  it("keeps everything when nothing is mirrored", () => {
    const receipts = [{ receipt_number: "ADV-1", amount: 100 }];
    expect(filterUnmirroredReceipts(receipts, [])).toHaveLength(1);
  });

  it("ignores null entries in the mirrored list", () => {
    const receipts = [{ receipt_number: "ADV-1", amount: 100 }];
    expect(filterUnmirroredReceipts(receipts, [null, undefined])).toHaveLength(1);
  });

  it("keeps receipts with no receipt_number rather than silently dropping money", () => {
    const receipts = [{ receipt_number: null, amount: 100 }];
    expect(filterUnmirroredReceipts(receipts, ["ADV-1"])).toHaveLength(1);
  });

  it("counts a deposit once when it exists in both ledgers", () => {
    // The double-count this guards: the same ₹20,000 appearing as an
    // advance_receipts row AND an ipd_advances row.
    const receipts = [{ receipt_number: "ADV-9", amount: 20000 }];
    const total = filterUnmirroredReceipts(receipts, ["ADV-9"]).reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(0);
  });
});
