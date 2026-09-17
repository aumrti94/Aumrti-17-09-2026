/**
 * Phase 1 — statutory + revenue tier (PHASED_TEST_PLAN.md §8, Phase 1).
 *
 * Indian GST on healthcare per Notification 12/2017-CT(Rate) and the CBIC clarifications.
 * These rates are a matter of law, not hospital preference: getting one wrong produces a
 * non-compliant tax invoice, which is a GSTR-1 mismatch and a notice, not a display bug.
 *
 * The two populations in `service_master` need OPPOSITE rules and that is the whole point of
 * `resolveServiceGstPercent` — a test that only covers one population passes against the
 * regression this function exists to fix.
 */
import { describe, it, expect } from "vitest";
import {
  GST_RATE_RULES,
  DEFAULT_PHARMACY_GST_PERCENT,
  getDefaultGSTRate,
  resolveServiceGstPercent,
  getRoomChargeGSTRate,
} from "@/lib/gstRules";

describe("GST_RATE_RULES — the statutory table", () => {
  it.each([
    ["consultation", 0],
    ["procedure", 0],
    ["surgery", 0],
    ["lab", 0],
    ["radiology", 0],
    ["nursing", 0],
    ["blood", 0],
    ["ambulance", 0],
    ["package", 0],
    ["room_charge", 0],
    ["room_charge_icu", 0],
    ["room_charge_luxury", 5],
    ["oxygen", 5],
    ["cafeteria", 5],
    ["pharmacy", 12],
    ["consumable", 12],
    ["cosmetic", 18],
    ["parking", 18],
    ["service", 18],
    ["other", 18],
  ])("%s is taxed at %i%%", (itemType, rate) => {
    expect(GST_RATE_RULES[itemType]).toBe(rate);
  });

  it("keeps every core healthcare service exempt", () => {
    // The exemption is the reason a hospital's bill is mostly 0% GST. If any of these drifts
    // to a non-zero rate, every patient is overcharged and the hospital has collected tax it
    // was not entitled to collect.
    const exempt = ["consultation", "procedure", "surgery", "lab", "radiology", "nursing", "blood", "ambulance"];
    for (const key of exempt) expect(GST_RATE_RULES[key], key).toBe(0);
  });

  it("pins the pharmacy fallback at 12% in one place", () => {
    // A stray `|| 5` at one dispensing call site meant the same drug billed at a different
    // rate depending on which screen dispensed it. This constant is the fix; it must agree
    // with the table or the fix is only half-applied.
    expect(DEFAULT_PHARMACY_GST_PERCENT).toBe(12);
    expect(GST_RATE_RULES.pharmacy).toBe(DEFAULT_PHARMACY_GST_PERCENT);
  });
});

describe("getDefaultGSTRate", () => {
  it("returns the table rate for a known item type", () => {
    expect(getDefaultGSTRate("pharmacy")).toBe(12);
    expect(getDefaultGSTRate("consultation")).toBe(0);
    expect(getDefaultGSTRate("cosmetic")).toBe(18);
  });

  it("returns 0 — not 18 — for an item type it has never heard of", () => {
    // Failing to 0 under-collects; failing to 18 over-charges a patient on an exempt
    // healthcare service. For a hospital bill, 0 is the safe default and the likely truth.
    expect(getDefaultGSTRate("teleconsult_followup")).toBe(0);
    expect(getDefaultGSTRate("")).toBe(0);
  });

  it.each([
    [4999, 0],
    [5000, 0],
    [5001, 5],
    [50000, 5],
  ])("room_charge at ₹%i/day → %i%%", (rate, expected) => {
    // The statutory threshold is "above ₹5,000 per day". ₹5,000 exactly is still exempt —
    // the branch is `> 5000`, and a `>=` here taxes every standard-rate room in the country.
    expect(getDefaultGSTRate("room_charge", rate)).toBe(expected);
  });

  it("treats a room_charge with no rate as exempt", () => {
    expect(getDefaultGSTRate("room_charge")).toBe(0);
    expect(getDefaultGSTRate("room_charge", 0)).toBe(0);
  });

  it("applies the rate threshold only to room_charge", () => {
    // A ₹50,000 surgery is still exempt; the threshold is a room-rent rule, not a price rule.
    expect(getDefaultGSTRate("surgery", 50000)).toBe(0);
    expect(getDefaultGSTRate("pharmacy", 50000)).toBe(12);
  });
});

describe("resolveServiceGstPercent — hospital-authored rows (source_table IS NULL)", () => {
  // For these the "GST applicable" toggle in Settings › Services & Fees is a deliberate
  // choice the hospital made, and it is authoritative.

  it("honours the toggle being off, even with a percent saved alongside it", () => {
    // THE REGRESSION THIS FUNCTION EXISTS FOR: the Add Service drawer never wrote item_type,
    // item_type defaults to 'service' (18%), so every service created from it was billed at
    // 18% while the UI displayed "GST: No".
    expect(resolveServiceGstPercent({ gst_applicable: false, gst_percent: 18 })).toBe(0);
    expect(resolveServiceGstPercent({ gst_applicable: false, gst_percent: 18, item_type: "service" })).toBe(0);
  });

  it("honours the toggle being on with a configured percent", () => {
    expect(resolveServiceGstPercent({ gst_applicable: true, gst_percent: 12 })).toBe(12);
    expect(resolveServiceGstPercent({ gst_applicable: true, gst_percent: 5 })).toBe(5);
  });

  it("treats gst_applicable=true with 0% as a legitimate saved state, not as unset", () => {
    // SettingsServicesPage writes `gst_applicable ? (parseFloat(gst_percent) || 0) : 0` and
    // its dropdown offers 0% explicitly. Falling through to the statutory rate here would
    // bill 18% on a service the hospital deliberately zero-rated.
    expect(resolveServiceGstPercent({ gst_applicable: true, gst_percent: 0, item_type: "service" })).toBe(0);
  });

  it("treats a null/blank percent with the toggle on as 0%", () => {
    expect(resolveServiceGstPercent({ gst_applicable: true, gst_percent: null, item_type: "service" })).toBe(0);
    expect(resolveServiceGstPercent({ gst_applicable: true, item_type: "service" })).toBe(0);
  });

  it("treats a missing toggle as off", () => {
    expect(resolveServiceGstPercent({ gst_percent: 18, item_type: "service" })).toBe(0);
    expect(resolveServiceGstPercent({ gst_applicable: null, gst_percent: 18 })).toBe(0);
  });

  it("ignores item_type entirely for hospital-authored rows", () => {
    expect(resolveServiceGstPercent({ gst_applicable: false, item_type: "cosmetic" })).toBe(0);
    expect(resolveServiceGstPercent({ gst_applicable: false, item_type: "pharmacy" })).toBe(0);
  });
});

describe("resolveServiceGstPercent — module-owned mirrors (source_table NOT NULL)", () => {
  // These are maintained by the catalog-sync triggers, which never set gst_applicable, so
  // every mirrored row carries the column default `false`. Reading the toggle for them would
  // zero out rates that are a matter of law.

  it("uses the module's explicit rate when one is set", () => {
    expect(resolveServiceGstPercent({ source_table: "drug_master", gst_percent: 5 })).toBe(5);
  });

  it("falls back to the statutory rate from item_type, ignoring gst_applicable=false", () => {
    expect(resolveServiceGstPercent({ source_table: "drug_master", gst_applicable: false, item_type: "pharmacy" })).toBe(12);
    expect(resolveServiceGstPercent({ source_table: "lab_tests", gst_applicable: false, item_type: "lab" })).toBe(0);
  });

  it("applies the room-rent threshold to a mirrored room row", () => {
    // The stated example: a non-ICU room above ₹5,000/day must attract 5%, and honouring the
    // unset toggle would zero it.
    expect(resolveServiceGstPercent({ source_table: "beds", item_type: "room_charge" }, 6000)).toBe(5);
    expect(resolveServiceGstPercent({ source_table: "beds", item_type: "room_charge" }, 4000)).toBe(0);
  });

  it("falls back to 'other' — 18% — when the mirror has no item_type", () => {
    expect(resolveServiceGstPercent({ source_table: "misc" })).toBe(18);
    expect(resolveServiceGstPercent({ source_table: "misc", item_type: null })).toBe(18);
  });

  it("accepts a numeric string percent from the JSON boundary", () => {
    expect(resolveServiceGstPercent({ source_table: "drug_master", gst_percent: "12" })).toBe(12);
  });

  it("treats a zero, negative or unparseable percent as unset and falls to statute", () => {
    // `hasConfigured` requires finite AND > 0. For a mirror, 0 means "the trigger did not set
    // one", not "zero-rated" — the opposite of what it means on a hospital-authored row.
    expect(resolveServiceGstPercent({ source_table: "drug_master", gst_percent: 0, item_type: "pharmacy" })).toBe(12);
    expect(resolveServiceGstPercent({ source_table: "drug_master", gst_percent: -5, item_type: "pharmacy" })).toBe(12);
    expect(resolveServiceGstPercent({ source_table: "drug_master", gst_percent: "abc", item_type: "pharmacy" })).toBe(12);
  });

  it("reaches opposite answers for the two populations on identical rows", () => {
    // The single assertion that proves the two rules have not been collapsed into one.
    const row = { gst_applicable: false, item_type: "pharmacy" as const };
    expect(resolveServiceGstPercent({ ...row })).toBe(0); // hospital-authored: toggle wins
    expect(resolveServiceGstPercent({ ...row, source_table: "drug_master" })).toBe(12); // mirror: statute wins
  });
});

describe("getRoomChargeGSTRate", () => {
  it.each(["icu", "nicu", "sicu", "picu", "ccu", "iccu"])(
    "exempts %s at any rate, per the CBIC clarification",
    (category) => {
      expect(getRoomChargeGSTRate(category, 50000)).toBe(0);
      expect(getRoomChargeGSTRate(category, 1)).toBe(0);
    },
  );

  it("matches the bed category case-insensitively", () => {
    expect(getRoomChargeGSTRate("ICU", 50000)).toBe(0);
    expect(getRoomChargeGSTRate("NICU", 20000)).toBe(0);
  });

  it("does NOT exempt HDU — it is not covered by the ICU clarification", () => {
    // Deliberate and load-bearing. HDU follows the ordinary rule, so a ₹6,000 HDU bed is 5%.
    // Adding "hdu" to the exempt set is an under-collection of tax on every HDU admission.
    expect(getRoomChargeGSTRate("hdu", 6000)).toBe(5);
    expect(getRoomChargeGSTRate("hdu", 5000)).toBe(0);
  });

  it.each([
    [4999, 0],
    [5000, 0],
    [5001, 5],
  ])("an ordinary room at ₹%i/day → %i%%", (rate, expected) => {
    expect(getRoomChargeGSTRate("general", rate)).toBe(expected);
    expect(getRoomChargeGSTRate("private", rate)).toBe(expected);
    expect(getRoomChargeGSTRate("deluxe", rate)).toBe(expected);
  });

  it("applies the ordinary rule when the bed category is missing", () => {
    expect(getRoomChargeGSTRate(null, 6000)).toBe(5);
    expect(getRoomChargeGSTRate(undefined, 6000)).toBe(5);
    expect(getRoomChargeGSTRate("", 4000)).toBe(0);
  });

  it("is deterministic from category and rate alone", () => {
    // The stated design: GST here is law, never dependent on whether a hospital happens to
    // have configured a matching service_rates row. The function takes no catalog input at
    // all, and this assertion pins that signature.
    expect(getRoomChargeGSTRate.length).toBe(2);
  });
});
