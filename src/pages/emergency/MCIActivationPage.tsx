import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, Users, Plus, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const INCIDENT_TYPES = [
  { value: "natural_disaster", label: "Natural Disaster" },
  { value: "mass_casualty",    label: "Mass Casualty Incident" },
  { value: "fire",             label: "Fire / Explosion" },
  { value: "chemical",         label: "Chemical Hazard" },
  { value: "biological",       label: "Biological Threat" },
  { value: "radiological",     label: "Radiological" },
  { value: "infrastructure",   label: "Infrastructure Failure" },
  { value: "other",            label: "Other" },
];

const TRIAGE_TAGS = [
  { value: "P1_immediate", label: "P1 — Immediate", color: "bg-red-500 text-white border-red-600", dot: "bg-red-500", desc: "Life-threatening, immediate intervention needed" },
  { value: "P2_delayed",   label: "P2 — Delayed",   color: "bg-yellow-400 text-yellow-900 border-yellow-500", dot: "bg-yellow-400", desc: "Serious but can wait 30–60 min" },
  { value: "P3_minor",     label: "P3 — Minor",     color: "bg-green-500 text-white border-green-600", dot: "bg-green-500", desc: "Walking wounded, minor injuries" },
  { value: "P4_expectant", label: "P4 — Expectant", color: "bg-gray-500 text-white border-gray-600", dot: "bg-gray-500", desc: "Fatal or futile intervention" },
  { value: "dead",         label: "Deceased",        color: "bg-black text-white border-black", dot: "bg-black", desc: "No signs of life" },
];

export default function MCIActivationPage() {
  const { hospitalId, userId } = useHospitalId() as any;
  const { toast } = useToast();
  const [activeEvent, setActiveEvent] = useState<any | null>(null);
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [showActivateForm, setShowActivateForm] = useState(false);
  const [showTriageForm, setShowTriageForm] = useState(false);

  const [activateForm, setActivateForm] = useState({
    event_name: "", incident_type: "mass_casualty", notes: "",
  });

  const [triageForm, setTriageForm] = useState({
    patient_name: "", triage_tag: "P1_immediate", age_approx: "",
    gender: "male", chief_complaint: "", assigned_bed: "",
  });

  const fetchEvent = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data: ev } = await (supabase as any)
      .from("mci_events")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("status", "active")
      .order("activated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setActiveEvent(ev);

    if (ev) {
      const { data: pts } = await (supabase as any)
        .from("mci_triage_patients")
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("mci_event_id", ev.id)
        .order("triaged_at", { ascending: false });
      setPatients(pts || []);
    } else {
      setPatients([]);
    }
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchEvent(); }, [fetchEvent]);

  const activateMCI = async () => {
    if (!hospitalId || !activateForm.event_name) return;
    setActivating(true);
    await (supabase as any).from("mci_events").insert({
      hospital_id: hospitalId,
      event_name: activateForm.event_name,
      incident_type: activateForm.incident_type,
      status: "active",
      activated_by: userId || null,
      notes: activateForm.notes || null,
    });
    setActivating(false);
    setShowActivateForm(false);
    setActivateForm({ event_name: "", incident_type: "mass_casualty", notes: "" });
    fetchEvent();
    toast({ title: "🚨 MCI Activated — mass casualty protocol engaged" });
  };

  const deactivateMCI = async () => {
    if (!activeEvent) return;
    await (supabase as any).from("mci_events")
      .update({ status: "deactivated", deactivated_at: new Date().toISOString(), deactivated_by: userId || null })
      .eq("id", activeEvent.id);
    fetchEvent();
    toast({ title: "MCI Deactivated — stand down" });
  };

  const addTriagePatient = async () => {
    if (!hospitalId || !activeEvent || !triageForm.patient_name) return;
    await (supabase as any).from("mci_triage_patients").insert({
      hospital_id: hospitalId,
      mci_event_id: activeEvent.id,
      triage_tag: triageForm.triage_tag,
      patient_name: triageForm.patient_name,
      age_approx: triageForm.age_approx ? parseInt(triageForm.age_approx) : null,
      gender: triageForm.gender,
      chief_complaint: triageForm.chief_complaint || null,
      assigned_bed: triageForm.assigned_bed || null,
      triaged_by: userId || null,
    });
    setShowTriageForm(false);
    setTriageForm({ patient_name: "", triage_tag: "P1_immediate", age_approx: "", gender: "male", chief_complaint: "", assigned_bed: "" });
    fetchEvent();
    toast({ title: "Triage patient added" });
  };

  const tagCounts = TRIAGE_TAGS.reduce((acc, t) => ({
    ...acc, [t.value]: patients.filter(p => p.triage_tag === t.value).length
  }), {} as Record<string, number>);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-screen">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className={activeEvent ? "text-red-600" : "text-muted-foreground"} />
          <h1 className="text-[16px] font-bold text-foreground">MCI — Disaster Response</h1>
          {activeEvent && (
            <span className="ml-2 text-[11px] bg-red-600 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
              ACTIVE
            </span>
          )}
        </div>
        {!activeEvent ? (
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white gap-1.5 h-8"
            onClick={() => setShowActivateForm(true)}
          >
            <AlertTriangle size={12} /> Activate MCI
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={deactivateMCI} className="gap-1.5 h-8 border-red-300 text-red-700 hover:bg-red-50">
            <XCircle size={12} /> Deactivate MCI
          </Button>
        )}
      </div>

      {/* Activate form modal */}
      {showActivateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-600" />
              <h2 className="text-[15px] font-bold text-foreground">Activate Mass Casualty Incident</h2>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Incident Name *</label>
                <Input value={activateForm.event_name}
                  onChange={e => setActivateForm(p => ({ ...p, event_name: e.target.value }))}
                  className="h-9 mt-1 text-[13px]" placeholder="e.g. Building collapse — MG Road" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Incident Type *</label>
                <Select value={activateForm.incident_type} onValueChange={v => setActivateForm(p => ({ ...p, incident_type: v }))}>
                  <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Notes</label>
                <Textarea value={activateForm.notes}
                  onChange={e => setActivateForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2} className="mt-1 text-[12px]" placeholder="Initial briefing notes…" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowActivateForm(false)}>Cancel</Button>
              <Button size="sm" onClick={activateMCI} disabled={activating || !activateForm.event_name}
                className="bg-red-600 hover:bg-red-700 text-white gap-1.5">
                {activating ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                Activate Now
              </Button>
            </div>
          </div>
        </div>
      )}

      {!activeEvent ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground space-y-3">
          <ShieldAlert size={48} className="opacity-20" />
          <p className="text-[14px] font-medium">No active MCI event</p>
          <p className="text-[12px]">Click "Activate MCI" to initiate the mass casualty protocol.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Event banner */}
          <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start justify-between">
            <div>
              <p className="text-[15px] font-bold text-red-800">{activeEvent.event_name}</p>
              <p className="text-[12px] text-red-700 mt-0.5">{INCIDENT_TYPES.find(t => t.value === activeEvent.incident_type)?.label}</p>
              <p className="text-[11px] text-red-600 mt-1">Activated: {format(new Date(activeEvent.activated_at), "dd/MM/yyyy HH:mm")}</p>
            </div>
            <div className="text-right">
              <p className="text-[28px] font-bold text-red-700">{patients.length}</p>
              <p className="text-[11px] text-red-600">Total Patients</p>
            </div>
          </div>

          {/* Triage counts */}
          <div className="grid grid-cols-5 gap-2">
            {TRIAGE_TAGS.map(t => (
              <div key={t.value} className={cn("border rounded-xl p-3 text-center", t.value === "P1_immediate" ? "bg-red-50 border-red-200" : t.value === "P2_delayed" ? "bg-yellow-50 border-yellow-200" : t.value === "P3_minor" ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200")}>
                <p className="text-[22px] font-bold text-foreground">{tagCounts[t.value] || 0}</p>
                <p className="text-[10px] font-semibold text-foreground mt-0.5">{t.label}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{t.desc}</p>
              </div>
            ))}
          </div>

          {/* Add triage patient */}
          <div className="flex justify-between items-center">
            <p className="text-[13px] font-semibold text-foreground">Triage Log</p>
            <Button size="sm" variant="outline" onClick={() => setShowTriageForm(!showTriageForm)} className="h-8 gap-1.5">
              <Plus size={12} /> Add Patient
            </Button>
          </div>

          {showTriageForm && (
            <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">Patient Name *</label>
                  <Input value={triageForm.patient_name} onChange={e => setTriageForm(p => ({ ...p, patient_name: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="Unknown Male / known name" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Triage Tag *</label>
                  <Select value={triageForm.triage_tag} onValueChange={v => setTriageForm(p => ({ ...p, triage_tag: v }))}>
                    <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIAGE_TAGS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Approx. Age</label>
                  <Input type="number" value={triageForm.age_approx} onChange={e => setTriageForm(p => ({ ...p, age_approx: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Gender</label>
                  <Select value={triageForm.gender} onValueChange={v => setTriageForm(p => ({ ...p, gender: v }))}>
                    <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Assigned Bed</label>
                  <Input value={triageForm.assigned_bed} onChange={e => setTriageForm(p => ({ ...p, assigned_bed: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="A-12" />
                </div>
                <div className="col-span-3">
                  <label className="text-[11px] text-muted-foreground">Chief Complaint / Injury</label>
                  <Input value={triageForm.chief_complaint} onChange={e => setTriageForm(p => ({ ...p, chief_complaint: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="Crush injury L lower limb, head trauma…" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowTriageForm(false)} className="h-8">Cancel</Button>
                <Button size="sm" onClick={addTriagePatient} disabled={!triageForm.patient_name} className="h-8 gap-1">
                  <Plus size={12} />Add to Triage Log
                </Button>
              </div>
            </div>
          )}

          {/* Triage log table */}
          {patients.length > 0 && (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50">
                  <tr>
                    {["Tag","Name","Age/Sex","Complaint","Bed","Time"].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-[11px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {patients.map(p => {
                    const tag = TRIAGE_TAGS.find(t => t.value === p.triage_tag);
                    return (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", tag?.color || "")}>
                            {tag?.label?.split(" — ")[0] || p.triage_tag}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium text-foreground">{p.patient_name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{p.age_approx ? `${p.age_approx}y` : "—"} {p.gender?.[0]?.toUpperCase()}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{p.chief_complaint || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{p.assigned_bed || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{format(new Date(p.triaged_at), "HH:mm")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
