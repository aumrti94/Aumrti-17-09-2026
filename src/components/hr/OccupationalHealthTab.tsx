import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HeartPulse, Plus, Loader2, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO, isPast, differenceInDays } from "date-fns";

interface OHRecord {
  id: string;
  user_id: string;
  record_type: string;
  event_date: string;
  description: string | null;
  exposure_site: string | null;
  patient_hiv_status: string | null;
  pep_given: boolean | null;
  pep_start_date: string | null;
  vaccine_name: string | null;
  dose_number: number | null;
  next_due_date: string | null;
  fit_for_duty: boolean | null;
  restrictions: string | null;
  outcome: string | null;
  follow_up_date: string | null;
  document_url: string | null;
  staff_name?: string;
  staff_role?: string;
}

const RECORD_TYPES = [
  { value: "needle_stick",         label: "Needle Stick / Sharp Injury",    color: "bg-red-100 text-red-700 border-red-200" },
  { value: "blood_exposure",       label: "Blood / Body Fluid Exposure",    color: "bg-red-100 text-red-700 border-red-200" },
  { value: "chemical_exposure",    label: "Chemical / Hazardous Exposure",  color: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "musculoskeletal",      label: "Musculoskeletal Injury",          color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "vaccination",          label: "Staff Vaccination",               color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "pre_employment",       label: "Pre-Employment Health Check",     color: "bg-green-100 text-green-700 border-green-200" },
  { value: "periodic_checkup",     label: "Periodic Health Check",           color: "bg-green-100 text-green-700 border-green-200" },
  { value: "return_to_work",       label: "Return to Work Clearance",        color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
];

const VACCINES = ["Hepatitis B (HBsAg)", "Varicella", "MMR", "Influenza (Annual)", "COVID-19", "Typhoid", "Tetanus (TT/Td)", "Hepatitis A", "Meningococcal", "Other"];

const today = new Date().toISOString().split("T")[0];

const FL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[11px] font-medium text-muted-foreground block mb-1">{children}</label>
);

const OccupationalHealthTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [records, setRecords] = useState<OHRecord[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string; role: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [form, setForm] = useState({
    user_id: "", record_type: "needle_stick", event_date: today,
    description: "", exposure_site: "", patient_hiv_status: "", pep_given: false, pep_start_date: "",
    vaccine_name: "", dose_number: "", next_due_date: "",
    fit_for_duty: true, restrictions: "", outcome: "", follow_up_date: "", document_url: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [recRes, staffRes] = await Promise.all([
      (supabase as any).from("occupational_health_records")
        .select("*, u:users!occupational_health_records_user_id_fkey(full_name, role)")
        .eq("hospital_id", hospitalId)
        .order("event_date", { ascending: false })
        .limit(300),
      supabase.from("users").select("id, full_name, role").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name"),
    ]);
    setStaff(staffRes.data || []);
    setRecords((recRes.data || []).map((r: any) => ({ ...r, staff_name: r.u?.full_name, staff_role: r.u?.role })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const isExposure = ["needle_stick", "blood_exposure"].includes(form.record_type);
  const isVaccination = form.record_type === "vaccination";
  const isFitness = ["pre_employment", "periodic_checkup", "return_to_work"].includes(form.record_type);

  const handleSave = async () => {
    if (!form.user_id || !form.record_type || !form.event_date) return;
    setSaving(true);
    const { error } = await (supabase as any).from("occupational_health_records").insert({
      hospital_id: hospitalId,
      user_id: form.user_id,
      record_type: form.record_type,
      event_date: form.event_date,
      description: form.description || null,
      exposure_site: form.exposure_site || null,
      patient_hiv_status: form.patient_hiv_status || null,
      pep_given: isExposure ? form.pep_given : null,
      pep_start_date: isExposure && form.pep_given && form.pep_start_date ? form.pep_start_date : null,
      vaccine_name: isVaccination ? (form.vaccine_name || null) : null,
      dose_number: isVaccination && form.dose_number ? parseInt(form.dose_number) : null,
      next_due_date: form.next_due_date || null,
      fit_for_duty: isFitness ? form.fit_for_duty : null,
      restrictions: isFitness && form.restrictions ? form.restrictions : null,
      outcome: form.outcome || null,
      follow_up_date: form.follow_up_date || null,
      document_url: form.document_url || null,
      recorded_by: userId || null,
    });
    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Occupational health record saved" });
      setShowAdd(false);
      setForm({ user_id: "", record_type: "needle_stick", event_date: today, description: "", exposure_site: "", patient_hiv_status: "", pep_given: false, pep_start_date: "", vaccine_name: "", dose_number: "", next_due_date: "", fit_for_duty: true, restrictions: "", outcome: "", follow_up_date: "", document_url: "" });
      load();
    }
    setSaving(false);
  };

  const filtered = filterType === "all" ? records : records.filter(r => r.record_type === filterType);
  const exposureCount = records.filter(r => r.record_type === "needle_stick" || r.record_type === "blood_exposure").length;
  const overdueFollowups = records.filter(r => r.follow_up_date && isPast(parseISO(r.follow_up_date))).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-rose-500 shrink-0" />
          <span className="text-sm font-semibold">Occupational Health Records</span>
          <Badge variant="outline" className="text-[10px]">HRM.13 — NABH</Badge>
          {exposureCount > 0 && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{exposureCount} Exposure Events</Badge>}
          {overdueFollowups > 0 && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">{overdueFollowups} Follow-up Overdue</Badge>}
        </div>
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Add Record
        </Button>
      </div>

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0 overflow-y-auto max-h-[55vh]">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FL>Staff Member *</FL>
              <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div>
              <FL>Record Type *</FL>
              <select value={form.record_type} onChange={e => setForm(f => ({ ...f, record_type: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {RECORD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <FL>Event Date *</FL>
              <Input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} className="h-8 text-sm" />
            </div>

            {isExposure && (
              <>
                <div>
                  <FL>Exposure Site</FL>
                  <Input value={form.exposure_site} onChange={e => setForm(f => ({ ...f, exposure_site: e.target.value }))} placeholder="e.g. Left index finger" className="h-8 text-sm" />
                </div>
                <div>
                  <FL>Source Patient HIV Status</FL>
                  <select value={form.patient_hiv_status} onChange={e => setForm(f => ({ ...f, patient_hiv_status: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                    <option value="">Unknown</option>
                    <option value="negative">Negative</option>
                    <option value="positive">Positive</option>
                    <option value="not_tested">Not Tested</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 pt-4">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="pep" checked={form.pep_given} onChange={e => setForm(f => ({ ...f, pep_given: e.target.checked }))} className="h-4 w-4" />
                    <label htmlFor="pep" className="text-xs">PEP given</label>
                  </div>
                  {form.pep_given && (
                    <div className="flex-1">
                      <FL>PEP Start Date</FL>
                      <Input type="date" value={form.pep_start_date} onChange={e => setForm(f => ({ ...f, pep_start_date: e.target.value }))} className="h-8 text-sm" />
                    </div>
                  )}
                </div>
              </>
            )}

            {isVaccination && (
              <>
                <div>
                  <FL>Vaccine Name</FL>
                  <select value={form.vaccine_name} onChange={e => setForm(f => ({ ...f, vaccine_name: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                    <option value="">Select…</option>
                    {VACCINES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <FL>Dose Number</FL>
                  <Input type="number" min="1" max="5" value={form.dose_number} onChange={e => setForm(f => ({ ...f, dose_number: e.target.value }))} placeholder="1, 2, 3…" className="h-8 text-sm" />
                </div>
                <div>
                  <FL>Next Due Date</FL>
                  <Input type="date" value={form.next_due_date} onChange={e => setForm(f => ({ ...f, next_due_date: e.target.value }))} className="h-8 text-sm" />
                </div>
              </>
            )}

            {isFitness && (
              <>
                <div className="flex items-center gap-2 pt-4">
                  <input type="checkbox" id="fit" checked={form.fit_for_duty} onChange={e => setForm(f => ({ ...f, fit_for_duty: e.target.checked }))} className="h-4 w-4" />
                  <label htmlFor="fit" className="text-xs font-medium">Fit for Duty</label>
                </div>
                {!form.fit_for_duty && (
                  <div className="col-span-2">
                    <FL>Restrictions / Conditions</FL>
                    <Input value={form.restrictions} onChange={e => setForm(f => ({ ...f, restrictions: e.target.value }))} placeholder="Describe restrictions…" className="h-8 text-sm" />
                  </div>
                )}
              </>
            )}

            <div className="col-span-2">
              <FL>Description / Notes</FL>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Incident details, findings…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[48px] resize-none" />
            </div>
            <div>
              <FL>Outcome</FL>
              <Input value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))} placeholder="e.g. Recovered, Referred…" className="h-8 text-sm" />
            </div>
            <div>
              <FL>Follow-up Date</FL>
              <Input type="date" value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <FL>Document URL</FL>
              <Input value={form.document_url} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))} placeholder="https://…" className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.user_id || !form.event_date} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Record
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="h-7 text-xs border border-input rounded px-2 bg-background">
          <option value="all">All Types</option>
          {RECORD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} records</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <HeartPulse className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No occupational health records.</p>
            <p className="text-xs text-muted-foreground">NABH HRM requires tracking of needle stick injuries, staff vaccinations, pre-employment checkups, and return-to-work clearances.</p>
          </div>
        ) : filtered.map(r => {
          const typeInfo = RECORD_TYPES.find(t => t.value === r.record_type);
          const followupOverdue = r.follow_up_date && isPast(parseISO(r.follow_up_date));
          const vaccineDue = r.next_due_date && differenceInDays(parseISO(r.next_due_date), new Date()) <= 30;
          return (
            <div key={r.id} className={cn("border rounded-lg px-3 py-2.5 flex items-start gap-3 bg-card",
              followupOverdue ? "border-red-200 bg-red-50/30 dark:bg-red-950/20" :
              vaccineDue ? "border-amber-200 bg-amber-50/30" : "border-border"
            )}>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{r.staff_name || "Unknown"}</span>
                  {r.staff_role && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-px rounded">{r.staff_role.replace(/_/g, " ")}</span>}
                  <span className={cn("text-[10px] border rounded px-1.5 py-px font-medium", typeInfo?.color || "bg-muted text-muted-foreground")}>
                    {typeInfo?.label || r.record_type}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{format(parseISO(r.event_date), "dd MMM yyyy")}</span>
                  {r.pep_given && <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]">PEP Given</Badge>}
                  {r.fit_for_duty === false && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Not Fit for Duty</Badge>}
                  {followupOverdue && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]"><AlertTriangle className="h-3 w-3 mr-0.5" />Follow-up Overdue</Badge>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                  {r.vaccine_name && <span>{r.vaccine_name}{r.dose_number ? ` (Dose ${r.dose_number})` : ""}</span>}
                  {r.exposure_site && <span>Site: {r.exposure_site}</span>}
                  {r.patient_hiv_status && <span>HIV: {r.patient_hiv_status}</span>}
                  {r.outcome && <span>Outcome: {r.outcome}</span>}
                  {r.next_due_date && (
                    <span className={cn(vaccineDue ? "text-amber-600 font-medium" : "")}>
                      Next due: {format(parseISO(r.next_due_date), "dd MMM yyyy")}
                    </span>
                  )}
                </div>
                {r.description && <p className="text-[11px] text-muted-foreground">{r.description}</p>}
                {r.restrictions && <p className="text-[11px] text-red-700 dark:text-red-400">Restrictions: {r.restrictions}</p>}
              </div>
              <button onClick={() => (supabase as any).from("occupational_health_records").delete().eq("id", r.id).then(() => { toast({ title: "Deleted" }); load(); })}
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

export default OccupationalHealthTab;
