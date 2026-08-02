import { describe, it, expect } from "vitest";
import {
  rangeContainsToday,
  accruedStayDays,
  computeAccrual,
} from "./liveAdmissionAccrual";
import { ALL_TIME_RANGE, resolveBillingDateRange } from "./billingDateRange";

// 31 Jul 2026, midday — the day the reported problem appeared.
const now = new Date(2026, 6, 31, 12, 0);

describe("rangeContainsToday", () => {
  it("includes today, so a still-growing bill belongs to it", () => {
    expect(rangeContainsToday(resolveBillingDateRange("today", undefined, undefined, now), now)).toBe(true);
    expect(rangeContainsToday(resolveBillingDateRange("week", undefined, undefined, now), now)).toBe(true);
    expect(rangeContainsToday(resolveBillingDateRange("month", undefined, undefined, now), now)).toBe(true);
    expect(rangeContainsToday(ALL_TIME_RANGE, now)).toBe(true);
  });

  it("excludes historical windows — yesterday's totals must not change tomorrow", () => {
    expect(rangeContainsToday(resolveBillingDateRange("yesterday", undefined, undefined, now), now)).toBe(false);
    expect(rangeContainsToday({ start: "2026-07-01", end: "2026-07-15" }, now)).toBe(false);
  });

  it("excludes a window that has not started yet", () => {
    expect(rangeContainsToday({ start: "2026-08-01", end: "2026-08-31" }, now)).toBe(false);
  });

  it("includes a window whose final day is today", () => {
    expect(rangeContainsToday({ start: "2026-07-01", end: "2026-07-31" }, now)).toBe(true);
  });
});

describe("accruedStayDays", () => {
  it("counts a patient admitted on 19 Jul as being on day 12 on 31 Jul", () => {
    expect(accruedStayDays("2026-07-19T12:00:00", now)).toBe(12);
  });

  it("counts the day of admission as one day, never zero", () => {
    expect(accruedStayDays("2026-07-31T09:00:00", now)).toBe(1);
  });

  it("returns 0 when there is no admission date to count from", () => {
    expect(accruedStayDays(null, now)).toBe(0);
    expect(accruedStayDays("not a date", now)).toBe(0);
  });
});

/**
 * The whole point of the projection is that it agrees with what the sweep will eventually
 * post. If it counted days differently, or priced them differently, the queue would show one
 * number and the bill another — which is worse than showing nothing.
 */
describe("computeAccrual", () => {
  it("projects only the days the bill has not been charged for", () => {
    // Admitted 19 Jul, bill last swept at 10 days, room ₹500/day.
    expect(computeAccrual({
      admittedAt: "2026-07-19T12:00:00",
      billedDays: 10,
      roomRate: 500,
      nursingRate: 0,
      now,
    })).toEqual({ accruedDays: 12, unbilledDays: 2, unbilledAmount: 1000 });
  });

  it("prices nursing alongside room when the ward charges it", () => {
    expect(computeAccrual({
      admittedAt: "2026-07-19T12:00:00",
      billedDays: 10,
      roomRate: 500,
      nursingRate: 300,
      now,
    })).toEqual({ accruedDays: 12, unbilledDays: 2, unbilledAmount: 1600 });
  });

  it("projects the whole stay when nothing has been billed yet", () => {
    expect(computeAccrual({
      admittedAt: "2026-07-19T12:00:00",
      billedDays: 0,
      roomRate: 500,
      nursingRate: 0,
      now,
    })).toMatchObject({ unbilledDays: 12, unbilledAmount: 6000 });
  });

  it("shows nothing accrued when the bill is already up to date", () => {
    expect(computeAccrual({
      admittedAt: "2026-07-19T12:00:00",
      billedDays: 12,
      roomRate: 500,
      nursingRate: 300,
      now,
    })).toEqual({ accruedDays: 12, unbilledDays: 0, unbilledAmount: 0 });
  });

  it("never subtracts money when the bill was charged beyond the stay", () => {
    // A corrected discharge date or a hand-edited quantity can bill more days than elapsed.
    // That is a reason to show zero accrued, not to offer the patient a credit.
    expect(computeAccrual({
      admittedAt: "2026-07-19T12:00:00",
      billedDays: 20,
      roomRate: 500,
      nursingRate: 0,
      now,
    })).toEqual({ accruedDays: 12, unbilledDays: 0, unbilledAmount: 0 });
  });

  it("treats a negative rate as zero rather than reducing the bill", () => {
    expect(computeAccrual({
      admittedAt: "2026-07-19T12:00:00",
      billedDays: 10,
      roomRate: -500,
      nursingRate: 0,
      now,
    }).unbilledAmount).toBe(0);
  });

  it("accrues nothing without an admission date", () => {
    expect(computeAccrual({
      admittedAt: null,
      billedDays: 0,
      roomRate: 500,
      nursingRate: 0,
      now,
    })).toEqual({ accruedDays: 0, unbilledDays: 0, unbilledAmount: 0 });
  });
});
