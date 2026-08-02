import { supabase } from "@/integrations/supabase/client";
import { callAI } from "./aiProvider";

/**
 * The DB trigger validate_nabh_compliance_status accepts exactly these values.
 * "partial" was previously in this union but is rejected by the trigger, so every
 * such write raised and was swallowed by the catch below.
 */
export type ComplianceStatus = "compliant" | "partially_compliant" | "non_compliant";

/** Legacy callers (and the AI) may still say "partial". */
const normaliseStatus = (status: string): ComplianceStatus => {
  if (status === "partial" || status === "partially_compliant") return "partially_compliant";
  if (status === "non_compliant") return "non_compliant";
  return "compliant";
};

export interface LogEvidenceResult {
  ok: boolean;
  error?: string;
}

/**
 * Append a NABH evidence record for a criterion.
 *
 * Writes to nabh_evidence_log, an append-only audit trail. It used to UPDATE
 * nabh_criteria by (hospital_id, criterion_number) — a table that was never
 * seeded, so all ~50 call sites across the app silently updated zero rows.
 * Criterion *scores* are now owned by the indicator engine
 * (public.run_nabh_auto_collection); this function records the evidence that a
 * module event happened, which is what an accreditation audit trail needs.
 *
 * Returns a result rather than throwing: callers are module side-effects
 * (lab verification, OT close, CSSD, consent…) that must never fail because
 * accreditation logging failed.
 */
export const logNABHEvidence = async (
  hospitalId: string,
  criterionNumber: string,
  evidenceText: string,
  complianceStatus: ComplianceStatus | "partial" = "compliant",
): Promise<LogEvidenceResult> => {
  if (!hospitalId || !criterionNumber) {
    return { ok: false, error: "hospitalId and criterionNumber are required" };
  }
  try {
    const { error } = await (supabase as any).from("nabh_evidence_log").insert({
      hospital_id: hospitalId,
      criterion_number: criterionNumber,
      description: evidenceText,
      compliance_status: normaliseStatus(complianceStatus),
      source: "module_event",
    });
    if (error) {
      console.error("NABH evidence logging failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    console.error("NABH evidence logging failed:", e);
    return { ok: false, error: e?.message ?? String(e) };
  }
};

/**
 * Use AI to map free-text incident/evidence to a NABH criterion code + suggested status.
 * Returns null if AI is unavailable.
 */
export const mapTextToNABHCriterion = async (
  incidentText: string,
  hospitalId: string
): Promise<{ criterion: string; status: ComplianceStatus; rationale: string } | null> => {
  try {
    const prompt = `You are a NABH (National Accreditation Board for Hospitals) compliance expert.
Map the following hospital incident or evidence text to the most relevant NABH criterion code.

Incident/Evidence: "${incidentText}"

Common NABH criterion codes: AAC (Access, Assessment, Care), COP (Care of Patients),
MOM (Management of Medications), SIC (Surgical & Invasive Care), ICU, HIC (Hospital Infection Control),
CQI (Continuous Quality Improvement), HRM (Human Resource Management), FMS (Facility Management),
ROM (Responsibilities of Management), PRE (Pre-operative Assessment), DIC (Discharge).

Respond ONLY with valid JSON in this exact format:
{"criterion": "COP.2", "status": "compliant", "rationale": "Brief explanation"}

status must be one of: compliant, partially_compliant, non_compliant`;

    const response = await callAI({
      featureKey: "nabh_criteria_mapper",
      hospitalId,
      prompt,
      // AIRequest has no outputFormat field, so passing one was a no-op. The
      // prompt itself demands JSON and the response is regex-extracted below.
    });

    if (response.error || !response.text) return null;
    const match = response.text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      criterion: parsed.criterion || "",
      status: normaliseStatus(String(parsed.status ?? "compliant")),
      rationale: parsed.rationale || "",
    };
  } catch {
    return null;
  }
};
