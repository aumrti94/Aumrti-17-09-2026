import { describe, it, expect } from "vitest";
import {
  addonsMonthlyTotal,
  addonsYearlyTotal,
  activeSkus,
  describeGrant,
  type AddonSku,
  type HospitalAddon,
} from "@/lib/addons";

const sku = (over: Partial<AddonSku> = {}): AddonSku => ({
  id: "sku-1",
  slug: "ai-suite-pro",
  name: "AI Suite Pro",
  description: null,
  price_monthly: 1000,
  price_yearly: null,
  module_keys: null,
  ai_feature_keys: null,
  ...over,
});

describe("addonsMonthlyTotal", () => {
  it("sums the monthly price across SKUs", () => {
    expect(addonsMonthlyTotal([sku({ price_monthly: 1000 }), sku({ price_monthly: 500 })])).toBe(1500);
  });

  it("a different set of purchased SKUs produces a different total for the same hospital", () => {
    const oneAddon = addonsMonthlyTotal([sku({ price_monthly: 1000 })]);
    const twoAddons = addonsMonthlyTotal([sku({ price_monthly: 1000 }), sku({ price_monthly: 2000 })]);
    expect(oneAddon).toBe(1000);
    expect(twoAddons).toBe(3000);
  });

  it("returns 0 for an empty list", () => {
    expect(addonsMonthlyTotal([])).toBe(0);
  });

  it("coerces a string price (as Postgres numeric often arrives) instead of NaN-ing", () => {
    expect(addonsMonthlyTotal([sku({ price_monthly: "1500.50" as any })])).toBe(1500.5);
  });

  it("treats a null/undefined entry in the list as zero rather than throwing", () => {
    expect(addonsMonthlyTotal([sku({ price_monthly: 1000 }), null, undefined])).toBe(1000);
  });

  it("rounds to 2 decimal places, guarding against float drift", () => {
    expect(addonsMonthlyTotal([sku({ price_monthly: 0.1 }), sku({ price_monthly: 0.2 })])).toBe(0.3);
  });
});

describe("addonsYearlyTotal", () => {
  it("returns null when no SKU carries an explicit yearly price, so the 10x convention can apply", () => {
    expect(addonsYearlyTotal([sku({ price_yearly: null })])).toBeNull();
  });

  it("returns the summed explicit yearly price when at least one SKU has one", () => {
    expect(addonsYearlyTotal([sku({ price_yearly: 10000 }), sku({ price_yearly: null })])).toBe(10000);
  });

  it("returns null for an empty list rather than 0", () => {
    expect(addonsYearlyTotal([])).toBeNull();
  });
});

describe("activeSkus", () => {
  const row = (over: Partial<HospitalAddon> = {}): HospitalAddon => ({
    id: "row-1",
    addon_sku_id: "sku-1",
    status: "active",
    granted_at: null,
    billing_starts_at: null,
    addon_skus: sku(),
    ...over,
  });

  it("excludes a cancelled add-on — a cancelled purchase must not still bill or grant", () => {
    const rows = [row({ status: "active" }), row({ status: "cancelled", addon_sku_id: "sku-2" })];
    expect(activeSkus(rows)).toHaveLength(1);
  });

  it("excludes a row whose sku join failed to resolve", () => {
    const rows = [row({ addon_skus: null })];
    expect(activeSkus(rows)).toEqual([]);
  });

  it("orders by sort_order", () => {
    const rows = [
      row({ addon_skus: sku({ slug: "b", sort_order: 2 } as any) }),
      row({ addon_skus: sku({ slug: "a", sort_order: 1 } as any) }),
    ];
    expect(activeSkus(rows).map((s) => s.slug)).toEqual(["a", "b"]);
  });
});

describe("describeGrant", () => {
  it("describes a module-only grant", () => {
    expect(describeGrant(sku({ module_keys: ["oncology", "dialysis"], ai_feature_keys: null }))).toBe("2 modules");
  });

  it("describes an AI-only grant — an SKU can grant zero modules", () => {
    expect(describeGrant(sku({ module_keys: null, ai_feature_keys: ["clinical_note"] }))).toBe("1 AI feature");
  });

  it("describes a combined grant", () => {
    expect(describeGrant(sku({ module_keys: ["oncology"], ai_feature_keys: ["clinical_note", "icd_suggest"] }))).toBe(
      "1 module + 2 AI features"
    );
  });

  it("falls back to a clear message when a SKU grants nothing", () => {
    expect(describeGrant(sku({ module_keys: null, ai_feature_keys: null }))).toBe("No additional access");
  });
});
