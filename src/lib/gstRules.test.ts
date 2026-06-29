import { describe, it, expect } from "vitest";
import { getDefaultGSTRate, GST_RATE_RULES } from "./gstRules";

/**
 * Regression suite for the healthcare GST rate engine
 * (Notification 12/2017-CT(Rate) + amendments).
 *
 * These are compliance-critical pure functions: an inpatient service taxed at
 * 18% instead of 0% creates a patient refund + GSTR mismatch, and a luxury room
 * NOT taxed at 5% above ₹5,000/day is an undertaxation/penalty risk. Reference
 * rates below are pinned to the notification, not copied from current output.
 *
 * Authored by @naveen (SDET) per the Firm's Day-1 de-risking recommendation.
 * Reviewed for rate correctness by @girija (GST) / @ravi (Finance coordinator).
 */

describe("getDefaultGSTRate — healthcare exemption (0%)", () => {
  // Per Notification 12/2017, in/out-patient clinical services are GST-exempt.
  it.each([
    ["consultation"],
    ["procedure"],
    ["surgery"],
    ["lab"],
    ["radiology"],
    ["nursing"],
    ["blood"],
    ["ambulance"],
    ["package"],
  ])("%s is exempt (0%%)", (itemType) => {
    expect(getDefaultGSTRate(itemType)).toBe(0);
  });
});

describe("getDefaultGSTRate — taxable supplies", () => {
  it.each([
    ["oxygen", 5],
    ["pharmacy", 12],
    ["consumable", 12],
    ["cafeteria", 5],
    ["cosmetic", 18],
    ["parking", 18],
    ["service", 18],
    ["other", 18],
    ["room_charge_luxury", 5],
  ])("%s is taxed at %i%%", (itemType, rate) => {
    expect(getDefaultGSTRate(itemType)).toBe(rate);
  });
});

describe("getDefaultGSTRate — room charge ₹5,000/day threshold (boundary)", () => {
  // Sec 9 luxury-room rule: ≤ ₹5,000/day exempt, > ₹5,000/day attracts 5%.
  it("standard room with no unit rate is exempt", () => {
    expect(getDefaultGSTRate("room_charge")).toBe(0);
  });

  it("room at exactly ₹5,000/day is exempt (boundary: not > 5000)", () => {
    expect(getDefaultGSTRate("room_charge", 5000)).toBe(0);
  });

  it("room at ₹5,001/day crosses into 5% (boundary + 1)", () => {
    expect(getDefaultGSTRate("room_charge", 5001)).toBe(5);
  });

  it("room well above threshold (₹12,000/day) is 5%", () => {
    expect(getDefaultGSTRate("room_charge", 12000)).toBe(5);
  });

  it("a sub-threshold room (₹1,500/day) stays exempt", () => {
    expect(getDefaultGSTRate("room_charge", 1500)).toBe(0);
  });
});

describe("getDefaultGSTRate — robustness / known gaps (pinned)", () => {
  it("unknown item type silently defaults to 0% — UNDERTAXATION RISK, flag to @girija", () => {
    // GST_RATE_RULES[itemType] ?? 0 — a typo'd or new taxable item type
    // (e.g. an 18% 'merchandise' line) defaults to EXEMPT rather than erroring.
    // Pinned to document current behaviour; should become an explicit
    // "unmapped item type" validation error before it reaches an invoice.
    expect(getDefaultGSTRate("merchandise_typo")).toBe(0);
    expect(getDefaultGSTRate("")).toBe(0);
  });

  it("unit rate is ignored for non-room item types", () => {
    // The > 5000 branch only applies to room_charge; pharmacy stays 12%
    // regardless of unit price.
    expect(getDefaultGSTRate("pharmacy", 9999)).toBe(12);
  });
});

describe("GST_RATE_RULES table integrity", () => {
  it("every rate is a valid Indian GST slab (0/5/12/18/28)", () => {
    const validSlabs = new Set([0, 5, 12, 18, 28]);
    for (const [key, rate] of Object.entries(GST_RATE_RULES)) {
      expect(validSlabs.has(rate), `${key} has non-slab rate ${rate}`).toBe(true);
    }
  });
});
