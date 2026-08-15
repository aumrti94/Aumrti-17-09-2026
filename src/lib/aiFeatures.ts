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
  { key: "voice_scribe_rescue", label: "Voice Scribe Audio Rescue", description: "Re-hears only low-confidence dictation segments with a multimodal model to recover mangled medical terms" },
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
  // Insurance / revenue cycle
  { key: "pre_auth_cover_letter", label: "Pre-Auth Cover Letter", description: "AI-drafted pre-authorisation cover letters" },
  { key: "claim_cover_letter", label: "Claim Cover Letter", description: "AI-drafted insurance claim cover letters" },
  { key: "irdai_complaint", label: "IRDAI Complaint Drafter", description: "AI-drafted IRDAI escalation complaints" },
  { key: "rate_dispute_letter", label: "Rate Dispute Letter", description: "AI-drafted payer rate-dispute letters" },
  { key: "denial_analytics", label: "Denial Analytics", description: "AI narratives on claim-denial analytics" },
  { key: "coding_accuracy_auditor", label: "Coding Accuracy Auditor", description: "AI audit of MRD/ICD coding accuracy" },
  // Lab / pathology
  { key: "lab_report_narrative", label: "Lab Report Narrative", description: "AI narrative summaries of lab reports" },
  { key: "pathology_impression_draft", label: "Pathology Impression Draft", description: "AI-drafted pathology impressions" },
  { key: "lab_reflex_tests", label: "Lab Reflex Test Suggester", description: "AI reflex-test recommendations" },
  { key: "lab_ast_phenotype", label: "Lab AST Phenotype", description: "AI antibiotic-susceptibility phenotype detection" },
  { key: "lab_auto_interpreter", label: "Lab Auto-Interpreter", description: "AI auto-interpretation of lab panels" },
  { key: "lab_sample_mixup", label: "Lab Sample Mix-up Detector", description: "AI detection of likely sample mix-ups" },
  // Clinical
  { key: "differential_diagnosis", label: "Differential Diagnosis", description: "AI differential-diagnosis suggestions" },
  { key: "clarifying_questions", label: "AI Clarifying Questions", description: "High-yield DDx-discriminating questions for OPD history-taking" },
  // Old-records ingestion. Two keys, because they fail and cost differently: page
  // extraction is per-page and dominates the bill, the digest runs once per bag.
  // Withholding extraction withholds the whole feature; withholding only the digest
  // leaves the doctor the verbatim transcriptions, which is still useful.
  // The tier rows (history_document_extract_fast / _accurate) are model routing in
  // platform_ai_provider_config and are deliberately NOT listed here — an admin
  // toggling this off must not need to know they exist.
  { key: "history_document_extract", label: "Old Records — Page Extraction", description: "Reads patient-supplied outside records (prescriptions, discharge summaries, reports) page by page" },
  { key: "history_digest", label: "Old Records — History Timeline", description: "Merges extracted outside records into one date-ordered patient history" },
  { key: "generate_clinical_note", label: "Clinical Note Generator", description: "AI-generated clinical notes" },
  { key: "adr_detector", label: "ADR Detector", description: "AI adverse-drug-reaction detection" },
  { key: "discharge_summary_structured", label: "Discharge Summary (Structured)", description: "AI structured discharge-summary drafting" },
  { key: "critical_incidental_finder", label: "Critical Incidental Finder", description: "AI detection of critical incidental radiology findings" },
  { key: "radiology_tat_predictor", label: "Radiology TAT Predictor", description: "AI radiology turnaround-time prediction" },
  // Emergency
  { key: "ed_boarding_predictor", label: "ED Boarding Predictor", description: "AI ED boarding / crowding prediction" },
  { key: "ed_discharge_summary", label: "ED Discharge Summary", description: "AI ED discharge-summary drafting" },
  // OT / nursing / HR
  { key: "ot_cancellation_predictor", label: "OT Cancellation Predictor", description: "AI OT-cancellation risk prediction" },
  { key: "nurse_workload_optimizer", label: "Nurse Workload Optimizer", description: "AI nurse workload balancing" },
  { key: "roster_optimizer", label: "Roster Optimizer", description: "AI staff roster optimisation" },
  // Inventory / blood bank
  { key: "inventory_itc_classify", label: "Inventory ITC Classifier", description: "AI GST ITC classification of inventory" },
  { key: "inventory_anomaly_digest", label: "Inventory Anomaly Digest", description: "AI inventory anomaly/leakage digest" },
  { key: "blood_demand_forecaster", label: "Blood Demand Forecaster", description: "AI blood-bank demand forecasting" },
  // Patient-facing
  { key: "patient_chatbot", label: "Patient Chatbot", description: "AI patient portal chatbot" },
  { key: "phr_health_story", label: "PHR Health Story", description: "AI patient health-story narratives" },
  { key: "health_coach_bot", label: "Health Coach Bot", description: "AI patient health-coach assistant" },
  { key: "translation", label: "Patient Content Translation", description: "AI translation of patient content" },
  { key: "patient_context_summary", label: "Patient Context Summary", description: "AI patient-context summarisation" },
  // Messaging
  { key: "whatsapp_bot_intent", label: "WhatsApp Bot (Intent)", description: "AI intent handling for the WhatsApp bot" },
];

export const AI_FEATURE_KEYS: string[] = AI_FEATURE_DEFS.map((f) => f.key);

// ── Safety-class AI features ────────────────────────────────────────────────
// Clinical-safety AI whose job is to catch harm: drug interactions / ADR,
// physiological deterioration (early warning) and critical incidental findings.
// These are NEVER counted against the AI budget and NEVER gated on wallet
// balance — a cost cap that could throttle them would be a patient-safety
// mechanism wearing a billing costume (see src/lib/aiBudget.ts).
//
// THIS LIST IS MIRRORED in the `hospital_ai_budget_status` view (migration
// 20261009000175) and in the AI wallet draw-down guard. Change all together.
export const SAFETY_AI_FEATURE_KEYS: string[] = [
  "drug_interaction_analysis",
  "adr_detector",
  "sepsis_early_warning",
  "critical_incidental_finder",
];

export const isSafetyAiFeature = (featureKey: string): boolean =>
  SAFETY_AI_FEATURE_KEYS.includes(featureKey);
