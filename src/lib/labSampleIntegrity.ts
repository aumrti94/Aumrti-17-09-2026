// Wrong-blood-in-tube / sample mix-up detection.
// Lab AI features, Phase 13.
//
// Split by design, same principle as Phase 12's auto-verification: a decision that
// GATES release must be deterministic and explainable (checkDeterministicMixupIndicators
// below) — a mislabelled/swapped specimen is a sentinel event, and blocking release on
// it must be reproducible for audit. The optional AI layer (runAiMixupAssessment) adds
// holistic pattern synthesis across the whole panel + history, but its output is
// ADVISORY ONLY and never blocks release, exactly like the anomaly detector.
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";

export interface MixupIndicator {
  rule: string;
  severity: "high" | "moderate";
  message: string;
}

export interface MixupCheckItem {
  test_name: string;
  result_value: string | null;
  result_numeric: number | null;
}

const FEMALE_SPECIFIC_TEST = /beta.?hcg|\bhcg\b|pregnancy test|pap smear/i;
const MALE_SPECIFIC_TEST = /\bpsa\b|prostate specific antigen/i;
const HB_TEST = /ha?emoglobin|\bhb\b/i;
const HCT_TEST = /ha?ematocrit|\bhct\b|\bpcv\b/i;
const BLOOD_GROUP_TEST = /blood group/i;

function isPositiveResult(value: string | null): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (["negative", "not detected", "nil", "0", "n"].includes(v)) return false;
  return true;
}

function normalizeBloodGroup(v: string | null): string | null {
  if (!v) return null;
  return v.replace(/\s+/g, "").toUpperCase();
}

/**
 * Deterministic, explainable checks — the only ones allowed to gate release. Each rule
 * maps to a concrete, reproducible condition; nothing here depends on an LLM call.
 */
export function checkDeterministicMixupIndicators(input: {
  patientGender: string | null;
  patientRecordedBloodGroup: string | null;
  items: MixupCheckItem[];
}): MixupIndicator[] {
  const indicators: MixupIndicator[] = [];
  const gender = (input.patientGender || "").toLowerCase();

  // Sex-specific test violations
  for (const item of input.items) {
    if (gender === "male" && FEMALE_SPECIFIC_TEST.test(item.test_name) && isPositiveResult(item.result_value)) {
      indicators.push({
        rule: "sex_specific_test",
        severity: "high",
        message: `${item.test_name} = ${item.result_value} on a male patient — this is a female-specific test`,
      });
    }
    if (gender === "female" && MALE_SPECIFIC_TEST.test(item.test_name) && isPositiveResult(item.result_value)) {
      indicators.push({
        rule: "sex_specific_test",
        severity: "high",
        message: `${item.test_name} = ${item.result_value} on a female patient — this is a male-specific test`,
      });
    }
  }

  // Blood group conflict against the patient's recorded blood group
  const recordedBg = normalizeBloodGroup(input.patientRecordedBloodGroup);
  if (recordedBg) {
    const bgItem = input.items.find(i => BLOOD_GROUP_TEST.test(i.test_name) && i.result_value);
    if (bgItem) {
      const resultBg = normalizeBloodGroup(bgItem.result_value);
      if (resultBg && resultBg !== recordedBg) {
        indicators.push({
          rule: "blood_group_conflict",
          severity: "high",
          message: `Blood group result (${bgItem.result_value}) conflicts with the patient's recorded blood group (${input.patientRecordedBloodGroup})`,
        });
      }
    }
  }

  // Hb/Hct "rule of three": Hct (%) ≈ Hb (g/dL) × 3, ±25%
  const hb = input.items.find(i => HB_TEST.test(i.test_name) && i.result_numeric != null);
  const hct = input.items.find(i => HCT_TEST.test(i.test_name) && i.result_numeric != null);
  if (hb?.result_numeric != null && hct?.result_numeric != null && hb.result_numeric > 0) {
    const expectedHct = hb.result_numeric * 3;
    const deviation = Math.abs(hct.result_numeric - expectedHct) / expectedHct;
    if (deviation > 0.25) {
      indicators.push({
        rule: "hb_hct_ratio",
        severity: "moderate",
        message: `Hb ${hb.result_numeric} g/dL vs Hct ${hct.result_numeric}% deviates from the expected ~3:1 ratio by ${Math.round(deviation * 100)}% — check for sample dilution or a swapped specimen`,
      });
    }
  }

  return indicators;
}

export interface AiMixupAssessment {
  risk: "high" | "moderate" | "low";
  indicators: string[];
  recommendation: string;
}

/**
 * Optional AI holistic layer. Synthesizes the deterministic indicators plus the full
 * current panel and the patient's most recent prior panel to spot subtler, non-rule-
 * based inconsistencies. ADVISORY ONLY — callers must never use this to block release.
 */
export async function runAiMixupAssessment(opts: {
  hospitalId: string;
  patientId: string;
  orderId: string;
  deterministicIndicators: MixupIndicator[];
  currentItems: MixupCheckItem[];
}): Promise<AiMixupAssessment | null> {
  const { data: priorOrders } = await (supabase as any)
    .from("lab_orders")
    .select("id, order_date")
    .eq("patient_id", opts.patientId)
    .neq("id", opts.orderId)
    .in("status", ["completed"])
    .order("order_date", { ascending: false })
    .limit(1);

  let priorText = "No prior results available for comparison.";
  if (priorOrders?.length) {
    const { data: priorItems } = await (supabase as any)
      .from("lab_order_items")
      .select("result_value, lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name)")
      .eq("lab_order_id", priorOrders[0].id)
      .not("result_value", "is", null);
    if (priorItems?.length) {
      priorText = `Prior panel (${priorOrders[0].order_date}):\n` +
        priorItems.map((i: any) => `${i.lab_test_master?.test_name || "—"}: ${i.result_value}`).join("\n");
    }
  }

  const currentText = opts.currentItems
    .filter(i => i.result_value)
    .map(i => `${i.test_name}: ${i.result_value}`)
    .join("\n");

  const detText = opts.deterministicIndicators.length
    ? opts.deterministicIndicators.map(i => `[${i.severity.toUpperCase()}] ${i.message}`).join("\n")
    : "None";

  const response = await callAI({
    featureKey: "lab_sample_mixup",
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    prompt: `You are a laboratory patient-safety AI screening for wrong-blood-in-tube / specimen mix-up
(a mislabelled or swapped sample). This is ADVISORY ONLY — you do not release or block results.

Deterministic hard-mismatch checks already run:
${detText}

Current panel:
${currentText || "No results entered"}

${priorText}

Assess the likelihood this specimen belongs to a different patient than intended, based on internal
inconsistency (implausible combinations, values that contradict the patient's own recent trend beyond
what disease progression would explain, physiologically incompatible combinations).

Return ONLY JSON:
{"risk":"high|moderate|low","indicators":["short finding 1","short finding 2"],"recommendation":"one sentence, e.g. 'Recollect and repeat' or 'Consistent with patient history, likely valid'"}`,
    maxTokens: 300,
  });

  if (response.error || !response.text) return null;
  try {
    const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!parsed?.risk) return null;

    (supabase as any).from("ai_feature_logs").insert({
      hospital_id: opts.hospitalId,
      module: "lab",
      feature_key: "lab_sample_mixup",
      patient_id: opts.patientId,
      input_summary: `${opts.currentItems.filter(i => i.result_value).length} results, ${opts.deterministicIndicators.length} deterministic indicator(s)`,
      output_summary: `risk=${parsed.risk}`,
      success: true,
    }).then(() => {});

    return parsed as AiMixupAssessment;
  } catch {
    return null;
  }
}
