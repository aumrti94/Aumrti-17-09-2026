import { describe, it, expect } from "vitest";
import { resolveReferenceRange, flagResult, formatReferenceRange } from "@/lib/labReferenceRange";

// Haemoglobin-shaped fixture: a merged 12.0-17.5 band would read a male at 12.5 as
// Normal when he is actually anaemic — exactly the bug this module exists to fix.
const hb = {
  normal_min: 12.0,
  normal_max: 17.5,
  male_normal_min: 13.5,
  male_normal_max: 17.5,
  female_normal_min: 12.0,
  female_normal_max: 15.5,
};

describe("resolveReferenceRange — Lab Test Master's male/female ranges", () => {
  it("a male patient gets the configured male-specific range, not the merged default", () => {
    expect(resolveReferenceRange(hb, "male")).toEqual({ min: 13.5, max: 17.5, source: "male" });
  });

  it("a female patient gets a different resolved range for the identical test", () => {
    expect(resolveReferenceRange(hb, "female")).toEqual({ min: 12.0, max: 15.5, source: "female" });
  });

  it("male and female ranges genuinely differ for the same test row — the setting actually matters", () => {
    const male = resolveReferenceRange(hb, "male");
    const female = resolveReferenceRange(hb, "female");
    expect(male).not.toEqual(female);
  });

  it("accepts single-letter gender codes ('m'/'f')", () => {
    expect(resolveReferenceRange(hb, "M").source).toBe("male");
    expect(resolveReferenceRange(hb, "F").source).toBe("female");
  });

  it("falls back to the sex-unknown default for other/unknown/blank gender — never guesses", () => {
    expect(resolveReferenceRange(hb, "other")).toEqual({ min: 12.0, max: 17.5, source: "default" });
    expect(resolveReferenceRange(hb, null)).toEqual({ min: 12.0, max: 17.5, source: "default" });
    expect(resolveReferenceRange(hb, "")).toEqual({ min: 12.0, max: 17.5, source: "default" });
  });

  it("falls back to the default range when no sex-specific bound is configured at all, even if sex is known", () => {
    const noSexSpecific = { normal_min: 4.0, normal_max: 11.0 };
    expect(resolveReferenceRange(noSexSpecific, "male")).toEqual({ min: 4.0, max: 11.0, source: "default" });
  });

  it("a half-configured sex range (only min set) uses that bound and falls back for the other — the one-sided-analyte case", () => {
    const hdl = { normal_min: 40, normal_max: null, male_normal_min: 40, male_normal_max: null };
    expect(resolveReferenceRange(hdl, "male")).toEqual({ min: 40, max: null, source: "male" });
  });

  it("returns nulls for a missing test row", () => {
    expect(resolveReferenceRange(null)).toEqual({ min: null, max: null, source: "default" });
  });
});

describe("flagResult — critical evaluated before high/low, never sex-specific", () => {
  const potassium = { normal_min: 3.5, normal_max: 5.0, critical_low: 2.5, critical_high: 6.5 };

  it("flags a critical-high value as CH even though it is also above the normal max", () => {
    expect(flagResult(potassium, 6.8)).toBe("CH");
  });

  it("flags a critical-low value as CL", () => {
    expect(flagResult(potassium, 2.0)).toBe("CL");
  });

  it("a value inside the critical band but outside normal is a plain H/L, not critical", () => {
    expect(flagResult(potassium, 5.5)).toBe("H");
    expect(flagResult(potassium, 3.0)).toBe("L");
  });

  it("a value inside the normal band flags Normal", () => {
    expect(flagResult(potassium, 4.2)).toBe("N");
  });

  it("critical thresholds never vary by sex — same flag for male and female at the identical value", () => {
    expect(flagResult(potassium, 6.8, "male")).toBe("CH");
    expect(flagResult(potassium, 6.8, "female")).toBe("CH");
  });

  it("a value that is Normal by the merged range but abnormal by the sex-specific range flags correctly — the exact clinical bug", () => {
    // 12.5 g/dL: Normal under a merged 12.0-17.5 band, but Low for a male (13.5 floor)
    expect(flagResult(hb, 12.5, "male")).toBe("L");
    expect(flagResult(hb, 12.5, "female")).toBe("N");
  });

  it("returns null for a missing test, null value, or NaN value rather than a false flag", () => {
    expect(flagResult(null, 5)).toBeNull();
    expect(flagResult(potassium, null)).toBeNull();
    expect(flagResult(potassium, NaN)).toBeNull();
  });
});

describe("formatReferenceRange — printed on the report per NABL/ISO 15189", () => {
  it("formats a two-sided range as 'min-max'", () => {
    expect(formatReferenceRange(hb, "male")).toBe("13.5-17.5");
  });

  it("a different gender produces different printed text for the same test", () => {
    expect(formatReferenceRange(hb, "male")).not.toBe(formatReferenceRange(hb, "female"));
  });

  it("formats a floor-only range as '>= min'", () => {
    expect(formatReferenceRange({ normal_min: 40, normal_max: null })).toBe(">= 40");
  });

  it("formats a ceiling-only range as '<= max'", () => {
    expect(formatReferenceRange({ normal_min: null, normal_max: 5 })).toBe("<= 5");
  });

  it("returns null for a qualitative test with no configured bounds, so the column can be omitted", () => {
    expect(formatReferenceRange({ normal_min: null, normal_max: null })).toBeNull();
  });
});
