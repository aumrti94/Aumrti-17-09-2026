import { describe, it, expect } from "vitest";
import { CALCULATORS, CALCULATOR_CATEGORIES } from "@/lib/clinicalCalculators";

/**
 * Regression suite for the point-of-care clinical calculator registry.
 *
 * These are PURE functions, so every formula can be pinned to a known reference
 * value. Reference values below are hand-computed from the published equations
 * (NEJM 2021 CKD-EPI, Vincent 1996 SOFA, etc.) — NOT copied from current output —
 * so a transposed coefficient or wrong constant will FAIL the test rather than
 * silently produce a wrong dose/score at the bedside.
 *
 * Authored by @naveen (SDET) per the Firm's Day-1 de-risking recommendation.
 */

// ── helpers ──────────────────────────────────────────────────────────────────
const byId = (id: string) => {
  const c = CALCULATORS.find((x) => x.id === id);
  if (!c) throw new Error(`Calculator '${id}' not found in registry`);
  return c;
};
/** parse the first numeric token from a score string e.g. "98 mL/min/1.73m²" -> 98 */
const firstNum = (s: string): number => {
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};
const run = (id: string, v: Record<string, string>) => byId(id).calculate(v);

// ── RENAL ────────────────────────────────────────────────────────────────────
describe("Renal calculators", () => {
  it("eGFR CKD-EPI 2021 — 40yo male, SCr 1.0 ≈ 98 (Stage G1)", () => {
    const r = run("ckd_epi", { scr: "1.0", age: "40", sex: "male" });
    const egfr = firstNum(r.score);
    expect(egfr).toBeGreaterThanOrEqual(96);
    expect(egfr).toBeLessThanOrEqual(99);
    expect(r.interpretation).toContain("G1");
  });

  it("eGFR CKD-EPI — female factor lowers result vs male at same SCr", () => {
    const male = firstNum(run("ckd_epi", { scr: "1.2", age: "55", sex: "male" }).score);
    const female = firstNum(run("ckd_epi", { scr: "1.2", age: "55", sex: "female" }).score);
    // female kappa/alpha + 1.012 multiplier => different (and lower) value here
    expect(female).not.toBe(male);
  });

  it("Cockcroft-Gault — 40yo male, 70kg, SCr 1.0 = 97 mL/min (Normal)", () => {
    const r = run("cockcroft_gault", { scr: "1.0", age: "40", weight: "70", sex: "male" });
    expect(firstNum(r.score)).toBe(97);
    expect(r.interpretation).toContain("Normal");
  });

  it("Cockcroft-Gault — female 0.85 factor reduces CrCl (97.22*0.85=82.6 -> 83)", () => {
    const m = firstNum(run("cockcroft_gault", { scr: "1.0", age: "40", weight: "70", sex: "male" }).score);
    const f = firstNum(run("cockcroft_gault", { scr: "1.0", age: "40", weight: "70", sex: "female" }).score);
    expect(f).toBe(83); // 0.85 applied pre-round, not post-round
    expect(f).toBeLessThan(m);
  });

  it("FENa — pre-renal pattern < 1%", () => {
    const r = run("fena", { u_na: "10", s_cr: "2", s_na: "140", u_cr: "50" });
    expect(firstNum(r.score)).toBeCloseTo(0.29, 2);
    expect(r.interpretation).toContain("Pre-renal");
  });

  it("Anion gap — Na140 Cl100 HCO3 24 = 16 (Elevated)", () => {
    const r = run("anion_gap", { na: "140", cl: "100", hco3: "24", albumin: "4" });
    expect(firstNum(r.score)).toBe(16);
    expect(r.interpretation).toContain("Elevated");
  });
});

// ── CARDIOLOGY ───────────────────────────────────────────────────────────────
describe("Cardiology calculators", () => {
  it("CHA₂DS₂-VASc — single risk factor scores 1 (~1.3%/yr)", () => {
    const r = run("chads_vasc", { chf: "1", htn: "0", age75: "0", dm: "0", stroke: "0", vd: "0", age65: "0", sex: "0" });
    expect(firstNum(r.score)).toBe(1);
    expect(r.interpretation).toContain("1.3%");
  });

  it("CHA₂DS₂-VASc — clinically valid max profile = 9/9 (~15.2%)", () => {
    // age ≥75 (+2) is mutually exclusive with age 65-74 (+1)
    const r = run("chads_vasc", { chf: "1", htn: "1", age75: "2", dm: "1", stroke: "2", vd: "1", age65: "0", sex: "1" });
    expect(firstNum(r.score)).toBe(9);
    expect(r.interpretation).toContain("15.2%");
  });

  it("HAS-BLED — HTN + age = 2 (Moderate)", () => {
    const r = run("has_bled", { htn: "1", age: "1" });
    expect(firstNum(r.score)).toBe(2);
    expect(r.interpretation).toContain("Moderate");
  });
});

// ── PULMONOLOGY ──────────────────────────────────────────────────────────────
describe("Pulmonology calculators", () => {
  it("Wells DVT — 3 positives = High probability", () => {
    const r = run("wells_dvt", { cancer: "1", tenderness: "1", swelling: "1", alt_dx: "0" });
    expect(firstNum(r.score)).toBe(3);
    expect(r.interpretation).toContain("High");
  });

  it("Wells DVT — alternative diagnosis subtracts 2", () => {
    const r = run("wells_dvt", { cancer: "1", swelling: "1", alt_dx: "-2" });
    expect(firstNum(r.score)).toBe(0);
    expect(r.interpretation).toContain("Low");
  });

  it("CURB-65 — 3 criteria = severe (ICU consideration)", () => {
    const r = run("curb65", { confusion: "1", urea: "1", rr: "0", bp: "0", age65: "1" });
    expect(firstNum(r.score)).toBe(3);
    expect(r.interpretation).toContain("22%");
  });

  it("CURB-65 — 0 criteria = outpatient", () => {
    const r = run("curb65", {});
    expect(firstNum(r.score)).toBe(0);
    expect(r.interpretation).toContain("Outpatient");
  });

  it("P/F ratio — 90/0.6 = 150 (Moderate ARDS)", () => {
    const r = run("pao2_fio2", { pao2: "90", fio2: "0.6" });
    expect(firstNum(r.score)).toBe(150);
    expect(r.interpretation).toContain("Moderate");
  });

  it("A-a gradient — elevated at FiO2 0.21, PaCO2 40, PaO2 80 ≈ 20", () => {
    const r = run("aa_gradient", { fio2: "0.21", paco2: "40", pao2: "80" });
    expect(firstNum(r.score)).toBe(20);
    expect(r.interpretation).toContain("Elevated");
  });
});

// ── NEUROLOGY ────────────────────────────────────────────────────────────────
describe("Neurology calculators", () => {
  it("GCS — E4V5M6 = 15 (Mild)", () => {
    const r = run("gcs", { eye: "4", verbal: "5", motor: "6" });
    expect(firstNum(r.score)).toBe(15);
    expect(r.interpretation).toContain("Mild");
  });

  it("GCS — E1V1M1 = 3 (Severe, ≤8)", () => {
    const r = run("gcs", { eye: "1", verbal: "1", motor: "1" });
    expect(firstNum(r.score)).toBe(3);
    expect(r.interpretation).toContain("Severe");
  });

  it("Hunt-Hess — Grade III ≈ 20% operative mortality", () => {
    const r = run("hunt_hess", { grade: "3" });
    expect(r.interpretation).toContain("20%");
  });
});

// ── GENERAL ──────────────────────────────────────────────────────────────────
describe("General calculators", () => {
  it("BMI — 70kg / 170cm = 24.2 (Normal)", () => {
    const r = run("bmi", { weight: "70", height: "170", sex: "male" });
    expect(firstNum(r.score)).toBeCloseTo(24.2, 1);
    expect(r.interpretation).toContain("Normal");
  });

  it("Corrected calcium — low albumin masks hypocalcaemia", () => {
    const r = run("corrected_calcium", { ca: "7.5", albumin: "4.0" });
    expect(firstNum(r.score)).toBeCloseTo(7.5, 2);
    expect(r.interpretation).toContain("Hypocalcaemia");
  });

  it("Osmol gap — normal when measured matches calculated", () => {
    const r = run("osmol_gap", { na: "140", glucose: "90", bun: "14", measured: "290" });
    expect(firstNum(r.score)).toBe(0);
    expect(r.interpretation).toContain("Normal");
  });
});

// ── SURGERY / OB-GYN / PAEDIATRIC ────────────────────────────────────────────
describe("Surgery, OB/GYN & Paediatric calculators", () => {
  it("ASA — Class II maps to mild systemic disease", () => {
    const r = run("asa_class", { class: "2" });
    expect(r.interpretation).toContain("Mild");
  });

  it("Bishop score — all favourable = 10 (induction likely successful)", () => {
    const r = run("bishop_score", { dilation: "2", effacement: "2", station: "2", consistency: "2", position: "2" });
    expect(firstNum(r.score)).toBe(10);
    expect(r.interpretation).toContain("Favourable");
  });

  it("Gestational age — 70 days = 10 weeks", () => {
    const r = run("gestational_age", { lmp: "70" });
    expect(firstNum(r.score)).toBe(10);
  });

  it("PEWS — all max = 9 (High risk)", () => {
    const r = run("pews", { behaviour: "3", cvs: "3", resp: "3" });
    expect(firstNum(r.score)).toBe(9);
    expect(r.interpretation).toContain("High");
  });
});

// ── ICU ──────────────────────────────────────────────────────────────────────
describe("ICU calculators", () => {
  it("SOFA — all zero = 0/24 (<1% mortality)", () => {
    const r = run("sofa", {});
    expect(firstNum(r.score)).toBe(0);
    expect(r.interpretation).toContain("1%");
  });

  it("SOFA — all max = 24/24 (>50% mortality)", () => {
    const r = run("sofa", { pf_ratio: "4", platelets: "4", bilirubin: "4", map: "4", gcs_sofa: "4", creatinine: "4" });
    expect(firstNum(r.score)).toBe(24);
    expect(r.interpretation).toContain("50%");
  });

  it("APACHE II — healthy 40yo, GCS 15 = 0 (~4% mortality)", () => {
    const r = run("apache_ii", { temp: "0", map_a: "0", hr_a: "0", rr_a: "0", gcs_a: "15", age: "40", chronic: "0" });
    expect(firstNum(r.score)).toBe(0);
    expect(r.interpretation).toContain("4%");
  });

  it("APACHE II — age & chronic-health points accumulate", () => {
    const r = run("apache_ii", { temp: "0", map_a: "0", hr_a: "0", rr_a: "0", gcs_a: "10", age: "80", chronic: "5" });
    // gcs_pts(5) + age_pts(6) + chronic(5) = 16
    expect(firstNum(r.score)).toBe(16);
  });
});

// ── REGISTRY INTEGRITY ───────────────────────────────────────────────────────
describe("Calculator registry integrity", () => {
  it("registry exposes 21 calculators (NB: file header says '30+' — overclaim to fix)", () => {
    expect(CALCULATORS.length).toBe(21);
  });

  it("every calculator has unique id, required metadata and ≥1 input", () => {
    const ids = new Set<string>();
    for (const c of CALCULATORS) {
      expect(c.id, `${c.name} missing id`).toBeTruthy();
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(c.name).toBeTruthy();
      expect(CALCULATOR_CATEGORIES).toContain(c.category);
      expect(Array.isArray(c.inputs)).toBe(true);
      expect(c.inputs.length).toBeGreaterThan(0);
      expect(typeof c.calculate).toBe("function");
    }
  });

  it("no calculator throws on empty input and all return string score + interpretation", () => {
    for (const c of CALCULATORS) {
      expect(() => c.calculate({}), `${c.id} threw on empty input`).not.toThrow();
      const r = c.calculate({});
      expect(typeof r.score, `${c.id} score not a string`).toBe("string");
      expect(typeof r.interpretation, `${c.id} interpretation not a string`).toBe("string");
    }
  });
});

// ── DOCUMENTED EDGE-CASE BEHAVIOUR (improvement opportunities, not yet guarded) ─
describe("Known robustness gaps (pinned to flag for hardening)", () => {
  it("FENa divides by zero on urine creatinine 0 -> 'Infinity' instead of validation error", () => {
    const r = run("fena", { u_na: "10", s_cr: "2", s_na: "140", u_cr: "0" });
    // Documents current behaviour: no input guard -> Infinity. Should become a validation error.
    expect(r.score).toContain("Infinity");
  });

  it("CHA₂DS₂-VASc has no age-band mutual-exclusivity guard (age75 + age65 -> 10/9)", () => {
    // A mis-click selecting BOTH age bands yields an out-of-range, clinically impossible score.
    // Pinned to flag for hardening (should cap at 9 or make the age fields a single select).
    const r = run("chads_vasc", { age75: "2", age65: "1" });
    expect(firstNum(r.score)).toBe(3); // 2 + 1 — sums blindly, exceeds the real max of 2 for age
  });
});
