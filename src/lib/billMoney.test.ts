import { describe, it, expect } from "vitest";
import { computeBillMoney } from "./billMoney";

const line = (taxable: number, gst = 0) => ({ taxable_amount: taxable, gst_amount: gst });

describe("computeBillMoney", () => {
  it("sums the persisted taxable/gst columns", () => {
    const m = computeBillMoney({ lineItems: [line(1000, 180), line(500, 90)] });
    expect(m.subtotal).toBe(1500);
    expect(m.gst).toBe(270);
    expect(m.grossCharges).toBe(1770);
    expect(m.netCharges).toBe(1770);
  });

  it("nets discount off charges but never below zero", () => {
    expect(computeBillMoney({ lineItems: [line(1000)], discountAmount: 250 }).netCharges).toBe(750);
    expect(computeBillMoney({ lineItems: [line(1000)], discountAmount: 5000 }).netCharges).toBe(0);
  });

  it("takes the insurer's share off patientPayable", () => {
    const m = computeBillMoney({ lineItems: [line(10000)], insuranceAmount: 7000 });
    expect(m.netCharges).toBe(10000);
    expect(m.patientPayable).toBe(3000);
  });

  it("keeps patientPayable GROSS of advance", () => {
    // The regression this guards: netting the advance in here made a ₹6,000
    // bill with a ₹20,000 advance report ₹1,500 of "actual" charges.
    const m = computeBillMoney({ lineItems: [line(6000)], netAdvance: 20000 });
    expect(m.patientPayable).toBe(6000);
    expect(m.netCharges).toBe(6000);
  });

  describe("the reported bill: ₹6,000 charges, ₹20,000 admission advance", () => {
    const m = computeBillMoney({ lineItems: [line(6000)], netAdvance: 20000, directPaid: 0 });

    it("owes no balance", () => expect(m.balanceDue).toBe(0));
    it("refunds the genuine ₹14,000 excess, not the phantom ₹29,000", () => {
      expect(m.refundDue).toBe(14000);
      expect(m.settlement).toBe("refund");
    });
  });

  it("does not reproduce the Payments-tab figure from the stale DB columns", () => {
    // PaymentsTab computed `paid_amount − patient_payable` = 20000 − 1500 =
    // ₹18,500, compounding two broken columns: patient_payable held an
    // advance-netted residual, and paid_amount was inflated by the advance
    // sync. Derived from line items + the admission ledger, the answer is
    // ₹14,000 — the same figure the Advance tab shows.
    const m = computeBillMoney({ lineItems: [line(6000)], netAdvance: 20000, directPaid: 0 });
    expect(m.refundDue).toBe(14000);
    expect(m.refundDue).not.toBe(18500);
    expect(m.refundDue).not.toBe(29000);
  });

  it("does not invent a refund from another stay's advances", () => {
    // Patient-scoped advance lookups returned ₹35,000 (this stay's ₹20,000 plus
    // a previous stay's ₹15,000) and produced a ₹29,000 "Refund Due to Patient".
    // Admission-scoped, the same bill refunds ₹14,000.
    const patientScoped = computeBillMoney({ lineItems: [line(6000)], netAdvance: 35000 });
    const admissionScoped = computeBillMoney({ lineItems: [line(6000)], netAdvance: 20000 });
    expect(patientScoped.refundDue).toBe(29000);
    expect(admissionScoped.refundDue).toBe(14000);
  });

  it("counts advance and direct payments as one pool of credit", () => {
    const m = computeBillMoney({ lineItems: [line(10000)], netAdvance: 4000, directPaid: 6000 });
    expect(m.totalCredits).toBe(10000);
    expect(m.settlement).toBe("settled");
    expect(m.paymentStatus).toBe("paid");
  });

  it("never reports a balance and a refund at once", () => {
    const cases = [
      { lineItems: [line(5000)], netAdvance: 0 },
      { lineItems: [line(5000)], netAdvance: 5000 },
      { lineItems: [line(5000)], netAdvance: 9000 },
      { lineItems: [], netAdvance: 1000 },
    ];
    for (const c of cases) {
      const m = computeBillMoney(c);
      expect(m.balanceDue).toBeGreaterThanOrEqual(0);
      expect(m.refundDue).toBeGreaterThanOrEqual(0);
      expect(m.balanceDue === 0 || m.refundDue === 0).toBe(true);
    }
  });

  it("reports unpaid when no credit exists", () => {
    const m = computeBillMoney({ lineItems: [line(2000)] });
    expect(m.settlement).toBe("due");
    expect(m.balanceDue).toBe(2000);
    expect(m.paymentStatus).toBe("unpaid");
  });

  it("reports partial when credit falls short", () => {
    const m = computeBillMoney({ lineItems: [line(2000)], directPaid: 500 });
    expect(m.paymentStatus).toBe("partial");
    expect(m.balanceDue).toBe(1500);
  });

  it("handles insurance, discount and advance together", () => {
    const m = computeBillMoney({
      lineItems: [line(10000, 1800)],
      discountAmount: 800,
      insuranceAmount: 6000,
      netAdvance: 3000,
      directPaid: 500,
    });
    expect(m.netCharges).toBe(11000);   // 10000 + 1800 − 800
    expect(m.patientPayable).toBe(5000); // − 6000 insurer
    expect(m.totalCredits).toBe(3500);
    expect(m.balanceDue).toBe(1500);
    expect(m.refundDue).toBe(0);
  });

  it("coerces string and null amounts", () => {
    const m = computeBillMoney({
      lineItems: [{ taxable_amount: "1000.50", gst_amount: null }],
      netAdvance: undefined,
      directPaid: "200",
    });
    expect(m.subtotal).toBe(1000.5);
    expect(m.gst).toBe(0);
    expect(m.directPaid).toBe(200);
  });

  it("returns zeroes for an empty bill", () => {
    const m = computeBillMoney({ lineItems: [] });
    expect(m.netCharges).toBe(0);
    expect(m.balanceDue).toBe(0);
    expect(m.refundDue).toBe(0);
    expect(m.settlement).toBe("settled");
  });

  it("rounds to paise without drift", () => {
    const m = computeBillMoney({ lineItems: [line(0.1), line(0.2)] });
    expect(m.subtotal).toBe(0.3);
  });
});
