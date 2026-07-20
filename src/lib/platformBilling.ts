/**
 * Platform (SaaS) billing arithmetic — hospitals paying Aumrti. Pure, no I/O.
 *
 * Why this exists
 * ---------------
 * The price a hospital is actually charged is a function of four inputs
 * (list plan, negotiated override, billing cycle, coupon) and until now nothing
 * computed it in one place. The consequences were live billing bugs:
 *
 *   • `create-razorpay-subscription` computed a discounted `effectiveMonthly`
 *     for the RESPONSE PAYLOAD ONLY — the Razorpay subscription was bound to a
 *     plan at list price, so every coupon was cosmetic and nobody was ever
 *     actually charged less.
 *   • `hospital_pricing_overrides` was never read at checkout at all, so a
 *     negotiated price was displayed in the platform console and ignored by
 *     the payment gateway.
 *   • `SubscribeButton` rendered "₹X/year" as `price_monthly × 10`, a number
 *     with no basis in any plan row.
 *
 * Every surface that needs a price — checkout, plan change, MRR, invoices —
 * now derives it here, and the same file is mirrored to
 * `supabase/functions/_shared/platform-billing.ts` for the Deno side, with a
 * parity test asserting the two do not drift. Edge functions cannot be run
 * locally (no Docker, no Deno), so logic lives here where vitest can see it and
 * the Deno files stay thin I/O shells.
 *
 * Relationship to src/lib/gst.ts
 * ------------------------------
 * `gst.ts` owns the state-code → CGST/SGST/IGST decision and is reused as-is.
 * It splits tax EXCLUSIVE of the taxable value (procurement's shape). A
 * subscription price is quoted tax-INCLUSIVE, so `splitGstInclusive` below
 * back-computes the base and delegates the interstate call to `gst.ts` rather
 * than restating that rule.
 */

import { resolveStateCode, type GstSplit } from "./gst";

export type BillingCycle = "monthly" | "yearly";

/** Currency rounding to 2dp, matching billMoney/billTotals. */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ─────────────────────────────────────────────────────────────
// Effective price
// ─────────────────────────────────────────────────────────────

export interface PlanPricing {
  price_monthly?: number | string | null;
  price_yearly?: number | string | null;
  is_custom_price?: boolean | null;
}

export interface PricingOverride {
  monthly_price?: number | string | null;
  yearly_price?: number | string | null;
  /** Past this date the negotiated rate lapses back to list. */
  valid_until?: string | null;
}

export interface EffectivePrice {
  /** False when the requested cycle is not purchasable (e.g. no yearly price). */
  available: boolean;
  cycle: BillingCycle;
  /** Rupees, 2dp, tax-inclusive — what the customer is charged per cycle. */
  amountInr: number;
  /** Paise — what Razorpay's plan `item.amount` must be set to. */
  amountPaise: number;
  /** List price before override/coupon, for "was ₹X" display. */
  listInr: number;
  source: "list" | "override";
  appliedCouponPct: number;
  reason?: string;
}

const overrideForCycle = (o: PricingOverride | null | undefined, cycle: BillingCycle) =>
  cycle === "yearly" ? o?.yearly_price : o?.monthly_price;

/** An override with a past `valid_until` is expired and must not be charged. */
export function isOverrideActive(o: PricingOverride | null | undefined, asOf: Date = new Date()): boolean {
  if (!o) return false;
  if (!o.valid_until) return true;
  const until = new Date(o.valid_until);
  if (Number.isNaN(until.getTime())) return true;
  return until.getTime() >= asOf.getTime();
}

/**
 * The single source of truth for "what do we charge this hospital".
 *
 * Order is override → coupon, deliberately: a coupon is a promotion applied on
 * top of whatever rate the hospital is on, so a negotiated customer keeps their
 * discount rather than silently being moved to list price minus the coupon.
 */
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

  // A yearly price of null/0 means the plan is simply not sold annually. Callers
  // hide the yearly option rather than inventing a number (the `× 10` bug).
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

/**
 * Normalises any cycle to a monthly figure for MRR.
 *
 * Without this, an annual subscriber books 12× their true monthly contribution
 * in the month they pay and zero afterwards, and `mrr_snapshots` records that
 * permanently — snapshots cannot be recomputed after the fact.
 */
export function effectiveMonthlyAmount(params: {
  amountInr: number | string | null | undefined;
  cycle: BillingCycle | null | undefined;
}): number {
  const amt = num(params.amountInr);
  return params.cycle === "yearly" ? round2(amt / 12) : round2(amt);
}

// ─────────────────────────────────────────────────────────────
// GST on a tax-inclusive subscription price
// ─────────────────────────────────────────────────────────────

export interface InclusiveGstSplit extends GstSplit {
  /** Taxable value. Guaranteed: base + gst === total, exactly. */
  base: number;
  total: number;
  ratePct: number;
  placeOfSupply: string | null;
}

/**
 * Back-computes the taxable base from a tax-inclusive total.
 *
 * The existing `generate-invoice` did `Math.round((amount / 1.18) * 0.18 * 100) / 100`
 * for tax and rounded the base separately, so on some amounts base + gst missed
 * the total by a paisa — an invoice whose own line items do not add up to what
 * was charged. Here `gst` is rounded once and `base` is derived by subtraction,
 * which makes exact reconciliation structural rather than lucky.
 */
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

  // Mirrors gst.ts: inter-state only when BOTH codes are known and differ.
  // A missing buyer code falls back to intra-state (CGST/SGST) rather than
  // IGST, which is the safer default — it keeps the tax within the seller's
  // state instead of asserting a cross-border supply that may not exist.
  const interState = !!seller && !!buyer && seller !== buyer;

  const cgst = interState ? 0 : round2(gst / 2);
  const sgst = interState ? 0 : round2(gst - cgst); // absorbs the odd paisa
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

// ─────────────────────────────────────────────────────────────
// Billing periods
// ─────────────────────────────────────────────────────────────

const lastDayOfMonth = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/**
 * Period end for a cycle, clamped to the target month's last day.
 *
 * Naive `setMonth(+1)` on 31 Jan yields 2 or 3 March depending on leap year,
 * which would print a billing period that overlaps the next one. Razorpay's
 * own `current_end` stays authoritative when present; this is the fallback for
 * when it isn't (manual activation, or an event that omits the period).
 */
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

/** Razorpay `total_count`: ~20 years of cycles, matching the existing monthly 240. */
export function totalCountForCycle(cycle: BillingCycle): number {
  return cycle === "yearly" ? 20 : 240;
}

export function formatBillingCycleLabel(cycle: BillingCycle | null | undefined): string {
  return cycle === "yearly" ? "Yearly" : "Monthly";
}

/** Razorpay plan `period` value. Kept here so no caller hardcodes "monthly" again. */
export function razorpayPeriodForCycle(cycle: BillingCycle): "monthly" | "yearly" {
  return cycle === "yearly" ? "yearly" : "monthly";
}
