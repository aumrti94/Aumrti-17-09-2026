import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasTabAccess, hasActionAccess } from "@/lib/tabPermissions";
import { Stethoscope, Mic, Save, CheckCircle, FlaskConical, Building2, Smartphone, ArrowUpRight, User, X, ScanLine, SendHorizonal, Printer } from "lucide-react";
import AdmitPatientModal from "@/components/ipd/AdmitPatientModal";
import OnboardingTour from "@/components/onboarding/OnboardingTour";
import type { OpdToken } from "@/pages/opd/OPDPage";
import VoiceDictationButton from "@/components/voice/VoiceDictationButton";
import ClinicalCalculatorPanel from "@/components/clinical/ClinicalCalculatorPanel";
import { useVoiceScribe } from "@/contexts/VoiceScribeContext";
import ComplaintTab from "./tabs/ComplaintTab";
import VitalsTab from "./tabs/VitalsTab";
import ExaminationTab from "./tabs/ExaminationTab";
import RxOrdersTab from "./tabs/RxOrdersTab";
import HistoryTab from "./tabs/HistoryTab";
import OverdueFollowupBanner from "@/components/clinical/OverdueFollowupBanner";
import { getSpecialtySheet, specialtyTabMeta } from "@/lib/specialtyDetection";
import ObstetricSheet from "@/components/specialty/ObstetricSheet";
import ReferralLetterModal from "@/components/opd/ReferralLetterModal";
import DifferentialDiagnosisPanel from "@/components/opd/DifferentialDiagnosisPanel";
import ClinicalDecisionSupport from "@/components/opd/ClinicalDecisionSupport";
import NeonatalSheet from "@/components/specialty/NeonatalSheet";
import AnaesthesiaSheet from "@/components/specialty/AnaesthesiaSheet";
import OphthalmologySheet from "@/components/specialty/OphthalmologySheet";
import { sendWhatsApp } from "@/lib/whatsapp-send";
import { isRadiologyKeyword } from "@/lib/investigationSync";
import { printDocument, printHeader } from "@/lib/printUtils";
import { logRecordAccess } from "@/lib/ims";
import { translateText, getHospitalLanguages, ALL_PATIENT_LANGUAGES, buildBilingualHtml } from "@/lib/translateUtils";

interface Props {
  token: OpdToken | null;
  hospitalId: string | null;
  userId: string | null;
  onTokenUpdate: () => void;
  showPatientDetails?: boolean;
  onTogglePatientDetails?: () => void;
}

export interface EncounterData {
  id?: string;
  chief_complaint: string;
  history_of_present_illness: string;
  vitals: Record<string, unknown>;
  examination_notes: string;
  soap_subjective: string;
  soap_objective: string;
  soap_assessment: string;
  soap_plan: string;
  diagnosis: string;
  icd10_code: string;
  follow_up_date: string;
  follow_up_notes: string;
}

export interface PrescriptionData {
  id?: string;
  drugs: DrugEntry[];
  lab_orders: LabOrder[];
  radiology_orders: RadiologyOrder[];
  advice_notes: string;
  review_date: string;
  is_signed: boolean;
}

export interface DrugEntry {
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  duration_days: string;
  instructions: string;
  quantity: string;
  is_stat: boolean;
  is_ndps?: boolean;
}

export interface LabOrder {
  test_name: string;
  urgency: string;
  clinical_indication: string;
}

export interface RadiologyOrder {
  study_name: string;
  urgency: string;
  clinical_indication: string;
}

const emptyEncounter: EncounterData = {
  chief_complaint: "", history_of_present_illness: "", vitals: {},
  examination_notes: "", soap_subjective: "", soap_objective: "",
  soap_assessment: "", soap_plan: "", diagnosis: "", icd10_code: "",
  follow_up_date: "", follow_up_notes: "",
};

const emptyPrescription: PrescriptionData = {
  drugs: [], lab_orders: [], radiology_orders: [],
  advice_notes: "", review_date: "", is_signed: false,
};

const BASE_TABS = [
  { key: "complaint", label: "Complaint" },
  { key: "vitals", label: "Vitals" },
  { key: "examination", label: "Examination" },
  { key: "guidance", label: "AI Guidance" },
  { key: "rx_orders", label: "Rx & Orders" },
  { key: "history", label: "History" },
] as const;

const ConsultationWorkspace: React.FC<Props> = ({ token, hospitalId, userId, onTokenUpdate, showPatientDetails, onTogglePatientDetails }) => {
  const { toast } = useToast();
  const { registerScreen, unregisterScreen } = useVoiceScribe();
  const { permissions, role } = useHospitalContext();
  const [activeTab, setActiveTab] = useState("complaint");
  const [encounter, setEncounter] = useState<EncounterData>(emptyEncounter);
  const [prescription, setPrescription] = useState<PrescriptionData>(emptyPrescription);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [prescriptionId, setPrescriptionId] = useState<string | null>(null);
  const [diagnosisSeed, setDiagnosisSeed] = useState<{ text: string; icd10_code: string; nonce: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const prevTokenId = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const radStudyNamesRef = useRef<Set<string>>(new Set());
  const [deptName, setDeptName] = useState<string | null>(null);
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [hospitalInfo, setHospitalInfo] = useState<any>(null);

  // Translated advice for bilingual print
  const [printLang, setPrintLang]           = useState("English");
  const [translatedAdvice, setTranslatedAdvice] = useState("");
  const [translatingAdvice, setTranslatingAdvice] = useState(false);
  const [availablePrintLangs, setAvailablePrintLangs] = useState<string[]>(["English"]);

  // Warn on browser close/refresh when dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);


  // Load hospital info
  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("hospitals").select("name, address, phone, email, website, logo_url").eq("id", hospitalId).maybeSingle()
      .then(({ data }) => setHospitalInfo(data));
  }, [hospitalId]);

  // Load hospital's preferred patient languages for print
  useEffect(() => {
    if (!hospitalId) return;
    getHospitalLanguages(hospitalId).then((langs) => setAvailablePrintLangs(langs));
  }, [hospitalId]);

  // Load radiology study names for voice-scribe classification
  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("radiology_study_master")
      .select("study_name")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .then(({ data }: any) => {
        radStudyNamesRef.current = new Set(
          (data || []).map((r: any) => (r.study_name as string).toLowerCase())
        );
      });
  }, [hospitalId]);

  // Fetch department name for specialty detection
  useEffect(() => {
    if (!token?.department_id) { setDeptName(null); return; }
    supabase.from('departments').select('name').eq('id', token.department_id).maybeSingle()
      .then(({ data }) => setDeptName(data?.name || null));
  }, [token?.department_id]);

  const specialty = useMemo(() => getSpecialtySheet(deptName), [deptName]);
  const TABS = useMemo(() => {
    const all: { key: string; label: string }[] = [
      ...BASE_TABS,
      ...(specialty ? [{ key: "specialty", label: `${specialtyTabMeta[specialty].icon} ${specialtyTabMeta[specialty].label}` }] : []),
    ];
    return all.filter((t) => hasTabAccess("opd", t.key, permissions, role));
  }, [specialty, permissions, role]);

  // Auto-reset activeTab to first available if current tab is no longer visible
  useEffect(() => {
    if (TABS.length > 0 && !TABS.some((t) => t.key === activeTab)) {
      setActiveTab(TABS[0].key);
    }
  }, [TABS, activeTab]);
  const encounterRef = useRef(encounter);
  const prescriptionRef = useRef(prescription);
  encounterRef.current = encounter;
  prescriptionRef.current = prescription;

  // Register fill function for voice scribe
  useEffect(() => {
    const fillFn = (data: Record<string, unknown>) => {
      const enc = encounterRef.current;
      const rx = prescriptionRef.current;
      // Fill encounter fields
      setEncounter((prev) => ({
        ...prev,
        chief_complaint: (data.chief_complaint as string) || prev.chief_complaint,
        history_of_present_illness: (data.history_of_present_illness as string) || prev.history_of_present_illness,
        examination_notes: (data.examination_findings as string) || prev.examination_notes,
        diagnosis: (data.diagnosis as string) || prev.diagnosis,
        icd10_code: (data.icd_suggestion as string) || prev.icd10_code,
        soap_plan: (data.plan as string) || prev.soap_plan,
        follow_up_notes: (data.follow_up as string) || prev.follow_up_notes,
      }));
      // Seed diagnosis into the DiagnosisPanel so it appears as a working chip
      if (typeof data.diagnosis === "string" && data.diagnosis.trim()) {
        setDiagnosisSeed({
          text: data.diagnosis,
          icd10_code: (data.icd_suggestion as string) || "",
          nonce: Date.now(),
        });
      }
      // Fill prescription
      const drugs = ((data.prescription as DrugEntry[]) || []).map((d) => ({
        drug_name: d.drug_name || "",
        dose: d.dose || "",
        route: d.route || "Oral",
        frequency: d.frequency || "OD",
        duration_days: (d as unknown as Record<string, string>).duration || "",
        instructions: d.instructions || "",
        quantity: "",
        is_stat: false,
      }));
      const isRadiology = (name: string) =>
        radStudyNamesRef.current.has(name.toLowerCase()) ||
        isRadiologyKeyword(name);

      const labOrders: { test_name: string; urgency: string; clinical_indication: string }[] = [];
      const radOrders: { study_name: string; urgency: string; clinical_indication: string }[] = [];
      ((data.investigations as string[]) || []).forEach((name) => {
        if (isRadiology(name)) radOrders.push({ study_name: name, urgency: "routine", clinical_indication: "" });
        else labOrders.push({ test_name: name, urgency: "routine", clinical_indication: "" });
      });

      if (drugs.length > 0 || labOrders.length > 0 || radOrders.length > 0) {
        setPrescription((prev) => ({
          ...prev,
          drugs: [...prev.drugs, ...drugs],
          lab_orders: [...prev.lab_orders, ...labOrders],
          radiology_orders: [...prev.radiology_orders, ...radOrders],
        }));
      }
      // Follow-up now lands reliably in encounter.follow_up_notes (set above),
      // so it is no longer dropped when there are no drugs/orders.
    };
    // Snapshot the current form (mapped back to the AI's field names) so a
    // follow-up recording MERGES with what's already here instead of wiping it.
    // Text fields only — prescriptions/investigations are appended by fillFn, so
    // sending them here too would double them up.
    const getExistingData = (): Record<string, unknown> | null => {
      const enc = encounterRef.current;
      const data: Record<string, unknown> = {};
      if (enc.chief_complaint?.trim()) data.chief_complaint = enc.chief_complaint;
      if (enc.history_of_present_illness?.trim()) data.history_of_present_illness = enc.history_of_present_illness;
      if (enc.examination_notes?.trim()) data.examination_findings = enc.examination_notes;
      if (enc.diagnosis?.trim()) data.diagnosis = enc.diagnosis;
      if (enc.icd10_code?.trim()) data.icd_suggestion = enc.icd10_code;
      if (enc.soap_plan?.trim()) data.plan = enc.soap_plan;
      if (enc.follow_up_notes?.trim()) data.follow_up = enc.follow_up_notes;
      return Object.keys(data).length > 0 ? data : null;
    };
    registerScreen("opd_consultation", fillFn, getExistingData);
    return () => unregisterScreen("opd_consultation");
  }, [registerScreen, unregisterScreen]);

  // Load encounter when token changes
  useEffect(() => {
    if (!token || !hospitalId || !userId) {
      setEncounter(emptyEncounter);
      setPrescription(emptyPrescription);
      setEncounterId(null);
      setPrescriptionId(null);
      setDiagnosisSeed(null);
      return;
    }
    if (token.id === prevTokenId.current) return;
    prevTokenId.current = token.id;
    isDirtyRef.current = false;
    setDiagnosisSeed(null);

    (async () => {
      // Fetch existing encounter for this token
      const { data: enc } = await supabase
        .from("opd_encounters")
        .select("*")
        .eq("token_id", token.id)
        .maybeSingle();

      if (enc) {
        setEncounterId(enc.id);
        setEncounter({
          chief_complaint: enc.chief_complaint || "",
          history_of_present_illness: enc.history_of_present_illness || "",
          vitals: (enc.vitals as Record<string, unknown>) || {},
          examination_notes: enc.examination_notes || "",
          soap_subjective: enc.soap_subjective || "",
          soap_objective: enc.soap_objective || "",
          soap_assessment: enc.soap_assessment || "",
          soap_plan: enc.soap_plan || "",
          diagnosis: enc.diagnosis || "",
          icd10_code: enc.icd10_code || "",
          follow_up_date: enc.follow_up_date || "",
          follow_up_notes: enc.follow_up_notes || "",
        });

        // Fetch prescription
        const { data: rx } = await supabase
          .from("prescriptions")
          .select("*")
          .eq("encounter_id", enc.id)
          .maybeSingle();
        if (rx) {
          setPrescriptionId(rx.id);
          setPrescription({
            drugs: (rx.drugs as unknown as DrugEntry[]) || [],
            lab_orders: (rx.lab_orders as unknown as LabOrder[]) || [],
            radiology_orders: (rx.radiology_orders as unknown as RadiologyOrder[]) || [],
            advice_notes: rx.advice_notes || "",
            review_date: rx.review_date || "",
            is_signed: rx.is_signed || false,
          });
        } else {
          setPrescription(emptyPrescription);
          setPrescriptionId(null);
        }
      } else {
        setEncounter(emptyEncounter);
        setPrescription(emptyPrescription);
        setEncounterId(null);
        setPrescriptionId(null);
      }
    })();
  }, [token, hospitalId, userId]);

  // Auto-save encounter
  const autoSaveEncounter = useCallback(async (data: EncounterData) => {
    if (!token || !hospitalId || !userId) return;
    setSaving(true);
    setSaved(false);
    try {
      const payload = {
        hospital_id: hospitalId,
        token_id: token.id,
        patient_id: token.patient_id,
        doctor_id: token.doctor_id || userId,
        visit_date: new Date().toISOString().split("T")[0],
        chief_complaint: data.chief_complaint || null,
        history_of_present_illness: data.history_of_present_illness || null,
        vitals: data.vitals as unknown as import("@/integrations/supabase/types").Json,
        examination_notes: data.examination_notes || null,
        soap_subjective: data.soap_subjective || null,
        soap_objective: data.soap_objective || null,
        soap_assessment: data.soap_assessment || null,
        soap_plan: data.soap_plan || null,
        diagnosis: data.diagnosis || null,
        icd10_code: data.icd10_code || null,
        follow_up_date: data.follow_up_date || null,
        follow_up_notes: data.follow_up_notes || null,
        updated_at: new Date().toISOString(),
      };

      if (encounterId) {
        await supabase.from("opd_encounters").update(payload as never).eq("id", encounterId);
      } else {
        const { data: newEnc } = await supabase.from("opd_encounters").insert([payload] as never).select("id").maybeSingle();
        if (newEnc) {
          setEncounterId(newEnc.id);
          // Backfill encounter_id into the single walk-in bill for this token.
          // Fetch the most recent unlinked bill first (PostgREST UPDATE has no LIMIT),
          // then update only that one row so we don't link other patients' or
          // other tokens' bills to this encounter.
          const today = new Date().toISOString().split("T")[0];
          const { data: unlinkedBill } = await (supabase as any)
            .from("bills")
            .select("id")
            .eq("patient_id", token.patient_id)
            .eq("bill_type", "opd")
            .eq("hospital_id", hospitalId)
            .eq("bill_date", today)
            .is("encounter_id", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (unlinkedBill?.id) {
            await (supabase as any).from("bills")
              .update({ encounter_id: newEnc.id } as never)
              .eq("id", unlinkedBill.id);
          }
        }
      }
      setSaved(true);
      isDirtyRef.current = false;
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Auto-save error:", err);
    } finally {
      setSaving(false);
    }
  }, [token, hospitalId, userId, encounterId]);


  // Auto-save prescription
  const autoSavePrescription = useCallback(async (data: PrescriptionData) => {
    if (!token || !hospitalId || !userId || !encounterId) return;
    try {
      const payload = {
        hospital_id: hospitalId,
        encounter_id: encounterId,
        patient_id: token.patient_id,
        doctor_id: userId,
        prescription_date: new Date().toISOString().split("T")[0],
        drugs: JSON.parse(JSON.stringify(data.drugs)),
        lab_orders: JSON.parse(JSON.stringify(data.lab_orders)),
        radiology_orders: JSON.parse(JSON.stringify(data.radiology_orders)),
        advice_notes: data.advice_notes || null,
        review_date: data.review_date || null,
        is_signed: data.drugs.length > 0,
      };

      if (prescriptionId) {
        // Save current version to history before overwriting
        try {
          const { data: currentRx } = await supabase
            .from("prescriptions")
            .select("*")
            .eq("id", prescriptionId)
            .maybeSingle();
          if (currentRx) {
            const { count } = await (supabase as any)
              .from("prescription_history")
              .select("id", { count: "exact", head: true })
              .eq("prescription_id", prescriptionId);
            await (supabase as any).from("prescription_history").insert({
              prescription_id: prescriptionId,
              hospital_id: hospitalId,
              version_number: ((count as number) || 0) + 1,
              snapshot: currentRx,
              changed_by: userId,
            });
          }
        } catch (histErr) {
          console.error("Prescription history save error (non-blocking):", histErr);
        }
        await supabase.from("prescriptions").update(payload as never).eq("id", prescriptionId);
      } else {
        const { data: newRx } = await supabase.from("prescriptions").insert([payload] as never).select("id").maybeSingle();
        if (newRx) setPrescriptionId(newRx.id);
      }
    } catch (err) {
      console.error("Prescription save error:", err);
    }
  }, [token, hospitalId, userId, encounterId, prescriptionId]);

  // Debounced update
  const updateEncounter = useCallback((partial: Partial<EncounterData>) => {
    setEncounter((prev) => {
      const next = { ...prev, ...partial };
      isDirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => autoSaveEncounter(next), 2000);
      return next;
    });
  }, [autoSaveEncounter]);

  const handlePrintPrescription = () => {
    if (!token || !hospitalInfo) {
      toast({ title: "Hospital details not found", variant: "destructive" });
      return;
    }
    logRecordAccess({ hospitalId, recordType: "OPD_Record", recordId: token.id, patientId: token.patient_id, action: "print" });

    const drugsHtml = prescription.drugs.length > 0 
      ? `<table>
          <tr><th>Drug Name</th><th>Dose</th><th>Freq</th><th>Duration</th><th>Instructions</th></tr>
          ${prescription.drugs.map(d => `<tr>
            <td><b>${d.drug_name}</b></td>
            <td>${d.dose}</td>
            <td>${d.frequency}</td>
            <td>${d.duration_days} days</td>
            <td style="font-size:11px">${d.instructions}</td>
          </tr>`).join("")}
        </table>`
      : "<p>No medications prescribed.</p>";

    const labHtml = prescription.lab_orders.length > 0
      ? `<div class="section-title">Lab Orders</div><ul style="margin:0;padding-left:20px;">${prescription.lab_orders.map(l => `<li>${l.test_name}</li>`).join("")}</ul>`
      : "";
    const radHtml = prescription.radiology_orders.length > 0
      ? `<div class="section-title" style="margin-top:10px;">Radiology Orders</div><ul style="margin:0;padding-left:20px;">${prescription.radiology_orders.map(r => `<li>${r.study_name}</li>`).join("")}</ul>`
      : "";
    const investigationsHtml = labHtml || radHtml ? `${labHtml}${radHtml}` : "";

    const vitalsHtml = Object.entries(encounter.vitals).length > 0
      ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:15px;background:#f8fafc;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">
          ${Object.entries(encounter.vitals).map(([k, v]) => `<div><span class="label" style="text-transform:capitalize">${k}:</span> <b>${v}</b></div>`).join("")}
        </div>`
      : "";

    const body = `
      ${printHeader(hospitalInfo.name, "OPD PRESCRIPTION", `<p style="font-size:12px;color:#64748b;margin:2px 0;">${hospitalInfo.address || ""}</p>`)}
      
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:20px;">
        <div style="flex:1">
          <div style="margin-bottom:4px;"><span class="label">Patient:</span> <b>${token.patient?.full_name}</b></div>
          <div style="margin-bottom:4px;"><span class="label">UHID:</span> <b>${token.patient?.uhid}</b></div>
          <div style="margin-bottom:4px;"><span class="label">Age/Sex:</span> <span>${token.patient?.dob ? Math.floor((Date.now() - new Date(token.patient.dob).getTime()) / 31557600000) : "--"}y / ${token.patient?.gender || "--"}</span></div>
        </div>
        <div style="text-align:right;flex:1">
          <div style="margin-bottom:4px;"><span class="label">Date:</span> <b>${new Date().toLocaleDateString("en-IN")}</b></div>
          <div style="margin-bottom:4px;"><span class="label">Doctor:</span> <b>${token.doctor?.full_name || "Dr. Consultation"}</b></div>
          <div style="margin-bottom:4px;"><span class="label">Dept:</span> <span>${deptName || "--"}</span></div>
        </div>
      </div>

      ${vitalsHtml}

      <div class="section-title">Clinical Notes</div>
      <div style="margin-bottom:15px;line-height:1.5;">
        <p style="margin:4px 0;"><span class="label">Chief Complaint:</span> ${encounter.chief_complaint || "--"}</p>
        ${encounter.history_of_present_illness ? `<p style="margin:4px 0 0 0;"><span class="label">History of Present Illness:</span></p><div style="white-space:pre-wrap;margin:0 0 4px 0;">${encounter.history_of_present_illness}</div>` : ""}
        ${encounter.soap_assessment ? `<p style="margin:4px 0;"><span class="label">Assessment:</span> ${encounter.soap_assessment}</p>` : ""}
        ${encounter.diagnosis ? `<p style="margin:4px 0;"><span class="label">Diagnosis:</span> <b>${encounter.diagnosis}</b> ${encounter.icd10_code ? `(${encounter.icd10_code})` : ""}</p>` : ""}
      </div>

      <div class="section-title">Rx (Prescription)</div>
      ${drugsHtml}

      ${investigationsHtml}

      ${encounter.soap_plan
          ? `<div class="section-title" style="margin-top:10px;">Plan &amp; Investigations</div><div style="white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">${encounter.soap_plan}</div>`
          : ""}

      ${prescription.advice_notes
          ? translatedAdvice && printLang !== "English"
            ? buildBilingualHtml(prescription.advice_notes, translatedAdvice, printLang, ALL_PATIENT_LANGUAGES.find(l => l.code === printLang)?.native || printLang)
            : `<div class="section-title">Advice & Instructions</div><div style="white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">${prescription.advice_notes}</div>`
          : ""}

      ${(() => {
        const reviewDate = prescription.review_date || encounter.follow_up_date;
        return (encounter.follow_up_notes || reviewDate) ? `<div style="margin-top:20px;padding:10px;border:1px dashed #1A2F5A;border-radius:4px;background:#f0f7ff;">
        <b style="color:#1A2F5A">Follow-up</b>
        ${reviewDate ? `<span style="margin-left:6px;color:#1A2F5A;">Review date: ${new Date(reviewDate).toLocaleDateString("en-IN")}</span>` : ""}
        ${encounter.follow_up_notes ? `<p style="margin-top:5px;font-size:12px;color:#475569;white-space:pre-wrap;">${encounter.follow_up_notes}</p>` : ""}
      </div>` : "";
      })()}

      <div style="margin-top:80px;display:flex;justify-content:flex-end;">
        <div style="text-align:center;width:220px;border-top:1px solid #1e293b;padding-top:8px;">
          <p style="margin:0;font-weight:bold;color:#1A2F5A;">${token.doctor?.full_name || "Doctor's Signature"}</p>
          <p style="margin:0;font-size:10px;color:#64748b;">Medical Council Registration Number</p>
        </div>
      </div>
    `;

    printDocument(`Prescription_${token.patient?.uhid}`, body);
  };

  const updatePrescription = useCallback((partial: Partial<PrescriptionData>) => {
    setPrescription((prev) => {
      const next = { ...prev, ...partial };
      isDirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        autoSaveEncounter(encounter);
        autoSavePrescription(next);
      }, 2000);
      return next;
    });
  }, [autoSaveEncounter, autoSavePrescription, encounter]);

  // Add a lab test (used by the Clinical Guidance recommended-investigations chips)
  const addLabOrder = useCallback((name: string) => {
    if (!name.trim()) return;
    setPrescription((prev) => {
      if (prev.lab_orders.some((l) => l.test_name === name)) return prev;
      const next = { ...prev, lab_orders: [...prev.lab_orders, { test_name: name, urgency: "routine", clinical_indication: "" }] };
      isDirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => autoSavePrescription(next), 2000);
      return next;
    });
  }, [autoSavePrescription]);

  const handleStartConsultation = async () => {
    if (!token) return;
    await supabase.from("opd_tokens").update({
      status: "in_consultation",
      called_at: new Date().toISOString(),
      consultation_start_at: new Date().toISOString(),
    }).eq("id", token.id);
    onTokenUpdate();
  };

  const handleComplete = async () => {
    if (!encounterId) return;

    // Soft reminder if doctor has pending lab/radiology orders in the prescription JSON.
    // Lab/Radiology orders are created through the billing flow (New Lab Order / New Radiology Order)
    // after payment — they should NOT be auto-created here.
    const pendingLabCount = prescription.lab_orders.length;
    const pendingRadCount = prescription.radiology_orders.length;
    if (pendingLabCount > 0 || pendingRadCount > 0) {
      const parts: string[] = [];
      if (pendingLabCount > 0) parts.push(`${pendingLabCount} lab test(s)`);
      if (pendingRadCount > 0) parts.push(`${pendingRadCount} radiology study(s)`);
      toast({
        title: `Reminder: ${parts.join(" and ")} in prescription`,
        description: "Ensure billing has collected payment and created the lab/radiology orders.",
      });
    }

    setFinalizing(true);
    if (!encounter.chief_complaint.trim()) {
      toast({ title: "Chief complaint is required", variant: "destructive" });
      setFinalizing(false);
      return;
    }
    await autoSaveEncounter(encounter);
    if (encounterId) await autoSavePrescription(prescription);
    isDirtyRef.current = false;
    await supabase.from("opd_tokens").update({
      status: "completed",
      consultation_end_at: new Date().toISOString(),
    }).eq("id", token.id);

    // Fire-and-forget ABHA care context linking (non-blocking)
    if (encounterId && hospitalId) {
      supabase.functions.invoke("abdm-auto-link-care-context", {
        body: {
          hospital_id: hospitalId,
          patient_id: token.patient_id,
          event_type: "opd_completed",
          source_id: encounterId,
        },
      }).then(() => {
        if (token.patient?.abha_id) {
          toast({ title: "ABHA record linking initiated" });
        }
      }).catch(() => {});
    }

    // Link OPD bill to encounter_id (bill was created at walk-in without encounter)
    if (encounterId && hospitalId) {
      const today = new Date().toISOString().split("T")[0];
      const { data: opdBill } = await (supabase as any)
        .from("bills")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", token.patient_id)
        .eq("bill_type", "opd")
        .eq("bill_date", today)
        .is("encounter_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (opdBill) {
        await (supabase as any).from("bills").update({
          encounter_id: encounterId,
          updated_at: new Date().toISOString(),
        } as any).eq("id", opdBill.id);
      }
    }

    // Upsert MRD records for this encounter
    if (encounterId && hospitalId) {
      const { data: existingRecord } = await supabase
        .from("medical_records")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", token.patient_id)
        .eq("visit_id", encounterId)
        .maybeSingle();

      if (!existingRecord) {
        await supabase.from("medical_records").insert({
          hospital_id: hospitalId,
          patient_id: token.patient_id,
          visit_id: encounterId,
          record_type: "opd",
          status: "active",
          destroy_after: new Date(
            Date.now() + ((token as any).is_mlc ? 10 : 3) * 365 * 24 * 3600000
          ).toISOString().split("T")[0],
        });

        await supabase.from("icd_codings").insert({
          hospital_id: hospitalId,
          visit_id: encounterId,
          visit_type: "opd",
          status: "pending",
        });
      }
    }

    // ── Consultation Fee Billing ──────────────────────────────────────────────
    // Idempotency: guarded by opd_encounters.consultation_billed.
    // Runs for EVERY consultation finalization — even if a walk-in bill exists.
    // This is the authoritative consultation charge creation point.
    if (encounterId && hospitalId && userId) {
      try {
        // Check idempotency flag first
        const { data: encounterRow } = await (supabase as any)
          .from("opd_encounters")
          .select("consultation_billed, consultation_bill_id, consultation_fee")
          .eq("id", encounterId)
          .maybeSingle();

        if (!encounterRow?.consultation_billed) {
          const { autoChargeService, MODULE_OPD_CONSULT } = await import("@/lib/serviceBilling");
          const { autoPostJournalEntry } = await import("@/lib/accounting");

          // Rate lookup priority: doctor → department → global → ₹500 fallback
          let fee = 500;
          if (token.doctor_id) {
            const { data: docSvc } = await (supabase as any).from("service_master").select("fee")
              .eq("hospital_id", hospitalId).eq("item_type", "consultation").eq("is_active", true)
              .eq("doctor_id", token.doctor_id).limit(1).maybeSingle();
            if (docSvc?.fee) fee = Number(docSvc.fee);
          }
          if (fee === 500 && token.department_id) {
            const { data: deptSvc } = await (supabase as any).from("service_master").select("fee")
              .eq("hospital_id", hospitalId).eq("item_type", "consultation").eq("is_active", true)
              .eq("department_id", token.department_id).is("doctor_id", null).limit(1).maybeSingle();
            if (deptSvc?.fee) fee = Number(deptSvc.fee);
          }
          if (fee === 500) {
            const { data: globalSvc } = await (supabase as any).from("service_master").select("fee")
              .eq("hospital_id", hospitalId).eq("item_type", "consultation").eq("is_active", true)
              .is("doctor_id", null).is("department_id", null).limit(1).maybeSingle();
            if (globalSvc?.fee) fee = Number(globalSvc.fee);
          }

          // Find the OPD bill for this encounter.
          // Primary: bill already linked to this encounter (the "link block" above runs first).
          // Fallback: most recent unlinked bill today (handles portal / same-day registration
          //   where auto-save backfill hasn't run yet). Using IS NULL prevents stealing
          //   another patient's bill when the same patient has multiple tokens today.
          const today = new Date().toISOString().split("T")[0];
          let { data: encounterBill } = await (supabase as any)
            .from("bills")
            .select("id")
            .eq("hospital_id", hospitalId)
            .eq("encounter_id", encounterId)
            .eq("bill_type", "opd")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!encounterBill) {
            ({ data: encounterBill } = await (supabase as any)
              .from("bills")
              .select("id")
              .eq("hospital_id", hospitalId)
              .eq("patient_id", token.patient_id)
              .eq("bill_type", "opd")
              .eq("bill_date", today)
              .is("encounter_id", null)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle());
          }

          let billId = encounterBill?.id;

          if (!billId) {
            // No bill at all — create one (pure follow-up / portal booking)
            const { generateBillNumber } = await import("@/hooks/useBillNumber");
            const billNumber = await generateBillNumber(hospitalId, "OPD");
            const { data: newBill } = await (supabase as any).from("bills").insert({
              hospital_id: hospitalId, patient_id: token.patient_id,
              bill_number: billNumber, bill_type: "opd", bill_date: today,
              encounter_id: encounterId, bill_status: "final", payment_status: "unpaid",
              subtotal: 0, gst_amount: 0, total_amount: 0,
              patient_payable: 0, balance_due: 0, created_by: userId,
            }).select("id").maybeSingle();
            billId = newBill?.id;
          }

          if (billId && fee > 0) {
            // Always link encounter to bill
            await (supabase as any).from("bills")
              .update({ encounter_id: encounterId })
              .eq("id", billId)
              .is("encounter_id", null);

            // Guard: skip if this bill already has ANY consultation line (walk-in or prior finalization)
            const { data: existingItem } = await (supabase as any)
              .from("bill_line_items")
              .select("id")
              .eq("bill_id", billId)
              .eq("item_type", "consultation")
              .maybeSingle();

            if (!existingItem) {
              await (supabase as any).from("bill_line_items").insert({
                hospital_id:      hospitalId,
                bill_id:          billId,
                description:      "Consultation Fee",
                item_type:        "consultation",
                unit_rate:        fee,
                quantity:         1,
                taxable_amount:   fee,
                gst_percent:      0,
                gst_amount:       0,
                total_amount:     fee,
                service_date:     today,
                source_module:    "opd",
                source_record_id: encounterId,
                source_dedupe_key: `opd_consult:${encounterId}`,
                ordered_by:       userId,
              });

              // Recalculate bill totals only when a new line was actually inserted
              const { recalculateBillTotalsSafe } = await import("@/lib/billTotals");
              await recalculateBillTotalsSafe(billId);

              await autoPostJournalEntry({
                triggerEvent: "bill_finalized_opd", sourceModule: "billing",
                sourceId: billId, amount: fee,
                description: `OPD Consultation - ${token.patient?.full_name}`,
                hospitalId, postedBy: userId,
              });

              toast({ title: `Consultation fee ₹${fee.toLocaleString("en-IN")} added to bill` });
            }
          }

          // Always stamp the flag so the encounter is marked billed regardless of which path created the line
          await (supabase as any).from("opd_encounters").update({
            consultation_billed:  true,
            consultation_bill_id: billId ?? null,
            consultation_fee:     fee,
          }).eq("id", encounterId);
        }
      } catch (billErr) {
        console.error("Consultation billing error (non-blocking):", billErr);
      }
    }

    onTokenUpdate();
    toast({ title: `Consultation complete for ${token.patient?.full_name || "patient"}` });
  };

  const handleSendWhatsApp = async () => {
    if (!token?.patient?.phone) {
      toast({ title: "Patient phone number not available", variant: "destructive" });
      return;
    }
    const phone = token.patient.phone.replace(/\D/g, "");
    const drugList = prescription.drugs.map((d) => `• ${d.drug_name} - ${d.dose} - ${d.frequency} - ${d.duration_days} days`).join("\n");
    const labList = prescription.lab_orders.map((l) => l.test_name).join(", ");
    const msg = `🏥 *Prescription*\n*Patient:* ${token.patient.full_name}\n📅 ${new Date().toLocaleDateString("en-IN")}\n\n💊 *Medicines:*\n${drugList || "None"}\n\n🔬 *Lab Tests:* ${labList || "None"}\n\n📋 *Advice:* ${prescription.advice_notes || "—"}\n📅 *Review:* ${prescription.review_date || "As needed"}`;
    await sendWhatsApp({ hospitalId: hospitalId ?? "", phone: `91${phone}`, message: msg });
    if (prescriptionId) {
      supabase.from("prescriptions").update({ whatsapp_sent: true }).eq("id", prescriptionId);
    }
  };

  if (!token) {
    return (
      <div className="flex-1 bg-slate-50 flex flex-col items-center justify-center">
        <Stethoscope className="h-12 w-12 text-slate-300 mb-3" />
        <p className="text-base text-slate-400">Select a patient from the queue</p>
        <p className="text-[13px] text-slate-300 mt-1">or register a walk-in to begin</p>
      </div>
    );
  }

  const initials = (token.patient?.full_name || "?")
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const patientAge = token.patient?.dob
    ? Math.floor((Date.now() - new Date(token.patient.dob).getTime()) / 31557600000)
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      {role === "doctor" && <OnboardingTour tourKey="doctor_opd_intro" />}
      {/* Patient header bar */}
      <div className="flex-shrink-0 h-[60px] bg-white border-b border-slate-200 px-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[#1A2F5A] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-base font-bold text-slate-900 truncate">{token.patient?.full_name}</p>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="bg-slate-100 text-slate-600 px-1.5 py-px rounded">{token.patient?.uhid}</span>
            {patientAge !== null && <span className="text-slate-500">{patientAge}y · {token.patient?.gender || "—"}</span>}
            {token.patient?.blood_group && (
              <span className="bg-red-50 text-red-600 px-1.5 py-px rounded text-[10px]">{token.patient.blood_group}</span>
            )}
          </div>
        </div>

        {/* Allergies */}
        <div className="flex-1 flex items-center gap-1.5 flex-wrap min-w-0 px-2">
          {token.patient?.allergies ? (
            <>
              <span className="text-[10px] font-bold text-red-600">⚠️ Allergies:</span>
              {token.patient.allergies.split(",").map((a, i) => (
                <span key={i} className="text-[10px] bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-px">{a.trim()}</span>
              ))}
            </>
          ) : (
            <span className="text-[11px] text-slate-400">+ Add allergy</span>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs bg-blue-50 text-[#1A2F5A] px-2 py-0.5 rounded font-medium">{token.token_number}</span>
          {token.status === "waiting" && (
            <button onClick={handleStartConsultation} className="text-xs bg-[#1A2F5A] text-white px-3 py-1.5 rounded-md font-semibold hover:bg-[#152647] active:scale-[0.97] transition-all">
              ▶ Start Consultation
            </button>
          )}
          {token.status === "in_consultation" && (
            <button onClick={handleComplete} className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-md font-semibold hover:bg-emerald-600 active:scale-[0.97] transition-all">
              ✓ Complete
            </button>
          )}
          {token && (
            <button onClick={() => setShowReferralModal(true)}
              className="text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 active:scale-[0.97] transition-all">
              <SendHorizonal className="h-3 w-3" /> Refer
            </button>
          )}
         {token && onTogglePatientDetails && !showPatientDetails && (
            <button
              onClick={onTogglePatientDetails}
              className="text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 active:scale-[0.97] transition-all"
            >
              <User className="h-3 w-3" /> Patient Details
            </button>
          )}
         </div>
      </div>

      {/* Tab strip */}
      <div className="flex-shrink-0 h-12 bg-white border-b border-slate-200 flex">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-5 h-full text-[13px] border-b-2 transition-colors",
              activeTab === tab.key
                ? "border-[#1A2F5A] text-[#1A2F5A] font-semibold"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {tab.label}
          </button>
        ))}
        {/* Save indicator */}
        <div className="ml-auto flex items-center pr-4 gap-1">
          {saving && <span className="text-[11px] text-slate-400">Saving...</span>}
          {saved && <span className="text-[11px] text-emerald-500 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Saved</span>}
        </div>
      </div>

      {/* Overdue follow-up banner */}
      {token && <OverdueFollowupBanner patientId={token.patient_id} />}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "complaint" && <ComplaintTab encounter={encounter} onChange={updateEncounter} />}
        {activeTab === "vitals" && <VitalsTab encounter={encounter} onChange={updateEncounter} />}
        {activeTab === "examination" && (
          <ExaminationTab encounter={encounter} onChange={updateEncounter} encounterId={encounterId} hospitalId={hospitalId} patientId={token?.patient_id ?? null} userId={userId} seedDiagnosis={diagnosisSeed} />
        )}
        {activeTab === "guidance" && (
          <div className="h-full overflow-y-auto p-4 space-y-4">
            {/* AI Differential Diagnosis — needs a chief complaint */}
            {hospitalId && encounter.chief_complaint ? (
              <DifferentialDiagnosisPanel
                chiefComplaint={encounter.chief_complaint}
                examination={encounter.examination_notes}
                history={encounter.history_of_present_illness}
                vitals={encounter.vitals as Record<string, any>}
                age={patientAge ?? undefined}
                gender={token?.patient?.gender ?? undefined}
                hospitalId={hospitalId}
                patientId={token?.patient_id ?? null}
                encounterId={encounterId}
                onSelectDiagnosis={(diagnosis, icd10) =>
                  updateEncounter({ diagnosis, icd10_code: icd10 })
                }
              />
            ) : (
              <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Enter a chief complaint to generate AI differential diagnosis.</span>
              </div>
            )}

            {/* Clinical Guidance — needs a diagnosis */}
            {encounter.diagnosis && hospitalId ? (
              <ClinicalDecisionSupport
                diagnosis={encounter.diagnosis}
                icdCode={encounter.icd10_code || ""}
                patientAge={patientAge || undefined}
                patientGender={token?.patient?.gender || undefined}
                hospitalId={hospitalId}
                onAddLabOrder={addLabOrder}
              />
            ) : (
              <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Add a diagnosis to see clinical treatment guidance (first-line treatment, investigations, drug cautions, red flags).</span>
              </div>
            )}
          </div>
        )}
        {activeTab === "rx_orders" && <RxOrdersTab prescription={prescription} onChange={updatePrescription} hospitalId={hospitalId} patientAllergies={token?.patient?.allergies ? token.patient.allergies.split(",").map(a => a.trim()) : []} diagnosis={encounter.diagnosis} icdCode={encounter.icd10_code} patientAge={patientAge || undefined} patientGender={token?.patient?.gender || undefined} encounter={encounter} onEncounterChange={updateEncounter} />}
        {activeTab === "history" && <HistoryTab token={token} encounterId={encounterId} />}
        {activeTab === "specialty" && specialty === 'obstetric' && hospitalId && (
          <ObstetricSheet patientId={token.patient_id} hospitalId={hospitalId} encounterId={encounterId} />
        )}
        {activeTab === "specialty" && specialty === 'neonatal' && hospitalId && (
          <NeonatalSheet patientId={token.patient_id} hospitalId={hospitalId} encounterId={encounterId} />
        )}
        {activeTab === "specialty" && specialty === 'anaesthesia' && hospitalId && (
          <AnaesthesiaSheet patientId={token.patient_id} hospitalId={hospitalId} encounterId={encounterId} />
        )}
        {activeTab === "specialty" && specialty === 'ophthalmology' && hospitalId && (
          <OphthalmologySheet patientId={token.patient_id} hospitalId={hospitalId} encounterId={encounterId} />
        )}
      </div>

      {/* Bottom action bar */}
      <div data-tour="doctor-consult-actions" className="flex-shrink-0 h-14 bg-white border-t border-slate-200 px-4 flex items-center gap-2">
        <button onClick={() => autoSaveEncounter(encounter)} className="text-xs text-slate-600 border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 flex items-center gap-1.5 active:scale-[0.97] transition-all">
          <Save className="h-3.5 w-3.5" /> Save Draft
        </button>
        {hasActionAccess("opd", "complete_and_bill", permissions, role) && (
          <button onClick={handleComplete} className="text-xs bg-[#1A2F5A] text-white px-4 py-1.5 rounded-md font-semibold hover:bg-[#152647] flex items-center gap-1.5 active:scale-[0.97] transition-all">
            <CheckCircle className="h-3.5 w-3.5" /> Complete & Bill
          </button>
        )}
        <VoiceDictationButton sessionType="opd_consultation" patientId={token.patient_id} size="sm" />
        <ClinicalCalculatorPanel onInsertToNote={(text) => {
          window.dispatchEvent(new CustomEvent("insert-clinical-note", { detail: text }));
        }} />
        <div className="flex-1" />
        {hasActionAccess("opd", "admit_patient", permissions, role) && (
          <button onClick={() => {
            if (!token?.patient_id) { toast({ title: "Select a patient first", variant: "destructive" }); return; }
            setShowAdmitModal(true);
          }} className="text-xs text-slate-600 border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 flex items-center gap-1.5 active:scale-[0.97] transition-all">
            <Building2 className="h-3.5 w-3.5" /> Admit
          </button>
        )}
        {hasActionAccess("opd", "refer_physio", permissions, role) && (
          <button onClick={async () => {
            if (!token || !hospitalId || !userId) return;
            const { error } = await supabase.from("physio_referrals").insert({
              hospital_id: hospitalId,
              patient_id: token.patient_id,
              opd_encounter_id: encounterId || undefined,
              referred_by: userId,
              diagnosis: encounter.diagnosis || encounter.chief_complaint || "Physiotherapy referral",
              goals: [],
              urgency: "routine",
            } as any);
            if (error) { toast({ title: "Referral failed", description: error.message, variant: "destructive" }); return; }
            toast({ title: "↗ Referred to Physiotherapy" });
          }} className="text-xs text-teal-700 border border-teal-300 px-3 py-1.5 rounded-md hover:bg-teal-50 flex items-center gap-1.5 active:scale-[0.97] transition-all">
            <ArrowUpRight className="h-3.5 w-3.5" /> Refer Physio
          </button>
        )}
        {hasActionAccess("opd", "send_rx", permissions, role) && (
          <button onClick={handleSendWhatsApp} className="text-xs text-slate-600 border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 flex items-center gap-1.5 active:scale-[0.97] transition-all">
            <Smartphone className="h-3.5 w-3.5" /> Send Rx
          </button>
        )}
        {/* Language selector for bilingual prescription print */}
        {availablePrintLangs.length > 1 && (
          <select
            value={printLang}
            onChange={async (e) => {
              const lang = e.target.value;
              setPrintLang(lang);
              setTranslatedAdvice("");
              if (lang !== "English" && prescription.advice_notes?.trim()) {
                setTranslatingAdvice(true);
                try {
                  const translated = await translateText(prescription.advice_notes, lang, hospitalId ?? "", {
                    context: "patient_prescription_advice",
                    patientId: token?.patient_id ?? undefined,
                  });
                  setTranslatedAdvice(translated);
                } catch {
                  toast({ title: "Translation failed", variant: "destructive" });
                } finally {
                  setTranslatingAdvice(false);
                }
              }
            }}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 h-[30px] focus:outline-none focus:ring-1 focus:ring-slate-400"
            title="Print prescription advice in this language"
          >
            {availablePrintLangs.map((lang) => {
              const meta = ALL_PATIENT_LANGUAGES.find((l) => l.code === lang);
              return (
                <option key={lang} value={lang}>
                  {meta?.native !== meta?.label ? `${meta?.native} ${lang}` : lang}
                </option>
              );
            })}
          </select>
        )}
        <button
          onClick={handlePrintPrescription}
          disabled={translatingAdvice}
          className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-md hover:bg-slate-900 flex items-center gap-1.5 active:scale-[0.97] transition-all disabled:opacity-50"
        >
          <Printer className="h-3.5 w-3.5" />
          {translatingAdvice ? "Translating…" : printLang !== "English" && translatedAdvice ? `Print (EN + ${printLang})` : "Print Rx"}
        </button>
      </div>
      {showAdmitModal && token && hospitalId && (
        <AdmitPatientModal
          open={showAdmitModal}
          onClose={() => setShowAdmitModal(false)}
          hospitalId={hospitalId}
          preselectedPatientId={token.patient_id}
          preselectedPatientName={token.patient?.full_name || ""}
          onAdmitted={() => {
            setShowAdmitModal(false);
            toast({ title: "Patient admitted to IPD successfully" });
            onTokenUpdate();
          }}
        />
      )}
      {showReferralModal && token && hospitalId && (
        <ReferralLetterModal
          open={showReferralModal}
          onClose={() => setShowReferralModal(false)}
          hospitalId={hospitalId}
          patientName={token.patient?.full_name || ""}
          patientUhid={token.patient?.uhid || ""}
          chiefComplaint={encounter?.chief_complaint || ""}
          diagnosis={encounter?.soap_assessment || encounter?.chief_complaint || ""}
          doctorName={token.doctor?.full_name || ""}
          encounterId={encounterId || undefined}
        />
      )}
    </div>
  );
};

export default ConsultationWorkspace;
