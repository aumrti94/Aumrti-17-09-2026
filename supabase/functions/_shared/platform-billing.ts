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

  const amountInr = couponPct > 0
    ? round2(beforeCoupon * (1 - couponPct / 100))
    : beforeCoupon;

  return {
    ...base,
    amountInr,
    amountPaise: Math.round(amountInr * 100),
    source: useOverride ? "override" : "list",
    appliedCouponPct: couponPct,
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
