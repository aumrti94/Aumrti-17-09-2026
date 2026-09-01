// Unit tests for gender-aware reference ranges and result flagging.
//
// Every case here is a defect that was live before this module existed: the flag
// sites read normal_min/normal_max only, so the sex-specific columns had no effect
// on any result, and several catalogue ranges produced the wrong flag outright.
import { describe, it, expect } from "vitest";
import {
  resolveReferenceRange,
  flagResult,
  formatReferenceRange,
  type FlagSource,
} from "./labReferenceRange";

const HB: FlagSource = {
  normal_min: 12.0, normal_max: 17.0,
  male_normal_min: 13.0, male_normal_max: 17.0,
  female_normal_min: 12.0, female_normal_max: 15.0,
  critical_low: 7.0, critical_high: 20.0,
};

// Post-fix HDL: a floor, no ceiling. High HDL is protective, not abnormal.
const HDL: FlagSource = {
  normal_min: 40, normal_max: null, critical_low: 20, critical_high: null,
};

// Red-cell index: a reference interval but no panic value.
const MCV: FlagSource = {
  normal_min: 80, normal_max: 100, critical_low: null, critical_high: null,
};

const CREAT: FlagSource = {
  normal_min: 0.6, normal_max: 1.3,
  male_normal_min: 0.7, male_normal_max: 1.3,
  female_normal_min: 0.6, female_normal_max: 1.1,
  critical_low: null, critical_high: 5.0,
};

describe("resolveReferenceRange", () => {
  it("uses the male interval for a male patient", () => {
    expect(resolveReferenceRange(HB, "male")).toEqual({ min: 13.0, max: 17.0, source: "male" });
  });

  it("uses the female interval for a female patient", () => {
    expect(resolveReferenceRange(HB, "female")).toEqual({ min: 12.0, max: 15.0, source: "female" });
  });

  it("accepts single-letter sex codes", () => {
    expect(resolveReferenceRange(HB, "M").source).toBe("male");
    expect(resolveReferenceRange(HB, "f").source).toBe("female");
  });

  it("falls back to the default interval when sex is unknown, blank or non-binary", () => {
    for (const g of [null, undefined, "", "other", "transgender", "unknown"]) {
      const r = resolveReferenceRange(HB, g);
      expect(r).toEqual({ min: 12.0, max: 17.0, source: "default" });
    }
  });

  it("falls back when the test has no sex-specific range configured", () => {
    expect(resolveReferenceRange(MCV, "male")).toEqual({ min: 80, max: 100, source: "default" });
  });

  it("fills a missing sex-specific bound from the default rather than dropping it", () => {
    const halfConfigured = { normal_min: 5, normal_max: 50, male_normal_max: 60 };
    expect(resolveReferenceRange(halfConfigured, "male")).toEqual({ min: 5, max: 60, source: "male" });
  });

  it("returns an empty range for a qualitative test", () => {
    expect(resolveReferenceRange({ normal_min: null, normal_max: null }, "male"))
      .toEqual({ min: null, max: null, source: "default" });
  });
});

describe("flagResult — sex-specific intervals", () => {
  // The headline defect. With the old merged 12.0-17.5 band this returned "N".
  it("flags Hb 12.5 g/dL as Low for a male", () => {
    expect(flagResult(HB, 12.5, "male")).toBe("L");
  });

  it("flags the same Hb 12.5 g/dL as Normal for a female", () => {
    expect(flagResult(HB, 12.5, "female")).toBe("N");
  });

  it("flags Hb 16 g/dL as High for a female but Normal for a male", () => {
    expect(flagResult(HB, 16, "female")).toBe("H");
    expect(flagResult(HB, 16, "male")).toBe("N");
  });

  it("flags creatinine 1.2 mg/dL as High for a female but Normal for a male", () => {
    expect(flagResult(CREAT, 1.2, "female")).toBe("H");
    expect(flagResult(CREAT, 1.2, "male")).toBe("N");
  });
});

describe("flagResult — critical values", () => {
  it("flags a creatinine of 8.0 as critical high", () => {
    // Was critical_high 10.0 in the old seed: a dialysis-level creatinine raised
    // no alert whatsoever.
    expect(flagResult(CREAT, 8.0, "male")).toBe("CH");
  });

  it("flags Hb 6.5 as critical low regardless of sex", () => {
    expect(flagResult(HB, 6.5, "male")).toBe("CL");
    expect(flagResult(HB, 6.5, "female")).toBe("CL");
  });

  it("prefers critical over high when the bounds overlap", () => {
    // Troponin I: the upper reference limit IS the alert threshold.
    const trop: FlagSource = { normal_min: 0, normal_max: 0.04, critical_low: null, critical_high: 0.04 };
    expect(flagResult(trop, 0.9)).toBe("CH");
  });

  it("never returns a critical flag for an analyte with no panic value", () => {
    for (const v of [40, 62, 130, 200]) {
      expect(flagResult(MCV, v)).not.toBe("CL");
      expect(flagResult(MCV, v)).not.toBe("CH");
    }
  });

  it("flags a very low MCV as Low, not critical", () => {
    expect(flagResult(MCV, 62)).toBe("L");
  });
});

describe("flagResult — one-sided intervals", () => {
  it("treats a high HDL as normal", () => {
    // The old 40-60 band flagged every protective HDL as High.
    expect(flagResult(HDL, 75)).toBe("N");
    expect(flagResult(HDL, 95)).toBe("N");
  });

  it("still flags a low HDL", () => {
    expect(flagResult(HDL, 32)).toBe("L");
    expect(flagResult(HDL, 18)).toBe("CL");
  });
});

describe("flagResult — guards", () => {
  it("returns null for a missing test, missing value or non-numeric value", () => {
    expect(flagResult(null, 5)).toBeNull();
    expect(flagResult(HB, null)).toBeNull();
    expect(flagResult(HB, Number.NaN)).toBeNull();
  });

  it("returns Normal for a qualitative test with a numeric value", () => {
    expect(flagResult({ normal_min: null, normal_max: null }, 1)).toBe("N");
  });
});

describe("formatReferenceRange", () => {
  it("prints the sex-appropriate range", () => {
    expect(formatReferenceRange(HB, "male")).toBe("13-17");
    expect(formatReferenceRange(HB, "female")).toBe("12-15");
  });

  it("prints a one-sided range with the correct operator", () => {
    expect(formatReferenceRange(HDL)).toBe(">= 40");
    expect(formatReferenceRange({ normal_min: null, normal_max: 150 })).toBe("<= 150");
  });

  it("returns null for a qualitative test so the caller can omit the column", () => {
    expect(formatReferenceRange({ normal_min: null, normal_max: null })).toBeNull();
  });
});
