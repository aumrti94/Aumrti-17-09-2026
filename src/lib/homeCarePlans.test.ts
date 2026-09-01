import { describe, it, expect } from "vitest";
import { buildVisitSchedule, visitStepDays, HOME_CARE_FREQUENCIES } from "./homeCarePlans";

const base = {
  hospitalId: "hosp-1",
  planId: "plan-1",
  patientId: "pat-1",
};

describe("visitStepDays", () => {
  it("maps each supported frequency to a day step", () => {
    expect(visitStepDays("daily")).toBe(1);
    expect(visitStepDays("alternate_days")).toBe(2);
    expect(visitStepDays("weekly")).toBe(7);
    expect(visitStepDays("twice_daily")).toBe(1);
  });

  it("falls back to daily for an unrecognised frequency", () => {
    expect(visitStepDays("fortnightly")).toBe(1);
  });

  it("covers every frequency the UI offers", () => {
    for (const f of HOME_CARE_FREQUENCIES) {
      expect(visitStepDays(f)).toBeGreaterThan(0);
    }
  });
});

describe("buildVisitSchedule", () => {
  it("generates one visit per day for a daily plan, inclusive of both ends", () => {
    const visits = buildVisitSchedule({
      ...base, startDate: "2026-08-21", endDate: "2026-08-25", frequency: "daily",
    });
    expect(visits.map(v => v.scheduled_date)).toEqual([
      "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25",
    ]);
  });

  it("steps by two days for alternate_days", () => {
    const visits = buildVisitSchedule({
      ...base, startDate: "2026-08-21", endDate: "2026-08-27", frequency: "alternate_days",
    });
    expect(visits.map(v => v.scheduled_date)).toEqual([
      "2026-08-21", "2026-08-23", "2026-08-25", "2026-08-27",
    ]);
  });

  it("steps by seven days for weekly", () => {
    const visits = buildVisitSchedule({
      ...base, startDate: "2026-08-21", endDate: "2026-09-11", frequency: "weekly",
    });
    expect(visits).toHaveLength(4);
  });

  it("stamps hospital, plan and patient onto every row", () => {
    const visits = buildVisitSchedule({
      ...base, startDate: "2026-08-21", endDate: "2026-08-22", frequency: "daily",
    });
    for (const v of visits) {
      expect(v.hospital_id).toBe("hosp-1");
      expect(v.plan_id).toBe("plan-1");
      expect(v.patient_id).toBe("pat-1");
      expect(v.status).toBe("scheduled");
    }
  });

  it("defaults to a 30-day window when no end date is given", () => {
    const visits = buildVisitSchedule({
      ...base, startDate: "2026-08-21", endDate: null, frequency: "daily",
    });
    expect(visits).toHaveLength(31); // start day + 30
  });

  it("returns nothing when the end date precedes the start date", () => {
    expect(buildVisitSchedule({
      ...base, startDate: "2026-08-25", endDate: "2026-08-21", frequency: "daily",
    })).toEqual([]);
  });

  it("returns nothing for an unparseable start date rather than looping forever", () => {
    expect(buildVisitSchedule({
      ...base, startDate: "not-a-date", endDate: "2026-08-25", frequency: "daily",
    })).toEqual([]);
  });

  it("caps runaway schedules so a bad end date cannot generate thousands of rows", () => {
    const visits = buildVisitSchedule({
      ...base, startDate: "2026-08-21", endDate: "2099-01-01", frequency: "daily",
    });
    expect(visits).toHaveLength(180);
  });
});
