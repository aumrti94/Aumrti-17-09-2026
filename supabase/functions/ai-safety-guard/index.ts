import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// H/X schedule drugs in India requiring DEA-equivalent verification
const CONTROLLED_DRUGS = [
  "morphine", "fentanyl", "tramadol", "codeine", "oxycodone", "buprenorphine",
  "methadone", "pethidine", "meperidine", "hydrocodone",
  "alprazolam", "clonazepam", "diazepam", "lorazepam", "midazolam", "nitrazepam",
  "zolpidem", "zopiclone",
  "phenobarbitone", "phenobarbital",
  "methylphenidate", "amphetamine",
];

// Common allergy cross-reactive pairs
const CROSS_REACTIVE: Record<string, string[]> = {
  "penicillin": ["amoxicillin", "ampicillin", "piperacillin", "cephalexin", "ceftriaxone"],
  "sulfa": ["sulfamethoxazole", "trimethoprim-sulfamethoxazole", "co-trimoxazole"],
  "aspirin": ["ibuprofen", "naproxen", "diclofenac", "ketorolac"],
  "codeine": ["tramadol", "morphine", "oxycodone"],
};

// Safe dose ranges for common drugs (dose per administration, mg)
const DOSE_LIMITS: Record<string, { max: number; unit: string }> = {
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

function extractDoseNumber(doseStr: string): number | null {
  const match = doseStr.match(/(\d+(?:\.\d+)?)\s*mg/i);
  return match ? parseFloat(match[1]) : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { feature_key, ai_output, patient_context, hospital_id, patient_id } = await req.json();

    const flags: { severity: "critical" | "warning" | "info"; field: string; message: string }[] = [];

    // 1. Prescription safety checks
    const prescriptions: any[] = ai_output?.prescriptions || ai_output?.medications || [];
    const patientAge: number | null = patient_context?.age || null;
    const patientAllergies: string[] = (patient_context?.known_allergies || [])
      .map((a: string) => a.toLowerCase());
    const currentMeds: string[] = (patient_context?.current_medications || [])
      .map((m: string) => m.toLowerCase());

    for (const rx of prescriptions) {
      const drugName = (rx.drug || rx.name || "").toLowerCase();
      const dose = rx.dose || rx.dosage || "";

      if (!drugName) continue;

      // Check allergy cross-reactivity
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

      // Check controlled substance
      if (CONTROLLED_DRUGS.some(d => drugName.includes(d))) {
        flags.push({
          severity: "warning",
          field: "prescriptions",
          message: `SCHEDULE H/X: ${rx.drug || rx.name} is a controlled substance. Verify prescribing authority and document indication.`,
        });
      }

      // Check dose limits
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

    // 2. Diagnosis plausibility check
    const diagnosis = ai_output?.diagnosis || ai_output?.final_diagnosis || "";
    if (diagnosis && patientAge) {
      if (patientAge < 15 && (diagnosis.toLowerCase().includes("prostate") || diagnosis.toLowerCase().includes("ovarian") || diagnosis.toLowerCase().includes("menopause"))) {
        flags.push({
          severity: "warning",
          field: "diagnosis",
          message: `AGE-DIAGNOSIS MISMATCH: "${diagnosis}" is uncommon in patients aged ${patientAge}. Please verify.`,
        });
      }
    }

    // 3. Missing critical investigations
    const investigations = ai_output?.investigations || ai_output?.recommended_investigations || [];
    if (diagnosis.toLowerCase().includes("diabetes") && !investigations.some((i: string) => i.toLowerCase().includes("hba1c"))) {
      flags.push({ severity: "info", field: "investigations", message: "Consider adding HbA1c to investigations for diabetes management." });
    }

    // Log safety flags
    const safe = !flags.some(f => f.severity === "critical");
    if (flags.length > 0 && hospital_id) {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await sb.from("ai_safety_flags").insert({
        hospital_id,
        patient_id: patient_id || null,
        feature_key,
        flags,
      });
    }

    return new Response(JSON.stringify({ safe, flags, checked_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
