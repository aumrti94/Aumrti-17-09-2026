import { describe, it, expect } from "vitest";
import {
  resolveBillingDateRange,
  toLocalISODate,
  endOfDayISO,
  describeBillingDateRange,
  isAllTimeRange,
  ALL_TIME_RANGE,
  BILLING_DATE_PRESETS,
} from "./billingDateRange";

// 20 Jul 2026, 02:15 local — deliberately before 05:30 so any UTC-based date maths
// would roll back to the 19th in IST.
const earlyMorning = new Date(2026, 6, 20, 2, 15);
const midday = new Date(2026, 6, 20, 12, 0);

describe("toLocalISODate", () => {
  it("uses the local calendar day, not UTC", () => {
    expect(toLocalISODate(earlyMorning)).toBe("2026-07-20");
  });

  it("zero-pads month and day", () => {
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("resolveBillingDateRange", () => {
  it("today is a single day", () => {
    expect(resolveBillingDateRange("today", "", "", midday)).toEqual({
      start: "2026-07-20", end: "2026-07-20",
    });
  });

  it("today does not roll back before 05:30 in IST", () => {
    // The bug this guards: toISOString() would have said 2026-07-19.
    expect(resolveBillingDateRange("today", "", "", earlyMorning).start).toBe("2026-07-20");
  });

  it("yesterday is a single day and does not run through to today", () => {
    expect(resolveBillingDateRange("yesterday", "", "", midday)).toEqual({
      start: "2026-07-19", end: "2026-07-19",
    });
  });

  it("week covers 7 days inclusive of today", () => {
    expect(resolveBillingDateRange("week", "", "", midday)).toEqual({
      start: "2026-07-14", end: "2026-07-20",
    });
  });

  it("month covers 30 days inclusive of today", () => {
    expect(resolveBillingDateRange("month", "", "", midday)).toEqual({
      start: "2026-06-21", end: "2026-07-20",
    });
  });

  it("custom uses the given bounds", () => {
    expect(resolveBillingDateRange("custom", "2026-07-01", "2026-07-15", midday)).toEqual({
      start: "2026-07-01", end: "2026-07-15",
    });
  });

  it("custom with a blank end is that single day", () => {
    expect(resolveBillingDateRange("custom", "2026-07-03", "", midday)).toEqual({
      start: "2026-07-03", end: "2026-07-03",
    });
  });

  it("custom with a blank start falls back to today", () => {
    expect(resolveBillingDateRange("custom", "", "", midday)).toEqual({
      start: "2026-07-20", end: "2026-07-20",
    });
  });

  it("swaps a reversed custom range instead of returning an empty window", () => {
    expect(resolveBillingDateRange("custom", "2026-07-15", "2026-07-01", midday)).toEqual({
      start: "2026-07-01", end: "2026-07-15",
    });
  });
});

describe("endOfDayISO", () => {
  it("extends to the end of the day so timestamptz rows on the final day are included", () => {
    expect(endOfDayISO("2026-07-20")).toBe("2026-07-20T23:59:59.999");
  });
});

describe("describeBillingDateRange", () => {
  it("labels the current single day as Today", () => {
    expect(describeBillingDateRange({ start: "2026-07-20", end: "2026-07-20" }, midday)).toBe("Today");
  });

  it("labels another single day by date", () => {
    expect(describeBillingDateRange({ start: "2026-07-03", end: "2026-07-03" }, midday)).toBe("03 Jul");
  });

  it("labels a multi-day range with both ends", () => {
    expect(describeBillingDateRange({ start: "2026-07-01", end: "2026-07-15" }, midday)).toBe("01 Jul – 15 Jul");
  });

  it("names the all-time window rather than printing its sentinel dates", () => {
    expect(describeBillingDateRange(ALL_TIME_RANGE, midday)).toBe("All time");
  });
});

/**
 * Every other preset is a rolling or single-day window, so an unpaid bill drops out of the
 * queue once it ages past 30 days — money owed does not expire with the period it was billed
 * in. "All time" is the escape hatch, and it must genuinely contain everything: a range that
 * merely reached back a few years would reintroduce the same disappearing act later.
 */
describe("the all-time preset", () => {
  it("is offered as a preset", () => {
    expect(BILLING_DATE_PRESETS.map((p) => p.key)).toContain("all");
  });

  it("resolves to the all-time window whatever custom dates are lying around", () => {
    expect(resolveBillingDateRange("all", "2026-07-01", "2026-07-02", midday)).toEqual(ALL_TIME_RANGE);
  });

  it("starts early enough to contain any bill the system could hold", () => {
    expect(ALL_TIME_RANGE.start < "2000-01-01").toBe(true);
  });

  it("ends in the future so a post-dated bill is not silently excluded", () => {
    expect(ALL_TIME_RANGE.end > "2026-07-20").toBe(true);
  });

  it("is recognised by isAllTimeRange, and real reporting periods are not", () => {
    expect(isAllTimeRange(ALL_TIME_RANGE)).toBe(true);
    expect(isAllTimeRange(resolveBillingDateRange("today", undefined, undefined, midday))).toBe(false);
    expect(isAllTimeRange(resolveBillingDateRange("month", undefined, undefined, midday))).toBe(false);
  });
});

/**
 * Pins the rolling semantics the labels promise. These keys are called "Last 7 days" and
 * "Last 30 days" precisely because they are NOT calendar week/month — the bill queue used to
 * label them "This Week"/"This Month", which said a July bill would vanish on 1 August when
 * in truth it survives until it is 30 days old.
 */
describe("rolling windows", () => {
  it("month reaches back 30 days inclusive of today, not to the 1st of the month", () => {
    expect(resolveBillingDateRange("month", undefined, undefined, midday)).toEqual({
      start: "2026-06-21", end: "2026-07-20",
    });
  });

  it("week reaches back 7 days inclusive of today, not to Monday", () => {
    expect(resolveBillingDateRange("week", undefined, undefined, midday)).toEqual({
      start: "2026-07-14", end: "2026-07-20",
    });
  });
});
