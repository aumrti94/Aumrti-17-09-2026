import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { autoChargeService, MODULE_HOME_CARE } from "@/lib/serviceBilling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800", completed: "bg-green-100 text-green-800",
  missed: "bg-red-100 text-red-800", rescheduled: "bg-amber-100 text-amber-800",
};

interface Visit {
  id: string; scheduled_date: string; status: string; patient_id: string;
  nurse_id: string | null; vital_bp: string | null; vital_pulse: number | null;
  wound_condition: string | null; nurse_notes: string | null;
  patient_name?: string; plan_type?: string;
}

const HomeCareVisitTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [filter, setFilter] = useState<"today" | "week" | "overdue">("today");
  const [loading, setLoading] = useState(true);
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [saving, setSaving] = useState(false);
  const [recordForm, setRecordForm] = useState({
    vital_bp: "", vital_pulse: "", vital_temp: "", vital_spo2: "",
    wound_condition: "na", services_done: [] as string[],
    patient_feedback: "", nurse_notes: "",
  });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
    let query = (supabase as any)
      .from("home_care_visits")
      .select("*, patients!home_care_visits_patient_id_fkey(full_name), home_care_plans!home_care_visits_plan_id_fkey(plan_type)")
      .eq("hospital_id", hospitalId).eq("is_deleted", false);
    if (filter === "today") query = query.eq("scheduled_date", today);
    else if (filter === "week") query = query.gte("scheduled_date", today).lte("scheduled_date", weekEnd);
    else query = query.lt("scheduled_date", today).eq("status", "scheduled");
    const { data } = await query.order("scheduled_date");
    setVisits((data || []).map((v: any) => ({ ...v, patient_name: v.patients?.full_name, plan_type: v.home_care_plans?.plan_type })));
    setLoading(false);
  }, [hospitalId, filter]);

  useEffect(() => { load(); }, [load]);

  const openRecord = (visit: Visit) => {
    setSelectedVisit(visit);
    setRecordForm({ vital_bp: visit.vital_bp || "", vital_pulse: String(visit.vital_pulse || ""), vital_temp: "", vital_spo2: "", wound_condition: visit.wound_condition || "na", services_done: [], patient_feedback: "", nurse_notes: visit.nurse_notes || "" });
  };

  const saveRecord = async () => {
    if (!selectedVisit || !hospitalId) return;
    setSaving(true);
    const { error } = await (supabase as any).from("home_care_visits").update({
      visit_date: new Date().toISOString().split("T")[0],
      status: "completed",
      vital_bp: recordForm.vital_bp || null,
      vital_pulse: recordForm.vital_pulse ? Number(recordForm.vital_pulse) : null,
      vital_temp: recordForm.vital_temp ? Number(recordForm.vital_temp) : null,
      vital_spo2: recordForm.vital_spo2 ? Number(recordForm.vital_spo2) : null,
      wound_condition: recordForm.wound_condition,
      services_done: recordForm.services_done,
      patient_feedback: recordForm.patient_feedback || null,
      nurse_notes: recordForm.nurse_notes || null,
    }).eq("id", selectedVisit.id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else {
      // Auto-bill the home care visit
      if (hospitalId && selectedVisit.patient_id) {
        autoChargeService({
          hospitalId,
          patientId: selectedVisit.patient_id,
          serviceName: `Home Care Visit — ${(recordForm.services_done || []).join(", ") || "Nursing Visit"}`,
          serviceModule: MODULE_HOME_CARE,
          sourceTable:   "home_care_visits",
          sourceId:      selectedVisit.id,
          serviceDate:   new Date().toISOString().split("T")[0],
        }).catch(() => {});
      }
      toast({ title: "Visit recorded ✓" }); setSelectedVisit(null); load();
    }
    setSaving(false);
  };

  const markMissed = async (visitId: string) => {
    await (supabase as any).from("home_care_visits").update({ status: "missed" }).eq("id", visitId);
    load();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-2 p-3 border-b">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        {(["today", "week", "overdue"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
              filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted")}>
            {f === "today" ? "Today" : f === "week" ? "This Week" : "Overdue"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            {visits.map(v => (
              <div key={v.id} className="p-3 border rounded-lg bg-card flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">{v.patient_name}</p>
                  <p className="text-xs text-muted-foreground">{v.scheduled_date} | {v.plan_type?.replace("_", " ")}</p>
                </div>
                <Badge className={cn("text-xs", STATUS_COLORS[v.status] || "")}>{v.status}</Badge>
                {v.status === "scheduled" && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openRecord(v)}>
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Record
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => markMissed(v.id)}>
                      Missed
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {visits.length === 0 && <p className="text-sm text-muted-foreground">No visits for this filter.</p>}
          </>
        )}
      </div>

      <Sheet open={!!selectedVisit} onOpenChange={() => setSelectedVisit(null)}>
        <SheetContent side="right" className="w-96 overflow-y-auto">
          <SheetHeader><SheetTitle>Record Visit — {selectedVisit?.patient_name}</SheetTitle></SheetHeader>
          <div className="space-y-3 mt-4">
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium">BP (mmHg)</label><Input placeholder="120/80" value={recordForm.vital_bp} onChange={e => setRecordForm(f => ({ ...f, vital_bp: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">Pulse</label><Input type="number" placeholder="80" value={recordForm.vital_pulse} onChange={e => setRecordForm(f => ({ ...f, vital_pulse: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">Temp (°F)</label><Input type="number" placeholder="98.6" value={recordForm.vital_temp} onChange={e => setRecordForm(f => ({ ...f, vital_temp: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">SpO2 (%)</label><Input type="number" placeholder="98" value={recordForm.vital_spo2} onChange={e => setRecordForm(f => ({ ...f, vital_spo2: e.target.value }))} /></div>
            </div>
            <div>
              <label className="text-xs font-medium">Wound Condition</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" value={recordForm.wound_condition} onChange={e => setRecordForm(f => ({ ...f, wound_condition: e.target.value }))}>
                <option value="na">N/A</option>
                <option value="healing">Healing</option>
                <option value="static">Static</option>
                <option value="deteriorating">Deteriorating</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Patient Feedback</label>
              <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={2} value={recordForm.patient_feedback} onChange={e => setRecordForm(f => ({ ...f, patient_feedback: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Nurse Notes</label>
              <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={3} value={recordForm.nurse_notes} onChange={e => setRecordForm(f => ({ ...f, nurse_notes: e.target.value }))} />
            </div>
            <Button className="w-full" onClick={saveRecord} disabled={saving}>{saving ? "Saving…" : "Complete Visit"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default HomeCareVisitTab;
