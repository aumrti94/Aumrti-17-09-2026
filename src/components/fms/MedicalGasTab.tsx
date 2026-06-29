import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Wind, Plus, Loader2, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface GasLog {
  id: string;
  log_date: string;
  gas_type: string;
  source_type: string;
  pressure_bar: number | null;
  volume_liters: number | null;
  cylinders_in: number;
  cylinders_out: number;
  supplier: string | null;
  alarm_triggered: boolean;
  alarm_details: string | null;
  pipeline_checked: boolean;
  next_inspection_date: string | null;
  remarks: string | null;
}

const GAS_TYPES = [
  { value: "oxygen",          label: "Oxygen (O₂)",         color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "nitrous_oxide",   label: "Nitrous Oxide (N₂O)", color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "compressed_air",  label: "Compressed Air",       color: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "co2",             label: "Carbon Dioxide (CO₂)", color: "bg-green-100 text-green-700 border-green-200" },
  { value: "nitrogen",        label: "Nitrogen (N₂)",        color: "bg-amber-100 text-amber-700 border-amber-200" },
];

const SOURCE_TYPES = [
  { value: "cylinder",   label: "Cylinders" },
  { value: "manifold",   label: "Manifold Bank" },
  { value: "psa_plant",  label: "PSA Oxygen Plant" },
  { value: "pipeline",   label: "Liquid/Pipeline" },
];

const today = new Date().toISOString().split("T")[0];

const FL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[11px] font-medium text-muted-foreground block mb-1">{children}</label>
);

const MedicalGasTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [logs, setLogs] = useState<GasLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterGas, setFilterGas] = useState("all");
  const [form, setForm] = useState({
    log_date: today, gas_type: "oxygen", source_type: "cylinder",
    pressure_bar: "", volume_liters: "", cylinders_in: "", cylinders_out: "",
    supplier: "", alarm_triggered: false, alarm_details: "", pipeline_checked: true,
    next_inspection_date: "", remarks: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("medical_gas_logs")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("log_date", { ascending: false })
      .limit(300);
    setLogs(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.log_date || !form.gas_type) return;
    setSaving(true);
    const { error } = await (supabase as any).from("medical_gas_logs").insert({
      hospital_id: hospitalId,
      log_date: form.log_date,
      gas_type: form.gas_type,
      source_type: form.source_type,
      pressure_bar: form.pressure_bar ? parseFloat(form.pressure_bar) : null,
      volume_liters: form.volume_liters ? parseFloat(form.volume_liters) : null,
      cylinders_in: parseInt(form.cylinders_in) || 0,
      cylinders_out: parseInt(form.cylinders_out) || 0,
      supplier: form.supplier || null,
      alarm_triggered: form.alarm_triggered,
      alarm_details: form.alarm_details || null,
      pipeline_checked: form.pipeline_checked,
      next_inspection_date: form.next_inspection_date || null,
      remarks: form.remarks || null,
      recorded_by: userId || null,
    });
    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Gas log saved" });
      setShowAdd(false);
      setForm({ log_date: today, gas_type: "oxygen", source_type: "cylinder", pressure_bar: "", volume_liters: "", cylinders_in: "", cylinders_out: "", supplier: "", alarm_triggered: false, alarm_details: "", pipeline_checked: true, next_inspection_date: "", remarks: "" });
      load();
    }
    setSaving(false);
  };

  const filtered = filterGas === "all" ? logs : logs.filter(l => l.gas_type === filterGas);
  const alarmCount = logs.filter(l => l.alarm_triggered).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <Wind className="h-4 w-4 text-blue-500 shrink-0" />
          <span className="text-sm font-semibold">Medical Gas Pipeline Monitoring</span>
          {alarmCount > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />{alarmCount} Alarm Events
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Log Gas Reading
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
              <FL>Gas Type *</FL>
              <select value={form.gas_type} onChange={e => setForm(f => ({ ...f, gas_type: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {GAS_TYPES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <FL>Source Type</FL>
              <select value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <FL>Pipeline Pressure (bar)</FL>
              <Input type="number" value={form.pressure_bar} onChange={e => setForm(f => ({ ...f, pressure_bar: e.target.value }))} placeholder="e.g. 4.0" className="h-8 text-sm" step="0.1" />
            </div>
            <div>
              <FL>Volume / Consumption (L)</FL>
              <Input type="number" value={form.volume_liters} onChange={e => setForm(f => ({ ...f, volume_liters: e.target.value }))} placeholder="e.g. 1200" className="h-8 text-sm" />
            </div>
            <div>
              <FL>Supplier</FL>
              <Input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="e.g. INOX Air Products" className="h-8 text-sm" />
            </div>
            <div>
              <FL>Cylinders Received</FL>
              <Input type="number" value={form.cylinders_in} onChange={e => setForm(f => ({ ...f, cylinders_in: e.target.value }))} placeholder="0" className="h-8 text-sm" min="0" />
            </div>
            <div>
              <FL>Cylinders Returned</FL>
              <Input type="number" value={form.cylinders_out} onChange={e => setForm(f => ({ ...f, cylinders_out: e.target.value }))} placeholder="0" className="h-8 text-sm" min="0" />
            </div>
            <div>
              <FL>Next Inspection Date</FL>
              <Input type="date" value={form.next_inspection_date} onChange={e => setForm(f => ({ ...f, next_inspection_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="flex items-center gap-3 pt-4">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="pipeline_checked" checked={form.pipeline_checked} onChange={e => setForm(f => ({ ...f, pipeline_checked: e.target.checked }))} className="h-4 w-4" />
                <label htmlFor="pipeline_checked" className="text-xs">Pipeline inspected OK</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="alarm_trig" checked={form.alarm_triggered} onChange={e => setForm(f => ({ ...f, alarm_triggered: e.target.checked }))} className="h-4 w-4 accent-red-500" />
                <label htmlFor="alarm_trig" className="text-xs text-red-600">Alarm triggered</label>
              </div>
            </div>
            {form.alarm_triggered && (
              <div className="col-span-2">
                <FL>Alarm Details</FL>
                <Input value={form.alarm_details} onChange={e => setForm(f => ({ ...f, alarm_details: e.target.value }))} placeholder="Describe alarm event and response…" className="h-8 text-sm" />
              </div>
            )}
            <div className="col-span-3">
              <FL>Remarks</FL>
              <textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Any additional notes…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[48px] resize-none" />
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

      <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
        <select value={filterGas} onChange={e => setFilterGas(e.target.value)} className="h-7 text-xs border border-input rounded px-2 bg-background">
          <option value="all">All Gas Types</option>
          {GAS_TYPES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} logs</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Wind className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No gas logs recorded.</p>
            <p className="text-xs text-muted-foreground">NABH FMS requires daily monitoring of medical gas pressures and cylinder inventory.</p>
          </div>
        ) : filtered.map(l => {
          const gasInfo = GAS_TYPES.find(g => g.value === l.gas_type);
          return (
            <div key={l.id} className={cn("border rounded-lg px-3 py-2.5 flex items-start gap-3 bg-card",
              l.alarm_triggered ? "border-red-200 bg-red-50/40 dark:bg-red-950/20" : "border-border"
            )}>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{format(parseISO(l.log_date), "dd MMM yyyy")}</span>
                  <span className={cn("text-[10px] border rounded px-1.5 py-px font-medium", gasInfo?.color)}>
                    {gasInfo?.label || l.gas_type}
                  </span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-px rounded">
                    {SOURCE_TYPES.find(s => s.value === l.source_type)?.label || l.source_type}
                  </span>
                  {l.alarm_triggered && (
                    <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">
                      <AlertTriangle className="h-3 w-3 mr-0.5" /> Alarm
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                  {l.pressure_bar && <span>Pressure: <span className="font-medium text-foreground">{l.pressure_bar} bar</span></span>}
                  {l.volume_liters && <span>Volume: <span className="font-medium text-foreground">{l.volume_liters} L</span></span>}
                  {(l.cylinders_in > 0 || l.cylinders_out > 0) && (
                    <span>Cylinders: +{l.cylinders_in} in / {l.cylinders_out} out</span>
                  )}
                  {l.supplier && <span>{l.supplier}</span>}
                </div>
                {l.alarm_details && <p className="text-[11px] text-red-700 dark:text-red-400">{l.alarm_details}</p>}
                {l.remarks && <p className="text-[11px] text-muted-foreground">{l.remarks}</p>}
              </div>
              <button onClick={() => (supabase as any).from("medical_gas_logs").delete().eq("id", l.id).then(() => { toast({ title: "Deleted" }); load(); })}
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

export default MedicalGasTab;
