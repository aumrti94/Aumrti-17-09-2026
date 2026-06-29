import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Plus, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface Reading {
  id: string; patient_id: string; bp_systolic: number | null; bp_diastolic: number | null;
  pulse: number | null; blood_sugar: number | null; spo2: number | null; weight_kg: number | null;
  reported_at: string; source: string; patient_name?: string;
}

interface Plan { id: string; patient_id: string; patient_name?: string; }

function hasAlert(r: Reading): boolean {
  if (r.bp_systolic && r.bp_systolic > 160) return true;
  if (r.bp_diastolic && r.bp_diastolic > 100) return true;
  if (r.spo2 && r.spo2 < 92) return true;
  if (r.blood_sugar && (r.blood_sugar > 250 || r.blood_sugar < 60)) return true;
  return false;
}

const HomeTeleMonitoringTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [readings, setReadings] = useState<Reading[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    plan_id: "", patient_id: "",
    bp_systolic: "", bp_diastolic: "", pulse: "", blood_sugar: "", spo2: "", weight_kg: "",
  });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [readRes, planRes] = await Promise.all([
      (supabase as any).from("home_tele_monitoring")
        .select("*, patients!home_tele_monitoring_patient_id_fkey(full_name)")
        .eq("hospital_id", hospitalId).eq("is_deleted", false)
        .order("reported_at", { ascending: false }).limit(50),
      (supabase as any).from("home_care_plans")
        .select("id, patient_id, patients!home_care_plans_patient_id_fkey(full_name)")
        .eq("hospital_id", hospitalId).eq("status", "active").eq("is_deleted", false),
    ]);
    setReadings((readRes.data || []).map((r: any) => ({ ...r, patient_name: r.patients?.full_name })));
    setPlans((planRes.data || []).map((p: any) => ({ ...p, patient_name: p.patients?.full_name })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handlePlanSelect = (planId: string) => {
    const plan = plans.find(p => p.id === planId);
    setForm(f => ({ ...f, plan_id: planId, patient_id: plan?.patient_id || "" }));
  };

  const save = async () => {
    if (!form.plan_id || !hospitalId) {
      toast({ title: "Select an active care plan", variant: "destructive" }); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("home_tele_monitoring").insert({
      hospital_id: hospitalId,
      patient_id: form.patient_id,
      plan_id: form.plan_id,
      bp_systolic: form.bp_systolic ? Number(form.bp_systolic) : null,
      bp_diastolic: form.bp_diastolic ? Number(form.bp_diastolic) : null,
      pulse: form.pulse ? Number(form.pulse) : null,
      blood_sugar: form.blood_sugar ? Number(form.blood_sugar) : null,
      spo2: form.spo2 ? Number(form.spo2) : null,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      source: "nurse_entry",
    });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Reading logged ✓" }); setShowForm(false); setForm({ plan_id: "", patient_id: "", bp_systolic: "", bp_diastolic: "", pulse: "", blood_sugar: "", spo2: "", weight_kg: "" }); load(); }
    setSaving(false);
  };

  return (
    <div className="p-4 overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Tele-Monitoring Readings</h3>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Log Reading</Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b text-muted-foreground text-left">
              <th className="py-2 pr-3">Patient</th>
              <th className="py-2 pr-3">BP</th>
              <th className="py-2 pr-3">Pulse</th>
              <th className="py-2 pr-3">SpO2</th>
              <th className="py-2 pr-3">Sugar</th>
              <th className="py-2 pr-3">Weight</th>
              <th className="py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {readings.map(r => (
              <tr key={r.id} className={cn("border-b", hasAlert(r) ? "bg-red-50 text-red-800" : "hover:bg-muted/30")}>
                <td className="py-2 pr-3 font-medium">
                  {hasAlert(r) && <AlertTriangle className="inline h-3 w-3 mr-1 text-red-500" />}
                  {r.patient_name}
                </td>
                <td className="py-2 pr-3">{r.bp_systolic}/{r.bp_diastolic}</td>
                <td className="py-2 pr-3">{r.pulse ?? "—"}</td>
                <td className="py-2 pr-3">{r.spo2 ? `${r.spo2}%` : "—"}</td>
                <td className="py-2 pr-3">{r.blood_sugar ? `${r.blood_sugar} mg/dL` : "—"}</td>
                <td className="py-2 pr-3">{r.weight_kg ? `${r.weight_kg} kg` : "—"}</td>
                <td className="py-2 text-muted-foreground">{new Date(r.reported_at).toLocaleString()}</td>
              </tr>
            ))}
            {readings.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">No readings yet.</td></tr>
            )}
          </tbody>
        </table>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Log Tele-Monitoring Reading</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Care Plan *</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={form.plan_id} onChange={e => handlePlanSelect(e.target.value)}>
                <option value="">— Select Active Plan —</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.patient_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium">Systolic</label><Input type="number" placeholder="120" value={form.bp_systolic} onChange={e => setForm(f => ({ ...f, bp_systolic: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">Diastolic</label><Input type="number" placeholder="80" value={form.bp_diastolic} onChange={e => setForm(f => ({ ...f, bp_diastolic: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">Pulse</label><Input type="number" placeholder="80" value={form.pulse} onChange={e => setForm(f => ({ ...f, pulse: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">SpO2 (%)</label><Input type="number" placeholder="98" value={form.spo2} onChange={e => setForm(f => ({ ...f, spo2: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">Blood Sugar (mg/dL)</label><Input type="number" placeholder="120" value={form.blood_sugar} onChange={e => setForm(f => ({ ...f, blood_sugar: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">Weight (kg)</label><Input type="number" placeholder="65.5" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HomeTeleMonitoringTab;
