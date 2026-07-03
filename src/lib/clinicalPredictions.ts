/**
 * Clinical AI Prediction Utilities
 * Feature 1: No-Show Predictor
 * Feature 2: Sepsis Early Warning (NEWS2)
 * Feature 3: AI Triage Classifier
 */

import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { calculateNEWS2 as calculateNEWS2Canonical } from "@/lib/news2";

function parseAIJson(text: string): any | null {
  try {
    return JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    return null;
  }
}

// ── FEATURE 1: No-Show Predictor ──

export interface NoShowPrediction {
  risk_score: number;
  risk_level: string;
  risk_factors: string[];
  recommendation: string;
}

export const predictNoShow = async (
  token: { id: string; patient_id: string; doctor_id: string | null; created_at: string; hospital_id: string },
  patientName: string,
  doctorName: string | null
): Promise<NoShowPrediction | null> => {
  try {
    const { data: history } = await supabase
      .from("no_show_predictions")
      .select("outcome")
      .eq("patient_id", token.patient_id)
      .not("outcome", "is", null)
      .limit(10);

    const pastNoShows = history?.filter((h: any) => h.outcome === "no_show").length || 0;
    const totalPast = history?.length || 0;
    const noShowRate = totalPast > 0 ? pastNoShows / totalPast : 0;

    const appointmentHour = new Date(token.created_at).getHours();
    const isMonday = new Date(token.created_at).getDay() === 1;

    const response = await callAI({
      featureKey: "no_show_predictor",
      hospitalId: token.hospital_id,
      prompt: `Predict no-show risk for this OPD appointment.
    
    Patient data:
    - Past no-show rate: ${Math.round(noShowRate * 100)}%
    - Past no-shows: ${pastNoShows} of ${totalPast} appointments
    - Appointment time: ${appointmentHour}:00 hrs
    - Day of week: ${isMonday ? "Monday (high no-show day)" : "Normal day"}
    
    Return ONLY JSON:
    {
      "risk_score": 65,
      "risk_level": "high",
      "risk_factors": ["High historical no-show rate", "Monday appointment"],
      "recommendation": "Send WhatsApp reminder 2 hours before"
    }`,
      maxTokens: 150,
    });

    if (response.error) return null;
    const prediction = parseAIJson(response.text);
    if (!prediction) return null;

    await supabase.from("no_show_predictions").insert({
      hospital_id: token.hospital_id,
      patient_id: token.patient_id,
      token_id: token.id,
      risk_score: prediction.risk_score,
      risk_factors: prediction.risk_factors || [],
    } as any);

    return prediction;
  } catch {
    return null;
  }
};

// ── FEATURE 2: Sepsis Early Warning (NEWS2) ──

export interface SepsisResult {
  score: number;
  riskLevel: string;
  clinicalNote: {
    clinical_interpretation: string;
    urgent_actions: string[];
    escalate_immediately: boolean;
  } | null;
}

// Thin wrapper around the canonical NEWS2 formula (src/lib/news2.ts) — renames fields to this
// module's existing vocabulary (rr/on_oxygen/avpu) so its one caller (runSepsisCheck) is
// unaffected.
export const calculateNEWS2Score = (vitals: {
  rr?: number;
  spo2?: number;
  on_oxygen?: boolean;
  temperature?: number;
  bp_systolic?: number;
  pulse?: number;
  avpu?: string;
}): number => {
  return calculateNEWS2Canonical({
    respiratory_rate: vitals.rr,
    spo2: vitals.spo2,
    on_supplemental_o2: !!vitals.on_oxygen,
    systolic_bp: vitals.bp_systolic,
    heart_rate: vitals.pulse,
    consciousness: vitals.avpu,
    temperature: vitals.temperature,
  });
};

export const runSepsisCheck = async (
  vitals: {
    rr?: number;
    spo2?: number;
    temperature?: number;
    bp_systolic?: number;
    bp_diastolic?: number;
    pulse?: number;
  },
  hospitalId: string,
  patientId: string,
  admissionId: string
): Promise<SepsisResult | null> => {
  try {
    const score = calculateNEWS2Score({
      rr: vitals.rr,
      spo2: vitals.spo2,
      temperature: vitals.temperature,
      bp_systolic: vitals.bp_systolic,
      pulse: vitals.pulse,
    });

    let riskLevel = "low";
    if (score >= 7) riskLevel = "critical";
    else if (score >= 5) riskLevel = "high";
    else if (score >= 3) riskLevel = "medium";

    if (score < 3) return { score, riskLevel, clinicalNote: null };

    // Check for recent alert (within 4 hours)
    const { data: recentAlert } = await supabase
      .from("sepsis_alerts")
      .select("id")
      .eq("admission_id", admissionId)
      .eq("resolved", false)
      .gte("alert_fired_at", new Date(Date.now() - 4 * 3600000).toISOString())
      .maybeSingle();

    if (recentAlert) return { score, riskLevel, clinicalNote: null };

    // AI clinical interpretation
    let clinicalNote: SepsisResult["clinicalNote"] = null;
    try {
      const response = await callAI({
        featureKey: "sepsis_early_warning",
        hospitalId,
        prompt: `Assess sepsis risk for an admitted patient.
        
NEWS2 Score: ${score} (Risk: ${riskLevel})
Vitals: RR ${vitals.rr || "?"}/min, SpO2 ${vitals.spo2 || "?"}%, Temp ${vitals.temperature || "?"}°C,
        BP ${vitals.bp_systolic || "?"}/${vitals.bp_diastolic || "?"} mmHg, HR ${vitals.pulse || "?"}/min

Return ONLY JSON:
{
  "clinical_interpretation": "One sentence clinical assessment",
  "urgent_actions": ["Action 1", "Action 2"],
  "escalate_immediately": true
}`,
        maxTokens: 200,
      });

      if (!response.error) {
        clinicalNote = parseAIJson(response.text);
      }
    } catch {
      /* AI unavailable — use score only */
    }

    // Insert sepsis alert
    await supabase.from("sepsis_alerts").insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      admission_id: admissionId,
      news2_score: score,
      risk_level: riskLevel,
      vitals_snapshot: vitals,
      clinical_interpretation: clinicalNote?.clinical_interpretation || null,
      urgent_actions: clinicalNote?.urgent_actions || [],
    } as any);

    // Insert clinical alert
    await supabase.from("clinical_alerts").insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      alert_type: "sepsis_risk",
      severity: score >= 7 ? "critical" : "high",
      alert_message: `NEWS2 Score: ${score} — ${riskLevel.toUpperCase()} SEPSIS RISK. ${clinicalNote?.clinical_interpretation || "Clinical review required"}. Actions: ${clinicalNote?.urgent_actions?.join(" · ") || "Clinical review required"}`,
    } as any);

    return { score, riskLevel, clinicalNote };
  } catch {
    return null;
  }
};

// ── FEATURE 3: AI Triage Classifier ──

export interface TriageClassification {
  priority: string;
  colour: string;
  rationale: string;
  immediate_actions: string[];
  news2_flag: boolean;
}

export const classifyTriage = async (
  hospitalId: string,
  patientAge: string | null,
  patientGender: string | null,
  chiefComplaint: string,
  vitals?: { pulse?: string; bp_s?: string; bp_d?: string; spo2?: string; gcs?: string }
): Promise<TriageClassification | null> => {
  try {
    const response = await callAI({
      featureKey: "triage_classifier",
      hospitalId,
      prompt: `You are an emergency triage nurse at an Indian hospital.
Classify this patient's triage priority using P1-P4 system.

Patient: Age ${patientAge || "unknown"}, Gender ${patientGender || "unknown"}
Chief complaint: "${chiefComplaint}"
Vitals: HR ${vitals?.pulse || "not taken"}, BP ${vitals?.bp_s || "not taken"}/${vitals?.bp_d || "not taken"}, SpO2 ${vitals?.spo2 || "not taken"}%, GCS: ${vitals?.gcs || "not assessed"}

Triage categories:
P1 (Red) — Immediate: life-threatening, needs care in <0 min
P2 (Orange) — Urgent: potentially life-threatening, <10 min
P3 (Yellow) — Semi-urgent: stable but needs treatment, <30 min
P4 (Green) — Non-urgent: minor, can wait >30 min

Return ONLY JSON:
{
  "priority": "P2",
  "colour": "orange",
  "rationale": "One sentence clinical rationale",
  "immediate_actions": ["IV access", "12-lead ECG", "Troponin"],
  "news2_flag": false
}`,
      maxTokens: 200,
    });

    if (response.error) return null;
    return parseAIJson(response.text);
  } catch {
    return null;
  }
};
