import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Printer, FileText, Mail, Sparkles, Save, ChevronRight,
  ChevronLeft, CheckCircle2, AlertTriangle, FileWarning, Scale,
  ShieldAlert, Upload, ExternalLink, RotateCcw, Clock,
} from "lucide-react";
import { callAI } from "@/lib/aiProvider";
import { useAIFeature } from "@/hooks/useAIFeature";
import { supabase } from "@/integrations/supabase/client";
import { differenceInDays, addDays, format } from "date-fns";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppealClaim {
  id: string;
  claim_number:          string | null;
  patient_name:          string;
  patient_id:            string;
  tpa_name:              string;
  claimed_amount:        number;
  denial_reason:         string | null;
  rejection_code:        string | null;
  rejection_notice_date: string | null;
  appeal_deadline:       string | null;
  appeal_submitted_at:   string | null;
  appeal_status:         string | null;
  policy_number:         string | null;
  bill_id:               string | null;
}

interface AppealLetterModalProps {
  open:             boolean;
  onOpenChange:     (open: boolean) => void;
  claim:            AppealClaim | null;
  hospitalId:       string;
  planTier:         string;
  onAppealSubmitted: () => void;
}

type AppealStep     = 1 | 2 | 3 | 4 | 5;
type AppealStrategy = "additional_docs" | "clinical_justification" | "rate_dispute" | "irdai_escalation";

// ── Constants ─────────────────────────────────────────────────────────────────

const REJECTION_LABELS: Record<string, string> = {
  not_medically_necessary: "Not Medically Necessary",
  policy_exclusion:        "Policy Exclusion",
  pre_auth_not_obtained:   "Pre-Auth Not Obtained",
  incorrect_icd_code:      "Incorrect ICD Code",
  document_deficiency:     "Document Deficiency",
  duplicate_claim:         "Duplicate Claim",
  other:                   "Other",
};

const REJECTION_ADVICE: Record<string, string> = {
  not_medically_necessary: "TPA claims the procedure was not clinically necessary. Prepare a detailed clinical necessity justification backed by specialist opinion and peer-reviewed protocols.",
  policy_exclusion:        "Review your empanelment agreement and the policy schedule. Many apparent exclusions are covered with the correct procedure or ICD code.",
  pre_auth_not_obtained:   "Check for pre-auth approval letter. If it was submitted but not linked, include the pre-auth reference and submission proof in your appeal.",
  incorrect_icd_code:      "Request a revised bill with the corrected ICD-10 code from the treating physician. A code correction is one of the strongest grounds for appeal.",
  document_deficiency:     "Gather all flagged missing documents: discharge summary, investigation reports, specialist referral letter. A complete file is the fastest path to approval.",
  duplicate_claim:         "Obtain unique claim identifiers from TPA. If genuinely not a duplicate, attach proof of original submission date and acknowledgement from TPA.",
  other:                   "Request the specific policy clause or IRDAI guideline cited in the rejection letter. TPAs are required to provide specific grounds under IRDAI (Health Insurance) Regulations.",
};

const REJECTION_STRATEGY_MAP: Record<string, AppealStrategy> = {
  not_medically_necessary: "clinical_justification",
  policy_exclusion:        "rate_dispute",
  pre_auth_not_obtained:   "additional_docs",
  incorrect_icd_code:      "additional_docs",
  document_deficiency:     "additional_docs",
  duplicate_claim:         "additional_docs",
  other:                   "clinical_justification",
};

const ADDITIONAL_DOCS_BY_CODE: Record<string, string[]> = {
  not_medically_necessary: ["Specialist referral letter", "Peer-reviewed clinical protocol", "Indoor case papers", "Consent form"],
  policy_exclusion:        ["TPA empanelment agreement", "Policy schedule copy", "IRDA circular reference"],
  pre_auth_not_obtained:   ["Pre-auth acknowledgement email/receipt", "TPA portal screenshot", "Treating doctor's admission note"],
  incorrect_icd_code:      ["Revised bill with corrected ICD code", "Physician certification of diagnosis", "Lab / imaging reports confirming diagnosis"],
  document_deficiency:     ["Complete discharge summary", "All investigation reports", "Referral letters", "Revised final bill"],
  duplicate_claim:         ["Original claim submission proof", "TPA acknowledgement for original claim", "Unique reference number letter"],
  other:                   ["All original documents", "Correspondence with TPA", "IRDAI complaint reference (if applicable)"],
};

const STEPS: { label: string; short: string }[] = [
  { label: "Review Denial",       short: "Review" },
  { label: "Select Strategy",     short: "Strategy" },
  { label: "Prepare Documents",   short: "Prepare" },
  { label: "Submit Appeal",       short: "Submit" },
  { label: "Track Response",      short: "Track" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function deadlineBadge(deadline: string | null): React.ReactNode {
  if (!deadline) return null;
  const days = differenceInDays(new Date(deadline), new Date());
  if (days < 0)   return <Badge className="bg-red-100 text-red-800 text-[11px]">⚠ Deadline PASSED ({Math.abs(days)}d ago)</Badge>;
  if (days <= 7)  return <Badge className="bg-red-100 text-red-800 text-[11px] animate-pulse">🔴 CRITICAL — {days}d left</Badge>;
  if (days <= 14) return <Badge className="bg-amber-100 text-amber-800 text-[11px]">⚠ {days} days left</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-800 text-[11px]">{days} days left</Badge>;
}

function printText(title: string, body: string) {
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return;
  w.document.write(`<html><head><title>${title}</title>
    <style>body{font-family:"Times New Roman",serif;padding:48px 60px;font-size:14px;line-height:1.85;white-space:pre-wrap}@media print{body{padding:20px 40px}}</style>
    </head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ── Main component ────────────────────────────────────────────────────────────

const AppealLetterModal: React.FC<AppealLetterModalProps> = ({
  open, onOpenChange, claim, hospitalId, planTier, onAppealSubmitted,
}) => {
  const __aiOn = useAIFeature("appeal_letter");
  const [step, setStep]           = useState<AppealStep>(1);
  const [strategy, setStrategy]   = useState<AppealStrategy | null>(null);
  const [letter, setLetter]       = useState("");
  const [irdaiText, setIrdaiText] = useState("");
  const [generating, setGenerating]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [appealResponse, setAppealResponse] = useState<"upheld" | "reversed" | "">("");
  const [appealResponseNotes, setAppealResponseNotes] = useState("");
  const [checkedDocs, setCheckedDocs]   = useState<Record<string, boolean>>({});
  // Rate dispute form
  const [disputePackage, setDisputePackage] = useState("");
  const [disputeHospRate, setDisputeHospRate] = useState("");
  const [disputeTpaRate, setDisputeTpaRate]   = useState("");
  const [disputeAuthority, setDisputeAuthority] = useState("");
  // Enriched patient/admission data fetched on open
  const [enriched, setEnriched] = useState<{
    dob?: string; admissionDate?: string; dischargeDate?: string;
    doctorName?: string; procedureCodes?: string[]; icd10Codes?: string;
    preAuthStatus?: string;
  }>({});

  const { toast } = useToast();
  const canUseAI = planTier !== "manual";

  // Reset on open
  useEffect(() => {
    if (open && claim) {
      setStep(1);
      setLetter("");
      setIrdaiText("");
      setCheckedDocs({});
      setAppealResponse("");
      setAppealResponseNotes("");
      // Auto-select recommended strategy
      setStrategy(claim.rejection_code ? REJECTION_STRATEGY_MAP[claim.rejection_code] ?? null : null);
      // Enrich from DB
      fetchEnrichedData(claim);
    }
  }, [open, claim?.id]);

  const fetchEnrichedData = async (c: AppealClaim) => {
    try {
      const [{ data: patient }, { data: admission }] = await Promise.all([
        supabase.from("patients").select("date_of_birth").eq("id", c.patient_id).maybeSingle(),
        c.bill_id
          ? (supabase as any).from("bills").select("admission_id").eq("id", c.bill_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      let admData: any = null;
      if (admission?.admission_id) {
        const { data } = await (supabase as any)
          .from("admissions")
          .select("admitted_at, discharged_at, doctor_name, procedure_codes, icd10_codes")
          .eq("id", admission.admission_id)
          .maybeSingle();
        admData = data;
      }
      const { data: preAuth } = await (supabase as any)
        .from("insurance_pre_auth")
        .select("status")
        .eq("admission_id", admission?.admission_id ?? "")
        .maybeSingle();

      setEnriched({
        dob:            patient?.date_of_birth ?? undefined,
        admissionDate:  admData?.admitted_at   ?? undefined,
        dischargeDate:  admData?.discharged_at  ?? undefined,
        doctorName:     admData?.doctor_name    ?? undefined,
        procedureCodes: admData?.procedure_codes ?? [],
        icd10Codes:     Array.isArray(admData?.icd10_codes)
          ? admData.icd10_codes.map((x: any) => x.code ?? x).join(", ")
          : admData?.icd10_codes ?? "",
        preAuthStatus:  preAuth?.status         ?? "Not found",
      });
    } catch { /* enrichment is best-effort */ }
  };

  if (!claim) return null;

  const recommendedStrategy = claim.rejection_code ? REJECTION_STRATEGY_MAP[claim.rejection_code] : null;
  const additionalDocs = ADDITIONAL_DOCS_BY_CODE[claim.rejection_code ?? "other"] ?? [];

  // ── AI generators ──────────────────────────────────────────────────────────

  const generateAppealLetter = async () => {
    if (!canUseAI) {
      toast({ title: "AI requires Plan B or higher", variant: "destructive" }); return;
    }
    setGenerating(true);
    const today = format(new Date(), "dd MMMM yyyy");
    const age = enriched.dob
      ? `${differenceInDays(new Date(), new Date(enriched.dob)) / 365 | 0} years`
      : "—";
    const admDate = enriched.admissionDate ? format(new Date(enriched.admissionDate), "dd MMM yyyy") : "—";
    const disDate = enriched.dischargeDate ? format(new Date(enriched.dischargeDate), "dd MMM yyyy") : "—";

    const prompt = `You are a senior TPA desk administrator with 25 years experience at Indian hospitals.
Generate a formal appeal letter for the following denied insurance claim.

Claim Number: ${claim.claim_number || "—"}
Patient: ${claim.patient_name}, Age: ${age}
TPA: ${claim.tpa_name}
Denial Reason: ${claim.denial_reason || REJECTION_LABELS[claim.rejection_code ?? ""] || "Not specified"}
Denied Amount: ₹${claim.claimed_amount.toLocaleString("en-IN")}

Procedure: ${(enriched.procedureCodes || []).join(", ") || "As clinically indicated"}
Diagnosis (ICD-10): ${enriched.icd10Codes || "As clinically indicated"}
Treating Doctor: ${enriched.doctorName || "[Treating Physician]"}
Dates of Treatment: ${admDate} to ${disDate}
Policy Number: ${claim.policy_number || "—"}

Pre-Auth Status: ${enriched.preAuthStatus || "—"}

Write a formal appeal letter dated ${today} addressing:
1. Why the denial reason (${REJECTION_LABELS[claim.rejection_code ?? ""] || claim.denial_reason || "given reason"}) is not applicable in this case
2. Clinical necessity evidence
3. Reference to specific policy terms that support coverage
4. Request for reconsideration within 30 days per IRDAI guidelines

Format: Formal letter, hospital letterhead placeholder [HOSPITAL NAME, REGISTRATION NO.], under 500 words.
Tone: Professional, assertive but respectful.
End with: space for Medical Director signature and hospital stamp.`;

    try {
      const result = await callAI({ featureKey: "appeal_letter", hospitalId, prompt, maxTokens: 1200 });
      if (result.error || !result.text) {
        setLetter(buildTemplateLetter(claim, today, age, admDate, disDate));
        toast({ title: "AI unavailable — template loaded", description: result.error, variant: "destructive" });
      } else {
        setLetter(result.text);
      }
    } catch {
      // Fallback template
      setLetter(buildTemplateLetter(claim, today, age, admDate, disDate));
    } finally {
      setGenerating(false);
    }
  };

  const generateIrdaiComplaint = async () => {
    setGenerating(true);
    const prompt = `Generate a formal IRDAI (Insurance Regulatory and Development Authority of India) consumer grievance complaint for the following denied claim.

Complainant Hospital: [HOSPITAL NAME, REGISTRATION NO., ADDRESS]
Patient: ${claim.patient_name}
TPA / Insurer: ${claim.tpa_name}
Policy Number: ${claim.policy_number || "—"}
Claim Number: ${claim.claim_number || "—"}
Denied Amount: ₹${claim.claimed_amount.toLocaleString("en-IN")}
Denial Reason: ${claim.denial_reason || "Not specified"}
Date of Rejection: ${claim.rejection_notice_date ? format(new Date(claim.rejection_notice_date), "dd/MM/yyyy") : "—"}
Appeal Submitted: Yes (TPA non-responsive for > 30 days)

Write a formal grievance complaint to IRDAI covering:
1. Facts of the case
2. Policy coverage scope
3. TPA's arbitrary / non-compliant denial
4. Non-response to internal appeal
5. Relief requested: claim settlement + interest + penalty on TPA
6. Documents enclosed (list)
7. Declaration of accuracy

Reference IRDAI (Protection of Policyholder's Interests) Regulations 2017, IRDAI (Health Insurance) Regulations 2016.
Format: Official complaint letter, under 600 words.`;

    try {
      const result = await callAI({ featureKey: "irdai_complaint", hospitalId, prompt, maxTokens: 1200 });
      if (result.error || !result.text) {
        setIrdaiText(buildIrdaiTemplate(claim));
        toast({ title: "AI unavailable — template loaded", description: result.error, variant: "destructive" });
      } else {
        setIrdaiText(result.text);
      }
    } catch {
      setIrdaiText(buildIrdaiTemplate(claim));
    } finally {
      setGenerating(false);
    }
  };

  // ── Submit appeal ──────────────────────────────────────────────────────────

  const submitAppeal = async () => {
    setSaving(true);
    try {
      const updatePayload: Record<string, any> = {
        status:              "appeal_submitted",
        appeal_submitted_at: new Date().toISOString(),
        appeal_status:       "submitted",
      };
      if (letter) updatePayload.appeal_letter = letter;

      await (supabase as any).from("insurance_claims").update(updatePayload).eq("id", claim.id);
      toast({ title: "Appeal submitted ✓", description: "Claim status updated to appeal_submitted." });
      setStep(5);
    } catch (e: any) {
      toast({ title: "Failed to save appeal", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveAppealResponse = async () => {
    if (!appealResponse) {
      toast({ title: "Select TPA appeal outcome", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const newStatus = appealResponse === "reversed" ? "submitted" : "rejected"; // reversed = send for re-processing
      await (supabase as any).from("insurance_claims").update({
        appeal_status: appealResponse,
        status:        newStatus,
        denial_reason: appealResponse === "upheld" ? (claim.denial_reason + " [Appeal upheld]") : claim.denial_reason,
      }).eq("id", claim.id);
      toast({ title: `Appeal response recorded: ${appealResponse}` });
      onAppealSubmitted();
    } catch (e: any) {
      toast({ title: "Failed to save response", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Scale size={16} className="text-primary" />
            Denial Management — {claim.claim_number || "—"} · {claim.tpa_name}
          </DialogTitle>
          {/* Step progress */}
          <div className="flex items-center gap-0 mt-2">
            {STEPS.map((s, i) => {
              const n = (i + 1) as AppealStep;
              const active = step === n;
              const done   = step > n;
              return (
                <React.Fragment key={n}>
                  <button
                    onClick={() => done && setStep(n)}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                      active ? "bg-primary text-primary-foreground" : done ? "text-primary cursor-pointer hover:bg-primary/10" : "text-muted-foreground"
                    )}
                  >
                    {done ? <CheckCircle2 size={11} /> : <span className="w-4 h-4 rounded-full border text-center text-[10px] leading-[14px]">{n}</span>}
                    <span className="hidden sm:inline">{s.short}</span>
                  </button>
                  {i < STEPS.length - 1 && <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
                </React.Fragment>
              );
            })}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ─────── STEP 1: Review Denial ─────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-lg bg-red-50 border border-red-200 p-4 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                    <FileWarning size={15} /> Denial Details
                  </h4>
                  {deadlineBadge(claim.appeal_deadline)}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <div><span className="text-muted-foreground">Claim #:</span> <span className="font-mono font-medium">{claim.claim_number || "—"}</span></div>
                  <div><span className="text-muted-foreground">Denied Amount:</span> <strong>₹{claim.claimed_amount.toLocaleString("en-IN")}</strong></div>
                  <div><span className="text-muted-foreground">Patient:</span> {claim.patient_name}</div>
                  <div><span className="text-muted-foreground">Policy #:</span> {claim.policy_number || "—"}</div>
                  {claim.rejection_notice_date && (
                    <div><span className="text-muted-foreground">Rejection Notice:</span> {format(new Date(claim.rejection_notice_date), "dd/MM/yyyy")}</div>
                  )}
                  {claim.appeal_deadline && (
                    <div><span className="text-muted-foreground">Appeal Deadline:</span> <strong>{format(new Date(claim.appeal_deadline), "dd MMM yyyy")}</strong></div>
                  )}
                </div>
                {claim.rejection_code && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Rejection Code: </span>
                    <Badge variant="outline" className="text-[10px] text-red-700 border-red-300">{REJECTION_LABELS[claim.rejection_code]}</Badge>
                  </div>
                )}
                {claim.denial_reason && (
                  <p className="text-xs text-red-700"><span className="font-semibold">TPA Reason: </span>{claim.denial_reason}</p>
                )}
              </div>

              {/* Auto advice */}
              {claim.rejection_code && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-1">
                  <p className="text-xs font-semibold text-blue-800">💡 Recommended Action</p>
                  <p className="text-xs text-blue-700">{REJECTION_ADVICE[claim.rejection_code]}</p>
                </div>
              )}

              {/* Enriched clinical data */}
              {(enriched.doctorName || enriched.admissionDate) && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                  <p className="text-xs font-semibold mb-1">Clinical Context (fetched from records)</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground">
                    {enriched.doctorName   && <div><span>Treating Doctor: </span><span className="text-foreground">{enriched.doctorName}</span></div>}
                    {enriched.admissionDate && <div><span>Admitted: </span><span className="text-foreground">{format(new Date(enriched.admissionDate), "dd/MM/yyyy")}</span></div>}
                    {enriched.dischargeDate && <div><span>Discharged: </span><span className="text-foreground">{format(new Date(enriched.dischargeDate), "dd/MM/yyyy")}</span></div>}
                    {enriched.preAuthStatus && <div><span>Pre-Auth Status: </span><span className="text-foreground capitalize">{enriched.preAuthStatus}</span></div>}
                    {enriched.icd10Codes    && <div className="col-span-2"><span>ICD-10: </span><span className="text-foreground font-mono">{enriched.icd10Codes}</span></div>}
                  </div>
                </div>
              )}

              <Button className="w-full gap-1.5" onClick={() => setStep(2)}>
                Continue to Strategy Selection <ChevronRight size={14} />
              </Button>
            </div>
          )}

          {/* ─────── STEP 2: Select Strategy ─────── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Choose the appeal strategy that best addresses the denial reason. The recommended strategy is highlighted.</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: "additional_docs",      icon: <Upload size={18} />,      label: "Additional Documents",   desc: "Gather & attach missing or corrected documents" },
                  { id: "clinical_justification", icon: <FileText size={18} />,  label: "Clinical Justification", desc: canUseAI ? "AI generates a medical necessity appeal letter" : "Build a clinical justification (manual)" },
                  { id: "rate_dispute",          icon: <Scale size={18} />,       label: "Rate Dispute",           desc: "Dispute underpayment or incorrect rate applied by TPA" },
                  { id: "irdai_escalation",      icon: <ShieldAlert size={18} />, label: "IRDAI Escalation",       desc: "Generate formal IRDAI complaint if TPA is non-responsive > 30 days" },
                ] as { id: AppealStrategy; icon: React.ReactNode; label: string; desc: string }[]).map(s => {
                  const selected   = strategy === s.id;
                  const recommended = recommendedStrategy === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setStrategy(s.id)}
                      className={cn(
                        "text-left p-3 rounded-lg border-2 transition-all space-y-1",
                        selected   ? "border-primary bg-primary/5"       : "border-border hover:border-border/60",
                        recommended && !selected ? "border-blue-300 bg-blue-50/50" : ""
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className={cn("", selected ? "text-primary" : "text-muted-foreground")}>{s.icon}</span>
                        {recommended && <Badge className="text-[9px] bg-blue-100 text-blue-700 border-blue-300">Recommended</Badge>}
                      </div>
                      <p className="text-sm font-semibold">{s.label}</p>
                      <p className="text-[11px] text-muted-foreground leading-snug">{s.desc}</p>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-1.5" onClick={() => setStep(1)}><ChevronLeft size={14} /> Back</Button>
                <Button className="gap-1.5 flex-1" disabled={!strategy} onClick={() => setStep(3)}>
                  Proceed with {strategy ? { additional_docs: "Additional Documents", clinical_justification: "Clinical Justification", rate_dispute: "Rate Dispute", irdai_escalation: "IRDAI Escalation" }[strategy] : "selected strategy"}
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {/* ─────── STEP 3: Prepare Documents ─────── */}
          {step === 3 && (
            <div className="space-y-4">

              {/* Additional Documents */}
              {strategy === "additional_docs" && (
                <>
                  <div>
                    <p className="text-sm font-semibold mb-2">Documents to gather for this appeal</p>
                    <div className="rounded-lg border border-border divide-y divide-border">
                      {additionalDocs.map(doc => (
                        <label key={doc} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40">
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={!!checkedDocs[doc]}
                            onChange={e => setCheckedDocs(p => ({ ...p, [doc]: e.target.checked }))}
                          />
                          <span className="text-sm">{doc}</span>
                          {checkedDocs[doc] && <CheckCircle2 size={14} className="ml-auto text-emerald-600 shrink-0" />}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {Object.values(checkedDocs).filter(Boolean).length} / {additionalDocs.length} documents ready
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-semibold">Cover note for additional documents</Label>
                    <Textarea
                      className="mt-1 text-sm" rows={4}
                      placeholder="Brief note explaining the additional documents and how they address the denial..."
                      value={letter}
                      onChange={e => setLetter(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Clinical Justification */}
              {strategy === "clinical_justification" && (
                <>
                  {!letter && !generating && (
                    <div className="flex flex-col items-center justify-center py-8 gap-3 border border-dashed border-violet-200 rounded-lg bg-violet-50/30">
                      <Sparkles size={28} className="text-violet-400" />
                      <p className="text-sm text-muted-foreground">
                        {canUseAI ? "Generate an AI-powered appeal letter with the improved clinical prompt" : "Build your appeal letter manually below"}
                      </p>
                      {canUseAI && (
                        <Button hidden={!__aiOn} onClick={generateAppealLetter} className="gap-1.5 bg-violet-600 hover:bg-violet-700">
                          <Sparkles size={14} /> Generate AI Appeal Letter
                        </Button>
                      )}
                    </div>
                  )}
                  {generating && (
                    <div className="flex items-center gap-3 justify-center py-8 text-muted-foreground">
                      <Loader2 size={22} className="animate-spin text-violet-600" />
                      <span className="text-sm">AI writing appeal letter…</span>
                    </div>
                  )}
                  {(letter || !canUseAI) && !generating && (
                    <>
                      <Textarea
                        value={letter}
                        onChange={e => setLetter(e.target.value)}
                        className="min-h-[280px] text-[13px] leading-relaxed font-mono"
                        placeholder="Type or paste your appeal letter here…"
                      />
                      <div className="flex gap-2 flex-wrap">
                        {canUseAI && (
                          <Button size="sm" variant="outline" className="gap-1.5 text-violet-700 border-violet-300 hover:bg-violet-50" hidden={!__aiOn} onClick={generateAppealLetter}>
                            <RotateCcw size={12} /> Regenerate
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => printText(`Appeal Letter — ${claim.claim_number}`, letter)}>
                          <Printer size={12} /> Print
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { navigator.clipboard.writeText(letter); toast({ title: "Copied" }); }}>
                          <FileText size={12} /> Copy
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => toast({ title: "Email requires SMTP configuration" })}>
                          <Mail size={12} /> Email to TPA
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Rate Dispute */}
              {strategy === "rate_dispute" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Fill in the rate details to build a dispute letter.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm font-semibold">Package / Procedure Name</Label>
                      <Input className="mt-1" value={disputePackage} onChange={e => setDisputePackage(e.target.value)} placeholder="e.g. CABG, Appendectomy" />
                    </div>
                    <div>
                      <Label className="text-sm font-semibold">Hospital Charged Rate (₹)</Label>
                      <Input className="mt-1" type="number" value={disputeHospRate} onChange={e => setDisputeHospRate(e.target.value)} placeholder="0" />
                    </div>
                    <div>
                      <Label className="text-sm font-semibold">TPA Approved Rate (₹)</Label>
                      <Input className="mt-1" type="number" value={disputeTpaRate} onChange={e => setDisputeTpaRate(e.target.value)} placeholder="0" />
                    </div>
                    <div>
                      <Label className="text-sm font-semibold">Rate Authority / Reference</Label>
                      <Input className="mt-1" value={disputeAuthority} onChange={e => setDisputeAuthority(e.target.value)} placeholder="e.g. NPPA rates, Empanelment agreement" />
                    </div>
                  </div>
                  {disputeHospRate && disputeTpaRate && Number(disputeHospRate) > Number(disputeTpaRate) && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800">
                      Rate shortfall: <strong>₹{(Number(disputeHospRate) - Number(disputeTpaRate)).toLocaleString("en-IN")}</strong> per procedure
                    </div>
                  )}
                  <Textarea
                    value={letter}
                    onChange={e => setLetter(e.target.value)}
                    className="min-h-[200px] text-[13px] font-mono"
                    placeholder="Rate dispute letter / notes…"
                  />
                  {canUseAI && (
                    <Button
                      size="sm"
                      className="gap-1.5 bg-violet-600 hover:bg-violet-700"
                      disabled={generating || !disputePackage}
                      onClick={async () => {
                        setGenerating(true);
                        const prompt = `Generate a formal rate dispute letter for an insurance claim.
Package: ${disputePackage}, Hospital rate: ₹${disputeHospRate}, TPA approved: ₹${disputeTpaRate}.
Rate authority: ${disputeAuthority || "NPPA published rates and empanelment agreement"}.
TPA: ${claim.tpa_name}, Patient: ${claim.patient_name}, Claim: ${claim.claim_number}.
Request settlement at hospital rates citing empanelment agreement obligations.
Formal letter, under 300 words.`;
                        try {
                          const r = await callAI({ featureKey: "rate_dispute_letter", hospitalId, prompt, maxTokens: 600 });
                          if (r.error || !r.text) {
                            toast({ title: "AI failed, write manually", description: r.error, variant: "destructive" });
                          } else {
                            setLetter(r.text);
                          }
                        } catch { toast({ title: "AI failed, write manually", variant: "destructive" }); }
                        finally { setGenerating(false); }
                      }}
                    >
                      {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      Generate Rate Dispute Letter
                    </Button>
                  )}
                </div>
              )}

              {/* IRDAI Escalation */}
              {strategy === "irdai_escalation" && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1">
                    <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                      <ShieldAlert size={13} /> Use IRDAI escalation only if TPA has been non-responsive for &gt; 30 days after internal appeal
                    </p>
                    <a
                      href="https://bimabharosa.irdai.gov.in/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-700 underline flex items-center gap-1"
                    >
                      <ExternalLink size={11} /> IRDAI Bima Bharosa Grievance Portal
                    </a>
                  </div>
                  {!irdaiText && !generating && (
                    <Button hidden={!__aiOn} onClick={generateIrdaiComplaint} className="gap-1.5 w-full">
                      {canUseAI ? <><Sparkles size={14} /> Generate IRDAI Complaint (AI)</> : "Build IRDAI Complaint"}
                    </Button>
                  )}
                  {generating && (
                    <div className="flex items-center gap-2 justify-center py-6 text-muted-foreground">
                      <Loader2 size={18} className="animate-spin" />
                      <span className="text-sm">Generating complaint…</span>
                    </div>
                  )}
                  {irdaiText && !generating && (
                    <>
                      <Textarea
                        value={irdaiText}
                        onChange={e => setIrdaiText(e.target.value)}
                        className="min-h-[260px] text-[13px] font-mono leading-relaxed"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => printText("IRDAI Complaint", irdaiText)}>
                          <Printer size={12} /> Print
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { navigator.clipboard.writeText(irdaiText); toast({ title: "Copied" }); }}>
                          <FileText size={12} /> Copy
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5" hidden={!__aiOn} onClick={generateIrdaiComplaint}>
                          <RotateCcw size={12} /> Regenerate
                        </Button>
                        <a
                          href="https://bimabharosa.irdai.gov.in/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-blue-700 border border-blue-200 rounded-md px-2 py-1 hover:bg-blue-50 ml-auto"
                        >
                          <ExternalLink size={11} /> File on IRDAI Portal
                        </a>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="gap-1.5" onClick={() => setStep(2)}><ChevronLeft size={14} /> Back</Button>
                <Button className="gap-1.5 flex-1" onClick={() => setStep(4)}>
                  Continue to Submit <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {/* ─────── STEP 4: Submit Appeal ─────── */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-semibold">Appeal Summary</p>
                <div className="text-xs space-y-1 text-muted-foreground">
                  <div><span>Strategy: </span><span className="text-foreground font-medium capitalize">{strategy?.replace(/_/g, " ")}</span></div>
                  <div><span>Documents ready: </span><span className="text-foreground">{Object.values(checkedDocs).filter(Boolean).length} checked</span></div>
                  <div><span>Letter prepared: </span><span className={letter ? "text-emerald-700" : "text-amber-700"}>{letter ? "✓ Yes" : "⚠ Not yet"}</span></div>
                  {claim.appeal_deadline && (
                    <div><span>Deadline: </span><span className="text-foreground font-medium">{format(new Date(claim.appeal_deadline), "dd MMM yyyy")}</span> {deadlineBadge(claim.appeal_deadline)}</div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                <p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={13} /> Before marking as submitted:</p>
                <ul className="ml-3 space-y-0.5 list-disc">
                  <li>Print / email the appeal letter to {claim.tpa_name}</li>
                  <li>Attach all supporting documents</li>
                  <li>Send via registered post or TPA portal with proof of submission</li>
                  <li>Note the submission date and TPA acknowledgement number</li>
                </ul>
              </div>

              {claim.appeal_submitted_at ? (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">
                  <CheckCircle2 size={16} />
                  Appeal already submitted on {format(new Date(claim.appeal_submitted_at), "dd MMM yyyy")}
                </div>
              ) : (
                <Button
                  className="w-full gap-1.5"
                  onClick={submitAppeal}
                  disabled={saving}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Mark Appeal as Submitted
                </Button>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="gap-1.5" onClick={() => setStep(3)}><ChevronLeft size={14} /> Back to Documents</Button>
                {claim.appeal_submitted_at && (
                  <Button className="gap-1.5 flex-1" onClick={() => setStep(5)}>Track Response <ChevronRight size={14} /></Button>
                )}
              </div>
            </div>
          )}

          {/* ─────── STEP 5: Track Response ─────── */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-1 text-xs">
                <p className="font-semibold text-sm mb-2">Appeal Timeline</p>
                <div className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /><span>Claim submitted: {claim.appeal_submitted_at ? format(new Date(claim.appeal_submitted_at), "dd MMM yyyy") : "—"}</span></div>
                <div className="flex items-center gap-2"><Clock size={13} className="text-blue-500" /><span>Appeal submitted: {claim.appeal_submitted_at ? format(new Date(claim.appeal_submitted_at), "dd MMM yyyy") : "—"}</span></div>
                <div className="flex items-center gap-2 text-muted-foreground"><Clock size={13} /><span>Awaiting TPA response (IRDAI mandates 30 days)</span></div>
              </div>

              {/* IRDAI escalation reminder */}
              {claim.appeal_submitted_at && differenceInDays(new Date(), new Date(claim.appeal_submitted_at)) > 30 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={13} /> TPA non-responsive for &gt; 30 days</p>
                  <p>You may escalate to IRDAI. Go back to Step 3 → IRDAI Escalation strategy.</p>
                  <a href="https://bimabharosa.irdai.gov.in/" target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-1">
                    <ExternalLink size={11} /> File grievance on IRDAI Bima Bharosa Portal
                  </a>
                </div>
              )}

              {/* Record TPA appeal response */}
              {claim.appeal_status !== "upheld" && claim.appeal_status !== "reversed" && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold">Record TPA Response to Appeal</p>
                  <div className="flex gap-2">
                    {(["reversed", "upheld"] as const).map(r => (
                      <button
                        key={r}
                        onClick={() => setAppealResponse(r)}
                        className={cn(
                          "flex-1 py-2.5 rounded-lg border-2 text-sm font-medium transition-all",
                          appealResponse === r
                            ? r === "reversed"
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-red-500 bg-red-50 text-red-700"
                            : "border-border hover:border-border/60"
                        )}
                      >
                        {r === "reversed" ? "✅ TPA Reversed — Claim Approved" : "❌ TPA Upheld Denial"}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    className="text-sm" rows={3}
                    placeholder="Notes on TPA response (reference number, reasons, next steps)…"
                    value={appealResponseNotes}
                    onChange={e => setAppealResponseNotes(e.target.value)}
                  />
                  <Button
                    className="w-full gap-1.5"
                    disabled={!appealResponse || saving}
                    onClick={saveAppealResponse}
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save TPA Appeal Response
                  </Button>
                </div>
              )}

              {(claim.appeal_status === "upheld" || claim.appeal_status === "reversed") && (
                <div className={cn(
                  "rounded-lg p-3 text-sm flex items-center gap-2",
                  claim.appeal_status === "reversed" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
                )}>
                  {claim.appeal_status === "reversed" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  Appeal outcome: <strong className="capitalize">{claim.appeal_status}</strong>
                  {claim.appeal_status === "upheld" && " — Consider IRDAI escalation or write-off."}
                  {claim.appeal_status === "reversed" && " — Claim re-submitted for processing."}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Fallback templates ────────────────────────────────────────────────────────

function buildTemplateLetter(
  claim: AppealClaim, today: string, age: string, admDate: string, disDate: string,
): string {
  return `Date: ${today}

To,
The Claims Manager,
${claim.tpa_name}
[TPA Address]

Subject: Formal Appeal for Reconsideration — Claim No. ${claim.claim_number || "N/A"}

Dear Sir / Madam,

We write to formally appeal the rejection of the above claim. Patient ${claim.patient_name} (Age: ${age}) was admitted on ${admDate} and discharged on ${disDate}. The claimed amount of ₹${claim.claimed_amount.toLocaleString("en-IN")} represents the actual cost of medically necessary treatment.

DENIAL REASON CITED BY TPA:
${claim.denial_reason || "Not specified"}

GROUNDS FOR APPEAL:

1. Medical Necessity: The treatment was clinically indicated and consistent with peer-reviewed medical protocols. The treating physician has certified the necessity of the procedure.

2. Policy Coverage: A review of the policy terms indicates that this procedure falls within the scope of coverage. We request you to cite the specific exclusion clause applied.

3. IRDAI Compliance: Under IRDAI (Health Insurance) Regulations 2016, the insurer must settle claims within 30 days of receiving the last required document. Non-compliance attracts penal interest.

REQUEST:
We respectfully request full settlement of ₹${claim.claimed_amount.toLocaleString("en-IN")} within 15 working days. Additional supporting documents are enclosed.

Yours sincerely,

Dr. [Medical Director]
[Hospital Name & Registration Number]
[Contact Number]`;
}

function buildIrdaiTemplate(claim: AppealClaim): string {
  return `To,
The Grievance Cell,
Insurance Regulatory and Development Authority of India (IRDAI)
Sy No. 115/1, Financial District, Nanakramguda, Hyderabad — 500 032

Subject: Grievance against ${claim.tpa_name} — Wrongful Denial of Cashless/Reimbursement Claim

Complainant: [Hospital Name, Registration No., Address]
Policy Holder / Patient: ${claim.patient_name}
TPA / Insurer: ${claim.tpa_name}
Policy Number: ${claim.policy_number || "[POLICY NUMBER]"}
Claim Number: ${claim.claim_number || "[CLAIM NUMBER]"}
Denied Amount: ₹${claim.claimed_amount.toLocaleString("en-IN")}

Dear Sir / Madam,

FACTS:
1. The above patient was admitted for treatment requiring insurance coverage under the above policy.
2. The claim was submitted with all required documents.
3. ${claim.tpa_name} rejected the claim citing: "${claim.denial_reason || "reasons not clearly communicated"}".
4. A formal appeal was submitted but the TPA has not responded within the IRDAI-mandated 30 days.

RELIEF REQUESTED:
1. Direction to ${claim.tpa_name} to settle the claim of ₹${claim.claimed_amount.toLocaleString("en-IN")} with interest at 2% per month from date of submission.
2. Penalty on TPA for violation of IRDAI (Protection of Policyholder's Interests) Regulations 2017.
3. Directions to TPA to respond to appeals within statutory timelines.

ENCLOSURES:
1. Original claim documents
2. Rejection letter from TPA
3. Formal appeal letter with proof of submission
4. Medical records and discharge summary

Declaration: All facts stated are true and correct to the best of my knowledge.

[Authorised Signatory]
[Designation]
[Hospital Name & Stamp]
[Date]`;
}

export default AppealLetterModal;
