// @ts-nocheck
// Deterministic clinical safety checks over an AI-extracted note.
//
// WHY THIS MODULE EXISTS
// This logic used to live ONLY inside the `ai-safety-guard` edge function, so every caller
// reached it through an HTTP round trip out to the Supabase functions gateway and back —
// including a possible second isolate cold start. `ai-clinical-voice` awaited that call
// AFTER the LLM had already finished, purely to attach display flags, adding 0.2-5 s to the
// spinner the doctor is watching.
//
// There is nothing remote about the work: it is string matching against three `const` tables
// and one optional audit insert. Extracting it here lets callers run it in-process in
// microseconds. `ai-safety-guard/index.ts` stays as a thin HTTP wrapper over this module so
// its existing callers are untouched.
//
// This file is PURE — no network, no DB, no Deno globals — so the audit insert stays the
// caller's responsibility and can be fire-and-forget.

// H/X schedule drugs in India requiring DEA-equivalent verification
export const CONTROLLED_DRUGS = [
  "morphine", "fentanyl", "tramadol", "codeine", "oxycodone", "buprenorphine",
  "methadone", "pethidine", "meperidine", "hydrocodone",
  "alprazolam", "clonazepam", "diazepam", "lorazepam", "midazolam", "nitrazepam",
  "zolpidem", "zopiclone",
  "phenobarbitone", "phenobarbital",
  "methylphenidate", "amphetamine",
];

// Common allergy cross-reactive pairs
export const CROSS_REACTIVE: Record<string, string[]> = {
  "penicillin": ["amoxicillin", "ampicillin", "piperacillin", "cephalexin", "ceftriaxone"],
  "sulfa": ["sulfamethoxazole", "trimethoprim-sulfamethoxazole", "co-trimoxazole"],
  "aspirin": ["ibuprofen", "naproxen", "diclofenac", "ketorolac"],
  "codeine": ["tramadol", "morphine", "oxycodone"],
};

// Safe dose ranges for common drugs (dose per administration, mg)
export const DOSE_LIMITS: Record<string, { max: number; unit: string }> = {
  "paracetamol": { max: 1000, unit: "mg" },
  "acetaminophen": { max: 1000, unit: "mg" },
  "ibuprofen": { max: 800, unit: "mg" },
  "metformin": { max: 1000, unit: "mg" },
  "aspirin": { max: 300, unit: "mg" },
  "amoxicillin": { max: 1000, unit: "mg" },
  "diclofenac": { max: 75, unit: "mg" },
  "prednisolone": { max: 60, unit: "mg" },
  "dexamethasone": { max: 8, unit: "mg" },
};

export type SafetySeverity = "critical" | "warning" | "info";

export interface SafetyFlag {
  severity: SafetySeverity;
  field: string;
  message: string;
}

export interface SafetyResult {
  /** False when any flag is `critical`. */
  safe: boolean;
  flags: SafetyFlag[];
  checked_at: string;
}

export interface SafetyPatientContext {
  age?: number | null;
  known_allergies?: string[];
  current_medications?: string[];
}

/**
 * Persist raised flags for audit.
 *
 * Lives here rather than in the edge function so in-process callers can import it WITHOUT
 * pulling in that module's top-level `serve()`, which would start a second HTTP listener
 * inside the importing isolate. Callers should invoke it fire-and-forget — an audit write
 * must never delay a clinician's result.
 */
export async function logSafetyFlags(
  sb: { from: (t: string) => any },
  args: { hospitalId: string | null; patientId?: string | null; featureKey: string; flags: SafetyFlag[] },
): Promise<void> {
  if (!args.flags.length || !args.hospitalId) return;
  try {
    await sb.from("ai_safety_flags").insert({
      hospital_id: args.hospitalId,
      patient_id: args.patientId || null,
      feature_key: args.featureKey,
      flags: args.flags,
    });
  } catch (err) {
    console.warn("ai_safety_flags insert failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

export function extractDoseNumber(doseStr: string): number | null {
  const match = (doseStr ?? "").match(/(\d+(?:\.\d+)?)\s*mg/i);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Evaluate an AI-extracted note for prescription and diagnosis safety problems.
 *
 * Pure and synchronous. Accepts the loose shapes the various callers emit
 * (`prescriptions` or `medications`; `drug` or `name`; `dose` or `dosage`).
 */
export function evaluateSafety(
  aiOutput: Record<string, unknown> | null | undefined,
  patientContext: SafetyPatientContext | null | undefined,
): SafetyResult {
  const flags: SafetyFlag[] = [];

  const prescriptions: any[] =
    (aiOutput as any)?.prescriptions || (aiOutput as any)?.medications || [];
  const patientAge: number | null = patientContext?.age ?? null;
  const patientAllergies: string[] = (patientContext?.known_allergies || [])
    .map((a: string) => (a ?? "").toLowerCase());
  const currentMeds: string[] = (patientContext?.current_medications || [])
    .map((m: string) => (m ?? "").toLowerCase());
  void currentMeds; // reserved: interaction checks live in check-drugbank-ddi

  for (const rx of prescriptions) {
    const drugName = (rx?.drug || rx?.name || "").toLowerCase();
    const dose = rx?.dose || rx?.dosage || "";
    if (!drugName) continue;

    // Allergy cross-reactivity
    for (const [allergen, crossReactives] of Object.entries(CROSS_REACTIVE)) {
      if (patientAllergies.some(a => a.includes(allergen))) {
        if (crossReactives.some(cr => drugName.includes(cr)) || drugName.includes(allergen)) {
          flags.push({
            severity: "critical",
            field: "prescriptions",
            message: `ALLERGY ALERT: Patient has ${allergen} allergy. ${rx.drug || rx.name} may be cross-reactive.`,
          });
        }
      }
    }

    // Controlled substance
    if (CONTROLLED_DRUGS.some(d => drugName.includes(d))) {
      flags.push({
        severity: "warning",
        field: "prescriptions",
        message: `SCHEDULE H/X: ${rx.drug || rx.name} is a controlled substance. Verify prescribing authority and document indication.`,
      });
    }

    // Dose limits
    for (const [drug, limit] of Object.entries(DOSE_LIMITS)) {
      if (drugName.includes(drug)) {
        const doseNum = extractDoseNumber(dose);
        if (doseNum && doseNum > limit.max) {
          flags.push({
            severity: "critical",
            field: "prescriptions",
            message: `OVERDOSE RISK: ${rx.drug || rx.name} ${dose} exceeds safe maximum (${limit.max}${limit.unit} per dose).`,
          });
        }
      }
    }

    // Pediatric safety: flag adult doses for children < 12
    if (patientAge && patientAge < 12) {
      const doseNum = extractDoseNumber(dose);
      if (doseNum && doseNum > 250) {
        flags.push({
          severity: "warning",
          field: "prescriptions",
          message: `PEDIATRIC: Patient is ${patientAge} years old. Verify ${rx.drug || rx.name} ${dose} is age-appropriate (weight-based dosing recommended).`,
        });
      }
    }
  }

  // Diagnosis plausibility
  const diagnosis = (aiOutput as any)?.diagnosis || (aiOutput as any)?.final_diagnosis || "";
  if (diagnosis && patientAge) {
    const d = String(diagnosis).toLowerCase();
    if (patientAge < 15 && (d.includes("prostate") || d.includes("ovarian") || d.includes("menopause"))) {
      flags.push({
        severity: "warning",
        field: "diagnosis",
        message: `AGE-DIAGNOSIS MISMATCH: "${diagnosis}" is uncommon in patients aged ${patientAge}. Please verify.`,
      });
    }
  }

  // Missing critical investigations
  const investigations =
    (aiOutput as any)?.investigations || (aiOutput as any)?.recommended_investigations || [];
  if (String(diagnosis).toLowerCase().includes("diabetes") &&
      !investigations.some((i: string) => (i ?? "").toLowerCase().includes("hba1c"))) {
    flags.push({
      severity: "info",
      field: "investigations",
      message: "Consider adding HbA1c to investigations for diabetes management.",
    });
  }

  return {
    safe: !flags.some(f => f.severity === "critical"),
    flags,
    checked_at: new Date().toISOString(),
  };
}
