import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Plus, Printer, AlertTriangle } from "lucide-react";
import { printDocument, printHeader } from "@/lib/printUtils";

interface StaffInjury {
  id: string;
  incident_date: string;
  incident_time: string | null;
  location: string | null;
  nature_of_injury: string;
  body_part_affected: string | null;
  cause_of_accident: string | null;
  treatment_given: string | null;
  days_lost: number;
  reported_to_labour_officer: boolean;
  witness_name: string | null;
  supervisor_name: string | null;
  form4_submitted: boolean;
  employee_name?: string;
}

interface StaffOption { id: string; full_name: string; }

const StaffInjuriesTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [injuries, setInjuries] = useState<StaffInjury[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_id: "",
    incident_date: new Date().toISOString().split("T")[0],
    incident_time: "",
    location: "",
    nature_of_injury: "",
    body_part_affected: "",
    cause_of_accident: "",
    treatment_given: "",
    days_lost: 0,
    reported_to_labour_officer: false,
    witness_name: "",
    supervisor_name: "",
    form4_submitted: false,
  });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("staff_injuries")
      .select("*, users!staff_injuries_employee_id_fkey(full_name)")
      .eq("hospital_id", hospitalId)
      .order("incident_date", { ascending: false })
      .limit(200);
    setInjuries((data || []).map((r: any) => ({ ...r, employee_name: r.users?.full_name || "—" })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    const loadStaff = async () => {
      if (!hospitalId) return;
      const { data } = await supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name");
      setStaff(data || []);
    };
    load();
    loadStaff();
  }, [load, hospitalId]);

  const saveInjury = async () => {
    if (!form.nature_of_injury || !form.incident_date || !hospitalId) {
      toast({ title: "Nature of injury and date are required", variant: "destructive" }); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("staff_injuries").insert({
      hospital_id: hospitalId,
      employee_id: form.employee_id || null,
      incident_date: form.incident_date,
      incident_time: form.incident_time || null,
      location: form.location || null,
      nature_of_injury: form.nature_of_injury,
      body_part_affected: form.body_part_affected || null,
      cause_of_accident: form.cause_of_accident || null,
      treatment_given: form.treatment_given || null,
      days_lost: Number(form.days_lost) || 0,
      reported_to_labour_officer: form.reported_to_labour_officer,
      reported_at: form.reported_to_labour_officer ? new Date().toISOString() : null,
      witness_name: form.witness_name || null,
      supervisor_name: form.supervisor_name || null,
      form4_submitted: form.form4_submitted,
    });
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Injury recorded" });
      setShowForm(false);
      setForm({ employee_id: "", incident_date: new Date().toISOString().split("T")[0], incident_time: "", location: "", nature_of_injury: "", body_part_affected: "", cause_of_accident: "", treatment_given: "", days_lost: 0, reported_to_labour_officer: false, witness_name: "", supervisor_name: "", form4_submitted: false });
      load();
    }
    setSaving(false);
  };

  const printForm4 = async (injury: StaffInjury) => {
    let hospitalName = "Hospital", hospitalAddress = "";
    if (hospitalId) {
      const { data: h } = await (supabase as any).from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();
      if (h) { hospitalName = h.name; hospitalAddress = h.address || ""; }
    }
    const body = `
      ${printHeader(hospitalName, "FACTORY ACT FORM 4 — Accident Register", `<p style="font-size:11px;color:#64748b;">${hospitalAddress}</p>`)}
      <div style="margin:16px 0;padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
        <h3 style="font-size:13px;font-weight:700;color:#991b1b;margin:0 0 12px">Accident / Injury Report</h3>
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <tr><td style="padding:5px 8px;color:#6b7280;width:45%">Employee Name</td><td style="font-weight:600">${injury.employee_name || "—"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Date of Incident</td><td>${injury.incident_date ? new Date(injury.incident_date).toLocaleDateString("en-IN") : "—"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Time of Incident</td><td>${injury.incident_time || "—"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Location</td><td>${injury.location || "—"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Nature of Injury</td><td>${injury.nature_of_injury}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Body Part Affected</td><td>${injury.body_part_affected || "—"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Cause of Accident</td><td>${injury.cause_of_accident || "—"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Treatment Given</td><td>${injury.treatment_given || "—"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Days Lost</td><td>${injury.days_lost}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Witness</td><td>${injury.witness_name || "—"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Supervisor</td><td>${injury.supervisor_name || "—"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Reported to Labour Officer</td><td>${injury.reported_to_labour_officer ? "Yes" : "No"}</td></tr>
          <tr><td style="padding:5px 8px;color:#6b7280">Form 4 Submitted</td><td>${injury.form4_submitted ? "Yes" : "No"}</td></tr>
        </table>
      </div>
      <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:12px;">
        <div style="text-align:center"><div style="border-top:1px solid #334155;width:160px;padding-top:4px;">Employee Signature</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #334155;width:160px;padding-top:4px;">Supervisor Signature</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #334155;width:160px;padding-top:4px;">Management Signature</div></div>
      </div>
      <p style="margin-top:20px;font-size:10px;color:#94a3b8;">As per Section 88 of the Factories Act, 1948 — Accidents causing serious bodily injury must be reported to the Inspector of Factories within 48 hours.</p>`;
    printDocument("Form4_Injury_Report", body);
  };

  const toggleForm4 = async (injury: StaffInjury) => {
    await (supabase as any).from("staff_injuries").update({ form4_submitted: !injury.form4_submitted }).eq("id", injury.id);
    load();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-border bg-card flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <span className="text-sm font-semibold">Staff Injury / Accident Register</span>
          <span className="text-xs text-muted-foreground">(Factory Act, 1948 — Form 4)</span>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Report Injury
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
        ) : injuries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <AlertTriangle className="h-10 w-10 opacity-20" />
            <p className="text-sm">No injuries recorded</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/70 backdrop-blur z-10 border-b border-border">
              <tr className="text-[10px] font-semibold text-muted-foreground uppercase">
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Nature of Injury</th>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-center">Days Lost</th>
                <th className="px-3 py-2 text-center">Reported</th>
                <th className="px-3 py-2 text-center">Form 4</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {injuries.map(injury => (
                <tr key={injury.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {new Date(injury.incident_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-3 py-2 font-medium">{injury.employee_name}</td>
                  <td className="px-3 py-2">{injury.nature_of_injury}</td>
                  <td className="px-3 py-2 text-muted-foreground">{injury.location || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", injury.days_lost > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700")}>
                      {injury.days_lost}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {injury.reported_to_labour_officer
                      ? <span className="text-[10px] text-green-600 font-semibold">Yes</span>
                      : <span className="text-[10px] text-muted-foreground">No</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => toggleForm4(injury)} className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors", injury.form4_submitted ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-muted text-muted-foreground hover:bg-amber-100 hover:text-amber-700")}>
                      {injury.form4_submitted ? "✓ Submitted" : "Pending"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => printForm4(injury)}>
                      <Printer className="h-3 w-3" /> Form 4
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">Report Staff Injury / Accident</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Employee</label>
                <select
                  className="w-full h-8 mt-1 rounded-md border border-input bg-background px-2 text-xs"
                  value={form.employee_id}
                  onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                >
                  <option value="">Select employee…</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Incident Date *</label>
                <Input type="date" value={form.incident_date} onChange={e => setForm(f => ({ ...f, incident_date: e.target.value }))} className="h-8 mt-1 text-xs" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Time of Incident</label>
                <Input type="time" value={form.incident_time} onChange={e => setForm(f => ({ ...f, incident_time: e.target.value }))} className="h-8 mt-1 text-xs" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Location</label>
                <Input placeholder="Ward / OT / Pharmacy…" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="h-8 mt-1 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nature of Injury *</label>
              <Input placeholder="e.g. Needle-stick injury, Fall, Chemical exposure" value={form.nature_of_injury} onChange={e => setForm(f => ({ ...f, nature_of_injury: e.target.value }))} className="h-8 mt-1 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Body Part Affected</label>
                <Input placeholder="e.g. Right hand, Left foot" value={form.body_part_affected} onChange={e => setForm(f => ({ ...f, body_part_affected: e.target.value }))} className="h-8 mt-1 text-xs" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Days Lost from Work</label>
                <Input type="number" min={0} value={form.days_lost} onChange={e => setForm(f => ({ ...f, days_lost: Number(e.target.value) }))} className="h-8 mt-1 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Cause of Accident</label>
              <Input placeholder="Describe the cause…" value={form.cause_of_accident} onChange={e => setForm(f => ({ ...f, cause_of_accident: e.target.value }))} className="h-8 mt-1 text-xs" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Treatment Given</label>
              <Input placeholder="First aid, ER treatment, hospitalization…" value={form.treatment_given} onChange={e => setForm(f => ({ ...f, treatment_given: e.target.value }))} className="h-8 mt-1 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Witness Name</label>
                <Input value={form.witness_name} onChange={e => setForm(f => ({ ...f, witness_name: e.target.value }))} className="h-8 mt-1 text-xs" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Supervisor Name</label>
                <Input value={form.supervisor_name} onChange={e => setForm(f => ({ ...f, supervisor_name: e.target.value }))} className="h-8 mt-1 text-xs" />
              </div>
            </div>
            <div className="flex items-center gap-6 pt-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={form.reported_to_labour_officer} onChange={e => setForm(f => ({ ...f, reported_to_labour_officer: e.target.checked }))} className="rounded" />
                Reported to Labour Officer
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={form.form4_submitted} onChange={e => setForm(f => ({ ...f, form4_submitted: e.target.checked }))} className="rounded" />
                Form 4 Submitted
              </label>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={saveInjury} disabled={saving} className="text-xs">
              {saving ? "Saving…" : "Save Record"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StaffInjuriesTab;
