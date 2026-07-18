// Canonical catalog of gateable AI features. Each key is EXACTLY the `featureKey`
// that the matching callAI({ featureKey }) site passes (see FEATURE_LABELS in
// aiProvider.ts), so toggling one here withholds precisely that AI call.
//
// These are surfaced as the "actions" of the pseudo-module `ai_suite` in the
// entitlement system (MODULE_ACTIONS["ai_suite"]) — a single "AI Features" master
// toggle (module on/off) governs all of them, and each can be withheld individually
// from /platform Plans and Hospital → Modules.
//
// Kept free of any supabase import so it stays a pure module (used by tabPermissions.ts
// and its vitest tests). Platform-internal keys (global_default, plan_copywriter) are
// intentionally excluded — they are not hospital-facing AI features.

export interface AIFeatureDef {
  key: string;
  label: string;
  description: string;
}

export const AI_FEATURE_DEFS: AIFeatureDef[] = [
  { key: "voice_scribe", label: "Voice Scribe (SOAP)", description: "Voice-to-structured clinical notes (OPD/IPD/ED/nursing)" },
  { key: "radiology_impression", label: "Radiology AI Impression", description: "AI-suggested impressions for radiology reports" },
  { key: "ai_digest", label: "AI Executive Digest", description: "Daily KPI summaries & anomaly digest for management" },
  { key: "appeal_letter", label: "Appeal Letter Writer", description: "AI-drafted insurance denial appeal letters" },
  { key: "discharge_summary", label: "Discharge Summary", description: "AI-generated IPD discharge summaries" },
  { key: "icd_coding", label: "ICD-10 Code Suggester", description: "AI ICD-10 suggestions in diagnosis & MRD coding" },
  { key: "document_ocr", label: "Document OCR (Vision)", description: "AI vision/OCR extraction from uploaded documents" },
  { key: "discharge_instructions", label: "Discharge Instructions", description: "AI patient discharge instruction drafting" },
  { key: "voice_asr_engine", label: "Voice ASR Engine", description: "Speech-to-text engine behind voice features" },
  { key: "revenue_leakage", label: "Revenue Leakage Detector", description: "AI detection of missed/under-billed charges" },
  { key: "denial_predictor", label: "Denial Predictor", description: "AI claim-denial risk prediction" },
  { key: "ot_optimizer", label: "OT Schedule Optimizer", description: "AI operation-theatre scheduling optimisation" },
  { key: "no_show_predictor", label: "No-Show Predictor", description: "AI appointment no-show risk scoring" },
  { key: "sepsis_early_warning", label: "Sepsis Early Warning (NEWS2)", description: "AI sepsis/deterioration early warning" },
  { key: "triage_classifier", label: "AI Triage Classifier", description: "AI emergency triage level suggestion" },
  { key: "lab_anomaly", label: "Lab Anomaly Detector", description: "AI anomaly & trend detection on lab results" },
  { key: "vial_wastage", label: "Vial Wastage Optimizer", description: "AI chemo vial-sharing / wastage optimisation" },
  { key: "nabh_evidence", label: "NABH Auto-Evidence", description: "AI-generated NABH evidence & narratives" },
  { key: "financial_analysis", label: "Financial AI Analysis", description: "AI narratives on financial statements & reports" },
  { key: "prakriti_analysis", label: "Prakriti Analysis (AYUSH)", description: "AI Ayurvedic prakriti assessment" },
  { key: "pre_auth_summary", label: "Pre-Auth Summary Generator", description: "AI pre-authorisation summary drafting" },
  { key: "approval_predictor", label: "Pre-Auth Approval Predictor", description: "AI pre-auth approval likelihood" },
  { key: "meal_plan_ai", label: "Meal Plan Generator", description: "AI dietetics meal-plan generation" },
  { key: "bed_demand_forecaster", label: "Bed Demand Forecaster", description: "AI IPD bed-demand forecasting" },
  { key: "nabh_criteria_mapper", label: "NABH Criteria Mapper", description: "AI mapping of evidence to NABH criteria" },
  { key: "drug_interaction_analysis", label: "Drug Interaction AI", description: "AI drug-interaction / ADR analysis" },
  { key: "care_plan_goal", label: "Care Plan Goal Suggester", description: "AI nursing care-plan goal suggestions" },
  { key: "pre_auth_ai_fill", label: "Pre-Auth Auto-Fill", description: "AI auto-fill of pre-auth forms" },
  { key: "tpa_query_reply", label: "TPA Query Reply Suggester", description: "AI-suggested replies to TPA queries" },
  { key: "tpa_name_resolver", label: "TPA Name Auto-Resolver", description: "AI matching of free-text TPA/payer names" },
  { key: "readmission_predictor", label: "Readmission Risk Predictor", description: "AI 30-day readmission risk scoring" },
  { key: "ai_rca", label: "AI Root Cause Analysis", description: "AI root-cause analysis for safety events" },
  { key: "staff_burnout", label: "Staff Burnout Risk Monitor", description: "AI staff burnout-risk monitoring" },
  { key: "esg_recommendations", label: "ESG Carbon Recommendations", description: "AI ESG / carbon-reduction recommendations" },
];

export const AI_FEATURE_KEYS: string[] = AI_FEATURE_DEFS.map((f) => f.key);
