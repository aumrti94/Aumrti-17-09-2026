import { describe, it, expect } from "vitest";
import { formatDateForQuery } from "./otDates";

describe("formatDateForQuery — local-date formatting for OT schedule queries", () => {
  it("formats a Date object as YYYY-MM-DD in local time", () => {
    // Deliberately not noon/midnight-UTC-safe — this is exactly the toISOString()
    // UTC-shift bug this helper exists to avoid.
    const d = new Date(2026, 2, 5); // March 5 2026, local midnight
    expect(formatDateForQuery(d)).toBe("2026-03-05");
  });

  it("pads single-digit month and day", () => {
    const d = new Date(2026, 0, 9); // Jan 9
    expect(formatDateForQuery(d)).toBe("2026-01-09");
  });

  it("accepts a plain YYYY-MM-DD string and returns it unchanged", () => {
    expect(formatDateForQuery("2026-07-15")).toBe("2026-07-15");
  });

  it("accepts an ISO datetime string and extracts the local calendar date", () => {
    expect(formatDateForQuery("2026-07-15T00:00:00")).toBe("2026-07-15");
  });
});
