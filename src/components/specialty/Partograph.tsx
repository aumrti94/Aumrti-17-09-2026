import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Plus, Save, Loader2 } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import { cn } from "@/lib/utils";

interface PartographEntry {
  id?: string;
  time_hour: number;
  cervical_dilation: number | null;
  head_station: number | null;
  fhr: number | null;
  contractions_in_10min: number | null;
  contraction_duration: string | null;
  liquor: string | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  pulse: number | null;
  urine_output: string | null;
  oxytocin_units: string | null;
  drugs: string | null;
}

interface Props {
  patientId: string;
  hospitalId: string;
  admissionId: string | null;
}

const LIQUOR_OPTIONS = ["C", "M", "B", "A", "CS"];
const LIQUOR_LABELS: Record<string, string> = {
  C: "Clear", M: "Meconium", B: "Blood", A: "Absent", CS: "C-Section"
};

const alertLine = (h: number) => {
  // Alert line starts at 4 cm dilation at time 0, progresses 1 cm/hour
  const d = 4 + h;
  return d <= 10 ? d : null;
};

const actionLine = (h: number) => {
  // Action line = alert line shifted 4 hours to the right
  const d = 4 + (h - 4);
  return d >= 4 && d <= 10 ? d : null;
};

const Partograph: React.FC<Props> = ({ patientId, hospitalId, admissionId }) => {
  const { toast } = useToast();
  const [entries, setEntries] = useState<PartographEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newEntry, setNewEntry] = useState<Partial<PartographEntry>>({
    time_hour: 0,
    cervical_dilation: null,
    head_station: null,
    fhr: null,
    contractions_in_10min: null,
    contraction_duration: "< 20s",
    liquor: "C",
    systolic_bp: null,
    diastolic_bp: null,
    pulse: null,
    urine_output: "",
    oxytocin_units: "",
    drugs: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const query = (supabase as any)
      .from("partograph_entries")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("patient_id", patientId)
      .order("time_hour");

    const q = admissionId ? query.eq("admission_id", admissionId) : query;
    const { data } = await q;
    setEntries(data || []);
    setLoading(false);
  }, [patientId, hospitalId, admissionId]);

  useEffect(() => { load(); }, [load]);

  const addEntry = async () => {
    setSaving(true);
    const { error } = await (supabase as any).from("partograph_entries").insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      admission_id: admissionId,
      ...newEntry,
    });
    if (error) {
      toast({ title: "Failed to save entry", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entry added" });
      setNewEntry((e) => ({ ...e, time_hour: (e.time_hour || 0) + 1 }));
      load();
    }
    setSaving(false);
  };

  const maxHour = Math.max(12, ...entries.map((e) => e.time_hour));
  const chartData = Array.from({ length: maxHour + 1 }, (_, h) => {
    const entry = entries.find((e) => e.time_hour === h);
    return {
      hour: h,
      dilation: entry?.cervical_dilation ?? null,
      alert: alertLine(h),
      action: actionLine(h),
    };
  });

  const headData = Array.from({ length: maxHour + 1 }, (_, h) => {
    const entry = entries.find((e) => e.time_hour === h);
    return { hour: h, station: entry?.head_station ?? null };
  });

  const fhrData = entries.map((e) => ({ hour: e.time_hour, fhr: e.fhr }));

  // Alert flag: cervical dilation crosses or approaches action line
  const activeAlerts: string[] = [];
  entries.forEach((e) => {
    const action = actionLine(e.time_hour);
    if (e.cervical_dilation !== null && action !== null && e.cervical_dilation >= action) {
      activeAlerts.push(`Dilation (${e.cervical_dilation}cm) at or past ACTION LINE at hour ${e.time_hour}`);
    }
    if (e.liquor === "M") activeAlerts.push(`Meconium-stained liquor at hour ${e.time_hour}`);
    if (e.fhr !== null && (e.fhr < 110 || e.fhr > 160)) {
      activeAlerts.push(`Abnormal FHR (${e.fhr}) at hour ${e.time_hour}`);
    }
  });

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      {activeAlerts.length > 0 && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-1">
          {activeAlerts.map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-destructive font-medium">
              <AlertTriangle size={14} /> {a}
            </div>
          ))}
        </div>
      )}

      {/* Cervicograph */}
      <div className="border border-border rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">Cervicograph — Dilation vs. Time</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" label={{ value: "Hours in Labour", position: "insideBottom", offset: -2, fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
            <YAxis domain={[0, 10]} ticks={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]} label={{ value: "Dilation (cm)", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip formatter={(v: any) => v !== null ? `${v} cm` : "—"} />
            <Legend verticalAlign="top" />
            <Line type="monotone" dataKey="dilation" name="Cervical Dilation" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} connectNulls={false} />
            <Line type="monotone" dataKey="alert" name="Alert Line" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls />
            <Line type="monotone" dataKey="action" name="Action Line" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-amber-400 border-dashed" /> Alert Line — 4 cm/hr</span>
          <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-red-500" /> Action Line — alert + 4 hrs</span>
        </div>
      </div>

      {/* FHR Chart */}
      {fhrData.some((d) => d.fhr != null) && (
        <div className="border border-border rounded-xl p-4">
          <h3 className="text-sm font-bold mb-3">Fetal Heart Rate</h3>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={fhrData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" tickFormatter={(v) => `${v}h`} />
              <YAxis domain={[80, 180]} ticks={[80, 100, 110, 120, 140, 160, 180]} />
              <Tooltip />
              <ReferenceLine y={110} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "110", position: "right", fontSize: 10 }} />
              <ReferenceLine y={160} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "160", position: "right", fontSize: 10 }} />
              <Line type="monotone" dataKey="fhr" name="FHR (bpm)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Entry table */}
      {entries.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-2 py-1.5 text-center">Hour</th>
                <th className="px-2 py-1.5 text-center">Dilation</th>
                <th className="px-2 py-1.5 text-center">Station</th>
                <th className="px-2 py-1.5 text-center">FHR</th>
                <th className="px-2 py-1.5 text-center">Ctx/10min</th>
                <th className="px-2 py-1.5 text-center">Duration</th>
                <th className="px-2 py-1.5 text-center">Liquor</th>
                <th className="px-2 py-1.5 text-center">BP</th>
                <th className="px-2 py-1.5 text-center">Pulse</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const action = actionLine(e.time_hour);
                const isBeyondAction = e.cervical_dilation !== null && action !== null && e.cervical_dilation >= action;
                return (
                  <tr key={e.id || i} className={cn("border-t border-border", isBeyondAction ? "bg-red-50 dark:bg-red-950/20" : "")}>
                    <td className="px-2 py-1.5 text-center font-bold">{e.time_hour}h</td>
                    <td className="px-2 py-1.5 text-center font-bold">{e.cervical_dilation != null ? `${e.cervical_dilation}cm` : "—"}</td>
                    <td className="px-2 py-1.5 text-center">{e.head_station != null ? `${e.head_station > 0 ? "+" : ""}${e.head_station}` : "—"}</td>
                    <td className={cn("px-2 py-1.5 text-center font-bold", e.fhr && (e.fhr < 110 || e.fhr > 160) ? "text-destructive" : "")}>
                      {e.fhr ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-center">{e.contractions_in_10min ?? "—"}</td>
                    <td className="px-2 py-1.5 text-center">{e.contraction_duration || "—"}</td>
                    <td className="px-2 py-1.5 text-center">
                      {e.liquor ? (
                        <Badge variant="outline" className={cn("text-[9px]", e.liquor === "M" ? "bg-amber-50 border-amber-300 text-amber-700" : e.liquor === "B" ? "bg-red-50 border-red-300 text-red-700" : "")}>
                          {LIQUOR_LABELS[e.liquor] || e.liquor}
                        </Badge>
                      ) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-center">{e.systolic_bp && e.diastolic_bp ? `${e.systolic_bp}/${e.diastolic_bp}` : "—"}</td>
                    <td className="px-2 py-1.5 text-center">{e.pulse ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Entry Form */}
      <div className="border border-border rounded-xl p-4">
        <h3 className="text-sm font-bold mb-3">Add Partograph Entry</h3>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Hour</label>
            <Input type="number" min={0} max={48} value={newEntry.time_hour ?? ""} onChange={(e) => setNewEntry((n) => ({ ...n, time_hour: parseInt(e.target.value) || 0 }))} className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Dilation (cm)</label>
            <Input type="number" min={0} max={10} step={0.5} value={newEntry.cervical_dilation ?? ""} onChange={(e) => setNewEntry((n) => ({ ...n, cervical_dilation: e.target.value ? parseFloat(e.target.value) : null }))} className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Station</label>
            <Input type="number" min={-5} max={5} value={newEntry.head_station ?? ""} onChange={(e) => setNewEntry((n) => ({ ...n, head_station: e.target.value ? parseInt(e.target.value) : null }))} className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">FHR (bpm)</label>
            <Input type="number" min={60} max={200} value={newEntry.fhr ?? ""} onChange={(e) => setNewEntry((n) => ({ ...n, fhr: e.target.value ? parseInt(e.target.value) : null }))} className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Ctx / 10 min</label>
            <Input type="number" min={0} max={5} value={newEntry.contractions_in_10min ?? ""} onChange={(e) => setNewEntry((n) => ({ ...n, contractions_in_10min: e.target.value ? parseInt(e.target.value) : null }))} className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Ctx Duration</label>
            <select value={newEntry.contraction_duration || "< 20s"} onChange={(e) => setNewEntry((n) => ({ ...n, contraction_duration: e.target.value }))} className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs mt-0.5">
              {["< 20s", "20–40s", "> 40s"].map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Liquor</label>
            <select value={newEntry.liquor || "C"} onChange={(e) => setNewEntry((n) => ({ ...n, liquor: e.target.value }))} className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs mt-0.5">
              {LIQUOR_OPTIONS.map((o) => <option key={o} value={o}>{o} — {LIQUOR_LABELS[o]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Systolic BP</label>
            <Input type="number" value={newEntry.systolic_bp ?? ""} onChange={(e) => setNewEntry((n) => ({ ...n, systolic_bp: e.target.value ? parseInt(e.target.value) : null }))} className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Diastolic BP</label>
            <Input type="number" value={newEntry.diastolic_bp ?? ""} onChange={(e) => setNewEntry((n) => ({ ...n, diastolic_bp: e.target.value ? parseInt(e.target.value) : null }))} className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Pulse</label>
            <Input type="number" value={newEntry.pulse ?? ""} onChange={(e) => setNewEntry((n) => ({ ...n, pulse: e.target.value ? parseInt(e.target.value) : null }))} className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Urine Output</label>
            <Input value={newEntry.urine_output || ""} onChange={(e) => setNewEntry((n) => ({ ...n, urine_output: e.target.value }))} placeholder="ml" className="h-8 text-xs mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold">Drugs/Oxytocin</label>
            <Input value={newEntry.drugs || ""} onChange={(e) => setNewEntry((n) => ({ ...n, drugs: e.target.value }))} placeholder="e.g. Oxytocin 2U" className="h-8 text-xs mt-0.5" />
          </div>
        </div>
        <Button size="sm" className="mt-3 gap-1.5" onClick={addEntry} disabled={saving}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Add Entry
        </Button>
      </div>
    </div>
  );
};

export default Partograph;
