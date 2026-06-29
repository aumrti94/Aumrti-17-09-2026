import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Syringe, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const ADULT_VACCINES = [
  { name: "Influenza (Flu)", frequency: "Annual", eligible: "All adults" },
  { name: "Td / Tdap Booster", frequency: "Every 10 years", eligible: "All adults" },
  { name: "Hepatitis B (3-dose)", frequency: "Once (if not vaccinated)", eligible: "Unvaccinated adults" },
  { name: "Pneumococcal (PCV15/PPSV23)", frequency: "Once + booster at 65", eligible: "≥65 yrs or high-risk" },
  { name: "HPV (2-3 dose)", frequency: "Once (if 9-45 yrs)", eligible: "Females / recommended for males" },
  { name: "COVID-19 Booster", frequency: "As per national schedule", eligible: "All adults" },
  { name: "Hepatitis A (2-dose)", frequency: "Once", eligible: "At-risk adults / travellers" },
  { name: "MMR", frequency: "1-2 doses (if not immune)", eligible: "Adults without immunity" },
  { name: "Varicella (Chickenpox)", frequency: "2 doses (if not immune)", eligible: "Adults without immunity" },
];

const STATUS_STYLES: Record<string, string> = {
  due: "bg-blue-100 text-blue-800",
  given: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  deferred: "bg-gray-100 text-gray-600",
};

interface Dose {
  id: string; vaccine_name: string; due_date: string | null;
  given_date: string | null; status: string; batch_no: string | null; site: string | null;
}
interface Patient { id: string; full_name: string; uhid: string; }

const AdultImmunizationTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>("");
  const [patientSearch, setPatientSearch] = useState("");
  const [doses, setDoses] = useState<Dose[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addForm, setAddForm] = useState({ vaccine_name: "", due_date: "", status: "due" });

  const searchPatients = useCallback(async (q: string) => {
    if (!hospitalId || q.length < 2) { setPatients([]); return; }
    const { data } = await supabase.from("patients").select("id, full_name, uhid")
      .eq("hospital_id", hospitalId).ilike("full_name", `%${q}%`).limit(8);
    setPatients(data || []);
  }, [hospitalId]);

  const loadDoses = useCallback(async () => {
    if (!hospitalId || !selectedPatient) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("adult_immunization_schedule")
      .select("*").eq("hospital_id", hospitalId).eq("patient_id", selectedPatient)
      .eq("is_deleted", false).order("vaccine_name");
    setDoses(data || []);
    setLoading(false);
  }, [hospitalId, selectedPatient]);

  useEffect(() => { searchPatients(patientSearch); }, [patientSearch, searchPatients]);
  useEffect(() => { loadDoses(); }, [loadDoses]);

  const selectPatient = (p: Patient) => {
    setSelectedPatient(p.id); setPatientSearch(p.full_name); setPatients([]);
  };

  const markGiven = async (dose: Dose) => {
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase as any).from("adult_immunization_schedule").update({
      given_date: new Date().toISOString().split("T")[0], status: "given", given_by: user?.id,
    }).eq("id", dose.id);
    toast({ title: `${dose.vaccine_name} marked as given ✓` });
    loadDoses();
  };

  const addVaccine = async () => {
    if (!addForm.vaccine_name || !selectedPatient || !hospitalId) {
      toast({ title: "Vaccine name and patient required", variant: "destructive" }); return;
    }
    setSaving(true);
    await (supabase as any).from("adult_immunization_schedule").insert({
      hospital_id: hospitalId, patient_id: selectedPatient,
      vaccine_name: addForm.vaccine_name, due_date: addForm.due_date || null, status: addForm.status,
    });
    toast({ title: "Vaccine added to schedule" });
    setShowAdd(false); setAddForm({ vaccine_name: "", due_date: "", status: "due" }); loadDoses();
    setSaving(false);
  };

  const initSchedule = async () => {
    if (!selectedPatient || !hospitalId) { toast({ title: "Select a patient first", variant: "destructive" }); return; }
    const today = new Date().toISOString().split("T")[0];
    const rows = ADULT_VACCINES.map(v => ({
      hospital_id: hospitalId, patient_id: selectedPatient,
      vaccine_name: v.name, due_date: today, status: "due",
    }));
    await (supabase as any).from("adult_immunization_schedule").insert(rows);
    toast({ title: `${rows.length} vaccines added to schedule` });
    loadDoses();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Patient selector */}
      <div className="p-3 border-b bg-card flex items-center gap-3">
        <Syringe className="h-4 w-4 text-primary flex-shrink-0" />
        <div className="flex-1 relative">
          <Input placeholder="Search patient…" value={patientSearch} onChange={e => setPatientSearch(e.target.value)} />
          {patients.length > 0 && (
            <div className="absolute z-50 bg-white border rounded shadow-lg w-full mt-1 max-h-40 overflow-y-auto">
              {patients.map(p => (
                <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => selectPatient(p)}>
                  {p.full_name} <span className="text-muted-foreground text-xs">({p.uhid})</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedPatient && (
          <>
            <Button size="sm" variant="outline" onClick={initSchedule}>Init Full Schedule</Button>
            <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add Vaccine</Button>
          </>
        )}
      </div>

      {/* Vaccine list */}
      <div className="flex-1 overflow-auto p-3">
        {!selectedPatient ? (
          <p className="text-sm text-muted-foreground">Search and select a patient to view their immunization schedule.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-2">
            {doses.map(d => (
              <div key={d.id} className="flex items-center gap-3 p-3 border rounded-lg bg-card">
                <div className="flex-1">
                  <p className="text-sm font-medium">{d.vaccine_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.due_date ? `Due: ${d.due_date}` : "No due date"}
                    {d.given_date && ` | Given: ${d.given_date}`}
                    {d.batch_no && ` | Batch: ${d.batch_no}`}
                  </p>
                </div>
                <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[d.status] || "")}>{d.status}</span>
                {d.status !== "given" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markGiven(d)}>
                    Mark Given
                  </Button>
                )}
              </div>
            ))}
            {doses.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Syringe className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No vaccines scheduled. Click "Init Full Schedule" or "Add Vaccine".</p>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Vaccine</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Vaccine *</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={addForm.vaccine_name} onChange={e => setAddForm(f => ({ ...f, vaccine_name: e.target.value }))}>
                <option value="">— Select —</option>
                {ADULT_VACCINES.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Due Date</label>
              <Input type="date" value={addForm.due_date} onChange={e => setAddForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" onClick={addVaccine} disabled={saving}>{saving ? "Saving…" : "Add"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdultImmunizationTab;
