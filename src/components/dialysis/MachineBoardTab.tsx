import React, { useState, useEffect } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { calcGST } from "@/lib/currency";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { postCharge } from "@/lib/chargePosting";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useConfigValues } from "@/hooks/useConfigValues";
import { Play, CheckCircle, ShieldX, Plus, Pencil, Power } from "lucide-react";

interface Props { onRefresh: () => void }

const TYPE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  clean: { bg: "bg-green-100", text: "text-green-700", label: "CLEAN" },
  hbv: { bg: "bg-amber-100", text: "text-amber-700", label: "HBV DEDICATED" },
  hcv: { bg: "bg-red-100", text: "text-red-700", label: "HCV DEDICATED" },
  hiv: { bg: "bg-purple-100", text: "text-purple-700", label: "HIV DEDICATED" },
  universal: { bg: "bg-muted", text: "text-muted-foreground", label: "UNIVERSAL" },
};

const STATUS_DOT: Record<string, string> = {
  available: "bg-green-500",
  in_use: "bg-blue-500 animate-pulse",
  disinfecting: "bg-amber-500",
  maintenance: "bg-muted-foreground",
  out_of_service: "bg-red-500",
};


const MachineBoardTab: React.FC<Props> = ({ onRefresh }) => {
  const { toast } = useToast();
  const complicationOptions = useConfigValues("dialysis_complications");
  const [machines, setMachines] = useState<any[]>([]);
  const [activeSessions, setActiveSessions] = useState<Record<string, any>>({});
  const [patients, setPatients] = useState<any[]>([]);

  // Start session state
  const [startMachine, setStartMachine] = useState<any>(null);
  const [step, setStep] = useState(1);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [safetyBlock, setSafetyBlock] = useState<string | null>(null);
  const [patientSearch, setPatientSearch] = useState("");

  // Pre-dialysis vitals
  const [preWeight, setPreWeight] = useState("");
  const [preBpSys, setPreBpSys] = useState("");
  const [preBpDia, setPreBpDia] = useState("");
  const [prePulse, setPrePulse] = useState("");
  const [preTemp, setPreTemp] = useState("");
  const [bloodFlow, setBloodFlow] = useState("300");
  const [dialysateFlow, setDialysateFlow] = useState("500");
  const [heparinDose, setHeparinDose] = useState("5000");
  const [dialyzerId, setDialyzerId] = useState("");

  // Add/Edit machine state
  const [machineModal, setMachineModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [mName, setMName] = useState("");
  const [mModel, setMModel] = useState("");
  const [mType, setMType] = useState("clean");
  

  // End session state
  const [endMachine, setEndMachine] = useState<any>(null);
  const [postWeight, setPostWeight] = useState("");
  const [postBpSys, setPostBpSys] = useState("");
  const [postBpDia, setPostBpDia] = useState("");
  const [postPulse, setPostPulse] = useState("");
  const [ureaPre, setUreaPre] = useState("");
  const [ureaPost, setUreaPost] = useState("");
  const [ufAchieved, setUfAchieved] = useState("");
  const [complications, setComplications] = useState<string[]>([]);
  const [sessionNotes, setSessionNotes] = useState("");

  const fetchData = async () => {
    const [mRes, sRes, pRes] = await Promise.all([
      (supabase as any).from("dialysis_machines").select("*").eq("is_active", true).order("machine_name"),
      (supabase as any).from("dialysis_sessions").select("*, dialysis_patients(*, patients(full_name))").eq("status", "in_progress"),
      (supabase as any).from("dialysis_patients").select("*, patients(full_name, uhid)").eq("is_active", true),
    ]);

    // Auto-transition disinfecting machines back to available after 30 min
    if (mRes.data) {
      const now = new Date();
      for (const m of mRes.data) {
        if (m.status === "disinfecting" && m.disinfection_due_at && new Date(m.disinfection_due_at) <= now) {
          await (supabase as any).from("dialysis_machines").update({ status: "available" }).eq("id", m.id);
          m.status = "available";
        }
      }
      setMachines(mRes.data);
    }
    if (sRes.data) {
      const map: Record<string, any> = {};
      sRes.data.forEach((s: any) => { map[s.machine_id] = s; });
      setActiveSessions(map);
    }
    if (pRes.data) setPatients(pRes.data);
  };

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 60000); return () => clearInterval(iv); }, []);

  const checkCompatibility = (patient: any, machine: any): string | null => {
    const pType = patient.machine_type_required;
    const mType = machine.machine_type;
    if (mType === "universal") return null;
    if (pType === "clean" && mType !== "clean") {
      return `${patient.patients?.full_name} is HBsAg NEGATIVE (Clean patient).\nThis is ${machine.machine_name} — ${mType.toUpperCase()} DEDICATED.\nAssigning a negative patient to a ${mType.toUpperCase()} machine is a CROSS-INFECTION RISK.\nThis assignment CANNOT be made.`;
    }
    if (pType === "hbv" && mType !== "hbv") {
      return `${patient.patients?.full_name} is HBsAg POSITIVE and requires an HBV dedicated machine.\nThis is ${machine.machine_name} — ${mType.toUpperCase()} machine.\nAssigning an HBV+ patient to a ${mType.toUpperCase()} machine is a CROSS-CONTAMINATION RISK.\nThis assignment CANNOT be made.`;
    }
    if (pType === "hcv" && mType !== "hcv") {
      return `${patient.patients?.full_name} is HCV POSITIVE and requires an HCV dedicated machine.\nThis is ${machine.machine_name} — ${mType.toUpperCase()} machine.\nThis assignment CANNOT be made.`;
    }
    if (pType === "hiv" && mType !== "hiv") {
      return `${patient.patients?.full_name} is HIV POSITIVE and requires an HIV dedicated machine.\nThis assignment CANNOT be made.`;
    }
    if (pType === "isolated" && mType === "clean") {
      return `${patient.patients?.full_name} has UNKNOWN serology and requires an isolated machine.\nClean machines are reserved for confirmed-negative patients.\nThis assignment CANNOT be made.`;
    }
    return null;
  };

  const selectPatient = (p: any) => {
    const block = checkCompatibility(p, startMachine);
    if (block) {
      setSafetyBlock(block);
      return;
    }
    setSelectedPatient(p);
    setStep(3);
  };

  const checkDialyzerReuse = async (dId: string, patientId: string): Promise<string | null> => {
    if (!dId) return null;
    const { data } = await (supabase as any).from("dialysis_sessions")
      .select("dialysis_patient_id, dialysis_patients(patients(full_name))")
      .eq("dialyzer_id", dId)
      .neq("dialysis_patient_id", patientId)
      .limit(1);
    if (data && data.length > 0) {
      return `HARD BLOCK: Dialyzer "${dId}" was previously used by ${data[0].dialysis_patients?.patients?.full_name || "another patient"}.\nDialyzers CANNOT be reused across different patients — infection risk.\nThis session CANNOT proceed with this dialyzer.`;
    }
    return null;
  };

  const startSession = async () => {
    if (!selectedPatient || !startMachine) return;

    // Dialyzer reuse check
    if (dialyzerId) {
      const reuseBlock = await checkDialyzerReuse(dialyzerId, selectedPatient.id);
      if (reuseBlock) {
        setSafetyBlock(reuseBlock);
        return;
      }
    }

    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;

    const ufGoal = selectedPatient.dry_weight_kg ? Math.round((parseFloat(preWeight) - selectedPatient.dry_weight_kg) * 1000) : null;

    await (supabase as any).from("dialysis_sessions").insert({
      hospital_id: user.hospital_id,
      dialysis_patient_id: selectedPatient.id,
      machine_id: startMachine.id,
      session_date: new Date().toISOString().split("T")[0],
      scheduled_start: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      started_at: new Date().toISOString(),
      pre_weight_kg: parseFloat(preWeight) || null,
      pre_bp_systolic: parseInt(preBpSys) || null,
      pre_bp_diastolic: parseInt(preBpDia) || null,
      pre_pulse: parseInt(prePulse) || null,
      pre_temp: parseFloat(preTemp) || null,
      blood_flow_rate_ml: parseInt(bloodFlow) || 300,
      dialysate_flow_rate: parseInt(dialysateFlow) || 500,
      heparin_dose_units: parseInt(heparinDose) || null,
      uf_goal_ml: ufGoal && ufGoal > 0 ? ufGoal : null,
      dialyzer_id: dialyzerId || null,
      status: "in_progress",
      performed_by: user.id,
    });

    await (supabase as any).from("dialysis_machines").update({ status: "in_use", current_patient_id: selectedPatient.patient_id }).eq("id", startMachine.id);

    // Payment-first: post charge at session start
    try {
      const { data: admData } = await supabase
        .from("admissions")
        .select("id")
        .eq("hospital_id", user.hospital_id)
        .eq("patient_id", selectedPatient.patient_id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      await postCharge({
        hospitalId: user.hospital_id,
        patientId: selectedPatient.patient_id,
        admissionId: admData?.id || null,
        description: `Dialysis session — ${startMachine.machine_name}`,
        itemType: "dialysis",
        quantity: 1,
        sourceModule: "dialysis",
        sourceId: startMachine.id,
        dedupeKey: `dialysis:session:${new Date().toISOString().slice(0, 10)}:${selectedPatient.id}:${startMachine.id}`,
        orderedBy: user.id,
      });
    } catch { /* non-blocking */ }

    toast({ title: `Session started on ${startMachine.machine_name}` });
    resetStartForm();
    fetchData();
    onRefresh();
  };

  const createDialysisBill = async (session: any, hospitalId: string) => {
    // Idempotency guard — skip if already billed
    if (session.billing_status === "billed") return;

    const { data: dialysisPatient } = await (supabase as any)
      .from("dialysis_patients")
      .select("patient_id")
      .eq("id", session.dialysis_patient_id)
      .maybeSingle();

    if (!dialysisPatient) return;

    const { data: admission } = await supabase
      .from("admissions")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("patient_id", dialysisPatient.patient_id)
      .eq("status", "admitted")
      .maybeSingle();

    const { data: rate } = await (supabase as any)
      .from("service_master")
      .select("fee, gst_percent, gst_applicable")
      .eq("hospital_id", hospitalId)
      .ilike("name", "%dialysis%")
      .maybeSingle();

    const fee = rate?.fee ? Number(rate.fee) : 1500;
    const gstPct = rate?.gst_applicable ? (Number(rate.gst_percent) || 0) : 0;
    const gst = calcGST(fee, gstPct);

    const sessionDate = session.session_date || new Date().toISOString().split("T")[0];

    if (admission?.id) {
      const { data: ipdBill } = await supabase
        .from("bills")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("admission_id", admission.id)
        .eq("bill_type", "ipd")
        .maybeSingle();

      if (ipdBill?.id) {
        const dedupeKey = `dialysis:session:${session.id}`;
        const { data: existingItem } = await (supabase as any)
          .from("bill_line_items")
          .select("id")
          .eq("bill_id", ipdBill.id)
          .eq("source_dedupe_key", dedupeKey)
          .maybeSingle();

        if (!existingItem) {
          await (supabase as any).from("bill_line_items").insert({
            hospital_id: hospitalId,
            bill_id: ipdBill.id,
            item_type: "dialysis",
            description: `Dialysis Session — ${sessionDate}`,
            quantity: 1, unit_rate: fee,
            taxable_amount: fee, gst_percent: gstPct,
            gst_amount: gst, total_amount: fee + gst,
            hsn_code: "999316", source_module: "dialysis",
            source_record_id: session.id,
            source_dedupe_key: dedupeKey,
          });
          const result = await recalculateBillTotalsSafe(ipdBill.id);
          if (!result.ok) console.error("Dialysis IPD bill recalculation failed:", result.error);
        }

        // Mark session as billed
        await (supabase as any).from("dialysis_sessions").update({
          billing_status: "billed", bill_id: ipdBill.id, billed_at: new Date().toISOString(),
        }).eq("id", session.id);
        return;
      }
    }

    // Outpatient dialysis — create standalone bill
    const billNum = await generateBillNumber(hospitalId, "DIAL");

    const { data: newBill } = await supabase
      .from("bills")
      .insert({
        hospital_id: hospitalId,
        patient_id: dialysisPatient.patient_id,
        admission_id: admission?.id || null,
        bill_number: billNum,
        bill_type: "dialysis",
        bill_date: sessionDate,
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
        item_type: "dialysis",
        description: `Haemodialysis Session — ${sessionDate}`,
        quantity: 1, unit_rate: fee,
        taxable_amount: fee, gst_percent: gstPct,
        gst_amount: gst, total_amount: fee + gst,
        hsn_code: "999316", source_module: "dialysis",
        source_record_id: session.id,
        source_dedupe_key: `dialysis:session:${session.id}`,
      });
      await recalculateBillTotalsSafe(newBill.id);

      // Mark session as billed
      await (supabase as any).from("dialysis_sessions").update({
        billing_status: "billed", bill_id: newBill.id, billed_at: new Date().toISOString(),
      }).eq("id", session.id);

      toast({ title: `Dialysis billed: ₹${(fee + gst).toLocaleString("en-IN")}` });

      const { data: { user: authUser } } = await supabase.auth.getUser();
      await autoPostJournalEntry({
        triggerEvent: "bill_finalized_dialysis",
        sourceModule: "dialysis",
        sourceId: newBill.id,
        amount: fee + gst,
        description: `Dialysis Revenue - Bill ${billNum}`,
        hospitalId,
        postedBy: authUser?.id || "",
      });
    }
  };

  const endSession = async () => {
    if (!endMachine) return;
    const session = activeSessions[endMachine.id];
    if (!session) return;

    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();

    // Kt/V calculation (Daugirdas second-generation)
    let ktv: number | null = null;
    const uPre = parseFloat(ureaPre);
    const uPost = parseFloat(ureaPost);
    const postW = parseFloat(postWeight);
    const uf = parseFloat(ufAchieved);
    if (uPre > 0 && uPost > 0 && postW > 0 && session.started_at) {
      const t = (Date.now() - new Date(session.started_at).getTime()) / 3600000;
      const r = uPost / uPre;
      ktv = parseFloat((-Math.log(r - 0.008 * t) + (4 - 3.5 * r) * (uf || 0) / 1000 / postW).toFixed(2));
    }

    await (supabase as any).from("dialysis_sessions").update({
      ended_at: new Date().toISOString(),
      post_weight_kg: postW || null,
      post_bp_systolic: parseInt(postBpSys) || null,
      post_bp_diastolic: parseInt(postBpDia) || null,
      post_pulse: parseInt(postPulse) || null,
      urea_pre: uPre || null,
      urea_post: uPost || null,
      uf_achieved_ml: parseInt(ufAchieved) || null,
      kt_v: ktv,
      complications: complications.length > 0 ? complications : null,
      session_notes: sessionNotes || null,
      status: "completed",
    }).eq("id", session.id);

    // Machine → disinfecting for 30 min, then auto-available
    const disinfectUntil = new Date(Date.now() + 30 * 60000).toISOString();
    await (supabase as any).from("dialysis_machines").update({
      status: "disinfecting",
      current_patient_id: null,
      last_disinfected_at: new Date().toISOString(),
      disinfection_due_at: disinfectUntil,
    }).eq("id", endMachine.id);

    // Auto-bill dialysis session
    if (user) {
      await createDialysisBill(session, user.hospital_id);
    }

    if (ktv !== null && ktv < 1.2 && user) {
      await supabase.from("clinical_alerts").insert({
        hospital_id: user.hospital_id,
        alert_type: "inadequate_dialysis",
        severity: "high",
        alert_message: `INADEQUATE DIALYSIS: Kt/V = ${ktv} for ${session.dialysis_patients?.patients?.full_name}. NABH standard: Kt/V ≥ 1.2. Consider extending session or increasing blood flow rate.`,
      });
      toast({ title: `⚠️ Inadequate Dialysis: Kt/V = ${ktv}`, description: "Clinical alert raised", variant: "destructive" });
    } else {
      toast({ title: `Session completed${ktv ? ` — Kt/V: ${ktv}` : ""}` });
    }

    if (user?.hospital_id) {
      logNABHEvidence(user.hospital_id, "DIC.1",
        `Dialysis session completed: Patient ${session.dialysis_patients?.patients?.full_name}, Machine ${endMachine?.machine_type || "N/A"}, Kt/V: ${ktv || "pending"}`);
    }

    setEndMachine(null);
    resetEndForm();
    fetchData();
    onRefresh();
  };

  const resetStartForm = () => {
    setStartMachine(null); setStep(1); setSelectedPatient(null); setSafetyBlock(null); setPatientSearch("");
    setPreWeight(""); setPreBpSys(""); setPreBpDia(""); setPrePulse(""); setPreTemp("");
    setBloodFlow("300"); setDialysateFlow("500"); setHeparinDose("5000"); setDialyzerId("");
  };

  const resetEndForm = () => {
    setPostWeight(""); setPostBpSys(""); setPostBpDia(""); setPostPulse("");
    setUreaPre(""); setUreaPost(""); setUfAchieved(""); setComplications([]); setSessionNotes("");
  };

  const openAddMachine = () => {
    setMName(""); setMModel(""); setMType("clean");
    setMachineModal({ open: true, editing: null });
  };

  const openEditMachine = (m: any) => {
    setMName(m.machine_name || ""); setMModel(m.model || ""); setMType(m.machine_type || "clean");
    setMachineModal({ open: true, editing: m });
  };

  const saveMachine = async () => {
    if (!mName.trim()) return;
    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;

    if (machineModal.editing) {
      const { error } = await (supabase as any).from("dialysis_machines").update({
        machine_name: mName.trim(), model: mModel.trim() || null, machine_type: mType,
      }).eq("id", machineModal.editing.id);
      if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
      toast({ title: `${mName} updated` });
    } else {
      const { error } = await (supabase as any).from("dialysis_machines").insert({
        hospital_id: user.hospital_id, machine_name: mName.trim(), model: mModel.trim() || null,
        machine_type: mType, status: "available", is_active: true,
      });
      if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
      toast({ title: `${mName} added` });
    }
    setMachineModal({ open: false, editing: null });
    fetchData();
  };

  const deactivateMachine = async (m: any) => {
    if (activeSessions[m.id]) {
      toast({ title: "Cannot deactivate", description: "Machine has an active session", variant: "destructive" });
      return;
    }
    await (supabase as any).from("dialysis_machines").update({ is_active: false }).eq("id", m.id);
    toast({ title: `${m.machine_name} deactivated` });
    fetchData();
  };

  const filteredPatients = patients.filter(p =>
    p.patients?.full_name?.toLowerCase().includes(patientSearch.toLowerCase()) ||
    p.patients?.uhid?.toLowerCase().includes(patientSearch.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Machines ({machines.length})</h3>
        <Button size="sm" onClick={openAddMachine}><Plus className="w-3.5 h-3.5 mr-1" /> Add Machine</Button>
      </div>

      {/* Machine Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {machines.map(m => {
          const ts = TYPE_STYLE[m.machine_type] || TYPE_STYLE.clean;
          const session = activeSessions[m.id];
          return (
            <div key={m.id} className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold">{m.machine_name}</span>
                <Badge className={`text-[10px] ${ts.bg} ${ts.text}`}>{ts.label}</Badge>
              </div>
              {m.model && <p className="text-[10px] text-muted-foreground mb-2">{m.model}</p>}

              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[m.status] || "bg-muted"}`} />
                <span className="text-xs capitalize">
                  {m.status === "in_use" && session
                    ? `In Use — ${session.dialysis_patients?.patients?.full_name || "Patient"}`
                    : m.status.replace(/_/g, " ")}
                </span>
              </div>

              {session && (
                <div className="text-[10px] text-muted-foreground mb-2 space-y-0.5">
                  <p>Pre-weight: {session.pre_weight_kg} kg → Target: {session.dialysis_patients?.dry_weight_kg || "—"} kg</p>
                  <p>UF Goal: {session.uf_goal_ml || "—"} mL</p>
                </div>
              )}

              <div className="flex gap-1.5">
                {m.status === "available" && (
                  <Button size="sm" className="text-xs flex-1" onClick={() => { setStartMachine(m); setStep(1); }}>
                    <Play className="w-3 h-3 mr-1" /> Start Session
                  </Button>
                )}
                {m.status === "in_use" && session && (
                  <Button size="sm" variant="outline" className="text-xs flex-1" onClick={() => setEndMachine(m)}>
                    <CheckCircle className="w-3 h-3 mr-1" /> End Session
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEditMachine(m)}>
                  <Pencil className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => deactivateMachine(m)}>
                  <Power className="w-3 h-3" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 bg-muted/30 rounded-lg p-3 flex flex-wrap gap-4 text-xs">
        <span>🟢 <strong>Clean</strong> — HBsAg negative patients only</span>
        <span>🟡 <strong>HBV Dedicated</strong> — HBsAg positive patients only</span>
        <span>🔴 <strong>HCV Dedicated</strong> — HCV positive patients only</span>
      </div>

      {/* START SESSION DIALOG */}
      <Dialog open={!!startMachine} onOpenChange={() => resetStartForm()}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Start Session — {startMachine?.machine_name}</DialogTitle>
          </DialogHeader>

          {step === 1 && (
            <div className="space-y-3">
              <Label className="text-xs font-semibold">Select Patient</Label>
              <Input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search by name or UHID..." className="h-9" />
              <div className="max-h-48 overflow-y-auto border border-border rounded space-y-0.5 p-1">
                {filteredPatients.map(p => (
                  <button key={p.id} onClick={() => selectPatient(p)}
                    className="w-full text-left p-2 rounded hover:bg-muted text-xs flex items-center justify-between">
                    <div>
                      <span className="font-medium">{p.patients?.full_name}</span>
                      <span className="text-muted-foreground ml-2">{p.patients?.uhid}</span>
                    </div>
                    <Badge className={`text-[9px] ${TYPE_STYLE[p.machine_type_required]?.bg} ${TYPE_STYLE[p.machine_type_required]?.text}`}>
                      {p.machine_type_required.toUpperCase()}
                    </Badge>
                  </button>
                ))}
                {filteredPatients.length === 0 && <p className="text-xs text-muted-foreground p-2 text-center">No patients found</p>}
              </div>
            </div>
          )}

          {step === 3 && selectedPatient && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Patient: <strong>{selectedPatient.patients?.full_name}</strong></p>

              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Weight (kg) *</Label><Input value={preWeight} onChange={e => setPreWeight(e.target.value)} className="h-9" type="number" /></div>
                <div className="text-[10px] text-muted-foreground pt-5">
                  Dry weight: {selectedPatient.dry_weight_kg || "—"} kg
                  {preWeight && selectedPatient.dry_weight_kg && (
                    <p>Fluid overload: {(parseFloat(preWeight) - selectedPatient.dry_weight_kg).toFixed(1)} kg</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-xs">BP Sys *</Label><Input value={preBpSys} onChange={e => setPreBpSys(e.target.value)} className="h-9" type="number" /></div>
                <div><Label className="text-xs">BP Dia *</Label><Input value={preBpDia} onChange={e => setPreBpDia(e.target.value)} className="h-9" type="number" /></div>
                <div><Label className="text-xs">Pulse *</Label><Input value={prePulse} onChange={e => setPrePulse(e.target.value)} className="h-9" type="number" /></div>
              </div>
              <div><Label className="text-xs">Temp (°C)</Label><Input value={preTemp} onChange={e => setPreTemp(e.target.value)} className="h-9" type="number" /></div>

              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-xs">Blood Flow (mL/min)</Label><Input value={bloodFlow} onChange={e => setBloodFlow(e.target.value)} className="h-9" type="number" /></div>
                <div><Label className="text-xs">Dialysate Flow</Label><Input value={dialysateFlow} onChange={e => setDialysateFlow(e.target.value)} className="h-9" type="number" /></div>
                <div><Label className="text-xs">Heparin (units)</Label><Input value={heparinDose} onChange={e => setHeparinDose(e.target.value)} className="h-9" type="number" /></div>
              </div>

              {preWeight && selectedPatient.dry_weight_kg && (
                <p className="text-xs text-primary font-medium">
                  UF Goal (auto): {Math.max(0, Math.round((parseFloat(preWeight) - selectedPatient.dry_weight_kg) * 1000))} mL
                </p>
              )}

              <div><Label className="text-xs">Dialyzer ID</Label><Input value={dialyzerId} onChange={e => setDialyzerId(e.target.value)} className="h-9" placeholder="Scan barcode..." /></div>

              <Button className="w-full" onClick={startSession} disabled={!preWeight || !preBpSys || !preBpDia || !prePulse}>
                Start Session
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* SAFETY BLOCK MODAL */}
      <Dialog open={!!safetyBlock} onOpenChange={() => setSafetyBlock(null)}>
        <DialogContent className="max-w-md border-2 border-red-500 bg-red-50" onPointerDownOutside={e => e.preventDefault()}>
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-red-700">
              <ShieldX className="w-7 h-7" />
              <span className="text-lg font-bold">🔴 PATIENT SAFETY VIOLATION</span>
            </div>
            <p className="text-sm text-red-700 whitespace-pre-line">{safetyBlock}</p>
            <Button className="w-full" variant="destructive" onClick={() => setSafetyBlock(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ADD/EDIT MACHINE DIALOG */}
      <Dialog open={machineModal.open} onOpenChange={() => setMachineModal({ open: false, editing: null })}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{machineModal.editing ? "Edit Machine" : "Add Machine"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Machine Name *</Label><Input value={mName} onChange={e => setMName(e.target.value)} className="h-9" placeholder="e.g. HD-09" /></div>
            <div><Label className="text-xs">Model</Label><Input value={mModel} onChange={e => setMModel(e.target.value)} className="h-9" placeholder="e.g. Fresenius 5008S" /></div>
            <div>
              <Label className="text-xs">Machine Type *</Label>
              <Select value={mType} onValueChange={setMType}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="clean">Clean (HBsAg Negative)</SelectItem>
                  <SelectItem value="hbv">HBV Dedicated</SelectItem>
                  <SelectItem value="hcv">HCV Dedicated</SelectItem>
                  <SelectItem value="hiv">HIV Dedicated</SelectItem>
                  <SelectItem value="universal">Universal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={saveMachine} disabled={!mName.trim()}>{machineModal.editing ? "Update" : "Add Machine"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* END SESSION DIALOG */}
      <Dialog open={!!endMachine} onOpenChange={() => { setEndMachine(null); resetEndForm(); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>End Session — {endMachine?.machine_name}</DialogTitle></DialogHeader>
          {endMachine && activeSessions[endMachine.id] && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Patient: <strong>{activeSessions[endMachine.id]?.dialysis_patients?.patients?.full_name}</strong></p>

              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-xs">Post-Weight (kg)</Label><Input value={postWeight} onChange={e => setPostWeight(e.target.value)} className="h-9" type="number" /></div>
                <div><Label className="text-xs">BP Sys</Label><Input value={postBpSys} onChange={e => setPostBpSys(e.target.value)} className="h-9" type="number" /></div>
                <div><Label className="text-xs">BP Dia</Label><Input value={postBpDia} onChange={e => setPostBpDia(e.target.value)} className="h-9" type="number" /></div>
              </div>
              <div><Label className="text-xs">Post-Pulse</Label><Input value={postPulse} onChange={e => setPostPulse(e.target.value)} className="h-9" type="number" /></div>

              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Urea Pre (mg/dL)</Label><Input value={ureaPre} onChange={e => setUreaPre(e.target.value)} className="h-9" type="number" /></div>
                <div><Label className="text-xs">Urea Post (mg/dL)</Label><Input value={ureaPost} onChange={e => setUreaPost(e.target.value)} className="h-9" type="number" /></div>
              </div>
              <div><Label className="text-xs">UF Achieved (mL)</Label><Input value={ufAchieved} onChange={e => setUfAchieved(e.target.value)} className="h-9" type="number" /></div>

              <div>
                <Label className="text-xs">Complications</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {complicationOptions.map(c => (
                    <Button key={c.value} size="sm" variant={complications.includes(c.value) ? "default" : "outline"} className="text-[10px] h-6 px-2"
                      onClick={() => setComplications(prev => prev.includes(c.value) ? prev.filter(x => x !== c.value) : [...prev, c.value])}>
                      {c.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div><Label className="text-xs">Notes</Label><Textarea value={sessionNotes} onChange={e => setSessionNotes(e.target.value)} rows={2} /></div>

              <Button className="w-full" onClick={endSession}>Complete Session</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MachineBoardTab;
