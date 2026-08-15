import { describe, it, expect } from "vitest";
import { durationHours } from "./shiftTiming";

/**
 * Cross-midnight is the case that broke payroll before BUG-P2-002 was fixed: the Shifts
 * screen persisted nothing at all, and when it was wired up the naive subtraction would have
 * stored a negative duration for every night shift. These tests exist so that never returns.
 */
describe("durationHours", () => {
  it("computes a same-day shift", () => {
    expect(durationHours("07:00", "14:00")).toBe(7);
    expect(durationHours("14:00", "21:00")).toBe(7);
  });

  it("wraps past midnight instead of going negative", () => {
    // The MOCK_DATA_BOOK "Night Relief" shift — 22:00 to 06:00 is eight hours.
    expect(durationHours("22:00", "06:00")).toBe(8);
    expect(durationHours("21:00", "07:00")).toBe(10);
    expect(durationHours("23:30", "00:30")).toBe(1);
  });

  it("never returns a negative duration", () => {
    const times = ["00:00", "06:00", "07:30", "12:00", "18:45", "22:00", "23:59"];
    for (const start of times) {
      for (const end of times) {
        expect(durationHours(start, end)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("handles half-hour boundaries to two decimal places", () => {
    expect(durationHours("09:00", "17:30")).toBe(8.5);
    expect(durationHours("09:15", "17:30")).toBe(8.25);
  });

  it("treats an equal start and end as a full day", () => {
    // The form rejects a zero-length shift before this is ever called, so the only
    // meaningful reading left of 22:00→22:00 is a 24h continuous shift.
    expect(durationHours("22:00", "22:00")).toBe(24);
  });

  it("does not throw on malformed input", () => {
    expect(durationHours("", "")).toBe(24);
    expect(Number.isNaN(durationHours("abc", "06:00"))).toBe(false);
  });
});
