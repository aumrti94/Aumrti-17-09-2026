import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Plus, HeartPulse, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { logNABHEvidence } from "@/lib/nabh-evidence";

interface Event {
  id: string; event_datetime: string; location: string; event_type: string;
  rosc_achieved: boolean | null; outcome: string | null;
  patient_name?: string; has_audit: boolean;
}
interface Patient { id: string; full_name: string; }

const EVENT_TYPES: Record<string, string> = {
  cardiac_arrest: "Cardiac Arrest", respiratory_arrest: "Respiratory Arrest",
  anaphylaxis: "Anaphylaxis", status_epilepticus: "Status Epilepticus", other: "Other",
};

const CodeBlueAuditTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [events, setEvents] = useState<Event[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEventForm, setShowEventForm] = useState(false);
  const [auditEventId, setAuditEventId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [eventForm, setEventForm] = useState({
    patient_id: "", event_datetime: new Date().toISOString().slice(0, 16),
    location: "", event_type: "cardiac_arrest", initial_rhythm: "",
    rosc_achieved: "", rosc_time_min: "", outcome: "",
  });

  const [auditForm, setAuditForm] = useState({
    mdt_doctor: false, mdt_nurse: false, mdt_pharmacist: false, mdt_intensivist: false,
    response_time_min: "", cpr_quality: "adequate", defibrillation_time: "",
    protocol_followed: true, drug_errors: "", equipment_issues: "",
    good_practice_noted: "", areas_for_improvement: "",
    root_cause: "", corrective_action: "", preventive_action: "",
    responsible_person: "", due_date: "",
  });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [evRes, ptRes] = await Promise.all([
      (supabase as any).from("code_blue_events")
        .select("*, patients!code_blue_events_patient_id_fkey(full_name), code_blue_audits!code_blue_audits_event_id_fkey(id)")
        .eq("hospital_id", hospitalId).eq("is_deleted", false).order("event_datetime", { ascending: false }).limit(50),
      supabase.from("patients").select("id, full_name").eq("hospital_id", hospitalId).limit(200),
    ]);
    setEvents((evRes.data || []).map((e: any) => ({
      ...e, patient_name: e.patients?.full_name || "Unknown",
      has_audit: (e.code_blue_audits || []).length > 0,
    })));
    setPatients(ptRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const saveEvent = async () => {
    if (!eventForm.location || !hospitalId) { toast({ title: "Location required", variant: "destructive" }); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("code_blue_events").insert({
      hospital_id: hospitalId,
      patient_id: eventForm.patient_id || null,
      event_datetime: new Date(eventForm.event_datetime).toISOString(),
      location: eventForm.location, event_type: eventForm.event_type,
      initial_rhythm: eventForm.initial_rhythm || null,
      rosc_achieved: eventForm.rosc_achieved === "true" ? true : eventForm.rosc_achieved === "false" ? false : null,
      rosc_time_min: eventForm.rosc_time_min ? Number(eventForm.rosc_time_min) : null,
      outcome: eventForm.outcome || null,
      team_leader: user?.id,
    });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Code Blue event logged" }); setShowEventForm(false); load(); }
    setSaving(false);
  };

  const saveAudit = async () => {
    if (!auditEventId || !hospitalId) return;
    if (!auditForm.areas_for_improvement && !auditForm.root_cause) {
      toast({ title: "Complete the audit form before submitting", variant: "destructive" }); return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("code_blue_audits").insert({
      hospital_id: hospitalId, event_id: auditEventId,
      audit_date: new Date().toISOString().split("T")[0], audited_by: user?.id,
      mdt_doctor: auditForm.mdt_doctor, mdt_nurse: auditForm.mdt_nurse,
      mdt_pharmacist: auditForm.mdt_pharmacist, mdt_intensivist: auditForm.mdt_intensivist,
      response_time_min: auditForm.response_time_min ? Number(auditForm.response_time_min) : null,
      cpr_quality: auditForm.cpr_quality,
      defibrillation_time: auditForm.defibrillation_time ? Number(auditForm.defibrillation_time) : null,
      protocol_followed: auditForm.protocol_followed,
      drug_errors: auditForm.drug_errors || null, equipment_issues: auditForm.equipment_issues || null,
      good_practice_noted: auditForm.good_practice_noted || null,
      areas_for_improvement: auditForm.areas_for_improvement || null,
      root_cause: auditForm.root_cause || null,
      corrective_action: auditForm.corrective_action || null,
      preventive_action: auditForm.preventive_action || null,
      responsible_person: auditForm.responsible_person || null,
      due_date: auditForm.due_date || null, status: "submitted",
    });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else {
      await logNABHEvidence(hospitalId, "COP.5", `Code Blue multi-disciplinary audit completed for event ${auditEventId}`);
      toast({ title: "Audit submitted ✓" });
      setAuditEventId(null); load();
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b">
        <HeartPulse className="h-4 w-4 text-red-500" />
        <span className="text-sm font-semibold">Code Blue / CPR Audit</span>
        <Button size="sm" className="ml-auto" onClick={() => setShowEventForm(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Log Code Blue Event
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            {events.map(e => (
              <div key={e.id} className="p-3 border rounded-lg bg-card flex items-center gap-3">
                <HeartPulse className="h-5 w-5 text-red-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{EVENT_TYPES[e.event_type] || e.event_type} — {e.location}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.event_datetime).toLocaleString()} | Patient: {e.patient_name}
                    {e.rosc_achieved != null && ` | ROSC: ${e.rosc_achieved ? "Yes" : "No"}`}
                    {e.outcome && ` | Outcome: ${e.outcome}`}
                  </p>
                </div>
                {e.has_audit ? (
                  <Badge className="bg-green-100 text-green-800">Audited</Badge>
                ) : (
                  <>
                    <Badge className="bg-amber-100 text-amber-800">Audit Pending</Badge>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAuditEventId(e.id)}>
                      <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Conduct Audit
                    </Button>
                  </>
                )}
              </div>
            ))}
            {events.length === 0 && <p className="text-sm text-muted-foreground">No Code Blue events recorded.</p>}
          </>
        )}
      </div>

      {/* Log Event Dialog */}
      <Dialog open={showEventForm} onOpenChange={setShowEventForm}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Log Code Blue Event</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Patient (optional)</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={eventForm.patient_id} onChange={e => setEventForm(f => ({ ...f, patient_id: e.target.value }))}>
                <option value="">— Unknown / Not admitted —</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium">Date & Time *</label><Input type="datetime-local" value={eventForm.event_datetime} onChange={e => setEventForm(f => ({ ...f, event_datetime: e.target.value }))} /></div>
            <div><label className="text-xs font-medium">Location *</label><Input placeholder="Ward 3, Bed 12 / OT / ED" value={eventForm.location} onChange={e => setEventForm(f => ({ ...f, location: e.target.value }))} /></div>
            <div>
              <label className="text-xs font-medium">Event Type</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={eventForm.event_type} onChange={e => setEventForm(f => ({ ...f, event_type: e.target.value }))}>
                {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium">Initial Rhythm</label><Input placeholder="VF / Pulseless VT / PEA / Asystole" value={eventForm.initial_rhythm} onChange={e => setEventForm(f => ({ ...f, initial_rhythm: e.target.value }))} /></div>
            <div>
              <label className="text-xs font-medium">ROSC Achieved?</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={eventForm.rosc_achieved} onChange={e => setEventForm(f => ({ ...f, rosc_achieved: e.target.value }))}>
                <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Outcome</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={eventForm.outcome} onChange={e => setEventForm(f => ({ ...f, outcome: e.target.value }))}>
                <option value="">—</option><option value="survived">Survived</option><option value="death">Death</option><option value="transferred_icu">Transferred ICU</option><option value="discharged">Discharged</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowEventForm(false)}>Cancel</Button>
              <Button size="sm" onClick={saveEvent} disabled={saving}>{saving ? "Saving…" : "Log Event"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Audit Sheet */}
      <Sheet open={!!auditEventId} onOpenChange={() => setAuditEventId(null)}>
        <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
          <SheetHeader><SheetTitle>Code Blue Post-Event Audit</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-4">
            <div>
              <p className="text-xs font-semibold mb-2">MDT Attendance</p>
              <div className="grid grid-cols-2 gap-2">
                {[["mdt_doctor","Doctor"], ["mdt_nurse","Nurse"], ["mdt_pharmacist","Pharmacist"], ["mdt_intensivist","Intensivist/ICU"]].map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={(auditForm as any)[k]} onChange={e => setAuditForm(f => ({ ...f, [k]: e.target.checked }))} />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium">Response Time (min)</label><Input type="number" value={auditForm.response_time_min} onChange={e => setAuditForm(f => ({ ...f, response_time_min: e.target.value }))} /></div>
              <div><label className="text-xs font-medium">Defib Time (min)</label><Input type="number" value={auditForm.defibrillation_time} onChange={e => setAuditForm(f => ({ ...f, defibrillation_time: e.target.value }))} /></div>
            </div>
            <div>
              <label className="text-xs font-medium">CPR Quality</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={auditForm.cpr_quality} onChange={e => setAuditForm(f => ({ ...f, cpr_quality: e.target.value }))}>
                <option value="adequate">Adequate</option><option value="suboptimal">Suboptimal</option><option value="poor">Poor</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auditForm.protocol_followed} onChange={e => setAuditForm(f => ({ ...f, protocol_followed: e.target.checked }))} /> Protocol followed</label>
            {[["drug_errors","Drug Errors"], ["equipment_issues","Equipment Issues"], ["good_practice_noted","Good Practice Noted"], ["areas_for_improvement","Areas for Improvement"], ["root_cause","Root Cause"], ["corrective_action","Corrective Action"], ["preventive_action","Preventive Action"], ["responsible_person","Responsible Person"]].map(([k, l]) => (
              <div key={k}>
                <label className="text-xs font-medium">{l}</label>
                <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={2}
                  value={(auditForm as any)[k]} onChange={e => setAuditForm(f => ({ ...f, [k]: e.target.value }))} />
              </div>
            ))}
            <div><label className="text-xs font-medium">Due Date for CAPA</label><Input type="date" value={auditForm.due_date} onChange={e => setAuditForm(f => ({ ...f, due_date: e.target.value }))} /></div>
            <Button className="w-full" onClick={saveAudit} disabled={saving}>{saving ? "Saving…" : "Submit Audit"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default CodeBlueAuditTab;
