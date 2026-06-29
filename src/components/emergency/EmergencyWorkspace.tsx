import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { autoChargeService, MODULE_ED, getEdChargeRate, recordUnbilledService } from "@/lib/serviceBilling";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ExternalLink, Mic, FileText, Bot, Loader2, X } from "lucide-react";
import AIAttestationModal from "@/components/ai/AIAttestationModal";
import { printDocument, printHeader } from "@/lib/printUtils";
import { useVoiceScribe } from "@/contexts/VoiceScribeContext";
import VoiceDictationButton from "@/components/voice/VoiceDictationButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AdmitPatientModal from "@/components/ipd/AdmitPatientModal";
import NewLabOrderModal from "@/components/lab/NewLabOrderModal";
import BookOTModal from "@/components/ot/BookOTModal";
import type { OTRoom } from "@/pages/ot/OTPage";
import type { EDVisit } from "@/pages/emergency/EmergencyPage";

interface Props {
  visit: EDVisit | null;
  hospitalId: string | null;
  userId: string | null;
  onRefresh: () => void;
}

const EmergencyWorkspace: React.FC<Props> = ({ visit, hospitalId, userId, onRefresh }) => {
  const navigate = useNavigate();
  const { registerScreen, unregisterScreen } = useVoiceScribe();
  const [vitals, setVitals] = useState({ bp_s: "", bp_d: "", pulse: "", spo2: "", gcs: "" });
  const [complaint, setComplaint] = useState("");
  const [ample, setAmple] = useState({ a: "", m: "", p: "", l: "", e: "" });
  const [diagnosis, setDiagnosis] = useState("");
  const [mlc, setMlc] = useState(false);
  const [mlcDetails, setMlcDetails] = useState({ police_station: "", officer: "", fir: "", injury_type: "" });
  const [savingVitals, setSavingVitals] = useState(false);
  const [triageSuggestion, setTriageSuggestion] = useState<string | null>(null);
  const [dispositionSuggestion, setDispositionSuggestion] = useState<string | null>(null);
  const [investigationsSuggested, setInvestigationsSuggested] = useState<string[]>([]);
  // AI Triage Assist
  const [aiTriageResult, setAiTriageResult] = useState<Record<string, any> | null>(null);
  const [aiTriageLoading, setAiTriageLoading] = useState(false);
  const [showTriagePanel, setShowTriagePanel] = useState(false);
  const [showTriageAttestation, setShowTriageAttestation] = useState(false);

  // Modal states
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [showLabModal, setShowLabModal] = useState(false);
  const [showBloodDialog, setShowBloodDialog] = useState(false);
  const [showSpecialistDialog, setShowSpecialistDialog] = useState(false);
  const [showDischargeConfirm, setShowDischargeConfirm] = useState(false);
  const [showMlcDialog, setShowMlcDialog] = useState(false);
  const [showOTModal, setShowOTModal] = useState(false);
  const [otRooms, setOtRooms] = useState<OTRoom[]>([]);

  // Blood request state
  const [bloodGroup, setBloodGroup] = useState("");
  const [bloodComponent, setBloodComponent] = useState("PRBCs");
  const [bloodUnits, setBloodUnits] = useState("1");
  const [bloodUrgent, setBloodUrgent] = useState(true);
  const [bloodSubmitting, setBloodSubmitting] = useState(false);

  // Specialist state
  const [specialistDept, setSpecialistDept] = useState("");
  const [specialistReason, setSpecialistReason] = useState("");
  const [specialistSubmitting, setSpecialistSubmitting] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  // ED billing summary for the Charges panel
  const [edBilling, setEdBilling] = useState<{ status: string; billId: string | null; total: number }>({ status: "unbilled", billId: null, total: 0 });

  const loadEdCharges = useCallback(async () => {
    if (!visit?.id || !hospitalId) { setEdBilling({ status: "unbilled", billId: null, total: 0 }); return; }
    const { data: v } = await supabase.from("ed_visits").select("billing_status, bill_id").eq("id", visit.id).maybeSingle();
    let total = 0;
    const billId = (v as any)?.bill_id ?? null;
    if (billId) {
      const { data: items } = await (supabase as any).from("bill_line_items")
        .select("total_amount").eq("bill_id", billId).eq("source_record_id", visit.id).eq("source_module", MODULE_ED);
      total = (items || []).reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0);
    }
    setEdBilling({ status: (v as any)?.billing_status ?? "unbilled", billId, total });
  }, [visit?.id, hospitalId]);

  useEffect(() => { loadEdCharges(); }, [loadEdCharges]);

  // Load departments for specialist dialog
  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).order("name")
      .then(({ data }) => setDepartments(data || []));
  }, [hospitalId]);

  // Load OT rooms for refer-to-OT modal
  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("ot_rooms").select("id, name, type").eq("hospital_id", hospitalId).eq("is_active", true).order("name")
      .then(({ data }) => setOtRooms((data as OTRoom[]) || []));
  }, [hospitalId]);

  // Load data when visit changes
  useEffect(() => {
    if (!visit) return;
    setComplaint(visit.chief_complaint || "");
    setDiagnosis(visit.working_diagnosis || "");
    setMlc(visit.mlc);
    setMlcDetails(visit.mlc_details as any || { police_station: "", officer: "", fir: "", injury_type: "" });
    setAmple(visit.ample_history as any || { a: "", m: "", p: "", l: "", e: "" });
    const vs = visit.vitals_snapshot || {};
    setVitals({ bp_s: vs.bp_s || "", bp_d: vs.bp_d || "", pulse: vs.pulse || "", spo2: vs.spo2 || "", gcs: vs.gcs || "" });
    setTriageSuggestion(null);
    setDispositionSuggestion(null);
    setInvestigationsSuggested([]);
  }, [visit?.id]);

  // Register screen for voice scribe
  useEffect(() => {
    const fillFn = (data: Record<string, unknown>) => {
      if (data.presenting_complaint) setComplaint(data.presenting_complaint as string);
      if (data.working_diagnosis) setDiagnosis(data.working_diagnosis as string);

      const vd = data.vitals_detected as Record<string, string> | undefined;
      if (vd) {
        setVitals(prev => ({
          bp_s: vd.bp_systolic || prev.bp_s,
          bp_d: vd.bp_diastolic || prev.bp_d,
          pulse: vd.pulse || prev.pulse,
          spo2: vd.spo2 || prev.spo2,
          gcs: vd.gcs || prev.gcs,
        }));
      }

      const amp = data.ample as Record<string, string> | undefined;
      if (amp) {
        setAmple(prev => ({
          a: amp.allergies || prev.a,
          m: amp.medications || prev.m,
          p: amp.past_history || prev.p,
          l: amp.last_meal || prev.l,
          e: amp.events || prev.e,
        }));
      } else if (data.history) {
        setAmple(prev => ({ ...prev, e: data.history as string }));
      }

      if (data.triage_category && visit) {
        const suggested = data.triage_category as string;
        if (suggested !== visit.triage_category) setTriageSuggestion(suggested);
      }
      if (data.disposition) setDispositionSuggestion(data.disposition as string);
      if (Array.isArray(data.investigations_ordered) && data.investigations_ordered.length > 0) {
        setInvestigationsSuggested(data.investigations_ordered as string[]);
      }
    };
    registerScreen("emergency", fillFn);
    return () => unregisterScreen("emergency");
  }, [registerScreen, unregisterScreen, visit?.triage_category, visit?.id]);

  if (!visit) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: "#1E293B", borderTop: "1px solid #334155" }}>
        <p className="text-slate-500 text-sm">↑ Select a patient from the triage board</p>
      </div>
    );
  }

  const losMinutes = visit.minutes_ago;
  const losColor = losMinutes < 120 ? "text-emerald-400" : losMinutes < 240 ? "text-amber-400" : "text-red-400";
  const losText = losMinutes < 60 ? `${losMinutes}m` : `${Math.floor(losMinutes / 60)}h ${losMinutes % 60}m`;

  const mapUrgencyToTriage = (urgency: string): string => {
    if (urgency === "emergent") return "P1";
    if (urgency === "urgent") return "P2";
    return "P3";
  };

  const handleAITriageAssist = async () => {
    if (!visit || !hospitalId) return;
    setAiTriageLoading(true);
    try {
      const start = Date.now();
      const { data, error } = await supabase.functions.invoke("ai-differential-diagnosis", {
        body: {
          chief_complaint: complaint || visit.chief_complaint || "Unknown",
          vitals: {
            bp_systolic: vitals.bp_s || null,
            bp_diastolic: vitals.bp_d || null,
            pulse: vitals.pulse || null,
            spo2: vitals.spo2 || null,
            gcs: vitals.gcs || null,
          },
          history: `AMPLE — Allergies: ${ample.a || "none"} | Medications: ${ample.m || "none"} | Past Hx: ${ample.p || "none"} | Last meal: ${ample.l || "unknown"} | Events: ${ample.e || "none"}`,
          patient_context: `Emergency triage. Current triage category: ${visit.triage_category}. Please also suggest the appropriate triage priority (P1=Immediate/emergent, P2=Urgent, P3=Delayed, P4=Minor) with rationale, and list any red flag symptoms that must be acted on immediately.`,
        },
      });
      if (error) throw new Error(error.message);
      setAiTriageResult(data);
      setShowTriagePanel(true);

      await (supabase as any).from("ai_feature_logs").insert({
        hospital_id: hospitalId,
        patient_id: visit.patient_id,
        module: "emergency",
        feature_key: "triage_assist",
        success: true,
        input_summary: `ED Visit ${visit.id} | CC: ${(complaint || visit.chief_complaint || "").slice(0, 80)}`,
        output_summary: `Urgency: ${data?.overall_urgency || "unknown"} | Top Dx: ${data?.differentials?.[0]?.diagnosis || "—"}`,
        latency_ms: Date.now() - start,
      });
    } catch (e: any) {
      toast({ title: "AI Triage failed", description: e.message, variant: "destructive" });
    } finally {
      setAiTriageLoading(false);
    }
  };

  const saveVitals = async () => {
    setSavingVitals(true);
    await supabase.from("ed_visits").update({ vitals_snapshot: vitals, gcs_score: vitals.gcs ? parseInt(vitals.gcs) : null }).eq("id", visit.id);
    setSavingVitals(false);
    toast({ title: "Vitals saved" });
  };

  const saveField = async (field: string, value: any) => {
    await supabase.from("ed_visits").update({ [field]: value } as any).eq("id", visit.id);
  };

  const handleDisposition = async (disp: string) => {
    await supabase.from("ed_visits").update({
      disposition: disp,
      disposition_time: new Date().toISOString(),
      is_active: disp === "discharged" ? false : true,
    }).eq("id", visit.id);

    // Auto-create mortuary admission for expired patients
    if ((disp === "expired" || disp === "deceased") && hospitalId && visit) {
      const bodyNum = `BODY-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000).padStart(4, "0")}`;

      await supabase.from("mortuary_admissions").insert({
        hospital_id: hospitalId,
        patient_id: visit.patient_id,
        admission_id: null,
        body_number: bodyNum,
        time_of_death: new Date().toISOString(),
        pronounced_by: userId,
        cause_of_death: visit.chief_complaint || "Under investigation",
        manner_of_death: "undetermined",
        is_mlc: mlc || false,
        status: "in_mortuary",
        notes: `Patient brought from Emergency Department. MLC: ${mlc ? "Yes" : "No"}`,
      });

      toast({ title: `Mortuary admission created — Body No: ${bodyNum}` });

      if (mlc) {
        await supabase.from("mlc_records").insert({
          hospital_id: hospitalId,
          patient_id: visit.patient_id,
          mlc_number: `MLC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000).padStart(4, "0")}`,
          incident_type: "unknown_cause",
          police_station: mlcDetails.police_station || "",
          officer_name: mlcDetails.officer || "",
          fir_number: mlcDetails.fir || "",
          status: "open",
        });
      }
    }

    // Auto-bill the configured Casualty / Emergency fee on discharge or admission.
    // On admit, the fee is appended to the patient's IPD bill; on discharge it forms a
    // standalone ED bill. Idempotent via ed_visits.billing_status (no double charge).
    // If no fee is configured (₹0), nothing is billed — same as before this feature.
    if ((disp === "discharged" || disp === "admitted") && hospitalId && visit.patient_id) {
      const { fee, gstPct } = await getEdChargeRate(hospitalId);
      if (fee > 0) {
        let admissionId: string | null = null;
        if (disp === "admitted") {
          const { data: adm } = await supabase.from("admissions")
            .select("id")
            .eq("hospital_id", hospitalId)
            .eq("patient_id", visit.patient_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          admissionId = adm?.id ?? null;
        }
        try {
          await autoChargeService({
            hospitalId,
            patientId:     visit.patient_id,
            admissionId,                              // set → append to IPD bill
            encounterId:   admissionId ? null : visit.id,
            serviceName:   "Casualty / Emergency Fee",
            serviceModule: MODULE_ED,
            sourceTable:   "ed_visits",
            sourceId:      visit.id,
            unitRate:      fee,
            gstPercent:    gstPct,
            performedBy:   userId,
            serviceDate:   new Date().toISOString().split("T")[0],
          });
          toast({ title: "Emergency charge billed", description: `Casualty fee ₹${fee.toLocaleString("en-IN")} added to the ${admissionId ? "IPD" : "ED"} bill.` });
        } catch {
          toast({ title: "Could not bill the emergency charge", variant: "destructive" });
        }
        loadEdCharges();
      } else if (disp === "discharged") {
        // No casualty fee configured — preserve prior behaviour: flag for the leakage dashboard.
        recordUnbilledService({
          hospitalId,
          patientId:     visit.patient_id,
          serviceModule: MODULE_ED,
          serviceRefId:  visit.id,
          serviceName:   "Emergency Department visit",
          notes:         "Casualty fee not configured in Services & Fees — manual billing required",
        }).catch(() => {});
      }
    }

    toast({ title: `Patient ${disp}` });
    onRefresh();
  };

  const handleBloodRequest = async () => {
    if (!hospitalId || !visit) return;
    setBloodSubmitting(true);
    try {
      await supabase.from("clinical_alerts").insert({
        hospital_id: hospitalId,
        alert_type: "blood_request",
        severity: bloodUrgent ? "critical" : "high",
        alert_message: `🩸 Blood Request: ${bloodUnits} unit(s) ${bloodComponent}${bloodGroup ? ` (${bloodGroup})` : ""} for ${visit.patient_name}`,
        patient_id: visit.patient_id,
      });
      toast({ title: "✓ Blood request sent", description: `${bloodUnits} unit(s) ${bloodComponent} requested` });
      setShowBloodDialog(false);
    } catch (err: any) {
      toast({ title: "Failed to send blood request", variant: "destructive" });
    } finally {
      setBloodSubmitting(false);
    }
  };

  const handleSpecialistCall = async () => {
    if (!hospitalId || !visit || !specialistDept) return;
    setSpecialistSubmitting(true);
    try {
      const deptName = departments.find(d => d.id === specialistDept)?.name || specialistDept;
      await supabase.from("clinical_alerts").insert({
        hospital_id: hospitalId,
        alert_type: "specialist_consult",
        severity: "high",
        alert_message: `📟 Specialist consult requested: ${deptName} for ${visit.patient_name}. Reason: ${specialistReason || "Emergency consultation"}`,
        patient_id: visit.patient_id,
      });
      toast({ title: "✓ Specialist alert sent", description: `${deptName} team notified` });
      setShowSpecialistDialog(false);
      setSpecialistDept("");
      setSpecialistReason("");
    } catch {
      toast({ title: "Failed to send alert", variant: "destructive" });
    } finally {
      setSpecialistSubmitting(false);
    }
  };

  return (
    <div className="h-full flex" style={{ background: "#1E293B", borderTop: "1px solid #334155" }}>
      {/* LEFT: Timeline */}
      <div className="w-[200px] flex-shrink-0 flex flex-col p-3 overflow-y-auto" style={{ background: "#162032", borderRight: "1px solid #334155" }}>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Timeline</p>
        <div className="space-y-3 flex-1">
          <TimelineItem filled label="Arrived" time={new Date(visit.arrival_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} />
          <TimelineItem filled label={`Triaged as ${visit.triage_category}`} time="" />
          <TimelineItem filled={!!visit.doctor_id} label="Doctor seen" time="" />
          <TimelineItem filled={false} label="Investigation" time="" />
          <TimelineItem filled={visit.disposition !== "awaiting"} label={visit.disposition !== "awaiting" ? `Disposition: ${visit.disposition}` : "Disposition"} time={visit.disposition !== "awaiting" ? "Done" : ""} />
        </div>
        <div className="mt-2 bg-red-900/20 rounded-md p-2 flex items-center gap-2">
          <Mic className="h-3.5 w-3.5 text-red-400" />
          <span className="text-[10px] text-red-300">Tap mic for emergency voice entry</span>
        </div>
        <div className="mt-auto pt-3 border-t border-slate-700">
          <p className="text-[10px] text-slate-500 uppercase font-bold">Time in ED</p>
          <p className={cn("text-lg font-bold font-mono tabular-nums", losColor)}>{losText}</p>
        </div>
      </div>

      {/* CENTER: Clinical Entry */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Vitals row */}
        <div className="flex gap-2 items-end">
          <VInput label="BP Sys" value={vitals.bp_s} onChange={v => setVitals({ ...vitals, bp_s: v })} placeholder="120" />
          <span className="text-slate-500 pb-2">/</span>
          <VInput label="Dia" value={vitals.bp_d} onChange={v => setVitals({ ...vitals, bp_d: v })} placeholder="80" />
          <VInput label="Pulse" value={vitals.pulse} onChange={v => setVitals({ ...vitals, pulse: v })} placeholder="88" />
          <VInput label="SpO2" value={vitals.spo2} onChange={v => setVitals({ ...vitals, spo2: v })} placeholder="98" />
          <VInput label="GCS" value={vitals.gcs} onChange={v => setVitals({ ...vitals, gcs: v })} placeholder="15" />
          <Button size="sm" onClick={saveVitals} disabled={savingVitals} className="h-8 text-xs bg-blue-600 hover:bg-blue-700 mb-0.5">
            {savingVitals ? "..." : "Save"}
          </Button>
        </div>

        {/* Chief complaint */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Chief Complaint</label>
            <VoiceDictationButton sessionType="emergency" size="sm" />
          </div>
          <Textarea value={complaint} onChange={e => setComplaint(e.target.value)}
            onBlur={() => saveField("chief_complaint", complaint)}
            placeholder="Chief complaint / presenting history..."
            className="mt-1 text-sm resize-none text-white border-slate-600 h-16"
            style={{ background: "#0F172A" }} />
        </div>

        {/* Triage suggestion banner */}
        {triageSuggestion && (
          <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-2.5 flex items-center justify-between">
            <span className="text-xs text-amber-300">
              🎯 Voice scribe suggests triage: <strong>{triageSuggestion}</strong> (currently {visit.triage_category})
            </span>
            <div className="flex gap-1.5">
              <button onClick={() => { saveField("triage_category", triageSuggestion); setTriageSuggestion(null); onRefresh(); }}
                className="text-[10px] bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-500">Apply</button>
              <button onClick={() => setTriageSuggestion(null)}
                className="text-[10px] text-amber-400 px-2 py-1 hover:underline">Dismiss</button>
            </div>
          </div>
        )}

        {/* Investigations suggested */}
        {investigationsSuggested.length > 0 && (
          <div className="bg-purple-900/30 border border-purple-700/50 rounded-lg p-2.5">
            <p className="text-[10px] font-bold text-purple-300 uppercase mb-1.5">Voice scribe detected investigations</p>
            <div className="flex flex-wrap gap-1.5">
              {investigationsSuggested.map((inv, i) => (
                <span key={i} className="text-[11px] bg-purple-800/50 text-purple-200 px-2 py-0.5 rounded-full">{inv}</span>
              ))}
            </div>
            <button onClick={() => { if (hospitalId) { setShowLabModal(true); } setInvestigationsSuggested([]); }}
              className="text-[10px] text-purple-300 hover:underline mt-1.5">Create STAT Lab Orders →</button>
          </div>
        )}

        {/* Disposition suggestion */}
        {dispositionSuggestion && (
          <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-lg p-2.5 flex items-center justify-between">
            <span className="text-xs text-emerald-300">
              📋 Suggested disposition: <strong className="capitalize">{dispositionSuggestion}</strong>
            </span>
            <div className="flex gap-1.5">
              <button onClick={() => { handleDisposition(dispositionSuggestion); setDispositionSuggestion(null); }}
                className="text-[10px] bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-500">Apply</button>
              <button onClick={() => setDispositionSuggestion(null)}
                className="text-[10px] text-emerald-400 px-2 py-1 hover:underline">Dismiss</button>
            </div>
          </div>
        )}

        {/* AMPLE */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">AMPLE History</label>
          <div className="grid grid-cols-5 gap-1.5 mt-1">
            {(["a", "m", "p", "l", "e"] as const).map(key => (
              <div key={key}>
                <span className="text-[9px] text-slate-500 uppercase font-bold">{key === "a" ? "Allergies" : key === "m" ? "Meds" : key === "p" ? "Past Hx" : key === "l" ? "Last Meal" : "Events"}</span>
                <Input value={(ample as any)[key]} onChange={e => setAmple({ ...ample, [key]: e.target.value })}
                  onBlur={() => saveField("ample_history", ample)}
                  className="h-7 text-[11px] text-white border-slate-600 mt-0.5"
                  style={{ background: "#0F172A" }} />
              </div>
            ))}
          </div>
        </div>

        {/* AI Triage Suggestions Panel */}
        {showTriagePanel && aiTriageResult && (
          <div className="bg-indigo-950/60 border border-indigo-600/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-indigo-400" />
                <span className="text-xs font-bold text-indigo-300">🤖 AI Triage Suggestions</span>
                <span className="text-[10px] bg-indigo-800/60 text-indigo-300 px-1.5 py-0.5 rounded">AI Suggested</span>
              </div>
              <button onClick={() => setShowTriagePanel(false)} className="text-slate-500 hover:text-slate-300">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Suggested triage category */}
            {aiTriageResult.overall_urgency && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Suggested Category:</span>
                <span className={cn("text-xs font-bold px-2 py-0.5 rounded",
                  aiTriageResult.overall_urgency === "emergent" ? "bg-red-900/60 text-red-300" :
                  aiTriageResult.overall_urgency === "urgent" ? "bg-orange-900/60 text-orange-300" :
                  "bg-yellow-900/60 text-yellow-300"
                )}>
                  {mapUrgencyToTriage(aiTriageResult.overall_urgency)} — {aiTriageResult.overall_urgency}
                </span>
              </div>
            )}

            {/* Red flags */}
            {aiTriageResult.red_flags_detected?.length > 0 && (
              <div>
                <p className="text-[10px] text-red-400 font-bold uppercase mb-1">Red Flags Detected</p>
                <div className="flex flex-wrap gap-1">
                  {aiTriageResult.red_flags_detected.map((f: string, i: number) => (
                    <span key={i} className="text-[10px] bg-red-900/40 text-red-300 px-1.5 py-0.5 rounded">{f}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Top differential + investigations */}
            {aiTriageResult.differentials?.[0] && (
              <div className="space-y-1">
                <p className="text-[10px] text-slate-400 font-bold uppercase">Top Differential</p>
                <p className="text-xs text-slate-300 font-medium">{aiTriageResult.differentials[0].diagnosis}</p>
                {aiTriageResult.differentials[0].recommended_investigations?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {aiTriageResult.differentials[0].recommended_investigations.slice(0, 5).map((inv: string, i: number) => (
                      <span key={i} className="text-[10px] bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded">{inv}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-1.5 pt-1 border-t border-indigo-700/30">
              <button
                onClick={() => setShowTriageAttestation(true)}
                className="text-[10px] bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-600 transition-colors"
              >
                Apply with Attestation
              </button>
              <button
                onClick={() => setShowTriagePanel(false)}
                className="text-[10px] text-slate-400 px-3 py-1.5 hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Diagnosis */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Working Diagnosis</label>
          <Input value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
            onBlur={() => saveField("working_diagnosis", diagnosis)}
            placeholder="Working diagnosis..."
            className="h-8 text-sm text-white border-slate-600 mt-1"
            style={{ background: "#0F172A" }} />
        </div>

        {/* MLC */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={mlc} onChange={e => { setMlc(e.target.checked); saveField("mlc", e.target.checked); }}
              className="rounded border-slate-600" />
            <span className="text-xs text-slate-400 font-medium">Medico-Legal Case (MLC)</span>
          </label>
          {mlc && (
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {[
                { k: "police_station", l: "Police Station" },
                { k: "officer", l: "Officer Name" },
                { k: "fir", l: "FIR Number" },
                { k: "injury_type", l: "Injury Type" },
              ].map(f => (
                <div key={f.k}>
                  <span className="text-[9px] text-slate-500 uppercase font-bold">{f.l}</span>
                  <Input value={(mlcDetails as any)[f.k] || ""} onChange={e => setMlcDetails({ ...mlcDetails, [f.k]: e.target.value })}
                    onBlur={() => saveField("mlc_details", mlcDetails)}
                    className="h-7 text-[11px] text-white border-slate-600 mt-0.5"
                    style={{ background: "#0F172A" }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Actions */}
      <div className="w-[170px] flex-shrink-0 flex flex-col gap-2 p-3 overflow-y-auto" style={{ background: "#162032", borderLeft: "1px solid #334155" }}>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Actions</p>

        <button
          onClick={handleAITriageAssist}
          disabled={aiTriageLoading}
          className="w-full h-9 rounded-lg text-[12px] font-bold text-white flex items-center justify-center gap-1.5 transition-all active:scale-[0.97]"
          style={{ background: "#6366F1" }}
        >
          {aiTriageLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
          AI Triage Assist
        </button>
        <ActionBtn label="🛏️ Admit to IPD" bg="#3B82F6" onClick={() => setShowAdmitModal(true)} />
        <ActionBtn label="🔬 STAT Lab" bg="#8B5CF6" onClick={() => { if (hospitalId) setShowLabModal(true); }} />
        <ActionBtn label="🩸 Blood Request" bg="#EF4444" onClick={() => setShowBloodDialog(true)} />
        <ActionBtn label="📟 Call Specialist" bg="#F59E0B" onClick={() => setShowSpecialistDialog(true)} />
        {visit.triage_category !== "red" && visit.triage_category !== "critical" && visit.disposition !== "discharged" && visit.disposition !== "expired" && (
          <ActionBtn label="🏥 Refer to OT" bg="#0E7B7B" onClick={() => setShowOTModal(true)} />
        )}
        <ActionBtn label="🏠 Discharge" bg="#10B981" onClick={() => setShowDischargeConfirm(true)} />
        {mlc && <ActionBtn label="📄 MLC Register" bg="#7C3AED" onClick={() => setShowMlcDialog(true)} />}
        {mlc && (
          <ActionBtn label="📋 Police Intimation" bg="#6D28D9" onClick={() => {
            const now = new Date();
            const body = `
              ${printHeader(hospitalId ? "Hospital" : "Hospital", "Medico-Legal Case — Police Intimation")}
              <div style="text-align:center;font-size:14px;font-weight:bold;margin:12px 0;text-decoration:underline">
                POLICE INTIMATION (FORM 4)
              </div>
              <div class="row"><span class="label">Date & Time:</span><span>${now.toLocaleDateString("en-IN")} ${now.toLocaleTimeString("en-IN")}</span></div>
              <div class="row"><span class="label">To:</span><span>The Station House Officer, ${mlcDetails.police_station || "_______________"}</span></div>
              <div style="margin:16px 0;font-size:12px;line-height:1.8">
                <p>Sir/Madam,</p>
                <p>This is to inform you that the following patient has been brought to this hospital
                and the case appears to be of medico-legal nature:</p>
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:12px;margin:12px 0">
                <tr><td style="padding:6px;border:1px solid #ccc;width:35%;font-weight:bold">Patient Name</td><td style="padding:6px;border:1px solid #ccc">${visit.patient_name}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Date & Time of Arrival</td><td style="padding:6px;border:1px solid #ccc">${new Date(visit.arrival_time).toLocaleString("en-IN")}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Brought By</td><td style="padding:6px;border:1px solid #ccc">—</td></tr>
                <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Nature of Injuries / Condition</td><td style="padding:6px;border:1px solid #ccc">${mlcDetails.injury_type || complaint || "—"}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Chief Complaint</td><td style="padding:6px;border:1px solid #ccc">${complaint || "—"}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Working Diagnosis</td><td style="padding:6px;border:1px solid #ccc">${diagnosis || "Under evaluation"}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Condition on Arrival</td><td style="padding:6px;border:1px solid #ccc">BP: ${vitals.bp_s || "—"}/${vitals.bp_d || "—"}, Pulse: ${vitals.pulse || "—"}, SpO2: ${vitals.spo2 || "—"}%, GCS: ${vitals.gcs || "—"}/15</td></tr>
              </table>
              <div style="margin:16px 0;font-size:12px;line-height:1.8">
                <p>The patient is being treated at this hospital. You are requested to take necessary action.</p>
              </div>
              <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:12px">
                <div><p>_________________________</p><p>Attending Doctor</p></div>
                <div style="text-align:right"><p>_________________________</p><p>Medical Superintendent</p></div>
              </div>
            `;
            printDocument("Police Intimation - " + visit.patient_name, body);
          }} />
        )}

        <button
          onClick={() => navigate(`/patients?id=${visit.patient_id}`)}
          className="flex items-center gap-1 text-[11px] text-blue-400 font-medium hover:underline mt-2"
        >
          View Patient Record <ExternalLink className="h-3 w-3" />
        </button>

        {/* ED Charges */}
        <div className="mt-2 rounded-lg border border-slate-700 p-2.5" style={{ background: "#0F172A" }}>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">ED Charges</p>
          {edBilling.status === "billed" ? (
            <>
              <p className="text-sm font-bold text-emerald-400 tabular-nums">₹{edBilling.total.toLocaleString("en-IN")}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Casualty fee billed</p>
              {edBilling.billId && (
                <button onClick={() => navigate(`/billing?bill_id=${edBilling.billId}`)}
                  className="flex items-center gap-1 text-[11px] text-blue-400 font-medium hover:underline mt-1">
                  View Bill <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </>
          ) : (
            <p className="text-[11px] text-slate-400 leading-snug">Not yet billed — bills automatically on discharge or admit.</p>
          )}
        </div>

        <div className="mt-auto pt-2 border-t border-slate-700">
          <p className="text-[10px] text-slate-500 uppercase font-bold">Status</p>
          <p className="text-xs text-slate-300 capitalize font-medium mt-0.5">{visit.disposition}</p>
        </div>
      </div>

      {/* === MODALS === */}

      {/* Admit to IPD */}
      <AdmitPatientModal
        open={showAdmitModal}
        onClose={() => setShowAdmitModal(false)}
        hospitalId={hospitalId}
        onAdmitted={() => {
          setShowAdmitModal(false);
          handleDisposition("admitted");
        }}
      />

      {/* STAT Lab */}
      {showLabModal && hospitalId && (
        <NewLabOrderModal
          hospitalId={hospitalId}
          onClose={() => setShowLabModal(false)}
          onCreated={() => {
            setShowLabModal(false);
            toast({ title: "✓ STAT lab order created from ED" });
          }}
        />
      )}

      {/* Refer to OT */}
      {showOTModal && (
        <BookOTModal
          rooms={otRooms}
          selectedRoomId={otRooms[0]?.id || ""}
          selectedDate={new Date().toISOString().slice(0, 10)}
          prefillTime={null}
          initialPatientId={visit.patient_id}
          initialPatientName={visit.patient_name}
          initialDiagnosis={diagnosis || complaint || ""}
          initialUrgency="emergency"
          initialSurgeonId={visit.doctor_id || undefined}
          onClose={() => setShowOTModal(false)}
          onBooked={() => {
            setShowOTModal(false);
            toast({ title: `OT referral raised for ${visit.patient_name}` });
          }}
        />
      )}

      {/* Discharge Confirmation */}
      <AlertDialog open={showDischargeConfirm} onOpenChange={setShowDischargeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Discharge</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discharge <strong>{visit.patient_name}</strong> from the Emergency Department? This will mark the visit as inactive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { handleDisposition("discharged"); setShowDischargeConfirm(false); }}
              className="bg-emerald-600 hover:bg-emerald-700">
              Confirm Discharge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Blood Request Dialog */}
      <Dialog open={showBloodDialog} onOpenChange={setShowBloodDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>🩸 Blood Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Blood Group</label>
              <Select value={bloodGroup} onValueChange={setBloodGroup}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select blood group" /></SelectTrigger>
                <SelectContent>
                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(g => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Component</label>
              <Select value={bloodComponent} onValueChange={setBloodComponent}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Whole Blood", "PRBCs", "FFP", "Platelets", "Cryoprecipitate"].map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Units</label>
              <Input type="number" min="1" max="10" value={bloodUnits} onChange={e => setBloodUnits(e.target.value)} className="mt-1" />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={bloodUrgent} onChange={e => setBloodUrgent(e.target.checked)} className="rounded" />
              <span className="text-sm font-medium text-destructive">Urgent / Emergency</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBloodDialog(false)}>Cancel</Button>
            <Button onClick={handleBloodRequest} disabled={bloodSubmitting} className="bg-red-600 hover:bg-red-700">
              {bloodSubmitting ? "Sending..." : "Send Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Specialist Consult Dialog */}
      <Dialog open={showSpecialistDialog} onOpenChange={setShowSpecialistDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>📟 Call Specialist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Department / Specialty *</label>
              <Select value={specialistDept} onValueChange={setSpecialistDept}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Reason for Consult</label>
              <Textarea value={specialistReason} onChange={e => setSpecialistReason(e.target.value)}
                placeholder="Brief reason for specialist consultation..."
                className="mt-1 resize-none" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSpecialistDialog(false)}>Cancel</Button>
            <Button onClick={handleSpecialistCall} disabled={specialistSubmitting || !specialistDept}
              className="bg-amber-600 hover:bg-amber-700">
              {specialistSubmitting ? "Sending..." : "Send Alert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MLC Summary Dialog */}
      <Dialog open={showMlcDialog} onOpenChange={setShowMlcDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>📄 MLC Register Summary</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Patient:</span> <strong>{visit.patient_name}</strong></div>
              <div><span className="text-muted-foreground">Arrival:</span> {new Date(visit.arrival_time).toLocaleString("en-IN")}</div>
              <div><span className="text-muted-foreground">Police Station:</span> {mlcDetails.police_station || "—"}</div>
              <div><span className="text-muted-foreground">Officer:</span> {mlcDetails.officer || "—"}</div>
              <div><span className="text-muted-foreground">FIR No:</span> {mlcDetails.fir || "—"}</div>
              <div><span className="text-muted-foreground">Injury Type:</span> {mlcDetails.injury_type || "—"}</div>
              <div className="col-span-2"><span className="text-muted-foreground">Chief Complaint:</span> {complaint || "—"}</div>
              <div className="col-span-2"><span className="text-muted-foreground">Working Diagnosis:</span> {diagnosis || "—"}</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMlcDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Triage Attestation */}
      {showTriageAttestation && aiTriageResult && hospitalId && (
        <AIAttestationModal
          open={showTriageAttestation}
          title="AI Triage Assist — Apply Suggested Category"
          feature="triage_assist"
          sourceId={visit.id}
          hospitalId={hospitalId}
          aiOutput={aiTriageResult}
          previewContent={[
            `Suggested urgency: ${aiTriageResult.overall_urgency || "unknown"} → ${mapUrgencyToTriage(aiTriageResult.overall_urgency || "")}`,
            aiTriageResult.red_flags_detected?.length ? `Red flags: ${aiTriageResult.red_flags_detected.join(", ")}` : "",
            aiTriageResult.differentials?.[0] ? `Top Dx: ${aiTriageResult.differentials[0].diagnosis}` : "",
          ].filter(Boolean).join("\n")}
          initialEditableText={mapUrgencyToTriage(aiTriageResult.overall_urgency || "P3")}
          editableLabel="Triage Category to Apply (P1 / P2 / P3 / P4)"
          onAccept={(category) => {
            const cat = category.trim().toUpperCase();
            if (["P1","P2","P3","P4"].includes(cat)) {
              supabase.from("ed_visits").update({ triage_category: cat } as any).eq("id", visit.id).then(() => {
                toast({ title: `Triage updated to ${cat}` });
                setShowTriageAttestation(false);
                setShowTriagePanel(false);
                onRefresh();
              });
            } else {
              toast({ title: "Invalid category", description: "Enter P1, P2, P3, or P4", variant: "destructive" });
            }
          }}
          onDiscard={() => setShowTriageAttestation(false)}
        />
      )}
    </div>
  );
};

const VInput = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) => (
  <div className="flex flex-col">
    <span className="text-[9px] text-slate-500 uppercase font-bold mb-0.5">{label}</span>
    <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="h-8 w-16 text-xs text-white border-slate-600"
      style={{ background: "#0F172A" }} type="number" />
  </div>
);

const ActionBtn = ({ label, bg, onClick }: { label: string; bg: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold text-white hover:opacity-90 active:scale-[0.97] transition-all"
    style={{ background: bg }}
  >{label}</button>
);

const TimelineItem = ({ filled, label, time }: { filled: boolean; label: string; time: string }) => (
  <div className="flex items-start gap-2">
    <div className={cn("w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0 border-2", filled ? "bg-emerald-400 border-emerald-400" : "border-slate-600 bg-transparent")} />
    <div>
      <p className={cn("text-[11px] leading-tight", filled ? "text-slate-300" : "text-slate-600")}>{label}</p>
      {time && <p className="text-[10px] text-slate-500">{time}</p>}
    </div>
  </div>
);

export default EmergencyWorkspace;
