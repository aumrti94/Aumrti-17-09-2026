import { describe, it, expect } from "vitest";
import { hasAlert, alertReasons, TELE_ALERT_THRESHOLDS } from "./homeCareAlerts";

describe("hasAlert", () => {
  it("is quiet for normal adult vitals", () => {
    expect(hasAlert({
      bp_systolic: 122, bp_diastolic: 78, pulse: 76, spo2: 98, blood_sugar: 110,
    })).toBe(false);
  });

  it("trips on hypertensive systolic", () => {
    expect(hasAlert({ bp_systolic: 165 })).toBe(true);
    expect(hasAlert({ bp_systolic: TELE_ALERT_THRESHOLDS.bpSystolicHigh })).toBe(false);
  });

  it("trips on hypertensive diastolic", () => {
    expect(hasAlert({ bp_diastolic: 105 })).toBe(true);
  });

  it("trips on hypoxia", () => {
    expect(hasAlert({ spo2: 89 })).toBe(true);
    expect(hasAlert({ spo2: TELE_ALERT_THRESHOLDS.spo2Low })).toBe(false);
  });

  it("trips on hyperglycaemia and on hypoglycaemia", () => {
    expect(hasAlert({ blood_sugar: 310 })).toBe(true);
    expect(hasAlert({ blood_sugar: 48 })).toBe(true);
    expect(hasAlert({ blood_sugar: 140 })).toBe(false);
  });

  it("treats missing vitals as no alert rather than a breach", () => {
    expect(hasAlert({})).toBe(false);
    expect(hasAlert({ bp_systolic: null, spo2: null, blood_sugar: null })).toBe(false);
  });

  it("does not read a recorded zero as a hypoglycaemia alert", () => {
    // 0 is 'not recorded' in this UI — the inputs coerce empty to null, but a
    // stray 0 must not fabricate a critical alert.
    expect(hasAlert({ blood_sugar: 0, spo2: 0 })).toBe(false);
  });
});

describe("alertReasons", () => {
  it("names every breached vital", () => {
    const reasons = alertReasons({ bp_systolic: 180, spo2: 88 });
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("180");
    expect(reasons[1]).toContain("88");
  });

  it("distinguishes hypoglycaemia from hyperglycaemia in the message", () => {
    expect(alertReasons({ blood_sugar: 45 })[0]).toContain("hypoglycaemia");
    expect(alertReasons({ blood_sugar: 300 })[0]).not.toContain("hypoglycaemia");
  });

  it("returns nothing when no threshold is breached", () => {
    expect(alertReasons({ bp_systolic: 120, spo2: 99 })).toEqual([]);
  });
});
