import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import { autoPostJournalEntry } from "@/lib/accounting";

/** Resolve the current app user id (for journal posted_by). Best-effort. */
async function currentAppUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";
  const { data } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
  return (data as any)?.id ?? "";
}

/**
 * Reclassify a raised claim's receivable from the patient to the insurer:
 * Dr AR-Insurance/TPA / Cr AR-Patients. Posted once per claim when it is
 * submitted (never for drafts) so the insurer receivable appears in the GL.
 */
async function postClaimReclass(hospitalId: string, claimId: string, patientName: string, amount: number, postedBy: string) {
  if (!amount || amount <= 0) return;
  await autoPostJournalEntry({
    triggerEvent: "insurance_claim_raised",
    sourceModule: "insurance",
    sourceId: claimId,
    amount,
    description: `Insurance claim raised - ${patientName}`,
    hospitalId,
    postedBy,
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubmissionMode = "manual" | "ai_assisted" | "automated";

export interface PreAuthContext {
  patientName?:    string;
  tpaName?:        string;
  diagnosisCodes?: string;
  procedureCodes?: string;
  estimatedAmount?: number;
  notes?:          string;
  policyNumber?:   string;
}

export interface ClaimSubmitData {
  bill_id:     string;
  patient_id:  string;
  tpa_name:    string;
  total_amount: number;
  denial_risk:  number;
  patient_name: string;
  bill_number:  string;
  has_pre_auth: boolean;
  admission_id?: string | null;
  ai_score?:    number;
}

export interface SubmissionResult {
  success:              boolean;
  mode:                 SubmissionMode;
  tpaReferenceNumber?:  string;
  claimNumber?:         string;
  submissionMode?:      string;
  message:              string;
}

export interface CoverLetterState {
  open:        boolean;
  text:        string;
  preAuthId:   string | null;
  claimData:   ClaimSubmitData & { claimId?: string; claimNumber?: string } | null;
  entityMode:  "preauth" | "claim";
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useInsuranceSubmission(hospitalId: string) {
  const [submitting, setSubmitting]   = useState(false);
  const [progress, setProgress]       = useState("");
  const [result, setResult]           = useState<SubmissionResult | null>(null);
  const [coverLetter, setCoverLetter] = useState<CoverLetterState>({
    open:       false,
    text:       "",
    preAuthId:  null,
    claimData:  null,
    entityMode: "preauth",
  });

  const { toast } = useToast();

  // ── AI helpers ─────────────────────────────────────────────────────────────

  async function generatePreAuthCoverLetter(
    preAuthId: string,
    ctx: PreAuthContext,
  ): Promise<string> {
    const prompt = `Generate a professional insurance pre-authorization cover letter for an Indian private hospital.

Patient: ${ctx.patientName ?? "Patient"}
TPA / Insurer: ${ctx.tpaName ?? "Insurance Company"}
Policy Number: ${ctx.policyNumber ?? "—"}
Procedures: ${ctx.procedureCodes ?? "As clinically indicated"}
Diagnosis (ICD-10): ${ctx.diagnosisCodes ?? "As clinically indicated"}
Estimated Amount: ₹${ctx.estimatedAmount?.toLocaleString("en-IN") ?? "0"}
Clinical Justification: ${ctx.notes ?? "Medically necessary procedure."}

Write a complete formal letter with:
1. Hospital letterhead placeholder [HOSPITAL NAME, ADDRESS, REGISTRATION NO.]
2. Date and TPA address block
3. Subject: "Request for Pre-Authorization of Medical Treatment"
4. Patient details paragraph (name, policy no., treatment)
5. Clinical necessity justification (2-3 paragraphs)
6. Procedure and cost breakdown
7. Request for approval within IRDAI-mandated 60 minutes
8. Closing with authorized signatory placeholder
9. Enclosures list

Pre-Auth Reference: ${preAuthId}`;

    const res = await callAI({
      featureKey:  "pre_auth_cover_letter",
      hospitalId,
      prompt,
      maxTokens:   1200,
    });
    return res.text;
  }

  async function generateClaimCoverLetter(
    row: ClaimSubmitData,
    claimNumber: string,
  ): Promise<string> {
    const prompt = `Generate a professional insurance claim submission cover letter for an Indian private hospital.

Patient: ${row.patient_name}
TPA / Insurer: ${row.tpa_name}
Bill Number: ${row.bill_number}
Claim Number: ${claimNumber}
Claimed Amount: ₹${row.total_amount.toLocaleString("en-IN")}
Pre-Auth Status: ${row.has_pre_auth ? "Approved" : "Pending"}

Write a complete formal letter with:
1. Hospital letterhead placeholder [HOSPITAL NAME, ADDRESS, REGISTRATION NO.]
2. Date and TPA address block
3. Subject: "Claim Submission for Medical Treatment — Claim No. ${claimNumber}"
4. Patient and admission details
5. Treatment summary paragraph
6. Bill summary (total claimed: ₹${row.total_amount.toLocaleString("en-IN")})
7. List of enclosed documents (discharge summary, bills, lab reports, pre-auth approval if available)
8. Payment request within 30 days as per IRDAI guidelines
9. Authorized signatory placeholder

Claim Reference: ${claimNumber}`;

    const res = await callAI({
      featureKey:  "claim_cover_letter",
      hospitalId,
      prompt,
      maxTokens:   1000,
    });
    return res.text;
  }

  // ── submitPreAuth ──────────────────────────────────────────────────────────

  /**
   * Submit a pre-auth in one of three modes.
   *
   * - manual:       UPDATE status='submitted', submission_mode='manual'
   * - ai_assisted:  Generate AI cover letter → open modal; caller must
   *                 call confirmCoverLetterSubmitted() after user downloads
   * - automated:    Invoke submit-pre-auth-hcx edge function
   *
   * For ai_assisted, returns null (UI flow continues via coverLetter state).
   */
  const submitPreAuth = async (
    preAuthId: string,
    mode: SubmissionMode,
    ctx: PreAuthContext = {},
  ): Promise<SubmissionResult | null> => {
    if (!preAuthId) return null;
    setSubmitting(true);
    setResult(null);

    try {
      // ─ Manual ──────────────────────────────────────────────────────────────
      if (mode === "manual") {
        setProgress("Marking as submitted…");
        const { error } = await (supabase as any)
          .from("insurance_pre_auth")
          .update({
            status:          "submitted",
            submitted_at:    new Date().toISOString(),
            submission_mode: "manual",
          })
          .eq("id", preAuthId);

        if (error) throw new Error(error.message);

        const r: SubmissionResult = {
          success:         true,
          mode,
          submissionMode:  "manual",
          message:         "Pre-auth marked as submitted. Upload documents to TPA portal.",
        };
        setResult(r);
        toast({
          title:       "Pre-auth submitted ✓",
          description: "📤 Remember to upload documents to the TPA portal or send by email.",
        });
        return r;
      }

      // ─ AI Assisted ─────────────────────────────────────────────────────────
      if (mode === "ai_assisted") {
        setProgress("Generating AI cover letter…");
        const text = await generatePreAuthCoverLetter(preAuthId, ctx);
        setCoverLetter({ open: true, text, preAuthId, claimData: null, entityMode: "preauth" });
        setProgress("");
        // DB update deferred to confirmCoverLetterSubmitted()
        return null;
      }

      // ─ Automated ───────────────────────────────────────────────────────────
      setProgress("Connecting to TPA API…");
      const { data, error } = await supabase.functions.invoke("submit-pre-auth-hcx", {
        body: { pre_auth_id: preAuthId, hospital_id: hospitalId },
      });

      if (error) throw new Error(error.message ?? "Edge function error");
      if (!data?.success) throw new Error(data?.message ?? "Submission failed");

      const r: SubmissionResult = {
        success:             true,
        mode,
        submissionMode:      "automated",
        tpaReferenceNumber:  data.tpa_reference_number,
        message:             data.message,
      };
      setResult(r);
      toast({
        title:       "Pre-auth auto-submitted ✓",
        description: `TPA Reference: ${data.tpa_reference_number}`,
      });
      return r;
    } catch (e: any) {
      const r: SubmissionResult = { success: false, mode, message: e.message };
      setResult(r);
      toast({ title: "Submission failed", description: e.message, variant: "destructive" });
      return r;
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  // ── confirmCoverLetterSubmitted (ai_assisted post-download) ────────────────

  const confirmCoverLetterSubmitted = async (): Promise<void> => {
    const { preAuthId, claimData, entityMode } = coverLetter;

    if (entityMode === "preauth" && preAuthId) {
      await (supabase as any).from("insurance_pre_auth").update({
        status:          "submitted",
        submitted_at:    new Date().toISOString(),
        submission_mode: "ai_assisted",
      }).eq("id", preAuthId);
      const r: SubmissionResult = {
        success: true, mode: "ai_assisted", submissionMode: "ai_assisted",
        message: "Pre-auth marked as submitted.",
      };
      setResult(r);
      toast({ title: "Pre-auth submitted ✓" });
    }

    if (entityMode === "claim" && claimData?.claimId) {
      await (supabase as any).from("insurance_claims").update({
        status:          "submitted",
        submitted_at:    new Date().toISOString(),
        submission_mode: "ai_assisted",
      }).eq("id", claimData.claimId);
      // Reclass to insurer AR now that the draft claim is actually submitted.
      const postedBy = await currentAppUserId();
      await postClaimReclass(hospitalId, claimData.claimId, claimData.patient_name, claimData.total_amount, postedBy);
      const r: SubmissionResult = {
        success: true, mode: "ai_assisted", submissionMode: "ai_assisted",
        claimNumber: claimData.claimNumber,
        message:     `Claim ${claimData.claimNumber} marked as submitted.`,
      };
      setResult(r);
      toast({ title: `Claim ${claimData.claimNumber} submitted ✓` });
    }

    setCoverLetter(prev => ({ ...prev, open: false }));
  };

  // ── submitClaim ────────────────────────────────────────────────────────────

  /**
   * Submit a claim in one of three modes.
   * Requires AI review score to have been run (enforced by the caller UI).
   */
  const submitClaim = async (
    row: ClaimSubmitData,
    mode: SubmissionMode,
  ): Promise<SubmissionResult | null> => {
    setSubmitting(true);
    setResult(null);

    const finalRisk = row.ai_score ?? row.denial_risk;
    let claimNumber = "";

    try {
      // Atomic, gap-free claim number via the shared per-hospital sequence —
      // never Math.random() (collision-prone) or SELECT MAX+1.
      const { data: seq } = await supabase.rpc("next_seq", { p_hospital_id: hospitalId, p_type: "claim" });
      claimNumber = `CLM-${new Date().getFullYear()}-${String(seq ?? Date.now()).padStart(5, "0")}`;
      const postedBy = await currentAppUserId();
      // ─ Manual ──────────────────────────────────────────────────────────────
      if (mode === "manual") {
        setProgress("Recording claim…");
        const { data: claimRow, error } = await (supabase as any).from("insurance_claims").insert({
          hospital_id:        hospitalId,
          bill_id:            row.bill_id,
          patient_id:         row.patient_id,
          tpa_name:           row.tpa_name,
          claim_number:       claimNumber,
          claimed_amount:     row.total_amount,
          status:             "submitted",
          submitted_at:       new Date().toISOString(),
          submission_mode:    "manual",
          ai_denial_risk_score: finalRisk,
        }).select("id").maybeSingle();
        if (error) throw new Error(error.message);
        if (claimRow?.id) await postClaimReclass(hospitalId, claimRow.id, row.patient_name, row.total_amount, postedBy);

        const r: SubmissionResult = {
          success: true, mode, claimNumber, submissionMode: "manual",
          message: "Claim recorded. Upload documents to TPA portal or email the bundle.",
        };
        setResult(r);
        toast({
          title:       `Claim ${claimNumber} recorded ✓`,
          description: "📤 Upload claim bundle to TPA portal or email it to claims@tpa.in",
        });
        return r;
      }

      // ─ AI Assisted ─────────────────────────────────────────────────────────
      if (mode === "ai_assisted") {
        setProgress("Generating claim cover letter…");

        // Create claim as draft first to get the ID
        const { data: claimRow, error: insertErr } = await (supabase as any)
          .from("insurance_claims")
          .insert({
            hospital_id:        hospitalId,
            bill_id:            row.bill_id,
            patient_id:         row.patient_id,
            tpa_name:           row.tpa_name,
            claim_number:       claimNumber,
            claimed_amount:     row.total_amount,
            status:             "draft",
            submission_mode:    "ai_assisted",
            ai_denial_risk_score: finalRisk,
          })
          .select("id")
          .maybeSingle();

        if (insertErr) throw new Error(insertErr.message);
        if (!claimRow?.id) throw new Error("Claim insert returned no row");

        const text = await generateClaimCoverLetter(row, claimNumber);
        setCoverLetter({
          open:       true,
          text,
          preAuthId:  null,
          claimData:  { ...row, claimId: claimRow.id, claimNumber },
          entityMode: "claim",
        });
        setProgress("");
        return null; // continues via cover letter modal
      }

      // ─ Automated ───────────────────────────────────────────────────────────
      setProgress("Auto-submitting claim to TPA…");

      // First insert the claim record
      const { data: claimRow, error: insertErr } = await (supabase as any)
        .from("insurance_claims")
        .insert({
          hospital_id:        hospitalId,
          bill_id:            row.bill_id,
          patient_id:         row.patient_id,
          tpa_name:           row.tpa_name,
          claim_number:       claimNumber,
          claimed_amount:     row.total_amount,
          status:             "submitted",
          submitted_at:       new Date().toISOString(),
          submission_mode:    "automated",
          ai_denial_risk_score: finalRisk,
        })
        .select("id")
        .maybeSingle();

      if (insertErr) throw new Error(insertErr.message);
      if (!claimRow?.id) throw new Error("Claim insert returned no row");

      // Reclass the receivable to the insurer as soon as the claim is on record.
      await postClaimReclass(hospitalId, claimRow.id, row.patient_name, row.total_amount, postedBy);

      // Invoke HCX claim submission
      const { data, error } = await supabase.functions.invoke("hcx-claim-submit", {
        body: {
          hospital_id: hospitalId,
          bill_id:     row.bill_id,
          claim_type:  "claim",
        },
      });

      if (error) throw new Error(error.message);

      const tpaRef = (data as any)?.tpa_reference_number ?? (data as any)?.correlation_id;
      if (tpaRef) {
        await (supabase as any).from("insurance_claims")
          .update({ tpa_reference_number: tpaRef })
          .eq("id", claimRow.id);
      }

      const r: SubmissionResult = {
        success: true, mode, claimNumber, submissionMode: "automated",
        tpaReferenceNumber: tpaRef,
        message: `Claim auto-submitted. TPA Ref: ${tpaRef ?? claimNumber}`,
      };
      setResult(r);
      toast({
        title:       `Claim ${claimNumber} auto-submitted ✓`,
        description: tpaRef ? `TPA Reference: ${tpaRef}` : undefined,
      });
      return r;
    } catch (e: any) {
      const r: SubmissionResult = { success: false, mode, claimNumber, message: e.message };
      setResult(r);
      toast({ title: "Claim submission failed", description: e.message, variant: "destructive" });
      return r;
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  // ── Download cover letter helper ───────────────────────────────────────────

  const downloadCoverLetter = () => {
    const blob = new Blob([coverLetter.text], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = coverLetter.entityMode === "preauth"
      ? `pre-auth-cover-letter-${Date.now()}.txt`
      : `claim-cover-letter-${coverLetter.claimData?.claimNumber ?? Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const closeCoverLetter = () =>
    setCoverLetter(prev => ({ ...prev, open: false }));

  return {
    submitting,
    progress,
    coverLetter,
    result,
    submitPreAuth,
    submitClaim,
    confirmCoverLetterSubmitted,
    downloadCoverLetter,
    closeCoverLetter,
  };
}
