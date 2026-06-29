import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { cn } from "@/lib/utils";
import { ShieldCheck } from "lucide-react";

const PHQ9_QUESTIONS = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
  "Feeling tired or having little energy",
  "Poor appetite or overeating",
  "Feeling bad about yourself — or that you are a failure",
  "Trouble concentrating on things",
  "Moving or speaking so slowly that other people could notice (or being fidgety / restless)",
  "Thoughts that you would be better off dead, or thoughts of hurting yourself",
];

const PHQ9_OPTIONS = ["Not at all", "Several days", "More than half the days", "Nearly every day"];

function phq9Severity(score: number): { label: string; color: string } {
  if (score <= 4) return { label: "Minimal depression", color: "text-green-700" };
  if (score <= 9) return { label: "Mild depression", color: "text-amber-700" };
  if (score <= 14) return { label: "Moderate depression", color: "text-orange-700" };
  if (score <= 19) return { label: "Moderately severe depression", color: "text-red-600" };
  return { label: "Severe depression", color: "text-red-800 font-bold" };
}

const NCD_SCREENS = [
  { key: "ncd_diabetes", label: "Diabetes screening (FBS / RBS)" },
  { key: "ncd_hypertension", label: "Hypertension screening (BP check)" },
  { key: "ncd_obesity", label: "Obesity screening (BMI calculation)" },
  { key: "ncd_copd", label: "COPD / respiratory screening" },
  { key: "cervical_cancer", label: "Cervical cancer screening (VIA / Pap)" },
  { key: "breast_cancer", label: "Breast cancer screening (CBE)" },
];

interface ScreeningRecord {
  id: string; screen_type: string; score: number | null; result_flag: string | null; screened_at: string;
}

interface Props {
  encounterId?: string;
  admissionId?: string;
  patientId: string;
}

const ScreeningsTab: React.FC<Props> = ({ encounterId, admissionId, patientId }) => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [history, setHistory] = useState<ScreeningRecord[]>([]);
  const [phq9Answers, setPhq9Answers] = useState<number[]>(Array(9).fill(0));
  const [phq9Saving, setPhq9Saving] = useState(false);
  const [ncdSelected, setNcdSelected] = useState<Record<string, boolean>>({});
  const [ncdSaving, setNcdSaving] = useState(false);
  const [tab, setTab] = useState<"phq9" | "ncd">("phq9");

  const phq9Score = phq9Answers.reduce((s, a) => s + a, 0);
  const severity = phq9Severity(phq9Score);

  const load = useCallback(async () => {
    if (!hospitalId || !patientId) return;
    const { data } = await (supabase as any)
      .from("preventive_screenings")
      .select("id, screen_type, score, result_flag, screened_at")
      .eq("hospital_id", hospitalId).eq("patient_id", patientId).eq("is_deleted", false)
      .order("screened_at", { ascending: false }).limit(30);
    setHistory(data || []);
  }, [hospitalId, patientId]);

  useEffect(() => { load(); }, [load]);

  const savePHQ9 = async () => {
    if (!hospitalId || !patientId) return;
    const resultFlag = phq9Score <= 4 ? "normal" : phq9Score <= 9 ? "at_risk" : "positive";
    const { data: { user } } = await supabase.auth.getUser();
    setPhq9Saving(true);
    await (supabase as any).from("preventive_screenings").insert({
      hospital_id: hospitalId, patient_id: patientId,
      encounter_id: encounterId || null, admission_id: admissionId || null,
      screen_type: "phq9", score: phq9Score, result_flag: resultFlag,
      screened_by: user?.id,
    });
    await logNABHEvidence(hospitalId, "AAC.11", `PHQ-9 screening completed. Score: ${phq9Score} — ${severity.label}`);
    toast({ title: `PHQ-9 saved — Score ${phq9Score} (${severity.label})` });
    setPhq9Answers(Array(9).fill(0));
    load();
    setPhq9Saving(false);
  };

  const saveNCD = async () => {
    const selected = Object.keys(ncdSelected).filter(k => ncdSelected[k]);
    if (selected.length === 0) { toast({ title: "Select at least one NCD screen", variant: "destructive" }); return; }
    if (!hospitalId || !patientId) return;
    const { data: { user } } = await supabase.auth.getUser();
    setNcdSaving(true);
    const rows = selected.map(screen_type => ({
      hospital_id: hospitalId, patient_id: patientId,
      encounter_id: encounterId || null, admission_id: admissionId || null,
      screen_type, result_flag: "at_risk", screened_by: user?.id,
    }));
    await (supabase as any).from("preventive_screenings").insert(rows);
    await logNABHEvidence(hospitalId, "AAC.11", `NCD screenings initiated: ${selected.join(", ")}`);
    toast({ title: `${selected.length} NCD screening(s) recorded` });
    setNcdSelected({});
    load();
    setNcdSaving(false);
  };

  const FLAG_COLORS: Record<string, string> = {
    normal: "bg-green-100 text-green-800", at_risk: "bg-amber-100 text-amber-800",
    positive: "bg-red-100 text-red-800", referred: "bg-purple-100 text-purple-800",
  };

  return (
    <div className="flex flex-col gap-4 p-4 overflow-auto">
      {/* Tab switcher */}
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Preventive Screenings</span>
        <div className="ml-auto flex gap-1">
          {(["phq9", "ncd"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
                tab === t ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted")}>
              {t === "phq9" ? "PHQ-9 Mental Health" : "NCD Screening"}
            </button>
          ))}
        </div>
      </div>

      {tab === "phq9" ? (
        <div className="border rounded-lg p-4 bg-card">
          <p className="text-sm font-medium mb-3">Over the last 2 weeks, how often have you been bothered by…</p>
          <div className="space-y-3">
            {PHQ9_QUESTIONS.map((q, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-foreground mb-1">{i + 1}. {q}</p>
                <div className="flex gap-2 flex-wrap">
                  {PHQ9_OPTIONS.map((opt, v) => (
                    <label key={v} className="flex items-center gap-1 text-xs cursor-pointer">
                      <input type="radio" name={`phq_${i}`} checked={phq9Answers[i] === v}
                        onChange={() => { const a = [...phq9Answers]; a[i] = v; setPhq9Answers(a); }} />
                      <span>{opt} ({v})</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className={cn("mt-4 p-3 rounded-md border", phq9Score >= 10 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200")}>
            <p className="text-sm font-bold">Total Score: {phq9Score}/27</p>
            <p className={cn("text-sm", severity.color)}>{severity.label}</p>
          </div>
          <Button size="sm" className="mt-3" onClick={savePHQ9} disabled={phq9Saving}>
            {phq9Saving ? "Saving…" : "Save PHQ-9 Result"}
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg p-4 bg-card">
          <p className="text-sm font-medium mb-3">NCD Screening initiated for:</p>
          <div className="space-y-2">
            {NCD_SCREENS.map(s => (
              <label key={s.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={!!ncdSelected[s.key]}
                  onChange={e => setNcdSelected(prev => ({ ...prev, [s.key]: e.target.checked }))} />
                {s.label}
              </label>
            ))}
          </div>
          <Button size="sm" className="mt-4" onClick={saveNCD} disabled={ncdSaving}>
            {ncdSaving ? "Saving…" : "Record NCD Screenings"}
          </Button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Screening History</p>
          <div className="space-y-1">
            {history.slice(0, 10).map(h => (
              <div key={h.id} className="flex items-center gap-3 text-xs p-2 border rounded bg-card">
                <span className="font-medium">{h.screen_type.replace("ncd_", "").replace(/_/g, " ").toUpperCase()}</span>
                {h.score != null && <span>Score: {h.score}</span>}
                {h.result_flag && <Badge className={cn("text-xs", FLAG_COLORS[h.result_flag] || "")}>{h.result_flag}</Badge>}
                <span className="ml-auto text-muted-foreground">{new Date(h.screened_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ScreeningsTab;
