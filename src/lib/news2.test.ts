import { describe, it, expect } from "vitest";
import { calculateNEWS2, getNEWS2Level, getNEWS2BadgeClasses, getNEWS2Label } from "./news2";

// PATIENT SAFETY CRITICAL — NEWS2 drives inpatient deterioration detection (NABH 6th Ed).
// This is the single canonical implementation other screens now delegate to, so every
// scoring band is covered explicitly at its boundary, not sampled.

describe("calculateNEWS2 — respiratory rate scoring", () => {
  it("scores the low-rate bands", () => {
    expect(calculateNEWS2({ respiratory_rate: 8 })).toBe(3);
    expect(calculateNEWS2({ respiratory_rate: 9 })).toBe(1);
    expect(calculateNEWS2({ respiratory_rate: 11 })).toBe(1);
  });

  it("scores the normal band as zero", () => {
    expect(calculateNEWS2({ respiratory_rate: 12 })).toBe(0);
    expect(calculateNEWS2({ respiratory_rate: 20 })).toBe(0);
  });

  it("scores the high-rate bands", () => {
    expect(calculateNEWS2({ respiratory_rate: 21 })).toBe(2);
    expect(calculateNEWS2({ respiratory_rate: 24 })).toBe(2);
    expect(calculateNEWS2({ respiratory_rate: 25 })).toBe(3);
  });
});

describe("calculateNEWS2 — SpO2 scoring (Scale 1)", () => {
  it("scores low saturation on room air", () => {
    expect(calculateNEWS2({ spo2: 91, on_supplemental_o2: false })).toBe(3);
    expect(calculateNEWS2({ spo2: 93, on_supplemental_o2: false })).toBe(2);
    expect(calculateNEWS2({ spo2: 95, on_supplemental_o2: false })).toBe(1);
    expect(calculateNEWS2({ spo2: 96, on_supplemental_o2: false })).toBe(0);
  });

  it("does not apply the SpO2 band while on supplemental O2 — only the +2 flag applies", () => {
    // A patient on O2 with spo2 91 should NOT double-count the room-air penalty.
    expect(calculateNEWS2({ spo2: 91, on_supplemental_o2: true })).toBe(2);
  });

  it("adds 2 for supplemental O2 regardless of saturation", () => {
    expect(calculateNEWS2({ on_supplemental_o2: true })).toBe(2);
  });
});

describe("calculateNEWS2 — temperature scoring", () => {
  it("scores hypothermia and low-normal", () => {
    expect(calculateNEWS2({ temperature: 35 })).toBe(3);
    expect(calculateNEWS2({ temperature: 36 })).toBe(1);
  });

  it("scores the normal band as zero", () => {
    expect(calculateNEWS2({ temperature: 37 })).toBe(0);
    expect(calculateNEWS2({ temperature: 38 })).toBe(0);
  });

  it("scores fever bands", () => {
    expect(calculateNEWS2({ temperature: 39 })).toBe(1);
    expect(calculateNEWS2({ temperature: 39.5 })).toBe(2);
  });
});

describe("calculateNEWS2 — systolic BP scoring", () => {
  it("scores hypotension bands", () => {
    expect(calculateNEWS2({ systolic_bp: 90 })).toBe(3);
    expect(calculateNEWS2({ systolic_bp: 100 })).toBe(2);
    expect(calculateNEWS2({ systolic_bp: 110 })).toBe(1);
  });

  it("scores the wide normal band as zero", () => {
    expect(calculateNEWS2({ systolic_bp: 111 })).toBe(0);
    expect(calculateNEWS2({ systolic_bp: 219 })).toBe(0);
  });

  it("scores severe hypertension at the top of the scale", () => {
    expect(calculateNEWS2({ systolic_bp: 220 })).toBe(3);
  });
});

describe("calculateNEWS2 — heart rate scoring", () => {
  it("scores bradycardia bands", () => {
    expect(calculateNEWS2({ heart_rate: 40 })).toBe(3);
    expect(calculateNEWS2({ heart_rate: 50 })).toBe(1);
  });

  it("scores the normal band as zero", () => {
    expect(calculateNEWS2({ heart_rate: 90 })).toBe(0);
  });

  it("scores tachycardia bands", () => {
    expect(calculateNEWS2({ heart_rate: 110 })).toBe(1);
    expect(calculateNEWS2({ heart_rate: 130 })).toBe(2);
    expect(calculateNEWS2({ heart_rate: 131 })).toBe(3);
  });
});

describe("calculateNEWS2 — consciousness (ACVPU)", () => {
  it("adds nothing when alert", () => {
    expect(calculateNEWS2({ consciousness: "A" })).toBe(0);
  });

  it("adds 3 for any altered consciousness level", () => {
    expect(calculateNEWS2({ consciousness: "C" })).toBe(3);
    expect(calculateNEWS2({ consciousness: "V" })).toBe(3);
    expect(calculateNEWS2({ consciousness: "P" })).toBe(3);
    expect(calculateNEWS2({ consciousness: "U" })).toBe(3);
  });
});

describe("calculateNEWS2 — partial input and combined score", () => {
  it("treats an omitted field as contributing zero, not an error", () => {
    expect(calculateNEWS2({})).toBe(0);
    expect(calculateNEWS2({ respiratory_rate: 12 })).toBe(0);
  });

  it("sums every contributing vital for a critically unwell patient", () => {
    const score = calculateNEWS2({
      respiratory_rate: 26,     // 3
      spo2: 90,                 // 3
      on_supplemental_o2: false,
      systolic_bp: 85,          // 3
      heart_rate: 135,          // 3
      consciousness: "V",       // 3
      temperature: 34,          // 3
    });
    expect(score).toBe(18);
  });
});

describe("getNEWS2Level — risk banding", () => {
  it("bands the documented thresholds exactly", () => {
    expect(getNEWS2Level(0)).toBe("low");
    expect(getNEWS2Level(4)).toBe("low");
    expect(getNEWS2Level(5)).toBe("medium");
    expect(getNEWS2Level(6)).toBe("medium");
    expect(getNEWS2Level(7)).toBe("high");
    expect(getNEWS2Level(8)).toBe("critical");
    expect(getNEWS2Level(15)).toBe("critical");
  });
});

describe("getNEWS2BadgeClasses / getNEWS2Label — presentation follows the level", () => {
  it("escalates visual urgency (pulse animation) from high risk upward", () => {
    expect(getNEWS2BadgeClasses(4)).not.toMatch(/animate-pulse/);
    expect(getNEWS2BadgeClasses(7)).toMatch(/animate-pulse/);
    expect(getNEWS2BadgeClasses(9)).toMatch(/animate-pulse/);
  });

  it("labels critical and high scores with an explicit call to action", () => {
    expect(getNEWS2Label(9)).toMatch(/CRITICAL/);
    expect(getNEWS2Label(7)).toMatch(/HIGH RISK/);
    expect(getNEWS2Label(5)).toMatch(/Escalate/i);
    expect(getNEWS2Label(2)).toMatch(/Low/);
  });
});
