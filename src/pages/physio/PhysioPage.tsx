import React, { useState, useEffect, useCallback } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { calcGST } from "@/lib/currency";
import { postCharge } from "@/lib/chargePosting";
import OutcomeTrajectoryPredictor from "@/components/physio/OutcomeTrajectoryPredictor";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { Plus, ClipboardList, Calendar, BarChart3, Dumbbell, FileText, Activity, CheckCircle, Clock, User, Printer, MessageSquare, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer } from "recharts";

const MODALITIES = ["UST", "IFT", "TENS", "SWD", "Traction", "Exercise", "Manual Therapy", "Hot Pack", "Cold Pack", "Wax Bath", "Hydrotherapy", "Balance Training"];

const EXERCISE_LIBRARY: Record<string, string[]> = {
  Knee: ["Quad sets", "SLR", "Terminal knee extension", "Hamstring stretch"],
  Back: ["Cat-camel", "Bird-dog", "Prone extension", "Core bracing"],
  Shoulder: ["Pendulum", "Wall walk", "Isometric", "Rotator cuff"],
  Hip: ["Bridges", "Clamshells", "Hip abduction", "Hip flexor stretch"],
  Ankle: ["Pumps", "Alphabet", "Theraband", "Single leg balance"],
  General: ["Deep breathing", "Bed mobility", "Transfer practice"],
};

const OUTCOME_TOOLS = [
  { value: "fim", label: "FIM (Functional Independence)", max: 126 },
  { value: "barthel", label: "Barthel Index", max: 100 },
  { value: "vas", label: "VAS Pain Scale", max: 10 },
  { value: "koos", label: "KOOS (Knee Score)", max: 100 },
  { value: "dash", label: "DASH (Arm/Shoulder)", max: 100 },
  { value: "berg_balance", label: "Berg Balance Scale", max: 56 },
  { value: "mrc", label: "MRC Muscle Grade", max: 5 },
  { value: "other", label: "Other", max: 100 },
];

const EQUIPMENT_TYPES = ["ust", "ift", "tens", "swt", "traction", "hydrotherapy", "parallel_bars", "treadmill", "other"];

const PhysioPage: React.FC = () => {
  const { hospitalId, loading: hospitalLoading } = useHospitalId();
  const { toast } = useToast();
  const [tab, setTab] = useState("referrals");

  // KPIs
  const [activeReferrals, setActiveReferrals] = useState(0);
  const [sessionsToday, setSessionsToday] = useState(0);
  const [pendingReferrals, setPendingReferrals] = useState(0);
  const [equipInUse, setEquipInUse] = useState(0);

  // Referrals
  const [referrals, setReferrals] = useState<any[]>([]);
  const [selectedRef, setSelectedRef] = useState<any>(null);
  const [refFilter, setRefFilter] = useState("pending");
  const [refSessions, setRefSessions] = useState<any[]>([]);

  // Sessions
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionModal, setSessionModal] = useState(false);
  const [sForm, setSForm] = useState({ referral_id: "", session_date: format(new Date(), "yyyy-MM-dd"), session_time: "09:00", duration: "30", session_type: "in_clinic", modalities: [] as string[] });
  const [completeModal, setCompleteModal] = useState(false);
  const [completeSession, setCompleteSession] = useState<any>(null);
  const [painBefore, setPainBefore] = useState(5);
  const [painAfter, setPainAfter] = useState(3);
  const [treatmentNotes, setTreatmentNotes] = useState("");
  const [hepGiven, setHepGiven] = useState(false);
  const [romFindings, setRomFindings] = useState("");
  const [mmtGrade, setMmtGrade] = useState("");

  // Outcomes
  const [outcomes, setOutcomes] = useState<any[]>([]);
  const [outcomeModal, setOutcomeModal] = useState(false);
  const [oForm, setOForm] = useState({ referral_id: "", tool: "vas", score: 0, assessment_type: "initial", notes: "" });
  const [outcomeChart, setOutcomeChart] = useState<any[]>([]);

  // Equipment
  const [equipment, setEquipment] = useState<any[]>([]);
  const [equipModal, setEquipModal] = useState(false);
  const [eForm, setEForm] = useState({ equipment_type: "ust", start_time: "", end_time: "", patient_id: "" });

  // HEP
  const [hepPlans, setHepPlans] = useState<any[]>([]);
  const [hepModal, setHepModal] = useState(false);
  const [hepRefId, setHepRefId] = useState("");
  const [hepExercises, setHepExercises] = useState<{ name: string; sets: string; reps: string; hold: string; instructions: string }[]>([]);
  const [hepFreq, setHepFreq] = useState(2);
  const [hepWeeks, setHepWeeks] = useState(4);

  // Active referrals for dropdowns
  const [activeRefList, setActiveRefList] = useState<any[]>([]);

  const loadKPIs = useCallback(async () => {
    const today = format(new Date(), "yyyy-MM-dd");
    const [a, s, p, e] = await Promise.all([
      supabase.from("physio_referrals").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "in_progress"),
      supabase.from("physio_sessions").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("session_date", today),
      supabase.from("physio_referrals").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "pending"),
      supabase.from("physio_equipment_bookings").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "in_use"),
    ]);
    setActiveReferrals(a.count || 0);
    setSessionsToday(s.count || 0);
    setPendingReferrals(p.count || 0);
    setEquipInUse(e.count || 0);
  }, []);

  const loadReferrals = useCallback(async () => {
    let q = supabase.from("physio_referrals").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false });
    if (refFilter === "pending") q = q.eq("status", "pending");
    else if (refFilter === "in_progress") q = q.in("status", ["accepted", "in_progress"]);
    else if (refFilter === "completed") q = q.in("status", ["completed", "discharged"]);
    const { data } = await q.limit(100);
    setReferrals(data || []);

    // Active refs for dropdowns
    const { data: active } = await supabase.from("physio_referrals").select("id, patient_id, diagnosis").eq("hospital_id", hospitalId).in("status", ["accepted", "in_progress"]);
    // Enrich with patient names
    if (active && active.length > 0) {
      const pIds = [...new Set(active.map(r => r.patient_id))];
      const { data: pats } = await supabase.from("patients").select("id, full_name, uhid, phone").in("id", pIds);
      const patMap = new Map((pats || []).map(p => [p.id, p]));
      setActiveRefList(active.map(r => ({ ...r, patient: patMap.get(r.patient_id) })));
    } else {
      setActiveRefList([]);
    }
  }, [refFilter]);

  const loadRefSessions = useCallback(async (refId: string) => {
    const { data } = await supabase.from("physio_sessions").select("*").eq("referral_id", refId).order("session_date", { ascending: false });
    setRefSessions(data || []);
  }, []);

  const loadSessions = useCallback(async () => {
    const today = format(new Date(), "yyyy-MM-dd");
    const { data } = await supabase.from("physio_sessions").select("*, patients(full_name, uhid)").eq("hospital_id", hospitalId).eq("session_date", today).order("session_time");
    setSessions(data || []);
  }, []);

  const loadOutcomes = useCallback(async () => {
    const { data } = await supabase.from("outcome_scores").select("*").eq("hospital_id", hospitalId).order("scored_at", { ascending: false }).limit(100);
    setOutcomes(data || []);
  }, []);

  const loadEquipment = useCallback(async () => {
    const { data } = await supabase.from("physio_equipment_bookings").select("*").eq("hospital_id", hospitalId).order("start_time", { ascending: false }).limit(50);
    setEquipment(data || []);
  }, []);

  const loadHEP = useCallback(async () => {
    const { data } = await supabase.from("hep_plans").select("*").eq("hospital_id", hospitalId).eq("is_active", true).order("created_at", { ascending: false }).limit(50);
    setHepPlans(data || []);
  }, []);

  useEffect(() => { loadKPIs(); loadReferrals(); }, []);
  useEffect(() => {
    if (tab === "referrals") loadReferrals();
    else if (tab === "sessions") loadSessions();
    else if (tab === "outcomes") loadOutcomes();
    else if (tab === "equipment") loadEquipment();
    else if (tab === "hep") { loadHEP(); loadReferrals(); }
  }, [tab, refFilter]);

  useEffect(() => {
    if (selectedRef) loadRefSessions(selectedRef.id);
  }, [selectedRef]);

  // Accept referral
  const acceptReferral = async (id: string) => {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("physio_referrals").update({ status: "accepted", accepted_by: u.user?.id || null, accepted_at: new Date().toISOString() }).eq("id", id);
    toast({ title: "Referral accepted" });
    loadReferrals(); loadKPIs();
    if (selectedRef?.id === id) setSelectedRef({ ...selectedRef, status: "accepted" });
  };

  // Book session
  const bookSession = async () => {
    if (!sForm.referral_id) { toast({ title: "Select a referral", variant: "destructive" }); return; }
    const ref = activeRefList.find(r => r.id === sForm.referral_id);
    const { data: u } = await supabase.auth.getUser();
    const { data: sessionData, error } = await supabase.from("physio_sessions").insert({
      hospital_id: hospitalId,
      referral_id: sForm.referral_id,
      patient_id: ref?.patient_id,
      therapist_id: u.user?.id,
      session_date: sForm.session_date,
      session_time: sForm.session_time,
      duration_minutes: parseInt(sForm.duration),
      session_type: sForm.session_type,
      modalities_used: sForm.modalities,
    }).select("id").maybeSingle();
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    // Update referral status
    await supabase.from("physio_referrals").update({ status: "in_progress" }).eq("id", sForm.referral_id);

    // Payment-first: post charge at session booking time
    if (sessionData?.id && ref?.patient_id && hospitalId) {
      try {
        const { data: admData } = await supabase
          .from("admissions")
          .select("id")
          .eq("hospital_id", hospitalId)
          .eq("patient_id", ref.patient_id)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();

        await postCharge({
          hospitalId,
          patientId: ref.patient_id,
          admissionId: admData?.id || null,
          description: `Physiotherapy session — ${sForm.session_type}`,
          itemType: "physiotherapy",
          quantity: 1,
          sourceModule: "physio",
          sourceId: sessionData.id,
          dedupeKey: `physio:session:${sessionData.id}`,
          orderedBy: u.user?.id || undefined,
        });
      } catch { /* non-blocking */ }
    }

    toast({ title: "Session booked" });
    setSessionModal(false);
    setSForm({ referral_id: "", session_date: format(new Date(), "yyyy-MM-dd"), session_time: "09:00", duration: "30", session_type: "in_clinic", modalities: [] });
    loadSessions(); loadKPIs();
  };

  // Physio billing
  const createPhysioBill = async (session: any) => {
    // Idempotency guard — skip if already billed
    if (session.billed) return;
    const dedupeKey = `physio:session:${session.id}`;

    const { data: rate } = await (supabase as any)
      .from("service_master")
      .select("fee, gst_percent, gst_applicable")
      .eq("hospital_id", hospitalId)
      .ilike("name", "%physio%")
      .maybeSingle();

    const fee = rate?.fee ? Number(rate.fee) : 500;
    const gstPct = rate?.gst_applicable ? (Number(rate.gst_percent) || 0) : 0;
    const gst = calcGST(fee, gstPct);

    const { data: referral } = await (supabase as any)
      .from("physio_referrals")
      .select("admission_id, patient_id")
      .eq("id", session.referral_id)
      .maybeSingle();

    if (referral?.admission_id) {
      const { data: ipdBill } = await supabase
        .from("bills")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("admission_id", referral.admission_id)
        .maybeSingle();

      if (ipdBill) {
        const { data: existingItem } = await (supabase as any)
          .from("bill_line_items").select("id")
          .eq("bill_id", ipdBill.id).eq("source_dedupe_key", dedupeKey).maybeSingle();

        if (!existingItem) {
          await (supabase as any).from("bill_line_items").insert({
            hospital_id: hospitalId,
            bill_id: ipdBill.id,
            item_type: "physio",
            description: `Physiotherapy: ${session.modalities_used?.join(", ") || "Session"} — ${session.session_date}`,
            quantity: 1, unit_rate: fee,
            taxable_amount: fee, gst_percent: gstPct,
            gst_amount: gst, total_amount: fee + gst,
            source_module: "physio",
            source_record_id: session.id,
            source_dedupe_key: dedupeKey,
          });
          const result = await recalculateBillTotalsSafe(ipdBill.id);
          if (!result.ok) console.error("Physio IPD bill recalculation failed:", result.error);
        }
        return;
      }
    }

    // OPD physio — create standalone bill
    const billNum = await generateBillNumber(hospitalId!, "PHYS");

    const { data: newBill } = await supabase
      .from("bills")
      .insert({
        hospital_id: hospitalId,
        patient_id: session.patient_id || referral?.patient_id,
        admission_id: referral?.admission_id || null,
        bill_number: billNum,
        bill_type: "physio",
        bill_date: session.session_date || new Date().toISOString().split("T")[0],
        bill_status: "final",
        payment_status: "unpaid",
        total_amount: fee + gst,
        balance_due: fee + gst,
        subtotal: fee, gst_amount: gst,
        taxable_amount: fee, patient_payable: fee + gst,
      })
      .select("id")
      .maybeSingle();

    if (newBill) {
      await (supabase as any).from("bill_line_items").insert({
        hospital_id: hospitalId, bill_id: newBill.id,
        item_type: "physio",
        description: `Physiotherapy Session — ${session.session_date}`,
        quantity: 1, unit_rate: fee,
        taxable_amount: fee, gst_percent: gstPct,
        gst_amount: gst, total_amount: fee + gst,
        source_module: "physio",
        source_record_id: session.id,
        source_dedupe_key: dedupeKey,
      });

      await recalculateBillTotalsSafe(newBill.id);

      const { data: { user: authUser } } = await supabase.auth.getUser();
      await autoPostJournalEntry({
        triggerEvent: "bill_finalized_physio",
        sourceModule: "physio",
        sourceId: newBill.id,
        amount: fee + gst,
        description: `Physio Revenue - Bill ${billNum}`,
        hospitalId: hospitalId!,
        postedBy: authUser?.id || "",
      });

      toast({ title: `Physio billed: ₹${(fee + gst).toLocaleString("en-IN")}` });
    }
  };

  const printSessionReport = (s: any) => {
    const { printDocument } = require("@/lib/printUtils");
    const patient = (s as any).patients;
    const body = `
      <h2 style="color:#1A2F5A">Physiotherapy Session Report</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px">
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold;width:40%">Patient</td><td style="padding:5px;border:1px solid #ddd">${patient?.full_name || "—"} (${patient?.uhid || "—"})</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold">Date</td><td style="padding:5px;border:1px solid #ddd">${s.session_date}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold">Time</td><td style="padding:5px;border:1px solid #ddd">${s.session_time?.slice(0, 5) || "—"}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold">Duration</td><td style="padding:5px;border:1px solid #ddd">${s.duration_minutes} min</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold">Session Type</td><td style="padding:5px;border:1px solid #ddd">${s.session_type}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold">Modalities</td><td style="padding:5px;border:1px solid #ddd">${(s.modalities_used || []).join(", ") || "—"}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold">Pain VAS — Before</td><td style="padding:5px;border:1px solid #ddd">${s.pain_score_before ?? "—"} / 10</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold">Pain VAS — After</td><td style="padding:5px;border:1px solid #ddd">${s.pain_score_after ?? "—"} / 10</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold">Treatment Notes</td><td style="padding:5px;border:1px solid #ddd;white-space:pre-wrap">${s.treatment_notes || "—"}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ddd;font-weight:bold">HEP Given</td><td style="padding:5px;border:1px solid #ddd">${s.home_exercises_given ? "Yes" : "No"}</td></tr>
      </table>
      <div style="margin-top:40px;display:flex;justify-content:flex-end">
        <div style="text-align:center;width:200px;border-top:1px solid #333;padding-top:4px;font-size:11px">Therapist Signature</div>
      </div>`;
    printDocument("Physio Session Report", body);
  };

  // Complete session
  const completeSessionAction = async () => {
    if (!completeSession) return;
    const notes = [
      treatmentNotes,
      romFindings ? `ROM: ${romFindings}` : "",
      mmtGrade ? `MMT Grade: ${mmtGrade}` : "",
    ].filter(Boolean).join("\n");

    await supabase.from("physio_sessions").update({
      pain_score_before: painBefore,
      pain_score_after: painAfter,
      treatment_notes: notes,
      home_exercises_given: hepGiven,
      attended: true,
      billed: true,
    }).eq("id", completeSession.id);

    // Auto-bill physio session
    await createPhysioBill(completeSession);

    // Increment sessions done
    await supabase.rpc("increment_icd_use_count", { p_code: "" }).then(() => {}); // no-op, manual increment below
    const { data: ref } = await supabase.from("physio_referrals").select("total_sessions_done").eq("id", completeSession.referral_id).maybeSingle();
    if (ref) {
      await supabase.from("physio_referrals").update({ total_sessions_done: (ref.total_sessions_done || 0) + 1 }).eq("id", completeSession.referral_id);
    }
    toast({ title: "Session completed & billed" });
    setCompleteModal(false);
    setCompleteSession(null);
    setTreatmentNotes("");
    setRomFindings("");
    setMmtGrade("");
    loadSessions(); loadKPIs();
  };

  // Save outcome
  const saveOutcome = async () => {
    if (!oForm.referral_id) { toast({ title: "Select a referral", variant: "destructive" }); return; }
    const ref = activeRefList.find(r => r.id === oForm.referral_id);
    const tool = OUTCOME_TOOLS.find(t => t.value === oForm.tool);
    const maxScore = tool?.max || 100;
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("outcome_scores").insert({
      hospital_id: hospitalId,
      patient_id: ref?.patient_id,
      referral_id: oForm.referral_id,
      tool: oForm.tool,
      score: oForm.score,
      max_score: maxScore,
      score_percent: Math.round((oForm.score / maxScore) * 10000) / 100,
      assessment_type: oForm.assessment_type,
      scored_by: u.user?.id,
      notes: oForm.notes || null,
    });
    toast({ title: "Outcome score recorded" });
    setOutcomeModal(false);
    setOForm({ referral_id: "", tool: "vas", score: 0, assessment_type: "initial", notes: "" });
    loadOutcomes();
  };

  // Load outcome chart for a referral
  const loadOutcomeChart = async (refId: string) => {
    const { data } = await supabase.from("outcome_scores").select("tool, score, scored_at, assessment_type").eq("referral_id", refId).order("scored_at");
    setOutcomeChart(data || []);
  };

  // Save HEP
  const saveHEP = async () => {
    if (!hepRefId || hepExercises.length === 0) { toast({ title: "Add exercises", variant: "destructive" }); return; }
    const ref = activeRefList.find(r => r.id === hepRefId);
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("hep_plans").insert({
      hospital_id: hospitalId,
      patient_id: ref?.patient_id,
      referral_id: hepRefId,
      created_by: u.user?.id,
      exercises: hepExercises,
      frequency_per_day: hepFreq,
      duration_weeks: hepWeeks,
    });
    toast({ title: "HEP plan created" });
    setHepModal(false);
    setHepExercises([]);
    setHepRefId("");
    loadHEP();
  };

  const sendHEPWhatsApp = (plan: any) => {
    const ref = activeRefList.find(r => r.id === plan.referral_id);
    const phone = ref?.patient?.phone?.replace(/\D/g, "");
    if (!phone) { toast({ title: "Patient phone not available", variant: "destructive" }); return; }
    const exercises = (plan.exercises || []).map((e: any, i: number) => `${i + 1}. ${e.name} — ${e.sets}×${e.reps} reps, hold ${e.hold}s\n   ${e.instructions || ""}`).join("\n");
    const msg = `🏋️ *Home Exercise Plan*\n\nDo these exercises ${plan.frequency_per_day}× per day for ${plan.duration_weeks} weeks:\n\n${exercises}\n\n⚠️ Stop if pain increases. Contact us immediately.`;
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
    supabase.from("hep_plans").update({ sent_via: ["whatsapp"] }).eq("id", plan.id);
  };

  const toggleModality = (m: string) => {
    setSForm(f => ({ ...f, modalities: f.modalities.includes(m) ? f.modalities.filter(x => x !== m) : [...f.modalities, m] }));
  };

  const addExercise = (name: string) => {
    setHepExercises(prev => [...prev, { name, sets: "3", reps: "10", hold: "5", instructions: "" }]);
  };

  if (hospitalLoading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[52px] border-b border-border shrink-0">
        <h1 className="text-base font-bold text-foreground">🦿 Physiotherapy & Rehabilitation</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { loadReferrals(); setTab("referrals"); }}>
            <ClipboardList size={14} className="mr-1" />Accept Referral
          </Button>
          <Button size="sm" onClick={() => { loadReferrals(); setSessionModal(true); }}>
            <Plus size={14} className="mr-1" />Book Session
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-2 shrink-0">
        {[
          { label: "Active Referrals", value: activeReferrals, icon: Activity, color: "text-blue-600" },
          { label: "Sessions Today", value: sessionsToday, icon: Calendar, color: "text-green-600" },
          { label: "Pending Referrals", value: pendingReferrals, icon: Clock, color: pendingReferrals > 0 ? "text-amber-600" : "text-muted-foreground" },
          { label: "Equipment In Use", value: equipInUse, icon: Dumbbell, color: "text-purple-600" },
        ].map(k => (
          <Card key={k.label} className="p-3 flex items-center gap-3">
            <k.icon size={20} className={k.color} />
            <div>
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-lg font-bold font-mono">{k.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden px-4">
        <TabsList className="shrink-0 w-fit">
          <TabsTrigger value="referrals">📋 Referrals</TabsTrigger>
          <TabsTrigger value="sessions">📅 Sessions</TabsTrigger>
          <TabsTrigger value="outcomes">📊 Outcomes</TabsTrigger>
          <TabsTrigger value="equipment">🏋️ Equipment</TabsTrigger>
          <TabsTrigger value="hep">📄 HEP</TabsTrigger>
        </TabsList>

        {/* TAB 1 — Referrals */}
        <TabsContent value="referrals" className="flex-1 overflow-hidden">
          <div className="flex gap-3 h-full">
            <div className="w-[300px] shrink-0 flex flex-col border rounded-lg">
              <div className="p-2 border-b flex gap-1 flex-wrap">
                {["pending", "in_progress", "completed", "all"].map(f => (
                  <Button key={f} size="sm" variant={refFilter === f ? "default" : "ghost"} className="text-xs h-7" onClick={() => setRefFilter(f)}>
                    {f === "pending" ? "Pending" : f === "in_progress" ? "Active" : f === "completed" ? "Done" : "All"}
                  </Button>
                ))}
              </div>
              <ScrollArea className="flex-1">
                {referrals.length === 0 && <p className="p-4 text-sm text-muted-foreground text-center">No referrals</p>}
                {referrals.map(r => (
                  <button key={r.id} onClick={() => setSelectedRef(r)}
                    className={`w-full text-left p-3 border-b hover:bg-muted/50 transition ${selectedRef?.id === r.id ? "bg-muted" : ""}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={r.urgency === "urgent" ? "destructive" : "secondary"} className="text-[10px]">{r.urgency}</Badge>
                      <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                    </div>
                    <p className="text-sm font-medium truncate">{r.diagnosis}</p>
                    <p className="text-xs text-muted-foreground">{r.total_sessions_done || 0}/{r.total_sessions_planned || "?"} sessions</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{format(new Date(r.created_at), "dd/MM/yy")}</p>
                  </button>
                ))}
              </ScrollArea>
            </div>
            <div className="flex-1 border rounded-lg overflow-hidden">
              {!selectedRef ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Select a referral</div>
              ) : (
                <ScrollArea className="h-full p-4">
                  <div className="space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-lg">{selectedRef.diagnosis}</h3>
                        {selectedRef.icd_code && <p className="text-xs text-muted-foreground font-mono">{selectedRef.icd_code}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Badge variant={selectedRef.urgency === "urgent" ? "destructive" : "secondary"}>{selectedRef.urgency}</Badge>
                        <Badge variant="outline">{selectedRef.status}</Badge>
                      </div>
                    </div>

                    {selectedRef.goals && selectedRef.goals.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {selectedRef.goals.map((g: string, i: number) => <Badge key={i} variant="outline" className="text-xs">{g}</Badge>)}
                      </div>
                    )}

                    {selectedRef.precautions && (
                      <Card className="p-3 bg-amber-50 dark:bg-amber-950/20 border-amber-200">
                        <p className="text-xs font-medium text-amber-700">⚠️ Precautions: {selectedRef.precautions}</p>
                      </Card>
                    )}

                    <div className="text-sm text-muted-foreground">
                      <p>Sessions: {selectedRef.total_sessions_done || 0} / {selectedRef.total_sessions_planned || "—"}</p>
                      <p>Referral date: {format(new Date(selectedRef.referral_date), "dd/MM/yyyy")}</p>
                    </div>

                    {selectedRef.status === "pending" && (
                      <Button size="sm" onClick={() => acceptReferral(selectedRef.id)} className="bg-green-600 hover:bg-green-700">
                        <CheckCircle size={14} className="mr-1" />Accept Referral
                      </Button>
                    )}

                    {(selectedRef.status === "accepted" || selectedRef.status === "in_progress") && (
                      <Button size="sm" onClick={() => { setSForm(f => ({ ...f, referral_id: selectedRef.id })); setSessionModal(true); }}>
                        <Plus size={14} className="mr-1" />Book Session
                      </Button>
                    )}

                    {/* Session history */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Session History</h4>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead>Modalities</TableHead>
                            <TableHead>Pain</TableHead>
                            <TableHead>Notes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {refSessions.map(s => (
                            <TableRow key={s.id}>
                              <TableCell className="text-xs">{format(new Date(s.session_date), "dd/MM")}</TableCell>
                              <TableCell className="text-xs">{s.duration_minutes}min</TableCell>
                              <TableCell className="text-xs">{(s.modalities_used || []).join(", ")}</TableCell>
                              <TableCell className="text-xs font-mono">{s.pain_score_before ?? "—"}→{s.pain_score_after ?? "—"}</TableCell>
                              <TableCell className="text-xs max-w-[150px] truncate">{s.treatment_notes || "—"}</TableCell>
                            </TableRow>
                          ))}
                          {refSessions.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No sessions yet</TableCell></TableRow>}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </TabsContent>

        {/* TAB 2 — Sessions */}
        <TabsContent value="sessions" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full border rounded-lg">
            <div className="p-3">
              <h3 className="text-sm font-semibold mb-3">Today's Sessions — {format(new Date(), "dd/MM/yyyy")}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Modalities</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.session_time?.slice(0, 5)}</TableCell>
                      <TableCell className="text-xs">{s.duration_minutes}min</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{s.session_type}</Badge></TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{(s.modalities_used || []).join(", ")}</TableCell>
                      <TableCell>{s.billed ? <Badge className="bg-green-100 text-green-700 text-[10px]">Done</Badge> : <Badge variant="outline" className="text-[10px]">Scheduled</Badge>}</TableCell>
                      <TableCell>
                        {!s.billed ? (
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { setCompleteSession(s); setPainBefore(5); setPainAfter(3); setTreatmentNotes(""); setRomFindings(""); setMmtGrade(""); setCompleteModal(true); }}>
                            ✓ Complete
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => printSessionReport(s)}>
                            <Printer size={12} className="mr-1" /> Print
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {sessions.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No sessions today</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* TAB 3 — Outcomes */}
        <TabsContent value="outcomes" className="flex-1 overflow-hidden">
          <div className="flex flex-col h-full gap-3">
            <div className="flex justify-between items-center shrink-0">
              <h3 className="text-sm font-semibold">Outcome Assessments</h3>
              <Button size="sm" onClick={() => { loadReferrals(); setOutcomeModal(true); }}><Plus size={14} className="mr-1" />Record Score</Button>
            </div>
            <div className="grid grid-cols-2 gap-3 flex-1 overflow-hidden">
              <ScrollArea className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tool</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>%</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outcomes.map(o => (
                      <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50" onClick={() => loadOutcomeChart(o.referral_id)}>
                        <TableCell className="text-xs font-medium">{o.tool.toUpperCase()}</TableCell>
                        <TableCell className="font-mono text-xs">{o.score}/{o.max_score}</TableCell>
                        <TableCell className="font-mono text-xs">{o.score_percent}%</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{o.assessment_type}</Badge></TableCell>
                        <TableCell className="text-xs">{format(new Date(o.scored_at), "dd/MM/yy")}</TableCell>
                      </TableRow>
                    ))}
                    {outcomes.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No outcomes recorded</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </ScrollArea>
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-2">Progress Chart</h4>
                {outcomeChart.length >= 2 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={outcomeChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="scored_at" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <ReTooltip />
                      <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-muted-foreground text-center py-16">Click a score row with 2+ assessments to see progress</p>}
                {outcomeChart.length > 0 && (
                  <OutcomeTrajectoryPredictor
                    referralId={outcomes[0]?.referral_id || ""}
                    diagnosis={activeRefList.find(r => r.id === outcomes[0]?.referral_id)?.diagnosis || "Unknown"}
                    scores={outcomeChart.map((o: any) => ({ tool: o.tool, score: o.score, max_score: 100, assessment_type: o.assessment_type }))}
                  />
                )}
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* TAB 4 — Equipment */}
        <TabsContent value="equipment" className="flex-1 overflow-hidden">
          <div className="flex flex-col h-full gap-3">
            <div className="flex justify-between items-center shrink-0">
              <h3 className="text-sm font-semibold">Equipment Bookings</h3>
              <Button size="sm" onClick={() => setEquipModal(true)}><Plus size={14} className="mr-1" />Book Equipment</Button>
            </div>
            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm font-medium uppercase">{e.equipment_type}</TableCell>
                      <TableCell className="text-xs">{e.start_time ? format(new Date(e.start_time), "HH:mm") : "—"}</TableCell>
                      <TableCell className="text-xs">{e.end_time ? format(new Date(e.end_time), "HH:mm") : "—"}</TableCell>
                      <TableCell><Badge variant={e.status === "in_use" ? "default" : "outline"} className="text-[10px]">{e.status}</Badge></TableCell>
                      <TableCell>
                        {e.status === "booked" && (
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={async () => {
                            await supabase.from("physio_equipment_bookings").update({ status: "in_use" }).eq("id", e.id);
                            toast({ title: "Equipment in use" }); loadEquipment(); loadKPIs();
                          }}>Start</Button>
                        )}
                        {e.status === "in_use" && (
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={async () => {
                            await supabase.from("physio_equipment_bookings").update({ status: "completed" }).eq("id", e.id);
                            toast({ title: "Equipment freed" }); loadEquipment(); loadKPIs();
                          }}>Complete</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {equipment.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No bookings</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* TAB 5 — HEP */}
        <TabsContent value="hep" className="flex-1 overflow-hidden">
          <div className="flex flex-col h-full gap-3">
            <div className="flex justify-between items-center shrink-0">
              <h3 className="text-sm font-semibold">Home Exercise Plans</h3>
              <Button size="sm" onClick={() => { loadReferrals(); setHepModal(true); }}><Plus size={14} className="mr-1" />New HEP</Button>
            </div>
            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Exercises</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hepPlans.map(h => {
                    const ref = activeRefList.find(r => r.id === h.referral_id);
                    return (
                      <TableRow key={h.id}>
                        <TableCell className="text-sm">{ref?.patient?.full_name || "—"}</TableCell>
                        <TableCell className="text-xs">{(h.exercises || []).length} exercises</TableCell>
                        <TableCell className="text-xs">{h.frequency_per_day}×/day</TableCell>
                        <TableCell className="text-xs">{h.duration_weeks} weeks</TableCell>
                        <TableCell>{(h.sent_via || []).includes("whatsapp") ? <Badge className="bg-green-100 text-green-700 text-[10px]">WhatsApp ✓</Badge> : <Badge variant="outline" className="text-[10px]">Not sent</Badge>}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => sendHEPWhatsApp(h)} title="WhatsApp">
                              <MessageSquare size={12} />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => {
                              const w = window.open("", "_blank", "noopener,noreferrer");
                              if (!w) return;
                              const exList = (h.exercises || []).map((e: any, i: number) => `<li><strong>${e.name}</strong> — ${e.sets}×${e.reps} reps, hold ${e.hold}s<br/><em>${e.instructions || ""}</em></li>`).join("");
                              w.document.write(`<html><head><title>HEP</title></head><body style="font-family:sans-serif;padding:40px;max-width:700px;margin:auto"><h2>Home Exercise Plan</h2><p>Do these exercises ${h.frequency_per_day}× per day for ${h.duration_weeks} weeks</p><ol>${exList}</ol><p style="color:red;margin-top:20px">⚠️ Stop if pain increases. Contact hospital immediately.</p></body></html>`);
                              w.document.close();
                              w.print();
                            }} title="Print">
                              <Printer size={12} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {hepPlans.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No HEP plans</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>

      {/* Book Session Modal */}
      <Dialog open={sessionModal} onOpenChange={setSessionModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Book Physio Session</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={sForm.referral_id} onValueChange={v => setSForm(f => ({ ...f, referral_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select referral..." /></SelectTrigger>
              <SelectContent>
                {activeRefList.map(r => <SelectItem key={r.id} value={r.id}>{r.patient?.full_name} — {r.diagnosis}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={sForm.session_date} onChange={e => setSForm(f => ({ ...f, session_date: e.target.value }))} />
              <Input type="time" value={sForm.session_time} onChange={e => setSForm(f => ({ ...f, session_time: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              {["30", "45", "60"].map(d => (
                <Button key={d} size="sm" variant={sForm.duration === d ? "default" : "outline"} className="text-xs" onClick={() => setSForm(f => ({ ...f, duration: d }))}>{d} min</Button>
              ))}
            </div>
            <Select value={sForm.session_type} onValueChange={v => setSForm(f => ({ ...f, session_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["in_clinic", "bedside_ip", "home_visit", "tele"].map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <div>
              <p className="text-xs font-medium mb-1">Modalities</p>
              <div className="flex flex-wrap gap-1">
                {MODALITIES.map(m => (
                  <Button key={m} size="sm" variant={sForm.modalities.includes(m) ? "default" : "outline"} className="text-[10px] h-6 px-2" onClick={() => toggleModality(m)}>{m}</Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={bookSession}>Book Session</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Session Modal */}
      <Dialog open={completeModal} onOpenChange={setCompleteModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Complete Session</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium mb-1">Pain Before (VAS 0-10): {painBefore}</p>
              <Slider value={[painBefore]} onValueChange={([v]) => setPainBefore(v)} min={0} max={10} step={1} />
            </div>
            <div>
              <p className="text-xs font-medium mb-1">Pain After (VAS 0-10): {painAfter}</p>
              <Slider value={[painAfter]} onValueChange={([v]) => setPainAfter(v)} min={0} max={10} step={1} />
            </div>
            <Textarea placeholder="Treatment notes..." value={treatmentNotes} onChange={e => setTreatmentNotes(e.target.value)} rows={3} />
            <div className="flex items-center gap-2">
              <Switch checked={hepGiven} onCheckedChange={setHepGiven} />
              <span className="text-xs">HEP given</span>
            </div>
            <div className="space-y-2 pt-2 border-t border-border">
              <p className="text-xs font-medium text-muted-foreground">Assessment Findings (optional)</p>
              <Input
                placeholder="ROM e.g. Knee F: 0-110°, Hip F: 0-90°"
                value={romFindings}
                onChange={e => setRomFindings(e.target.value)}
                className="h-8 text-xs"
              />
              <Select value={mmtGrade} onValueChange={setMmtGrade}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="MMT Grade (optional)" /></SelectTrigger>
                <SelectContent>
                  {[["0","No contraction"],["1","Trace contraction"],["2","Gravity eliminated"],["3","Against gravity"],["4","Some resistance"],["5","Normal strength"]].map(([g, desc]) => (
                    <SelectItem key={g} value={g} className="text-xs">Grade {g} — {desc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={completeSessionAction}>Complete & Bill</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Outcome Modal */}
      <Dialog open={outcomeModal} onOpenChange={setOutcomeModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record Outcome Score</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={oForm.referral_id} onValueChange={v => setOForm(f => ({ ...f, referral_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select referral..." /></SelectTrigger>
              <SelectContent>
                {activeRefList.map(r => <SelectItem key={r.id} value={r.id}>{r.patient?.full_name} — {r.diagnosis}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={oForm.tool} onValueChange={v => setOForm(f => ({ ...f, tool: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OUTCOME_TOOLS.map(t => <SelectItem key={t.value} value={t.value}>{t.label} (/{t.max})</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={oForm.assessment_type} onValueChange={v => setOForm(f => ({ ...f, assessment_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["initial", "interim", "discharge"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <div>
              <p className="text-xs font-medium mb-1">Score: {oForm.score}</p>
              <Slider value={[oForm.score]} onValueChange={([v]) => setOForm(f => ({ ...f, score: v }))} min={0} max={OUTCOME_TOOLS.find(t => t.value === oForm.tool)?.max || 100} step={1} />
            </div>
            <Textarea placeholder="Notes..." value={oForm.notes} onChange={e => setOForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
          <DialogFooter><Button onClick={saveOutcome}>Save Score</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Equipment Booking Modal */}
      <Dialog open={equipModal} onOpenChange={setEquipModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Book Equipment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={eForm.equipment_type} onValueChange={v => setEForm(f => ({ ...f, equipment_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EQUIPMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="datetime-local" value={eForm.start_time} onChange={e => setEForm(f => ({ ...f, start_time: e.target.value }))} />
            <Input type="datetime-local" value={eForm.end_time} onChange={e => setEForm(f => ({ ...f, end_time: e.target.value }))} />
          </div>
          <DialogFooter><Button onClick={async () => {
            if (!eForm.start_time || !eForm.end_time) { toast({ title: "Set times", variant: "destructive" }); return; }
            const { data: u } = await supabase.auth.getUser();
            await supabase.from("physio_equipment_bookings").insert({
              hospital_id: hospitalId,
              equipment_type: eForm.equipment_type,
              booked_for: u.user?.id,
              start_time: new Date(eForm.start_time).toISOString(),
              end_time: new Date(eForm.end_time).toISOString(),
            });
            toast({ title: "Equipment booked" });
            setEquipModal(false);
            loadEquipment(); loadKPIs();
          }}>Book</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HEP Builder Modal */}
      <Dialog open={hepModal} onOpenChange={setHepModal}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
          <DialogHeader><DialogTitle>Create Home Exercise Plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={hepRefId} onValueChange={setHepRefId}>
              <SelectTrigger><SelectValue placeholder="Select referral..." /></SelectTrigger>
              <SelectContent>
                {activeRefList.map(r => <SelectItem key={r.id} value={r.id}>{r.patient?.full_name} — {r.diagnosis}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs font-medium mb-1">Frequency / day</p>
                <Input type="number" value={hepFreq} onChange={e => setHepFreq(parseInt(e.target.value) || 2)} min={1} max={6} />
              </div>
              <div>
                <p className="text-xs font-medium mb-1">Duration (weeks)</p>
                <Input type="number" value={hepWeeks} onChange={e => setHepWeeks(parseInt(e.target.value) || 4)} min={1} max={24} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold mb-2">Exercise Library</p>
              {Object.entries(EXERCISE_LIBRARY).map(([group, exercises]) => (
                <div key={group} className="mb-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">{group}</p>
                  <div className="flex flex-wrap gap-1">
                    {exercises.map(ex => (
                      <Button key={ex} size="sm" variant="outline" className="text-[10px] h-6 px-2" onClick={() => addExercise(ex)}>{ex}</Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {hepExercises.length > 0 && (
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold">Plan ({hepExercises.length} exercises)</p>
                {hepExercises.map((ex, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-mono w-5">{i + 1}.</span>
                    <span className="flex-1 font-medium">{ex.name}</span>
                    <Input className="w-12 h-6 text-[10px]" value={ex.sets} onChange={e => { const n = [...hepExercises]; n[i].sets = e.target.value; setHepExercises(n); }} placeholder="Sets" />
                    <span className="text-muted-foreground">×</span>
                    <Input className="w-12 h-6 text-[10px]" value={ex.reps} onChange={e => { const n = [...hepExercises]; n[i].reps = e.target.value; setHepExercises(n); }} placeholder="Reps" />
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => setHepExercises(prev => prev.filter((_, j) => j !== i))}>×</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter><Button onClick={saveHEP} disabled={hepExercises.length === 0}>Save HEP</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PhysioPage;
