import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Activity } from "lucide-react";

interface Dispatch { id: string; pickup_location: string | null; destination: string | null; complaint: string | null; status: string; }
interface TreatmentRecord {
  id: string;
  vital_bp: string | null;
  vital_pulse: number | null;
  vital_spo2: number | null;
  vital_rr: number | null;
  gcs: number | null;
  treatment: string | null;
  drugs_given: string | null;
  recorded_at: string;
}

const TransitLogTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [selectedDispatch, setSelectedDispatch] = useState<string>("");
  const [records, setRecords] = useState<TreatmentRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vital_bp: "", vital_pulse: "", vital_spo2: "", vital_rr: "", gcs: "",
    treatment: "", drugs_given: "",
  });

  const loadDispatches = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("ambulance_dispatches")
      .select("id, pickup_location, destination, complaint, status")
      .eq("hospital_id", hospitalId).eq("is_deleted", false)
      .in("status", ["dispatched", "en_route", "at_scene", "transporting"])
      .order("call_received_at", { ascending: false }).limit(20);
    setDispatches(data || []);
    if (data?.length > 0 && !selectedDispatch) setSelectedDispatch(data[0].id);
  }, [hospitalId, selectedDispatch]);

  const loadRecords = useCallback(async () => {
    if (!hospitalId || !selectedDispatch) return;
    const { data } = await (supabase as any)
      .from("ambulance_transit_treatment")
      .select("*")
      .eq("hospital_id", hospitalId).eq("dispatch_id", selectedDispatch).eq("is_deleted", false)
      .order("recorded_at");
    setRecords(data || []);
  }, [hospitalId, selectedDispatch]);

  useEffect(() => { loadDispatches(); }, [loadDispatches]);
  useEffect(() => { loadRecords(); }, [loadRecords]);

  const save = async () => {
    if (!selectedDispatch || !hospitalId) {
      toast({ title: "Select a dispatch call", variant: "destructive" }); return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("ambulance_transit_treatment").insert({
      hospital_id: hospitalId,
      dispatch_id: selectedDispatch,
      vital_bp: form.vital_bp || null,
      vital_pulse: form.vital_pulse ? Number(form.vital_pulse) : null,
      vital_spo2: form.vital_spo2 ? Number(form.vital_spo2) : null,
      vital_rr: form.vital_rr ? Number(form.vital_rr) : null,
      gcs: form.gcs ? Number(form.gcs) : null,
      treatment: form.treatment || null,
      drugs_given: form.drugs_given || null,
      recorded_by: user?.id,
    });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else {
      toast({ title: "Transit treatment recorded" });
      setForm({ vital_bp: "", vital_pulse: "", vital_spo2: "", vital_rr: "", gcs: "", treatment: "", drugs_given: "" });
      loadRecords();
    }
    setSaving(false);
  };

  const dispatch = dispatches.find(d => d.id === selectedDispatch);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">Transit Treatment Log</h3>
          <select className="ml-auto border rounded px-2 py-1 text-xs bg-background max-w-xs"
            value={selectedDispatch} onChange={e => setSelectedDispatch(e.target.value)}>
            <option value="">— Select Active Call —</option>
            {dispatches.map(d => (
              <option key={d.id} value={d.id}>
                {d.pickup_location || "Unknown"} → {d.destination || "Hospital"} ({d.status})
              </option>
            ))}
          </select>
        </div>

        {dispatch && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs">
            <p className="font-semibold text-blue-800">Active Call: {dispatch.complaint || "No complaint noted"}</p>
            <p className="text-blue-600">{dispatch.pickup_location} → {dispatch.destination}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs font-medium">BP (mmHg)</label>
            <Input placeholder="120/80" value={form.vital_bp} onChange={e => setForm(f => ({ ...f, vital_bp: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium">Pulse (bpm)</label>
            <Input type="number" placeholder="80" value={form.vital_pulse} onChange={e => setForm(f => ({ ...f, vital_pulse: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium">SpO2 (%)</label>
            <Input type="number" placeholder="98" value={form.vital_spo2} onChange={e => setForm(f => ({ ...f, vital_spo2: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium">RR (bpm)</label>
            <Input type="number" placeholder="16" value={form.vital_rr} onChange={e => setForm(f => ({ ...f, vital_rr: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium">GCS (3–15)</label>
            <Input type="number" min={3} max={15} placeholder="15" value={form.gcs} onChange={e => setForm(f => ({ ...f, gcs: e.target.value }))} />
          </div>
        </div>

        <div className="mb-3">
          <label className="text-xs font-medium">Treatment Given</label>
          <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none"
            rows={2} placeholder="IV access, oxygen, immobilization…" value={form.treatment}
            onChange={e => setForm(f => ({ ...f, treatment: e.target.value }))} />
        </div>
        <div className="mb-4">
          <label className="text-xs font-medium">Drugs Given</label>
          <Input placeholder="Morphine 2mg IV, Ondansetron 4mg IV…" value={form.drugs_given}
            onChange={e => setForm(f => ({ ...f, drugs_given: e.target.value }))} />
        </div>

        <Button size="sm" onClick={save} disabled={saving || !selectedDispatch}>
          {saving ? "Saving…" : "Log Treatment"}
        </Button>
      </div>

      {/* Record history */}
      <div className="w-64 border-l bg-muted/20 overflow-auto p-3">
        <p className="text-xs font-semibold text-muted-foreground mb-2">Treatment Records</p>
        {records.map(r => (
          <div key={r.id} className="p-2 border rounded mb-2 text-xs bg-card">
            <p className="font-medium text-muted-foreground">{new Date(r.recorded_at).toLocaleTimeString()}</p>
            {r.vital_bp && <p>BP: {r.vital_bp} | SpO2: {r.vital_spo2}%</p>}
            {r.treatment && <p className="mt-0.5 text-muted-foreground">{r.treatment}</p>}
            {r.drugs_given && <p className="text-amber-700 mt-0.5">💊 {r.drugs_given}</p>}
          </div>
        ))}
        {records.length === 0 && <p className="text-xs text-muted-foreground">No records yet.</p>}
      </div>
    </div>
  );
};

export default TransitLogTab;
