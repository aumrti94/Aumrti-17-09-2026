import { describe, it, expect } from "vitest";
import {
  attainment,
  bandStatus,
  isOnTarget,
  formatIndicatorValue,
  formatFraction,
  deltaVsPrevious,
  targetPrefix,
} from "./qualityIndicators";

describe("attainment", () => {
  it("scores higher_is_better proportionally to target", () => {
    expect(attainment(72, 90, "higher_is_better")).toBe(80);
    expect(attainment(90, 90, "higher_is_better")).toBe(100);
  });

  it("caps higher_is_better at 100 so overachievement cannot inflate a criterion", () => {
    expect(attainment(180, 90, "higher_is_better")).toBe(100);
  });

  it("gives full marks to lower_is_better at or under target", () => {
    expect(attainment(1.5, 2, "lower_is_better")).toBe(100);
    expect(attainment(2, 2, "lower_is_better")).toBe(100);
  });

  it("degrades lower_is_better proportionally when over target", () => {
    expect(attainment(4, 2, "lower_is_better")).toBe(50);
    expect(attainment(8, 2, "lower_is_better")).toBe(25);
  });

  // Sentinel events: target 0, actual 0 is perfect compliance, not a divide-by-zero.
  it("treats zero as perfect for lower_is_better even when the target is zero", () => {
    expect(attainment(0, 0, "lower_is_better")).toBe(100);
  });

  it("returns null rather than guessing when the target is zero for higher_is_better", () => {
    expect(attainment(5, 0, "higher_is_better")).toBeNull();
  });

  it("returns null for a missing value or target", () => {
    expect(attainment(null, 90, "higher_is_better")).toBeNull();
    expect(attainment(72, null, "higher_is_better")).toBeNull();
    expect(attainment(undefined, undefined, "lower_is_better")).toBeNull();
  });

  // A volume metric has no good direction, so it must never score a criterion.
  it("never scores a neutral indicator", () => {
    expect(attainment(42, 10, "neutral")).toBeNull();
  });
});

describe("bandStatus", () => {
  it("uses inclusive boundaries at exactly 80 and 50", () => {
    expect(bandStatus(80)).toBe("compliant");
    expect(bandStatus(79.99)).toBe("partially_compliant");
    expect(bandStatus(50)).toBe("partially_compliant");
    expect(bandStatus(49.99)).toBe("non_compliant");
  });

  it("reports not_assessed for absent scores instead of failing them", () => {
    expect(bandStatus(null)).toBe("not_assessed");
    expect(bandStatus(undefined)).toBe("not_assessed");
    expect(bandStatus(NaN)).toBe("not_assessed");
  });

  it("bands the extremes", () => {
    expect(bandStatus(100)).toBe("compliant");
    expect(bandStatus(0)).toBe("non_compliant");
  });
});

describe("isOnTarget", () => {
  it("respects direction", () => {
    expect(isOnTarget(85, 80, "higher_is_better")).toBe(true);
    expect(isOnTarget(75, 80, "higher_is_better")).toBe(false);
    expect(isOnTarget(1, 2, "lower_is_better")).toBe(true);
    expect(isOnTarget(3, 2, "lower_is_better")).toBe(false);
  });

  it("cannot say without both a value and a target", () => {
    expect(isOnTarget(null, 80, "higher_is_better")).toBeNull();
    expect(isOnTarget(85, null, "higher_is_better")).toBeNull();
    expect(isOnTarget(85, 80, "neutral")).toBeNull();
  });
});

describe("formatIndicatorValue", () => {
  // The old tab called Number(null).toFixed() and printed NaN on screen.
  it("renders an em-dash for a missing value, never NaN or zero", () => {
    expect(formatIndicatorValue(null, "%")).toBe("—");
    expect(formatIndicatorValue(undefined, "%")).toBe("—");
    expect(formatIndicatorValue(NaN, "%")).toBe("—");
  });

  it("keeps a negative NPS negative", () => {
    expect(formatIndicatorValue(-23, "score")).toBe("-23");
  });

  it("renders per-1000 rates to two decimals", () => {
    expect(formatIndicatorValue(1.2345, "/1000")).toBe("1.23");
    expect(formatIndicatorValue(0.5, "/100")).toBe("0.5");
  });

  it("rounds percentages to one decimal and counts to whole numbers", () => {
    expect(formatIndicatorValue(83.46, "%")).toBe("83.5");
    expect(formatIndicatorValue(2.7, "count")).toBe("3");
    expect(formatIndicatorValue(37.4, "min")).toBe("37");
  });

  it("renders zero as zero, not as missing", () => {
    expect(formatIndicatorValue(0, "%")).toBe("0");
    expect(formatIndicatorValue(0, "count")).toBe("0");
  });

  it("renders a nurse:patient ratio to two decimals", () => {
    expect(formatIndicatorValue(0.2456, "ratio")).toBe("0.25");
  });

  it("handles hours, days and kilograms at one decimal", () => {
    expect(formatIndicatorValue(4.28, "hrs")).toBe("4.3");
    expect(formatIndicatorValue(3.94, "days")).toBe("3.9");
    expect(formatIndicatorValue(12.55, "kg")).toBe("12.6");
  });
});

describe("formatFraction", () => {
  it("shows the arithmetic behind a rate", () => {
    expect(formatFraction(12, 4318, "patient-days")).toBe("12 / 4,318 patient-days");
  });

  it("omits the label when none is given", () => {
    expect(formatFraction(3, 40)).toBe("3 / 40");
  });

  it("returns null when there is no real denominator", () => {
    expect(formatFraction(3, 0, "device-days")).toBeNull();
    expect(formatFraction(3, null, "device-days")).toBeNull();
    expect(formatFraction(null, 40, "device-days")).toBeNull();
  });

  it("rounds fractional device-day denominators for display", () => {
    expect(formatFraction(1, 24.67, "central-line days")).toBe("1 / 24.7 central-line days");
  });
});

describe("deltaVsPrevious", () => {
  const series = [
    { period_start: "2026-05-01", value: 10 },
    { period_start: "2026-06-01", value: 12 },
    { period_start: "2026-07-01", value: 9 },
  ];

  it("compares the two most recent periods", () => {
    expect(deltaVsPrevious(series, "lower_is_better")?.absolute).toBe(-3);
  });

  it("reads a fall as improvement for lower_is_better and regression for higher", () => {
    expect(deltaVsPrevious(series, "lower_is_better")?.improved).toBe(true);
    expect(deltaVsPrevious(series, "higher_is_better")?.improved).toBe(false);
  });

  it("sorts oldest-first regardless of input order", () => {
    expect(deltaVsPrevious([...series].reverse(), "lower_is_better")?.absolute).toBe(-3);
  });

  it("ignores periods with no value", () => {
    const withGap = [
      { period_start: "2026-05-01", value: 10 },
      { period_start: "2026-06-01", value: null },
      { period_start: "2026-07-01", value: 14 },
    ];
    expect(deltaVsPrevious(withGap, "higher_is_better")?.absolute).toBe(4);
  });

  it("returns null when there is nothing to compare", () => {
    expect(deltaVsPrevious([{ period_start: "2026-07-01", value: 9 }], "lower_is_better")).toBeNull();
    expect(deltaVsPrevious([], "lower_is_better")).toBeNull();
  });

  it("reports no improvement direction for a flat series or a neutral indicator", () => {
    const flat = [
      { period_start: "2026-06-01", value: 5 },
      { period_start: "2026-07-01", value: 5 },
    ];
    expect(deltaVsPrevious(flat, "lower_is_better")).toEqual({ absolute: 0, improved: null });
    expect(deltaVsPrevious(series, "neutral")?.improved).toBeNull();
  });
});

describe("targetPrefix", () => {
  it("matches the comparison the direction implies", () => {
    expect(targetPrefix("higher_is_better")).toBe("≥");
    expect(targetPrefix("lower_is_better")).toBe("≤");
    expect(targetPrefix("neutral")).toBe("");
  });
});
