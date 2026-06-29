import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ShieldAlert, ShieldCheck, AlertTriangle, Loader2, Check } from "lucide-react";
import { logNABHEvidence } from "@/lib/nabh-evidence";

interface CriterionOption {
  value: number;
  label: string;
}

interface Criterion {
  key: keyof Omit<MorseScores, "fall_precautions_initiated" | "precautions_notes">;
  label: string;
  options: CriterionOption[];
}

interface MorseScores {
  fall_history: number;
  secondary_diagnosis: number;
  ambulatory_aid: number;
  iv_therapy: number;
  gait: number;
  mental_status: number;
  fall_precautions_initiated: boolean;
  precautions_notes: string;
}

const CRITERIA: Criterion[] = [
  {
    key: "fall_history",
    label: "History of falling (within 3 months)",
    options: [
      { value: 0, label: "No (0)" },
      { value: 25, label: "Yes (25)" },
    ],
  },
  {
    key: "secondary_diagnosis",
    label: "Secondary diagnosis",
    options: [
      { value: 0, label: "No (0)" },
      { value: 15, label: "Yes (15)" },
    ],
  },
  {
    key: "ambulatory_aid",
    label: "Ambulatory aid",
    options: [
      { value: 0, label: "None / bed rest / nurse assist (0)" },
      { value: 15, label: "Crutches / cane / walker (15)" },
      { value: 30, label: "Furniture (30)" },
    ],
  },
  {
    key: "iv_therapy",
    label: "IV / heparin lock",
    options: [
      { value: 0, label: "No (0)" },
      { value: 20, label: "Yes (20)" },
    ],
  },
  {
    key: "gait",
    label: "Gait / transferring",
    options: [
      { value: 0, label: "Normal / bed rest / wheelchair (0)" },
      { value: 10, label: "Weak (10)" },
      { value: 20, label: "Impaired (20)" },
    ],
  },
  {
    key: "mental_status",
    label: "Mental status",
    options: [
      { value: 0, label: "Oriented to own ability (0)" },
      { value: 15, label: "Overestimates / forgets limitations (15)" },
    ],
  },
];

const PRECAUTIONS = [
  "Bed rails up",
  "Call bell within reach",
  "Non-slip footwear",
  "Hourly nursing rounds",
  "Fall risk wristband",
  "Bed in lowest position",
  "Supervised ambulation",
  "Fall precaution sign on door",
];

interface Props {
  patientId: string;
  admissionId?: string;
  hospitalId: string;
  onSaved?: () => void;
}

const FallRiskAssessmentForm: React.FC<Props> = ({ patientId, admissionId, hospitalId, onSaved }) => {
  const { toast } = useToast();
  const [scores, setScores] = useState<MorseScores>({
    fall_history: 0,
    secondary_diagnosis: 0,
    ambulatory_aid: 0,
    iv_therapy: 0,
    gait: 0,
    mental_status: 0,
    fall_precautions_initiated: false,
    precautions_notes: "",
  });
  const [saving, setSaving] = useState(false);

  const totalScore =
    scores.fall_history +
    scores.secondary_diagnosis +
    scores.ambulatory_aid +
    scores.iv_therapy +
    scores.gait +
    scores.mental_status;

  const riskLevel = totalScore >= 45 ? "high" : totalScore >= 25 ? "medium" : "low";

  const riskConfig = {
    high: { label: "HIGH RISK", color: "bg-destructive/10 text-destructive border-destructive", icon: <ShieldAlert size={18} /> },
    medium: { label: "MEDIUM RISK", color: "bg-amber-50 text-amber-700 border-amber-400", icon: <AlertTriangle size={18} /> },
    low: { label: "LOW RISK", color: "bg-green-50 text-green-700 border-green-400", icon: <ShieldCheck size={18} /> },
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", userData.user?.id)
        .maybeSingle();

      const reassessmentDue = new Date();
      reassessmentDue.setDate(reassessmentDue.getDate() + (riskLevel === "high" ? 1 : riskLevel === "medium" ? 3 : 7));

      const { error } = await supabase.from("fall_risk_assessments").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        admission_id: admissionId || null,
        assessed_by: profile?.id || null,
        fall_history: scores.fall_history,
        secondary_diagnosis: scores.secondary_diagnosis,
        ambulatory_aid: scores.ambulatory_aid,
        iv_therapy: scores.iv_therapy,
        gait: scores.gait,
        mental_status: scores.mental_status,
        fall_precautions_initiated: scores.fall_precautions_initiated,
        precautions_notes: scores.precautions_notes || null,
        assessment_date: new Date().toISOString().split("T")[0],
        reassessment_due: reassessmentDue.toISOString().split("T")[0],
      });

      if (error) throw error;

      logNABHEvidence(
        hospitalId,
        "COP.4",
        `Morse Fall Scale assessed — score: ${totalScore}, risk: ${riskLevel}. Precautions: ${scores.fall_precautions_initiated ? "initiated" : "not required"}.`
      );

      toast({
        title: `Fall Risk Assessment saved — ${riskLevel.toUpperCase()} (score: ${totalScore})`,
        description: `Reassessment due: ${reassessmentDue.toLocaleDateString("en-IN")}`,
        variant: riskLevel === "high" ? "destructive" : "default",
      });

      onSaved?.();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Score summary */}
      <div className={cn("flex items-center gap-3 p-4 rounded-lg border-2", riskConfig[riskLevel].color)}>
        {riskConfig[riskLevel].icon}
        <div>
          <p className="text-base font-bold">{riskConfig[riskLevel].label}</p>
          <p className="text-sm">Morse Score: <span className="font-bold text-lg">{totalScore}</span> / 125</p>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          Low: 0–24 · Medium: 25–44 · High: ≥ 45
        </div>
      </div>

      {/* Criteria */}
      <div className="space-y-4">
        {CRITERIA.map((criterion) => (
          <div key={criterion.key} className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground">{criterion.label}</p>
            <div className="flex gap-2 flex-wrap">
              {criterion.options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setScores((s) => ({ ...s, [criterion.key]: opt.value }))}
                  className={cn(
                    "px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                    scores[criterion.key] === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-foreground hover:bg-muted"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Precautions — shown for medium/high risk */}
      {riskLevel !== "low" && (
        <div className={cn("rounded-lg border-2 p-4 space-y-3", riskConfig[riskLevel].color)}>
          <p className="text-sm font-bold">Recommended Fall Precautions</p>
          <div className="flex flex-wrap gap-2">
            {PRECAUTIONS.map((p) => {
              const selected = scores.precautions_notes.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    const current = scores.precautions_notes ? scores.precautions_notes.split(", ").filter(Boolean) : [];
                    const next = selected ? current.filter((x) => x !== p) : [...current, p];
                    setScores((s) => ({ ...s, precautions_notes: next.join(", "), fall_precautions_initiated: next.length > 0 }));
                  }}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-foreground hover:bg-muted"
                  )}
                >
                  {selected && <Check size={11} />}
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Button
        onClick={handleSave}
        disabled={saving}
        className="w-full h-11 font-bold"
        variant={riskLevel === "high" ? "destructive" : "default"}
      >
        {saving ? (
          <><Loader2 size={16} className="mr-2 animate-spin" /> Saving…</>
        ) : (
          <>Save Fall Risk Assessment — Score {totalScore} ({riskConfig[riskLevel].label})</>
        )}
      </Button>
    </div>
  );
};

export default FallRiskAssessmentForm;
