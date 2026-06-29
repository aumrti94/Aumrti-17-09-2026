import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { logNABHEvidence } from "@/lib/nabh-evidence";

const SERVICES = ["Wound dressing","IV antibiotics","Physiotherapy","Vitals monitoring","Medication administration","Catheter care","Nasogastric tube care","Oxygen therapy","Blood sugar monitoring","Palliative care"];
const FREQUENCIES = ["daily", "alternate_days", "weekly", "twice_daily"];
const PLAN_TYPES = { post_discharge: "Post-Discharge", chronic_care: "Chronic Care", palliative: "Palliative" };
const STATUS_COLORS: Record<string, string> = { active: "bg-green-100 text-green-800", completed: "bg-gray-100 text-gray-700", cancelled: "bg-red-100 text-red-800" };

interface Plan {
  id: string; patient_id: string; plan_type: string; diagnosis: string | null;
  services_needed: string[] | null; frequency: string | null; start_date: string;
  end_date: string | null; status: string; patient_name?: string;
}
interface Patient { id: string; full_name: string; uhid: string; }

const HomeCareActivePlansTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [form, setForm] = useState({
    patient_id: "", plan_type: "post_discharge", diagnosis: "",
    services_needed: [] as string[], frequency: "daily",
    start_date: new Date().toISOString().split("T")[0], end_date: "", notes: "",
  });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("home_care_plans")
      .select("*, patients!home_care_plans_patient_id_fkey(full_name)")
      .eq("hospital_id", hospitalId).eq("is_deleted", false)
      .order("created_at", { ascending: false });
    setPlans((data || []).map((p: any) => ({ ...p, patient_name: p.patients?.full_name })));
    setLoading(false);
  }, [hospitalId]);

  const searchPatients = useCallback(async (q: string) => {
    if (!hospitalId || q.length < 2) { setPatients([]); return; }
    const { data } = await supabase.from("patients").select("id, full_name, uhid")
      .eq("hospital_id", hospitalId).ilike("full_name", `%${q}%`).limit(8);
    setPatients(data || []);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { searchPatients(patientSearch); }, [patientSearch, searchPatients]);

  const toggleService = (s: string) => {
    setForm(f => ({
      ...f,
      services_needed: f.services_needed.includes(s)
        ? f.services_needed.filter(x => x !== s)
        : [...f.services_needed, s],
    }));
  };

  const generateVisits = async (planId: string, startDate: string, endDate: string, frequency: string) => {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + 30 * 86400000);
    const step = frequency === "daily" ? 1 : frequency === "alternate_days" ? 2 : frequency === "twice_daily" ? 1 : 7;
    const visits = [];
    const cur = new Date(start);
    while (cur <= end) {
      visits.push({ hospital_id: hospitalId, plan_id: planId, patient_id: form.patient_id, scheduled_date: cur.toISOString().split("T")[0], status: "scheduled" });
      cur.setDate(cur.getDate() + step);
    }
    if (visits.length > 0) await (supabase as any).from("home_care_visits").insert(visits);
  };

  const save = async () => {
    if (!form.patient_id || !form.start_date || !hospitalId) {
      toast({ title: "Patient and start date are required", variant: "destructive" }); return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await (supabase as any).from("home_care_plans").insert({
      hospital_id: hospitalId, patient_id: form.patient_id, plan_type: form.plan_type,
      diagnosis: form.diagnosis || null, services_needed: form.services_needed,
      frequency: form.frequency, start_date: form.start_date,
      end_date: form.end_date || null, notes: form.notes || null,
      created_by: user?.id,
    }).select("id").single();
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else {
      await generateVisits(data.id, form.start_date, form.end_date, form.frequency);
      await logNABHEvidence(hospitalId, "AAC.12", `Home care plan created: ${PLAN_TYPES[form.plan_type as keyof typeof PLAN_TYPES]}`);
      toast({ title: "Home care plan created + visits scheduled" });
      setShowForm(false);
      setForm({ patient_id: "", plan_type: "post_discharge", diagnosis: "", services_needed: [], frequency: "daily", start_date: new Date().toISOString().split("T")[0], end_date: "", notes: "" });
      load();
    }
    setSaving(false);
  };

  return (
    <div className="p-4 overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Home className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Active Home Care Plans</h3>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-3.5 w-3.5 mr-1" /> New Plan</Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-2">
          {plans.map(p => (
            <div key={p.id} className="p-3 border rounded-lg bg-card flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium">{p.patient_name}</p>
                <p className="text-xs text-muted-foreground">{PLAN_TYPES[p.plan_type as keyof typeof PLAN_TYPES]} | {p.frequency?.replace("_", " ")} | {p.start_date}{p.end_date ? ` → ${p.end_date}` : ""}</p>
                {p.diagnosis && <p className="text-xs text-muted-foreground mt-0.5">Dx: {p.diagnosis}</p>}
                {p.services_needed && p.services_needed.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.services_needed.map(s => <Badge key={s} variant="secondary" className="text-xs px-1.5">{s}</Badge>)}
                  </div>
                )}
              </div>
              <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_COLORS[p.status] || "bg-gray-100")}>{p.status}</span>
            </div>
          ))}
          {plans.length === 0 && <p className="text-sm text-muted-foreground">No plans yet. Create your first home care plan.</p>}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Home Care Plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Patient *</label>
              <Input placeholder="Search patient name…" value={patientSearch}
                onChange={e => setPatientSearch(e.target.value)} />
              {patients.length > 0 && (
                <div className="border rounded-md mt-1 max-h-32 overflow-y-auto">
                  {patients.map(p => (
                    <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                      onClick={() => { setForm(f => ({ ...f, patient_id: p.id })); setPatientSearch(p.full_name); setPatients([]); }}>
                      {p.full_name} <span className="text-muted-foreground text-xs">({p.uhid})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium">Plan Type</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={form.plan_type} onChange={e => setForm(f => ({ ...f, plan_type: e.target.value }))}>
                {Object.entries(PLAN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Diagnosis</label>
              <Input placeholder="Post-op wound care, CHF, etc." value={form.diagnosis}
                onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Services Needed</label>
              <div className="grid grid-cols-2 gap-1">
                {SERVICES.map(s => (
                  <label key={s} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={form.services_needed.includes(s)} onChange={() => toggleService(s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium">Frequency</label>
                <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                  value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f.replace("_", " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Start Date *</label>
                <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium">End Date</label>
                <Input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Notes</label>
              <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={2}
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Create Plan"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HomeCareActivePlansTab;
