import { describe, it, expect } from "vitest";
import {
  buildOutwardRegister,
  summariseGstr1,
  summariseGstr3b,
  type GstBillInput,
} from "./gstReturns";

const bill = (over: Partial<GstBillInput>): GstBillInput => ({
  bill_number: "B1",
  bill_date: "2026-07-05",
  party_name: "Patient",
  taxable_amount: 1000,
  gst_amount: 180,
  total_amount: 1180,
  ...over,
});

describe("buildOutwardRegister", () => {
  it("splits intra-state supply into CGST + SGST by default", () => {
    const [r] = buildOutwardRegister([bill({})], { sellerStateCode: "36" });
    expect(r.cgst).toBe(90);
    expect(r.sgst).toBe(90);
    expect(r.igst).toBe(0);
    expect(r.supply).toBe("B2C");
    expect(r.interState).toBe(false);
    expect(r.hsn).toBe("9993");
  });

  it("uses IGST only when a registered buyer's state differs", () => {
    const [r] = buildOutwardRegister(
      [bill({ party_gstin: "27ABCDE1234F1Z5" })], // 27 = Maharashtra
      { sellerStateCode: "36" },                    // 36 = Telangana
    );
    expect(r.igst).toBe(180);
    expect(r.cgst).toBe(0);
    expect(r.sgst).toBe(0);
    expect(r.supply).toBe("B2B");
    expect(r.interState).toBe(true);
  });

  it("excludes exempt (nil-GST) bills", () => {
    const rows = buildOutwardRegister([bill({ gst_amount: 0 })], { sellerStateCode: "36" });
    expect(rows).toHaveLength(0);
  });
});

describe("summariseGstr1 / summariseGstr3b", () => {
  it("aggregates B2C/B2B, HSN, and 3B 3.1(a) values", () => {
    const rows = buildOutwardRegister(
      [
        bill({ bill_number: "B1", taxable_amount: 1000, gst_amount: 180, total_amount: 1180 }),
        bill({ bill_number: "B2", taxable_amount: 2000, gst_amount: 240, total_amount: 2240 }),
      ],
      { sellerStateCode: "36" },
    );
    const g1 = summariseGstr1(rows);
    expect(g1.invoiceCount).toBe(2);
    expect(g1.totalTaxable).toBe(3000);
    expect(g1.totalCgst).toBe(210);
    expect(g1.totalSgst).toBe(210);
    expect(g1.totalTax).toBe(420);
    expect(g1.hsn).toHaveLength(1);
    expect(g1.hsn[0].hsn).toBe("9993");

    const g3b = summariseGstr3b(rows);
    expect(g3b.taxableValue).toBe(3000);
    expect(g3b.cgst).toBe(210);
    expect(g3b.sgst).toBe(210);
    expect(g3b.igst).toBe(0);
  });
});
