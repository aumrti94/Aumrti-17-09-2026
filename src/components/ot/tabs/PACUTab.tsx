import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import type { OTSchedule } from "@/pages/ot/OTPage";

interface Props {
  schedule: OTSchedule;
}

interface PacuRow {
  id: string;
  assessed_at: string;
  activity: number | null;
  respiration: number | null;
  circulation: number | null;
  consciousness: number | null;
  spo2_score: number | null;
  total_score: number | null;
  recorded_by: string | null;
  notes: string | null;
}

const CRITERIA: { key: keyof Omit<PacuRow, "id" | "assessed_at" | "total_score" | "recorded_by" | "notes">; label: string; options: { score: 0 | 1 | 2; text: string }[] }[] = [
  {
    key: "activity",
    label: "Activity",
    options: [
      { score: 2, text: "Moves all 4 limbs voluntarily/on command" },
      { score: 1, text: "Moves 2 limbs" },
      { score: 0, text: "Unable to move limbs" },
    ],
  },
  {
    key: "respiration",
    label: "Respiration",
    options: [
      { score: 2, text: "Able to deep breathe & cough freely" },
      { score: 1, text: "Dyspnoea / limited breathing" },
      { score: 0, text: "Apnoeic" },
    ],
  },
  {
    key: "circulation",
    label: "Circulation",
    options: [
      { score: 2, text: "BP ± 20% of pre-anaesthetic level" },
      { score: 1, text: "BP ± 20–49% of pre-anaesthetic level" },
      { score: 0, text: "BP ± 50% of pre-anaesthetic level" },
    ],
  },
  {
    key: "consciousness",
    label: "Consciousness",
    options: [
      { score: 2, text: "Fully awake" },
      { score: 1, text: "Arousable on calling" },
      { score: 0, text: "Not responding" },
    ],
  },
  {
    key: "spo2_score",
    label: "SpO₂",
    options: [
      { score: 2, text: "> 92% on room air" },
      { score: 1, text: "Supplemental O₂ required to maintain > 90%" },
      { score: 0, text: "< 90% even with O₂ supplementation" },
    ],
  },
];

const PACUTab: React.FC<Props> = ({ schedule }) => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [scores, setScores] = useState<Record<string, number | null>>({
    activity: null, respiration: null, circulation: null, consciousness: null, spo2_score: null,
  });
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<PacuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const total = useMemo(
    () => Object.values(scores).reduce<number>((sum, v) => sum + (typeof v === "number" ? v : 0), 0),
    [scores],
  );
  const allRated = Object.values(scores).every((v) => typeof v === "number");

  const loadHistory = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pacu_assessments" as any)
      .select("*")
      .eq("ot_schedule_id", schedule.id)
      .order("assessed_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load PACU history", description: error.message, variant: "destructive" });
    } else {
      setHistory((data as unknown as PacuRow[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { loadHistory(); /* eslint-disable-next-line */ }, [schedule.id]);

  const saveScore = async () => {
    if (!allRated) {
      toast({ title: "Score all 5 criteria first", variant: "destructive" });
      return;
    }
    if (!hospitalId) return;
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    let recordedBy: string | null = null;
    if (auth.user) {
      const { data: u } = await supabase.from("users").select("id").eq("auth_user_id", auth.user.id).maybeSingle();
      recordedBy = u?.id ?? null;
    }
    const { error } = await supabase.from("pacu_assessments" as any).insert({
      hospital_id: hospitalId,
      ot_schedule_id: schedule.id,
      activity: scores.activity,
      respiration: scores.respiration,
      circulation: scores.circulation,
      consciousness: scores.consciousness,
      spo2_score: scores.spo2_score,
      notes: notes.trim() || null,
      recorded_by: recordedBy,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Failed to record score", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Aldrete score recorded: ${total}/10` });
    setScores({ activity: null, respiration: null, circulation: null, consciousness: null, spo2_score: null });
    setNotes("");
    loadHistory();
  };

  // Discharge criteria: ≥9 for 2 consecutive readings, ≥30 min apart
  const dischargeMet = useMemo(() => {
    if (history.length < 2) return false;
    const sorted = [...history].sort((a, b) => new Date(b.assessed_at).getTime() - new Date(a.assessed_at).getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if ((a.total_score ?? 0) >= 9 && (b.total_score ?? 0) >= 9) {
        const gapMin = (new Date(a.assessed_at).getTime() - new Date(b.assessed_at).getTime()) / 60000;
        if (gapMin >= 30) return true;
      }
    }
    return false;
  }, [history]);

  const badge = (score: number) => {
    if (score >= 9) return { cls: "bg-emerald-100 text-emerald-700 border-emerald-300", icon: <CheckCircle2 className="w-3.5 h-3.5" />, text: "Ready for Discharge" };
    if (score >= 7) return { cls: "bg-amber-100 text-amber-700 border-amber-300", icon: <AlertTriangle className="w-3.5 h-3.5" />, text: "Monitor" };
    return { cls: "bg-rose-100 text-rose-700 border-rose-300", icon: <XCircle className="w-3.5 h-3.5" />, text: "Not Ready" };
  };

  const liveBadge = badge(total);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      {dischargeMet && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">Discharge Criteria Met</p>
            <p className="text-xs text-emerald-700">Two consecutive Aldrete scores ≥ 9 recorded ≥ 30 min apart. Patient may be transferred to ward.</p>
          </div>
        </div>
      )}

      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">New Aldrete Assessment</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Live total</p>
              <p className="text-2xl font-bold font-mono text-foreground leading-none">{total}<span className="text-sm text-muted-foreground">/10</span></p>
            </div>
            <span className={cn("text-[11px] px-2.5 py-1 rounded-full border font-semibold inline-flex items-center gap-1", liveBadge.cls)}>
              {liveBadge.icon}
              {liveBadge.text}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {CRITERIA.map((c) => (
            <div key={c.key} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
              <p className="text-xs font-semibold text-foreground mb-2">{c.label}</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {c.options.map((opt) => {
                  const selected = scores[c.key as string] === opt.score;
                  return (
                    <label
                      key={opt.score}
                      className={cn(
                        "flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs",
                        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                      )}
                    >
                      <input
                        type="radio"
                        name={c.key as string}
                        checked={selected}
                        onChange={() => setScores((s) => ({ ...s, [c.key]: opt.score }))}
                        className="mt-0.5"
                      />
                      <span className="flex-1">
                        <span className="font-semibold text-foreground mr-1">{opt.score}</span>
                        <span className="text-muted-foreground">{opt.text}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <p className="text-xs font-semibold text-foreground mb-1">Notes (optional)</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Pain, nausea, shivering, observations…"
              className="w-full text-xs border border-border rounded-md px-2.5 py-2 bg-background"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveScore}
              disabled={!allRated || saving}
              className="text-xs bg-primary text-primary-foreground px-4 py-2 rounded-md font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Recording…" : "Record Score"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-5">
        <h3 className="text-sm font-bold text-foreground mb-3">Assessment History</h3>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-muted-foreground">No PACU assessments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 px-2 font-medium">Time</th>
                  <th className="py-2 px-2 font-medium">A</th>
                  <th className="py-2 px-2 font-medium">R</th>
                  <th className="py-2 px-2 font-medium">C</th>
                  <th className="py-2 px-2 font-medium">Cn</th>
                  <th className="py-2 px-2 font-medium">SpO₂</th>
                  <th className="py-2 px-2 font-medium">Total</th>
                  <th className="py-2 px-2 font-medium">Status</th>
                  <th className="py-2 px-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const b = badge(row.total_score ?? 0);
                  return (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-2 font-mono whitespace-nowrap">{new Date(row.assessed_at).toLocaleString()}</td>
                      <td className="py-2 px-2 font-mono">{row.activity}</td>
                      <td className="py-2 px-2 font-mono">{row.respiration}</td>
                      <td className="py-2 px-2 font-mono">{row.circulation}</td>
                      <td className="py-2 px-2 font-mono">{row.consciousness}</td>
                      <td className="py-2 px-2 font-mono">{row.spo2_score}</td>
                      <td className="py-2 px-2 font-mono font-bold">{row.total_score}/10</td>
                      <td className="py-2 px-2">
                        <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold inline-flex items-center gap-1", b.cls)}>
                          {b.icon}{b.text}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground max-w-[200px] truncate">{row.notes || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PACUTab;
