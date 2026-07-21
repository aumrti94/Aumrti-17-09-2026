import { describe, it, expect } from "vitest";
import { getDefaultGSTRate, getRoomChargeGSTRate, resolveServiceGstPercent, GST_RATE_RULES } from "./gstRules";

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

describe("getDefaultGSTRate — room_charge_icu (ICU carve-out)", () => {
  // Bed-day catalog rows are mirrored with an item_type that encodes the CBIC
  // ICU carve-out (see ward_catalog_item_type in 20261008000136), because the
  // billing picker derives GST from item_type alone and has no bed category to
  // pass to getRoomChargeGSTRate. The two must agree.
  it("is exempt at any rate, including above the ₹5,000/day threshold", () => {
    expect(getDefaultGSTRate("room_charge_icu")).toBe(0);
    expect(getDefaultGSTRate("room_charge_icu", 12000)).toBe(0);
  });

  it("agrees with getRoomChargeGSTRate for an ICU bed above the threshold", () => {
    expect(getDefaultGSTRate("room_charge_icu", 12000)).toBe(getRoomChargeGSTRate("icu", 12000));
  });

  it("a non-ICU ward above the threshold is still 5% — the carve-out is not blanket", () => {
    expect(getDefaultGSTRate("room_charge", 12000)).toBe(getRoomChargeGSTRate("general", 12000));
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

describe("getRoomChargeGSTRate — deterministic, config-independent room GST", () => {
  // ICU/CCU/ICCU/NICU are fully exempt regardless of room rent (CBIC clarification on
  // Notification 12/2017). SICU/PICU treated as ICU-equivalent. HDU is deliberately NOT
  // exempt — not covered by the ICU carve-out, so it follows the ordinary >5000 rule.
  it.each(["icu", "nicu", "sicu", "picu", "ccu", "iccu"])(
    "%s is exempt regardless of rate, even well above ₹5,000/day",
    (category) => {
      expect(getRoomChargeGSTRate(category, 50000)).toBe(0);
    }
  );

  it.each(["ICU", "Nicu", "SICU"])("%s — case-insensitive match", (category) => {
    expect(getRoomChargeGSTRate(category, 50000)).toBe(0);
  });

  it("hdu is NOT treated as ICU-equivalent — follows the ordinary >5000 rule", () => {
    expect(getRoomChargeGSTRate("hdu", 6000)).toBe(5);
    expect(getRoomChargeGSTRate("hdu", 4000)).toBe(0);
  });

  it("general/private rooms follow the ordinary >5000 rule", () => {
    expect(getRoomChargeGSTRate("general", 4000)).toBe(0);
    expect(getRoomChargeGSTRate("general", 5000)).toBe(0);
    expect(getRoomChargeGSTRate("private", 5001)).toBe(5);
    expect(getRoomChargeGSTRate("semi_private", 12000)).toBe(5);
  });

  it("is deterministic even with no bed category at all", () => {
    expect(getRoomChargeGSTRate(null, 6000)).toBe(5);
    expect(getRoomChargeGSTRate(undefined, 6000)).toBe(5);
    expect(getRoomChargeGSTRate("", 4000)).toBe(0);
  });
});

describe("resolveServiceGstPercent — hospital-authored rows (source_table IS NULL)", () => {
  // Regression: the Add Service drawer never wrote item_type, so service_master's
  // DEFAULT 'service' applied — and GST_RATE_RULES.service is 18. The billing picker
  // read item_type ONLY and ignored gst_applicable, so a service the hospital saved
  // with "GST applicable" unchecked was billed at 18% while the UI showed "GST: No".
  it("unchecked toggle bills at 0% even when item_type carries a statutory rate", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "service", gst_applicable: false, gst_percent: 0, source_table: null },
        1000
      )
    ).toBe(0);
  });

  it("unchecked toggle wins over an 18% item_type ('other')", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "other", gst_applicable: false, gst_percent: 0, source_table: null },
        200
      )
    ).toBe(0);
  });

  it("checked toggle uses the configured percent", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "consultation", gst_applicable: true, gst_percent: 12, source_table: null },
        1000
      )
    ).toBe(12);
  });

  // gst_applicable=true with a 0 percent is a legitimate saved state meaning "0%"
  // (the Settings drawer's rate dropdown offers 0% explicitly), so it must NOT fall
  // through to the statutory rate for the item_type. This keeps the picker in step
  // with serviceBilling / chargePosting / ipdBilling, which all read
  // `gst_applicable ? gst_percent : 0`.
  it("checked toggle with a 0 percent means 0%, not the statutory rate", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "pharmacy", gst_applicable: true, gst_percent: 0, source_table: null },
        500
      )
    ).toBe(0);
  });

  it("a missing source_table field is treated as hospital-authored", () => {
    expect(
      resolveServiceGstPercent({ item_type: "other", gst_applicable: false }, 100)
    ).toBe(0);
  });
});

describe("resolveServiceGstPercent — mirrored rows (source_table NOT NULL)", () => {
  // The catalog-sync triggers (20261008000136) never set gst_applicable, so every
  // mirrored row carries the column default false. Honouring the toggle for these
  // would silently UNDER-tax legally taxable lines — the opposite compliance bug.
  it("a non-ICU room above ₹5,000/day still attracts 5% despite gst_applicable=false", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "room_charge", gst_applicable: false, gst_percent: 0, source_table: "wards" },
        12000
      )
    ).toBe(5);
  });

  it("an ICU room above the threshold stays exempt", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "room_charge_icu", gst_applicable: false, gst_percent: 0, source_table: "wards" },
        12000
      )
    ).toBe(0);
  });

  it("a mirrored lab test stays exempt", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "lab", gst_applicable: false, gst_percent: 0, source_table: "lab_test_master" },
        450
      )
    ).toBe(0);
  });

  it("an explicit module-set percent overrides the statutory default", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "room_charge", gst_applicable: false, gst_percent: 12, source_table: "wards" },
        12000
      )
    ).toBe(12);
  });
});

describe("resolveServiceGstPercent — input robustness", () => {
  it("tolerates gst_percent arriving as a numeric string (PostgREST numeric)", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "other", gst_applicable: true, gst_percent: "18", source_table: null },
        100
      )
    ).toBe(18);
  });

  it("tolerates null gst_percent on a mirrored row", () => {
    expect(
      resolveServiceGstPercent(
        { item_type: "lab", gst_applicable: null, gst_percent: null, source_table: "lab_test_master" },
        100
      )
    ).toBe(0);
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
