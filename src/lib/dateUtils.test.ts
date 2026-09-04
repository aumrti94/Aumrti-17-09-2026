import { describe, it, expect } from "vitest";
import { formatDateIST, formatDateTimeIST, formatTimeIST } from "./dateUtils";

describe("formatDateIST / formatDateTimeIST / formatTimeIST — UTC storage displayed in IST", () => {
  it("converts a UTC morning timestamp to its IST (+5:30) date and time", () => {
    // 08:30 UTC == 14:00 IST, same calendar day.
    expect(formatDateIST("2026-04-15T08:30:00Z")).toBe("15 Apr 2026");
    expect(formatTimeIST("2026-04-15T08:30:00Z")).toBe("14:00");
    expect(formatDateTimeIST("2026-04-15T08:30:00Z")).toBe("15 Apr 2026, 14:00");
  });

  it("rolls the calendar date forward when the IST offset crosses midnight", () => {
    // 20:00 UTC + 5:30 == 01:30 the next day in IST.
    expect(formatDateIST("2026-04-15T20:00:00Z")).toBe("16 Apr 2026");
    expect(formatTimeIST("2026-04-15T20:00:00Z")).toBe("01:30");
  });

  it("returns an em dash for a missing timestamp", () => {
    expect(formatDateIST(null)).toBe("—");
    expect(formatDateIST(undefined)).toBe("—");
    expect(formatDateTimeIST(null)).toBe("—");
    expect(formatTimeIST(null)).toBe("—");
  });

  it("returns an em dash rather than throwing on an unparseable timestamp", () => {
    expect(formatDateIST("not-a-date")).toBe("—");
    expect(formatDateTimeIST("not-a-date")).toBe("—");
    expect(formatTimeIST("not-a-date")).toBe("—");
  });
});
