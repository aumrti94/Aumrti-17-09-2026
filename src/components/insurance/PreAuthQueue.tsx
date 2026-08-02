import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { differenceInDays, differenceInHours, isPast, addDays } from "date-fns";
import { ClipboardList, Send, Sparkles, Loader2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Clock, MessageCircle, Search, Plus, X, Trash2, Bot, Download } from "lucide-react";
import { useInsuranceSubmission, type SubmissionMode } from "@/hooks/useInsuranceSubmission";
import PmjaySection from "./PmjaySection";
import PreAuthQualityGate, { type QualityGateInput } from "./PreAuthQualityGate";
import PolicyVerificationPanel, {
  type PlanTier,
  type PolicyVerificationData,
} from "./PolicyVerificationPanel";
import ICD10Search, { ProcedureCodeSearch } from "./ICD10Search";
import { ICD10_DATA, PROCEDURE_DATA } from "@/lib/icd10Data";
import DocumentChecklist from "./DocumentChecklist";
import { callAI } from "@/lib/aiProvider";
import { formatINR } from "@/lib/currency";
import PatientDocuments from "@/components/clinical/PatientDocuments";

interface PreAuth {
  id: string;
  patient_name: string;
  tpa_name: string;
  estimated_amount: number | null;
  status: string;
  created_at: string;
  admission_id: string;
  patient_id: string;
  policy_number: string | null;
  procedure_codes: string[];
  diagnosis_codes: string[];
  notes: string | null;
  valid_until: string | null;
  is_extension: boolean;
}

interface TPAConfig {
  id: string;
  tpa_name: string;
  tpa_code: string;
  required_documents: string[];
  room_rent_ceiling: number;
  co_payment_type: string;
  co_payment_value: number;
}

interface AdmissionContext {
  admission_id: string;
  patient_id: string;
  patient_name: string;
  insurance_type: string;
  admitted_at?: string;
  estimated_amount?: string;
  notes?: string;
}

interface Props {
  initialAdmission?: AdmissionContext | null;
  onAdmissionHandled?: () => void;
}

// Intimation window alert
const IntimationAlert: React.FC<{ admittedAt: string | null; isEmergency: boolean }> = ({ admittedAt, isEmergency }) => {
  if (!admittedAt) return null;
  const hours = differenceInHours(new Date(), new Date(admittedAt));
  const window = isEmergency ? 24 : 48;
  const remaining = window - hours;

  if (remaining < 0) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          <strong>⚠ {isEmergency ? "24-hour" : "48-hour"} intimation window has passed</strong> ({Math.abs(remaining)} hours overdue).
          Submit immediately to avoid claim rejection.
        </span>
      </div>
    );
  }
  if (remaining <= 6) {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
        <Clock size={16} className="mt-0.5 shrink-0" />
        <span>Only <strong>{remaining} hours</strong> remaining to submit intimation on time.</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">
      <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
      <span>Intimation can be submitted on time. <strong>{remaining} hours</strong> remaining.</span>
    </div>
  );
};

const PreAuthQueue: React.FC<Props> = ({ initialAdmission, onAdmissionHandled }) => {
  // Latest-ref: the parent passes a fresh `onAdmissionHandled` every render, and
  // the effect below must fire only when a new admission arrives.
  const onAdmissionHandledRef = useRef(onAdmissionHandled);
  useEffect(() => { onAdmissionHandledRef.current = onAdmissionHandled; });

  const [preAuths, setPreAuths] = useState<PreAuth[]>([]);
  const [selected, setSelected] = useState<PreAuth | null>(null);
  const [tpas, setTpas] = useState<TPAConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formState, setFormState] = useState<any>({});
  const [isNewForm, setIsNewForm] = useState(false);
  const [isExtensionForm, setIsExtensionForm] = useState(false);
  const [parentPreAuthId, setParentPreAuthId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreAuthLoading, setAiPreAuthLoading] = useState(false);
  const handledAdmissionRef = useRef<string | null>(null);
  const [approvalScore, setApprovalScore] = useState<{ score: number; risk: string; recommendation: string } | null>(null);
  const [suggestingCodes, setSuggestingCodes] = useState(false);
  const [unmatchedSuggestions, setUnmatchedSuggestions] = useState<{ icd: string[]; cpt: string[] } | null>(null);

  // Quality Gate modal state
  const [qualityGateOpen, setQualityGateOpen] = useState(false);

  // Intimation section state
  const [intimationOpen, setIntimationOpen] = useState(true);
  const [intimationSaved, setIntimationSaved] = useState(false);
  const [intimationType, setIntimationType] = useState<"emergency" | "planned">("planned");
  const [intimationTime, setIntimationTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [intimationMethod, setIntimationMethod] = useState("phone");

  // Accident/Trauma section state
  const [isAccidentCase, setIsAccidentCase] = useState(false);
  const [mlcNumber, setMlcNumber] = useState("");
  const [firNumber, setFirNumber] = useState("");

  // Admission date for intimation window calculation
  const [admittedAt, setAdmittedAt] = useState<string | null>(null);

  // Selected TPA config (for room rent ceiling)
  const [selectedTpaConfig, setSelectedTpaConfig] = useState<TPAConfig | null>(null);

  // Patient search for manual pre-auth
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<{ id: string; full_name: string; uhid: string; admission_id?: string; insurance_type?: string }[]>([]);
  const [patientSearching, setPatientSearching] = useState(false);

  // TPA Response recording
  const [tpaResponseOpen, setTpaResponseOpen] = useState(false);
  const [tpaRespDecision, setTpaRespDecision] = useState("approved");
  const [tpaRespAmount, setTpaRespAmount] = useState("");
  const [tpaRespRef, setTpaRespRef] = useState("");
  const [tpaRespValidUntil, setTpaRespValidUntil] = useState("");
  const [tpaRespDenialReason, setTpaRespDenialReason] = useState("");
  const [tpaRespSaving, setTpaRespSaving] = useState(false);

  // Hospital insurance plan tier (fetched from hospital_insurance_settings)
  const [planTier, setPlanTier] = useState<PlanTier>("manual");

  // Policy verification
  const [policyVerified, setPolicyVerified] = useState(false);
  const [policyData, setPolicyData] = useState<PolicyVerificationData | null>(null);

  // Document checklist readiness
  const [docsReady, setDocsReady] = useState(false);
  const [docsStats, setDocsStats] = useState({ ready: 0, required: 0 });

  // Auth user id for document upload
  const [userId, setUserId] = useState("");

  const { toast } = useToast();
  const { hospitalId } = useHospitalId();

  const submission = useInsuranceSubmission(hospitalId ?? "");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id) setUserId(data.user.id);
    });
  }, []);

  // Fetch hospital insurance plan tier once hospitalId is known
  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("hospital_insurance_settings")
      .select("plan_tier")
      .eq("hospital_id", hospitalId)
      .maybeSingle()
      .then(({ data }: { data: { plan_tier: string } | null }) => {
        if (data?.plan_tier) setPlanTier(data.plan_tier as PlanTier);
      });
  }, [hospitalId]);

  const recordTPAResponse = async () => {
    if (!selected) return;
    setTpaRespSaving(true);
    const payload: Record<string, any> = {
      status: tpaRespDecision,
      approved_at: new Date().toISOString(),
    };
    if (tpaRespDecision === "approved" || tpaRespDecision === "partially_approved") {
      payload.approved_amount = Number(tpaRespAmount) || 0;
      payload.pre_auth_number = tpaRespRef || null;
      payload.valid_until = tpaRespValidUntil ? new Date(tpaRespValidUntil).toISOString() : null;
    }
    if (tpaRespDecision === "rejected") {
      payload.denial_reason = tpaRespDenialReason || null;
    }
    const { error } = await (supabase as any).from("insurance_pre_auth").update(payload).eq("id", selected.id);
    setTpaRespSaving(false);
    if (!error) {
      toast({ title: `Pre-auth marked as ${tpaRespDecision.replace(/_/g, " ")} ✓` });
      setTpaResponseOpen(false);
      setSelected(null);
      loadData();
    } else {
      toast({ title: "Failed to save TPA response", variant: "destructive" });
    }
  };

  const searchPatients = async (q: string) => {
    if (q.trim().length < 2) { setPatientResults([]); return; }
    setPatientSearching(true);
    const { data: patients } = await supabase.from("patients")
      .select("id, full_name, uhid")
      .eq("is_active", true)
      .or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%`)
      .limit(10);
    const results = patients || [];
    if (results.length > 0) {
      const patientIds = results.map(p => p.id);
      const { data: admissions } = await (supabase as any).from("admissions")
        .select("id, patient_id, insurance_type, admitted_at, bed:beds(status)")
        .in("patient_id", patientIds)
        .eq("status", "active")
        .is("discharged_at", null)
        .order("admitted_at", { ascending: false });
      // Only count as "currently admitted" if the physical bed is still occupied.
      // Admissions where the bed is cleaning/available mean the patient has left
      // even if the discharge summary flow wasn't completed.
      const admMap = Object.fromEntries(
        (admissions || [])
          .filter((a: any) => (a.bed as any)?.status === "occupied")
          .map((a: any) => [a.patient_id, a])
      );
      setPatientResults(results.map(p => ({
        ...p,
        admission_id: admMap[p.id]?.id,
        insurance_type: admMap[p.id]?.insurance_type,
      })));
    } else {
      setPatientResults([]);
    }
    setPatientSearching(false);
  };

  const startManualPreAuth = (patient: { id: string; full_name: string; uhid: string; admission_id?: string; insurance_type?: string }) => {
    setSelected(null);
    setIsNewForm(true);
    setIsExtensionForm(false);
    setParentPreAuthId(null);
    setIntimationSaved(false);
    setIsAccidentCase(false);
    setMlcNumber("");
    setFirNumber("");
    setFormState({
      admission_id: patient.admission_id || "",
      patient_id: patient.id,
      patient_name: patient.full_name,
      tpa_name: patient.insurance_type && patient.insurance_type !== "self_pay" ? patient.insurance_type : "",
      policy_number: "",
      estimated_amount: "",
      diagnosis_codes: "",
      procedure_codes: "",
      notes: "",
    });
    if (patient.admission_id) {
      supabase.from("admissions").select("admitted_at").eq("id", patient.admission_id).maybeSingle()
        .then(({ data }) => { if (data) setAdmittedAt(data.admitted_at); });
    }
    setPatientSearchOpen(false);
    setPatientQuery("");
    setPatientResults([]);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [paRes, tpaRes] = await Promise.all([
        supabase.from("insurance_pre_auth")
          .select("*")
          .in("status", ["pending", "draft", "submitted", "under_review"])
          .order("created_at", { ascending: false }),
        supabase.from("tpa_config").select("id, tpa_name, tpa_code, required_documents, room_rent_ceiling, co_payment_type, co_payment_value").eq("is_active", true),
      ]);

      if (paRes.error) throw new Error(paRes.error.message);

      const preAuthData = paRes.data || [];
      if (preAuthData.length > 0) {
        const patientIds = [...new Set(preAuthData.map(p => p.patient_id))];
        const { data: patients } = await supabase.from("patients").select("id, full_name").in("id", patientIds);
        const pMap = Object.fromEntries((patients || []).map(p => [p.id, p.full_name]));
        setPreAuths(preAuthData.map(pa => ({
          ...pa,
          patient_name: pMap[pa.patient_id] || "Unknown",
          estimated_amount: pa.estimated_amount ? Number(pa.estimated_amount) : null,
          procedure_codes: pa.procedure_codes || [],
          diagnosis_codes: pa.diagnosis_codes || [],
          valid_until: (pa as any).valid_until || null,
          is_extension: (pa as any).is_extension ?? false,
        })));
      } else {
        setPreAuths([]);
      }
      setTpas((tpaRes.data || []).map(t => ({
        ...t,
        room_rent_ceiling: Number((t as any).room_rent_ceiling ?? 0),
        co_payment_type: (t as any).co_payment_type ?? "none",
        co_payment_value: Number((t as any).co_payment_value ?? 0),
      })));
    } catch (err: any) {
      console.error("PreAuthQueue load error:", err);
      setPreAuths([]);
      setTpas([]);
      setLoadError("Could not load pre-auth data. The form is still usable for new entries.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // When initialAdmission arrives, open a new unsaved form exactly once per distinct admission
  useEffect(() => {
    const aid = initialAdmission?.admission_id ?? null;
    if (!aid || handledAdmissionRef.current === aid) return;
    handledAdmissionRef.current = aid;
    setSelected(null);
    setIsNewForm(true);
    setIsExtensionForm(false);
    setParentPreAuthId(null);
    setIntimationSaved(false);
    setIsAccidentCase(false);
    setMlcNumber("");
    setFirNumber("");
    setFormState({
      admission_id:     initialAdmission.admission_id,
      patient_id:       initialAdmission.patient_id,
      patient_name:     initialAdmission.patient_name,
      tpa_name:         initialAdmission.insurance_type === "self_pay" ? "" : (initialAdmission.insurance_type || ""),
      policy_number:    "",
      estimated_amount: initialAdmission.estimated_amount ?? "",
      diagnosis_codes:  "",
      procedure_codes:  "",
      notes:            initialAdmission.notes ?? "",
    });
    // Fetch admitted_at for intimation window
    if (initialAdmission.admitted_at) {
      setAdmittedAt(initialAdmission.admitted_at);
    } else if (initialAdmission.admission_id) {
      supabase.from("admissions").select("admitted_at").eq("id", initialAdmission.admission_id).maybeSingle()
        .then(({ data }) => { if (data) setAdmittedAt(data.admitted_at); });
    }
    onAdmissionHandledRef.current?.();
  }, [initialAdmission]); // only re-runs when the incoming admission object changes

  // Update selectedTpaConfig when TPA selection changes
  useEffect(() => {
    const found = tpas.find(t => t.tpa_name === formState.tpa_name) || null;
    setSelectedTpaConfig(found);
  }, [formState.tpa_name, tpas]);

  const selectPreAuth = (pa: PreAuth) => {
    setIsNewForm(false);
    setIsExtensionForm(false);
    setParentPreAuthId(null);
    setSelected(pa);
    setIntimationSaved(false);
    setPolicyVerified(false);
    setPolicyData(null);
    setDocsReady(false);
    setDocsStats({ ready: 0, required: 0 });
    setIsAccidentCase((pa as any).is_accident_case ?? false);
    setMlcNumber((pa as any).mlc_number ?? "");
    setFirNumber((pa as any).fir_number ?? "");
    setFormState({
      tpa_name: pa.tpa_name,
      policy_number: pa.policy_number || "",
      estimated_amount: pa.estimated_amount || "",
      diagnosis_codes: (pa.diagnosis_codes || []).join(", "),
      procedure_codes: (pa.procedure_codes || []).join(", "),
      notes: pa.notes || "",
    });
  };

  const generatePreAuthWithAI = async () => {
    if (!selected || !hospitalId) return;
    setAiPreAuthLoading(true);
    try {
      const { error } = await supabase.functions.invoke("insurance-automation", {
        body: {
          action: "ai_generate_preauth",
          pre_auth_id: selected.id,
          admission_id: selected.admission_id,
          hospital_id: hospitalId,
          patient_id: selected.patient_id,
        },
      });
      if (error) throw error;
      await loadData();
      const { data: updated } = await (supabase as any)
        .from("insurance_pre_auth").select("*").eq("id", selected.id).maybeSingle();
      if (updated) {
        const pa: PreAuth = {
          ...selected,
          diagnosis_codes: updated.diagnosis_codes || [],
          procedure_codes: updated.procedure_codes || [],
          estimated_amount: updated.estimated_amount ? Number(updated.estimated_amount) : null,
          notes: updated.notes || null,
        };
        setSelected(pa);
        setFormState((prev: any) => ({
          ...prev,
          diagnosis_codes: (updated.diagnosis_codes || []).join(", "),
          procedure_codes: (updated.procedure_codes || []).join(", "),
          estimated_amount: updated.estimated_amount ? Number(updated.estimated_amount) : "",
          notes: updated.notes || "",
        }));
      }
      toast({ title: "AI pre-auth fields generated", description: "Review the populated fields and submit when ready." });
    } catch (e: any) {
      toast({ title: "AI generation failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setAiPreAuthLoading(false);
    }
  };

  const openExtensionForm = (pa: PreAuth) => {
    setSelected(null);
    setIsNewForm(true);
    setIsExtensionForm(true);
    setParentPreAuthId(pa.id);
    setIntimationSaved(false);
    setIsAccidentCase((pa as any).is_accident_case ?? false);
    setMlcNumber((pa as any).mlc_number ?? "");
    setFirNumber((pa as any).fir_number ?? "");
    setFormState({
      admission_id: pa.admission_id,
      patient_id: pa.patient_id,
      patient_name: pa.patient_name,
      tpa_name: pa.tpa_name,
      policy_number: pa.policy_number || "",
      estimated_amount: pa.estimated_amount || "",
      diagnosis_codes: (pa.diagnosis_codes || []).join(", "),
      procedure_codes: (pa.procedure_codes || []).join(", "),
      notes: "",
      extension_reason: "",
    });
  };

  const markIntimation = async () => {
    if (!formState.admission_id && !selected?.admission_id) return;
    const admId = formState.admission_id || selected?.admission_id;
    if (!hospitalId) return;
    await (supabase as any).from("insurance_pre_auth").update({
      intimation_sent_at: new Date(intimationTime).toISOString(),
      intimation_method: intimationMethod,
      is_emergency_admission: intimationType === "emergency",
    }).eq("admission_id", admId).eq("hospital_id", hospitalId);
    setIntimationSaved(true);
    setIntimationOpen(false);
    toast({ title: "Intimation recorded ✓" });
  };

  const buildPayload = (status: string) => ({
    hospital_id: hospitalId,
    admission_id: formState.admission_id || null,
    patient_id: formState.patient_id,
    tpa_name: formState.tpa_name || "Unknown",
    policy_number: formState.policy_number || null,
    estimated_amount: Number(formState.estimated_amount) || 0,
    diagnosis_codes: formState.diagnosis_codes?.split(",").map((s: string) => s.trim()).filter(Boolean) || [],
    procedure_codes: formState.procedure_codes?.split(",").map((s: string) => s.trim()).filter(Boolean) || [],
    notes: formState.notes || null,
    status,
    submitted_at: status === "submitted" ? new Date().toISOString() : null,
    is_accident_case: isAccidentCase,
    mlc_number: isAccidentCase ? (mlcNumber || null) : null,
    fir_number: isAccidentCase ? (firNumber || null) : null,
    is_extension: isExtensionForm,
    parent_pre_auth_id: isExtensionForm ? parentPreAuthId : null,
    extension_reason: isExtensionForm ? (formState.extension_reason || null) : null,
    document_checklist: policyData ? policyData.checklist : null,
  });

  const handleCreateAndSubmit = async (status: string, submission_mode?: string): Promise<string | null> => {
    if (!formState.patient_id) {
      toast({ title: "No patient selected", variant: "destructive" });
      return null;
    }
    if (!hospitalId) {
      toast({ title: "Could not determine hospital", variant: "destructive" });
      return null;
    }
    const payload = { ...buildPayload(status), ...(submission_mode ? { submission_mode } : {}) };
    const { data, error } = await (supabase as any)
      .from("insurance_pre_auth")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (!error) {
      if (status === "submitted") {
        toast({ title: isExtensionForm ? "Extension submitted ✓" : "Pre-auth submitted ✓" });
      } else if (status !== "pending") {
        toast({ title: "Draft saved" });
      }
      setIsNewForm(false);
      setIsExtensionForm(false);
      setFormState({});
      loadData();
      return data?.id ?? null;
    } else {
      toast({ title: "Error creating pre-auth", description: error.message, variant: "destructive" });
      return null;
    }
  };

  const handleSubmit = async () => {
    if (isNewForm) return handleCreateAndSubmit("submitted");
    if (!selected) return;
    const { error } = await (supabase as any).from("insurance_pre_auth").update({
      tpa_name: formState.tpa_name,
      policy_number: formState.policy_number,
      estimated_amount: Number(formState.estimated_amount) || 0,
      diagnosis_codes: formState.diagnosis_codes?.split(",").map((s: string) => s.trim()).filter(Boolean) || [],
      procedure_codes: formState.procedure_codes?.split(",").map((s: string) => s.trim()).filter(Boolean) || [],
      notes: formState.notes,
      is_accident_case: isAccidentCase,
      mlc_number: isAccidentCase ? (mlcNumber || null) : null,
      fir_number: isAccidentCase ? (firNumber || null) : null,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    }).eq("id", selected.id);
    if (!error) {
      toast({ title: "Pre-auth submitted ✓" });
      loadData();
      setSelected(null);
    } else {
      toast({ title: "Error submitting pre-auth", variant: "destructive" });
    }
  };

  const handleSaveDraft = async () => {
    if (isNewForm) return handleCreateAndSubmit("draft");
    if (!selected) return;
    await (supabase as any).from("insurance_pre_auth").update({
      tpa_name: formState.tpa_name,
      policy_number: formState.policy_number,
      estimated_amount: Number(formState.estimated_amount) || 0,
      diagnosis_codes: formState.diagnosis_codes?.split(",").map((s: string) => s.trim()).filter(Boolean) || [],
      procedure_codes: formState.procedure_codes?.split(",").map((s: string) => s.trim()).filter(Boolean) || [],
      notes: formState.notes,
      is_accident_case: isAccidentCase,
      mlc_number: isAccidentCase ? (mlcNumber || null) : null,
      fir_number: isAccidentCase ? (firNumber || null) : null,
      status: "draft",
    }).eq("id", selected.id);
    toast({ title: "Draft saved" });
    loadData();
  };

  const statusColor = (s: string) => {
    const m: Record<string, string> = {
      pending: "bg-amber-50 text-amber-700",
      draft: "bg-muted text-muted-foreground",
      submitted: "bg-blue-50 text-blue-700",
      under_review: "bg-purple-50 text-purple-700",
    };
    return m[s] || "";
  };

  const showForm = isNewForm || selected;
  const formTitle = isExtensionForm
    ? `Extension Pre-Auth Request — ${formState.patient_name}`
    : isNewForm ? `New Pre-Auth — ${formState.patient_name}`
    : `Pre-Auth — ${selected?.patient_name}`;

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: list */}
      <div className="w-[300px] border-r border-border bg-background flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold">Pre-Auth Queue</h3>
              <p className="text-xs text-muted-foreground">{preAuths.length} pending</p>
            </div>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setPatientSearchOpen(v => !v)}>
              <Plus size={12} /> New Pre-Auth
            </Button>
          </div>

          {/* Patient search panel */}
          {patientSearchOpen && (
            <div className="space-y-1.5">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  className="w-full h-8 pl-7 pr-3 rounded-md border border-input bg-background text-sm"
                  placeholder="Search by name or UHID…"
                  value={patientQuery}
                  onChange={e => { setPatientQuery(e.target.value); searchPatients(e.target.value); }}
                />
              </div>
              {patientSearching && <p className="text-[11px] text-muted-foreground px-1">Searching…</p>}
              {patientResults.map(p => (
                <button
                  key={p.id}
                  onClick={() => startManualPreAuth(p)}
                  className="w-full text-left px-2.5 py-2 rounded-md hover:bg-muted/70 border border-border transition-colors"
                >
                  <div className="text-[13px] font-medium">{p.full_name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{p.uhid}
                    {p.admission_id
                      ? <span className="ml-2 text-emerald-600">● Admitted</span>
                      : <span className="ml-2 text-amber-600">○ Not yet admitted</span>
                    }
                  </div>
                </button>
              ))}
              {patientQuery.length >= 2 && !patientSearching && patientResults.length === 0 && (
                <p className="text-[11px] text-muted-foreground px-1">No patients found</p>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {loadError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 mx-1 mt-1">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{loadError}</span>
            </div>
          )}
          {preAuths.length === 0 && !isNewForm && !loadError ? (
            <div className="text-center text-muted-foreground text-sm py-12">
              <ClipboardList size={32} className="mx-auto mb-2 opacity-40" />
              No pending pre-authorisations
            </div>
          ) : preAuths.map(pa => {
            const expiry = pa.valid_until ? new Date(pa.valid_until) : null;
            const isExpiring = expiry && pa.status === "approved" && !isPast(expiry) && differenceInDays(expiry, new Date()) <= 7;
            const isExpired = expiry && pa.status === "approved" && isPast(expiry);
            return (
              <div
                key={pa.id}
                className={cn(
                  "w-full text-left p-3 rounded-lg border transition-colors cursor-pointer group relative",
                  selected?.id === pa.id && !isNewForm ? "bg-primary/5 border-primary" : "border-border hover:bg-muted/50"
                )}
                onClick={() => selectPreAuth(pa)}
              >
                <div className="flex justify-between items-start gap-1">
                  <span className="text-sm font-medium">{pa.patient_name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant="outline" className={cn("text-xs capitalize", statusColor(pa.status))}>{pa.status}</Badge>
                    {pa.status === "draft" && (
                      <button
                        onClick={async e => {
                          e.stopPropagation();
                          if (!confirm(`Delete draft pre-auth for ${pa.patient_name}?`)) return;
                          await (supabase as any).from("insurance_pre_auth").delete().eq("id", pa.id).eq("status", "draft");
                          toast({ title: "Draft deleted" });
                          if (selected?.id === pa.id) { setSelected(null); setIsNewForm(false); }
                          loadData();
                        }}
                        className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete draft"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{pa.tpa_name}</div>
                {pa.estimated_amount && <div className="text-xs font-medium mt-0.5">{formatINR(pa.estimated_amount)}</div>}
                <div className="text-xs text-muted-foreground mt-0.5">
                  {differenceInDays(new Date(), new Date(pa.created_at))}d ago
                </div>
                {(isExpiring || isExpired) && (
                  <div className="mt-2 space-y-1">
                    <Badge className={cn("text-xs", isExpired ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
                      {isExpired ? "Auth Expired" : "Expiring Soon"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-6 text-xs border-amber-400 text-amber-700"
                      onClick={e => { e.stopPropagation(); openExtensionForm(pa); }}
                    >
                      Request Extension
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-y-auto p-5">
        {!showForm ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <ClipboardList size={40} className="opacity-30 mb-2" />
            <p className="text-sm">Select a pre-auth request or use "Request Pre-Auth" from Active Admissions</p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-4">
            <h3 className="text-base font-bold">{formTitle}</h3>

            {/* ── AI GENERATE PRE-AUTH — existing records with an admission only ── */}
            {selected && (selected.status === "pending" || selected.status === "draft") && selected.admission_id && (
              <div className="border border-violet-200 rounded-lg p-3 bg-violet-50/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-violet-800 flex items-center gap-1.5">
                      <Sparkles size={14} /> Generate with AI
                    </p>
                    <p className="text-xs text-violet-600 mt-0.5">
                      Auto-fill ICD codes, procedure codes and estimated amount from admission data.
                      Overwrites current values — review before submitting.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-xs gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-100"
                    disabled={aiPreAuthLoading}
                    onClick={generatePreAuthWithAI}
                  >
                    {aiPreAuthLoading
                      ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
                      : <><Sparkles size={12} /> Generate with AI</>}
                  </Button>
                </div>
                {aiPreAuthLoading && (
                  <p className="text-xs text-violet-500 mt-2 animate-pulse">
                    Analysing admission diagnosis, fetching ICD codes and estimating amount…
                  </p>
                )}
              </div>
            )}
            {isNewForm && formState.admission_id && (
              <p className="text-xs text-muted-foreground">
                Save as Draft first to enable AI pre-auth generation.
              </p>
            )}

            {/* ── TPA RESPONSE (submitted / under_review pre-auths only) ── */}
            {selected && (selected.status === "submitted" || selected.status === "under_review") && (
              <div className="border border-blue-200 rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-sm font-semibold text-blue-800"
                  onClick={() => setTpaResponseOpen(v => !v)}
                >
                  <span className="flex items-center gap-2">
                    <MessageCircle size={14} />
                    Record TPA Response / Decision
                  </span>
                  {tpaResponseOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {tpaResponseOpen && (
                  <div className="p-4 space-y-3 bg-blue-50/30">
                    <div>
                      <Label className="text-sm font-semibold">TPA Decision</Label>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {([
                          { value: "approved", label: "Approved", cls: "bg-emerald-600 text-white border-emerald-600" },
                          { value: "partially_approved", label: "Partially Approved", cls: "bg-amber-500 text-white border-amber-500" },
                          { value: "under_review", label: "Still Under Review", cls: "bg-purple-600 text-white border-purple-600" },
                          { value: "rejected", label: "Rejected", cls: "bg-red-600 text-white border-red-600" },
                        ] as const).map(d => (
                          <button
                            key={d.value}
                            onClick={() => setTpaRespDecision(d.value)}
                            className={cn(
                              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                              tpaRespDecision === d.value ? d.cls : "bg-background border-border text-muted-foreground hover:bg-muted"
                            )}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(tpaRespDecision === "approved" || tpaRespDecision === "partially_approved") && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-sm font-semibold">Approved Amount (₹)</Label>
                          <input type="number" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-3 text-sm" value={tpaRespAmount} onChange={e => setTpaRespAmount(e.target.value)} placeholder="0" />
                        </div>
                        <div>
                          <Label className="text-sm font-semibold">TPA Reference No.</Label>
                          <input type="text" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-3 text-sm" value={tpaRespRef} onChange={e => setTpaRespRef(e.target.value)} placeholder="PA/2026/XXXXX" />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-sm font-semibold">Valid Until Date</Label>
                          <input type="date" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-3 text-sm" value={tpaRespValidUntil} onChange={e => setTpaRespValidUntil(e.target.value)} />
                        </div>
                      </div>
                    )}
                    {tpaRespDecision === "rejected" && (
                      <div>
                        <Label className="text-sm font-semibold">Rejection Reason</Label>
                        <input type="text" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-3 text-sm" value={tpaRespDenialReason} onChange={e => setTpaRespDenialReason(e.target.value)} placeholder="Reason given by TPA" />
                      </div>
                    )}
                    <Button size="sm" onClick={recordTPAResponse} disabled={tpaRespSaving} className="gap-1.5">
                      {tpaRespSaving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Save TPA Response
                    </Button>
                  </div>
                )}
              </div>
            )}

            {isExtensionForm && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                <strong>Extension Request:</strong> This will create a new pre-auth linked to the original approval.
                Fill in the extension reason and updated clinical details.
              </div>
            )}

            {/* ── SECTION A: Intimation ─────────────────────────────── */}
            {(isNewForm || selected) && (
              <div className="border border-border rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/50 hover:bg-muted/80 text-sm font-semibold"
                  onClick={() => setIntimationOpen(v => !v)}
                >
                  <span className="flex items-center gap-2">
                    {intimationSaved
                      ? <CheckCircle2 size={14} className="text-emerald-600" />
                      : <Clock size={14} className="text-amber-600" />
                    }
                    Step 1 — Intimation to TPA / Insurer
                  </span>
                  {intimationOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {intimationOpen && (
                  <div className="p-4 space-y-3">
                    {intimationSaved ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-700">
                        <CheckCircle2 size={14} />
                        Intimated on {new Date(intimationTime).toLocaleDateString("en-IN")} at {new Date(intimationTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} via {intimationMethod}
                      </div>
                    ) : (
                      <>
                        <div>
                          <Label className="text-sm font-medium">Admission Type</Label>
                          <div className="flex gap-6 mt-1.5">
                            {(["emergency", "planned"] as const).map(t => (
                              <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="radio" checked={intimationType === t} onChange={() => setIntimationType(t)} />
                                {t === "emergency" ? "Emergency (notify within 24h)" : "Planned (notify within 48h)"}
                              </label>
                            ))}
                          </div>
                        </div>

                        <IntimationAlert admittedAt={admittedAt} isEmergency={intimationType === "emergency"} />

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-sm font-medium">Date &amp; Time of Intimation</Label>
                            <input
                              type="datetime-local"
                              className="mt-1 w-full text-sm border border-input rounded-md px-3 py-1.5 bg-background"
                              value={intimationTime}
                              onChange={e => setIntimationTime(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Method</Label>
                            <Select value={intimationMethod} onValueChange={setIntimationMethod}>
                              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="phone">Phone Call</SelectItem>
                                <SelectItem value="email">Email</SelectItem>
                                <SelectItem value="portal">TPA Portal</SelectItem>
                                <SelectItem value="walk-in">Walk-in</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={markIntimation}>
                          Mark Intimation Done
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── MAIN FORM FIELDS ─────────────────────────────────── */}
            <div className="space-y-4">
              {/* ── POLICY VERIFICATION ─────────────────────────────── */}
              <PolicyVerificationPanel
                planTier={planTier}
                hospitalId={hospitalId || ""}
                tpaName={formState.tpa_name || ""}
                tpaCode={selectedTpaConfig?.tpa_code || ""}
                patientName={formState.patient_name || selected?.patient_name || ""}
                initialPolicyNumber={formState.policy_number || ""}
                onVerified={(data) => {
                  setPolicyVerified(true);
                  setPolicyData(data);
                }}
                onUnverified={() => {
                  setPolicyVerified(false);
                  setPolicyData(null);
                }}
              />

              {isExtensionForm && (
                <div>
                  <Label className="text-sm font-semibold">Extension Reason *</Label>
                  <Textarea
                    className="mt-1" rows={2} placeholder="Reason for requesting extension (e.g., extended recovery, additional procedures required)"
                    value={formState.extension_reason || ""}
                    onChange={e => setFormState({ ...formState, extension_reason: e.target.value })}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-semibold">TPA / Insurer</Label>
                  {tpas.length === 0 ? (
                    <div className="mt-1 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>
                        No TPAs configured —{" "}
                        <span className="font-medium underline underline-offset-2 cursor-default">
                          add insurers in TPA Configuration
                        </span>{" "}
                        first.
                      </span>
                    </div>
                  ) : (
                    <Select value={formState.tpa_name} onValueChange={v => setFormState({ ...formState, tpa_name: v })}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {tpas.map(t => <SelectItem key={t.id} value={t.tpa_name}>{t.tpa_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-semibold">Policy Number</Label>
                  <Input className="mt-1" value={formState.policy_number} onChange={e => setFormState({ ...formState, policy_number: e.target.value })} />
                </div>
              </div>

              {/* ── SECTION B: Room Rent Check ─────────────────────── */}
              {selectedTpaConfig && selectedTpaConfig.room_rent_ceiling > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-700">
                  <strong>Room Rent Limit:</strong> This TPA allows up to {formatINR(selectedTpaConfig.room_rent_ceiling)}/day.
                  Ensure the patient is admitted to a room within this limit to avoid out-of-pocket expenses.
                </div>
              )}

              <div className="space-y-2">
                {planTier !== "manual" && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 gap-1.5 text-violet-600 border-violet-200 hover:bg-violet-50"
                      disabled={suggestingCodes || (!formState.notes && !formState.procedure_codes)}
                      onClick={async () => {
                        setSuggestingCodes(true);
                        setUnmatchedSuggestions(null);
                        try {
                          const context = [
                            formState.notes && `Clinical notes: ${formState.notes}`,
                            formState.procedure_codes && `Procedure context: ${formState.procedure_codes}`,
                            formState.tpa_name && `TPA: ${formState.tpa_name}`,
                          ].filter(Boolean).join("\n");
                          const prompt = `You are a medical coding assistant in an Indian hospital. Based on the following clinical context, suggest the most appropriate ICD-10 diagnosis codes and CPT procedure codes for an insurance pre-authorisation.

${context}

Respond ONLY with valid JSON in this exact format, no explanation:
{"icd10": ["CODE1", "CODE2"], "cpt": ["CODE1", "CODE2"]}

Suggest up to 4 ICD-10 codes and up to 3 CPT codes. Only suggest codes you are clinically confident about.`;
                          const result = await callAI({ featureKey: "pre_auth_ai_fill", hospitalId: hospitalId || "", prompt, maxTokens: 300 });
                          if (result.error || !result.text) {
                            toast({ title: "Code suggestion failed", description: result.error || "Empty response", variant: "destructive" });
                            return;
                          }
                          const jsonMatch = result.text.match(/\{[\s\S]*?\}/);
                          if (!jsonMatch) throw new Error("Could not parse AI response");
                          const parsed = JSON.parse(jsonMatch[0]);
                          const suggestedIcd: string[] = Array.isArray(parsed.icd10) ? parsed.icd10.map((c: string) => c.trim().toUpperCase()) : [];
                          const suggestedCpt: string[] = Array.isArray(parsed.cpt) ? parsed.cpt.map((c: string) => c.trim()) : [];

                          const icdSet = new Set(ICD10_DATA.map(e => e.code.toUpperCase()));
                          const cptSet = new Set(PROCEDURE_DATA.map(e => e.code));

                          const matchedIcd = suggestedIcd.filter(c => icdSet.has(c));
                          const matchedCpt = suggestedCpt.filter(c => cptSet.has(c));
                          const unmatchedIcd = suggestedIcd.filter(c => !icdSet.has(c));
                          const unmatchedCpt = suggestedCpt.filter(c => !cptSet.has(c));

                          setFormState((prev: any) => {
                            const prevIcd = prev.diagnosis_codes ? prev.diagnosis_codes.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
                            const prevCpt = prev.procedure_codes ? prev.procedure_codes.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
                            return {
                              ...prev,
                              diagnosis_codes: [...new Set([...prevIcd, ...matchedIcd])].join(", "),
                              procedure_codes: [...new Set([...prevCpt, ...matchedCpt])].join(", "),
                            };
                          });
                          if (unmatchedIcd.length > 0 || unmatchedCpt.length > 0) {
                            setUnmatchedSuggestions({ icd: unmatchedIcd, cpt: unmatchedCpt });
                          }
                          toast({ title: `AI suggested ${matchedIcd.length + matchedCpt.length} code(s) — review before submitting` });
                        } catch {
                          toast({ title: "Code suggestion failed", description: "Could not parse AI response", variant: "destructive" });
                        } finally {
                          setSuggestingCodes(false);
                        }
                      }}
                    >
                      {suggestingCodes ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      Suggest codes (AI)
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-semibold">Diagnosis / ICD-10 Codes</Label>
                    <ICD10Search
                      className="mt-1"
                      value={formState.diagnosis_codes ? formState.diagnosis_codes.split(",").map((s: string) => s.trim()).filter(Boolean) : []}
                      onChange={(codes) => setFormState({ ...formState, diagnosis_codes: codes.join(", ") })}
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-semibold">Procedure Codes (CPT)</Label>
                    <ProcedureCodeSearch
                      className="mt-1"
                      value={formState.procedure_codes ? formState.procedure_codes.split(",").map((s: string) => s.trim()).filter(Boolean) : []}
                      onChange={(codes) => setFormState({ ...formState, procedure_codes: codes.join(", ") })}
                    />
                  </div>
                </div>
                {unmatchedSuggestions && (unmatchedSuggestions.icd.length > 0 || unmatchedSuggestions.cpt.length > 0) && (
                  <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <strong>AI also suggested (not in local codelist — verify manually):</strong>
                      {unmatchedSuggestions.icd.length > 0 && <div className="mt-0.5">ICD-10: {unmatchedSuggestions.icd.join(", ")}</div>}
                      {unmatchedSuggestions.cpt.length > 0 && <div className="mt-0.5">CPT: {unmatchedSuggestions.cpt.join(", ")}</div>}
                    </div>
                    <button type="button" onClick={() => setUnmatchedSuggestions(null)} className="hover:text-amber-900">
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <Label className="text-sm font-semibold">Estimated Amount (₹)</Label>
                <Input className="mt-1 w-48" type="number" value={formState.estimated_amount} onChange={e => setFormState({ ...formState, estimated_amount: e.target.value })} />
              </div>

              {selectedTpaConfig?.required_documents?.length ? (
                <div>
                  <Label className="text-sm font-semibold mb-2 block">Required Documents ({selectedTpaConfig.tpa_name})</Label>
                  <div className="space-y-2">
                    {selectedTpaConfig.required_documents.map((doc, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="rounded" />
                        {doc}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-sm font-semibold">Clinical Notes / Justification</Label>
                  <Button
                    variant="outline" size="sm" className="text-xs h-7 gap-1.5 text-violet-600 border-violet-200 hover:bg-violet-50"
                    disabled={aiLoading}
                    onClick={async () => {
                      setAiLoading(true);
                      try {
                        const prompt = `Generate a concise clinical summary for an insurance pre-authorisation request.
Patient procedure codes: ${formState.procedure_codes || "Not specified"}
Diagnosis codes: ${formState.diagnosis_codes || "Not specified"}
Estimated amount: ₹${formState.estimated_amount || "Not specified"}
TPA: ${formState.tpa_name || "Not specified"}

Write a 3-4 paragraph medical necessity justification suitable for Indian private insurance pre-auth. Include clinical indication, proposed treatment plan, and expected outcomes.`;
                        const result = await callAI({ featureKey: "pre_auth_summary", hospitalId: hospitalId || "", prompt, maxTokens: 600 });
                        if (result.error || !result.text) {
                          toast({ title: "AI generation failed", description: result.error || "Empty response", variant: "destructive" });
                        } else {
                          setFormState((prev: any) => ({ ...prev, notes: result.text }));
                          toast({ title: "Clinical summary generated" });
                        }
                      } catch {
                        toast({ title: "AI generation failed", variant: "destructive" });
                      }
                      setAiLoading(false);
                    }}
                  >
                    {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    Generate Summary
                  </Button>
                </div>
                <Textarea className="mt-1" rows={4} value={formState.notes} onChange={e => setFormState({ ...formState, notes: e.target.value })} />
              </div>

              {/* ── SECTION C: Accident / Trauma ─────────────────────── */}
              <div className="border border-border rounded-lg p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={isAccidentCase}
                    onChange={e => setIsAccidentCase(e.target.checked)}
                  />
                  Accident / Trauma Case?
                </label>

                {isAccidentCase && (
                  <div className="space-y-3 pl-5">
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded p-2 text-sm text-amber-700">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      FIR / MLC copy is mandatory for accident-related insurance claims. Claims will be rejected without it.
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm font-medium">Medico-Legal Case (MLC) Number</Label>
                        <Input className="mt-1" placeholder="MLC-2024-XXXX" value={mlcNumber} onChange={e => setMlcNumber(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">FIR Number (if applicable)</Label>
                        <Input className="mt-1" placeholder="FIR No." value={firNumber} onChange={e => setFirNumber(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* AI Approval Score */}
              {(formState.tpa_name && formState.estimated_amount && formState.procedure_codes) && (
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline" size="sm" className="text-xs h-7 gap-1.5"
                    disabled={aiLoading}
                    onClick={async () => {
                      setAiLoading(true);
                      try {
                        const prompt = `Based on this pre-auth for procedures: ${formState.procedure_codes} with ${formState.tpa_name} (private Indian insurer), diagnosis: ${formState.diagnosis_codes || "not specified"}, claimed amount ₹${formState.estimated_amount}, documents attached: ${selectedTpaConfig?.required_documents?.length || 0}, estimate approval probability 0-100 for Indian private insurance. Return ONLY valid JSON: {"score": number, "risk": "low|medium|high", "recommendation": "one line advice"}`;
                        const result = await callAI({ featureKey: "approval_predictor", hospitalId: hospitalId || "", prompt, maxTokens: 200 });
                        if (result.error || !result.text) {
                          toast({ title: "Approval prediction failed", description: result.error || "Empty response", variant: "destructive" });
                        } else {
                          const parsed = JSON.parse(result.text.replace(/```json\n?|\n?```/g, "").trim());
                          setApprovalScore(parsed);
                        }
                      } catch {
                        toast({ title: "Approval prediction failed", description: "Could not parse AI response", variant: "destructive" });
                      }
                      setAiLoading(false);
                    }}
                  >
                    <Sparkles size={12} /> Predict Approval
                  </Button>
                  {approvalScore && (
                    <div className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium",
                      approvalScore.score >= 75 ? "bg-emerald-50 text-emerald-700" :
                      approvalScore.score >= 50 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"
                    )}>
                      <span className="font-bold">{approvalScore.score}%</span> approval · {approvalScore.risk} risk
                    </div>
                  )}
                </div>
              )}
              {approvalScore?.recommendation && (
                <p className="text-xs text-muted-foreground italic">💡 {approvalScore.recommendation}</p>
              )}

              {formState.tpa_name?.toLowerCase().includes("pmjay") && (
                <PmjaySection onPackageSelect={(rate) => setFormState({ ...formState, estimated_amount: rate })} />
              )}

              {/* ── DOCUMENT CHECKLIST ────────────────────────────── */}
              {(formState.admission_id || selected?.admission_id) && hospitalId && (
                <DocumentChecklist
                  preAuthId={selected?.id || ""}
                  tpaName={formState.tpa_name || selected?.tpa_name || ""}
                  admissionId={formState.admission_id || selected?.admission_id || ""}
                  hospitalId={hospitalId}
                  planTier={planTier}
                  policyNumber={formState.policy_number || selected?.policy_number || ""}
                  insurerName={formState.tpa_name || selected?.tpa_name || ""}
                  patientName={formState.patient_name || selected?.patient_name || ""}
                  onReadinessChange={(ready, stats) => {
                    setDocsReady(ready);
                    setDocsStats(stats);
                  }}
                />
              )}

              {/* ── PATIENT DOCUMENTS (general) ───────────────────── */}
              {(formState.patient_id || selected?.patient_id) && hospitalId && (
                <div className="border border-border rounded-lg p-3">
                  <PatientDocuments
                    patientId={formState.patient_id || selected?.patient_id || ""}
                    hospitalId={hospitalId}
                    userId={userId}
                  />
                </div>
              )}

              {/* ── SUBMISSION AREA ─────────────────────────────── */}
              <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/20">
                {/* Gates */}
                {(!policyVerified || !docsReady) && (
                  <div className="space-y-1">
                    {!policyVerified && (
                      <p className="text-xs text-amber-600 flex items-center gap-1">⚠ Policy must be verified before submitting.</p>
                    )}
                    {policyVerified && !docsReady && (
                      <p className="text-xs text-amber-600 flex items-center gap-1">⚠ Complete document checklist — {docsStats.ready}/{docsStats.required} required docs ready.</p>
                    )}
                  </div>
                )}

                {/* Progress indicator */}
                {submission.submitting && (
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <Loader2 size={14} className="animate-spin" />
                    {submission.progress || "Submitting…"}
                  </div>
                )}

                {/* Result badge */}
                {submission.result && (
                  <div className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                    submission.result.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  )}>
                    {submission.result.success ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    <span>{submission.result.message}</span>
                    {submission.result.submissionMode && (
                      <Badge variant="outline" className="text-xs ml-auto">
                        {submission.result.submissionMode === "manual" ? "Manual"
                          : submission.result.submissionMode === "ai_assisted" ? "AI Assisted"
                          : "Auto-Submitted"}
                      </Badge>
                    )}
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  {/* Plan-specific submit button */}
                  {planTier === "manual" && (
                    <Button
                      onClick={() => setQualityGateOpen(true)}
                      className="gap-1.5"
                      disabled={!policyVerified || !docsReady || submission.submitting}
                    >
                      <Send size={14} />
                      {isExtensionForm ? "Submit Extension" : "✓ Mark as Submitted Manually"}
                    </Button>
                  )}
                  {planTier === "ai_assisted" && (
                    <Button
                      onClick={() => setQualityGateOpen(true)}
                      className="gap-1.5 bg-violet-600 hover:bg-violet-700"
                      disabled={!policyVerified || !docsReady || submission.submitting}
                    >
                      <Sparkles size={14} />
                      📄 Generate &amp; Submit
                    </Button>
                  )}
                  {planTier === "automated" && (
                    <Button
                      onClick={() => setQualityGateOpen(true)}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                      disabled={!policyVerified || !docsReady || submission.submitting}
                    >
                      <Bot size={14} />
                      🤖 Auto-Submit to TPA
                    </Button>
                  )}

                  <Button variant="outline" onClick={handleSaveDraft} disabled={submission.submitting}>Save Draft</Button>
                  {isNewForm && (
                    <Button variant="ghost" onClick={() => { setIsNewForm(false); setIsExtensionForm(false); setFormState({}); }}>Cancel</Button>
                  )}
                </div>
              </div>

              {/* ── QUALITY GATE MODAL ── */}
              <PreAuthQualityGate
                open={qualityGateOpen}
                onClose={() => setQualityGateOpen(false)}
                input={{
                  patientId: formState.patient_id || selected?.patient_id || "",
                  admissionId: formState.admission_id || selected?.admission_id || null,
                  tpaName: formState.tpa_name || "",
                  policyNumber: formState.policy_number || "",
                  diagnosisCodes: formState.diagnosis_codes || "",
                  procedureCodes: formState.procedure_codes || "",
                  estimatedAmount: formState.estimated_amount || "",
                  notes: formState.notes || "",
                  isAccidentCase,
                  mlcNumber,
                  firNumber,
                  isExtension: isExtensionForm,
                  extensionReason: formState.extension_reason || "",
                  hospitalId: hospitalId || "",
                  intimationSentAt: intimationSaved ? intimationTime : null,
                  requiredDocuments: selectedTpaConfig?.required_documents || [],
                }}
                onProceed={async () => {
                  setQualityGateOpen(false);

                  // Resolve the pre-auth ID — create record first if this is a new form
                  let targetId: string | null = selected?.id ?? null;

                  if (isNewForm) {
                    if (planTier === "manual") {
                      // Manual: create with status='submitted' directly (legacy path + submission_mode)
                      await handleCreateAndSubmit("submitted", "manual");
                      return;
                    }
                    // AI / Automated: create as 'pending', then hook handles status transition
                    targetId = await handleCreateAndSubmit("pending", planTier);
                    if (!targetId) return;
                  } else if (planTier === "manual") {
                    // Existing record, manual mode — use original update logic
                    await handleSubmit();
                    return;
                  }

                  if (!targetId) return;

                  await submission.submitPreAuth(
                    targetId,
                    planTier as SubmissionMode,
                    {
                      patientName:     formState.patient_name    || selected?.patient_name    || "",
                      tpaName:         formState.tpa_name        || selected?.tpa_name        || "",
                      diagnosisCodes:  formState.diagnosis_codes || "",
                      procedureCodes:  formState.procedure_codes || "",
                      estimatedAmount: Number(formState.estimated_amount) || selected?.estimated_amount || 0,
                      notes:           formState.notes           || selected?.notes           || "",
                      policyNumber:    formState.policy_number   || selected?.policy_number   || "",
                    },
                  );
                  loadData();
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── AI Cover Letter Modal ── */}
      <Dialog open={submission.coverLetter.open} onOpenChange={submission.closeCoverLetter}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-violet-600" />
              AI-Generated Pre-Auth Cover Letter
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <pre className="whitespace-pre-wrap text-xs font-mono bg-muted/50 rounded-lg p-4 leading-relaxed">
              {submission.coverLetter.text}
            </pre>
          </div>
          <div className="flex items-center gap-3 pt-3 border-t border-border">
            <Button className="gap-1.5" onClick={submission.downloadCoverLetter}>
              <Download size={14} /> Download Letter
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={async () => {
                await submission.confirmCoverLetterSubmitted();
                loadData();
              }}
            >
              <CheckCircle2 size={14} /> Mark as Submitted
            </Button>
            <p className="text-xs text-muted-foreground ml-auto">
              Download the letter, attach clinical documents, then mark as submitted.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PreAuthQueue;
