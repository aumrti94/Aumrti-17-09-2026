import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { invalidateAIFlagCache } from "@/hooks/useAIFeatureFlag";
import {
  AlertTriangle, Bot, Brain, FileText, Stethoscope, Mic, BarChart3, Activity,
} from "lucide-react";

interface AIFeatureConfig {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  critical: boolean;
}

const AI_FEATURES: AIFeatureConfig[] = [
  {
    key: "clinical_note",
    label: "Clinical Note Drafting",
    description: "AI-assisted SOAP notes and clinical documentation via voice or structured input",
    icon: FileText,
    critical: true,
  },
  {
    key: "discharge_summary",
    label: "Discharge Summary",
    description: "Structured AI-generated discharge summaries from IPD admission data",
    icon: Brain,
    critical: true,
  },
  {
    key: "differential_dx",
    label: "Differential Diagnosis",
    description: "AI-ranked differentials with supporting/against features and urgency classification",
    icon: Stethoscope,
    critical: true,
  },
  {
    key: "icd_suggest",
    label: "ICD-10 Code Suggestions",
    description: "Inline AI-suggested ICD-10 codes during diagnosis entry and MRD coding",
    icon: Bot,
    critical: false,
  },
  {
    key: "radiology_impression",
    label: "Radiology Impression",
    description: "AI-suggested impressions for radiology reports based on findings text",
    icon: Activity,
    critical: true,
  },
  {
    key: "voice_dictation",
    label: "Voice Dictation (AI-enhanced)",
    description: "Voice-to-text with AI structuring for clinical notes, ward rounds, and prescriptions",
    icon: Mic,
    critical: false,
  },
  {
    key: "executive_digest",
    label: "Executive Digest",
    description: "AI-generated daily KPI summaries and anomaly detection for hospital management",
    icon: BarChart3,
    critical: false,
  },
];

const DEFAULT_FLAGS: Record<string, boolean> = Object.fromEntries(
  AI_FEATURES.map(f => [f.key, true])
);

const SettingsAIFeaturesPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [saving, setSaving] = useState(false);
  const [flags, setFlags] = useState<Record<string, boolean>>(DEFAULT_FLAGS);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await supabase
        .from("hospitals")
        .select("ai_feature_flags")
        .eq("id", hospitalId)
        .maybeSingle();
      if (data?.ai_feature_flags) {
        setFlags({ ...DEFAULT_FLAGS, ...(data.ai_feature_flags as Record<string, boolean>) });
      }
    })();
  }, [hospitalId]);

  const handleSave = async () => {
    if (!hospitalId) return;
    setSaving(true);
    await supabase
      .from("hospitals")
      .update({ ai_feature_flags: flags } as any)
      .eq("id", hospitalId);
    invalidateAIFlagCache();
    setSaving(false);
    toast({ title: "AI feature settings saved" });
  };

  const toggle = (key: string, value: boolean) => {
    setFlags(prev => ({ ...prev, [key]: value }));
  };

  const enabledCount = Object.values(flags).filter(Boolean).length;

  return (
    <SettingsPageWrapper title="AI Features" onSave={handleSave} saving={saving}>
      <div className="space-y-6">
        {/* DPA / Data Privacy Warning */}
        <div className="border border-amber-300 rounded-lg p-4 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-amber-800">Data Processing Agreement Required</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                Using AI features may involve sending patient data to third-party AI providers (Lovable
                Gateway / OpenAI). Ensure your <strong>Data Processing Agreements (DPA)</strong> are in
                place before enabling these features in production.
              </p>
              <p className="text-xs text-amber-700 leading-relaxed">
                <strong>Do NOT enable AI features without explicit hospital admin authorization.</strong>{" "}
                All AI-generated clinical content requires doctor attestation before it is saved to a
                patient record.
              </p>
            </div>
          </div>
        </div>

        {/* Status summary */}
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {enabledCount} of {AI_FEATURES.length} AI features enabled
          </p>
          {enabledCount > 0 && (
            <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700">
              AI Active
            </Badge>
          )}
        </div>

        {/* Feature toggles */}
        <div className="space-y-3">
          {AI_FEATURES.map(({ key, label, description, icon: Icon, critical }) => (
            <div
              key={key}
              className="flex items-start justify-between border rounded-lg px-4 py-3 bg-card gap-4"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{label}</p>
                    {critical && (
                      <Badge variant="secondary" className="text-[9px] bg-red-50 text-red-700">
                        Requires Attestation
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                </div>
              </div>
              <Switch
                checked={flags[key] ?? true}
                onCheckedChange={(v) => toggle(key, v)}
                className="shrink-0 mt-0.5"
              />
            </div>
          ))}
        </div>

        {/* Attestation notice */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <p className="text-xs font-semibold mb-1.5">Doctor Attestation Policy</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Features marked <strong>"Requires Attestation"</strong> (clinical note, discharge summary,
            differential diagnosis, and radiology impression) show a mandatory review modal before
            AI-generated content is saved. The doctor must confirm they have reviewed and accept
            responsibility for the content. All attestations are logged with the doctor's identity,
            timestamp, and whether the content was edited before saving.
          </p>
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsAIFeaturesPage;
