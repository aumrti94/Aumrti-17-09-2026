import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Zap, Plus, Loader2, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO, isPast } from "date-fns";

interface ElecLog {
  id: string;
  log_date: string;
  check_type: string;
  equipment_id: string | null;
  location: string | null;
  load_kva: number | null;
  fuel_level_pct: number | null;
  run_duration_mins: number | null;
  status: string;
  findings: string | null;
  corrective_actions: string | null;
  next_due_date: string | null;
  document_url: string | null;
}

const CHECK_TYPES = [
  { value: "dg_set",              label: "DG Set Auto-Start Test" },
  { value: "ups",                 label: "UPS / Battery Test" },
  { value: "earthing",            label: "Earthing / Grounding Check" },
  { value: "panel",               label: "Main Panel / Distribution Board" },
  { value: "lighting",            label: "General Lighting Inspection" },
  { value: "emergency_lighting",  label: "Emergency Lighting Test" },
  { value: "lift",                label: "Lift / Elevator Safety" },
  { value: "solar",               label: "Solar Panel / Inverter Check" },
];

const STATUS_STYLES: Record<string, string> = {
  ok:          "bg-emerald-100 text-emerald-700 border-emerald-200",
  observation: "bg-amber-100 text-amber-700 border-amber-200",
  fault:       "bg-red-100 text-red-700 border-red-200",
};

const today = new Date().toISOString().split("T")[0];

const FL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[11px] font-medium text-muted-foreground block mb-1">{children}</label>
);

const ElectricalSafetyTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [logs, setLogs] = useState<ElecLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    log_date: today, check_type: "dg_set", equipment_id: "", location: "",
    load_kva: "", fuel_level_pct: "", run_duration_mins: "",
    status: "ok", findings: "", corrective_actions: "",
    next_due_date: "", document_url: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("electrical_safety_logs")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("log_date", { ascending: false })
      .limit(300);
    setLogs(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.log_date || !form.check_type) return;
    setSaving(true);
    const { error } = await (supabase as any).from("electrical_safety_logs").insert({
      hospital_id: hospitalId,
      log_date: form.log_date,
      check_type: form.check_type,
      equipment_id: form.equipment_id || null,
      location: form.location || null,
      load_kva: form.load_kva ? parseFloat(form.load_kva) : null,
      fuel_level_pct: form.fuel_level_pct ? parseInt(form.fuel_level_pct) : null,
      run_duration_mins: form.run_duration_mins ? parseInt(form.run_duration_mins) : null,
      status: form.status,
      findings: form.findings || null,
      corrective_actions: form.corrective_actions || null,
      next_due_date: form.next_due_date || null,
      document_url: form.document_url || null,
      performed_by: userId || null,
    });
    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Electrical safety log saved" });
      setShowAdd(false);
      setForm({ log_date: today, check_type: "dg_set", equipment_id: "", location: "", load_kva: "", fuel_level_pct: "", run_duration_mins: "", status: "ok", findings: "", corrective_actions: "", next_due_date: "", document_url: "" });
      load();
    }
    setSaving(false);
  };

  const faultCount = logs.filter(l => l.status === "fault").length;
  const overdueCount = logs.filter(l => l.next_due_date && isPast(parseISO(l.next_due_date))).length;

  const isDGCheck = form.check_type === "dg_set";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-yellow-500 shrink-0" />
          <span className="text-sm font-semibold">Electrical Safety & DG Set Logs</span>
          {faultCount > 0 && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{faultCount} Faults</Badge>}
          {overdueCount > 0 && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">{overdueCount} Overdue Checks</Badge>}
        </div>
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Add Safety Check
        </Button>
      </div>

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FL>Date *</FL>
              <Input type="date" value={form.log_date} onChange={e => setForm(f => ({ ...f, log_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <FL>Check Type *</FL>
              <select value={form.check_type} onChange={e => setForm(f => ({ ...f, check_type: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {CHECK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <FL>Status *</FL>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="ok">OK — No issues</option>
                <option value="observation">Observation noted</option>
                <option value="fault">Fault found</option>
              </select>
            </div>
            <div>
              <FL>Equipment ID / Asset Tag</FL>
              <Input value={form.equipment_id} onChange={e => setForm(f => ({ ...f, equipment_id: e.target.value }))} placeholder="e.g. DG-01 / UPS-ICU" className="h-8 text-sm" />
            </div>
            <div>
              <FL>Location</FL>
              <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Generator Room" className="h-8 text-sm" />
            </div>
            {isDGCheck && (
              <>
                <div>
                  <FL>Load (kVA)</FL>
                  <Input type="number" value={form.load_kva} onChange={e => setForm(f => ({ ...f, load_kva: e.target.value }))} placeholder="e.g. 125" className="h-8 text-sm" step="0.5" />
                </div>
                <div>
                  <FL>Fuel Level (%)</FL>
                  <Input type="number" value={form.fuel_level_pct} onChange={e => setForm(f => ({ ...f, fuel_level_pct: e.target.value }))} placeholder="0–100" className="h-8 text-sm" min="0" max="100" />
                </div>
                <div>
                  <FL>Run Duration (mins)</FL>
                  <Input type="number" value={form.run_duration_mins} onChange={e => setForm(f => ({ ...f, run_duration_mins: e.target.value }))} placeholder="e.g. 30" className="h-8 text-sm" min="0" />
                </div>
              </>
            )}
            <div>
              <FL>Next Due Date</FL>
              <Input type="date" value={form.next_due_date} onChange={e => setForm(f => ({ ...f, next_due_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <FL>Document / Certificate URL</FL>
              <Input value={form.document_url} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))} placeholder="https://…" className="h-8 text-sm" />
            </div>
            <div className="col-span-2">
              <FL>Findings</FL>
              <textarea value={form.findings} onChange={e => setForm(f => ({ ...f, findings: e.target.value }))} placeholder="Describe findings, readings…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[48px] resize-none" />
            </div>
            <div>
              <FL>Corrective Actions</FL>
              <textarea value={form.corrective_actions} onChange={e => setForm(f => ({ ...f, corrective_actions: e.target.value }))} placeholder="Actions taken or assigned…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[48px] resize-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.log_date} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Log
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Zap className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No electrical safety logs recorded.</p>
            <p className="text-xs text-muted-foreground">NABH FMS requires weekly DG set testing, monthly UPS checks, and annual earthing certification.</p>
          </div>
        ) : logs.map(l => {
          const typeLabel = CHECK_TYPES.find(t => t.value === l.check_type)?.label || l.check_type;
          const isOverdue = l.next_due_date && isPast(parseISO(l.next_due_date));
          return (
            <div key={l.id} className={cn("border rounded-lg px-3 py-2.5 flex items-start gap-3 bg-card",
              l.status === "fault" || isOverdue ? "border-red-200 bg-red-50/40 dark:bg-red-950/20" :
              l.status === "observation" ? "border-amber-200 bg-amber-50/30" : "border-border"
            )}>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{format(parseISO(l.log_date), "dd MMM yyyy")}</span>
                  <span className="text-[10px] bg-muted text-muted-foreground border border-border rounded px-1.5 py-px">{typeLabel}</span>
                  <span className={cn("text-[10px] border rounded px-1.5 py-px font-medium", STATUS_STYLES[l.status] || STATUS_STYLES.ok)}>
                    {l.status === "ok" ? "OK" : l.status === "observation" ? "Observation" : "Fault"}
                  </span>
                  {l.equipment_id && <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded">{l.equipment_id}</span>}
                  {l.location && <span className="text-[10px] text-muted-foreground">{l.location}</span>}
                  {isOverdue && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]"><AlertTriangle className="h-3 w-3 mr-0.5" />Overdue</Badge>}
                </div>
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                  {l.load_kva && <span>Load: {l.load_kva} kVA</span>}
                  {l.fuel_level_pct != null && (
                    <span className={cn("font-medium", l.fuel_level_pct < 30 ? "text-red-600" : l.fuel_level_pct < 50 ? "text-amber-600" : "text-emerald-600")}>
                      Fuel: {l.fuel_level_pct}%
                    </span>
                  )}
                  {l.run_duration_mins && <span>Run: {l.run_duration_mins} mins</span>}
                  {l.next_due_date && (
                    <span className={cn(isOverdue ? "text-red-600 font-medium" : "")}>
                      Next: {format(parseISO(l.next_due_date), "dd MMM yyyy")}
                    </span>
                  )}
                </div>
                {l.findings && <p className="text-[11px] text-muted-foreground">{l.findings}</p>}
                {l.corrective_actions && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    <span className="font-medium">Actions:</span> {l.corrective_actions}
                  </p>
                )}
              </div>
              <button onClick={() => (supabase as any).from("electrical_safety_logs").delete().eq("id", l.id).then(() => { toast({ title: "Deleted" }); load(); })}
                className="p-1 text-muted-foreground hover:text-destructive shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ElectricalSafetyTab;
