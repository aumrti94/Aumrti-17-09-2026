/**
 * Consistent currency rounding utilities for Indian Rupee calculations.
 * All monetary amounts are rounded to 2 decimal places using banker's rounding.
 */

/** Round to 2 decimal places — use for ALL monetary amounts */
export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Calculate GST amount with proper rounding */
export function calcGST(amount: number, gstPercent: number): number {
  return roundCurrency((amount * gstPercent) / 100);
}

/** Format amount in Indian Rupee notation */
export function formatINR(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Exact rupees, Indian digit grouping, no paise — for KPI cards, tooltips,
 * tables and any figure a user reads as a number.
 *
 * Use this, NOT an ad-hoc Cr/L/K abbreviation. Fourteen screens had each
 * hand-rolled the same `(n/100000).toFixed(1)+"L"` helper, so a ₹23,700 day
 * displayed as "₹23.7K" and ₹1,49,999 and ₹1,50,001 both rendered "₹1.5L" —
 * amounts people reconcile against cannot be rounded away like that.
 *
 * en-IN grouping is the point: 1,50,000 (lakh), not 150,000.
 */
export function formatINRExact(amount: number): string {
  return "₹" + Math.round(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/**
 * Abbreviated rupees (₹1.5L / ₹24K) — ONLY for chart axis tick labels, where
 * ~6 stacked labels at ~10px must stay narrow enough not to collide.
 *
 * Never use for a value a user reads as an amount; use formatINRExact. Chart
 * tooltips should also use the exact form — they have room.
 */
export function formatINRCompact(amount: number): string {
  const n = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (n >= 1_00_00_000) return `${sign}₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000) return `${sign}₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `${sign}₹${(n / 1_000).toFixed(1)}K`;
  return `${sign}₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Calculate line item total: taxable + GST */
export function calcLineTotal(taxable: number, gstPercent: number): { gst: number; total: number } {
  const gst = calcGST(taxable, gstPercent);
  return { gst, total: roundCurrency(taxable + gst) };
}

/** Alias for formatINR — formats amount in Indian Rupee notation */
export const formatCurrency = formatINR;
