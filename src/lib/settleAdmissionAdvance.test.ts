import { describe, it, expect } from "vitest";
import { planAdvanceSettlement } from "./settleAdmissionAdvance";

// Discharge settlement rule: the advance covers the outstanding bill first; whatever is
// left is the patient's money and gets refunded (via approval). The ledger must never
// carry a balance into the patient's next admission.
describe("planAdvanceSettlement", () => {
  it("covers the bill fully and refunds the excess (the reported ₹25k/₹1.5k case)", () => {
    // Advance ₹25,000 against ₹1,500 of charges → ₹1,500 applied, ₹23,500 refunded.
    expect(planAdvanceSettlement(25000, 1500)).toEqual({ applied: 1500, refund: 23500 });
  });

  it("applies everything and refunds nothing when the bill exceeds the advance", () => {
    expect(planAdvanceSettlement(5000, 12000)).toEqual({ applied: 5000, refund: 0 });
  });

  it("refunds the whole advance when there is nothing left to pay", () => {
    expect(planAdvanceSettlement(5000, 0)).toEqual({ applied: 0, refund: 5000 });
  });

  it("exact match leaves nothing to apply or refund afterwards", () => {
    expect(planAdvanceSettlement(1500, 1500)).toEqual({ applied: 1500, refund: 0 });
  });

  it("does nothing when there is no advance balance (idempotent re-run after settling)", () => {
    expect(planAdvanceSettlement(0, 1500)).toEqual({ applied: 0, refund: 0 });
    // A second discharge attempt sees balance 0 → no double debit, no second refund.
    expect(planAdvanceSettlement(0, 0)).toEqual({ applied: 0, refund: 0 });
  });

  it("never invents money from negative/missing inputs", () => {
    expect(planAdvanceSettlement(-500, 1000)).toEqual({ applied: 0, refund: 0 });
    expect(planAdvanceSettlement(1000, -200)).toEqual({ applied: 0, refund: 1000 });
    expect(planAdvanceSettlement(1000, null)).toEqual({ applied: 0, refund: 1000 });
    expect(planAdvanceSettlement(1000, undefined)).toEqual({ applied: 0, refund: 1000 });
  });
});
