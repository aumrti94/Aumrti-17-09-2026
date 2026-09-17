/**
 * Phase 1 — patient-safety tier (PHASED_TEST_PLAN.md §8, Phase 1).
 *
 * Every calculator is a pure `(Record<string, string>) => CalcResult`. Inputs arrive as
 * STRINGS off the form, which is where most of the interesting behaviour lives: the module's
 * own helpers are `parseFloat(v) || fallback` and `parseInt(v) || fallback`, so "0" is falsy
 * and collapses to the fallback, and a blank field silently scores as zero.
 *
 * Per clinical-safety-testing: test AT the escalation boundary and either side, because the
 * boundary is where the clinical decision changes. A midpoint assertion proves nothing.
 */
import { describe, it, expect } from "vitest";
import {
  CALCULATORS,
  CALCULATOR_CATEGORIES,
  sofa,
  apacheII,
  type Calculator,
} from "@/lib/clinicalCalculators";

const calc = (id: string): Calculator => {
  const c = CALCULATORS.find((x) => x.id === id);
  if (!c) throw new Error(`No calculator with id '${id}' in CALCULATORS`);
  return c;
};

// ── Registry invariants ───────────────────────────────────────────────────────

describe("CALCULATORS registry", () => {
  it("holds 21 calculators", () => {
    expect(CALCULATORS).toHaveLength(21);
  });

  it("has no duplicate ids", () => {
    // A duplicate id means the second one is unreachable through any lookup keyed on id —
    // the calculator renders in the list and opens the wrong maths.
    const ids = CALCULATORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses categories the filter UI can offer", () => {
    // CALCULATOR_CATEGORIES drives the filter chips. A category not in that list makes its
    // calculators reachable only via "All" — present but effectively hidden.
    const known = new Set(CALCULATOR_CATEGORIES);
    for (const c of CALCULATORS) {
      expect(known, `${c.id} has category '${c.category}'`).toContain(c.category);
    }
  });

  it("gives every calculator a callable calculate() and at least one input", () => {
    for (const c of CALCULATORS) {
      expect(typeof c.calculate, c.id).toBe("function");
      expect(c.inputs.length, c.id).toBeGreaterThan(0);
    }
  });

  it("gives every input a unique id within its own calculator", () => {
    // Two inputs sharing an id collide in the values record: the second overwrites the first
    // and one clinical parameter is silently dropped from the score.
    for (const c of CALCULATORS) {
      const ids = c.inputs.map((i) => i.id);
      expect(new Set(ids).size, c.id).toBe(ids.length);
    }
  });

  it("gives every select input at least two options", () => {
    for (const c of CALCULATORS) {
      for (const input of c.inputs) {
        if (input.type === "select") {
          expect(input.options?.length ?? 0, `${c.id}.${input.id}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("returns a non-empty score and interpretation for every calculator on empty input", () => {
    // Nothing may throw on a half-filled form — the calculator panel renders live as the
    // clinician types, so every intermediate state is evaluated.
    for (const c of CALCULATORS) {
      const r = c.calculate({});
      expect(typeof r.score, c.id).toBe("string");
      expect(r.score.length, c.id).toBeGreaterThan(0);
      expect(r.interpretation.length, c.id).toBeGreaterThan(0);
    }
  });

  it("exports sofa and apacheII individually for the ICU workspace", () => {
    expect(CALCULATORS).toContain(sofa);
    expect(CALCULATORS).toContain(apacheII);
  });
});

// ── Renal ─────────────────────────────────────────────────────────────────────

describe("eGFR (CKD-EPI 2021)", () => {
  const c = calc("ckd_epi");

  it("computes the reference value for a female at kappa (scr 0.7, age 40)", () => {
    // 142 × min(1,1)^-0.241 × max(1,1)^-1.200 × 0.9938^40 × 1.012 = 112.05
    expect(c.calculate({ scr: "0.7", age: "40", sex: "female" }).score).toBe("112 mL/min/1.73m²");
  });

  it("computes the reference value for a male at kappa (scr 0.9, age 40)", () => {
    // Same expression without the 1.012 female coefficient: 142 × 0.9938^40 = 110.73
    expect(c.calculate({ scr: "0.9", age: "40", sex: "male" }).score).toBe("111 mL/min/1.73m²");
  });

  it("applies the sex-specific kappa, not just the 1.012 coefficient", () => {
    // At the SAME creatinine the two sexes diverge by far more than 1.2%, because kappa
    // differs (0.7 vs 0.9) and the ratio crosses 1 for one sex and not the other. A
    // refactor that keeps the coefficient but drops kappa passes a 1.012-only assertion.
    const female = c.calculate({ scr: "0.9", age: "40", sex: "female" }).score;
    const male = c.calculate({ scr: "0.9", age: "40", sex: "male" }).score;
    expect(female).toBe("83 mL/min/1.73m²");
    expect(male).toBe("111 mL/min/1.73m²");
  });

  it("falls to the male branch for any sex value that is not exactly 'female'", () => {
    expect(c.calculate({ scr: "0.9", age: "40", sex: "" }).score).toBe("111 mL/min/1.73m²");
    expect(c.calculate({ scr: "0.9", age: "40", sex: "Female" }).score).toBe("111 mL/min/1.73m²");
  });

  // Every CKD stage, female age 40, walking the creatinine up. The stage drives whether the
  // patient is referred to nephrology and whether renally-cleared drugs need dose reduction.
  it.each([
    ["0.7", 112, "G1 (Normal/High)"],
    ["0.8", 95, "G1 (Normal/High)"],
    ["1.0", 73, "G2 (Mildly ↓)"],
    ["1.4", 49, "G3a (Mildly-Mod ↓)"],
    ["1.9", 34, "G3b (Mod-Severely ↓)"],
    ["3.0", 20, "G4 (Severely ↓)"],
    ["4.5", 12, "G5 (Kidney Failure)"],
  ])("scr %s → %i mL/min → %s", (scr, egfr, stage) => {
    const r = c.calculate({ scr, age: "40", sex: "female" });
    expect(r.score).toBe(`${egfr} mL/min/1.73m²`);
    expect(r.interpretation).toBe(stage);
  });

  it("puts the stage into noteText so the inserted note carries it", () => {
    const r = c.calculate({ scr: "1.0", age: "40", sex: "female" });
    expect(r.noteText).toBe("eGFR (CKD-EPI): 73 mL/min/1.73m² — CKD Stage G2 (Mildly ↓)");
  });
});

describe("CrCl (Cockcroft-Gault)", () => {
  const c = calc("cockcroft_gault");

  it("computes ((140−age) × weight) / (72 × scr)", () => {
    // (140−40) × 70 / (72 × 1.0) = 97.22
    const r = c.calculate({ age: "40", weight: "70", scr: "1.0", sex: "male" });
    expect(r.score).toBe("97 mL/min");
    expect(r.interpretation).toBe("Normal");
  });

  it("applies the 0.85 female factor — and it changes the CKD band", () => {
    // 97.22 × 0.85 = 82.6. This is a drug-dosing calculator: the same patient crosses from
    // "Normal" into "Mild CKD" on sex alone, which is exactly what it is meant to do.
    const r = c.calculate({ age: "40", weight: "70", scr: "1.0", sex: "female" });
    expect(r.score).toBe("83 mL/min");
    expect(r.interpretation).toBe("Mild CKD");
  });

  it.each([
    ["1.0", "97 mL/min", "Normal"],
    ["1.5", "65 mL/min", "Mild CKD"],
    ["2.0", "49 mL/min", "Moderate CKD"],
    ["5.0", "19 mL/min", "Severe CKD"],
    ["8.0", "12 mL/min", "Kidney Failure"],
  ])("male age 40 / 70 kg / scr %s → %s (%s)", (scr, score, interp) => {
    const r = c.calculate({ age: "40", weight: "70", scr, sex: "male" });
    expect(r.score).toBe(score);
    expect(r.interpretation).toBe(interp);
  });

  // KNOWN-BUG-101 — FIXED. A blank creatinine divided by zero and reported
  // "Infinity mL/min — Normal" on the calculator used to dose renally-cleared drugs.
  it.each(["", "0", "abc", "-1"])("refuses to report a clearance when creatinine is %o", (scr) => {
    const r = c.calculate({ age: "40", weight: "70", scr, sex: "male" });
    expect(r.score).toBe("—");
    expect(r.interpretation).toBe("Enter serum creatinine to calculate.");
  });

  it("produces no note text for an uncalculable result", () => {
    // "Insert to Note" must not write a non-result into the record.
    expect(c.calculate({ age: "40", weight: "70", scr: "", sex: "male" }).noteText).toBeUndefined();
  });
});

describe("FENa", () => {
  const c = calc("fena");
  const base = { s_na: "140", s_cr: "2", u_cr: "50" };

  it("computes (UNa × SCr) / (SNa × UCr) × 100 to two decimals", () => {
    const r = c.calculate({ ...base, u_na: "10" });
    expect(r.score).toBe("0.29%");
    expect(r.interpretation).toBe("< 1% — Pre-renal AKI (respond to fluids)");
  });

  it("treats exactly 1% as borderline, not pre-renal", () => {
    // The branch is `< 1`, so 1.00 falls through. Pre-renal AKI is fluid-responsive and
    // intrinsic AKI is not — calling a borderline result pre-renal drives a fluid challenge.
    const r = c.calculate({ ...base, u_na: "35" });
    expect(r.score).toBe("1.00%");
    expect(r.interpretation).toBe("1–2% — Borderline — consider clinical context");
  });

  it("treats exactly 2% as intrinsic, not borderline", () => {
    const r = c.calculate({ ...base, u_na: "70" });
    expect(r.score).toBe("2.00%");
    expect(r.interpretation).toBe("> 2% — Intrinsic renal AKI (ATN)");
  });

  it("stays borderline just under 2%", () => {
    const r = c.calculate({ ...base, u_na: "69" });
    expect(r.score).toBe("1.97%");
    expect(r.interpretation).toBe("1–2% — Borderline — consider clinical context");
  });
});

describe("Anion Gap", () => {
  const c = calc("anion_gap");

  it("computes Na − (Cl + HCO3)", () => {
    const r = c.calculate({ na: "140", cl: "100", hco3: "24" });
    expect(r.score).toBe("AG: 16 (Corrected: 16)");
    expect(r.interpretation).toContain("Elevated AG");
  });

  it("treats exactly 12 as normal and 13 as elevated", () => {
    // The branch is `> 12`. MUDPILES workup hinges on this.
    expect(c.calculate({ na: "140", cl: "104", hco3: "24" }).interpretation).toContain("Normal AG");
    expect(c.calculate({ na: "141", cl: "104", hco3: "24" }).interpretation).toContain("Elevated AG");
  });

  it("defaults albumin to 4 g/dL when not supplied", () => {
    const r = c.calculate({ na: "140", cl: "100", hco3: "24" });
    expect(r.score).toBe("AG: 16 (Corrected: 16)"); // correction is 2.5 × (4 − 4) = 0
  });

  it("adds 2.5 per g/dL of albumin deficit", () => {
    // AG 8, albumin 2.0 → corrected 8 + 2.5 × 2 = 13
    const r = c.calculate({ na: "140", cl: "105", hco3: "27", albumin: "2" });
    expect(r.score).toBe("AG: 8 (Corrected: 13)");
  });

  // KNOWN-BUG-102 — FIXED. The interpretation came from the RAW gap while the score showed
  // the corrected one, so a hypoalbuminaemic patient whose corrected gap is elevated read
  // "Normal AG" — and unmasking that patient is the entire purpose of the correction.
  it("interprets the albumin-corrected gap, not the raw gap", () => {
    const r = c.calculate({ na: "140", cl: "105", hco3: "27", albumin: "2" });
    expect(r.score).toBe("AG: 8 (Corrected: 13)");
    expect(r.interpretation).toContain("Elevated AG");
    expect(r.noteText).toContain("Elevated AG metabolic acidosis");
  });

  it("says when the raw gap alone would have looked normal", () => {
    // The clinically useful part: a reader who only glances at "AG: 8" needs to be told why
    // the conclusion disagrees with it.
    const r = c.calculate({ na: "140", cl: "105", hco3: "27", albumin: "2" });
    expect(r.interpretation).toContain("once corrected for albumin");
  });

  it("does not add that caveat when the raw gap was already elevated", () => {
    const r = c.calculate({ na: "140", cl: "100", hco3: "24" });
    expect(r.interpretation).toContain("Elevated AG");
    expect(r.interpretation).not.toContain("once corrected");
  });

  it("still treats a corrected gap of exactly 12 as normal and 13 as elevated", () => {
    // The boundary moved from the raw gap onto the corrected one, so re-assert it there.
    expect(c.calculate({ na: "140", cl: "104", hco3: "24" }).interpretation).toContain("Normal AG");
    expect(c.calculate({ na: "141", cl: "104", hco3: "24" }).interpretation).toContain("Elevated AG");
  });

  it("treats an albumin of '0' as the 4 g/dL default, not as zero", () => {
    // `parseFloat("0") || 4` → 4. Documented so a later "fix" to the helper does not silently
    // change every correction in the file.
    expect(c.calculate({ na: "140", cl: "100", hco3: "24", albumin: "0" }).score).toBe(
      "AG: 16 (Corrected: 16)",
    );
  });
});

// ── Cardiology ────────────────────────────────────────────────────────────────

describe("CHA₂DS₂-VASc", () => {
  const c = calc("chads_vasc");
  const none = { chf: "0", htn: "0", age75: "0", dm: "0", stroke: "0", vd: "0", age65: "0", sex: "0" };

  it("scores 0 and withholds anticoagulation for a man with no risk factors", () => {
    const r = c.calculate(none);
    expect(r.score).toBe("0 / 9");
    expect(r.interpretation).toBe("Annual stroke risk ~0% — No anticoagulation needed");
  });

  it("recommends only 'consider' for a woman whose sole point is her sex", () => {
    // Female sex is not an independent risk factor at score 1 — this fork is the whole
    // reason the calculator carries a sex input, and collapsing it over-anticoagulates.
    const r = c.calculate({ ...none, sex: "1" });
    expect(r.score).toBe("1 / 9");
    expect(r.interpretation).toBe("Annual stroke risk ~1.3% — Consider anticoagulation");
  });

  it("recommends anticoagulation for a man scoring 1 on a non-sex factor", () => {
    const r = c.calculate({ ...none, chf: "1" });
    expect(r.score).toBe("1 / 9");
    expect(r.interpretation).toBe("Annual stroke risk ~1.3% — Anticoagulation recommended (OAC)");
  });

  it("weights age ≥ 75 and prior stroke at 2 points each", () => {
    expect(c.calculate({ ...none, age75: "2" }).score).toBe("2 / 9");
    expect(c.calculate({ ...none, stroke: "2" }).score).toBe("2 / 9");
    expect(c.calculate({ ...none, age65: "1" }).score).toBe("1 / 9");
  });

  it("reaches the published maximum of 9", () => {
    const r = c.calculate({ chf: "1", htn: "1", age75: "2", dm: "1", stroke: "2", vd: "1", age65: "0", sex: "1" });
    expect(r.score).toBe("9 / 9");
    expect(r.interpretation).toBe("Annual stroke risk ~15.2% — Anticoagulation recommended (OAC)");
  });

  it("carries the published non-monotonic risk table verbatim", () => {
    // Lip 2010 reports 9.6% at 7 and 6.7% at 8 — lower than 9.8% at 6. It looks like a typo
    // and is not; pinning it stops someone "smoothing" the table into a monotonic curve.
    const at = (score: number, v: Record<string, string>) => {
      const r = c.calculate(v);
      expect(r.score).toBe(`${score} / 9`);
      return r.interpretation;
    };
    expect(at(6, { ...none, chf: "1", htn: "1", dm: "1", vd: "1", age75: "2" })).toContain("~9.8%");
    expect(at(7, { ...none, chf: "1", htn: "1", dm: "1", vd: "1", age75: "2", sex: "1" })).toContain("~9.6%");
    expect(at(8, { ...none, chf: "1", htn: "1", dm: "1", vd: "1", age75: "2", stroke: "2" })).toContain("~6.7%");
  });

  // KNOWN-BUG-103 — FIXED. Both age selects could be set, though no patient is in both
  // bands, producing "10 / 9" — a score outside its own stated scale.
  it("cannot exceed 9 even if both age bands are selected", () => {
    const r = c.calculate({ chf: "1", htn: "1", age75: "2", dm: "1", stroke: "2", vd: "1", age65: "1", sex: "1" });
    expect(r.score).toBe("9 / 9");
  });

  it("lets the older band win when both are set", () => {
    // ≥75 scores 2 and 65–74 scores 1; counting both would inflate by a point. Dropping the
    // younger band is what a clinician reading the form would do.
    const both = c.calculate({ ...none, age75: "2", age65: "1" });
    const olderOnly = c.calculate({ ...none, age75: "2" });
    expect(both.score).toBe("2 / 9");
    expect(both.score).toBe(olderOnly.score);
  });

  it("still counts the 65–74 band on its own", () => {
    expect(c.calculate({ ...none, age65: "1" }).score).toBe("1 / 9");
  });
});

describe("HAS-BLED", () => {
  const c = calc("has_bled");
  const keys = ["htn", "renal", "liver", "stroke", "bleed", "inr", "age", "drugs", "alcohol"];
  const withScore = (n: number): Record<string, string> =>
    Object.fromEntries(keys.map((k, idx) => [k, idx < n ? "1" : "0"]));

  it.each([
    [0, "Low"],
    [1, "Low"],
    [2, "Moderate"],
    [3, "High (>3%/yr) — modify risk factors, don't withhold OAC"],
    [9, "High (>3%/yr) — modify risk factors, don't withhold OAC"],
  ])("score %i → %s", (n, expected) => {
    const r = c.calculate(withScore(n));
    expect(r.score).toBe(`${n} / 9`);
    expect(r.interpretation).toBe(expected);
  });

  it("never advises withholding anticoagulation at high bleeding risk", () => {
    // A high HAS-BLED is an instruction to modify reversible risk factors, not to stop OAC.
    // Reading it as "do not anticoagulate" causes strokes; the wording is the safeguard.
    expect(c.calculate(withScore(5)).interpretation).toContain("don't withhold OAC");
  });
});

// ── Pulmonology ───────────────────────────────────────────────────────────────

describe("Wells Score (DVT)", () => {
  const c = calc("wells_dvt");
  const keys = ["cancer", "paralysis", "bedridden", "tenderness", "swelling", "calf", "pitting", "collateral"];
  const positives = (n: number): Record<string, string> =>
    Object.fromEntries(keys.map((k, idx) => [k, idx < n ? "1" : "0"]));

  it.each([
    [0, "Low (DVT prevalence ~5%) — consider D-dimer"],
    [1, "Moderate (~17%) — D-dimer or ultrasound"],
    [2, "Moderate (~17%) — D-dimer or ultrasound"],
    [3, "High (~53%) — Ultrasound recommended"],
    [8, "High (~53%) — Ultrasound recommended"],
  ])("score %i → %s", (n, expected) => {
    const r = c.calculate({ ...positives(n), alt_dx: "0" });
    expect(r.score).toBe(String(n));
    expect(r.interpretation).toBe(expected);
  });

  it("subtracts 2 for an equally likely alternative diagnosis", () => {
    const r = c.calculate({ ...positives(3), alt_dx: "-2" });
    expect(r.score).toBe("1");
    expect(r.interpretation).toContain("Moderate");
  });

  it("allows a negative total and still reports low risk", () => {
    const r = c.calculate({ ...positives(1), alt_dx: "-2" });
    expect(r.score).toBe("-1");
    expect(r.interpretation).toContain("Low");
  });
});

describe("CURB-65", () => {
  const c = calc("curb65");
  const keys = ["confusion", "urea", "rr", "bp", "age65"];
  const withScore = (n: number): Record<string, string> =>
    Object.fromEntries(keys.map((k, idx) => [k, idx < n ? "1" : "0"]));

  it.each([
    [0, "30-day mortality < 3% — Outpatient treatment"],
    [1, "30-day mortality < 3% — Outpatient treatment"],
    [2, "30-day mortality ~9% — Consider hospital admission"],
    [3, "30-day mortality ≥ 22% — ICU / high-dependency unit consideration"],
    [5, "30-day mortality ≥ 22% — ICU / high-dependency unit consideration"],
  ])("score %i → %s", (n, expected) => {
    const r = c.calculate(withScore(n));
    expect(r.score).toBe(`${n} / 5`);
    expect(r.interpretation).toBe(expected);
  });

  it("escalates from outpatient to admission at exactly 2", () => {
    // The disposition decision. One point either side sends the same patient home or to a bed.
    expect(c.calculate(withScore(1)).interpretation).toContain("Outpatient");
    expect(c.calculate(withScore(2)).interpretation).toContain("Consider hospital admission");
  });
});

describe("P/F ratio (Berlin ARDS)", () => {
  const c = calc("pao2_fio2");

  it.each([
    ["301", "1", 301, "Normal"],
    ["300", "1", 300, "Mild ARDS (200–300)"],
    ["201", "1", 201, "Mild ARDS (200–300)"],
    ["200", "1", 200, "Moderate ARDS (100–200)"],
    ["101", "1", 101, "Moderate ARDS (100–200)"],
    ["100", "1", 100, "Severe ARDS (< 100) — consider prone positioning"],
  ])("PaO₂ %s / FiO₂ %s → %i mmHg → %s", (pao2, fio2, ratio, interp) => {
    const r = c.calculate({ pao2, fio2 });
    expect(r.score).toBe(`${ratio} mmHg`);
    expect(r.interpretation).toBe(interp);
  });

  it("classifies a PaO₂ of exactly 300 as ARDS, per the Berlin definition", () => {
    // Berlin is ≤ 300, and the code's `> 300` gets that right. Asserted explicitly because
    // an off-by-one here declares a mild-ARDS patient normal.
    expect(c.calculate({ pao2: "300", fio2: "1" }).interpretation).toContain("Mild ARDS");
  });

  it("divides by FiO₂ as a fraction, not a percentage", () => {
    // 100 / 0.21 = 476. If someone types 21 meaning 21%, the ratio is 4.76 → Severe ARDS.
    expect(c.calculate({ pao2: "100", fio2: "0.21" }).score).toBe("476 mmHg");
    expect(c.calculate({ pao2: "100", fio2: "21" }).score).toBe("5 mmHg");
  });
});

describe("A-a gradient", () => {
  const c = calc("aa_gradient");

  it("computes FiO₂ × (Patm − 47) − PaCO₂/0.8 − PaO₂ at sea level", () => {
    // 0.21 × 713 − 40/0.8 − 95 = 149.73 − 50 − 95 = 4.73
    const r = c.calculate({ fio2: "0.21", paco2: "40", pao2: "95" });
    expect(r.score).toBe("5 mmHg");
    expect(r.interpretation).toBe("Normal A-a gradient — hypoventilation likely");
  });

  it("treats exactly 10 as elevated and 9 as normal", () => {
    // 1.0 × 713 − 50 = 663. PaO₂ 653 → gradient 10; PaO₂ 654 → gradient 9.
    expect(c.calculate({ fio2: "1", paco2: "40", pao2: "653" }).interpretation).toContain("Elevated");
    expect(c.calculate({ fio2: "1", paco2: "40", pao2: "654" }).interpretation).toContain("Normal");
  });

  it("defaults atmospheric pressure to 760 mmHg and honours an altitude override", () => {
    const sea = c.calculate({ fio2: "0.21", paco2: "40", pao2: "60" });
    const altitude = c.calculate({ fio2: "0.21", paco2: "40", pao2: "60", altitude: "600" });
    expect(sea.score).toBe("40 mmHg");
    expect(altitude.score).toBe("6 mmHg");
    // Same blood gas, opposite conclusion depending on altitude — the input is not cosmetic.
    expect(sea.interpretation).toContain("Elevated");
    expect(altitude.interpretation).toContain("Normal");
  });

  it("carries the age-expected guide in details", () => {
    const r = c.calculate({ fio2: "0.21", paco2: "40", pao2: "95" });
    expect(r.details).toBe("Expected = (Age/4) + 4 (rough guide)");
  });
});

// ── Neurology ─────────────────────────────────────────────────────────────────

describe("Glasgow Coma Scale", () => {
  const c = calc("gcs");

  it("sums E + V + M and renders the component breakdown", () => {
    const r = c.calculate({ eye: "4", verbal: "5", motor: "6" });
    expect(r.score).toBe("15 / 15  (E4V5M6)");
    expect(r.interpretation).toBe("Mild TBI / Minimal impairment");
  });

  it.each([
    [{ eye: "4", verbal: "4", motor: "5" }, 13, "Mild TBI / Minimal impairment"],
    [{ eye: "4", verbal: "3", motor: "5" }, 12, "Moderate TBI"],
    [{ eye: "3", verbal: "2", motor: "4" }, 9, "Moderate TBI"],
    [{ eye: "2", verbal: "2", motor: "4" }, 8, "Severe TBI (≤ 8) — consider intubation"],
    [{ eye: "1", verbal: "1", motor: "1" }, 3, "Severe TBI (≤ 8) — consider intubation"],
  ])("%o → %i", (v, total, interp) => {
    const r = c.calculate(v as Record<string, string>);
    expect(r.score).toContain(`${total} / 15`);
    expect(r.interpretation).toBe(interp);
  });

  it("flags intubation at exactly 8, not at 7", () => {
    // The airway decision. GCS ≤ 8 is the threshold taught everywhere; 9 is not.
    expect(c.calculate({ eye: "2", verbal: "2", motor: "4" }).interpretation).toContain("consider intubation");
    expect(c.calculate({ eye: "3", verbal: "2", motor: "4" }).interpretation).toBe("Moderate TBI");
  });

  it("defaults each unscored component to 1 rather than 0", () => {
    // A GCS of 0 does not exist; the minimum is 3. Defaulting to 1 per component is right.
    expect(c.calculate({}).score).toContain("3 / 15");
  });

  // KNOWN-BUG-104 — FIXED. `score` guarded unset components with `|| "?"`; noteText
  // interpolated them raw, so "Insert to Note" wrote "(EundefinedVundefinedMundefined)"
  // into the permanent clinical record.
  it("never writes 'undefined' into the note text", () => {
    expect(c.calculate({}).noteText).not.toContain("undefined");
  });

  it("shows the same component breakdown in the score and the note", () => {
    const partial = c.calculate({ eye: "3" });
    expect(partial.score).toContain("(E3V?M?)");
    expect(partial.noteText).toContain("(E3V?M?)");
  });
});

describe("Hunt-Hess (SAH)", () => {
  const c = calc("hunt_hess");

  it.each([
    ["1", "~2%"],
    ["2", "~5%"],
    ["3", "~20%"],
    ["4", "~40%"],
    ["5", "~80%"],
  ])("grade %s → operative mortality %s", (grade, mortality) => {
    const r = c.calculate({ grade });
    expect(r.score).toBe(`Grade ${grade} / 5`);
    expect(r.interpretation).toBe(`Operative mortality ~${mortality}`);
  });

  it("defaults to grade I when nothing is selected", () => {
    expect(c.calculate({}).score).toBe("Grade 1 / 5");
  });
});

// ── General ───────────────────────────────────────────────────────────────────

describe("BMI + ideal body weight", () => {
  const c = calc("bmi");

  it("computes BMI, Devine IBW, adjusted body weight and BSA for a male", () => {
    // 70 kg / 1.70 m → BMI 24.2. Height 66.93 in → IBW 50 + 2.3 × 6.93 = 65.9 kg.
    // ABW = 65.9 + 0.4 × (70 − 65.9) = 67.6. BSA = √(70 × 170 / 3600) = 1.82.
    const r = c.calculate({ weight: "70", height: "170", sex: "male" });
    expect(r.score).toBe("BMI 24.2 kg/m²");
    expect(r.interpretation).toBe("Normal | IBW: 65.9 kg | ABW: 67.6 kg | BSA: 1.82 m²");
  });

  it("uses the female Devine base of 45.5 kg, not 50", () => {
    // IBW drives chemotherapy and aminoglycoside dosing — a 4.5 kg base error is a real dose error.
    const r = c.calculate({ weight: "70", height: "170", sex: "female" });
    expect(r.interpretation).toContain("IBW: 61.4 kg");
  });

  it.each([
    ["53.2", "18.4", "Underweight"],
    ["53.5", "18.5", "Normal"],
    ["72.3", "25.0", "Overweight"],
    ["86.7", "30.0", "Obese Class I"],
    ["101.2", "35.0", "Obese Class II"],
    ["115.6", "40.0", "Obese Class III (Morbid)"],
  ])("weight %s kg at 170 cm → BMI %s → %s", (weight, bmiVal, band) => {
    const r = c.calculate({ weight, height: "170", sex: "male" });
    expect(r.score).toBe(`BMI ${bmiVal} kg/m²`);
    expect(r.interpretation).toContain(band);
  });

  it("bands on the unrounded BMI while displaying the rounded one", () => {
    // 72.2 kg / 1.70 m = 24.983 → displays "BMI 25.0 kg/m²" and classifies Normal. The
    // screen therefore reads "25.0 — Normal", which looks like a bug and is not: the band
    // is computed before toFixed(1). Pinned so nobody "fixes" it by rounding first, which
    // would move every patient sitting on a boundary into the higher band.
    const r = c.calculate({ weight: "72.2", height: "170", sex: "male" });
    expect(r.score).toBe("BMI 25.0 kg/m²");
    expect(r.interpretation).toContain("Normal");
  });

  it("treats a BMI of exactly 25.0 as Overweight and 18.5 as Normal", () => {
    // Both branches are exclusive upper bounds (`< 25`, `< 18.5`), so the boundary value
    // falls into the HIGHER band. Asserted so a `<=` refactor is caught.
    expect(c.calculate({ weight: "72.25", height: "170", sex: "male" }).interpretation).toContain("Overweight");
    expect(c.calculate({ weight: "53.465", height: "170", sex: "male" }).interpretation).toContain("Normal");
  });

  // KNOWN-BUG-101, same root cause as Cockcroft-Gault — FIXED.
  it("does not report a BMI when height or weight is missing", () => {
    expect(c.calculate({ weight: "70", height: "", sex: "male" })).toMatchObject({
      score: "—",
      interpretation: "Enter height to calculate.",
    });
    expect(c.calculate({ weight: "", height: "170", sex: "male" })).toMatchObject({
      score: "—",
      interpretation: "Enter weight to calculate.",
    });
  });
});

describe("Corrected calcium", () => {
  const c = calc("corrected_calcium");

  it("adds 0.8 mg/dL per g/dL of albumin below 4.0", () => {
    // The whole point: a total calcium of 8.0 in a hypoalbuminaemic patient is NORMAL, and
    // treating it as hypocalcaemia means unnecessary IV calcium.
    const r = c.calculate({ ca: "8.0", albumin: "2.0" });
    expect(r.score).toBe("9.60 mg/dL");
    expect(r.interpretation).toBe("Normal (8.5–10.5 mg/dL)");
  });

  it.each([
    ["8.0", "4.0", "8.00 mg/dL", "Hypocalcaemia"],
    ["8.5", "4.0", "8.50 mg/dL", "Normal (8.5–10.5 mg/dL)"],
    ["10.5", "4.0", "10.50 mg/dL", "Normal (8.5–10.5 mg/dL)"],
    ["11.0", "4.0", "11.00 mg/dL", "Hypercalcaemia"],
  ])("Ca %s / albumin %s → %s (%s)", (ca, albumin, score, interp) => {
    const r = c.calculate({ ca, albumin });
    expect(r.score).toBe(score);
    expect(r.interpretation).toBe(interp);
  });

  it("subtracts when albumin is above 4.0", () => {
    const r = c.calculate({ ca: "10.0", albumin: "5.0" });
    expect(r.score).toBe("9.20 mg/dL");
  });
});

describe("Osmol gap", () => {
  const c = calc("osmol_gap");

  it("computes measured − (2×Na + glucose/18 + BUN/2.8)", () => {
    // 2×140 + 90/18 + 14/2.8 = 280 + 5 + 5 = 290
    const r = c.calculate({ na: "140", glucose: "90", bun: "14", measured: "300" });
    expect(r.score).toBe("10 mOsm/kg");
    expect(r.interpretation).toBe("Normal (≤ 10)");
  });

  it("treats exactly 10 as normal and 11 as elevated", () => {
    // Toxic-alcohol screen: an elevated gap triggers fomepizole/dialysis consideration.
    expect(c.calculate({ na: "140", glucose: "90", bun: "14", measured: "300" }).interpretation).toBe("Normal (≤ 10)");
    expect(c.calculate({ na: "140", glucose: "90", bun: "14", measured: "301" }).interpretation).toContain("Elevated");
  });
});

// ── Surgery ───────────────────────────────────────────────────────────────────

describe("ASA physical status", () => {
  const c = calc("asa_class");

  it.each([
    ["1", "No special precautions"],
    ["2", "Mild disease, well-controlled"],
    ["3", "Significant functional limitation"],
    ["4", "Constant threat to life"],
    ["5", "Moribund — surgery as last resort"],
    ["6", "Organ donor"],
    ["E", "Emergency surgery — add E to class"],
  ])("class %s → %s", (cls, interp) => {
    const r = c.calculate({ class: cls });
    expect(r.score).toBe(`ASA ${cls}`);
    expect(r.interpretation).toBe(interp);
  });

  it("renders an em-dash rather than a blank for an unrecognised class", () => {
    expect(c.calculate({ class: "9" }).interpretation).toBe("—");
  });

  // KNOWN-BUG-104, same shape as GCS — FIXED.
  it("produces no note text at all when no class is selected", () => {
    // Stronger than "contains no 'undefined'": there is nothing to insert into a note, so
    // "Insert to Note" has nothing to write rather than a placeholder.
    const r = c.calculate({});
    expect(r.noteText).toBeUndefined();
    expect(r.score).toBe("—");
    expect(r.interpretation).toBe("Enter an ASA class to calculate.");
  });

  it("keeps the note consistent with the interpretation for an unknown class", () => {
    const r = c.calculate({ class: "9" });
    expect(r.interpretation).toBe("—");
    expect(r.noteText).toBe("ASA Class: 9 — —");
  });
});

// ── OB/GYN ────────────────────────────────────────────────────────────────────

describe("Bishop score", () => {
  const c = calc("bishop_score");
  const fields = (dilation: string, effacement: string, station: string, consistency: string, position: string) => ({
    dilation, effacement, station, consistency, position,
  });

  it("sums to the stated maximum of 13", () => {
    expect(c.calculate(fields("3", "3", "3", "2", "2")).score).toBe("13 / 13");
  });

  it.each([
    [fields("1", "1", "1", "1", "1"), 5, "Unfavourable — consider cervical ripening first"],
    [fields("2", "1", "1", "1", "1"), 6, "Borderline — induction may be attempted"],
    [fields("2", "2", "1", "1", "1"), 7, "Borderline — induction may be attempted"],
    [fields("2", "2", "2", "1", "1"), 8, "Favourable — induction likely successful"],
  ])("%o → %i", (v, total, interp) => {
    const r = c.calculate(v);
    expect(r.score).toBe(`${total} / 13`);
    expect(r.interpretation).toBe(interp);
  });

  it("switches from ripening to induction at exactly 6 and to favourable at exactly 8", () => {
    // This decides whether a woman gets prostaglandin ripening or goes straight to oxytocin.
    expect(c.calculate(fields("1", "1", "1", "1", "1")).interpretation).toContain("Unfavourable");
    expect(c.calculate(fields("2", "1", "1", "1", "1")).interpretation).toContain("Borderline");
    expect(c.calculate(fields("2", "2", "2", "1", "1")).interpretation).toContain("Favourable");
  });
});

describe("Gestational age by LMP", () => {
  const c = calc("gestational_age");

  it("converts days since LMP into weeks + days", () => {
    const r = c.calculate({ lmp: "200" });
    expect(r.score).toBe("28w + 4d");
    expect(r.interpretation).toBe("GA: 28w 4d | EDD in 11 weeks");
  });

  it("reaches term at 280 days with the EDD due now", () => {
    const r = c.calculate({ lmp: "280" });
    expect(r.score).toBe("40w + 0d");
    expect(r.interpretation).toBe("GA: 40w 0d | EDD in 0 weeks");
  });

  // KNOWN-BUG-105 — FIXED. Past 280 days the countdown went negative and Math.floor rounded
  // away from zero, so 41w+3d rendered "EDD in -2 weeks".
  it("describes a post-dates pregnancy as overdue, in days", () => {
    const r = c.calculate({ lmp: "290" });
    expect(r.score).toBe("41w + 3d");
    expect(r.interpretation).toBe("GA: 41w 3d | EDD passed 10 days ago — post-dates");
    expect(r.noteText).toContain("post-dates");
  });

  it("does not report a negative countdown at any gestation", () => {
    for (const lmp of ["281", "290", "300", "400"]) {
      expect(c.calculate({ lmp }).interpretation, lmp).not.toMatch(/-\d/);
    }
  });

  it("singularises one day overdue", () => {
    expect(c.calculate({ lmp: "281" }).interpretation).toContain("passed 1 day ago");
  });

  it("still counts down normally before term", () => {
    expect(c.calculate({ lmp: "200" }).interpretation).toBe("GA: 28w 4d | EDD in 11 weeks");
    expect(c.calculate({ lmp: "273" }).interpretation).toContain("EDD in 1 week");
  });
});

// ── Paediatric ────────────────────────────────────────────────────────────────

describe("PEWS", () => {
  const c = calc("pews");

  it.each([
    [{ behaviour: "0", cvs: "0", resp: "0" }, 0, "Low risk"],
    [{ behaviour: "1", cvs: "0", resp: "0" }, 1, "Low risk"],
    [{ behaviour: "1", cvs: "1", resp: "0" }, 2, "Moderate risk — increase monitoring"],
    [{ behaviour: "1", cvs: "1", resp: "1" }, 3, "Moderate risk — increase monitoring"],
    [{ behaviour: "2", cvs: "1", resp: "1" }, 4, "High risk (≥ 4) — immediate medical review"],
    [{ behaviour: "3", cvs: "3", resp: "3" }, 9, "High risk (≥ 4) — immediate medical review"],
  ])("%o → %i", (v, total, interp) => {
    const r = c.calculate(v as Record<string, string>);
    expect(r.score).toBe(`${total} / 9`);
    expect(r.interpretation).toBe(interp);
  });

  it("escalates to immediate medical review at exactly 4", () => {
    // The deterioration trigger. A child at 4 gets seen now; at 3 they get observed.
    expect(c.calculate({ behaviour: "1", cvs: "1", resp: "1" }).interpretation).toContain("Moderate");
    expect(c.calculate({ behaviour: "2", cvs: "1", resp: "1" }).interpretation).toContain("immediate medical review");
  });

  it("scores an unfilled assessment as 0 / low risk — the reassuring-blank-form trap", () => {
    // Documented deliberately: an untouched PEWS form reads "Low risk". The screen must not
    // present that as an assessment, and a caller must not treat 0 as "assessed and well".
    expect(c.calculate({}).score).toBe("0 / 9");
    expect(c.calculate({}).interpretation).toBe("Low risk");
  });
});

// ── ICU ───────────────────────────────────────────────────────────────────────

describe("SOFA", () => {
  const keys = ["pf_ratio", "platelets", "bilirubin", "map", "gcs_sofa", "creatinine"];
  /** Distribute `total` points across the six organ systems, max 4 each. */
  const withScore = (total: number): Record<string, string> => {
    let left = total;
    return Object.fromEntries(
      keys.map((k) => {
        const take = Math.min(4, left);
        left -= take;
        return [k, String(take)];
      }),
    );
  };

  it("reaches the stated maximum of 24 with all six systems failing", () => {
    expect(sofa.calculate(withScore(24)).score).toBe("24 / 24");
  });

  it.each([
    [0, "< 1%"],
    [2, "< 1%"],
    [3, "< 1%"],
    [4, "< 1%"],
    [5, "< 1%"],
    [6, "< 5%"],
    [7, "< 5%"],
    [8, "< 15%"],
    [9, "< 15%"],
    [10, "< 50%"],
    [11, "< 50%"],
    [12, "> 50%"],
    [24, "> 50%"],
  ])("score %i → predicted ICU mortality %s", (total, mortality) => {
    const r = sofa.calculate(withScore(total));
    expect(r.score).toBe(`${total} / 24`);
    expect(r.interpretation).toBe(`Predicted ICU mortality: ${mortality}`);
  });

  it("crosses into >50% predicted mortality at exactly 12", () => {
    expect(sofa.calculate(withScore(11)).interpretation).toContain("< 50%");
    expect(sofa.calculate(withScore(12)).interpretation).toContain("> 50%");
  });
});

describe("APACHE II", () => {
  /** APACHE II = acute physiology (4 × 0–4) + (15 − GCS) + age points + chronic health. */
  const build = (opts: { aps?: number; gcs?: number; age?: number; chronic?: number }) => {
    const aps = opts.aps ?? 0;
    const per = [Math.min(4, aps), Math.min(4, Math.max(0, aps - 4)), Math.min(4, Math.max(0, aps - 8)), Math.min(4, Math.max(0, aps - 12))];
    return {
      temp: String(per[0]),
      map_a: String(per[1]),
      hr_a: String(per[2]),
      rr_a: String(per[3]),
      gcs_a: String(opts.gcs ?? 15),
      age: String(opts.age ?? 40),
      chronic: String(opts.chronic ?? 0),
    };
  };

  it("scores 0 for a young patient with normal physiology and GCS 15", () => {
    const r = apacheII.calculate(build({}));
    expect(r.score).toBe("0");
    expect(r.interpretation).toBe("Predicted hospital mortality: ~4%");
  });

  it("converts GCS into (15 − GCS) points", () => {
    expect(apacheII.calculate(build({ gcs: 15 })).score).toBe("0");
    expect(apacheII.calculate(build({ gcs: 3 })).score).toBe("12");
    expect(apacheII.calculate(build({ gcs: 10 })).score).toBe("5");
  });

  it.each([
    [44, 0],
    [45, 2],
    [54, 2],
    [55, 3],
    [64, 3],
    [65, 5],
    [74, 5],
    [75, 6],
    [90, 6],
  ])("age %i contributes %i points", (age, points) => {
    expect(apacheII.calculate(build({ age })).score).toBe(String(points));
  });

  it("adds chronic health points", () => {
    expect(apacheII.calculate(build({ chronic: 2 })).score).toBe("2");
    expect(apacheII.calculate(build({ chronic: 5 })).score).toBe("5");
  });

  it.each([
    [{ aps: 4 }, 4, "~4%"],
    [{ aps: 5 }, 5, "~8%"],
    [{ aps: 9 }, 9, "~8%"],
    [{ aps: 10 }, 10, "~15%"],
    [{ aps: 14 }, 14, "~15%"],
    [{ aps: 15 }, 15, "~25%"],
    [{ aps: 16, gcs: 12 }, 19, "~25%"],
    [{ aps: 16, gcs: 11 }, 20, "~40%"],
    [{ aps: 16, gcs: 7 }, 24, "~40%"],
    [{ aps: 16, gcs: 6 }, 25, "~55%"],
    [{ aps: 16, gcs: 4, chronic: 2 }, 29, "~55%"],
    [{ aps: 16, gcs: 3, chronic: 2 }, 30, "~73%"],
    [{ aps: 16, gcs: 4, chronic: 5, age: 50 }, 34, "~73%"],
    [{ aps: 16, gcs: 3, chronic: 5, age: 50 }, 35, "~85%"],
  ])("%o → score %i → mortality %s", (opts, total, mortality) => {
    const r = apacheII.calculate(build(opts));
    expect(r.score).toBe(String(total));
    expect(r.interpretation).toBe(`Predicted hospital mortality: ${mortality}`);
  });

  it("defaults a blank GCS to 15 rather than scoring it as 0", () => {
    // `i(v.gcs_a || "15")`. Defaulting to 0 would add 15 points to every unfilled form and
    // roughly quadruple the reported mortality.
    const r = apacheII.calculate({ ...build({}), gcs_a: "" });
    expect(r.score).toBe("0");
  });
});
