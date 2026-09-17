/**
 * Clinical Calculator Registry
 * 30+ calculators for use at the point of care.
 * Each calculator is self-contained: inputs schema + pure calculate() function.
 */

export type InputType = "number" | "select" | "boolean";

export interface CalcInput {
  id: string;
  label: string;
  type: InputType;
  unit?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

export interface CalcResult {
  score: string;
  interpretation: string;
  details?: string;
  noteText?: string; // pre-formatted text for "Insert to Note"
}

export interface Calculator {
  id: string;
  name: string;
  category: string;
  description: string;
  inputs: CalcInput[];
  calculate: (v: Record<string, string>) => CalcResult;
  reference?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const n = (v: string, fallback = 0) => parseFloat(v) || fallback;
const i = (v: string, fallback = 0) => parseInt(v) || fallback;

/**
 * KNOWN-BUG-101. Several calculators divide by a user-entered value, and `n()` returns 0 for
 * a blank field (and for "0", since `parseFloat("0") || 0` is 0). Cockcroft-Gault with no
 * creatinine therefore returned `Infinity`, rendered "Infinity mL/min", and interpreted it
 * as **"Normal"** — on the calculator used to dose renally-cleared drugs. BMI with no height
 * did the same.
 *
 * A calculator with a missing input has no answer. Saying so is the only safe output; a
 * number that happens to be reassuring is the dangerous one.
 */
const MISSING_INPUT_RESULT = (what: string): CalcResult => ({
  score: "—",
  interpretation: `Enter ${what} to calculate.`,
  noteText: undefined,
});

/** True when a denominator is unusable — blank, zero, negative or non-numeric. */
const unusable = (v: string): boolean => {
  const parsed = parseFloat(v);
  return !Number.isFinite(parsed) || parsed <= 0;
};

// ═══════════════════════════════════════════════════════════════════════════════
// RENAL
// ═══════════════════════════════════════════════════════════════════════════════

const ckdEpi: Calculator = {
  id: "ckd_epi",
  name: "eGFR (CKD-EPI)",
  category: "Renal",
  description: "Estimated GFR using CKD-EPI 2021 equation (no race variable)",
  inputs: [
    { id: "scr", label: "Serum Creatinine", type: "number", unit: "mg/dL", min: 0.1, step: 0.01, required: true },
    { id: "age", label: "Age", type: "number", unit: "years", min: 18, max: 100, required: true },
    { id: "sex", label: "Biological Sex", type: "select", options: [{ value: "female", label: "Female" }, { value: "male", label: "Male" }], required: true },
  ],
  calculate(v) {
    if (unusable(v.scr)) return MISSING_INPUT_RESULT("serum creatinine");
    const scr = n(v.scr); const age = n(v.age); const female = v.sex === "female";
    const kappa = female ? 0.7 : 0.9;
    const alpha = female ? -0.241 : -0.302;
    const ratio = scr / kappa;
    const egfr = 142 * Math.pow(Math.min(ratio, 1), alpha) * Math.pow(Math.max(ratio, 1), -1.200) * Math.pow(0.9938, age) * (female ? 1.012 : 1);
    const r = Math.round(egfr);
    const stage = r >= 90 ? "G1 (Normal/High)" : r >= 60 ? "G2 (Mildly ↓)" : r >= 45 ? "G3a (Mildly-Mod ↓)" : r >= 30 ? "G3b (Mod-Severely ↓)" : r >= 15 ? "G4 (Severely ↓)" : "G5 (Kidney Failure)";
    return { score: `${r} mL/min/1.73m²`, interpretation: stage, noteText: `eGFR (CKD-EPI): ${r} mL/min/1.73m² — CKD Stage ${stage}` };
  },
  reference: "Inker LA et al. NEJM 2021",
};

const cockcroft: Calculator = {
  id: "cockcroft_gault",
  name: "CrCl (Cockcroft-Gault)",
  category: "Renal",
  description: "Creatinine clearance for drug dosing",
  inputs: [
    { id: "scr", label: "Serum Creatinine", type: "number", unit: "mg/dL", step: 0.01, required: true },
    { id: "age", label: "Age", type: "number", unit: "years", required: true },
    { id: "weight", label: "Weight", type: "number", unit: "kg", required: true },
    { id: "sex", label: "Biological Sex", type: "select", options: [{ value: "male", label: "Male" }, { value: "female", label: "Female" }], required: true },
  ],
  calculate(v) {
    if (unusable(v.scr)) return MISSING_INPUT_RESULT("serum creatinine");
    const crcl = ((140 - n(v.age)) * n(v.weight)) / (72 * n(v.scr)) * (v.sex === "female" ? 0.85 : 1);
    const r = Math.round(crcl);
    const interp = r >= 90 ? "Normal" : r >= 60 ? "Mild CKD" : r >= 30 ? "Moderate CKD" : r >= 15 ? "Severe CKD" : "Kidney Failure";
    return { score: `${r} mL/min`, interpretation: interp, noteText: `CrCl (Cockcroft-Gault): ${r} mL/min — ${interp}` };
  },
};

const fena: Calculator = {
  id: "fena",
  name: "FENa (Fractional Excretion of Sodium)",
  category: "Renal",
  description: "Differentiates pre-renal from intrinsic AKI",
  inputs: [
    { id: "u_na", label: "Urine Sodium", type: "number", unit: "mEq/L", required: true },
    { id: "s_na", label: "Serum Sodium", type: "number", unit: "mEq/L", required: true },
    { id: "u_cr", label: "Urine Creatinine", type: "number", unit: "mg/dL", required: true },
    { id: "s_cr", label: "Serum Creatinine", type: "number", unit: "mg/dL", required: true },
  ],
  calculate(v) {
    if (unusable(v.s_na) || unusable(v.u_cr)) return MISSING_INPUT_RESULT("serum sodium and urine creatinine");
    const fena = (n(v.u_na) * n(v.s_cr)) / (n(v.s_na) * n(v.u_cr)) * 100;
    const r = fena.toFixed(2);
    const interp = fena < 1 ? "< 1% — Pre-renal AKI (respond to fluids)" : fena < 2 ? "1–2% — Borderline — consider clinical context" : "> 2% — Intrinsic renal AKI (ATN)";
    return { score: `${r}%`, interpretation: interp, noteText: `FENa: ${r}% — ${interp}` };
  },
};

const anionGap: Calculator = {
  id: "anion_gap",
  name: "Anion Gap",
  category: "Renal",
  description: "Metabolic acidosis evaluation",
  inputs: [
    { id: "na", label: "Sodium (Na⁺)", type: "number", unit: "mEq/L", required: true },
    { id: "cl", label: "Chloride (Cl⁻)", type: "number", unit: "mEq/L", required: true },
    { id: "hco3", label: "Bicarbonate (HCO₃⁻)", type: "number", unit: "mEq/L", required: true },
    { id: "albumin", label: "Albumin (optional)", type: "number", unit: "g/dL", step: 0.1 },
  ],
  calculate(v) {
    const ag = n(v.na) - (n(v.cl) + n(v.hco3));
    const alb = n(v.albumin, 4);
    const correctedAg = ag + 2.5 * (4 - alb);
    const rounded = Math.round(correctedAg);
    // KNOWN-BUG-102. The interpretation was computed from the RAW gap while the score
    // displayed the corrected one, so a hypoalbuminaemic patient whose corrected gap is
    // elevated read "Normal AG" — and unmasking exactly that patient is the entire purpose
    // of correcting for albumin. The correction now drives the conclusion, not just the
    // number next to it.
    const high = rounded > 12;
    const masked = high && ag <= 12;
    const interp = high
      ? `Elevated AG${masked ? " once corrected for albumin (raw gap looks normal)" : ""} — MUDPILES: Methanol, Uraemia, DKA, Propylene glycol, INH/Iron, Lactic acidosis, Ethanol, Salicylates`
      : "Normal AG (8–12) — Non-AG metabolic acidosis";
    return {
      score: `AG: ${ag} (Corrected: ${rounded})`,
      interpretation: interp,
      noteText: `Anion Gap: ${ag} mEq/L (albumin-corrected: ${rounded}) — ${high ? "Elevated AG metabolic acidosis" : "Normal AG"}`,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CARDIOLOGY
// ═══════════════════════════════════════════════════════════════════════════════

const chadsVasc: Calculator = {
  id: "chads_vasc",
  name: "CHA₂DS₂-VASc (AF Stroke Risk)",
  category: "Cardiology",
  description: "Annual stroke risk in non-valvular AF",
  inputs: [
    { id: "chf", label: "CHF / LV dysfunction", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "htn", label: "Hypertension", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "age75", label: "Age ≥ 75 years", type: "select", options: [{ value: "2", label: "Yes (+2)" }, { value: "0", label: "No" }] },
    { id: "dm", label: "Diabetes mellitus", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "stroke", label: "Prior stroke / TIA / thromboembolism", type: "select", options: [{ value: "2", label: "Yes (+2)" }, { value: "0", label: "No" }] },
    { id: "vd", label: "Vascular disease (MI, PAD, aortic plaque)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "age65", label: "Age 65–74 years", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "sex", label: "Biological Sex", type: "select", options: [{ value: "1", label: "Female (+1)" }, { value: "0", label: "Male" }] },
  ],
  calculate(v) {
    // KNOWN-BUG-103. "Age ≥ 75" (+2) and "Age 65–74" (+1) are independent selects and both
    // could be set, though no patient is in both bands — producing "10 / 9", a score outside
    // its own stated scale. The older band wins, which is what a clinician would do.
    const age65 = i(v.age75 || "0") > 0 ? 0 : i(v.age65 || "0");
    const score =
      ["chf", "htn", "age75", "dm", "stroke", "vd", "sex"].reduce((s, k) => s + i(v[k] || "0"), 0) + age65;
    const riskPct = [0, 1.3, 2.2, 3.2, 4.0, 6.7, 9.8, 9.6, 6.7, 15.2][Math.min(score, 9)];
    const rec = score === 0 ? "No anticoagulation needed" : score === 1 && v.sex === "1" ? "Consider anticoagulation" : "Anticoagulation recommended (OAC)";
    return { score: `${score} / 9`, interpretation: `Annual stroke risk ~${riskPct}% — ${rec}`, noteText: `CHA₂DS₂-VASc: ${score}/9 (~${riskPct}%/yr) — ${rec}` };
  },
  reference: "Lip GY, Chest 2010",
};

const hasBled: Calculator = {
  id: "has_bled",
  name: "HAS-BLED (Bleeding Risk in AF)",
  category: "Cardiology",
  description: "Major bleeding risk on anticoagulation",
  inputs: [
    { id: "htn", label: "Uncontrolled Hypertension (SBP > 160)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "renal", label: "Renal disease (dialysis / Cr > 2.26)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "liver", label: "Liver disease (cirrhosis / bilirubin > 2×)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "stroke", label: "Prior stroke history", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "bleed", label: "Prior major bleeding / bleeding predisposition", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "inr", label: "Labile INR (< 60% time in therapeutic range)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "age", label: "Age > 65", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "drugs", label: "Antiplatelet / NSAIDs use", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "alcohol", label: "Alcohol use (≥ 8 drinks/week)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
  ],
  calculate(v) {
    const score = ["htn","renal","liver","stroke","bleed","inr","age","drugs","alcohol"].reduce((s, k) => s + i(v[k] || "0"), 0);
    const risk = score <= 1 ? "Low" : score <= 2 ? "Moderate" : "High (>3%/yr) — modify risk factors, don't withhold OAC";
    return { score: `${score} / 9`, interpretation: risk, noteText: `HAS-BLED: ${score}/9 — Bleeding risk: ${risk}` };
  },
};

const wells_dvt: Calculator = {
  id: "wells_dvt",
  name: "Wells Score (DVT)",
  category: "Pulmonology",
  description: "Pre-test probability of deep vein thrombosis",
  inputs: [
    { id: "cancer", label: "Active cancer (treatment within 6 months)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "paralysis", label: "Paralysis / paresis / recent plaster immobilisation of lower extremity", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "bedridden", label: "Bedridden > 3 days or major surgery < 12 weeks", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "tenderness", label: "Localised tenderness along deep venous system", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "swelling", label: "Entire leg swollen", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "calf", label: "Calf swelling > 3 cm vs contralateral leg", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "pitting", label: "Pitting oedema (greater in symptomatic leg)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "collateral", label: "Collateral superficial veins (non-varicose)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "alt_dx", label: "Alternative diagnosis at least as likely as DVT", type: "select", options: [{ value: "-2", label: "Yes (−2)" }, { value: "0", label: "No" }] },
  ],
  calculate(v) {
    const score = ["cancer","paralysis","bedridden","tenderness","swelling","calf","pitting","collateral"].reduce((s, k) => s + i(v[k] || "0"), 0) + i(v.alt_dx || "0");
    const risk = score <= 0 ? "Low (DVT prevalence ~5%) — consider D-dimer" : score <= 2 ? "Moderate (~17%) — D-dimer or ultrasound" : "High (~53%) — Ultrasound recommended";
    return { score: `${score}`, interpretation: risk, noteText: `Wells DVT Score: ${score} — ${risk}` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PULMONOLOGY
// ═══════════════════════════════════════════════════════════════════════════════

const curb65: Calculator = {
  id: "curb65",
  name: "CURB-65 (Pneumonia Severity)",
  category: "Pulmonology",
  description: "Severity assessment for community-acquired pneumonia",
  inputs: [
    { id: "confusion", label: "Confusion (new disorientation)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "urea", label: "Urea > 7 mmol/L (BUN > 19 mg/dL)", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "rr", label: "Respiratory Rate ≥ 30 /min", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "bp", label: "SBP < 90 or DBP ≤ 60 mmHg", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
    { id: "age65", label: "Age ≥ 65 years", type: "select", options: [{ value: "1", label: "Yes (+1)" }, { value: "0", label: "No" }] },
  ],
  calculate(v) {
    const score = ["confusion","urea","rr","bp","age65"].reduce((s, k) => s + i(v[k] || "0"), 0);
    const [mortality, rec] = score <= 1
      ? ["< 3%", "Outpatient treatment"]
      : score === 2
      ? ["~9%", "Consider hospital admission"]
      : ["≥ 22%", "ICU / high-dependency unit consideration"];
    return { score: `${score} / 5`, interpretation: `30-day mortality ${mortality} — ${rec}`, noteText: `CURB-65: ${score}/5 — Mortality ${mortality} — ${rec}` };
  },
};

const pao2fio2: Calculator = {
  id: "pao2_fio2",
  name: "P/F Ratio (PaO₂/FiO₂)",
  category: "Pulmonology",
  description: "ARDS severity classification (Berlin Definition)",
  inputs: [
    { id: "pao2", label: "PaO₂ (arterial)", type: "number", unit: "mmHg", required: true },
    { id: "fio2", label: "FiO₂", type: "number", unit: "fraction (0.21–1.0)", min: 0.21, max: 1.0, step: 0.01, required: true },
  ],
  calculate(v) {
    if (unusable(v.fio2)) return MISSING_INPUT_RESULT("FiO₂");
    const ratio = n(v.pao2) / n(v.fio2);
    const r = Math.round(ratio);
    const interp = ratio > 300 ? "Normal" : ratio > 200 ? "Mild ARDS (200–300)" : ratio > 100 ? "Moderate ARDS (100–200)" : "Severe ARDS (< 100) — consider prone positioning";
    return { score: `${r} mmHg`, interpretation: interp, noteText: `PaO₂/FiO₂ ratio: ${r} mmHg — ${interp}` };
  },
};

const aaGradient: Calculator = {
  id: "aa_gradient",
  name: "A-a Gradient",
  category: "Pulmonology",
  description: "Differentiates pulmonary vs non-pulmonary causes of hypoxia",
  inputs: [
    { id: "fio2", label: "FiO₂", type: "number", unit: "fraction", step: 0.01, required: true },
    { id: "paco2", label: "PaCO₂", type: "number", unit: "mmHg", required: true },
    { id: "pao2", label: "PaO₂", type: "number", unit: "mmHg", required: true },
    { id: "altitude", label: "Atmospheric Pressure", type: "number", unit: "mmHg", min: 600, max: 760 },
  ],
  calculate(v) {
    const patm = n(v.altitude, 760);
    const pao2_alveolar = n(v.fio2) * (patm - 47) - n(v.paco2) / 0.8;
    const grad = pao2_alveolar - n(v.pao2);
    const r = Math.round(grad);
    const age_expected = "Expected = (Age/4) + 4 (rough guide)";
    const interp = grad < 10 ? "Normal A-a gradient — hypoventilation likely" : `Elevated A-a gradient (${r} mmHg) — V/Q mismatch, shunt, or diffusion defect`;
    return { score: `${r} mmHg`, interpretation: interp, details: age_expected, noteText: `A-a Gradient: ${r} mmHg — ${interp}` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// NEUROLOGY
// ═══════════════════════════════════════════════════════════════════════════════

const gcs: Calculator = {
  id: "gcs",
  name: "Glasgow Coma Scale (GCS)",
  category: "Neurology",
  description: "Level of consciousness assessment",
  inputs: [
    { id: "eye", label: "Eye Opening", type: "select", options: [{ value: "4", label: "4 — Spontaneous" }, { value: "3", label: "3 — To voice" }, { value: "2", label: "2 — To pain" }, { value: "1", label: "1 — None" }] },
    { id: "verbal", label: "Verbal Response", type: "select", options: [{ value: "5", label: "5 — Oriented" }, { value: "4", label: "4 — Confused" }, { value: "3", label: "3 — Inappropriate words" }, { value: "2", label: "2 — Sounds" }, { value: "1", label: "1 — None" }] },
    { id: "motor", label: "Motor Response", type: "select", options: [{ value: "6", label: "6 — Obeys commands" }, { value: "5", label: "5 — Localises pain" }, { value: "4", label: "4 — Withdraws" }, { value: "3", label: "3 — Abnormal flexion" }, { value: "2", label: "2 — Extension" }, { value: "1", label: "1 — None" }] },
  ],
  calculate(v) {
    const score = i(v.eye || "1") + i(v.verbal || "1") + i(v.motor || "1");
    const interp = score >= 13 ? "Mild TBI / Minimal impairment" : score >= 9 ? "Moderate TBI" : "Severe TBI (≤ 8) — consider intubation";
    // KNOWN-BUG-104. `score` guarded unset components with `|| "?"`; noteText interpolated
    // them raw, so "Insert to Note" wrote "(EundefinedVundefinedMundefined)" into the
    // permanent clinical record. Both now read from one breakdown.
    const breakdown = `E${v.eye || "?"}V${v.verbal || "?"}M${v.motor || "?"}`;
    return {
      score: `${score} / 15  (${breakdown})`,
      interpretation: interp,
      noteText: `GCS: ${score}/15 (${breakdown}) — ${interp}`,
    };
  },
};

const huntHess: Calculator = {
  id: "hunt_hess",
  name: "Hunt-Hess (SAH Grade)",
  category: "Neurology",
  description: "Subarachnoid haemorrhage severity and surgical risk",
  inputs: [
    { id: "grade", label: "Clinical Grade", type: "select", options: [
      { value: "1", label: "Grade I — Asymptomatic or mild headache" },
      { value: "2", label: "Grade II — Moderate-severe headache, nuchal rigidity, no neuro deficit" },
      { value: "3", label: "Grade III — Drowsy / confused, mild focal deficit" },
      { value: "4", label: "Grade IV — Stupor, moderate-severe hemiparesis" },
      { value: "5", label: "Grade V — Deep coma, decerebrate posturing" },
    ] },
  ],
  calculate(v) {
    const mortalities = ["—", "~2%", "~5%", "~20%", "~40%", "~80%"];
    const g = v.grade || "1";
    return { score: `Grade ${g} / 5`, interpretation: `Operative mortality ~${mortalities[parseInt(g)]}`, noteText: `Hunt-Hess Grade: ${g}/5 — Mortality ${mortalities[parseInt(g)]}` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// GENERAL
// ═══════════════════════════════════════════════════════════════════════════════

const bmi: Calculator = {
  id: "bmi",
  name: "BMI + Ideal Body Weight",
  category: "General",
  description: "Body Mass Index and IBW (Devine formula)",
  inputs: [
    { id: "weight", label: "Weight", type: "number", unit: "kg", required: true },
    { id: "height", label: "Height", type: "number", unit: "cm", required: true },
    { id: "sex", label: "Biological Sex", type: "select", options: [{ value: "male", label: "Male" }, { value: "female", label: "Female" }] },
  ],
  calculate(v) {
    if (unusable(v.height)) return MISSING_INPUT_RESULT("height");
    if (unusable(v.weight)) return MISSING_INPUT_RESULT("weight");
    const wt = n(v.weight); const ht = n(v.height); const htM = ht / 100;
    const bmiVal = wt / (htM * htM);
    const htIn = ht / 2.54;
    const ibw = v.sex === "male" ? 50 + 2.3 * (htIn - 60) : 45.5 + 2.3 * (htIn - 60);
    const abw = ibw + 0.4 * (wt - ibw);
    const bsa = Math.sqrt((wt * ht) / 3600);
    const interp = bmiVal < 18.5 ? "Underweight" : bmiVal < 25 ? "Normal" : bmiVal < 30 ? "Overweight" : bmiVal < 35 ? "Obese Class I" : bmiVal < 40 ? "Obese Class II" : "Obese Class III (Morbid)";
    return {
      score: `BMI ${bmiVal.toFixed(1)} kg/m²`,
      interpretation: `${interp} | IBW: ${ibw.toFixed(1)} kg | ABW: ${abw.toFixed(1)} kg | BSA: ${bsa.toFixed(2)} m²`,
      noteText: `BMI: ${bmiVal.toFixed(1)} (${interp}) | IBW: ${ibw.toFixed(1)} kg | BSA: ${bsa.toFixed(2)} m²`,
    };
  },
};

const correctedCalcium: Calculator = {
  id: "corrected_calcium",
  name: "Corrected Calcium",
  category: "General",
  description: "Albumin-adjusted serum calcium",
  inputs: [
    { id: "ca", label: "Serum Calcium", type: "number", unit: "mg/dL", step: 0.1, required: true },
    { id: "albumin", label: "Serum Albumin", type: "number", unit: "g/dL", step: 0.1, required: true },
  ],
  calculate(v) {
    const corrCa = n(v.ca) + 0.8 * (4.0 - n(v.albumin));
    const r = corrCa.toFixed(2);
    const interp = corrCa < 8.5 ? "Hypocalcaemia" : corrCa > 10.5 ? "Hypercalcaemia" : "Normal (8.5–10.5 mg/dL)";
    return { score: `${r} mg/dL`, interpretation: interp, noteText: `Corrected Calcium: ${r} mg/dL — ${interp}` };
  },
};

const osmolGap: Calculator = {
  id: "osmol_gap",
  name: "Osmol Gap",
  category: "General",
  description: "Screen for toxic alcohols (methanol, ethylene glycol)",
  inputs: [
    { id: "na", label: "Sodium", type: "number", unit: "mEq/L", required: true },
    { id: "glucose", label: "Glucose", type: "number", unit: "mg/dL", required: true },
    { id: "bun", label: "BUN (Urea nitrogen)", type: "number", unit: "mg/dL", required: true },
    { id: "measured", label: "Measured Osmolality", type: "number", unit: "mOsm/kg", required: true },
  ],
  calculate(v) {
    const calculated = 2 * n(v.na) + n(v.glucose) / 18 + n(v.bun) / 2.8;
    const gap = n(v.measured) - calculated;
    const r = Math.round(gap);
    const interp = gap > 10 ? "Elevated (> 10) — Consider toxic alcohols, mannitol, or severe renal failure" : "Normal (≤ 10)";
    return { score: `${r} mOsm/kg`, interpretation: interp, noteText: `Osmol Gap: ${r} mOsm/kg — ${interp}` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SURGERY
// ═══════════════════════════════════════════════════════════════════════════════

const asaClass: Calculator = {
  id: "asa_class",
  name: "ASA Physical Status",
  category: "Surgery",
  description: "Pre-operative risk classification",
  inputs: [
    { id: "class", label: "ASA Class", type: "select", options: [
      { value: "1", label: "ASA I — Healthy patient" },
      { value: "2", label: "ASA II — Mild systemic disease" },
      { value: "3", label: "ASA III — Severe systemic disease" },
      { value: "4", label: "ASA IV — Life-threatening disease" },
      { value: "5", label: "ASA V — Not expected to survive without surgery" },
      { value: "6", label: "ASA VI — Brain-dead organ donor" },
      { value: "E", label: "E — Emergency (add E suffix)" },
    ] },
  ],
  calculate(v) {
    const interps: Record<string, string> = {
      "1": "No special precautions", "2": "Mild disease, well-controlled",
      "3": "Significant functional limitation", "4": "Constant threat to life",
      "5": "Moribund — surgery as last resort", "6": "Organ donor",
      "E": "Emergency surgery — add E to class",
    };
    // KNOWN-BUG-104, same shape as GCS: `interpretation` fell back to "—" but noteText did
    // not, so an unselected class wrote "ASA Class: undefined — undefined" into the note.
    if (!v.class) return MISSING_INPUT_RESULT("an ASA class");
    const interp = interps[v.class] || "—";
    return { score: `ASA ${v.class}`, interpretation: interp, noteText: `ASA Class: ${v.class} — ${interp}` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// OB-GYN
// ═══════════════════════════════════════════════════════════════════════════════

const bishopScore: Calculator = {
  id: "bishop_score",
  name: "Bishop Score (Cervical Ripeness)",
  category: "OB/GYN",
  description: "Predicts success of labour induction",
  inputs: [
    { id: "dilation", label: "Cervical Dilation", type: "select", options: [{ value: "0", label: "0 cm (0)" }, { value: "1", label: "1–2 cm (+1)" }, { value: "2", label: "3–4 cm (+2)" }, { value: "3", label: "5+ cm (+3)" }] },
    { id: "effacement", label: "Effacement", type: "select", options: [{ value: "0", label: "0–30% (0)" }, { value: "1", label: "40–50% (+1)" }, { value: "2", label: "60–70% (+2)" }, { value: "3", label: "80%+ (+3)" }] },
    { id: "station", label: "Fetal Station", type: "select", options: [{ value: "0", label: "-3 (0)" }, { value: "1", label: "-2 (+1)" }, { value: "2", label: "-1/0 (+2)" }, { value: "3", label: "+1/+2 (+3)" }] },
    { id: "consistency", label: "Cervical Consistency", type: "select", options: [{ value: "0", label: "Firm (0)" }, { value: "1", label: "Medium (+1)" }, { value: "2", label: "Soft (+2)" }] },
    { id: "position", label: "Cervical Position", type: "select", options: [{ value: "0", label: "Posterior (0)" }, { value: "1", label: "Mid (+1)" }, { value: "2", label: "Anterior (+2)" }] },
  ],
  calculate(v) {
    const score = ["dilation","effacement","station","consistency","position"].reduce((s, k) => s + i(v[k] || "0"), 0);
    const interp = score >= 8 ? "Favourable — induction likely successful" : score >= 6 ? "Borderline — induction may be attempted" : "Unfavourable — consider cervical ripening first";
    return { score: `${score} / 13`, interpretation: interp, noteText: `Bishop Score: ${score}/13 — ${interp}` };
  },
};

const gestationalAge: Calculator = {
  id: "gestational_age",
  name: "Gestational Age (by LMP)",
  category: "OB/GYN",
  description: "EDD and gestational age from Last Menstrual Period",
  inputs: [
    { id: "lmp", label: "First Day of LMP", type: "number", unit: "days ago" },
  ],
  calculate(v) {
    const daysAgo = i(v.lmp);
    const weeks = Math.floor(daysAgo / 7);
    const days = daysAgo % 7;
    const eddDays = 280 - daysAgo;
    // KNOWN-BUG-105. Past 280 days eddDays goes negative and Math.floor rounds AWAY from
    // zero, so 41w+3d rendered "EDD in -2 weeks". Post-dates is the cohort under the most
    // active surveillance, and "overdue by N days" is what its management turns on.
    const overdue = eddDays < 0;
    const eddWeeks = Math.floor(Math.abs(eddDays) / 7);
    const eddText = overdue
      ? `EDD passed ${Math.abs(eddDays)} day${Math.abs(eddDays) === 1 ? "" : "s"} ago — post-dates`
      : `EDD in ${eddWeeks} week${eddWeeks === 1 ? "" : "s"}`;
    const interp = `GA: ${weeks}w ${days}d | ${eddText}`;
    return { score: `${weeks}w + ${days}d`, interpretation: interp, noteText: `Gestational age: ${weeks} weeks ${days} days (${eddText})` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PAEDIATRIC
// ═══════════════════════════════════════════════════════════════════════════════

const pews: Calculator = {
  id: "pews",
  name: "PEWS (Paediatric Early Warning Score)",
  category: "Paediatric",
  description: "Deterioration risk in hospitalised children",
  inputs: [
    { id: "behaviour", label: "Behaviour", type: "select", options: [{ value: "0", label: "Playing / Appropriate (0)" }, { value: "1", label: "Sleeping (1)" }, { value: "2", label: "Irritable (2)" }, { value: "3", label: "Lethargic / Reduced response (3)" }] },
    { id: "cvs", label: "Cardiovascular", type: "select", options: [{ value: "0", label: "Pink, CRT 1–2s (0)" }, { value: "1", label: "Pale, CRT 3s (1)" }, { value: "2", label: "Grey, CRT 4s (2)" }, { value: "3", label: "Grey/mottled, CRT ≥ 5s or tachycardia (3)" }] },
    { id: "resp", label: "Respiratory", type: "select", options: [{ value: "0", label: "Normal (0)" }, { value: "1", label: "> 10 above normal, mild retractions (1)" }, { value: "2", label: "> 20 above normal, moderate retractions (2)" }, { value: "3", label: "5 below normal, severe retractions or oxygen (3)" }] },
  ],
  calculate(v) {
    const score = ["behaviour","cvs","resp"].reduce((s, k) => s + i(v[k] || "0"), 0);
    const interp = score <= 1 ? "Low risk" : score <= 3 ? "Moderate risk — increase monitoring" : "High risk (≥ 4) — immediate medical review";
    return { score: `${score} / 9`, interpretation: interp, noteText: `PEWS: ${score}/9 — ${interp}` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ICU-SPECIFIC (used by Gap 6 ICU Workspace)
// ═══════════════════════════════════════════════════════════════════════════════

export const sofa: Calculator = {
  id: "sofa",
  name: "SOFA Score",
  category: "ICU",
  description: "Sequential Organ Failure Assessment — ICU mortality prediction",
  inputs: [
    { id: "pf_ratio", label: "PaO₂/FiO₂ Ratio", type: "select", options: [{ value: "0", label: "≥ 400 (0)" }, { value: "1", label: "300–399 (+1)" }, { value: "2", label: "200–299 (+2)" }, { value: "3", label: "100–199 with resp support (+3)" }, { value: "4", label: "< 100 with resp support (+4)" }] },
    { id: "platelets", label: "Platelets", type: "select", options: [{ value: "0", label: "≥ 150 ×10³/µL (0)" }, { value: "1", label: "100–149 (+1)" }, { value: "2", label: "50–99 (+2)" }, { value: "3", label: "20–49 (+3)" }, { value: "4", label: "< 20 (+4)" }] },
    { id: "bilirubin", label: "Bilirubin", type: "select", options: [{ value: "0", label: "< 1.2 mg/dL (0)" }, { value: "1", label: "1.2–1.9 (+1)" }, { value: "2", label: "2.0–5.9 (+2)" }, { value: "3", label: "6.0–11.9 (+3)" }, { value: "4", label: "≥ 12.0 (+4)" }] },
    { id: "map", label: "Cardiovascular (MAP / vasopressors)", type: "select", options: [{ value: "0", label: "MAP ≥ 70 mmHg (0)" }, { value: "1", label: "MAP < 70 mmHg (+1)" }, { value: "2", label: "Dopamine ≤ 5 or Dobutamine (+2)" }, { value: "3", label: "Dopamine 5.1–15 or Epi/NE ≤ 0.1 (+3)" }, { value: "4", label: "Dopamine > 15 or Epi/NE > 0.1 (+4)" }] },
    { id: "gcs_sofa", label: "GCS Score", type: "select", options: [{ value: "0", label: "15 (0)" }, { value: "1", label: "13–14 (+1)" }, { value: "2", label: "10–12 (+2)" }, { value: "3", label: "6–9 (+3)" }, { value: "4", label: "< 6 (+4)" }] },
    { id: "creatinine", label: "Creatinine / Urine Output", type: "select", options: [{ value: "0", label: "< 1.2 mg/dL (0)" }, { value: "1", label: "1.2–1.9 (+1)" }, { value: "2", label: "2.0–3.4 (+2)" }, { value: "3", label: "3.5–4.9 or UO < 500 mL/d (+3)" }, { value: "4", label: "≥ 5.0 or UO < 200 mL/d (+4)" }] },
  ],
  calculate(v) {
    const score = ["pf_ratio","platelets","bilirubin","map","gcs_sofa","creatinine"].reduce((s, k) => s + i(v[k] || "0"), 0);
    const mortality = score <= 1 ? "< 1%" : score <= 3 ? "< 1%" : score <= 5 ? "< 1%" : score <= 7 ? "< 5%" : score <= 9 ? "< 15%" : score <= 11 ? "< 50%" : "> 50%";
    const interp = `Predicted ICU mortality: ${mortality}`;
    return { score: `${score} / 24`, interpretation: interp, noteText: `SOFA Score: ${score}/24 — ${interp}` };
  },
  reference: "Vincent JL et al. Intensive Care Med 1996",
};

export const apacheII: Calculator = {
  id: "apache_ii",
  name: "APACHE II",
  category: "ICU",
  description: "Acute Physiology and Chronic Health Evaluation II",
  inputs: [
    { id: "temp", label: "Temperature (°C)", type: "select", options: [{ value: "4", label: "≥ 41 or ≤ 29.9 (4)" }, { value: "3", label: "39–40.9 or 30–31.9 (3)" }, { value: "2", label: "38.5–38.9 or 32–33.9 (2)" }, { value: "1", label: "36–38.4 or 34–35.9 (1)" }, { value: "0", label: "36–38.4 (0)" }] },
    { id: "map_a", label: "Mean Arterial Pressure (mmHg)", type: "select", options: [{ value: "4", label: "≥ 160 or ≤ 49 (4)" }, { value: "3", label: "130–159 (3)" }, { value: "2", label: "110–129 or 50–69 (2)" }, { value: "0", label: "70–109 (0)" }] },
    { id: "hr_a", label: "Heart Rate (/min)", type: "select", options: [{ value: "4", label: "≥ 180 or ≤ 39 (4)" }, { value: "3", label: "140–179 or 40–54 (3)" }, { value: "2", label: "110–139 or 55–69 (2)" }, { value: "0", label: "70–109 (0)" }] },
    { id: "rr_a", label: "Respiratory Rate (/min)", type: "select", options: [{ value: "4", label: "≥ 50 or ≤ 5 (4)" }, { value: "3", label: "35–49 (3)" }, { value: "2", label: "25–34 or 6–9 (2)" }, { value: "1", label: "10–11 (1)" }, { value: "0", label: "12–24 (0)" }] },
    { id: "gcs_a", label: "GCS Score", type: "number", unit: "3–15", min: 3, max: 15 },
    { id: "age", label: "Age (years)", type: "number", required: true },
    { id: "chronic", label: "Chronic health (severe organ insufficiency)", type: "select", options: [{ value: "0", label: "None (0)" }, { value: "2", label: "Elective surgery (+2)" }, { value: "5", label: "Emergency/non-op (+5)" }] },
  ],
  calculate(v) {
    const aps = ["temp","map_a","hr_a","rr_a"].reduce((s, k) => s + i(v[k] || "0"), 0);
    const gcs_pts = 15 - i(v.gcs_a || "15");
    const age = i(v.age);
    const age_pts = age < 45 ? 0 : age < 55 ? 2 : age < 65 ? 3 : age < 75 ? 5 : 6;
    const chronic = i(v.chronic || "0");
    const score = aps + gcs_pts + age_pts + chronic;
    const mortality = score <= 4 ? "~4%" : score <= 9 ? "~8%" : score <= 14 ? "~15%" : score <= 19 ? "~25%" : score <= 24 ? "~40%" : score <= 29 ? "~55%" : score <= 34 ? "~73%" : "~85%";
    return { score: `${score}`, interpretation: `Predicted hospital mortality: ${mortality}`, noteText: `APACHE II: ${score} — Predicted mortality ${mortality}` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

export const CALCULATORS: Calculator[] = [
  // Renal
  ckdEpi, cockcroft, fena, anionGap,
  // Cardiology
  chadsVasc, hasBled,
  // Pulmonology
  wells_dvt, curb65, pao2fio2, aaGradient,
  // Neurology
  gcs, huntHess,
  // General
  bmi, correctedCalcium, osmolGap,
  // Surgery
  asaClass,
  // OB/GYN
  bishopScore, gestationalAge,
  // Paediatric
  pews,
  // ICU
  sofa, apacheII,
];

export const CALCULATOR_CATEGORIES = ["All", "Renal", "Cardiology", "Pulmonology", "Neurology", "ICU", "General", "Surgery", "OB/GYN", "Paediatric"];
