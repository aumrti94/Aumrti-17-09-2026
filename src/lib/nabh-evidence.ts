import { supabase } from "@/integrations/supabase/client";
import { callAI } from "./aiProvider";

export type ComplianceStatus = "compliant" | "partial" | "non_compliant";

/**
 * Auto-log NABH evidence for a given criterion.
 * Updates the nabh_criteria row matching hospitalId + criterionNumber.
 */
export const logNABHEvidence = async (
  hospitalId: string,
  criterionNumber: string,
  evidenceText: string,
  complianceStatus: ComplianceStatus = "compliant"
) => {
  try {
    await supabase
      .from("nabh_criteria")
      .update({
        evidence_notes: evidenceText,
        last_assessed: new Date().toISOString().split("T")[0],
        compliance_status: complianceStatus,
        auto_collected: true,
      })
      .eq("hospital_id", hospitalId)
      .eq("criterion_number", criterionNumber);
  } catch (e) {
    console.error("NABH evidence logging failed:", e);
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

status must be one of: compliant, partial, non_compliant`;

    const response = await callAI({
      featureKey: "nabh_criteria_mapper",
      hospitalId,
      prompt,
      outputFormat: "json",
    });

    if (response.error || !response.text) return null;
    const match = response.text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      criterion: parsed.criterion || "",
      status: (parsed.status as ComplianceStatus) || "compliant",
      rationale: parsed.rationale || "",
    };
  } catch {
    return null;
  }
};
