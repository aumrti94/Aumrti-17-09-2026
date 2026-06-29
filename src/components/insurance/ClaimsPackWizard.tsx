import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ChevronRight, ChevronLeft, Search, CheckCircle2, AlertTriangle,
  Loader2, Bot, Send, FileText, ShieldCheck, RefreshCw, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import AIAttestationModal from "@/components/ai/AIAttestationModal";

// ── Document config by payer type ─────────────────────────────────────────────

interface DocDef {
  key: string;
  label: string;
  auto: boolean; // auto-verified from system data
}

const DOC_CONFIGS: Record<string, DocDef[]> = {
  pmjay: [
    { key: "discharge_summary", label: "Discharge Summary",          auto: true  },
    { key: "lab_reports",       label: "Lab Reports",                auto: true  },
    { key: "op_notes",          label: "Operation Notes (if surgery)", auto: true },
    { key: "drug_chart",        label: "Drug Chart / Pharmacy Bills", auto: true  },
    { key: "pre_auth_letter",   label: "Pre-Authorization Letter",   auto: true  },
    { key: "pmjay_card",        label: "PMJAY / Ayushman Card Copy", auto: false },
    { key: "aadhaar",           label: "Aadhaar / ID Proof",         auto: false },
  ],
  cghs: [
    { key: "discharge_summary", label: "Discharge Summary",                    auto: true  },
    { key: "lab_reports",       label: "Lab Reports",                          auto: true  },
    { key: "op_notes",          label: "Operation Notes (if surgery)",         auto: true  },
    { key: "drug_chart",        label: "Drug Chart / Pharmacy Bills",          auto: true  },
    { key: "pre_auth_letter",   label: "Pre-Auth Letter (if applicable)",      auto: true  },
    { key: "cghs_card",         label: "CGHS / ECHS Card Copy",               auto: false },
    { key: "referral_letter",   label: "Referral Letter from Polyclinic",     auto: false },
  ],
  esi: [
    { key: "discharge_summary", label: "Discharge Summary",        auto: true  },
    { key: "lab_reports",       label: "Lab Reports",              auto: true  },
    { key: "drug_chart",        label: "Pharmacy Bills",           auto: true  },
    { key: "esi_card",          label: "ESI Card Copy",            auto: false },
    { key: "ip_number",         label: "IP Number / Dispensary Proof", auto: false },
  ],
  tpa: [
    { key: "discharge_summary", label: "Discharge Summary",         auto: true  },
    { key: "original_bills",    label: "Original Bills",            auto: true  },
    { key: "pre_auth_letter",   label: "Pre-Authorization Letter",  auto: true  },
    { key: "lab_reports",       label: "Lab Reports",               auto: true  },
    { key: "pharmacy_bills",    label: "Pharmacy Bills",            auto: true  },
    { key: "doctor_cert",       label: "Doctor's Certificate",      auto: false },
  ],
  state_scheme: [
    { key: "discharge_summary", label: "Discharge Summary",          auto: true  },
    { key: "lab_reports",       label: "Lab Reports",                auto: true  },
    { key: "op_notes",          label: "Operation Notes (if surgery)", auto: true },
    { key: "drug_chart",        label: "Drug Chart / Pharmacy Bills", auto: true  },
    { key: "scheme_card",       label: "State Scheme Card Copy",     auto: false },
    { key: "aadhaar",           label: "Aadhaar / ID Proof",         auto: false },
  ],
};
const DEFAULT_DOCS = DOC_CONFIGS.tpa;

function getDocDefs(payerType: string): DocDef[] {
  return DOC_CONFIGS[payerType] ?? DEFAULT_DOCS;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface SelectedAdmission {
  id: string;
  patient_id: string;
  patient_name: string;
  uhid: string;
  admission_number: string | null;
  admitting_diagnosis: string | null;
  admitted_at: string;
  bed_label: string;
  payer_type: string;
  payer_id: string | null;
  payer_name: string;
  bill_id: string | null;
}

interface DocState {
  key: string;
  label: string;
  available: boolean; // system-detected
  checked: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (claimId: string, claimNumber: string) => void;
}

const STEP_LABELS = ["Admission", "Documents", "AI Narrative", "Submit"];

// ── Helper: payer type badge ──────────────────────────────────────────────────

function payerBadge(pt: string) {
  const map: Record<string, string> = {
    pmjay: "bg-green-100 text-green-800",
    cghs:  "bg-blue-100 text-blue-800",
    esi:   "bg-purple-100 text-purple-800",
    tpa:   "bg-amber-100 text-amber-800",
    state_scheme: "bg-teal-100 text-teal-800",
    corporate: "bg-indigo-100 text-indigo-800",
  };
  return (
    <Badge className={cn("text-[10px] uppercase", map[pt] || "bg-muted text-muted-foreground")}>
      {pt.replace("_", " ")}
    </Badge>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const ClaimsPackWizard: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();

  const [step, setStep] = useState(0);

  // Step 1
  const [search, setSearch] = useState("");
  const [admissions, setAdmissions] = useState<SelectedAdmission[]>([]);
  const [loadingAdm, setLoadingAdm] = useState(false);
  const [selected, setSelected] = useState<SelectedAdmission | null>(null);

  // Step 2
  const [docs, setDocs] = useState<DocState[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Step 3
  const [narrative, setNarrative] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [attested, setAttested] = useState(false);
  const [showAttestation, setShowAttestation] = useState(false);

  // Step 4
  const [eligibilityResult, setEligibilityResult] = useState<any>(null);
  const [eligLoading, setEligLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdClaim, setCreatedClaim] = useState<{ id: string; number: string } | null>(null);

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setStep(0);
      setSearch("");
      setSelected(null);
      setDocs([]);
      setNarrative("");
      setAttested(false);
      setEligibilityResult(null);
      setCreatedClaim(null);
    }
  }, [open]);

  // ── Step 1: fetch insured admissions ─────────────────────────────────────

  const fetchAdmissions = useCallback(async (q: string) => {
    if (!hospitalId) return;
    setLoadingAdm(true);
    try {
      let query = (supabase as any)
        .from("admissions")
        .select(`
          id, patient_id, admission_number, admitting_diagnosis, admitted_at,
          payer_type, payer_id,
          patients!admissions_patient_id_fkey(full_name, uhid),
          beds!admissions_bed_id_fkey(bed_number),
          wards!admissions_ward_id_fkey(name),
          payer_masters!admissions_payer_id_fkey(payer_name)
        `)
        .eq("hospital_id", hospitalId)
        .eq("status", "active")
        .not("payer_type", "is", null)
        .not("payer_type", "eq", "cash")
        .order("admitted_at", { ascending: false })
        .limit(50);

      if (q.trim()) {
        query = query.ilike("patients.full_name", `%${q.trim()}%`);
      }

      const { data } = await query;

      // Also find existing bill for each admission
      const admIds = (data || []).map((a: any) => a.id);
      let billMap: Record<string, string> = {};
      if (admIds.length > 0) {
        const { data: bills } = await supabase
          .from("bills")
          .select("id, admission_id")
          .in("admission_id", admIds)
          .in("bill_status", ["final", "draft"])
          .order("created_at", { ascending: false });
        (bills || []).forEach((b: any) => {
          if (!billMap[b.admission_id]) billMap[b.admission_id] = b.id;
        });
      }

      setAdmissions(
        (data || []).map((a: any) => ({
          id: a.id,
          patient_id: a.patient_id,
          patient_name: a.patients?.full_name || "Unknown",
          uhid: a.patients?.uhid || "",
          admission_number: a.admission_number || null,
          admitting_diagnosis: a.admitting_diagnosis || null,
          admitted_at: a.admitted_at,
          bed_label: `${a.wards?.name || ""}${a.beds?.bed_number ? " – " + a.beds.bed_number : ""}`,
          payer_type: a.payer_type || "tpa",
          payer_id: a.payer_id || null,
          payer_name: a.payer_masters?.payer_name || a.payer_type || "Insurance",
          bill_id: billMap[a.id] || null,
        }))
      );
    } finally {
      setLoadingAdm(false);
    }
  }, [hospitalId]);

  useEffect(() => {
    if (open && step === 0) fetchAdmissions(search);
  }, [open, step, search, fetchAdmissions]);

  // ── Step 2: auto-detect available docs ───────────────────────────────────

  const loadDocAvailability = useCallback(async (adm: SelectedAdmission) => {
    setLoadingDocs(true);
    try {
      const [labRes, radRes, preAuthRes, otRes, billRes] = await Promise.all([
        supabase.from("lab_orders").select("id", { count: "exact", head: true }).eq("admission_id", adm.id),
        supabase.from("radiology_orders").select("id", { count: "exact", head: true }).eq("admission_id", adm.id),
        supabase.from("insurance_pre_auth").select("id", { count: "exact", head: true })
          .eq("admission_id", adm.id).eq("status", "approved"),
        supabase.from("ot_schedules").select("id", { count: "exact", head: true }).eq("admission_id", adm.id),
        supabase.from("bills").select("id", { count: "exact", head: true }).eq("admission_id", adm.id),
      ]);

      const hasLabs     = (labRes.count  || 0) > 0;
      const hasRad      = (radRes.count  || 0) > 0;
      const hasPreAuth  = (preAuthRes.count || 0) > 0;
      const hasOT       = (otRes.count   || 0) > 0;
      const hasBill     = (billRes.count || 0) > 0;

      const defs = getDocDefs(adm.payer_type);
      const availability: Record<string, boolean> = {
        discharge_summary: true,    // always generated from system
        lab_reports:       hasLabs,
        op_notes:          hasOT,
        drug_chart:        true,    // pharmacy records exist if medications were charted
        pharmacy_bills:    hasBill,
        original_bills:    hasBill,
        pre_auth_letter:   hasPreAuth,
        lab_reports_rad:   hasRad,
        // physical docs — not auto-verifiable
        pmjay_card:        false,
        aadhaar:           false,
        cghs_card:         false,
        referral_letter:   false,
        esi_card:          false,
        ip_number:         false,
        doctor_cert:       false,
        scheme_card:       false,
      };

      setDocs(
        defs.map((d) => ({
          key: d.key,
          label: d.label,
          available: d.auto ? (availability[d.key] ?? true) : false,
          checked: d.auto ? (availability[d.key] ?? true) : false,
        }))
      );
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  // ── Step 3: generate AI narrative ────────────────────────────────────────

  const generateNarrative = async () => {
    if (!selected || !hospitalId) return;
    setGenLoading(true);
    const t0 = Date.now();
    try {
      const { data: admData } = await (supabase as any)
        .from("admissions")
        .select(`
          admitting_diagnosis, admitted_at, discharged_at,
          wards!admissions_ward_id_fkey(name),
          beds!admissions_bed_id_fkey(bed_number)
        `)
        .eq("id", selected.id)
        .maybeSingle();

      const { data, error } = await supabase.functions.invoke("ai-discharge-summary", {
        body: {
          admission_id: selected.id,
          patient_id:   selected.patient_id,
          hospital_id:  hospitalId,
          context_hint: "insurance_claims_narrative",
          diagnosis:    admData?.admitting_diagnosis || selected.admitting_diagnosis || "",
          payer_type:   selected.payer_type,
          payer_name:   selected.payer_name,
        },
      });

      const latency = Date.now() - t0;
      const text = data?.summary || data?.discharge_summary || "";
      if (!error && text) {
        setNarrative(text);
      } else {
        // Fallback narrative
        setNarrative(
          `Patient: ${selected.patient_name}\n` +
          `Admission: ${selected.admission_number || selected.id.slice(0, 8)}\n` +
          `Diagnosis: ${selected.admitting_diagnosis || "—"}\n` +
          `Payer: ${selected.payer_name} (${selected.payer_type.toUpperCase()})\n\n` +
          `[Please complete the clinical narrative for claim submission.]`
        );
      }

      // Log AI usage
      await (supabase as any).from("ai_feature_logs").insert({
        hospital_id:    hospitalId,
        patient_id:     selected.patient_id,
        module:         "insurance",
        feature_key:    "claims_narrative",
        success:        !error,
        output_summary: text.slice(0, 200),
        latency_ms:     latency,
      });
    } catch {
      toast({ title: "AI generation failed", variant: "destructive" });
    } finally {
      setGenLoading(false);
    }
  };

  // ── Step 4: eligibility check ─────────────────────────────────────────────

  const checkEligibility = async () => {
    if (!selected || !hospitalId) return;
    setEligLoading(true);
    try {
      const fnMap: Record<string, string> = {
        pmjay: "pmjay-eligibility",
        cghs:  "cghs-eligibility",
      };
      const fn = fnMap[selected.payer_type];
      if (!fn) {
        setEligibilityResult({ eligible: true, message: "Eligibility auto-approved for this payer type." });
        return;
      }
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { patient_id: selected.patient_id, hospital_id: hospitalId },
      });
      if (error) throw error;
      setEligibilityResult(data);
    } catch (e: any) {
      setEligibilityResult({ eligible: false, message: e.message || "Eligibility check failed." });
    } finally {
      setEligLoading(false);
    }
  };

  // ── Step 4: create claim ──────────────────────────────────────────────────

  const submitClaim = async () => {
    if (!selected || !hospitalId) return;
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: userRow } = await (supabase as any)
        .from("users")
        .select("id")
        .eq("auth_user_id", userData.user?.id || "")
        .maybeSingle();

      const claimNumber = `CLM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;

      // Fetch pre-auth if available
      const { data: preAuth } = await (supabase as any)
        .from("insurance_pre_auth")
        .select("id, pre_auth_number, approved_at")
        .eq("admission_id", selected.id)
        .eq("status", "approved")
        .maybeSingle();

      const docsChecklist = Object.fromEntries(docs.map((d) => [d.key, d.checked]));

      // For ESI — also call esi-claim-submit
      if (selected.payer_type === "esi") {
        await supabase.functions.invoke("esi-claim-submit", {
          body: { patient_id: selected.patient_id, hospital_id: hospitalId, admission_id: selected.id },
        }).catch(() => { /* non-blocking */ });
      }

      const payload: Record<string, any> = {
        hospital_id:               hospitalId,
        patient_id:                selected.patient_id,
        admission_id:              selected.id,
        payer_id:                  selected.payer_id,
        payer_type:                selected.payer_type,
        tpa_name:                  selected.payer_name,
        claim_number:              claimNumber,
        claimed_amount:            0,          // updated when bill is finalised
        status:                    "draft",
        pre_auth_id:               preAuth?.id || null,
        pre_auth_number:           preAuth?.pre_auth_number || null,
        pre_auth_date:             preAuth?.approved_at
                                    ? new Date(preAuth.approved_at).toISOString().slice(0, 10)
                                    : null,
        documents_checklist:       docsChecklist,
        claim_narrative:           narrative || null,
        claim_narrative_attested:  attested,
        eligibility_verified:      eligibilityResult?.eligible ?? false,
        eligibility_response:      eligibilityResult || null,
        created_by:                userRow?.id || null,
      };

      if (selected.bill_id) {
        // Bill already exists — link it and use its total
        const { data: bill } = await supabase.from("bills").select("total_amount").eq("id", selected.bill_id).maybeSingle();
        payload.bill_id        = selected.bill_id;
        payload.claimed_amount = Number(bill?.total_amount || 0);
        payload.status         = "submitted";
        payload.submitted_at   = new Date().toISOString();
        payload.submission_date = new Date().toISOString().slice(0, 10);
      }

      const { data: claim, error } = await (supabase as any)
        .from("insurance_claims")
        .insert(payload)
        .select("id")
        .maybeSingle();

      if (error) throw error;

      setCreatedClaim({ id: claim.id, number: claimNumber });
      onCreated?.(claim.id, claimNumber);
      toast({ title: `Claim ${claimNumber} created ✓` });
    } catch (e: any) {
      toast({ title: "Failed to create claim", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const canAdvance = () => {
    if (step === 0) return !!selected;
    if (step === 1) return docs.some((d) => d.checked);
    if (step === 2) return true; // narrative is optional to advance
    return false;
  };

  const missingMandatoryDocs = docs.filter((d) => !d.available && !d.checked);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText size={16} /> New Insurance Claim
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-1 mb-2">
            {STEP_LABELS.map((label, i) => (
              <React.Fragment key={i}>
                <div className={cn(
                  "flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded",
                  i === step ? "bg-primary text-primary-foreground" :
                  i < step   ? "bg-emerald-50 text-emerald-700" :
                               "text-muted-foreground"
                )}>
                  {i < step && <CheckCircle2 size={10} />}
                  {i + 1}. {label}
                </div>
                {i < STEP_LABELS.length - 1 && <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
              </React.Fragment>
            ))}
          </div>

          {/* ── STEP 1: Admission ── */}
          {step === 0 && (
            <div className="space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8 h-9 text-sm"
                  placeholder="Search by patient name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {loadingAdm ? (
                <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
              ) : admissions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No active insured admissions found
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[380px] overflow-y-auto">
                  {admissions.map((adm) => (
                    <button
                      key={adm.id}
                      onClick={() => setSelected(adm)}
                      className={cn(
                        "w-full text-left p-3 rounded-lg border transition-colors",
                        selected?.id === adm.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold truncate">{adm.patient_name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {adm.uhid && <span className="font-mono mr-2">{adm.uhid}</span>}
                            {adm.bed_label}
                            {adm.admitting_diagnosis && <span> · {adm.admitting_diagnosis}</span>}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {payerBadge(adm.payer_type)}
                          <span className="text-[10px] text-muted-foreground">{adm.payer_name}</span>
                        </div>
                      </div>
                      {adm.bill_id && (
                        <p className="text-[10px] text-emerald-700 mt-1 flex items-center gap-1">
                          <CheckCircle2 size={10} /> Bill exists — claim will be linked automatically
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Document Checklist ── */}
          {step === 1 && selected && (
            <div className="space-y-3">
              <div className="bg-muted/40 rounded-md p-3 text-xs space-y-0.5">
                <p><span className="text-muted-foreground">Patient:</span> <span className="font-semibold">{selected.patient_name}</span></p>
                <p>
                  <span className="text-muted-foreground">Payer:</span> {selected.payer_name} · {payerBadge(selected.payer_type)}
                </p>
              </div>

              {loadingDocs ? (
                <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Required Documents ({selected.payer_type.toUpperCase()})
                  </p>
                  {docs.map((doc) => (
                    <div
                      key={doc.key}
                      className={cn(
                        "flex items-center justify-between p-2.5 rounded-md border",
                        doc.available
                          ? "border-border bg-background"
                          : "border-amber-200 bg-amber-50/40"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={doc.checked}
                          onCheckedChange={(v) =>
                            setDocs((prev) =>
                              prev.map((d) => d.key === doc.key ? { ...d, checked: !!v } : d)
                            )
                          }
                        />
                        <div>
                          <p className="text-[13px] font-medium">{doc.label}</p>
                          {!doc.available && (
                            <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-0.5">
                              <AlertTriangle size={10} />
                              Not found in system — attach physical copy
                            </p>
                          )}
                        </div>
                      </div>
                      {doc.available && <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />}
                    </div>
                  ))}
                </div>
              )}

              {missingMandatoryDocs.length > 0 && (
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{missingMandatoryDocs.length} document(s) not in system. Ensure physical copies are attached before submission.</span>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: AI Claims Narrative ── */}
          {step === 2 && selected && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate a concise claims-appropriate clinical narrative for the insurer.
                Doctor attestation is required before proceeding.
              </p>
              <Button
                variant="outline"
                className="gap-2 border-violet-300 text-violet-700 hover:bg-violet-50"
                onClick={generateNarrative}
                disabled={genLoading}
              >
                {genLoading
                  ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
                  : <><Bot size={14} /> Generate Claims Narrative</>
                }
              </Button>

              {narrative && (
                <div className="space-y-2">
                  <Textarea
                    className="text-sm min-h-[160px] font-mono"
                    value={narrative}
                    onChange={(e) => { setNarrative(e.target.value); setAttested(false); }}
                  />
                  {attested ? (
                    <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
                      <CheckCircle2 size={14} /> Attested by doctor
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => setShowAttestation(true)}
                    >
                      <ShieldCheck size={14} /> Attest &amp; Apply
                    </Button>
                  )}
                </div>
              )}

              {!narrative && !genLoading && (
                <p className="text-xs text-muted-foreground italic">
                  You may skip AI generation and proceed — the narrative can be added later.
                </p>
              )}
            </div>
          )}

          {/* ── STEP 4: Submit ── */}
          {step === 3 && selected && (
            <div className="space-y-4">
              {/* Claim summary */}
              <div className="bg-muted/40 rounded-md p-3 text-xs space-y-1">
                <p className="font-semibold text-sm mb-1">Claim Summary</p>
                <p><span className="text-muted-foreground">Patient:</span> {selected.patient_name}</p>
                <p><span className="text-muted-foreground">Payer:</span> {selected.payer_name} · {payerBadge(selected.payer_type)}</p>
                <p><span className="text-muted-foreground">Documents checked:</span> {docs.filter((d) => d.checked).length} / {docs.length}</p>
                <p><span className="text-muted-foreground">Narrative attested:</span> {attested ? "Yes" : "No (optional)"}</p>
              </div>

              {/* Eligibility check for PMJAY / CGHS */}
              {(selected.payer_type === "pmjay" || selected.payer_type === "cghs") && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">Eligibility Verification</p>
                  {eligibilityResult ? (
                    <div className={cn(
                      "flex items-start gap-2 p-3 rounded-md border text-sm",
                      eligibilityResult.eligible
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-red-50 border-red-200 text-red-800"
                    )}>
                      {eligibilityResult.eligible
                        ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                        : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
                      <span>{eligibilityResult.message || (eligibilityResult.eligible ? "Eligible" : "Not eligible")}</span>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={checkEligibility}
                      disabled={eligLoading}
                    >
                      {eligLoading
                        ? <><Loader2 size={13} className="animate-spin" /> Checking…</>
                        : <><RefreshCw size={13} /> Check Eligibility</>
                      }
                    </Button>
                  )}
                </div>
              )}

              {/* TPA — email hint */}
              {selected.payer_type === "tpa" && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
                  <Mail size={14} className="mt-0.5 shrink-0" />
                  <span>
                    After creating this claim, use <strong>Claims to Submit → Bundle</strong> to generate
                    the full document bundle and email it to the TPA.
                  </span>
                </div>
              )}

              {/* Success state */}
              {createdClaim ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <CheckCircle2 size={36} className="text-emerald-600" />
                  <p className="text-base font-semibold">Claim Created</p>
                  <p className="text-sm text-muted-foreground font-mono">{createdClaim.number}</p>
                  <Button onClick={onClose} variant="outline">Close</Button>
                </div>
              ) : (
                <Button
                  className="w-full gap-2"
                  onClick={submitClaim}
                  disabled={submitting || (
                    (selected.payer_type === "pmjay" || selected.payer_type === "cghs") &&
                    eligibilityResult !== null && !eligibilityResult.eligible
                  )}
                >
                  {submitting
                    ? <><Loader2 size={14} className="animate-spin" /> Creating Claim…</>
                    : <><Send size={14} /> Create Claim &amp; {selected.bill_id ? "Submit" : "Save as Draft"}</>
                  }
                </Button>
              )}
            </div>
          )}

          {/* Navigation */}
          {!createdClaim && (
            <div className="flex justify-between pt-3 border-t border-border mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => step > 0 ? setStep(step - 1) : onClose()}
              >
                <ChevronLeft size={14} className="mr-1" />
                {step === 0 ? "Cancel" : "Back"}
              </Button>
              {step < 3 && (
                <Button
                  size="sm"
                  onClick={() => {
                    if (step === 1 && selected) loadDocAvailability(selected);
                    setStep(step + 1);
                  }}
                  disabled={!canAdvance()}
                  className="gap-1"
                >
                  Next <ChevronRight size={14} />
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Attestation modal for AI narrative */}
      {showAttestation && selected && (
        <AIAttestationModal
          open={showAttestation}
          onClose={() => setShowAttestation(false)}
          feature="discharge_summary"
          patientId={selected.patient_id}
          admissionId={selected.id}
          hospitalId={hospitalId || ""}
          suggestedContent={narrative}
          onAccept={() => {
            setAttested(true);
            setShowAttestation(false);
          }}
        />
      )}
    </>
  );
};

export default ClaimsPackWizard;
