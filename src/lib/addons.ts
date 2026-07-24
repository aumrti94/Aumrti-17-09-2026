/**
 * Add-on SKU shapes and totalling — the client-side counterpart to the
 * `addon_skus` / `hospital_addons` tables (pricing v3 Phase 2).
 *
 * Every surface that shows or charges for add-ons (Settings → Plan, the
 * platform Hospital Detail card, /pricing) sums them through here, so the
 * figure a hospital sees and the figure the edge functions bind to the Razorpay
 * mandate come from one definition.
 *
 * Nothing here hardcodes a SKU: names, prices and the module/AI keys each SKU
 * grants are all columns edited in /platform → Plans → Add-ons.
 */

export interface AddonSku {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_monthly: number | string;
  /** NULL = auto 10× monthly, the same 2-months-free convention plans use. */
  price_yearly: number | string | null;
  module_keys: string[] | null;
  ai_feature_keys: string[] | null;
  is_active?: boolean;
  sort_order?: number;
  badge_text?: string | null;
}

export interface HospitalAddon {
  id: string;
  addon_sku_id: string;
  status: "active" | "cancelled";
  granted_at: string | null;
  billing_starts_at: string | null;
  source?: "admin" | "self_service";
  addon_skus?: AddonSku | null;
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Monthly ₹ total of a set of SKUs. */
export function addonsMonthlyTotal(skus: ReadonlyArray<AddonSku | null | undefined>): number {
  return round2(skus.reduce((s, k) => s + num(k?.price_monthly), 0));
}

/**
 * Yearly ₹ total. Returns null when NO sku carries an explicit yearly price, so
 * callers can pass null and let resolveEffectivePrice apply the 10× convention
 * rather than charging zero.
 */
export function addonsYearlyTotal(skus: ReadonlyArray<AddonSku | null | undefined>): number | null {
  const total = round2(skus.reduce((s, k) => s + num(k?.price_yearly), 0));
  return total > 0 ? total : null;
}

/** The SKUs behind a hospital's ACTIVE add-on rows, in catalogue order. */
export function activeSkus(rows: ReadonlyArray<HospitalAddon>): AddonSku[] {
  return rows
    .filter((r) => r.status === "active" && r.addon_skus)
    .map((r) => r.addon_skus as AddonSku)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * Plain-language summary of what a SKU unlocks, for purchase confirmation.
 * Module count and AI-feature count are both shown because several SKUs grant
 * only AI features (AI Suite Pro grants no modules at all).
 */
export function describeGrant(sku: AddonSku): string {
  const mods = sku.module_keys?.length ?? 0;
  const ai = sku.ai_feature_keys?.length ?? 0;
  const parts: string[] = [];
  if (mods) parts.push(`${mods} module${mods === 1 ? "" : "s"}`);
  if (ai) parts.push(`${ai} AI feature${ai === 1 ? "" : "s"}`);
  return parts.join(" + ") || "No additional access";
}
