import { describe, it, expect } from "vitest";
import { computeBillTotals } from "./billTotals";

/**
 * Regression suite for computeBillTotals — the pure bill-total math extracted
 * from the recalculate_bill_totals client fallback.
 *
 * Revenue surface: a wrong patient_payable / balance_due is a billing-integrity
 * bug (over- or under-collection from a patient). Values are hand-computed.
 *
 * Authored by @naveen (SDET). Billing-accuracy gate: @ravi / @balaji.
 */

describe("computeBillTotals — line aggregation", () => {
  it("sums taxable + GST across line items", () => {
    const r = computeBillTotals({
      items: [
        { taxable_amount: 1000, gst_amount: 120 },
        { taxable_amount: 500, gst_amount: 0 },
      ],
    });
    expect(r.subtotal).toBe(1500);
    expect(r.gst).toBe(120);
    expect(r.total).toBe(1620);
  });

  it("handles an empty bill (no items) as all-zero, unpaid", () => {
    const r = computeBillTotals({ items: [] });
    expect(r).toMatchObject({ subtotal: 0, gst: 0, total: 0, patientPayable: 0, balanceDue: 0, paymentStatus: "unpaid" });
  });

  it("coerces string/null money fields without NaN", () => {
    const r = computeBillTotals({
      items: [{ taxable_amount: "750.50", gst_amount: null }],
      advanceReceived: "0",
    });
    expect(r.subtotal).toBe(750.5);
    expect(r.gst).toBe(0);
    expect(r.total).toBe(750.5);
  });
});

describe("computeBillTotals — patient payable & balance", () => {
  it("nets advance and insurance off the total", () => {
    const r = computeBillTotals({
      items: [{ taxable_amount: 10000, gst_amount: 0 }],
      advanceReceived: 2000,
      insuranceAmount: 5000,
    });
    expect(r.patientPayable).toBe(3000); // 10000 - 2000 - 5000
    expect(r.balanceDue).toBe(3000);
    expect(r.paymentStatus).toBe("unpaid");
  });

  it("never produces a negative payable when advance+insurance exceed total", () => {
    const r = computeBillTotals({
      items: [{ taxable_amount: 1000, gst_amount: 0 }],
      advanceReceived: 2000,
      insuranceAmount: 5000,
    });
    expect(r.patientPayable).toBe(0);
    expect(r.balanceDue).toBe(0);
  });
});

describe("computeBillTotals — payment status transitions", () => {
  it("fully paid → 'paid' with zero balance", () => {
    const r = computeBillTotals({
      items: [{ taxable_amount: 1000, gst_amount: 180 }],
      paidAmount: 1180,
    });
    expect(r.balanceDue).toBe(0);
    expect(r.paymentStatus).toBe("paid");
  });

  it("part payment → 'partial' with remaining balance", () => {
    const r = computeBillTotals({
      items: [{ taxable_amount: 1000, gst_amount: 180 }],
      paidAmount: 500,
    });
    expect(r.balanceDue).toBe(680);
    expect(r.paymentStatus).toBe("partial");
  });

  it("zero paid → 'unpaid' even when balance is zero (nothing collected)", () => {
    const r = computeBillTotals({ items: [], paidAmount: 0 });
    expect(r.paymentStatus).toBe("unpaid");
  });
});
