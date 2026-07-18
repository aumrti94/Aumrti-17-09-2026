import { describe, it, expect } from "vitest";
import { formatINRExact, formatINRCompact } from "./currency";

/**
 * Currency display regression suite.
 *
 * Fourteen screens had each hand-rolled the same Cr/L/K abbreviation, so amounts
 * users reconcile against were rounded away on screen (a ₹23,700 day read
 * "₹23.7K"). formatINRExact is now the only formatter for a displayed amount;
 * formatINRCompact exists solely for chart axis ticks.
 *
 * Indian digit grouping is the point: 1,50,000 (lakh), not 150,000.
 */

describe("formatINRExact — exact amounts, Indian grouping", () => {
  it("shows the reported figures in full rather than abbreviated", () => {
    expect(formatINRExact(23700)).toBe("₹23,700");   // was "₹23.7K"
    expect(formatINRExact(1500)).toBe("₹1,500");     // was "₹1.5K"
    expect(formatINRExact(22200)).toBe("₹22,200");   // was "₹22.2K"
  });

  it("groups by lakh/crore, not by thousands (en-IN, not en-US)", () => {
    expect(formatINRExact(150000)).toBe("₹1,50,000");
    expect(formatINRExact(10000000)).toBe("₹1,00,00,000");
    expect(formatINRExact(1234567)).toBe("₹12,34,567");
  });

  it("rounds to whole rupees — no paise on a display figure", () => {
    expect(formatINRExact(2177.4)).toBe("₹2,177");
    expect(formatINRExact(2177.5)).toBe("₹2,178");
  });

  it("handles zero and negatives (a refund-heavy day)", () => {
    expect(formatINRExact(0)).toBe("₹0");
    expect(formatINRExact(-1323)).toBe("₹-1,323");
  });

  it("distinguishes amounts the abbreviation collapsed together", () => {
    // Both of these previously rendered "₹1.5L" — a ₹2 difference made invisible.
    expect(formatINRExact(149999)).not.toBe(formatINRExact(150001));
    expect(formatINRExact(149999)).toBe("₹1,49,999");
    expect(formatINRExact(150001)).toBe("₹1,50,001");
  });
});

describe("formatINRCompact — axis ticks only", () => {
  it.each([
    [500, "₹500"],
    [1500, "₹1.5K"],
    [23700, "₹23.7K"],
    [150000, "₹1.5L"],
    [10000000, "₹1.0Cr"],
  ])("%i → %s", (n, expected) => {
    expect(formatINRCompact(n)).toBe(expected);
  });

  it("uses the correct crore threshold — 1 crore is 1,00,00,000", () => {
    // platform-utils' old copy used 10_00_000 (ten lakh) as the crore cutoff, so
    // ₹10,00,000 of MRR displayed as "₹1.0Cr" — overstated 10×.
    expect(formatINRCompact(1000000)).toBe("₹10.0L");
    expect(formatINRCompact(10000000)).toBe("₹1.0Cr");
  });

  it("keeps the sign on negative values", () => {
    expect(formatINRCompact(-23700)).toBe("-₹23.7K");
  });
});
