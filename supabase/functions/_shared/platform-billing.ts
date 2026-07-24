/**
 * Deno mirror of `src/lib/platformBilling.ts` (+ the two helpers it uses from
 * `src/lib/gst.ts`).
 *
 * Why a copy and not an import: edge functions cannot import from `src/`, and
 * vitest cannot see `supabase/functions/`. Since there is no local Deno and no
 * Docker, edge-function code is only verifiable in production — so the logic
 * lives in `src/lib/` where vitest covers it, and this file mirrors it.
 *
 * `src/lib/platformBilling.parity.test.ts` asserts the exported logic here
 * matches the source of truth. If you edit one, edit both — the test fails
 * otherwise, which is the whole point.
 */

export type BillingCycle = "monthly" | "yearly";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ── from src/lib/gst.ts ──────────────────────────────────────────────────────

export function stateCodeFromGstin(gstin?: string | null): string | null {
  if (!gstin || gstin.length < 2) return null;
  const code = gstin.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

export function resolveStateCode(stateCode?: string | null, gstin?: string | null): string | null {
  if (stateCode && /^\d{2}$/.test(stateCode.trim())) return stateCode.trim();
  return stateCodeFromGstin(gstin);
}

// ── effective price ─────────────────────────────────────────────────────────

export interface PlanPricing {
  price_monthly?: number | string | null;
  price_yearly?: number | string | null;
  is_custom_price?: boolean | null;
  /** Beds included in the base price. NULL = bed count never affects price. */
  beds_included?: number | string | null;
  /** Billing increment for extra beds (default 10). */
  bed_block_size?: number | string | null;
  /** Monthly ₹ per bed block above beds_included. NULL = no bed billing. */
  price_per_bed_block?: number | string | null;
  /** Yearly ₹ per bed block. NULL = auto 10× monthly (2-months-free convention). */
  price_per_bed_block_yearly?: number | string | null;
}

export interface PricingOverride {
  monthly_price?: number | string | null;
  yearly_price?: number | string | null;
  valid_until?: string | null;
}

export interface EffectivePrice {
  available: boolean;
  cycle: BillingCycle;
  amountInr: number;
  amountPaise: number;
  listInr: number;
  source: "list" | "override";
  appliedCouponPct: number;
  /** Base (list-or-override) component before the bed fee, for itemised display. */
  baseInr: number;
  /** Bed blocks billed above beds_included (0 when bed billing doesn't apply). */
  bedBlocks: number;
  /** ₹ charged for those blocks this cycle, pre-coupon. */
  bedFeeInr: number;
  /** ₹ charged for purchased add-on SKUs this cycle, pre-coupon. */
  addonsInr: number;
  reason?: string;
}

const overrideForCycle = (o: PricingOverride | null | undefined, cycle: BillingCycle) =>
  cycle === "yearly" ? o?.yearly_price : o?.monthly_price;

export function isOverrideActive(o: PricingOverride | null | undefined, asOf: Date = new Date()): boolean {
  if (!o) return false;
  if (!o.valid_until) return true;
  const until = new Date(o.valid_until);
  if (Number.isNaN(until.getTime())) return true;
  return until.getTime() >= asOf.getTime();
}

export function resolveEffectivePrice(params: {
  plan: PlanPricing;
  override?: PricingOverride | null;
  cycle: BillingCycle;
  couponPct?: number | null;
  /**
   * The hospital's live active-bed count (from the `current_active_beds` RPC,
   * which mirrors the migration-150 enforcement trigger). Omit/null = bed fee
   * not computed — legacy callers and plans without bed billing are unaffected.
   */
  activeBeds?: number | null;
  /**
   * Total ₹/month of the hospital's ACTIVE purchased add-on SKUs. The caller
   * sums addon_skus.price_monthly; this function only adds it in, so a change
   * to the SKU catalogue never needs a code change here.
   */
  addonsMonthlyInr?: number | null;
  /** Total ₹/year of the same SKUs. Omit/null = auto 10× monthly. */
  addonsYearlyInr?: number | null;
  asOf?: Date;
}): EffectivePrice {
  const { plan, override, cycle, asOf = new Date() } = params;
  const couponPct = Math.max(0, Math.min(100, num(params.couponPct)));

  const listRaw = cycle === "yearly" ? plan.price_yearly : plan.price_monthly;
  const listInr = round2(num(listRaw));

  const base: EffectivePrice = {
    available: true,
    cycle,
    amountInr: 0,
    amountPaise: 0,
    listInr,
    source: "list",
    appliedCouponPct: 0,
    baseInr: 0,
    bedBlocks: 0,
    bedFeeInr: 0,
    addonsInr: 0,
  };

  if (plan.is_custom_price) {
    return { ...base, available: false, reason: "Enterprise plans are quoted manually" };
  }

  if (listRaw == null || listInr <= 0) {
    return {
      ...base,
      available: false,
      reason: cycle === "yearly" ? "This plan has no annual price" : "This plan has no price",
    };
  }

  const ovRaw = overrideForCycle(override, cycle);
  const useOverride = isOverrideActive(override, asOf) && ovRaw != null && num(ovRaw) > 0;
  const beforeCoupon = useOverride ? round2(num(ovRaw)) : listInr;

  // ── Bed-block fee (pricing v3) ──────────────────────────────
  // Charged per `bed_block_size` beds (ceil) above `beds_included`. Applies on
  // top of the base whether that base is list or a negotiated override — a
  // negotiated rate covers the platform, not unlimited beds. The coupon then
  // discounts the whole invoice (base + bed fee), matching how a promotion
  // reads to the customer. NULL beds_included / price_per_bed_block / activeBeds
  // all mean "no bed billing" so legacy plans and callers are unchanged.
  const bedsIncluded = plan.beds_included == null ? null : num(plan.beds_included);
  const blockPriceMo = plan.price_per_bed_block == null ? null : num(plan.price_per_bed_block);
  const blockSize = Math.max(1, num(plan.bed_block_size) || 10);
  const activeBeds = params.activeBeds == null ? null : num(params.activeBeds);

  let bedBlocks = 0;
  let bedFeeInr = 0;
  if (bedsIncluded != null && blockPriceMo != null && blockPriceMo > 0 && activeBeds != null) {
    bedBlocks = Math.max(0, Math.ceil((activeBeds - bedsIncluded) / blockSize));
    const yearlyRaw = plan.price_per_bed_block_yearly;
    const blockRate = cycle === "yearly"
      ? (yearlyRaw != null && num(yearlyRaw) > 0 ? num(yearlyRaw) : blockPriceMo * 10)
      : blockPriceMo;
    bedFeeInr = round2(bedBlocks * blockRate);
  }

  // ── Purchased add-on SKUs (pricing v3 Phase 2) ──────────────
  // Added alongside the bed fee, on top of list-or-override. Like beds, add-ons
  // are billed from the next renewal — the amount here is what the subscription
  // will be rebound to, not a mid-cycle charge.
  const addonsMonthly = round2(num(params.addonsMonthlyInr));
  const addonsYearlyRaw = params.addonsYearlyInr;
  const addonsInr = cycle === "yearly"
    ? (addonsYearlyRaw != null && num(addonsYearlyRaw) > 0 ? round2(num(addonsYearlyRaw)) : round2(addonsMonthly * 10))
    : addonsMonthly;

  const beforeCouponTotal = round2(beforeCoupon + bedFeeInr + addonsInr);
  const amountInr = couponPct > 0
    ? round2(beforeCouponTotal * (1 - couponPct / 100))
    : beforeCouponTotal;

  return {
    ...base,
    amountInr,
    amountPaise: Math.round(amountInr * 100),
    source: useOverride ? "override" : "list",
    appliedCouponPct: couponPct,
    baseInr: beforeCoupon,
    bedBlocks,
    bedFeeInr,
    addonsInr,
  };
}

export function effectiveMonthlyAmount(params: {
  amountInr: number | string | null | undefined;
  cycle: BillingCycle | null | undefined;
}): number {
  const amt = num(params.amountInr);
  return params.cycle === "yearly" ? round2(amt / 12) : round2(amt);
}

// ── GST on a tax-inclusive price ────────────────────────────────────────────

export interface InclusiveGstSplit {
  base: number;
  total: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  interState: boolean;
  ratePct: number;
  placeOfSupply: string | null;
}

export function splitGstInclusive(params: {
  total: number | string | null | undefined;
  ratePct?: number;
  sellerStateCode?: string | null;
  sellerGstin?: string | null;
  buyerStateCode?: string | null;
  buyerGstin?: string | null;
}): InclusiveGstSplit {
  const total = round2(num(params.total));
  const ratePct = params.ratePct ?? 18;

  const seller = resolveStateCode(params.sellerStateCode, params.sellerGstin);
  const buyer = resolveStateCode(params.buyerStateCode, params.buyerGstin);

  const gst = round2((total * ratePct) / (100 + ratePct));
  const base = round2(total - gst);

  const interState = !!seller && !!buyer && seller !== buyer;

  const cgst = interState ? 0 : round2(gst / 2);
  const sgst = interState ? 0 : round2(gst - cgst);
  const igst = interState ? gst : 0;

  return {
    base,
    total,
    gst,
    cgst,
    sgst,
    igst,
    interState,
    ratePct,
    placeOfSupply: buyer ?? seller ?? null,
  };
}

// ── billing periods ─────────────────────────────────────────────────────────

const lastDayOfMonth = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

export function computePeriodEnd(start: Date | string, cycle: BillingCycle): Date {
  const s = typeof start === "string" ? new Date(start) : start;
  if (Number.isNaN(s.getTime())) return new Date(NaN);

  const monthsToAdd = cycle === "yearly" ? 12 : 1;
  const y = s.getUTCFullYear();
  const m = s.getUTCMonth() + monthsToAdd;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const day = Math.min(s.getUTCDate(), lastDayOfMonth(targetYear, targetMonth));

  return new Date(Date.UTC(
    targetYear, targetMonth, day,
    s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds(), s.getUTCMilliseconds(),
  ));
}

export function totalCountForCycle(cycle: BillingCycle): number {
  return cycle === "yearly" ? 20 : 240;
}

export function formatBillingCycleLabel(cycle: BillingCycle | null | undefined): string {
  return cycle === "yearly" ? "Yearly" : "Monthly";
}

export function razorpayPeriodForCycle(cycle: BillingCycle): "monthly" | "yearly" {
  return cycle === "yearly" ? "yearly" : "monthly";
}
