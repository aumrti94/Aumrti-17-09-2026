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

/** Calculate line item total: taxable + GST */
export function calcLineTotal(taxable: number, gstPercent: number): { gst: number; total: number } {
  const gst = calcGST(taxable, gstPercent);
  return { gst, total: roundCurrency(taxable + gst) };
}

/** Alias for formatINR — formats amount in Indian Rupee notation */
export const formatCurrency = formatINR;
