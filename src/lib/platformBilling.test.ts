import { describe, it, expect } from "vitest";
import {
  resolveEffectivePrice,
  effectiveMonthlyAmount,
  splitGstInclusive,
  computePeriodEnd,
  isOverrideActive,
  totalCountForCycle,
  razorpayPeriodForCycle,
  formatBillingCycleLabel,
} from "./platformBilling";

const PLAN = { price_monthly: 8999, price_yearly: 89990 };
const NOW = new Date("2026-07-20T00:00:00Z");

describe("resolveEffectivePrice", () => {
  it("uses list price when there is no override or coupon", () => {
    const r = resolveEffectivePrice({ plan: PLAN, cycle: "monthly", asOf: NOW });
    expect(r).toMatchObject({ available: true, amountInr: 8999, amountPaise: 899900, source: "list" });
  });

  it("uses the yearly list price for a yearly cycle", () => {
    const r = resolveEffectivePrice({ plan: PLAN, cycle: "yearly", asOf: NOW });
    expect(r.amountInr).toBe(89990);
    expect(r.amountPaise).toBe(8999000);
  });

  it("charges the negotiated override instead of list", () => {
    const r = resolveEffectivePrice({
      plan: PLAN, cycle: "monthly", asOf: NOW,
      override: { monthly_price: 6500, valid_until: null },
    });
    // The whole point of the fix: the gateway amount must be the negotiated one.
    expect(r.amountPaise).toBe(650000);
    expect(r.source).toBe("override");
    expect(r.listInr).toBe(8999);
  });

  it("ignores an override whose valid_until has passed", () => {
    const r = resolveEffectivePrice({
      plan: PLAN, cycle: "monthly", asOf: NOW,
      override: { monthly_price: 6500, valid_until: "2026-06-30" },
    });
    expect(r.source).toBe("list");
    expect(r.amountInr).toBe(8999);
  });

  it("honours an override that is still valid today", () => {
    const r = resolveEffectivePrice({
      plan: PLAN, cycle: "monthly", asOf: NOW,
      override: { monthly_price: 6500, valid_until: "2026-07-20" },
    });
    expect(r.source).toBe("override");
  });

  it("falls back to list when the override has no price for the requested cycle", () => {
    const r = resolveEffectivePrice({
      plan: PLAN, cycle: "yearly", asOf: NOW,
      override: { monthly_price: 6500, yearly_price: null },
    });
    expect(r.source).toBe("list");
    expect(r.amountInr).toBe(89990);
  });

  it("applies the coupon on top of the override, not instead of it", () => {
    const r = resolveEffectivePrice({
      plan: PLAN, cycle: "monthly", asOf: NOW,
      override: { monthly_price: 6000 }, couponPct: 10,
    });
    expect(r.amountInr).toBe(5400);          // 6000 - 10%, not 8999 - 10%
    expect(r.appliedCouponPct).toBe(10);
    expect(r.source).toBe("override");
  });

  it("applies a coupon to list price when there is no override", () => {
    const r = resolveEffectivePrice({ plan: PLAN, cycle: "monthly", couponPct: 20, asOf: NOW });
    expect(r.amountInr).toBe(7199.2);
    expect(r.amountPaise).toBe(719920);
  });

  it("marks yearly unavailable when the plan has no annual price", () => {
    const r = resolveEffectivePrice({
      plan: { price_monthly: 2999, price_yearly: null }, cycle: "yearly", asOf: NOW,
    });
    expect(r.available).toBe(false);
    expect(r.amountPaise).toBe(0);
  });

  it("marks enterprise/custom-price plans unavailable for self-serve checkout", () => {
    const r = resolveEffectivePrice({
      plan: { ...PLAN, is_custom_price: true }, cycle: "monthly", asOf: NOW,
    });
    expect(r.available).toBe(false);
  });

  it("clamps a nonsense coupon rather than producing a negative charge", () => {
    expect(resolveEffectivePrice({ plan: PLAN, cycle: "monthly", couponPct: 150, asOf: NOW }).amountInr).toBe(0);
    expect(resolveEffectivePrice({ plan: PLAN, cycle: "monthly", couponPct: -50, asOf: NOW }).amountInr).toBe(8999);
  });

  it("accepts numeric strings, which is how Postgres numeric arrives over PostgREST", () => {
    const r = resolveEffectivePrice({
      plan: { price_monthly: "8999.00" }, cycle: "monthly", asOf: NOW,
      override: { monthly_price: "6500.50" },
    });
    expect(r.amountPaise).toBe(650050);
  });
});

describe("isOverrideActive", () => {
  it("treats a null valid_until as open-ended", () => {
    expect(isOverrideActive({ monthly_price: 1, valid_until: null }, NOW)).toBe(true);
  });
  it("treats an unparseable date as open-ended rather than silently dropping the rate", () => {
    expect(isOverrideActive({ monthly_price: 1, valid_until: "not-a-date" }, NOW)).toBe(true);
  });
  it("is false for a missing override", () => {
    expect(isOverrideActive(null, NOW)).toBe(false);
  });
});

describe("effectiveMonthlyAmount", () => {
  it("passes a monthly amount through", () => {
    expect(effectiveMonthlyAmount({ amountInr: 8999, cycle: "monthly" })).toBe(8999);
  });
  it("divides a yearly amount by 12 so MRR is not overstated 12x", () => {
    expect(effectiveMonthlyAmount({ amountInr: 89990, cycle: "yearly" })).toBe(7499.17);
  });
  it("defaults to monthly when the cycle is missing", () => {
    expect(effectiveMonthlyAmount({ amountInr: 500, cycle: null })).toBe(500);
  });
});

describe("splitGstInclusive", () => {
  it("reconciles exactly: base + gst === total", () => {
    for (const total of [8999, 14999, 2999, 89990, 1, 0.03, 123456.78]) {
      const s = splitGstInclusive({ total, sellerStateCode: "37", buyerStateCode: "37" });
      expect(s.base + s.gst).toBeCloseTo(s.total, 10);
      expect(s.cgst + s.sgst + s.igst).toBeCloseTo(s.gst, 10);
    }
  });

  it("back-computes 18% out of a tax-inclusive 14,999", () => {
    const s = splitGstInclusive({ total: 14999, sellerStateCode: "37", buyerStateCode: "37" });
    expect(s.gst).toBe(2287.98);      // 14999 × 18/118
    expect(s.base).toBe(12711.02);
  });

  it("absorbs the odd paisa into SGST so the halves still sum to the tax", () => {
    // 8999 → gst 1372.73, which does not halve evenly.
    const s = splitGstInclusive({ total: 8999, sellerStateCode: "37", buyerStateCode: "37" });
    expect(s.gst).toBe(1372.73);
    expect(s.cgst).toBe(686.37);
    expect(s.sgst).toBe(686.36);
    expect(s.cgst + s.sgst).toBeCloseTo(s.gst, 10);
    expect(s.base + s.gst).toBeCloseTo(8999, 10);
  });

  it("splits intra-state supply into CGST + SGST", () => {
    const s = splitGstInclusive({ total: 8999, sellerStateCode: "37", buyerStateCode: "37" });
    expect(s.interState).toBe(false);
    expect(s.igst).toBe(0);
    expect(s.cgst + s.sgst).toBeCloseTo(s.gst, 10);
  });

  it("charges IGST when the states differ", () => {
    const s = splitGstInclusive({ total: 8999, sellerStateCode: "37", buyerStateCode: "29" });
    expect(s.interState).toBe(true);
    expect(s.igst).toBe(s.gst);
    expect(s.cgst).toBe(0);
    expect(s.sgst).toBe(0);
  });

  it("derives the buyer state from their GSTIN when state_code is missing", () => {
    const s = splitGstInclusive({
      total: 8999, sellerStateCode: "37", buyerGstin: "29ABCDE1234F1Z5",
    });
    expect(s.interState).toBe(true);
    expect(s.placeOfSupply).toBe("29");
  });

  it("defaults to intra-state when the buyer state is unknown", () => {
    // Every hospital currently has a null state_code; this must not assert a
    // cross-border supply on no evidence.
    const s = splitGstInclusive({ total: 8999, sellerStateCode: "37" });
    expect(s.interState).toBe(false);
    expect(s.igst).toBe(0);
  });

  it("supports a non-18% rate", () => {
    const s = splitGstInclusive({ total: 1050, ratePct: 5, sellerStateCode: "37", buyerStateCode: "37" });
    expect(s.gst).toBe(50);
    expect(s.base).toBe(1000);
  });
});

describe("computePeriodEnd", () => {
  it("adds one month for a monthly cycle", () => {
    expect(computePeriodEnd("2026-07-20T00:00:00Z", "monthly").toISOString())
      .toBe("2026-08-20T00:00:00.000Z");
  });

  it("adds twelve months for a yearly cycle", () => {
    expect(computePeriodEnd("2026-07-20T00:00:00Z", "yearly").toISOString())
      .toBe("2027-07-20T00:00:00.000Z");
  });

  it("clamps 31 Jan to 28 Feb rather than spilling into March", () => {
    expect(computePeriodEnd("2026-01-31T00:00:00Z", "monthly").toISOString())
      .toBe("2026-02-28T00:00:00.000Z");
  });

  it("clamps to 29 Feb in a leap year", () => {
    expect(computePeriodEnd("2028-01-31T00:00:00Z", "monthly").toISOString())
      .toBe("2028-02-29T00:00:00.000Z");
  });

  it("rolls the year over in December", () => {
    expect(computePeriodEnd("2026-12-15T00:00:00Z", "monthly").toISOString())
      .toBe("2027-01-15T00:00:00.000Z");
  });

  it("handles 29 Feb + 1 year landing on 28 Feb", () => {
    expect(computePeriodEnd("2028-02-29T00:00:00Z", "yearly").toISOString())
      .toBe("2029-02-28T00:00:00.000Z");
  });

  it("returns an invalid date for unparseable input instead of throwing", () => {
    expect(Number.isNaN(computePeriodEnd("nope", "monthly").getTime())).toBe(true);
  });
});

describe("cycle helpers", () => {
  it("maps cycles to Razorpay period and total_count", () => {
    expect(razorpayPeriodForCycle("yearly")).toBe("yearly");
    expect(razorpayPeriodForCycle("monthly")).toBe("monthly");
    expect(totalCountForCycle("yearly")).toBe(20);
    expect(totalCountForCycle("monthly")).toBe(240);
  });
  it("labels cycles for display", () => {
    expect(formatBillingCycleLabel("yearly")).toBe("Yearly");
    expect(formatBillingCycleLabel(null)).toBe("Monthly");
  });
});
