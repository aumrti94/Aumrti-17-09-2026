import { describe, it, expect } from "vitest";
import { addonsMonthlyTotal, addonsYearlyTotal, activeSkus, describeGrant, type AddonSku, type HospitalAddon } from "./addons";

const sku = (over: Partial<AddonSku> = {}): AddonSku => ({
  id: "a", slug: "s", name: "N", description: null,
  price_monthly: 4999, price_yearly: null,
  module_keys: [], ai_feature_keys: [], ...over,
});

describe("addon totals", () => {
  it("sums monthly prices", () => {
    expect(addonsMonthlyTotal([sku({ price_monthly: 4999 }), sku({ price_monthly: 3999 })])).toBe(8998);
  });

  it("accepts numeric strings, as PostgREST delivers numerics", () => {
    expect(addonsMonthlyTotal([sku({ price_monthly: "4999.00" })])).toBe(4999);
  });

  it("returns null yearly when no SKU has an explicit yearly price", () => {
    // null lets resolveEffectivePrice apply the 10x convention. Returning 0
    // here would charge nothing for add-ons on an annual plan.
    expect(addonsYearlyTotal([sku(), sku()])).toBeNull();
  });

  it("sums yearly prices when present", () => {
    expect(addonsYearlyTotal([sku({ price_yearly: 45000 }), sku({ price_yearly: 30000 })])).toBe(75000);
  });

  it("ignores empty input", () => {
    expect(addonsMonthlyTotal([])).toBe(0);
    expect(addonsYearlyTotal([])).toBeNull();
  });
});

describe("activeSkus", () => {
  const rows: HospitalAddon[] = [
    { id: "1", addon_sku_id: "b", status: "active", granted_at: null, billing_starts_at: null, addon_skus: sku({ id: "b", sort_order: 2 }) },
    { id: "2", addon_sku_id: "c", status: "cancelled", granted_at: null, billing_starts_at: null, addon_skus: sku({ id: "c", sort_order: 1 }) },
    { id: "3", addon_sku_id: "d", status: "active", granted_at: null, billing_starts_at: null, addon_skus: sku({ id: "d", sort_order: 1 }) },
  ];

  it("excludes cancelled rows so a cancelled add-on is never billed", () => {
    expect(activeSkus(rows).map((s) => s.id)).toEqual(["d", "b"]);
  });

  it("orders by the catalogue's sort_order", () => {
    expect(activeSkus(rows)[0].id).toBe("d");
  });
});

describe("describeGrant", () => {
  it("describes a module + AI bundle", () => {
    expect(describeGrant(sku({ module_keys: ["insurance", "pmjay"], ai_feature_keys: ["denial_predictor"] })))
      .toBe("2 modules + 1 AI feature");
  });

  it("handles an AI-only SKU (AI Suite Pro grants no modules)", () => {
    expect(describeGrant(sku({ module_keys: [], ai_feature_keys: ["a", "b"] }))).toBe("2 AI features");
  });

  it("tolerates null columns", () => {
    expect(describeGrant(sku({ module_keys: null, ai_feature_keys: null }))).toBe("No additional access");
  });
});
