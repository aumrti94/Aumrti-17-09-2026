import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PatientAIContext {
  chronic_conditions: string[];
  known_allergies: string[];
  current_medications: string[];
  recent_diagnoses: string[];
  risk_flags: string[];
  context_summary: string;
  last_updated: string;
}

export function usePatientAIContext() {
  const [context, setContext] = useState<PatientAIContext | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchContext = useCallback(async (patientId: string) => {
    const { data } = await (supabase as any)
      .from("patient_ai_context")
      .select("*")
      .eq("patient_id", patientId)
      .maybeSingle();
    if (data) setContext(data);
    return data as PatientAIContext | null;
  }, []);

  const refreshContext = useCallback(async (patientId: string, hospitalId: string) => {
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("update-patient-ai-context", {
        body: { patient_id: patientId, hospital_id: hospitalId },
      });
      if (data?.context_summary) {
        setContext({
          chronic_conditions: data.chronic_conditions || [],
          known_allergies: data.known_allergies || [],
          current_medications: data.current_medications || [],
          recent_diagnoses: data.recent_diagnoses || [],
          risk_flags: data.risk_flags || [],
          context_summary: data.context_summary,
          last_updated: new Date().toISOString(),
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const buildContextPrompt = (ctx: PatientAIContext | null): string => {
    if (!ctx || !ctx.context_summary) return "";
    return [
      `\n\nPATIENT AI CONTEXT:`,
      ctx.context_summary,
      ctx.known_allergies.length ? `Known allergies: ${ctx.known_allergies.join(", ")}` : "",
      ctx.current_medications.length ? `Current medications: ${ctx.current_medications.join(", ")}` : "",
      ctx.chronic_conditions.length ? `Chronic conditions: ${ctx.chronic_conditions.join(", ")}` : "",
      ctx.risk_flags.length ? `Risk flags: ${ctx.risk_flags.join(", ")}` : "",
    ].filter(Boolean).join("\n");
  };

  return { context, loading, fetchContext, refreshContext, buildContextPrompt };
}
