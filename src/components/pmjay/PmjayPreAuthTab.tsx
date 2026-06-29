import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ClipboardList, Send, Bot, FileText, CheckCircle2, RefreshCw, Plus, X, ShieldCheck, Loader2, AlertCircle, Search } from "lucide-react";
import { callAI } from "@/lib/aiProvider";

interface PreAuth {
  id: string;
  patient_id: string;
  admission_id: string | null;
  scheme_id: string;
  beneficiary_id: string;
  package_code: string;
  package_name: string;
  requested_amount: number;
  approved_amount: number | null;
  clinical_summary: string | null;
  justification: string | null;
  ai_approval_score: number | null;
  status: string;
  submission_method: string;
  created_at: string;
  submitted_at: string | null;
  auth_number: string | null;
  rejection_reason: string | null;
}

interface Props {
  showNewForm: boolean;
  onFormClosed: () => void;
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-blue-50 text-blue-700",
  under_review: "bg-purple-50 text-purple-700",
  approved: "bg-emerald-50 text-emerald-700",
  partially_approved: "bg-amber-50 text-amber-700",
  rejected: "bg-red-50 text-red-700",
  expired: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

const REQUIRED_DOCS = [
  "Discharge summary / IP case sheet",
  "Beneficiary card copy",
  "Aadhaar copy",
  "Investigation reports",
  "Pre-operative photos (if surgery)",
];

const PmjayPreAuthTab: React.FC<Props> = ({ showNewForm, onFormClosed }) => {
  const [preAuths, setPreAuths] = useState<PreAuth[]>([]);
  const [patients, setPatients] = useState<Record<string, string>>({});
  const [schemes, setSchemes] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<PreAuth | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [checkedDocs, setCheckedDocs] = useState<boolean[]>(REQUIRED_DOCS.map(() => false));
  const [scoreData, setScoreData] = useState<{ score: number | null; risk: string | null; recommendation: string | null }>({ score: null, risk: null, recommendation: null });
  const { toast } = useToast();

  // New form state
  const [showForm, setShowForm] = useState(false);
  const [formSchemes, setFormSchemes] = useState<{ id: string; scheme_name: string }[]>([]);
  const [formPackages, setFormPackages] = useState<{ id: string; package_code: string; package_name: string; package_rate: number }[]>([]);
  const [formBeneficiaries, setFormBeneficiaries] = useState<{ id: string; patient_id: string; beneficiary_id: string; patient_name: string }[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<{ id: string; full_name: string; phone: string }[]>([]);
  const [newForm, setNewForm] = useState({
    patient_id: "",
    patient_name: "",
    scheme_id: "",
    beneficiary_ref_id: "", // scheme_beneficiaries.id
    package_id: "",
    admission_id: "",
    justification: "",
  });
  const [admissions, setAdmissions] = useState<{ id: string; admission_number: string | null; admitting_diagnosis: string | null }[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<{ package_code: string; package_name: string; package_rate: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ICD-10 / diagnosis driven package matching
  const [diagnosisQuery, setDiagnosisQuery] = useState("");
  const [matchedPkgs, setMatchedPkgs] = useState<{ id: string; package_code: string; package_name: string; package_rate: number; specialty: string }[]>([]);
  const [pkgSearch, setPkgSearch] = useState("");
  const [pkgSearchResults, setPkgSearchResults] = useState<{ id: string; package_code: string; package_name: string; package_rate: number; specialty: string }[]>([]);

  // Eligibility verification
  const [pmjayCard, setPmjayCard] = useState("");
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; mode?: string; beneficiary?: any; message?: string; error?: string } | null>(null);

  useEffect(() => { loadData(); loadFormData(); }, []);
  useEffect(() => { if (showNewForm) { setShowForm(true); setSelected(null); } }, [showNewForm]);

  const loadFormData = async () => {
    const [sRes, pRes] = await Promise.all([
      supabase.from("govt_schemes").select("id, scheme_name").eq("is_active", true),
      supabase.from("pmjay_packages").select("id, package_code, package_name, rate_inr").eq("is_active", true).order("package_name"),
    ]);
    setFormSchemes((sRes.data || []) as any[]);
    setFormPackages(((pRes.data || []) as any[]).map((p: any) => ({
      id: p.id, package_code: p.package_code, package_name: p.package_name, package_rate: Number(p.rate_inr) || 0,
    })));
  };

  const loadData = async () => {
    setLoading(true);
    const { data } = await supabase.from("pre_auth_requests").select("*").order("created_at", { ascending: false });
    const rows = (data || []) as PreAuth[];
    setPreAuths(rows);

    if (rows.length > 0) {
      const pIds = [...new Set(rows.map(r => r.patient_id))];
      const sIds = [...new Set(rows.map(r => r.scheme_id))];
      const [pRes, sRes] = await Promise.all([
        supabase.from("patients").select("id, full_name").in("id", pIds),
        supabase.from("govt_schemes").select("id, scheme_name").in("id", sIds),
      ]);
      setPatients(Object.fromEntries((pRes.data || []).map(p => [p.id, p.full_name])));
      setSchemes(Object.fromEntries((sRes.data || []).map(s => [s.id, s.scheme_name])));
    }
    setLoading(false);
  };

  // Patient search for new form
  const searchPatients = async (q: string) => {
    setPatientSearch(q);
    if (q.length < 2) { setPatientResults([]); return; }
    const { data } = await supabase.from("patients").select("id, full_name, phone").or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`).limit(6);
    setPatientResults((data || []) as any[]);
  };

  const selectPatient = async (p: { id: string; full_name: string }) => {
    setNewForm(f => ({ ...f, patient_id: p.id, patient_name: p.full_name, beneficiary_ref_id: "", admission_id: "" }));
    setPatientSearch(p.full_name);
    setPatientResults([]);

    // Load beneficiaries for this patient
    const { data: bens } = await supabase.from("scheme_beneficiaries").select("id, patient_id, beneficiary_id").eq("patient_id", p.id).eq("verification_status", "verified");
    setFormBeneficiaries((bens || []).map((b: any) => ({ ...b, patient_name: p.full_name })));

    // Load active admissions
    const { data: adms } = await supabase.from("admissions").select("id, admission_number, admitting_diagnosis").eq("patient_id", p.id).eq("status", "admitted");
    setAdmissions((adms || []) as any[]);
  };

  const selectPackage = (pkgId: string) => {
    const pkg = formPackages.find(p => p.id === pkgId);
    setSelectedPkg(pkg || null);
    setNewForm(f => ({ ...f, package_id: pkgId }));
  };

  // Auto-match PMJAY packages from a diagnosis keyword (or ICD-10 code → keyword)
  const matchPackagesFromDiagnosis = async (keyword: string) => {
    setDiagnosisQuery(keyword);
    const term = keyword.trim();
    if (term.length < 3) { setMatchedPkgs([]); return; }
    const { data } = await supabase
      .from("pmjay_packages")
      .select("id, package_code, package_name, rate_inr, specialty")
      .ilike("package_name", `%${term}%`)
      .eq("is_active", true)
      .limit(5);
    setMatchedPkgs(((data || []) as any[]).map((p: any) => ({
      id: p.id, package_code: p.package_code, package_name: p.package_name,
      package_rate: Number(p.rate_inr) || 0, specialty: p.specialty,
    })));
  };

  const selectMatchedPkg = (pkg: { id: string; package_code: string; package_name: string; package_rate: number }) => {
    setSelectedPkg({ package_code: pkg.package_code, package_name: pkg.package_name, package_rate: pkg.package_rate });
    setNewForm(f => ({ ...f, package_id: pkg.id }));
  };

  // Manual package search
  const searchPackages = async (q: string) => {
    setPkgSearch(q);
    const term = q.trim();
    if (term.length < 2) { setPkgSearchResults([]); return; }
    const { data } = await supabase
      .from("pmjay_packages")
      .select("id, package_code, package_name, rate_inr, specialty")
      .or(`package_name.ilike.%${term}%,specialty.ilike.%${term}%,package_code.ilike.%${term}%`)
      .eq("is_active", true)
      .limit(10);
    setPkgSearchResults(((data || []) as any[]).map((p: any) => ({
      id: p.id, package_code: p.package_code, package_name: p.package_name,
      package_rate: Number(p.rate_inr) || 0, specialty: p.specialty,
    })));
  };

  // PMJAY Eligibility verification
  const verifyEligibility = async () => {
    if (!pmjayCard || pmjayCard.length < 8) {
      toast({ title: "Enter a valid PMJAY card number", variant: "destructive" });
      return;
    }
    setEligibilityLoading(true);
    setEligibility(null);
    try {
      const { data, error } = await supabase.functions.invoke("pmjay-eligibility", {
        body: { pmjay_card_number: pmjayCard, patient_name: newForm.patient_name },
      });
      if (error) {
        setEligibility({ eligible: false, error: error.message });
      } else {
        setEligibility(data);
      }
    } catch (err: any) {
      setEligibility({ eligible: false, error: err?.message || "Verification failed" });
    } finally {
      setEligibilityLoading(false);
    }
  };

  const handleCreatePreAuth = async () => {
    if (!newForm.patient_id || !newForm.scheme_id || !newForm.package_id || !newForm.beneficiary_ref_id) {
      toast({ title: "Fill all required fields", variant: "destructive" });
      return;
    }
    if (!selectedPkg) return;

    setSubmitting(true);
    const { data: userData } = await supabase.from("users").select("hospital_id").eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id || "").maybeSingle();
    if (!userData?.hospital_id) { toast({ title: "Hospital not found", variant: "destructive" }); setSubmitting(false); return; }

    const { error } = await supabase.from("pre_auth_requests").insert({
      hospital_id: userData.hospital_id,
      patient_id: newForm.patient_id,
      scheme_id: newForm.scheme_id,
      beneficiary_id: newForm.beneficiary_ref_id,
      package_id: newForm.package_id,
      package_code: selectedPkg.package_code,
      package_name: selectedPkg.package_name,
      requested_amount: selectedPkg.package_rate,
      admission_id: newForm.admission_id || null,
      justification: newForm.justification || null,
      status: "draft",
      submission_method: "manual",
    });

    setSubmitting(false);
    if (error) { toast({ title: "Failed to create pre-auth", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Pre-auth request created" });
    setShowForm(false);
    onFormClosed();
    resetForm();
    loadData();
  };

  const resetForm = () => {
    setNewForm({ patient_id: "", patient_name: "", scheme_id: "", beneficiary_ref_id: "", package_id: "", admission_id: "", justification: "" });
    setPatientSearch("");
    setSelectedPkg(null);
    setAdmissions([]);
    setFormBeneficiaries([]);
  };

  const filtered = filter === "all" ? preAuths : preAuths.filter(p => p.status === filter);

  const updateStatus = async (id: string, status: string, extra: Record<string, any> = {}) => {
    const { error } = await supabase.from("pre_auth_requests").update({ status, ...extra }).eq("id", id);
    if (error) { toast({ title: "Update failed", variant: "destructive" }); return; }
    toast({ title: `Status updated to ${status}` });
    loadData();
    setSelected(null);
  };

  // FEATURE 1: AI Clinical Summary
  const generateClinicalSummary = async (pa: PreAuth) => {
    setAiLoading(true);
    try {
      let admissionContext = "";
      if (pa.admission_id) {
        const { data: admission } = await supabase
          .from("admissions")
          .select("*, patients(full_name, dob, gender), wards(ward_name)")
          .eq("id", pa.admission_id)
          .maybeSingle();
        if (admission) {
          const p = admission.patients as any;
          const w = admission.wards as any;
          const patientAge = p?.dob
            ? Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25 * 86400000))
            : "N/A";
          admissionContext = `
Patient: ${p?.full_name || "Unknown"}, ${patientAge}yrs, ${p?.gender || "N/A"}
Admission date: ${admission.admitted_at || "N/A"}
Diagnosis: ${admission.admitting_diagnosis || "As per treating doctor"}
Ward: ${w?.ward_name || "N/A"}`;
        }
      }

      if (!admissionContext) {
        admissionContext = `
Patient: ${patients[pa.patient_id] || "Unknown"}
Package: ${pa.package_name} (${pa.package_code})`;
      }

      const response = await callAI({
        featureKey: "appeal_letter",
        hospitalId: "",
        prompt: `Write a formal clinical summary for insurance pre-authorization for an Indian government health scheme.
${admissionContext}
Package: ${pa.package_name} (${pa.package_code})
Amount: ₹${pa.requested_amount}

Write a 3-paragraph clinical summary:
Para 1: Patient presentation and diagnosis
Para 2: Clinical findings and investigations
Para 3: Proposed treatment/procedure and medical necessity

Keep language formal and medical. Max 300 words.
This will be submitted to government authorities.`,
        maxTokens: 400,
      });

      if (response && !response.error) {
        const summaryText = response.text || "";
        setEditSummary(summaryText);
        await supabase.from("pre_auth_requests").update({ clinical_summary: summaryText }).eq("id", pa.id);
        toast({ title: "Clinical summary generated ✓" });
        loadData();
      } else {
        toast({ title: "AI unavailable — write summary manually", variant: "destructive" });
      }
    } catch (error) {
      console.error("Clinical summary generation failed:", error);
      toast({ title: "Failed to generate summary", variant: "destructive" });
    }
    setAiLoading(false);
  };

  // FEATURE 2: AI Approval Score
  const calculateApprovalScore = async (pa: PreAuth) => {
    setScoreLoading(true);
    try {
      const docsChecked = checkedDocs.filter(Boolean).length;
      const summaryWords = (editSummary || "").split(/\s+/).filter(Boolean).length;

      const response = await callAI({
        featureKey: "appeal_letter",
        hospitalId: "",
        prompt: `You are an expert in PMJAY/Ayushman Bharat claim approval patterns in Indian government hospitals.

Pre-auth details:
Package: ${pa.package_name} (₹${pa.requested_amount})
Diagnosis: ${pa.justification || pa.clinical_summary?.substring(0, 100) || "Not specified"}
Patient: ${patients[pa.patient_id] || "Unknown"}
Documents uploaded: ${docsChecked} of ${REQUIRED_DOCS.length}
Clinical summary length: ${summaryWords} words

Based on typical PMJAY approval patterns, estimate:
1. Approval probability (0-100)
2. Main approval risk factor (one sentence)
3. One specific recommendation to improve chances

Return ONLY JSON:
{
  "score": 75,
  "risk": "Incomplete documentation — missing investigation reports",
  "recommendation": "Upload CBC and LFT reports to strengthen medical necessity"
}`,
        maxTokens: 200,
      });

      if (response && !response.error) {
        try {
          const clean = (response.text || "")
            .replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(clean);
          setScoreData({
            score: parsed.score ?? null,
            risk: parsed.risk ?? null,
            recommendation: parsed.recommendation ?? null,
          });
          await supabase.from("pre_auth_requests")
            .update({ ai_approval_score: parsed.score ?? null })
            .eq("id", pa.id);
        } catch (parseError) {
          console.error("Could not parse AI score:", parseError);
          setScoreData({ score: null, risk: null, recommendation: null });
        }
      }
    } catch (error) {
      console.error("Approval score calculation failed:", error);
    }
    setScoreLoading(false);
  };

  const saveSummary = async () => {
    if (!selected) return;
    await supabase.from("pre_auth_requests").update({ clinical_summary: editSummary }).eq("id", selected.id);
    toast({ title: "Summary saved" });
    loadData();
  };

  const toggleDoc = (idx: number) => {
    setCheckedDocs(prev => prev.map((v, i) => i === idx ? !v : v));
  };

  const scoreColor = (score: number | null) => {
    if (!score) return "";
    if (score >= 70) return "text-emerald-700";
    if (score >= 40) return "text-amber-700";
    return "text-red-700";
  };

  const scoreLabel = (score: number | null) => {
    if (!score) return "";
    if (score >= 70) return "HIGH";
    if (score >= 40) return "MODERATE";
    return "LOW — Review documentation";
  };

  const scoreBg = (score: number | null) => {
    if (!score) return "bg-muted/50";
    if (score >= 70) return "bg-emerald-50 border-emerald-100";
    if (score >= 40) return "bg-amber-50 border-amber-100";
    return "bg-red-50 border-red-100";
  };

  useEffect(() => {
    if (selected) {
      setEditSummary(selected.clinical_summary || "");
      setScoreData({ score: selected.ai_approval_score, risk: null, recommendation: null });
      setCheckedDocs(REQUIRED_DOCS.map(() => false));
    }
  }, [selected?.id]);

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — Queue */}
      <div className="w-[320px] border-r border-border bg-background flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border">
          <h3 className="text-sm font-bold">Pre-Auth Queue</h3>
          <div className="flex gap-1 mt-2 flex-wrap">
            {["all", "draft", "submitted", "under_review", "approved", "rejected"].map(f => (
              <button key={f} onClick={() => setFilter(f)} className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-medium capitalize",
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}>
                {f === "all" ? "All" : f.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-12">
              <ClipboardList size={32} className="mx-auto mb-2 opacity-40" />
              No pre-auth requests
            </div>
          ) : filtered.map(item => (
            <button
              key={item.id}
              onClick={() => { setSelected(item); setShowForm(false); }}
              className={cn(
                "w-full text-left p-3 rounded-lg border transition-colors",
                selected?.id === item.id ? "bg-primary/5 border-primary" : "border-border hover:bg-muted/50"
              )}
            >
              <div className="flex justify-between items-start">
                <span className="text-[13px] font-medium">{patients[item.patient_id] || "Unknown"}</span>
                <Badge variant="outline" className={cn("text-[9px] capitalize", statusColors[item.status])}>{item.status.replace("_", " ")}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{schemes[item.scheme_id] || "Scheme"}</div>
              <div className="text-[11px] font-medium mt-0.5">{item.package_name}</div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-[11px] font-mono">₹{item.requested_amount.toLocaleString("en-IN")}</span>
                {item.ai_approval_score && (
                  <span className={cn("text-[10px] font-bold", scoreColor(item.ai_approval_score))}>
                    {item.ai_approval_score}%
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel — Detail or New Form */}
      <div className="flex-1 overflow-y-auto p-5">
        {showForm ? (
          /* ==================== NEW PRE-AUTH FORM ==================== */
          <div className="max-w-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">New Pre-Auth Request</h3>
              <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); onFormClosed(); resetForm(); }}>
                <X size={16} />
              </Button>
            </div>

            {/* Patient */}
            <div>
              <Label className="text-[11px]">Patient *</Label>
              <Input className="mt-1" placeholder="Search patient by name or phone..." value={patientSearch} onChange={e => searchPatients(e.target.value)} />
              {patientResults.length > 0 && (
                <div className="border border-border rounded mt-1 bg-background max-h-32 overflow-y-auto">
                  {patientResults.map(p => (
                    <button key={p.id} onClick={() => selectPatient(p)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted">
                      {p.full_name} <span className="text-muted-foreground">({p.phone})</span>
                    </button>
                  ))}
                </div>
              )}
              {newForm.patient_name && <p className="text-xs text-emerald-600 mt-1">✓ {newForm.patient_name}</p>}
            </div>

            {/* Scheme */}
            <div>
              <Label className="text-[11px]">Scheme *</Label>
              <Select value={newForm.scheme_id} onValueChange={v => setNewForm(f => ({ ...f, scheme_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select scheme" /></SelectTrigger>
                <SelectContent>
                  {formSchemes.map(s => <SelectItem key={s.id} value={s.id}>{s.scheme_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Beneficiary (from scheme_beneficiaries for this patient) */}
            <div>
              <Label className="text-[11px]">Beneficiary ID *</Label>
              {!newForm.patient_id ? (
                <p className="text-xs text-muted-foreground mt-1">Select a patient first</p>
              ) : formBeneficiaries.length === 0 ? (
                <p className="text-xs text-amber-600 mt-1">No verified beneficiaries found. Register one in the Beneficiaries tab first.</p>
              ) : (
                <Select value={newForm.beneficiary_ref_id} onValueChange={v => setNewForm(f => ({ ...f, beneficiary_ref_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select beneficiary" /></SelectTrigger>
                  <SelectContent>
                    {formBeneficiaries.map(b => <SelectItem key={b.id} value={b.id}>{b.beneficiary_id}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* PMJAY Card Eligibility Verification */}
            <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-2">
              <Label className="text-[11px] flex items-center gap-1.5">
                <ShieldCheck size={13} className="text-primary" /> Verify PMJAY Card Eligibility
              </Label>
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="PMJAY card number (e.g. 12345678901234)"
                  value={pmjayCard}
                  onChange={e => setPmjayCard(e.target.value)}
                />
                <Button size="sm" type="button" onClick={verifyEligibility} disabled={eligibilityLoading || pmjayCard.length < 8} className="gap-1.5">
                  {eligibilityLoading ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                  {eligibilityLoading ? "Checking..." : "Verify"}
                </Button>
              </div>
              {eligibility && (
                <div className={cn(
                  "rounded-md border p-2.5 text-xs space-y-1",
                  eligibility.error || !eligibility.eligible ? "bg-red-50 border-red-200 text-red-700" :
                  eligibility.mode === "sandbox" ? "bg-amber-50 border-amber-200 text-amber-800" :
                  "bg-emerald-50 border-emerald-200 text-emerald-800"
                )}>
                  <div className="flex items-center gap-1.5 font-semibold">
                    {eligibility.error || !eligibility.eligible ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
                    {eligibility.error
                      ? "Verification failed"
                      : !eligibility.eligible
                      ? "Not eligible"
                      : eligibility.mode === "sandbox"
                      ? "Eligible (Sandbox mode)"
                      : "Eligible (Live verification)"}
                  </div>
                  {eligibility.beneficiary && (
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <div><span className="opacity-70">Name:</span> {eligibility.beneficiary.name}</div>
                      <div><span className="opacity-70">Scheme:</span> {eligibility.beneficiary.scheme}</div>
                      <div><span className="opacity-70">Family ID:</span> {eligibility.beneficiary.family_id}</div>
                      <div><span className="opacity-70">Balance:</span> ₹{Number(eligibility.beneficiary.balance_amount || 0).toLocaleString("en-IN")}</div>
                    </div>
                  )}
                  {eligibility.message && <div className="opacity-80 italic">{eligibility.message}</div>}
                  {eligibility.error && <div>{eligibility.error}</div>}
                </div>
              )}
            </div>

            {/* Diagnosis → Auto-match PMJAY Packages */}
            <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-2">
              <Label className="text-[11px]">Diagnosis / ICD-10 keyword (auto-matches PMJAY packages)</Label>
              <Input
                placeholder="e.g. Cataract, CABG, Appendicitis, Knee Replacement..."
                value={diagnosisQuery}
                onChange={e => matchPackagesFromDiagnosis(e.target.value)}
              />
              {matchedPkgs.length > 0 && (
                <div className="grid grid-cols-1 gap-1.5 mt-1.5">
                  {matchedPkgs.map(pkg => (
                    <button
                      type="button"
                      key={pkg.id}
                      onClick={() => selectMatchedPkg(pkg)}
                      className={cn(
                        "text-left p-2 rounded-md border transition-colors",
                        newForm.package_id === pkg.id
                          ? "bg-primary/5 border-primary"
                          : "border-border hover:bg-muted/50 bg-background"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-muted-foreground">{pkg.package_code}</span>
                        <span className="text-[10px] text-muted-foreground">{pkg.specialty}</span>
                      </div>
                      <div className="text-xs font-medium text-foreground">{pkg.package_name}</div>
                      <div className="text-sm font-bold text-foreground mt-0.5">₹{pkg.package_rate.toLocaleString("en-IN")}</div>
                    </button>
                  ))}
                </div>
              )}
              {diagnosisQuery.length >= 3 && matchedPkgs.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic">No matching packages — try a different keyword or use search below.</p>
              )}
            </div>

            {/* Package — manual select or search */}
            <div>
              <Label className="text-[11px]">Package *</Label>
              <Select value={newForm.package_id} onValueChange={selectPackage}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select package" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {formPackages.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.package_code} — {p.package_name} (₹{p.package_rate.toLocaleString("en-IN")})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPkg && (
                <p className="text-xs font-mono mt-1 text-primary">Selected: ₹{selectedPkg.package_rate.toLocaleString("en-IN")}</p>
              )}

              {/* Manual PMJAY package search */}
              <div className="mt-2 space-y-1.5">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-2.5 text-muted-foreground" />
                  <Input
                    className="pl-7 text-xs h-8"
                    placeholder="Search PMJAY Packages by name, specialty or code..."
                    value={pkgSearch}
                    onChange={e => searchPackages(e.target.value)}
                  />
                </div>
                {pkgSearchResults.length > 0 && (
                  <div className="border border-border rounded-md bg-background max-h-40 overflow-y-auto divide-y divide-border">
                    {pkgSearchResults.map(p => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => { selectMatchedPkg(p); setPkgSearchResults([]); setPkgSearch(""); }}
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted"
                      >
                        <div className="flex justify-between">
                          <span className="font-mono text-[10px] text-muted-foreground">{p.package_code}</span>
                          <span className="font-bold">₹{p.package_rate.toLocaleString("en-IN")}</span>
                        </div>
                        <div>{p.package_name}</div>
                        <div className="text-[10px] text-muted-foreground">{p.specialty}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Admission (optional) */}
            {admissions.length > 0 && (
              <div>
                <Label className="text-[11px]">Link Admission (optional)</Label>
                <Select value={newForm.admission_id} onValueChange={v => setNewForm(f => ({ ...f, admission_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select admission" /></SelectTrigger>
                  <SelectContent>
                    {admissions.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.admission_number || a.id.slice(0, 8)} — {a.admitting_diagnosis || "N/A"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Justification */}
            <div>
              <Label className="text-[11px]">Clinical Justification</Label>
              <Textarea className="mt-1 min-h-[60px]" value={newForm.justification} onChange={e => setNewForm(f => ({ ...f, justification: e.target.value }))} placeholder="Brief clinical justification..." />
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleCreatePreAuth} disabled={submitting} className="gap-1.5">
                <Plus size={14} /> {submitting ? "Creating..." : "Create Pre-Auth"}
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); onFormClosed(); resetForm(); }}>Cancel</Button>
            </div>
          </div>
        ) : !selected ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <ClipboardList size={40} className="opacity-30 mb-2" />
            <p className="text-sm">Select a pre-auth request</p>
          </div>
        ) : (
          /* ==================== EXISTING DETAIL VIEW ==================== */
          <div className="max-w-2xl space-y-5">
            <div className="flex justify-between items-start">
              <h3 className="text-base font-bold">Pre-Auth: {selected.package_name}</h3>
              <Badge className={cn("capitalize", statusColors[selected.status])}>{selected.status.replace("_", " ")}</Badge>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground text-[11px]">Patient</span><br/>{patients[selected.patient_id]}</div>
              <div><span className="text-muted-foreground text-[11px]">Scheme</span><br/>{schemes[selected.scheme_id]}</div>
              <div><span className="text-muted-foreground text-[11px]">Package</span><br/>{selected.package_code} — {selected.package_name}</div>
              <div><span className="text-muted-foreground text-[11px]">Requested</span><br/>₹{selected.requested_amount.toLocaleString("en-IN")}</div>
            </div>

            {/* Clinical Summary */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Bot size={14} className="text-primary" />
                <Label className="text-[11px] uppercase text-muted-foreground font-semibold">AI Clinical Summary</Label>
              </div>
              <Textarea
                className="min-h-[100px] text-sm"
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                placeholder="Click 'Generate Summary' to auto-fill..."
              />
              {editSummary && (
                <p className="text-[10px] text-muted-foreground mt-0.5 italic">(AI generated — please review and edit before submission)</p>
              )}
              <div className="flex gap-2 mt-1.5">
                <Button size="sm" variant="outline" className="gap-1" onClick={() => generateClinicalSummary(selected)} disabled={aiLoading}>
                  <Bot size={13} /> {aiLoading ? "Generating..." : "Generate Summary"}
                </Button>
                {editSummary !== (selected.clinical_summary || "") && (
                  <Button size="sm" variant="ghost" onClick={saveSummary}>Save Changes</Button>
                )}
              </div>
            </div>

            {/* Documents Checklist */}
            <div>
              <Label className="text-[11px] uppercase text-muted-foreground font-semibold mb-2 block">
                <FileText size={13} className="inline mr-1" /> Required Documents ({checkedDocs.filter(Boolean).length}/{REQUIRED_DOCS.length})
              </Label>
              <div className="space-y-2">
                {REQUIRED_DOCS.map((doc, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="rounded" checked={checkedDocs[i]} onChange={() => toggleDoc(i)} />
                    {doc}
                  </label>
                ))}
              </div>
            </div>

            {/* AI Approval Score */}
            <div className={cn("border rounded-lg p-3", scoreBg(scoreData.score))}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[11px] text-muted-foreground font-semibold">Predicted Approval Probability</span>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => calculateApprovalScore(selected)} disabled={scoreLoading}>
                  <RefreshCw size={12} className={scoreLoading ? "animate-spin" : ""} />
                  {scoreLoading ? "Calculating..." : "Calculate Score"}
                </Button>
              </div>
              {scoreData.score != null ? (
                <>
                  <div className={cn("text-2xl font-bold font-mono", scoreColor(scoreData.score))}>
                    {scoreData.score}% <span className="text-sm">{scoreLabel(scoreData.score)}</span>
                  </div>
                  {scoreData.risk && <div className="text-[11px] mt-1.5"><strong>Risk:</strong> {scoreData.risk}</div>}
                  {scoreData.recommendation && <div className="text-[11px] mt-1 text-primary"><strong>Recommendation:</strong> {scoreData.recommendation}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1.5">Based on: package type, diagnosis match, documentation completeness</div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground py-2">Click "Calculate Score" to get AI-predicted approval probability</div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2 flex-wrap">
              {selected.status === "draft" && (
                <Button onClick={() => updateStatus(selected.id, "submitted", { submitted_at: new Date().toISOString() })} className="gap-1.5">
                  <Send size={14} /> Submit Pre-Auth
                </Button>
              )}
              {(selected.status === "submitted" || selected.status === "under_review") && (
                <>
                  <Button variant="outline" className="gap-1" onClick={() => updateStatus(selected.id, "approved")}>
                    <CheckCircle2 size={14} /> Mark Approved
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => updateStatus(selected.id, "rejected")}>
                    Mark Rejected
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PmjayPreAuthTab;
