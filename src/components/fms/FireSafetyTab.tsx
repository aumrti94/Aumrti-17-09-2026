import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Flame, Plus, Loader2, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO, differenceInDays } from "date-fns";

interface DrillRecord {
  id: string;
  drill_date: string;
  drill_type: string;
  area_covered: string | null;
  shift: string | null;
  participants_count: number;
  time_to_evacuate_mins: number | null;
  fire_exits_clear: boolean;
  extinguisher_count: number | null;
  observations: string | null;
  corrective_actions: string | null;
  document_url: string | null;
}

const DRILL_TYPES = [
  { value: "evacuation",   label: "Evacuation Drill" },
  { value: "extinguisher", label: "Extinguisher Inspection" },
  { value: "code_red",     label: "Code Red Mock Drill" },
  { value: "mock",         label: "Mock Fire Drill" },
];

const SHIFTS = ["Morning", "Afternoon", "Night"];

const today = new Date().toISOString().split("T")[0];

const FL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[11px] font-medium text-muted-foreground block mb-1">{children}</label>
);

const FireSafetyTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [records, setRecords] = useState<DrillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    drill_date: today, drill_type: "evacuation", area_covered: "", shift: "Morning",
    participants_count: "", time_to_evacuate_mins: "", fire_exits_clear: true,
    extinguisher_count: "", observations: "", corrective_actions: "", document_url: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("fire_safety_drills")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("drill_date", { ascending: false })
      .limit(200);
    setRecords(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.drill_date || !form.drill_type) return;
    setSaving(true);
    const { error } = await (supabase as any).from("fire_safety_drills").insert({
      hospital_id: hospitalId,
      drill_date: form.drill_date,
      drill_type: form.drill_type,
      area_covered: form.area_covered || null,
      shift: form.shift || null,
      participants_count: parseInt(form.participants_count) || 0,
      time_to_evacuate_mins: form.time_to_evacuate_mins ? parseFloat(form.time_to_evacuate_mins) : null,
      fire_exits_clear: form.fire_exits_clear,
      extinguisher_count: form.extinguisher_count ? parseInt(form.extinguisher_count) : null,
      observations: form.observations || null,
      corrective_actions: form.corrective_actions || null,
      document_url: form.document_url || null,
      conducted_by: userId || null,
    });
    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Fire safety record saved" });
      setShowAdd(false);
      setForm({ drill_date: today, drill_type: "evacuation", area_covered: "", shift: "Morning", participants_count: "", time_to_evacuate_mins: "", fire_exits_clear: true, extinguisher_count: "", observations: "", corrective_actions: "", document_url: "" });
      load();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from("fire_safety_drills").delete().eq("id", id);
    toast({ title: "Record deleted" });
    load();
  };

  const lastDrill = records.find(r => r.drill_type === "evacuation" || r.drill_type === "mock");
  const daysSinceDrill = lastDrill
    ? differenceInDays(new Date(), parseISO(lastDrill.drill_date))
    : null;
  const drillAlert = daysSinceDrill !== null && daysSinceDrill > 90;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-sm font-semibold">Fire Safety Drills & Inspections</span>
          {drillAlert && (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {daysSinceDrill}d since last drill — NABH requires quarterly
            </Badge>
          )}
          {!drillAlert && daysSinceDrill !== null && (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Last drill {daysSinceDrill}d ago
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Record Drill / Inspection
        </Button>
      </div>

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FL>Date *</FL>
              <Input type="date" value={form.drill_date} onChange={e => setForm(f => ({ ...f, drill_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <FL>Drill / Inspection Type *</FL>
              <select value={form.drill_type} onChange={e => setForm(f => ({ ...f, drill_type: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {DRILL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <FL>Shift</FL>
              <select value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <FL>Area / Block Covered</FL>
              <Input value={form.area_covered} onChange={e => setForm(f => ({ ...f, area_covered: e.target.value }))} placeholder="e.g. OPD Block, ICU wing" className="h-8 text-sm" />
            </div>
            <div>
              <FL>Participants Count</FL>
              <Input type="number" value={form.participants_count} onChange={e => setForm(f => ({ ...f, participants_count: e.target.value }))} placeholder="0" className="h-8 text-sm" min="0" />
            </div>
            <div>
              <FL>Evacuation Time (mins)</FL>
              <Input type="number" value={form.time_to_evacuate_mins} onChange={e => setForm(f => ({ ...f, time_to_evacuate_mins: e.target.value }))} placeholder="e.g. 4.5" className="h-8 text-sm" min="0" step="0.5" />
            </div>
            <div>
              <FL>Extinguishers Checked</FL>
              <Input type="number" value={form.extinguisher_count} onChange={e => setForm(f => ({ ...f, extinguisher_count: e.target.value }))} placeholder="0" className="h-8 text-sm" min="0" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="exits_clear" checked={form.fire_exits_clear} onChange={e => setForm(f => ({ ...f, fire_exits_clear: e.target.checked }))} className="h-4 w-4" />
              <label htmlFor="exits_clear" className="text-xs">Fire exits clear & unobstructed</label>
            </div>
            <div>
              <FL>Document / Report URL</FL>
              <Input value={form.document_url} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))} placeholder="https://…" className="h-8 text-sm" />
            </div>
            <div className="col-span-2">
              <FL>Observations</FL>
              <textarea value={form.observations} onChange={e => setForm(f => ({ ...f, observations: e.target.value }))} placeholder="Observations during drill / inspection…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[52px] resize-none" />
            </div>
            <div>
              <FL>Corrective Actions</FL>
              <textarea value={form.corrective_actions} onChange={e => setForm(f => ({ ...f, corrective_actions: e.target.value }))} placeholder="Actions assigned…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[52px] resize-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.drill_date} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Record
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
        ) : records.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Flame className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No fire safety records yet.</p>
            <p className="text-xs text-muted-foreground">NABH FMS.9 requires quarterly fire drills in all shifts and annual extinguisher inspections.</p>
          </div>
        ) : records.map(r => {
          const typeLabel = DRILL_TYPES.find(t => t.value === r.drill_type)?.label || r.drill_type;
          const hasIssues = !r.fire_exits_clear || !!r.corrective_actions;
          return (
            <div key={r.id} className={cn("border rounded-lg px-3 py-3 flex items-start gap-3 bg-card",
              hasIssues ? "border-amber-200 bg-amber-50/30 dark:bg-amber-950/20" : "border-border"
            )}>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{format(parseISO(r.drill_date), "dd MMM yyyy")}</span>
                  <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 rounded px-1.5 py-px font-medium">{typeLabel}</span>
                  {r.shift && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-px rounded">{r.shift} Shift</span>}
                  {r.area_covered && <span className="text-[10px] text-muted-foreground">{r.area_covered}</span>}
                  {!r.fire_exits_clear && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Exits Blocked</Badge>}
                  {r.fire_exits_clear && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" title="Fire exits clear" />}
                </div>
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                  {r.participants_count > 0 && <span>{r.participants_count} participants</span>}
                  {r.time_to_evacuate_mins && (
                    <span className={cn("font-medium", r.time_to_evacuate_mins > 5 ? "text-amber-600" : "text-emerald-600")}>
                      Evacuation: {r.time_to_evacuate_mins} mins
                    </span>
                  )}
                  {r.extinguisher_count && <span>{r.extinguisher_count} extinguishers checked</span>}
                </div>
                {r.observations && <p className="text-[11px] text-muted-foreground">{r.observations}</p>}
                {r.corrective_actions && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    <span className="font-medium">Actions:</span> {r.corrective_actions}
                  </p>
                )}
              </div>
              <button onClick={() => handleDelete(r.id)} className="p-1 text-muted-foreground hover:text-destructive shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FireSafetyTab;
