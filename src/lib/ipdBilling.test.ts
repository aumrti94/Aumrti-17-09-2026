import { describe, it, expect } from "vitest";
import { filterSiblingBillsForSweep } from "./ipdBilling";

/**
 * Regression suite for the IPD discharge sweep double-charge fix. Lab and
 * pharmacy charges are already pulled directly (lab_order_items /
 * pharmacy_dispensing_items, keyed lab:{id} / pharmacy:dispense-item:{id}) —
 * their standalone sibling bills must be excluded from the generic
 * sibling-bill-copy sweep, or the same charge lands on the discharge bill
 * twice under two different dedupe keys.
 */
describe("filterSiblingBillsForSweep", () => {
  it("excludes lab and pharmacy sibling bills", () => {
    const bills = [
      { bill_type: "lab" },
      { bill_type: "pharmacy" },
      { bill_type: "radiology" },
    ];
    const result = filterSiblingBillsForSweep(bills);
    expect(result).toEqual([{ bill_type: "radiology" }]);
  });

  it("keeps every other bill_type that has no dedicated direct pull", () => {
    const bills = [
      { bill_type: "radiology" },
      { bill_type: "ot" },
      { bill_type: "daycare" },
      { bill_type: "opd" },
    ];
    expect(filterSiblingBillsForSweep(bills)).toEqual(bills);
  });

  it("returns an empty array when there are no sibling bills", () => {
    expect(filterSiblingBillsForSweep([])).toEqual([]);
  });

  it("filters out lab/pharmacy even when they're the only sibling bills present", () => {
    const bills = [{ bill_type: "lab" }, { bill_type: "pharmacy" }];
    expect(filterSiblingBillsForSweep(bills)).toEqual([]);
  });

  it("is null-safe on bill_type (defensive — schema allows it, even if unused today)", () => {
    const bills = [{ bill_type: null }, { bill_type: "lab" }];
    expect(filterSiblingBillsForSweep(bills)).toEqual([{ bill_type: null }]);
  });
});
