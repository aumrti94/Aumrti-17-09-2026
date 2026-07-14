import { describe, it, expect } from "vitest";
import {
  assetAccountFor,
  buildAcquisitionLines,
  buildOpeningLines,
  buildDisposalLines,
} from "./assetPosting";

function totals(lines: { debit?: number; credit?: number }[]) {
  const debit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const credit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  return { debit, credit };
}

describe("assetAccountFor", () => {
  it("maps every category to a seeded asset account", () => {
    expect(assetAccountFor("medical_equipment")).toBe("1101");
    expect(assetAccountFor("furniture")).toBe("1102");
    expect(assetAccountFor("it_equipment")).toBe("1103");
    expect(assetAccountFor("vehicle")).toBe("1104");
    expect(assetAccountFor("building")).toBe("1105");
    expect(assetAccountFor("land")).toBe("1105");
  });

  it("falls back to medical equipment for an unknown category", () => {
    expect(assetAccountFor("unknown_category")).toBe("1101");
  });
});

describe("buildAcquisitionLines", () => {
  it("debits the asset account and credits the funding source, balanced", () => {
    const lines = buildAcquisitionLines("1101", 500000, "1002", "MRI Machine");
    expect(totals(lines)).toEqual({ debit: 500000, credit: 500000 });
    expect(lines[0]).toMatchObject({ accountCode: "1101", debit: 500000 });
    expect(lines[1]).toMatchObject({ accountCode: "1002", credit: 500000 });
  });
});

describe("buildOpeningLines", () => {
  it("splits cost between accumulated depreciation and capital, balanced", () => {
    const lines = buildOpeningLines("1101", 100000, 40000, "Old X-Ray Machine");
    expect(totals(lines)).toEqual({ debit: 100000, credit: 100000 });
    const capitalLine = lines.find((l) => l.accountCode === "3001");
    expect(capitalLine?.credit).toBe(60000); // net book value
    const depLine = lines.find((l) => l.accountCode === "1110");
    expect(depLine?.credit).toBe(40000);
  });

  it("omits the accumulated-dep line for a brand-new opening asset", () => {
    const lines = buildOpeningLines("1101", 50000, 0, "New Bed");
    expect(lines.find((l) => l.accountCode === "1110")).toBeUndefined();
    expect(totals(lines)).toEqual({ debit: 50000, credit: 50000 });
  });
});

describe("buildDisposalLines", () => {
  it("books a gain when proceeds exceed net book value, balanced", () => {
    // cost 100000, accumDep 80000 -> NBV 20000; sold for 35000 -> gain 15000
    const lines = buildDisposalLines("1101", 100000, 80000, 35000, "Old Ventilator");
    expect(totals(lines)).toEqual({ debit: 115000, credit: 115000 });
    const gainLine = lines.find((l) => l.accountCode === "4020");
    expect(gainLine?.credit).toBe(15000);
    expect(lines.find((l) => l.accountCode === "5060")).toBeUndefined();
  });

  it("books a loss when proceeds are below net book value, balanced", () => {
    // cost 100000, accumDep 30000 -> NBV 70000; sold for 40000 -> loss 30000
    const lines = buildDisposalLines("1101", 100000, 30000, 40000, "Old Scanner");
    expect(totals(lines)).toEqual({ debit: 100000, credit: 100000 });
    const lossLine = lines.find((l) => l.accountCode === "5060");
    expect(lossLine?.debit).toBe(30000);
    expect(lines.find((l) => l.accountCode === "4020")).toBeUndefined();
  });

  it("handles a fully-depreciated asset scrapped for zero proceeds, balanced", () => {
    const lines = buildDisposalLines("1102", 20000, 20000, 0, "Old Chairs");
    expect(totals(lines)).toEqual({ debit: 20000, credit: 20000 });
    expect(lines.find((l) => l.accountCode === "1002")).toBeUndefined(); // no proceeds line
  });

  it("removes the exact asset cost from its GL account regardless of gain/loss", () => {
    const lines = buildDisposalLines("1101", 250000, 100000, 100000, "Anesthesia Machine");
    const assetLine = lines.find((l) => l.accountCode === "1101");
    expect(assetLine?.credit).toBe(250000);
  });
});
