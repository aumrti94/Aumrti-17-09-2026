import { supabase } from "@/integrations/supabase/client";

export type AIAuditAction = "accepted" | "overridden" | "rejected" | "flagged";

export interface AIAuditEntry {
  hospitalId: string;
  patientId?: string;
  featureKey: string;
  aiOutput: Record<string, unknown>;
  confidence?: number;
  reasoning?: string;
}

export function useAIAudit() {
  const logAudit = async (
    entry: AIAuditEntry,
    action: AIAuditAction,
    overrideValue?: Record<string, unknown>
  ): Promise<void> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await (supabase as any).from("ai_suggestions_audit").insert({
        hospital_id: entry.hospitalId,
        patient_id: entry.patientId ?? null,
        feature_key: entry.featureKey,
        ai_output: entry.aiOutput,
        confidence: entry.confidence ?? null,
        reasoning: entry.reasoning ?? null,
        user_action: action,
        override_value: overrideValue ?? null,
        user_id: user?.id ?? null,
      });
    } catch (e) {
      console.warn("AI audit log failed:", e);
    }
  };

  return { logAudit };
}
