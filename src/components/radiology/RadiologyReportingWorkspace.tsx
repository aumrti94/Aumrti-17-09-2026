import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCredentialGate } from "@/components/hr/useCredentialGate";
import { cn } from "@/lib/utils";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import { hasTabAccess } from "@/lib/tabPermissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import CriticalIncidentalFinder from "@/components/radiology/CriticalIncidentalFinder";
import {
  Play, Camera, FileText, Check, Save, Printer, Send, Mic, MicOff,
  Sparkles, X, AlertTriangle, ClipboardList,
} from "lucide-react";
import type { RadiologyOrder } from "@/pages/radiology/RadiologyPage";
import { useAIAudit } from "@/hooks/useAIAudit";
import { useAIFeatureFlag } from "@/hooks/useAIFeatureFlag";
import AIAttestationModal from "@/components/ai/AIAttestationModal";
import PCPNDTFormModal from "./PCPNDTFormModal";
import DicomViewerPanel from "./DicomViewerPanel";
import PaymentPendingDialog from "@/components/shared/PaymentPendingDialog";
import { checkRadiologyOrderClearance, recordAncillaryOverride } from "@/lib/ancillaryGateChecks";
import { printDocument, printHeader } from "@/lib/printUtils";

interface Report {
  id: string;
  technique: string | null;
  findings: string | null;
  impression: string | null;
  recommendations: string | null;
  ai_impression_suggestion: string | null;
  is_ai_used: boolean | null;
  comparison_note: string | null;
  critical_finding: string | null;
  is_critical: boolean | null;
  is_signed: boolean | null;
  whatsapp_sent: boolean | null;
  radiologist_id: string | null;
  reported_at: string | null;
  validated_at: string | null;
  validated_by: string | null;
}

interface PcpndtForm {
  id: string;
  patient_name: string;
  patient_age: number | null;
  patient_address: string | null;
  referred_by: string | null;
  indication: string | null;
  sex_determination_done: boolean | null;
  remarks: string | null;
  signed_by: string;
}

interface Props {
  order: RadiologyOrder;
  hospitalId: string;
  onStatusChange: () => void;
}

const MODALITY_ICONS: Record<string, string> = {
  xray: "🩻", usg: "🔊", ct: "🧲", mri: "🧲", echo: "🫀", ecg: "❤️", other: "📋",
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ordered: { label: "Ordered", cls: "bg-slate-100 text-slate-600" },
  scheduled: { label: "Scheduled", cls: "bg-sky-50 text-sky-700" },
  patient_arrived: { label: "Arrived", cls: "bg-amber-50 text-amber-700" },
  in_progress: { label: "Imaging", cls: "bg-blue-50 text-blue-700" },
  images_acquired: { label: "Awaiting Report", cls: "bg-violet-50 text-violet-700" },
  reported: { label: "Reported", cls: "bg-emerald-50 text-emerald-700" },
  validated: { label: "Validated ✓", cls: "bg-emerald-100 text-emerald-800" },
};

const TECHNIQUE_PLACEHOLDERS: Record<string, string> = {
  xray: "PA/AP/Lateral view taken with the patient in standing/supine position...",
  usg: "Real-time B-mode ultrasonography performed using a linear/curvilinear probe...",
  ct: "MDCT acquisition with/without IV contrast. Sections of 5mm thickness...",
  mri: "MRI performed on 1.5T/3T system. Sequences: T1W, T2W, FLAIR, DWI...",
  echo: "2D Echocardiogram with Doppler study performed in standard views...",
  ecg: "12-lead ECG recorded at standard speed 25mm/sec, calibration 1mV/cm...",
};

const FINDINGS_PLACEHOLDERS: Record<string, string> = {
  xray: "PA view chest: Trachea central. Mediastinum normal.\nHeart size normal, CTR <50%. Lung fields clear.\nNo consolidation, collapse or pleural effusion.\nBony thorax: No fracture/lytic lesion...",
  usg: "Liver: Normal size and echogenicity. No focal lesion.\nGallbladder: No calculi. Wall not thickened.\nSpleen: Normal.\nKidneys: Both normal in size and echogenicity...",
  ecg: "Rate: ___ bpm. Rhythm: Regular/Irregular.\nP waves: Normal. PR interval: Normal.\nQRS: Normal duration. ST-T changes: None/Present...",
  echo: "LV: Normal size and function. EF ___%.\nRV: Normal. No RWMA.\nValves: MV/AV/TV normal. No significant regurgitation.\nPericardium: No effusion...",
  ct: "Brain parenchyma: Normal grey-white differentiation.\nNo haemorrhage, mass or midline shift.\nVentricular system: Normal. Basal cisterns patent...",
  mri: "Signal intensity patterns within normal limits.\nNo diffusion restriction. No enhancing lesion...",
};

function getAge(dob: string | null): string {
  if (!dob) return "";
  const y = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return `${y}y`;
}

const RadiologyReportingWorkspace: React.FC<Props> = ({ order, hospitalId, onStatusChange }) => {
  const { toast } = useToast();
  const { logAudit } = useAIAudit();
  const { permissions, role } = useHospitalContext();
  const { guard, gateElement } = useCredentialGate(hospitalId);
  const [report, setReport] = useState<Report | null>(null);
  const [pcpndt, setPcpndt] = useState<PcpndtForm | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Report form state
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [indication, setIndication] = useState("");
  const [technique, setTechnique] = useState("");
  const [findings, setFindings] = useState("");
  const [impression, setImpression] = useState("");
  const [isCritical, setIsCritical] = useState(false);
  const [criticalFinding, setCriticalFinding] = useState("");
  const [doseMgy, setDoseMgy] = useState<string>("");
  const [pregnancyStatus, setPregnancyStatus] = useState<string>("not_applicable");

  // DICOM state is now managed inside DicomViewerPanel

  // PCPNDT state
  const [pcpndtRecordExists, setPcpndtRecordExists] = useState(false);
  const [showPcpndtModal, setShowPcpndtModal] = useState(false);
  // Legacy inline form state (kept for old pcpndt_form_f records that may still exist)
  const [pcpndtName, setPcpndtName] = useState("");
  const [pcpndtAge, setPcpndtAge] = useState<number | null>(null);
  const [pcpndtAddress, setPcpndtAddress] = useState("");
  const [pcpndtReferredBy, setPcpndtReferredBy] = useState("");
  const [pcpndtIndication, setPcpndtIndication] = useState("");
  const [pcpndtSexDecl, setPcpndtSexDecl] = useState(false);
  const [pcpndtRemarks, setPcpndtRemarks] = useState("");

  // AI state
  const radiologyAIEnabled = useAIFeatureFlag("radiology_impression");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiFlagType, setAiFlagType] = useState<"critical" | "abnormal" | "normal">("abnormal");
  const [showImpressionAttestation, setShowImpressionAttestation] = useState(false);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);

  // Saving state
  const [saving, setSaving] = useState(false);
  /** Set when the payment gate refuses to start the study — drives PaymentPendingDialog. */
  const [blocked, setBlocked] = useState<{ unpaidAmount: number; overrideAvailable: boolean } | null>(null);
  const [overriding, setOverriding] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      const { data: u } = await supabase.from("users").select("id").eq("auth_user_id", userData.user.id).maybeSingle();
      if (u) setCurrentUserId(u.id);
    }

    // Fetch report
    const { data: rr } = await supabase
      .from("radiology_reports")
      .select("*")
      .eq("order_id", order.id)
      .maybeSingle();

    if (rr) {
      setReport(rr as Report);
      setTechnique(rr.technique || "");
      setFindings(rr.findings || "");
      setImpression(rr.impression || "");
      setIsCritical(rr.is_critical || false);
      setCriticalFinding(rr.critical_finding || "");
      if (rr.ai_impression_suggestion) setAiSuggestion(rr.ai_impression_suggestion);
    } else {
      setReport(null);
      setTechnique("");
      setFindings("");
      setImpression("");
      setIsCritical(false);
      setCriticalFinding("");
      setAiSuggestion(null);
    }

    setClinicalHistory(order.clinical_history || "");
    setIndication(order.indication || "");
    setDoseMgy((order as any).dose_mgy ? String((order as any).dose_mgy) : "");
    setPregnancyStatus((order as any).pregnancy_status || "not_applicable");

    // PCPNDT — check pcpndt_records (new authoritative table)
    if (order.is_pcpndt) {
      const { data: rec } = await (supabase as any)
        .from("pcpndt_records")
        .select("id")
        .eq("radiology_order_id", order.id)
        .maybeSingle();
      setPcpndtRecordExists(!!rec);
    } else {
      setPcpndtRecordExists(false);
    }

    setLoading(false);
  }, [order.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateOrderStatus = async (newStatus: string, overridden = false) => {
    // PCPNDT: never allow direct "reported" transition for USG — must go through validateAndSign()
    if (newStatus === "reported" && (order.is_pcpndt || order.modality_type?.toLowerCase() === "usg")) {
      validateAndSign();
      return;
    }

    // The payment gate applies to STARTING the study and nothing else. Once the scan has
    // happened, blocking 'images_acquired' or 'reported' would strand a completed study as
    // unreportable — the radiation dose is already delivered; withholding the report helps
    // nobody and harms the patient.
    if (newStatus === "in_progress" && !overridden) {
      const clearance = await checkRadiologyOrderClearance(order.id, role);
      if (!clearance.cleared) {
        setBlocked({ unpaidAmount: clearance.unpaidAmount, overrideAvailable: clearance.overrideAvailable });
        return;
      }
    }

    await supabase.from("radiology_orders").update({ status: newStatus }).eq("id", order.id);
    onStatusChange();
    toast({ title: `Status updated to ${newStatus.replace(/_/g, " ")}` });
  };

  const handlePaymentOverride = async (reason: string) => {
    if (!currentUserId) return;
    setOverriding(true);
    try {
      const ok = await recordAncillaryOverride({
        hospitalId,
        service: "radiology",
        patientId: order.patient_id ?? null,
        reason,
        overriddenBy: currentUserId,
        detail: order.study_name || undefined,
      });
      if (!ok) throw new Error("The override could not be recorded, so the study was not started.");
      setBlocked(null);
      await updateOrderStatus("in_progress", true);
    } catch (e: any) {
      toast({ title: "Override failed", description: e.message, variant: "destructive" });
    } finally {
      setOverriding(false);
    }
  };

  const saveDraft = async () => {
    if (!report || !currentUserId) return;
    setSaving(true);
    await supabase.from("radiology_reports").update({
      technique,
      findings,
      impression,
      is_critical: isCritical,
      critical_finding: isCritical ? criticalFinding : null,
      reported_at: new Date().toISOString(),
    }).eq("id", report.id);

    // Update order clinical fields + radiation dose + pregnancy status
    await (supabase as any).from("radiology_orders").update({
      clinical_history: clinicalHistory,
      indication,
      dose_mgy: doseMgy ? parseFloat(doseMgy) : null,
      pregnancy_status: pregnancyStatus !== "not_applicable" ? pregnancyStatus : null,
    }).eq("id", order.id);

    setSaving(false);
    toast({ title: "Draft saved" });
  };

  const validateAndSign = async (overridden = false) => {
    if (!report || !currentUserId) return;
    if (!findings.trim() || !impression.trim()) {
      toast({ title: "Findings and Impression are required", variant: "destructive" });
      return;
    }
    // License-validity gate on the reporting radiologist before signing
    if (!overridden) {
      guard({ clinicianId: currentUserId, module: "radiology", action: "validate_report", recordId: report.id }, () => validateAndSign(true));
      return;
    }

    // PCPNDT compliance: block signing without Form F (pcpndt_records)
    if (order.is_pcpndt) {
      const { data: rec } = await (supabase as any)
        .from("pcpndt_records")
        .select("id")
        .eq("radiology_order_id", order.id)
        .maybeSingle();

      if (!rec) {
        toast({
          title: "PCPNDT Form F required before signing",
          description: "Please complete the PCPNDT Form F in the PCPNDT tab before validating the report.",
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);

    await supabase.from("radiology_reports").update({
      technique,
      findings,
      impression,
      is_critical: isCritical,
      critical_finding: isCritical ? criticalFinding : null,
      is_signed: true,
      validated_at: new Date().toISOString(),
      validated_by: currentUserId,
      radiologist_id: currentUserId,
      reported_at: new Date().toISOString(),
    }).eq("id", report.id);

    await supabase.from("radiology_orders").update({
      status: "validated",
      clinical_history: clinicalHistory,
      indication,
    }).eq("id", order.id);

    // Fire-and-forget ABHA care context linking (non-blocking)
    if (order.patient_id) {
      supabase.functions.invoke("abdm-auto-link-care-context", {
        body: {
          hospital_id: hospitalId,
          patient_id: order.patient_id,
          event_type: "radiology_reported",
          source_id: order.id,
        },
      }).catch(() => {});
    }

    // Critical alert
    if (isCritical && criticalFinding.trim()) {
      await supabase.from("clinical_alerts").insert({
        hospital_id: hospitalId,
        alert_type: "critical_radiology",
        severity: "critical",
        alert_message: `Critical finding: ${criticalFinding} — ${order.study_name}. Patient: ${order.patients?.full_name}`,
        patient_id: order.patient_id,
      });
    }

    // Auto-bill OPD radiology charges (skip IPD)
    const { data: fullOrder } = await (supabase as any)
      .from("radiology_orders")
      .select("admission_id, encounter_id, patient_id, ordered_by")
      .eq("id", order.id).maybeSingle();

    if (fullOrder && !fullOrder.admission_id) {
      try {
        const { autoBillOpdInvestigation, getInvestigationRate } = await import("@/lib/investigationBilling");
        const { rate, gstPercent } = await getInvestigationRate(hospitalId, order.study_name, "radiology");
        const gstAmount = rate * gstPercent / 100;

        const result = await autoBillOpdInvestigation({
          hospitalId,
          patientId: fullOrder.patient_id,
          encounterId: fullOrder.encounter_id,
          admissionId: null,
          orderedBy: fullOrder.ordered_by || currentUserId,
          lineItems: [{
            description: order.study_name,
            itemType: "radiology",
            unitRate: rate,
            gstPercent,
            gstAmount,
          }],
          billPrefix: "RAD",
          sourceModule: "radiology",
          sourceId: order.id,
        });

        if (result) {
          toast({ title: `Radiology charges billed: ₹${result.total.toLocaleString("en-IN")}` });
        }
      } catch (e) {
        console.error("Radiology auto-billing error (non-blocking):", e);
      }
    }

    setSaving(false);
    onStatusChange();
    toast({ title: "Report signed ✓" });
  };

  const handleAiSuggest = async () => {
    if (!findings.trim()) {
      toast({ title: "Enter findings first", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-radiology-impression", {
        body: {
          modality_type: order.modality_type,
          study_name: order.study_name,
          clinical_history: clinicalHistory,
          indication,
          findings: findings,
        },
      });
      if (error) throw error;
      const text = data?.impression || "Unable to generate impression.";
      setAiSuggestion(text);
      setAiConfidence(typeof data?.confidence === "number" ? data.confidence : null);
      setAiReasoning(typeof data?.reasoning === "string" ? data.reasoning : null);
      if (report) {
        await supabase.from("radiology_reports").update({ ai_impression_suggestion: text }).eq("id", report.id);
      }
    } catch (e: any) {
      console.error("AI impression error:", e);
      toast({ title: "AI suggestion failed", description: e.message, variant: "destructive" });
    }
    setAiLoading(false);
  };

  const useAiImpression = () => {
    if (aiSuggestion) {
      setImpression(aiSuggestion);
      logAudit(
        {
          hospitalId,
          patientId: order.patient_id,
          featureKey: "radiology_impression",
          aiOutput: { impression: aiSuggestion, modality: order.modality_type, study: order.study_name },
          confidence: aiConfidence ?? undefined,
          reasoning: aiReasoning ?? undefined,
        },
        "accepted"
      );
      setAiSuggestion(null);
      setAiConfidence(null);
      setAiReasoning(null);
      if (report) {
        supabase.from("radiology_reports").update({ is_ai_used: true }).eq("id", report.id);
      }
      supabase.from("radiology_orders").update({ ai_flag: aiFlagType } as any).eq("id", order.id);
      onStatusChange();
    }
  };

  const dismissAiImpression = () => {
    if (aiSuggestion) {
      logAudit(
        {
          hospitalId,
          patientId: order.patient_id,
          featureKey: "radiology_impression",
          aiOutput: { impression: aiSuggestion, modality: order.modality_type, study: order.study_name },
          confidence: aiConfidence ?? undefined,
          reasoning: aiReasoning ?? undefined,
        },
        "rejected"
      );
    }
    setAiSuggestion(null);
    setAiConfidence(null);
    setAiReasoning(null);
  };

  const handleVoiceInput = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      toast({ title: "Speech recognition not supported in this browser", variant: "destructive" });
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setFindings(prev => prev + " " + transcript);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);

    if (isRecording) {
      recognition.stop();
      setIsRecording(false);
    } else {
      recognition.start();
      setIsRecording(true);
    }
  };

  const savePcpndt = async () => {
    if (!pcpndtSexDecl) {
      toast({ title: "You must confirm sex determination declaration", variant: "destructive" });
      return;
    }
    if (!currentUserId) return;

    const payload = {
      patient_name: pcpndtName,
      patient_age: pcpndtAge,
      patient_address: pcpndtAddress,
      referred_by: pcpndtReferredBy,
      indication: pcpndtIndication,
      sex_determination_done: false,
      remarks: pcpndtRemarks,
      signed_by: currentUserId,
      signed_at: new Date().toISOString(),
    };

    if (pcpndt) {
      await supabase.from("pcpndt_form_f").update(payload).eq("id", pcpndt.id);
    } else {
      await supabase.from("pcpndt_form_f").insert({
        ...payload,
        hospital_id: hospitalId,
        order_id: order.id,
      });
    }
    toast({ title: "Form F saved ✓" });
  };

  const sendToDoctor = () => {
    const phone = (order as any).ordered_by_user?.phone || "";
    const msg = encodeURIComponent(
      `🏥 *Radiology Report Ready*\nPatient: ${order.patients?.full_name} (${order.patients?.uhid})\nStudy: ${order.study_name}\nAccession: ${order.accession_number || "N/A"}\n\n*Impression:*\n${impression}\n${isCritical ? "\n⚠️ CRITICAL FINDING — Please review urgently" : ""}\n\nFull report available in HMS.`
    );
    window.open(`https://wa.me/91${phone.replace(/\D/g, "")}?text=${msg}`, "_blank", "noopener,noreferrer");
    if (report) {
      supabase.from("radiology_reports").update({ whatsapp_sent: true }).eq("id", report.id);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 bg-muted/30 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading report...</p>
      </div>
    );
  }

  const modIcon = MODALITY_ICONS[order.modality_type] || "📋";
  const statusInfo = STATUS_LABEL[order.status] || STATUS_LABEL.ordered;
  const canSign = findings.trim().length > 0 && impression.trim().length > 0;
  const isSigned = report?.is_signed;

  // Status action button
  const renderStatusAction = () => {
    // PCPNDT orders require Form F before scanning can begin
    if (order.is_pcpndt && !pcpndtRecordExists && order.status !== "validated") {
      return (
        <Button
          size="sm"
          className="bg-amber-600 hover:bg-amber-700 text-[11px] h-7"
          onClick={() => setShowPcpndtModal(true)}
        >
          <ClipboardList size={12} /> Fill PCPNDT Form First
        </Button>
      );
    }
    if (["ordered", "scheduled", "patient_arrived"].includes(order.status)) {
      return (
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-[11px] h-7" onClick={() => updateOrderStatus("in_progress")}>
          <Play size={12} /> Start Study
        </Button>
      );
    }
    if (order.status === "in_progress") {
      return (
        <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-[11px] h-7" onClick={() => updateOrderStatus("images_acquired")}>
          <Camera size={12} /> Images Acquired
        </Button>
      );
    }
    if (order.status === "images_acquired") {
      return (
        <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-[11px] h-7" onClick={() => updateOrderStatus("reported")}>
          <FileText size={12} /> Begin Report
        </Button>
      );
    }
    return null;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/30">
      {gateElement}
      {/* Study Header */}
      <div className="shrink-0 bg-card border-b border-border px-5 py-3 flex items-center gap-4">
        {/* Modality icon */}
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xl shrink-0">
          {modIcon}
        </div>

        {/* Study info */}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-foreground truncate">{order.study_name}</p>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="font-mono">{order.accession_number || `RAD-${order.id.slice(0, 8)}`}</span>
            <span>·</span>
            <span>{order.patients?.full_name}</span>
            <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">{order.patients?.uhid}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {getAge(order.patients?.dob || null)} {order.patients?.gender} · Ref: Dr. {order.ordered_by_user?.full_name}
            {order.indication && <span className="ml-2 text-muted-foreground/60">· {order.indication.slice(0, 60)}</span>}
          </div>
        </div>

        {/* Status + action */}
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span className={cn("text-[10px] font-medium px-2.5 py-1 rounded-full", statusInfo.cls)}>
            {statusInfo.label}
          </span>
          {renderStatusAction()}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="report" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="shrink-0 w-full justify-start rounded-none border-b border-border bg-card h-11 px-5">
          {[
            { v: "report", l: "Report" },
            { v: "images", l: "Images" },
            ...(order.is_pcpndt ? [{ v: "pcpndt", l: "PCPNDT" }] : []),
          ]
            .filter((t) => hasTabAccess("radiology", t.v, permissions, role))
            .map((t) => (
              <TabsTrigger key={t.v} value={t.v} className="text-xs">{t.l}</TabsTrigger>
            ))}
        </TabsList>

        {/* TAB 1: Report */}
        <TabsContent value="report" className="flex-1 flex flex-col overflow-hidden mt-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Section A: Clinical Context */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[11px] uppercase text-muted-foreground font-bold tracking-wide">Clinical History</Label>
                <Textarea
                  value={clinicalHistory}
                  onChange={e => setClinicalHistory(e.target.value)}
                  rows={2}
                  className="mt-1 text-[13px] resize-none"
                  placeholder="Clinical history as provided by referring doctor..."
                  disabled={!!isSigned}
                />
              </div>
              <div>
                <Label className="text-[11px] uppercase text-muted-foreground font-bold tracking-wide">Indication</Label>
                <Textarea
                  value={indication}
                  onChange={e => setIndication(e.target.value)}
                  rows={2}
                  className="mt-1 text-[13px] resize-none"
                  placeholder="Clinical indication / reason for referral..."
                  disabled={!!isSigned}
                />
              </div>
            </div>

            {/* Section B: Technique */}
            <div>
              <Label className="text-[11px] uppercase text-muted-foreground font-bold tracking-wide">Technique</Label>
              <Textarea
                value={technique}
                onChange={e => setTechnique(e.target.value)}
                rows={2}
                className="mt-1 text-[13px] resize-none"
                placeholder={TECHNIQUE_PLACEHOLDERS[order.modality_type] || "Technique / protocol used..."}
                disabled={!!isSigned}
              />
            </div>

            {/* Section C: Findings */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-[11px] uppercase text-muted-foreground font-bold tracking-wide">Findings</Label>
                <button
                  onClick={handleVoiceInput}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                    isRecording
                      ? "bg-red-500 text-white animate-pulse"
                      : "bg-[hsl(220,55%,23%)] text-white hover:bg-[hsl(220,55%,30%)]"
                  )}
                  disabled={!!isSigned}
                >
                  {isRecording ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              </div>
              <Textarea
                value={findings}
                onChange={e => setFindings(e.target.value)}
                className="mt-1 text-[14px] leading-7 resize-none min-h-[120px]"
                rows={6}
                placeholder={FINDINGS_PLACEHOLDERS[order.modality_type] || "Enter findings..."}
                disabled={!!isSigned}
              />
            </div>

            {/* Section D: Impression */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-[11px] uppercase text-muted-foreground font-bold tracking-wide">Impression / Conclusion</Label>
                {!isSigned && radiologyAIEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[12px] h-7 gap-1"
                    onClick={handleAiSuggest}
                    disabled={aiLoading || !findings.trim()}
                  >
                    <Sparkles size={12} />
                    {aiLoading ? "Generating..." : "AI Suggest"}
                  </Button>
                )}
              </div>

              {/* AI Suggestion */}
              {aiSuggestion && !isSigned && (
                <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[11px] font-bold text-emerald-700">🤖 AI Suggestion</p>
                    {aiConfidence != null && (
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium",
                        aiConfidence >= 0.8 ? "bg-emerald-100 text-emerald-700" :
                        aiConfidence >= 0.6 ? "bg-amber-100 text-amber-700" :
                        "bg-red-100 text-red-700"
                      )}>
                        {Math.round(aiConfidence * 100)}% confidence
                      </span>
                    )}
                  </div>
                  {aiReasoning && (
                    <p className="text-[10px] italic text-muted-foreground mb-1">{aiReasoning}</p>
                  )}
                  <p className="text-[13px] text-foreground whitespace-pre-wrap">{aiSuggestion}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-muted-foreground">Flag:</span>
                    {(["normal", "abnormal", "critical"] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setAiFlagType(f)}
                        className={cn(
                          "text-[9px] px-2 py-0.5 rounded font-medium border transition-colors capitalize",
                          aiFlagType === f
                            ? f === "critical" ? "bg-red-100 text-red-700 border-red-300"
                              : f === "abnormal" ? "bg-purple-100 text-purple-700 border-purple-300"
                              : "bg-emerald-100 text-emerald-700 border-emerald-300"
                            : "bg-muted text-muted-foreground border-border"
                        )}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowImpressionAttestation(true)}>
                      <Check size={12} /> Use This
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={dismissAiImpression}>
                      <X size={12} /> Dismiss
                    </Button>
                  </div>
                </div>
              )}

              <Textarea
                value={impression}
                onChange={e => setImpression(e.target.value)}
                className={cn(
                  "mt-1 text-[14px] font-semibold leading-7 resize-none min-h-[80px]",
                  report?.is_ai_used && "border-emerald-400"
                )}
                rows={3}
                placeholder="Write your clinical impression here..."
                disabled={!!isSigned}
              />

              {/* Critical finding toggle */}
              {!isSigned && (
                <div className={cn("mt-3 p-3 rounded-lg border transition-colors", isCritical ? "bg-red-50 border-red-200" : "bg-card border-border")}>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isCritical}
                      onCheckedChange={(v) => setIsCritical(!!v)}
                      className="data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
                    />
                    <Label className="text-[12px] font-medium text-foreground cursor-pointer">
                      <AlertTriangle size={12} className="inline mr-1 text-red-500" />
                      Mark as Critical / Urgent Finding
                    </Label>
                  </div>
                  {isCritical && (
                    <Input
                      value={criticalFinding}
                      onChange={e => setCriticalFinding(e.target.value)}
                      className="mt-2 text-[13px]"
                      placeholder="Critical finding details..."
                    />
                  )}
                </div>
              )}

              {/* Pregnancy check (for female patients in ionising modalities) + Radiation dose */}
              {(["xray","ct","fluoroscopy"].includes(order.modality_type) || !order.modality_type) && (
                <div className="mt-3 p-3 rounded-lg border border-border bg-card space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[11px] uppercase font-bold text-muted-foreground">Pregnancy Status</Label>
                      <select value={pregnancyStatus} onChange={e => setPregnancyStatus(e.target.value)} disabled={!!isSigned}
                        className="w-full mt-1 h-8 text-xs border border-border rounded-md px-2 bg-background">
                        <option value="not_applicable">N/A</option>
                        <option value="not_pregnant">Not Pregnant</option>
                        <option value="pregnant">Pregnant ⚠️</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[11px] uppercase font-bold text-muted-foreground">Radiation Dose (mGy)</Label>
                      <Input type="number" value={doseMgy} onChange={e => setDoseMgy(e.target.value)} disabled={!!isSigned}
                        placeholder="e.g. 1.5" className="mt-1 h-8 text-xs" step="0.1" min="0" />
                    </div>
                  </div>
                  {pregnancyStatus === "pregnant" && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                      ⚠️ Patient is pregnant — ensure clinical justification and minimise dose. Document in medical record.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Action bar */}
          <div className="shrink-0 bg-card border-t border-border px-5 py-2.5 flex items-center gap-2">
            {!isSigned ? (
              <>
                <Button variant="ghost" size="sm" className="text-[12px] h-8" onClick={saveDraft} disabled={saving}>
                  <Save size={14} /> Save Draft
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-[12px] bg-emerald-600 hover:bg-emerald-700"
                  disabled={!canSign || saving}
                  onClick={validateAndSign}
                >
                  <Check size={14} /> Validate & Sign
                </Button>
              </>
            ) : (
              <span className="text-[12px] text-emerald-600 font-medium">✓ Report signed</span>
            )}
            <div className="flex-1" />
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => {
              const patientName = order.patients?.full_name || "Patient";
              const uhid = order.patients?.uhid || "";
              const body = `${printHeader("Radiology Report", order.study_name)}
                <div class="row"><span class="label">Patient:</span><span>${patientName} (${uhid})</span></div>
                <div class="row"><span class="label">Study:</span><span>${order.study_name}</span></div>
                <div class="row"><span class="label">Date:</span><span>${order.order_date}</span></div>
                ${report?.technique ? `<p class="section-title">Technique</p><p>${report.technique}</p>` : ""}
                ${report?.findings ? `<p class="section-title">Findings</p><pre>${report.findings}</pre>` : ""}
                ${report?.impression ? `<p class="section-title">Impression</p><pre>${report.impression}</pre>` : ""}
                ${report?.recommendations ? `<p class="section-title">Recommendations</p><pre>${report.recommendations}</pre>` : ""}
                ${report?.is_critical ? `<p style="color:#dc2626;font-weight:bold">⚠️ CRITICAL FINDING: ${report.critical_finding || ""}</p>` : ""}`;
              printDocument(`Radiology - ${patientName}`, body);
            }}>
              <Printer size={14} /> Print
            </Button>
            {isSigned && (
              <Button variant="outline" size="sm" className="h-8 text-[12px] text-blue-600 border-blue-200 hover:bg-blue-50" onClick={sendToDoctor}>
                <Send size={14} /> Send to Doctor
              </Button>
            )}
          </div>

          {/* Critical Incidental Finder — auto-runs after report is signed */}
          {isSigned && findings.trim().length > 20 && impression.trim().length > 20 && hospitalId && (
            <div className="px-5 pb-4">
              <CriticalIncidentalFinder
                findings={findings}
                impression={impression}
                hospitalId={hospitalId}
                orderId={order.id}
                patientId={order.patient_id}
                patientName={order.patients?.full_name || ""}
                studyName={order.study_name}
              />
            </div>
          )}
        </TabsContent>

        {/* TAB 2: Images — powered by DicomViewerPanel */}
        <TabsContent value="images" className="flex-1 flex flex-col overflow-hidden mt-0 p-0">
          <DicomViewerPanel
            orderId={order.id}
            patientName={order.patients?.full_name}
            accessionNumber={order.accession_number || undefined}
            modalityType={order.modality_type}
            studyName={order.study_name}
            currentPacsUrl={order.dicom_pacs_url}
            onPacsUrlSaved={(url) => {
              onStatusChange();
            }}
          />
        </TabsContent>

        {/* TAB 3: PCPNDT */}
        {order.is_pcpndt && (
          <TabsContent value="pcpndt" className="flex-1 overflow-y-auto mt-0 px-5 py-4 space-y-4">
            {/* Legal notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-[12px] text-amber-800">
                ⚖️ <strong>PCPNDT Act 1994</strong> — Form F is legally mandatory for all obstetric and gynaecological ultrasound examinations. Failure to maintain Form F records is a criminal offense.
              </p>
            </div>

            {pcpndtRecordExists ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Check size={16} className="text-emerald-600" />
                  <p className="text-sm font-semibold text-emerald-800">PCPNDT Form F Completed</p>
                </div>
                <p className="text-[12px] text-emerald-700">
                  Form F has been saved for this order. The legal declaration and consent have been recorded.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                  onClick={() => setShowPcpndtModal(true)}
                >
                  <ClipboardList size={13} /> Open / Edit PCPNDT Form F
                </Button>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-600" />
                  <p className="text-sm font-semibold text-red-800">Form F Not Completed</p>
                </div>
                <p className="text-[12px] text-red-700">
                  PCPNDT Form F must be completed before proceeding with this scan or signing the report.
                </p>
                <Button
                  size="sm"
                  className="gap-1 bg-[hsl(220,55%,23%)] hover:bg-[hsl(220,55%,30%)]"
                  onClick={() => setShowPcpndtModal(true)}
                >
                  <ClipboardList size={13} /> Fill PCPNDT Form F
                </Button>
              </div>
            )}

          </TabsContent>
        )}
      </Tabs>

      {/* AI Impression Attestation Modal */}
      {aiSuggestion && (
        <AIAttestationModal
          open={showImpressionAttestation}
          title="AI Radiology Impression — Doctor Attestation Required"
          feature="radiology_impression"
          sourceId={order.id}
          hospitalId={hospitalId}
          aiOutput={{
            impression: aiSuggestion,
            modality: order.modality_type,
            study: order.study_name,
            confidence: aiConfidence,
            reasoning: aiReasoning,
          }}
          previewContent={[
            `Study: ${order.study_name} (${order.modality_type?.toUpperCase()})`,
            aiConfidence != null ? `AI Confidence: ${Math.round(aiConfidence * 100)}%` : "",
            aiReasoning ? `\nReasoning: ${aiReasoning}` : "",
            `\nAI Impression:\n${aiSuggestion}`,
          ].filter(Boolean).join("\n")}
          initialEditableText={aiSuggestion}
          editableLabel="Impression (edit before saving to report)"
          onAccept={(editedText) => {
            setImpression(editedText);
            logAudit(
              {
                hospitalId,
                patientId: order.patient_id,
                featureKey: "radiology_impression",
                aiOutput: { impression: aiSuggestion, modality: order.modality_type, study: order.study_name },
                confidence: aiConfidence ?? undefined,
                reasoning: aiReasoning ?? undefined,
              },
              "accepted",
              editedText !== aiSuggestion ? { edited_impression: editedText } : undefined
            );
            setAiSuggestion(null);
            setAiConfidence(null);
            setAiReasoning(null);
            setShowImpressionAttestation(false);
            if (report) supabase.from("radiology_reports").update({ is_ai_used: true }).eq("id", report.id);
            supabase.from("radiology_orders").update({ ai_flag: aiFlagType } as any).eq("id", order.id);
            onStatusChange();
          }}
          onDiscard={() => setShowImpressionAttestation(false)}
        />
      )}

      {/* PCPNDT Form Modal */}
      {showPcpndtModal && order.patient_id && (
        <PCPNDTFormModal
          hospitalId={hospitalId}
          orderId={order.id}
          patientId={order.patient_id}
          patientName={order.patients?.full_name || ""}
          patientDob={order.patients?.dob || null}
          orderedByName={order.ordered_by_user?.full_name || null}
          orderIndication={order.indication || null}
          onClose={() => setShowPcpndtModal(false)}
          onSaved={() => { setPcpndtRecordExists(true); setShowPcpndtModal(false); onStatusChange(); }}
        />
      )}

      {/* Payment gate — only ever fires for a pre-paid hospital's unpaid IPD order */}
      <PaymentPendingDialog
        open={!!blocked}
        onClose={() => setBlocked(null)}
        unpaidAmount={blocked?.unpaidAmount ?? 0}
        overrideAvailable={blocked?.overrideAvailable ?? false}
        onOverride={handlePaymentOverride}
        blockedAction="study cannot be started"
        busy={overriding}
      />
    </div>
  );
};

export default RadiologyReportingWorkspace;
