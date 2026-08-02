import React, { useState, useEffect, useMemo } from "react";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import { hasTabAccess, hasActionAccess } from "@/lib/tabPermissions";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { BedDouble, ExternalLink, ArrowUpRight, Printer, FileText, MonitorDot } from "lucide-react";
import { printDocument, printHeader, printAmount } from "@/lib/printUtils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { BedData } from "@/pages/ipd/IPDPage";
import IPDOverviewTab from "./tabs/IPDOverviewTab";
import IPDVitalsTab from "./tabs/IPDVitalsTab";
import IPDMedicationsTab from "./tabs/IPDMedicationsTab";
import IPDWardRoundTab from "./tabs/IPDWardRoundTab";
import InvestigationsTab from "./tabs/InvestigationsTab";
import { INSURANCE_PAYER_TYPES } from "@/lib/payerTypes";
import IPDNotesTab from "./tabs/IPDNotesTab";
import IPDDocumentsTab from "./tabs/IPDDocumentsTab";
import IPDFinancialTab from "./tabs/IPDFinancialTab";
import NursingKardexTab from "./tabs/NursingKardexTab";
import IPDDeviceTab from "./tabs/IPDDeviceTab";
import PalliativeCareTab from "./tabs/PalliativeCareTab";
import NutritionDieteticsTab from "./tabs/NutritionDieteticsTab";
import WoundCareTab from "./tabs/WoundCareTab";
import BedTransferModal from "./BedTransferModal";
import BloodRequestModal from "./BloodRequestModal";
import AdmitPatientModal from "./AdmitPatientModal";
import MLCDetailsModal from "@/components/emergency/MLCDetailsModal";
import { useWhatsAppNotification } from "@/hooks/useWhatsAppNotification";
import { sendDischargeSummaryNotif, sendFeedbackRequest } from "@/lib/whatsapp-notifications";
import { getSpecialtySheet, specialtyTabMeta } from "@/lib/specialtyDetection";
import ObstetricSheet from "@/components/specialty/ObstetricSheet";
import NeonatalSheet from "@/components/specialty/NeonatalSheet";
import AnaesthesiaSheet from "@/components/specialty/AnaesthesiaSheet";
import OphthalmologySheet from "@/components/specialty/OphthalmologySheet";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { getNEWS2BadgeClasses, getNEWS2Level } from "@/lib/news2";
import ABDMCareContextsPanel from "@/components/abdm/ABDMCareContextsPanel";
import ConsentStatusBanner from "@/components/abdm/ConsentStatusBanner";
import ConsentSignatureModal from "@/components/consent/ConsentSignatureModal";
import ClinicalCalculatorPanel from "@/components/clinical/ClinicalCalculatorPanel";
import RxOrdersTab from "@/components/opd/tabs/RxOrdersTab";
import { useVoiceScribe } from "@/hooks/useVoiceScribe";
import type { PrescriptionData, DrugEntry, LabOrder, RadiologyOrder } from "@/components/opd/ConsultationWorkspace";
import VoiceDictationButton from "@/components/voice/VoiceDictationButton";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { syncLabOrders, syncRadiologyOrders, isRadiologyKeyword } from "@/lib/investigationSync";
import { chargeLabOrders, chargeRadiologyOrders } from "@/lib/ancillaryCharges";
import { fetchIpdAncillaryPolicy } from "@/lib/ipdAncillaryGate";
import { initiateDischargeWorkflow, announceDischargeInitiated } from "@/lib/dischargeWorkflow";

interface Props {
  bed: BedData | null;
  hospitalId: string | null;
  userId: string | null;
  onRefresh: () => void;
}

export interface PatientDetails {
  id: string;
  full_name: string;
  uhid: string;
  dob: string | null;
  gender: string | null;
  blood_group: string | null;
  phone: string | null;
  allergies: string | null;
  chronic_conditions: string[] | null;
  insurance_id: string | null;
  abha_id?: string | null;
}

interface AdmissionEstimate {
  id: string;
  estimated_days: number;
  estimated_amount: number;
  deposit_required: number;
  remarks: string | null;
  created_at: string;
}

const emptyPrescription: PrescriptionData = {
  drugs: [],
  lab_orders: [],
  radiology_orders: [],
  advice_notes: "",
  review_date: "",
  is_signed: false,
};

const IPDWorkspace: React.FC<Props> = ({ bed, hospitalId, userId, onRefresh }) => {
  const navigate = useNavigate();
  const { permissions, role } = useHospitalContext();
  const [patient, setPatient] = useState<PatientDetails | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [deptName, setDeptName] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [highlightDischarge, setHighlightDischarge] = useState(false);
  const [initiatingDischarge, setInitiatingDischarge] = useState(false);
  const [latestNews2, setLatestNews2] = useState<number | null>(null);
  const [prescription, setPrescription] = useState<PrescriptionData>(emptyPrescription);
  const [savingOrders, setSavingOrders] = useState(false);
  const { registerScreen, unregisterScreen } = useVoiceScribe();
  const { show: showWaNotif, card: waCard } = useWhatsAppNotification();

  // Estimate tracking
  const [estimate, setEstimate] = useState<AdmissionEstimate | null | undefined>(undefined);
  const [showEstimateModal, setShowEstimateModal] = useState(false);

  // MLC tracking: undefined=loading, null=not mlc, false=mlc but no case row, true=mlc case documented
  const [mlcCaseStatus, setMlcCaseStatus] = useState<boolean | null | undefined>(null);
  const [showMlcModal, setShowMlcModal] = useState(false);

  // MEWS alert from latest nursing vitals entry
  const [latestMews, setLatestMews] = useState<number | null>(null);

  // Insurance pre-auth banner: undefined=loading, false=not needed, true=needed
  const [preAuthNeeded, setPreAuthNeeded] = useState<boolean>(false);

  // Blood request state
  const [showBloodRequest, setShowBloodRequest] = useState(false);
  const [pendingBloodCount, setPendingBloodCount] = useState(0);

  useEffect(() => {
    if (!bed?.admission) { setDeptName(null); return; }
    const admData = bed.admission as any;
    if (admData.department_id) {
      supabase.from('departments').select('name').eq('id', admData.department_id).maybeSingle()
        .then(({ data, error }) => {
          if (error) console.error("IPD: department fetch failed:", error.message);
          setDeptName(data?.name || null);
        });
    } else {
      setDeptName(null);
    }
  }, [bed]);

  const specialty = useMemo(() => getSpecialtySheet(deptName), [deptName]);

  useEffect(() => {
    if (!bed?.admission) { setPatient(null); return; }
    const admissionData = bed.admission as any;
    supabase.from("patients").select("*")
      .eq("id", admissionData.patient_id || "")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error("IPD: patient fetch failed:", error.message);
        if (data) setPatient(data as unknown as PatientDetails);
      });
  }, [bed]);

  // Fetch estimate for this admission
  useEffect(() => {
    if (!bed?.admission) { setEstimate(undefined); return; }
    const admissionData = bed.admission as any;
    (supabase as any).from("admission_estimates")
      .select("id, estimated_days, estimated_amount, deposit_required, remarks, created_at")
      .eq("admission_id", admissionData.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }: any) => {
        if (error) console.error("IPD: estimate fetch failed:", error.message);
        setEstimate(data || null);
      });
  }, [bed, showEstimateModal]);

  // Fetch MLC case status when admission has is_mlc=true
  useEffect(() => {
    const admData = bed?.admission as any;
    if (!admData?.is_mlc) { setMlcCaseStatus(null); return; }
    (supabase as any).from("mlc_cases")
      .select("id", { count: "exact", head: true })
      .eq("admission_id", admData.id)
      .then(({ count, error }: any) => {
        // On error, preserve the conservative default (treat as undocumented → blocks discharge).
        if (error) console.error("IPD: MLC case-status check failed:", error.message);
        setMlcCaseStatus((count ?? 0) > 0);
      });
  }, [bed, showMlcModal]);

  // Fetch latest NEWS2 + MEWS scores from nursing_vitals (auto-calculated on each entry)
  useEffect(() => {
    if (!bed?.admission) { setLatestNews2(null); setLatestMews(null); return; }
    const admData = bed.admission as any;
    (supabase as any).from("nursing_vitals")
      .select("news2_score, mews_score")
      .eq("admission_id", admData.id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }: any) => {
        if (error) console.error("IPD: NEWS2/MEWS fetch failed:", error.message);
        setLatestNews2(data?.news2_score ?? null);
        setLatestMews(data?.mews_score ?? null);
      });
  }, [bed, activeTab]);

  // Check if insurance pre-auth is required for this admission
  useEffect(() => {
    const admData = bed?.admission as any;
    if (!admData?.id || !INSURANCE_PAYER_TYPES.includes(admData.payer_type)) {
      setPreAuthNeeded(false);
      return;
    }
    (supabase as any)
      .from("insurance_pre_auth")
      .select("id", { count: "exact", head: true })
      .eq("admission_id", admData.id)
      .eq("status", "approved")
      .then(({ count, error }: any) => {
        if (error) console.error("IPD: pre-auth check failed:", error.message);
        setPreAuthNeeded((count ?? 0) === 0);
      });
  }, [bed]);

  // Pending blood requests badge
  useEffect(() => {
    const admData = bed?.admission as any;
    if (!admData?.id) { setPendingBloodCount(0); return; }
    (supabase as any)
      .from("blood_requests")
      .select("id", { count: "exact", head: true })
      .eq("admission_id", admData.id)
      .in("status", ["pending", "processing"])
      .then(({ count, error }: any) => {
        if (error) console.error("IPD: blood request count failed:", error.message);
        setPendingBloodCount(count ?? 0);
      });
  }, [bed, showBloodRequest]);

  // Voice Scribe Integration
  useEffect(() => {
    const fillFn = (data: Record<string, unknown>) => {
      const drugs = ((data.prescription as DrugEntry[]) || []).map((d) => ({
        drug_name: d.drug_name || "",
        dose: d.dose || "",
        route: d.route || "Oral",
        frequency: d.frequency || "OD",
        duration_days: (d as any).duration || "",
        instructions: d.instructions || "",
        quantity: "",
        is_stat: false,
      }));

      const isRadiology = (name: string) => isRadiologyKeyword(name);

      const labOrders: LabOrder[] = [];
      const radOrders: RadiologyOrder[] = [];
      ((data.investigations as string[]) || []).forEach((name) => {
        if (isRadiology(name)) radOrders.push({ test_name: name, urgency: "routine", clinical_indication: "" });
        else labOrders.push({ test_name: name, urgency: "routine", clinical_indication: "" });
      });

      if (drugs.length > 0 || labOrders.length > 0 || radOrders.length > 0) {
        setPrescription((prev) => ({
          ...prev,
          drugs: [...prev.drugs, ...drugs],
          lab_orders: [...prev.lab_orders, ...labOrders],
          radiology_orders: [...prev.radiology_orders, ...radOrders],
          advice_notes: (data.advice_notes as string) || (data.follow_up as string) || prev.advice_notes,
        }));
        setActiveTab("rx_orders");
        toast({ title: "Voice scribe populated Rx & Orders" });
      }
    };
    registerScreen("ipd_workspace", fillFn);
    return () => unregisterScreen("ipd_workspace");
  }, [registerScreen, unregisterScreen]);

  // ── ICU ward detection ──────────────────────────────────────────────────────
  const [isIcuWard, setIsIcuWard] = React.useState(false);
  React.useEffect(() => {
    if (!bed?.ward_id) { setIsIcuWard(false); return; }
    (supabase as any).from("wards").select("type").eq("id", bed.ward_id).maybeSingle()
      .then(({ data, error }: any) => {
        if (error) console.error("IPD: ward-type fetch failed:", error.message);
        setIsIcuWard(["icu", "nicu", "picu", "hdu"].includes(data?.type || ""));
      });
  }, [bed?.ward_id]);

  // ── Consent validity state ──────────────────────────────────────────────────
  const [consentStatus, setConsentStatus] = React.useState<"loading"|"none"|"valid"|"expired">("loading");
  const [showConsentModal, setShowConsentModal] = React.useState(false);

  React.useEffect(() => {
    const admId = (bed?.admission as any)?.id;
    if (!admId || !hospitalId) { setConsentStatus("none"); return; }
    (supabase as any)
      .from("patient_consents")
      .select("id, consent_given, valid_until, patient_signature")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", admId)
      .eq("consent_given", true)
      .order("consented_at", { ascending: false })
      .limit(1)
      .then(({ data, error }: any) => {
        if (error) console.error("IPD: consent-status fetch failed:", error.message);
        if (!data || data.length === 0) { setConsentStatus("none"); return; }
        const record = data[0];
        if (!record.patient_signature) { setConsentStatus("none"); return; }
        if (record.valid_until && new Date(record.valid_until) < new Date()) {
          setConsentStatus("expired");
        } else {
          setConsentStatus("valid");
        }
      });
  }, [(bed?.admission as any)?.id, hospitalId, showConsentModal]);

  if (!bed) {
    return (
      <div className="flex-1 bg-muted/30 flex flex-col items-center justify-center">
        <BedDouble className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <p className="text-base text-muted-foreground">Click a bed to view patient details</p>
        <p className="text-[13px] text-muted-foreground/60 mt-1">or click an available bed to admit a new patient</p>
      </div>
    );
  }

  if (bed.status === "available") {
    return (
      <div className="flex-1 bg-muted/30 flex flex-col items-center justify-center">
        <BedDouble className="h-10 w-10 text-emerald-400 mb-3" />
        <p className="text-base text-foreground">Bed {bed.bed_number} is available</p>
        <p className="text-[13px] text-muted-foreground mt-2">Click "+ New Admission" to admit a patient</p>
      </div>
    );
  }

  if (bed.status !== "occupied" || !bed.admission) {
    return (
      <div className="flex-1 bg-muted/30 flex flex-col items-center justify-center">
        <BedDouble className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-base text-muted-foreground">Bed {bed.bed_number} — {bed.status}</p>
      </div>
    );
  }

  const adm = bed.admission;
  const admissionId = adm.id;


  const patientAge = patient?.dob
    ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31557600000)
    : null;

  const typeColors: Record<string, string> = {
    elective: "bg-blue-50 text-blue-600",
    emergency: "bg-red-50 text-red-600",
    transfer: "bg-violet-50 text-violet-600",
    daycare: "bg-emerald-50 text-emerald-600",
  };

  const handleInitiateDischarge = async () => {
    setActiveTab("overview");
    setHighlightDischarge(true);
    setTimeout(() => setHighlightDischarge(false), 4000);

    setInitiatingDischarge(true);
    try {
      const { startedAt, alreadyStarted } = await initiateDischargeWorkflow(admissionId, hospitalId);
      announceDischargeInitiated(admissionId, startedAt);
      toast(alreadyStarted
        ? { title: "Discharge workflow already running", description: "Complete the pending clearances below." }
        : { title: "Discharge workflow initiated", description: "TAT clock started — Billing, Pharmacy and Nursing have been notified." });
    } catch (e: any) {
      toast({ title: "Could not initiate discharge", description: e?.message, variant: "destructive" });
    } finally {
      setInitiatingDischarge(false);
    }
  };

  const handleEscalate = async () => {
    if (!hospitalId || !patient) return;
    // Phase 9 fix: this insert used wrong column names (`message`/`status`) — the table
    // uses `alert_message` and has no `status` column, so every escalation silently
    // failed. `escalation` is now a permitted alert_type (Phase 1 constraint fix).
    const { error } = await supabase.from("clinical_alerts").insert({
      hospital_id: hospitalId,
      patient_id: patient.id,
      alert_type: "escalation",
      severity: "critical",
      alert_message: `ESCALATION: ${patient.full_name} (Bed ${bed.bed_number}) requires immediate attention`,
    } as any);
    if (error) {
      toast({ title: "Escalation failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "🚨 Escalation alert created", description: `ICU/senior team notified for ${patient.full_name}` });
    }
  };

  const handlePrintCaseSheet = async () => {
    if (!bed?.admission || !hospitalId || !patient) return;
    const admissionData = bed.admission as any;

    toast({ title: "Generating case sheet..." });

    const { data: hospital } = await supabase.from("hospitals").select("name, address, logo_url, primary_color").eq("id", hospitalId).maybeSingle();

    const [vitalsRes, medsRes, notesRes] = await Promise.all([
      supabase.from("ipd_vitals").select("*").eq("admission_id", admissionId).order("recorded_at", { ascending: false }),
      supabase.from("ipd_medications").select("*").eq("admission_id", admissionId).order("created_at", { ascending: false }),
      supabase.from("ward_round_notes").select("*, doctor:users!ward_round_notes_doctor_id_fkey(full_name)").eq("admission_id", admissionId).order("created_at", { ascending: false })
    ]);

    const vitalsHtml = vitalsRes.data && vitalsRes.data.length > 0
      ? `<div class="section-title">Vitals History</div>
         <table>
           <tr><th>Time</th><th>BP</th><th>Pulse</th><th>Temp</th><th>SpO2</th><th>RR</th><th>NEWS2</th></tr>
           ${vitalsRes.data.map(v => `<tr>
             <td>${new Date(v.recorded_at).toLocaleString("en-IN", { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
             <td>${v.bp_systolic || '—'}/${v.bp_diastolic || '—'}</td>
             <td>${v.pulse || '—'}</td>
             <td>${v.temperature || '—'}</td>
             <td>${v.spo2 || '—'}%</td>
             <td>${v.respiratory_rate || '—'}</td>
             <td><b>${v.news2_score ?? '—'}</b></td>
           </tr>`).join("")}
         </table>` : "";

    const medsHtml = medsRes.data && medsRes.data.length > 0
      ? `<div class="section-title">Active Medications</div>
         <table>
           <tr><th>Medication</th><th>Dose</th><th>Freq</th><th>Route</th><th>Status</th></tr>
           ${medsRes.data.map(m => `<tr>
             <td><b>${m.drug_name}</b></td><td>${m.dose}</td><td>${m.frequency}</td><td>${m.route}</td>
             <td>${m.is_active ? 'Active' : 'Stopped'}</td>
           </tr>`).join("")}
         </table>` : "";

    const notesHtml = notesRes.data && notesRes.data.length > 0
      ? `<div class="section-title">Clinical Ward Rounds</div>
         ${notesRes.data.map(n => `
           <div style="border:1px solid #e2e8f0; border-radius:4px; padding:10px; margin-bottom:10px; background:#f8fafc;">
             <div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
               <span style="font-size:11px; font-weight:bold;">${new Date(n.created_at).toLocaleString("en-IN")}</span>
               <span style="font-size:11px; color:#64748b;">Dr. ${(n.doctor as any)?.full_name || 'Consultant'}</span>
             </div>
             <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:12px;">
               <div><span class="label">Subjective:</span> ${n.subjective || '—'}</div>
               <div><span class="label">Objective:</span> ${n.objective || '—'}</div>
               <div><span class="label">Assessment:</span> ${n.assessment || '—'}</div>
               <div><span class="label">Plan:</span> ${n.plan || '—'}</div>
             </div>
           </div>
         `).join("")}` : "";

    const body = `
      ${printHeader(hospital?.name || "Hospital", "IPD CASE SHEET", `<p style="font-size:12px">${hospital?.address || ""}</p>`, (hospital as any)?.logo_url, (hospital as any)?.primary_color)}
      <div style="display:flex;justify-content:space-between;border-bottom:2px solid #1A2F5A;padding-bottom:10px;margin-bottom:15px;">
        <div>
          <div class="row"><span class="label">Patient:</span> <b>${patient.full_name}</b></div>
          <div class="row"><span class="label">UHID:</span> <b>${patient.uhid}</b></div>
          <div class="row"><span class="label">Age/Sex:</span> <span>${patientAge}y / ${patient.gender}</span></div>
        </div>
        <div style="text-align:right">
          <div class="row"><span class="label">IP No:</span> <b>${admissionData.admission_number || '—'}</b></div>
          <div class="row"><span class="label">Bed:</span> <b>${bed.bed_number} (${deptName || '—'})</b></div>
          <div class="row"><span class="label">Admitted:</span> <span>${new Date(admissionData.admitted_at).toLocaleDateString("en-IN")}</span></div>
        </div>
      </div>
      ${vitalsHtml}${medsHtml}${notesHtml}
      <div style="margin-top:40px; border-top:1px dashed #cbd5e1; padding-top:20px; font-size:10px; color:#94a3b8; text-align:center;">
        End of Clinical Case Sheet — Generated on ${new Date().toLocaleString("en-IN")}
      </div>`;

    printDocument(`CaseSheet_${patient.uhid}`, body);
  };

  const handlePrintEstimate = async () => {
    if (!patient || !hospitalId || !estimate) return;
    const admissionData = bed.admission as any;
    const { data: hospital } = await supabase.from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();

    // Fetch deposit collected
    const { data: receipts } = await (supabase as any)
      .from("advance_receipts")
      .select("amount, receipt_number, created_at")
      .eq("hospital_id", hospitalId)
      .eq("patient_id", patient.id)
      .order("created_at", { ascending: false })
      .limit(5);
    const depositCollected = (receipts || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

    const body = `
      ${printHeader(hospital?.name || "Hospital", "ADMISSION ESTIMATE", `<p style="font-size:12px">${hospital?.address || ""}</p>`)}
      <div style="display:flex;justify-content:space-between;border-bottom:2px solid #1A2F5A;padding-bottom:10px;margin-bottom:15px;">
        <div>
          <div class="row"><span class="label">Patient:</span> <b>${patient.full_name}</b></div>
          <div class="row"><span class="label">UHID:</span> <b>${patient.uhid}</b></div>
          <div class="row"><span class="label">Age/Sex:</span> <span>${patientAge !== null ? `${patientAge}y` : '—'} / ${patient.gender || '—'}</span></div>
        </div>
        <div style="text-align:right">
          <div class="row"><span class="label">IP No:</span> <b>${admissionData.admission_number || '—'}</b></div>
          <div class="row"><span class="label">Date:</span> <b>${new Date().toLocaleDateString("en-IN")}</b></div>
          <div class="row"><span class="label">Bed:</span> <b>${bed.bed_number}</b></div>
        </div>
      </div>

      <div class="section-title">Estimate Details</div>
      <table>
        <tr><th>Item</th><th style="text-align:right">Amount</th></tr>
        <tr><td>Estimated stay duration</td><td style="text-align:right">${estimate.estimated_days} day${estimate.estimated_days !== 1 ? 's' : ''}</td></tr>
        <tr><td><b>Total Estimated Amount</b></td><td style="text-align:right"><b>${printAmount(estimate.estimated_amount)}</b></td></tr>
        <tr><td>Deposit Required</td><td style="text-align:right">${printAmount(estimate.deposit_required)}</td></tr>
        ${depositCollected > 0 ? `<tr><td>Deposit Collected</td><td style="text-align:right" style="color:#16a34a">${printAmount(depositCollected)}</td></tr>` : ''}
        ${depositCollected > 0 ? `<tr><td><b>Balance Deposit Pending</b></td><td style="text-align:right"><b>${printAmount(Math.max(0, estimate.deposit_required - depositCollected))}</b></td></tr>` : ''}
      </table>

      ${estimate.remarks ? `<div class="section-title">Remarks</div><p style="font-size:12px;color:#475569;">${estimate.remarks}</p>` : ''}

      <div style="margin-top:40px;display:flex;justify-content:space-between;padding-top:20px;border-top:1px solid #e2e8f0;">
        <div style="text-align:center;width:40%;">
          <div style="border-top:1px solid #334155;padding-top:4px;font-size:11px;color:#64748b;">Patient / Attendant Signature</div>
        </div>
        <div style="text-align:center;width:40%;">
          <div style="border-top:1px solid #334155;padding-top:4px;font-size:11px;color:#64748b;">Hospital Stamp & Signature</div>
        </div>
      </div>

      <div style="margin-top:20px;font-size:10px;color:#94a3b8;text-align:center;">
        This is an estimate only. Actual charges may vary. — Generated on ${new Date().toLocaleString("en-IN")}
      </div>`;

    printDocument(`Estimate_${patient.uhid}`, body);
  };

  const handleCommitOrders = async () => {
    if (!hospitalId || !userId || !patient || !admissionId) return;

    const hasDrugs = prescription.drugs.length > 0;
    const hasLabs = prescription.lab_orders.length > 0;
    const hasRads = prescription.radiology_orders.length > 0;

    if (!hasDrugs && !hasLabs && !hasRads) {
      toast({ title: "No new orders to commit" });
      return;
    }

    setSavingOrders(true);
    try {
      if (hasDrugs) {
        const medsToInsert = prescription.drugs.map(d => ({
          hospital_id: hospitalId, admission_id: admissionId,
          drug_name: d.drug_name, dose: d.dose, route: d.route, frequency: d.frequency,
          ordered_by: userId,
          start_date: new Date().toISOString().split('T')[0],
          end_date: d.duration_days ? new Date(Date.now() + parseInt(d.duration_days) * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
          is_active: true
        }));
        const { error: medErr } = await supabase.from("ipd_medications").insert(medsToInsert);
        if (medErr) throw medErr;
      }

      // Charges are posted here, at ORDER time, rather than swept in at discharge. The
      // hospital's per-service policy decides what that means (see lib/ipdAncillaryGate.ts):
      // post_paid keeps today's behaviour (accrues to the admission bill, settled at
      // discharge); pre_paid marks the charge pending_payment and the ward's gate holds the
      // service until a cashier collects. The dedupe keys match the discharge sweep's exactly,
      // so the sweep recognises these lines and does not add them again.
      const policy = await fetchIpdAncillaryPolicy(hospitalId);

      if (hasLabs) {
        const labSync = await syncLabOrders({
          hospitalId, patientId: patient.id, orderedBy: userId, admissionId,
          items: prescription.lab_orders,
        });
        if (labSync.unmatched.length > 0) {
          toast({
            title: `${labSync.unmatched.length} lab test(s) not in the test master — not ordered`,
            description: `${labSync.unmatched.join(", ")}. Order manually from the Lab module or add them in Settings → Lab Tests.`,
            variant: "destructive",
          });
        }

        const charged = await chargeLabOrders({
          hospitalId, patientId: patient.id, admissionId,
          orderIds: labSync.orderIds, orderedBy: userId, policy,
        });
        // A swallowed charge failure would leave the gate with nothing to block on, which it
        // reads as "no charge" and clears — i.e. a free test. Surface it instead.
        if (!charged.ok) throw new Error(charged.error || "Lab charges could not be posted");

        // Mark as billed so orders appear in Lab Queue immediately. The charge now exists on
        // the bill from this moment, whatever the payment mode.
        await supabase.from("lab_orders")
          .update({ billing_status: "billed", payment_status: charged.paymentStatus } as never)
          .eq("admission_id", admissionId)
          .eq("hospital_id", hospitalId)
          .eq("billing_status", "unbilled");
      }

      if (hasRads) {
        const radSync = await syncRadiologyOrders({
          hospitalId, patientId: patient.id, orderedBy: userId, admissionId,
          items: prescription.radiology_orders,
        });

        const charged = await chargeRadiologyOrders({
          hospitalId, patientId: patient.id, admissionId,
          orderIds: radSync.orderIds, orderedBy: userId, policy,
        });
        if (!charged.ok) throw new Error(charged.error || "Radiology charges could not be posted");

        await supabase.from("radiology_orders")
          .update({ billing_status: "billed", payment_status: charged.paymentStatus } as never)
          .eq("admission_id", admissionId)
          .eq("hospital_id", hospitalId)
          .eq("billing_status", "unbilled");
      }

      const prePaid = hasLabs && policy.lab.mode === "pre_paid"
        || hasRads && policy.radiology.mode === "pre_paid";
      toast({
        title: "Orders committed",
        description: prePaid
          ? "Medications active in MAR. Lab/Radiology orders registered — payment is due at the counter before the service is performed."
          : "Medications active in MAR. Lab/Radiology orders registered and charges added to IPD bill.",
      });
      setPrescription(emptyPrescription);
      onRefresh();
    } catch (err: any) {
      toast({ title: "Commit failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingOrders(false);
    }
  };

  return (
    <>
    {waCard}
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/30">

      {/* MEWS ≥ 5 escalation alert */}
      {latestMews !== null && latestMews >= 5 && (
        <div className="flex-shrink-0 w-full bg-red-600 px-5 py-2 flex items-center gap-2 text-white">
          <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
          <span className="text-xs font-bold">⚠️ MEWS Score {latestMews} — Escalate to on-call doctor immediately.</span>
        </div>
      )}

      {/* MLC — undocumented banner (blocking) */}
      {mlcCaseStatus === false && (
        <button
          onClick={() => setShowMlcModal(true)}
          className="flex-shrink-0 w-full bg-red-50 border-b border-red-400 px-5 py-2 flex items-center gap-2 text-red-800 hover:bg-red-100 transition-colors text-left"
        >
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          <span className="text-xs font-bold">⚠️ MLC CASE: Details not documented. Click here to complete. Discharge is blocked until MLC details are recorded.</span>
        </button>
      )}

      {/* Missing estimate banner */}
      {estimate === null && (
        <button
          onClick={() => setShowEstimateModal(true)}
          className="flex-shrink-0 w-full bg-amber-50 border-b border-amber-300 px-5 py-2 flex items-center gap-2 text-amber-800 hover:bg-amber-100 transition-colors text-left"
        >
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-xs font-semibold">⚠️ Estimate &amp; deposit not recorded. Click here to add.</span>
        </button>
      )}

      {/* Pre-Auth Required banner for insurance admissions */}
      {preAuthNeeded && (
        <button
          onClick={() => navigate("/insurance")}
          className="flex-shrink-0 w-full bg-blue-50 border-b border-blue-300 px-5 py-2 flex items-center gap-2 text-blue-800 hover:bg-blue-100 transition-colors text-left"
        >
          <ClipboardList className="h-4 w-4 text-blue-600 shrink-0" />
          <span className="text-xs font-semibold">
            📋 Pre-Authorization Required — {(bed?.admission as any)?.payer_type?.toUpperCase() || "Insurance"} admission. Click to raise Pre-Auth in Insurance module.
          </span>
        </button>
      )}

      {/* Patient Header */}
      <div className="flex-shrink-0 h-[72px] bg-card border-b border-border px-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-[#1A2F5A] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
          {adm.patient_initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-foreground truncate">{adm.patient_name}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {patient?.uhid && <span className="text-[11px] bg-muted text-muted-foreground px-1.5 py-px rounded">{patient.uhid}</span>}
            {(adm as any).admission_number && <span className="text-[11px] bg-blue-50 text-blue-600 px-1.5 py-px rounded">{(adm as any).admission_number}</span>}
            {(adm as any).is_mlc && (
              <span className="text-[11px] bg-red-600 text-white px-1.5 py-px rounded font-bold">
                {(adm as any).mlc_number || "MLC"}
              </span>
            )}
            {patientAge !== null && patient?.gender && <span className="text-[11px] text-muted-foreground">{patientAge}y · {patient.gender}</span>}
            {patient?.blood_group && <span className="text-[11px] bg-red-50 text-red-600 px-1.5 py-px rounded">{patient.blood_group}</span>}
          </div>
        </div>
        <div className="hidden lg:flex flex-col items-start min-w-0 flex-1">
          {(adm as any).admitting_diagnosis && <p className="text-sm text-muted-foreground italic truncate max-w-full">{(adm as any).admitting_diagnosis}</p>}
          <span className="text-[11px] bg-muted text-muted-foreground px-1.5 py-px rounded mt-0.5">Dr. {adm.doctor_name}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {latestNews2 !== null && (
            <span
              className={cn(
                "text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1",
                getNEWS2BadgeClasses(latestNews2)
              )}
              title={`Latest NEWS2: ${latestNews2} (${getNEWS2Level(latestNews2)})`}
            >
              {getNEWS2Level(latestNews2) !== "low" && <AlertTriangle className="h-3 w-3" />}
              NEWS2 {latestNews2}
            </span>
          )}
          {latestMews !== null && (
            <span
              className={cn(
                "text-[11px] font-semibold px-2 py-0.5 rounded-full",
                latestMews >= 5 ? "bg-red-100 text-red-700" :
                latestMews >= 3 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
              )}
              title={`Latest MEWS: ${latestMews}`}
            >
              MEWS {latestMews}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">Day {adm.los_days}</span>
          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", typeColors[adm.admission_type] || "bg-muted text-muted-foreground")}>{adm.admission_type}</span>
          {estimate && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-emerald-700" onClick={handlePrintEstimate} title="Print Estimate">
              <FileText className="h-4 w-4" />
            </Button>
          )}
          {isIcuWard && (
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-red-600 hover:bg-red-700 text-white text-[12px]"
              onClick={() => navigate(`/ipd/icu/${admissionId}`)}
              title="Open full ICU Workspace"
            >
              <MonitorDot size={12} /> ICU Workspace
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-[#1A2F5A]" onClick={handlePrintCaseSheet} title="Print Case Sheet">
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {patient?.id && <ConsentStatusBanner patientId={patient.id} />}

      {/* Informed consent validity banner */}
      {consentStatus === "none" && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0" />
            <p className="text-[12px] text-amber-800 font-medium">
              Informed consent not yet obtained for this admission
            </p>
          </div>
          <button
            onClick={() => setShowConsentModal(true)}
            className="shrink-0 text-[12px] text-amber-700 font-semibold underline hover:text-amber-900 transition-colors"
          >
            Get Consent Now
          </button>
        </div>
      )}
      {consentStatus === "expired" && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-600 shrink-0" />
            <p className="text-[12px] text-red-800 font-medium">
              Consent expired ({'>'}30 days). Renewal required before surgical procedure.
            </p>
          </div>
          <button
            onClick={() => setShowConsentModal(true)}
            className="shrink-0 text-[12px] text-red-700 font-semibold underline hover:text-red-900 transition-colors"
          >
            Renew Consent
          </button>
        </div>
      )}

      {/* Tab strip */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0 h-11 w-full justify-start rounded-none bg-card border-b border-border px-2 gap-0">
          {[
            { v: "overview", l: "Overview" },
            { v: "vitals", l: "Vitals" },
            { v: "medications", l: "Medications" },
            { v: "rx_orders", l: "Rx & Orders" },
            { v: "investigations", l: "🧪 Investigations" },
            { v: "wardround", l: "Ward Round" },
            { v: "notes", l: "Notes" },
            { v: "documents", l: "Documents" },
            { v: "financial", l: "💰 Ledger & Advance" },
            { v: "nursing_kardex", l: "🩺 Kardex" },
            { v: "palliative",  l: "🕊 Palliative Care" },
            { v: "nutrition",   l: "🥗 Nutrition" },
            { v: "wound_care",  l: "🩹 Wound Care" },
            ...(specialty ? [{ v: "specialty", l: `${specialtyTabMeta[specialty].icon} ${specialtyTabMeta[specialty].label}` }] : []),
            ...(patient?.abha_id ? [{ v: "abha_contexts", l: "🛡 ABHA" }] : []),
          ]
            .filter((t) => hasTabAccess("ipd", t.v, permissions, role))
            .map((t) => (
              <TabsTrigger key={t.v} value={t.v}
                className="text-[13px] rounded-none border-b-2 border-transparent data-[state=active]:border-[#1A2F5A] data-[state=active]:text-[#1A2F5A] data-[state=active]:shadow-none data-[state=active]:bg-transparent px-4 h-full"
              >{t.l}</TabsTrigger>
            ))}
        </TabsList>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="overview" className="h-full m-0">
            <IPDOverviewTab admissionId={admissionId} hospitalId={hospitalId} onTabChange={setActiveTab} patientName={patient?.full_name} patientPhone={patient?.phone} highlightDischarge={highlightDischarge} />
          </TabsContent>
          <TabsContent value="vitals" className="h-full m-0">
            <IPDVitalsTab admissionId={admissionId} hospitalId={hospitalId} userId={userId} patientId={patient?.id} />
          </TabsContent>
          <TabsContent value="medications" className="h-full m-0">
            <IPDMedicationsTab admissionId={admissionId} patientId={patient?.id} hospitalId={hospitalId} userId={userId} patientAllergies={patient?.allergies ? patient.allergies.split(",").map(a => a.trim()) : []} />
          </TabsContent>
          <TabsContent value="rx_orders" className="h-full m-0">
            <RxOrdersTab
              prescription={prescription}
              onChange={(p) => setPrescription(prev => ({ ...prev, ...p }))}
              hospitalId={hospitalId}
              patientAllergies={patient?.allergies ? patient.allergies.split(",").map(a => a.trim()) : []}
              patientAge={patientAge || undefined}
              patientGender={patient?.gender || undefined}
              onCommit={handleCommitOrders}
              isSaving={savingOrders}
            />
          </TabsContent>
          <TabsContent value="investigations" className="h-full m-0">
            <InvestigationsTab admissionId={admissionId} hospitalId={hospitalId} patientId={patient?.id} />
          </TabsContent>
          <TabsContent value="wardround" className="h-full m-0">
            <IPDWardRoundTab admissionId={admissionId} hospitalId={hospitalId} userId={userId} patientId={patient?.id || null} />
          </TabsContent>
          <TabsContent value="notes" className="h-full m-0">
            <IPDNotesTab admissionId={admissionId} hospitalId={hospitalId} userId={userId} patientId={patient?.id} />
          </TabsContent>
          <TabsContent value="documents" className="h-full m-0">
            <IPDDocumentsTab admissionId={admissionId} hospitalId={hospitalId} userId={userId} patientId={patient?.id || null} />
          </TabsContent>
          <TabsContent value="financial" className="h-full m-0">
            {hospitalId && patient && (
              <IPDFinancialTab
                admissionId={admissionId}
                patientId={patient.id}
                hospitalId={hospitalId}
                userId={userId}
                patientName={patient.full_name}
              />
            )}
          </TabsContent>
          <TabsContent value="nursing_kardex" className="h-full m-0">
            <NursingKardexTab
              admissionId={admissionId}
              hospitalId={hospitalId}
              userId={userId}
              patientId={patient?.id}
            />
          </TabsContent>

          <TabsContent value="palliative" className="h-full m-0">
            <PalliativeCareTab
              admissionId={admissionId}
              patientId={patient?.id}
              hospitalId={hospitalId}
              userId={userId}
            />
          </TabsContent>

          {patient && hospitalId && userId && (
            <TabsContent value="nutrition" className="h-full m-0">
              <NutritionDieteticsTab
                admissionId={admissionId}
                patientId={patient.id}
                hospitalId={hospitalId}
                userId={userId}
              />
            </TabsContent>
          )}

          {patient && hospitalId && userId && (
            <TabsContent value="wound_care" className="h-full m-0">
              <WoundCareTab
                admissionId={admissionId}
                patientId={patient.id}
                hospitalId={hospitalId}
                userId={userId}
              />
            </TabsContent>
          )}

          {specialty && hospitalId && patient && (
            <TabsContent value="specialty" className="h-full m-0">
              {specialty === 'obstetric' && <ObstetricSheet patientId={patient.id} hospitalId={hospitalId} admissionId={admissionId} />}
              {specialty === 'neonatal' && <NeonatalSheet patientId={patient.id} hospitalId={hospitalId} admissionId={admissionId} />}
              {specialty === 'anaesthesia' && <AnaesthesiaSheet patientId={patient.id} hospitalId={hospitalId} admissionId={admissionId} />}
              {specialty === 'ophthalmology' && <OphthalmologySheet patientId={patient.id} hospitalId={hospitalId} />}
            </TabsContent>
          )}

          {patient?.abha_id && hospitalId && (
            <TabsContent value="abha_contexts" className="h-full m-0 overflow-auto p-4">
              <div className="max-w-2xl">
                <ABDMCareContextsPanel
                  patientId={patient.id}
                  hospitalId={hospitalId}
                />
              </div>
            </TabsContent>
          )}
        </div>
      </Tabs>

      {/* Bottom action bar */}
      <div className="flex-shrink-0 h-14 bg-card border-t border-border px-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <VoiceDictationButton sessionType="ipd_workspace" size="sm" />
          <ClinicalCalculatorPanel onInsertToNote={(text) => {
            window.dispatchEvent(new CustomEvent("insert-clinical-note", { detail: text }));
          }} />
          <Button size="sm" variant="outline" onClick={() => setActiveTab("medications")} className="text-xs h-8">
            💊 Add Medication
          </Button>
          {patient && hospitalId && (
            <Button size="sm" variant="outline" className="text-xs h-8 border-teal-300 text-teal-700 hover:bg-teal-50" onClick={async () => {
              const { error } = await supabase.from("physio_referrals").insert({
                hospital_id: hospitalId, patient_id: patient.id, admission_id: admissionId,
                referred_by: userId || undefined,
                diagnosis: (adm as any).admitting_diagnosis || "Physiotherapy referral",
                goals: [], urgency: "routine",
              } as any);
              if (error) { toast({ title: "Referral failed", description: error.message, variant: "destructive" }); return; }
              toast({ title: "↗ Referred to Physiotherapy" });
            }}>
              <ArrowUpRight size={14} className="mr-1" /> Refer Physio
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 border-red-200 text-red-700 hover:bg-red-50"
            onClick={() => setShowBloodRequest(true)}
          >
            🩸 Request Blood{pendingBloodCount > 0 ? ` (${pendingBloodCount})` : ""}
          </Button>
          {patient && (
            <button onClick={() => navigate(`/patients?id=${patient.id}`)}
              className="flex items-center gap-1 text-[12px] text-primary font-medium hover:underline h-8 px-2">
              View Patient Record <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasActionAccess("ipd", "initiate_discharge", permissions, role) && (
            <Button
              size="sm"
              variant="outline"
              disabled={initiatingDischarge}
              className="text-xs h-8 border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                if (mlcCaseStatus === false) {
                  toast({ title: "Cannot discharge — MLC details not documented", variant: "destructive" });
                  return;
                }
                // NABH: informed consent should be on file. Confirm (not hard-block) so
                // discharge is never prevented, but the gap is surfaced to the user.
                if (consentStatus === "none" || consentStatus === "expired") {
                  const msg = consentStatus === "expired"
                    ? "Informed consent has expired for this admission. Continue with discharge anyway?"
                    : "Informed consent is not on file for this admission. Continue with discharge anyway?";
                  if (!window.confirm(msg)) return;
                }
                handleInitiateDischarge();
              }}
            >
              🏠 Initiate Discharge
            </Button>
          )}
          {hasActionAccess("ipd", "bed_transfer", permissions, role) && (
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowTransfer(true)}>
              🔁 Transfer
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-xs h-8 border-red-300 text-red-600 hover:bg-red-50" onClick={handleEscalate}>
            🚨 Escalate
          </Button>
        </div>
      </div>
    </div>

    {/* Transfer Modal */}
    {showTransfer && hospitalId && patient && (
      <BedTransferModal
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        admissionId={admissionId}
        hospitalId={hospitalId}
        currentWardId={(adm as any).ward_id || ""}
        currentBedId={bed.id}
        patientName={patient.full_name}
        onSuccess={onRefresh}
      />
    )}

    {/* MLC Details modal — opened from the MLC undocumented banner */}
    {showMlcModal && hospitalId && patient && (
      <MLCDetailsModal
        hospitalId={hospitalId}
        patientId={patient.id}
        patientName={patient.full_name}
        admissionId={admissionId}
        onClose={() => setShowMlcModal(false)}
        onSaved={() => { setShowMlcModal(false); onRefresh(); }}
      />
    )}

    {/* Estimate-only modal — opened from the missing estimate banner */}
    {showEstimateModal && hospitalId && patient && (
      <AdmitPatientModal
        open={showEstimateModal}
        onClose={() => setShowEstimateModal(false)}
        hospitalId={hospitalId}
        estimateOnlyMode
        existingAdmissionId={admissionId}
        existingPatient={{ id: patient.id, full_name: patient.full_name, uhid: patient.uhid }}
        onAdmitted={() => {
          setShowEstimateModal(false);
          // Re-fetch estimate by resetting to undefined so the useEffect re-runs
          setEstimate(undefined);
          onRefresh();
        }}
      />
    )}

    {showConsentModal && patient && hospitalId && (
      <ConsentSignatureModal
        open={showConsentModal}
        onClose={() => setShowConsentModal(false)}
        admissionId={admissionId}
        patientId={patient.id}
        patientName={patient.full_name}
        hospitalId={hospitalId}
        onAllSigned={() => {
          setShowConsentModal(false);
          setConsentStatus("valid");
        }}
      />
    )}

    {showBloodRequest && patient && hospitalId && (
      <BloodRequestModal
        open={showBloodRequest}
        onClose={() => setShowBloodRequest(false)}
        admissionId={admissionId}
        patientId={patient.id}
        hospitalId={hospitalId}
        patientBloodGroup={patient.blood_group}
        onRequested={() => setPendingBloodCount(c => c + 1)}
      />
    )}
    </>
  );
};

export default IPDWorkspace;
