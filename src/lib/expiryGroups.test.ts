import { describe, it, expect } from "vitest";
import { getGroup } from "./expiryGroups";

function daysFromNow(days: number): string {
  // Build the YYYY-MM-DD string from local date components — toISOString() converts
  // to UTC first, which shifts the date by a day in timezones ahead of UTC (e.g. IST).
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("getGroup — drug batch expiry bucketing", () => {
  it("buckets a past date as expired", () => {
    expect(getGroup(daysFromNow(-1))).toBe("expired");
  });

  it("buckets today as not expired (0 days left is still on-shelf)", () => {
    expect(getGroup(daysFromNow(0))).toBe("critical");
  });

  it("buckets 30 days out as critical, the boundary of the critical window", () => {
    expect(getGroup(daysFromNow(30))).toBe("critical");
  });

  it("buckets 31 days out as warning", () => {
    expect(getGroup(daysFromNow(31))).toBe("warning");
  });

  it("buckets 90 days out as warning, the boundary of the warning window", () => {
    expect(getGroup(daysFromNow(90))).toBe("warning");
  });

  it("buckets anything past 90 days as ok", () => {
    expect(getGroup(daysFromNow(91))).toBe("ok");
    expect(getGroup(daysFromNow(365))).toBe("ok");
  });
});
