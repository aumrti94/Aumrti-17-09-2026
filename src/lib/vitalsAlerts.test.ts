import { describe, it, expect } from "vitest";
import { checkVitalsThresholds, calculateNEWS2, vitalSeverityClass } from "./vitalsAlerts";

describe("checkVitalsThresholds — bedside vitals threshold alerts", () => {
  it("flags a hypertensive crisis as critical", () => {
    const alerts = checkVitalsThresholds({ bp_systolic: 185 });
    expect(alerts).toEqual([
      { parameter: "BP Systolic", value: 185, severity: "critical", message: expect.stringMatching(/hypertensive crisis/i) },
    ]);
  });

  it("flags elevated but non-crisis BP as a warning", () => {
    const [alert] = checkVitalsThresholds({ bp_systolic: 150 });
    expect(alert.severity).toBe("warning");
  });

  it("flags hypotension as critical, not just low", () => {
    const [alert] = checkVitalsThresholds({ bp_systolic: 88 });
    expect(alert.severity).toBe("critical");
    expect(alert.message).toMatch(/hypotension/i);
  });

  it("flags severe hypoxemia and low saturation at their respective bands", () => {
    expect(checkVitalsThresholds({ spo2: 88 })[0].severity).toBe("critical");
    expect(checkVitalsThresholds({ spo2: 92 })[0].severity).toBe("warning");
    expect(checkVitalsThresholds({ spo2: 96 })).toEqual([]);
  });

  it("flags severe tachycardia/bradycardia as critical, moderate tachycardia as warning", () => {
    expect(checkVitalsThresholds({ pulse: 140 })[0].severity).toBe("critical");
    expect(checkVitalsThresholds({ pulse: 110 })[0].severity).toBe("warning");
    expect(checkVitalsThresholds({ pulse: 45 })[0].severity).toBe("critical");
  });

  it("flags high fever as critical and low-grade fever as a warning", () => {
    expect(checkVitalsThresholds({ temperature: 105 })[0].severity).toBe("critical");
    expect(checkVitalsThresholds({ temperature: 101 })[0].severity).toBe("warning");
    expect(checkVitalsThresholds({ temperature: 94 })[0].severity).toBe("critical");
  });

  it("flags respiratory distress at both extremes as critical", () => {
    expect(checkVitalsThresholds({ respiratory_rate: 28 })[0].severity).toBe("critical");
    expect(checkVitalsThresholds({ respiratory_rate: 6 })[0].severity).toBe("critical");
  });

  it("returns no alerts for a fully normal vitals set", () => {
    expect(
      checkVitalsThresholds({
        bp_systolic: 120,
        spo2: 98,
        pulse: 72,
        temperature: 98.6,
        respiratory_rate: 16,
      }),
    ).toEqual([]);
  });

  it("returns multiple alerts when several vitals are abnormal at once", () => {
    const alerts = checkVitalsThresholds({ bp_systolic: 185, spo2: 88, pulse: 140 });
    expect(alerts).toHaveLength(3);
  });

  it("ignores an omitted (falsy) vital rather than treating it as zero/critical", () => {
    expect(checkVitalsThresholds({})).toEqual([]);
  });
});

describe("calculateNEWS2 — screen-local wrapper delegating to the canonical formula", () => {
  it("converts Fahrenheit to Celsius before scoring", () => {
    // 98.6F == 37C, the canonical formula's zero-score band.
    expect(calculateNEWS2({ temperature: 98.6 })).toBe(0);
    // 95F == 35C, the canonical formula's +3 hypothermia band.
    expect(calculateNEWS2({ temperature: 95 })).toBe(3);
  });

  it("always scores as alert/room-air, matching this screen's historical behaviour", () => {
    // Even with abnormal everything else, no O2 or consciousness term should ever be added
    // beyond what the individual vitals already contribute.
    const score = calculateNEWS2({ bp_systolic: 200, pulse: 40, respiratory_rate: 30 });
    // bp 200 -> systolic >219? no, 200<=219 -> 0. pulse 40 -> <=40 -> 3. rr 30 -> >24 -> 3.
    expect(score).toBe(6);
  });
});

describe("vitalSeverityClass — badge coloring follows the same thresholds as the alerts", () => {
  it("returns an empty class for a missing value", () => {
    expect(vitalSeverityClass("bp_systolic", null)).toBe("");
    expect(vitalSeverityClass("bp_systolic", undefined)).toBe("");
  });

  it("escalates from warning to critical classes as bp_systolic worsens", () => {
    expect(vitalSeverityClass("bp_systolic", 120)).toBe("");
    expect(vitalSeverityClass("bp_systolic", 150)).toMatch(/amber/);
    expect(vitalSeverityClass("bp_systolic", 185)).toMatch(/destructive/);
  });

  it("returns an empty class for an unrecognised parameter", () => {
    expect(vitalSeverityClass("unknown_param", 999)).toBe("");
  });
});
