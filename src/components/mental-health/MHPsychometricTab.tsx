import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScaleQuestion {
  id: number;
  text: string;
  options: { label: string; value: number }[];
}

const PHQ9_QUESTIONS: ScaleQuestion[] = [
  { id: 1, text: "Little interest or pleasure in doing things", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 2, text: "Feeling down, depressed, or hopeless", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 3, text: "Trouble falling or staying asleep, or sleeping too much", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 4, text: "Feeling tired or having little energy", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 5, text: "Poor appetite or overeating", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 6, text: "Feeling bad about yourself — or that you are a failure", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 7, text: "Trouble concentrating on things", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 8, text: "Moving or speaking so slowly that other people could have noticed. Or being so fidgety or restless", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 9, text: "Thoughts that you would be better off dead, or of hurting yourself", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
];

const GAD7_QUESTIONS: ScaleQuestion[] = [
  { id: 1, text: "Feeling nervous, anxious, or on edge", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 2, text: "Not being able to stop or control worrying", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 3, text: "Worrying too much about different things", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 4, text: "Trouble relaxing", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 5, text: "Being so restless that it's hard to sit still", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 6, text: "Becoming easily annoyed or irritable", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
  { id: 7, text: "Feeling afraid as if something awful might happen", options: [{ label: "Not at all", value: 0 }, { label: "Several days", value: 1 }, { label: "More than half the days", value: 2 }, { label: "Nearly every day", value: 3 }] },
];

function getPHQ9Severity(score: number): { label: string; color: string } {
  if (score >= 20) return { label: "Severe", color: "bg-red-100 text-red-700" };
  if (score >= 15) return { label: "Moderately Severe", color: "bg-orange-100 text-orange-700" };
  if (score >= 10) return { label: "Moderate", color: "bg-amber-100 text-amber-700" };
  if (score >= 5) return { label: "Mild", color: "bg-yellow-100 text-yellow-700" };
  return { label: "Minimal / None", color: "bg-emerald-100 text-emerald-700" };
}

function getGAD7Severity(score: number): { label: string; color: string } {
  if (score >= 15) return { label: "Severe", color: "bg-red-100 text-red-700" };
  if (score >= 10) return { label: "Moderate", color: "bg-amber-100 text-amber-700" };
  if (score >= 5) return { label: "Mild", color: "bg-yellow-100 text-yellow-700" };
  return { label: "Minimal / None", color: "bg-emerald-100 text-emerald-700" };
}

interface Props {
  patientId: string;
  hospitalId: string;
  encounterId?: string;
}

type ScaleType = "PHQ9" | "GAD7";

const SCALES: { key: ScaleType; label: string; desc: string; questions: ScaleQuestion[]; maxScore: number }[] = [
  { key: "PHQ9", label: "PHQ-9", desc: "Patient Health Questionnaire (Depression)", questions: PHQ9_QUESTIONS, maxScore: 27 },
  { key: "GAD7", label: "GAD-7", desc: "Generalised Anxiety Disorder Scale", questions: GAD7_QUESTIONS, maxScore: 21 },
];

const MHPsychometricTab: React.FC<Props> = ({ patientId, hospitalId, encounterId }) => {
  const [activeScale, setActiveScale] = useState<ScaleType>("PHQ9");
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => { fetchHistory(); }, [patientId]);

  const fetchHistory = async () => {
    const { data } = await (supabase as any)
      .from("psychometric_assessments")
      .select("id, assessment_type, total_score, severity, risk_flag, created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory(data || []);
  };

  const scale = SCALES.find(s => s.key === activeScale)!;
  const answered = Object.keys(answers).length;
  const total = answered === scale.questions.length
    ? Object.values(answers).reduce((sum, v) => sum + v, 0)
    : null;

  const severity = total !== null
    ? activeScale === "PHQ9" ? getPHQ9Severity(total) : getGAD7Severity(total)
    : null;

  const isQ9Risk = activeScale === "PHQ9" && (answers[9] ?? 0) > 0;
  const isComplete = answered === scale.questions.length;

  const handleSave = async () => {
    if (!isComplete) { toast.error("Please answer all questions"); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase as any).from("psychometric_assessments").insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      encounter_id: encounterId || null,
      assessment_type: activeScale,
      answers,
      total_score: total,
      severity: severity?.label,
      risk_flag: isQ9Risk || (total !== null && total >= 20),
      administered_by: user?.id,
    });

    if (isQ9Risk || (total !== null && total >= 20)) {
      await (supabase as any).from("clinical_alerts").insert({
        hospital_id: hospitalId,
        alert_type: "mental_health_risk",
        severity: "critical",
        alert_message: `${activeScale} score ${total} (${severity?.label}) — Patient: ${patientId}. Q9 ideation: ${isQ9Risk ? "Yes" : "No"}. Urgent clinical review required.`,
        patient_id: patientId,
      });
      toast.error("Crisis alert raised — urgent clinical review required", { duration: 8000 });
    } else {
      toast.success(`${activeScale} saved — Score: ${total} (${severity?.label})`);
    }

    setAnswers({});
    setSaving(false);
    fetchHistory();
  };

  const historyForScale = history.filter(h => h.assessment_type === activeScale);

  return (
    <div className="flex gap-3 h-full">
      {/* Left: scale selector + history */}
      <div className="w-[200px] flex flex-col gap-3">
        <div className="border rounded-lg p-2 bg-card space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Select Scale</p>
          {SCALES.map(s => (
            <button
              key={s.key}
              onClick={() => { setActiveScale(s.key); setAnswers({}); }}
              className={cn("w-full text-left px-2 py-2 rounded-md text-xs transition-colors",
                activeScale === s.key ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted")}
            >
              <div className="font-semibold">{s.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</div>
            </button>
          ))}
        </div>

        {historyForScale.length > 0 && (
          <div className="border rounded-lg p-2 bg-card space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">History</p>
            {historyForScale.slice(0, 5).map((h, i) => (
              <div key={h.id} className="px-2 py-1.5 rounded bg-muted/40 space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">{h.total_score}</span>
                  {h.risk_flag && <AlertTriangle className="h-3 w-3 text-red-500" />}
                </div>
                <div className="text-[10px] text-muted-foreground">{h.severity}</div>
                <div className="text-[10px] text-muted-foreground/60">
                  {new Date(h.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: questionnaire */}
      <div className="flex-1 flex flex-col border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30">
          <h3 className="text-sm font-semibold">{scale.label} — {scale.desc}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {answered}/{scale.questions.length} answered
            {total !== null && <> · Score: <strong>{total}/{scale.maxScore}</strong></>}
            {severity && (
              <Badge variant="secondary" className={cn("ml-2 text-[10px]", severity.color)}>
                {severity.label}
              </Badge>
            )}
          </p>
        </div>

        <ScrollArea className="flex-1 px-4 py-3">
          <div className="space-y-4">
            {scale.questions.map(q => (
              <div key={q.id} className={cn("space-y-2 p-3 rounded-lg border",
                q.id === 9 && activeScale === "PHQ9" ? "border-red-200 bg-red-50/40" : "border-border bg-muted/10")}>
                <p className="text-xs font-medium">
                  {q.id === 9 && activeScale === "PHQ9" && <span className="text-red-600 mr-1">⚠</span>}
                  {q.id}. {q.text}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {q.options.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setAnswers(prev => ({ ...prev, [q.id]: opt.value }))}
                      className={cn(
                        "text-left px-2 py-1.5 rounded border text-[11px] transition-all",
                        answers[q.id] === opt.value
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      <span className="font-bold">{opt.value}</span> — {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Crisis warning */}
        {isQ9Risk && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <span className="text-xs text-red-700 font-medium">Suicidal ideation detected (Q9) — mandatory clinical risk assessment required before patient leaves</span>
          </div>
        )}

        <div className="px-4 py-3 border-t flex gap-2">
          <Button
            size="sm"
            className="flex-1 bg-primary hover:bg-primary/90"
            onClick={handleSave}
            disabled={!isComplete || saving}
          >
            {saving ? "Saving..." : `Save ${activeScale} — Score: ${total ?? "?"}/${scale.maxScore}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAnswers({})}>
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MHPsychometricTab;
