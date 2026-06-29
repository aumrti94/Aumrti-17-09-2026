import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Droplets, Plus, RefreshCw, Loader2 } from "lucide-react";

interface Props {
  admissionId: string;
  hospitalId: string;
}

interface IVFluid {
  id: string;
  fluid_name: string;
  fluid_type: string;
  rate_ml_per_hour: number | null;
  total_volume_ml: number | null;
  volume_infused_ml: number;
  started_at: string | null;
  expected_end_at: string | null;
  status: string;
}

interface OutputEntry {
  id: string;
  type: string;
  volume_ml: number;
  recorded_at: string;
  urine_output_ml?: number;
}

const fmt = (n: number) => n.toLocaleString("en-IN");

const IOChartTab: React.FC<Props> = ({ admissionId, hospitalId }) => {
  const { toast } = useToast();
  const [ivFluids, setIvFluids] = useState<IVFluid[]>([]);
  const [urineToday, setUrineToday] = useState(0);
  const [outputs, setOutputs] = useState<{ type: string; volume: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // Add IV form
  const [showAddIV, setShowAddIV] = useState(false);
  const [ivForm, setIvForm] = useState({ fluid_name: "", rate_ml_per_hour: "", total_volume_ml: "" });
  const [savingIV, setSavingIV] = useState(false);

  // Add output form
  const [showAddOutput, setShowAddOutput] = useState(false);
  const [outputForm, setOutputForm] = useState({ type: "drain", volume: "" });
  const [savingOutput, setSavingOutput] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true);
    const [ivRes, vitalsRes] = await Promise.all([
      (supabase as any).from("iv_fluids")
        .select("*")
        .eq("admission_id", admissionId)
        .order("created_at", { ascending: false }),
      supabase.from("ipd_vitals")
        .select("urine_output_ml, recorded_at")
        .eq("admission_id", admissionId)
        .gte("recorded_at", `${today}T00:00:00`)
        .order("recorded_at", { ascending: true }),
    ]);

    setIvFluids(ivRes.data || []);

    const urine = (vitalsRes.data || []).reduce(
      (sum: number, v: any) => sum + (v.urine_output_ml || 0), 0
    );
    setUrineToday(urine);
    setLoading(false);
  }, [admissionId, today]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const addIV = async () => {
    if (!ivForm.fluid_name.trim()) return;
    setSavingIV(true);
    const rate = parseInt(ivForm.rate_ml_per_hour) || null;
    const total = parseInt(ivForm.total_volume_ml) || null;
    const now = new Date().toISOString();
    const expected = rate && total ? new Date(Date.now() + (total / rate) * 3600000).toISOString() : null;

    const { error } = await (supabase as any).from("iv_fluids").insert({
      hospital_id: hospitalId,
      admission_id: admissionId,
      fluid_name: ivForm.fluid_name,
      rate_ml_per_hour: rate,
      total_volume_ml: total,
      started_at: now,
      expected_end_at: expected,
      status: "running",
    });

    setSavingIV(false);
    if (error) {
      toast({ title: "Failed to add IV", description: error.message, variant: "destructive" });
      return;
    }
    setIvForm({ fluid_name: "", rate_ml_per_hour: "", total_volume_ml: "" });
    setShowAddIV(false);
    toast({ title: "IV fluid added" });
    load();
  };

  const stopIV = async (id: string) => {
    await (supabase as any).from("iv_fluids").update({ status: "completed" }).eq("id", id);
    load();
  };

  const addOutput = async () => {
    if (!outputForm.volume) return;
    setSavingOutput(true);
    setOutputs((prev) => [...prev, { type: outputForm.type, volume: parseInt(outputForm.volume) }]);
    setSavingOutput(false);
    setOutputForm({ type: "drain", volume: "" });
    setShowAddOutput(false);
    toast({ title: "Output recorded" });
  };

  const totalIntake = ivFluids
    .filter((f) => f.status === "running" || f.status === "completed")
    .reduce((sum, f) => sum + (f.volume_infused_ml || f.rate_ml_per_hour || 0), 0);

  const totalOutput = urineToday + outputs.reduce((sum, o) => sum + o.volume, 0);
  const balance = totalIntake - totalOutput;

  const statusColor = (s: string) =>
    s === "running" ? "bg-blue-100 text-blue-700" :
    s === "completed" ? "bg-emerald-100 text-emerald-700" :
    s === "on_hold" ? "bg-amber-100 text-amber-700" :
    "bg-muted text-muted-foreground";

  return (
    <div className="p-4 space-y-4">
      {/* Fluid Balance Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
          <p className="text-[11px] text-blue-600 font-semibold uppercase">Total Intake</p>
          <p className="text-xl font-bold text-blue-700">{fmt(totalIntake)} mL</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
          <p className="text-[11px] text-amber-600 font-semibold uppercase">Total Output</p>
          <p className="text-xl font-bold text-amber-700">{fmt(totalOutput)} mL</p>
        </div>
        <div className={`border rounded-lg p-3 text-center ${balance >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          <p className={`text-[11px] font-semibold uppercase ${balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>Balance</p>
          <p className={`text-xl font-bold ${balance >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {balance >= 0 ? "+" : ""}{fmt(balance)} mL
          </p>
        </div>
      </div>

      {/* IV Fluids (Intake) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Droplets className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-semibold text-foreground">IV Fluids (Intake)</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={load} title="Refresh">
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Button size="sm" onClick={() => setShowAddIV(!showAddIV)} className="h-7 text-xs gap-1">
              <Plus className="h-3 w-3" /> Add IV
            </Button>
          </div>
        </div>

        {showAddIV && (
          <div className="bg-muted/50 rounded-lg p-3 mb-2 space-y-2 border border-border">
            <Input value={ivForm.fluid_name} onChange={(e) => setIvForm({ ...ivForm, fluid_name: e.target.value })}
              placeholder="Fluid name (e.g. NS 500mL, RL, D5%)" className="h-8 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" value={ivForm.rate_ml_per_hour} onChange={(e) => setIvForm({ ...ivForm, rate_ml_per_hour: e.target.value })}
                placeholder="Rate (mL/hr)" className="h-8 text-sm" />
              <Input type="number" value={ivForm.total_volume_ml} onChange={(e) => setIvForm({ ...ivForm, total_volume_ml: e.target.value })}
                placeholder="Total volume (mL)" className="h-8 text-sm" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addIV} disabled={savingIV || !ivForm.fluid_name.trim()} className="flex-1 h-7 text-xs">
                {savingIV && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Start IV
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddIV(false)} className="h-7 text-xs">Cancel</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : ivFluids.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No IV fluids ordered.</p>
        ) : (
          <div className="space-y-1.5">
            {ivFluids.map((f) => (
              <div key={f.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{f.fluid_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {f.rate_ml_per_hour ? `${f.rate_ml_per_hour} mL/hr` : "—"}&nbsp;&nbsp;
                    {f.total_volume_ml ? `Total: ${f.total_volume_ml} mL` : ""}
                    {f.expected_end_at ? ` · ETA ${new Date(f.expected_end_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColor(f.status)}`}>{f.status}</span>
                  {f.status === "running" && (
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => stopIV(f.id)}>Stop</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Output */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-foreground">Output</span>
          <Button size="sm" onClick={() => setShowAddOutput(!showAddOutput)} className="h-7 text-xs gap-1">
            <Plus className="h-3 w-3" /> Add Output
          </Button>
        </div>

        {showAddOutput && (
          <div className="bg-muted/50 rounded-lg p-3 mb-2 space-y-2 border border-border">
            <select value={outputForm.type} onChange={(e) => setOutputForm({ ...outputForm, type: e.target.value })}
              className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
              <option value="drain">Drain</option>
              <option value="vomitus">Vomitus</option>
              <option value="nasogastric">Nasogastric</option>
              <option value="surgical">Surgical (blood loss)</option>
              <option value="other">Other</option>
            </select>
            <Input type="number" value={outputForm.volume} onChange={(e) => setOutputForm({ ...outputForm, volume: e.target.value })}
              placeholder="Volume (mL)" className="h-8 text-sm" />
            <div className="flex gap-2">
              <Button size="sm" onClick={addOutput} disabled={savingOutput || !outputForm.volume} className="flex-1 h-7 text-xs">Record</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddOutput(false)} className="h-7 text-xs">Cancel</Button>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
            <p className="text-sm font-medium text-foreground">Urine Output (today)</p>
            <p className="text-sm font-bold tabular-nums">{fmt(urineToday)} mL</p>
          </div>
          {outputs.map((o, i) => (
            <div key={i} className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
              <p className="text-sm font-medium text-foreground capitalize">{o.type}</p>
              <p className="text-sm font-bold tabular-nums">{fmt(o.volume)} mL</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default IOChartTab;
