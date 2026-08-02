import { describe, it, expect } from "vitest";
import {
  checkDayCareDischargeTime,
  fromISTLocalInput,
  isLateReasonAcceptable,
  istDateKey,
  toISTLocalInput,
} from "./dayCareLateDischarge";

// 2026-07-24 20:30 IST === 2026-07-24T15:00:00Z
const ADMITTED_IST_EVENING = "2026-07-24T15:00:00.000Z";

describe("istDateKey", () => {
  it("uses the IST calendar day, not UTC's", () => {
    // 23:30 IST on the 24th is still the 23rd in UTC — the trigger judges the IST day.
    expect(istDateKey("2026-07-24T18:00:00.000Z")).toBe("2026-07-24");
  });

  it("rolls over at IST midnight, not UTC midnight", () => {
    expect(istDateKey("2026-07-24T18:31:00.000Z")).toBe("2026-07-25"); // 00:01 IST
    expect(istDateKey("2026-07-24T18:29:00.000Z")).toBe("2026-07-24"); // 23:59 IST
  });
});

describe("IST datetime-local round trip", () => {
  it("interprets the field value as IST regardless of the browser zone", () => {
    expect(fromISTLocalInput("2026-07-24T20:30")).toBe(ADMITTED_IST_EVENING);
  });

  it("round-trips an instant back to the same field value", () => {
    expect(toISTLocalInput(ADMITTED_IST_EVENING)).toBe("2026-07-24T20:30");
  });

  it("returns null for empty or malformed input rather than an Invalid Date", () => {
    expect(fromISTLocalInput("")).toBeNull();
    expect(fromISTLocalInput("not-a-date")).toBeNull();
    expect(fromISTLocalInput("2026-07-24")).toBeNull();
  });
});

describe("checkDayCareDischargeTime", () => {
  const now = "2026-07-25T06:00:00.000Z"; // 11:30 IST on the 25th

  it("passes a same-IST-day discharge with no override needed", () => {
    const r = checkDayCareDischargeTime(ADMITTED_IST_EVENING, "2026-07-24T17:00:00.000Z", now);
    expect(r.error).toBeNull();
    expect(r.crossesDay).toBe(false);
  });

  it("still passes at 23:59 IST on the admission day", () => {
    const r = checkDayCareDischargeTime(ADMITTED_IST_EVENING, "2026-07-24T18:29:00.000Z", now);
    expect(r.crossesDay).toBe(false);
    expect(r.error).toBeNull();
  });

  it("flags one minute past IST midnight as crossing the day", () => {
    const r = checkDayCareDischargeTime(ADMITTED_IST_EVENING, "2026-07-24T18:31:00.000Z", now);
    expect(r.crossesDay).toBe(true);
    expect(r.error).toBeNull();
    expect(r.admittedDate).toBe("2026-07-24");
    expect(r.dischargeDate).toBe("2026-07-25");
  });

  it("flags the next-morning discharge that used to be impossible", () => {
    const r = checkDayCareDischargeTime(ADMITTED_IST_EVENING, now, now);
    expect(r.crossesDay).toBe(true);
    expect(r.error).toBeNull();
  });

  it("rejects a discharge before admission", () => {
    const r = checkDayCareDischargeTime(ADMITTED_IST_EVENING, "2026-07-24T10:00:00.000Z", now);
    expect(r.error).toMatch(/before the admission/i);
    expect(r.crossesDay).toBe(false);
  });

  it("rejects a discharge in the future", () => {
    const r = checkDayCareDischargeTime(ADMITTED_IST_EVENING, "2026-07-26T06:00:00.000Z", now);
    expect(r.error).toMatch(/future/i);
  });

  it("tolerates a minute of clock slack so seeding the field is not 'the future'", () => {
    const r = checkDayCareDischargeTime(ADMITTED_IST_EVENING, "2026-07-25T06:00:30.000Z", now);
    expect(r.error).toBeNull();
  });

  it("refuses when the patient was never admitted", () => {
    const r = checkDayCareDischargeTime(null, now, now);
    expect(r.error).toMatch(/not been admitted/i);
    expect(r.crossesDay).toBe(false);
  });

  it("refuses an unparseable discharge time", () => {
    const r = checkDayCareDischargeTime(ADMITTED_IST_EVENING, "banana", now);
    expect(r.error).toMatch(/valid discharge date/i);
  });
});

describe("isLateReasonAcceptable", () => {
  it("rejects blank and token justifications", () => {
    expect(isLateReasonAcceptable("")).toBe(false);
    expect(isLateReasonAcceptable("   ")).toBe(false);
    expect(isLateReasonAcceptable("ok")).toBe(false);
  });

  it("accepts a real sentence", () => {
    expect(isLateReasonAcceptable("Extended recovery after procedure")).toBe(true);
  });
});
