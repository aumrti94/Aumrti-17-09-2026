import { describe, it, expect } from "vitest";
import { calculateNEWS2Score } from "./clinicalPredictions";

// ── calculateNEWS2Score ───────────────────────────────────────────────────────
// Since the nursing module completion plan Phase 3, this is a thin wrapper around the single
// canonical formula in src/lib/news2.ts (Royal College of Physicians NEWS2 Scale 1) — every
// screen that computes a NEWS2 score now agrees.
// Scoring reference (NHS NEWS2):
//   RR:   ≤8→3, 9-11→1, 12-20→0, 21-24→2, ≥25→3
//   SpO2: ≤91→3, 92-93→2, 94-95→1, ≥96→0 — ONLY scored when NOT on supplemental O2 (Scale 1)
//   O2:   on_oxygen adds a flat 2, and suppresses the SpO2-value scoring above (they are not
//         additive — a patient on O2 is scored on the O2 flag, not their raw SpO2 reading)
//   Temp: ≤35→3, 35.1-36→1, 36.1-38→0, 38.1-39→1, ≥39.1→2
//   SBP:  ≤90→3, 91-100→2, 101-110→1, 111-219→0, ≥220→3
//   PR:   ≤40→3, 41-50→1, 51-90→0, 91-110→1, 111-130→2, ≥131→3
//   AVPU: A→0, any other→3

const NORMAL = {
  rr: 16,
  spo2: 98,
  on_oxygen: false,
  temperature: 37,
  bp_systolic: 120,
  pulse: 72,
  avpu: "A",
};

describe("calculateNEWS2Score", () => {
  it("returns 0 for all normal vitals", () => {
    expect(calculateNEWS2Score(NORMAL)).toBe(0);
  });

  it("returns 0 for empty vitals (no fields)", () => {
    expect(calculateNEWS2Score({})).toBe(0);
  });

  // ── Respiratory Rate ──────────────────────────────────────────────────────
  describe("respiratory rate scoring", () => {
    it("RR ≤8 scores 3 (apnoea / severe bradypnoea)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, rr: 8 })).toBe(3);
    });

    it("RR 9-11 scores 1 (mild bradypnoea)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, rr: 11 })).toBe(1);
    });

    it("RR 12-20 scores 0 (normal)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, rr: 18 })).toBe(0);
    });

    it("RR 21-24 scores 2 (mild tachypnoea)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, rr: 24 })).toBe(2);
    });

    it("RR ≥25 scores 3 (severe tachypnoea)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, rr: 30 })).toBe(3);
    });
  });

  // ── SpO2 ──────────────────────────────────────────────────────────────────
  describe("SpO2 scoring (Scale 1)", () => {
    it("SpO2 ≤91 scores 3 (severe hypoxia)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, spo2: 91 })).toBe(3);
    });

    it("SpO2 92-93 scores 2", () => {
      expect(calculateNEWS2Score({ ...NORMAL, spo2: 92 })).toBe(2);
    });

    it("SpO2 94-95 scores 1", () => {
      expect(calculateNEWS2Score({ ...NORMAL, spo2: 95 })).toBe(1);
    });

    it("SpO2 ≥96 scores 0 (normal)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, spo2: 99 })).toBe(0);
    });
  });

  // ── Supplemental oxygen ───────────────────────────────────────────────────
  it("on_oxygen=true adds 2 points", () => {
    expect(calculateNEWS2Score({ ...NORMAL, on_oxygen: true })).toBe(2);
  });

  it("on_oxygen=false adds 0 points", () => {
    expect(calculateNEWS2Score({ ...NORMAL, on_oxygen: false })).toBe(0);
  });

  // ── Temperature ───────────────────────────────────────────────────────────
  describe("temperature scoring", () => {
    it("≤35.0°C scores 3 (severe hypothermia)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, temperature: 35.0 })).toBe(3);
    });

    it("35.1–36.0°C scores 1 (mild hypothermia)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, temperature: 36.0 })).toBe(1);
    });

    it("36.1–38.0°C scores 0 (normal)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, temperature: 37.0 })).toBe(0);
    });

    it("38.1–39.0°C scores 1 (low-grade fever)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, temperature: 39.0 })).toBe(1);
    });

    it(">39.0°C scores 2 (high fever)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, temperature: 39.5 })).toBe(2);
    });
  });

  // ── Blood pressure (systolic) ─────────────────────────────────────────────
  describe("systolic BP scoring", () => {
    it("SBP ≤90 scores 3 (severe hypotension)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, bp_systolic: 90 })).toBe(3);
    });

    it("SBP 91-100 scores 2", () => {
      expect(calculateNEWS2Score({ ...NORMAL, bp_systolic: 100 })).toBe(2);
    });

    it("SBP 101-110 scores 1", () => {
      expect(calculateNEWS2Score({ ...NORMAL, bp_systolic: 110 })).toBe(1);
    });

    it("SBP 111-219 scores 0 (normal range)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, bp_systolic: 130 })).toBe(0);
    });

    it("SBP ≥220 scores 3 (hypertensive emergency)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, bp_systolic: 220 })).toBe(3);
    });
  });

  // ── Pulse ─────────────────────────────────────────────────────────────────
  describe("pulse scoring", () => {
    it("pulse ≤40 scores 3 (severe bradycardia)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, pulse: 40 })).toBe(3);
    });

    it("pulse 41-50 scores 1 (mild bradycardia)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, pulse: 50 })).toBe(1);
    });

    it("pulse 51-90 scores 0 (normal)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, pulse: 80 })).toBe(0);
    });

    it("pulse 91-110 scores 1 (mild tachycardia)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, pulse: 100 })).toBe(1);
    });

    it("pulse 111-130 scores 2 (moderate tachycardia)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, pulse: 120 })).toBe(2);
    });

    it("pulse ≥131 scores 3 (severe tachycardia)", () => {
      expect(calculateNEWS2Score({ ...NORMAL, pulse: 140 })).toBe(3);
    });
  });

  // ── AVPU ──────────────────────────────────────────────────────────────────
  describe("AVPU consciousness scoring", () => {
    it("AVPU='A' (Alert) scores 0", () => {
      expect(calculateNEWS2Score({ ...NORMAL, avpu: "A" })).toBe(0);
    });

    it("AVPU='V' (responds to Voice) scores 3", () => {
      expect(calculateNEWS2Score({ ...NORMAL, avpu: "V" })).toBe(3);
    });

    it("AVPU='P' (responds to Pain) scores 3", () => {
      expect(calculateNEWS2Score({ ...NORMAL, avpu: "P" })).toBe(3);
    });

    it("AVPU='U' (Unresponsive) scores 3", () => {
      expect(calculateNEWS2Score({ ...NORMAL, avpu: "U" })).toBe(3);
    });
  });

  // ── Composite / sepsis threshold ─────────────────────────────────────────
  it("sepsis-threshold combination returns ≥7 (triggers immediate escalation)", () => {
    // RR=26 (+3) + SpO2=91 (+3) + pulse=140 (+3) = 9
    const score = calculateNEWS2Score({
      rr: 26,
      spo2: 91,
      temperature: 37,
      bp_systolic: 115,
      pulse: 140,
      avpu: "A",
    });
    expect(score).toBeGreaterThanOrEqual(7);
  });

  it("on_oxygen suppresses SpO2-value scoring — only the flat O2 penalty applies", () => {
    // Real NEWS2 Scale 1: SpO2=93 would score +2 on room air, but on_oxygen replaces that with
    // its own flat +2 rather than stacking — total is 2, not 4.
    expect(calculateNEWS2Score({ ...NORMAL, spo2: 93, on_oxygen: true })).toBe(2);
  });

  // ── Robustness ────────────────────────────────────────────────────────────
  it("undefined vitals field is treated as absent (no points added)", () => {
    expect(calculateNEWS2Score({ rr: undefined, spo2: undefined })).toBe(0);
  });

  it("rr=0 (apnoea) is correctly scored as severe, not treated as absent", () => {
    // Fixed by the Phase 3 consolidation: the old implementation's `if (vitals.rr)` truthy
    // check silently ignored rr=0 — the single most dangerous respiratory rate a patient can
    // have. The canonical formula (src/lib/news2.ts) distinguishes "0" from "not supplied" via
    // a `!= null` check, so apnoea now correctly scores the maximum 3 points.
    expect(calculateNEWS2Score({ ...NORMAL, rr: 0 })).toBe(3);
  });
});
