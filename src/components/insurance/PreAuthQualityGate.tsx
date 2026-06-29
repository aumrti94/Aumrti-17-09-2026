import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Send,
  Loader2,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────

export interface QualityGateInput {
  patientId: string;
  admissionId: string | null;
  tpaName: string;
  policyNumber: string;
  diagnosisCodes: string;
  procedureCodes: string;
  estimatedAmount: string | number;
  notes: string;
  isAccidentCase: boolean;
  mlcNumber: string;
  firNumber: string;
  isExtension: boolean;
  extensionReason?: string;
  hospitalId: string;
  intimationSentAt?: string | null;
  requiredDocuments?: string[];
}

interface CheckResult {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  category: "mandatory" | "clinical" | "document" | "tpa";
}

type GateVerdict = "pass" | "warning" | "blocked";

interface Props {
  open: boolean;
  onClose: () => void;
  input: QualityGateInput;
  onProceed: () => void;
}

// ─── Category labels ────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  mandatory: "Mandatory Fields",
  clinical: "Clinical Requirements",
  document: "Document Verification",
  tpa: "TPA-Specific Rules",
};

const CATEGORY_ORDER = ["mandatory", "clinical", "document", "tpa"];

// ─── Component ──────────────────────────────────────────

const PreAuthQualityGate: React.FC<Props> = ({ open, onClose, input, onProceed }) => {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [docCount, setDocCount] = useState(0);

  useEffect(() => {
    if (open) {
      setOverrideAcknowledged(false);
      runChecks();
    }
  }, [open]);

  const runChecks = async () => {
    setLoading(true);
    const results: CheckResult[] = [];

    // ── MANDATORY FIELD CHECKS ──────────────────────

    // 1. TPA / Insurer selected
    results.push({
      id: "tpa_name",
      label: "TPA / Insurer selected",
      category: "mandatory",
      status: input.tpaName && input.tpaName !== "Unknown" ? "pass" : "fail",
      message: input.tpaName && input.tpaName !== "Unknown"
        ? `TPA: ${input.tpaName}`
        : "No TPA/insurer selected. This is required for submission.",
    });

    // 2. Policy number
    const hasPolicyNum = !!(input.policyNumber && input.policyNumber.trim().length >= 3);
    results.push({
      id: "policy_number",
      label: "Policy number provided",
      category: "mandatory",
      status: hasPolicyNum ? "pass" : "fail",
      message: hasPolicyNum
        ? `Policy: ${input.policyNumber}`
        : "Policy number is missing or too short. TPA will reject without a valid policy number.",
    });

    // 3. Estimated amount
    const amount = Number(input.estimatedAmount) || 0;
    results.push({
      id: "estimated_amount",
      label: "Estimated amount entered",
      category: "mandatory",
      status: amount > 0 ? "pass" : "fail",
      message: amount > 0
        ? `₹${amount.toLocaleString("en-IN")}`
        : "Estimated amount is zero or missing. TPA requires a valid amount.",
    });

    // ── CLINICAL CHECKS ─────────────────────────────

    // 4. Diagnosis / ICD codes
    const diagCodes = (input.diagnosisCodes || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    results.push({
      id: "diagnosis_codes",
      label: "At least 1 ICD diagnosis code",
      category: "clinical",
      status: diagCodes.length > 0 ? "pass" : "fail",
      message: diagCodes.length > 0
        ? `${diagCodes.length} code(s): ${diagCodes.slice(0, 3).join(", ")}${diagCodes.length > 3 ? "…" : ""}`
        : "No ICD diagnosis codes entered. Use AI Generate or enter manually (e.g., J18.9).",
    });

    // 5. Procedure codes
    const procCodes = (input.procedureCodes || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    results.push({
      id: "procedure_codes",
      label: "At least 1 procedure code",
      category: "clinical",
      status: procCodes.length > 0 ? "pass" : "warning",
      message: procCodes.length > 0
        ? `${procCodes.length} code(s): ${procCodes.slice(0, 3).join(", ")}${procCodes.length > 3 ? "…" : ""}`
        : "No procedure codes entered. Recommended to add at least one for faster approval.",
    });

    // 6. Clinical notes / justification
    const notesLen = (input.notes || "").trim().length;
    results.push({
      id: "clinical_notes",
      label: "Clinical notes ≥ 50 characters",
      category: "clinical",
      status: notesLen >= 50 ? "pass" : notesLen > 0 ? "warning" : "fail",
      message: notesLen >= 50
        ? `${notesLen} characters of clinical justification`
        : notesLen > 0
        ? `Only ${notesLen} characters. TPAs typically require detailed justification (50+ chars recommended).`
        : "No clinical notes entered. Missing justification is a top denial reason.",
    });

    // 7. Extension reason (only if extension)
    if (input.isExtension) {
      const extLen = (input.extensionReason || "").trim().length;
      results.push({
        id: "extension_reason",
        label: "Extension reason provided",
        category: "clinical",
        status: extLen >= 20 ? "pass" : "fail",
        message: extLen >= 20
          ? `Extension reason: ${extLen} characters`
          : "Extension reason is required and should be at least 20 characters.",
      });
    }

    // ── INTIMATION CHECK ────────────────────────────

    // 8. Intimation sent
    let intimationSent = !!input.intimationSentAt;
    if (!intimationSent && input.admissionId && input.hospitalId) {
      // Check DB for existing intimation
      const { data: intimRow } = await (supabase as any)
        .from("insurance_pre_auth")
        .select("intimation_sent_at")
        .eq("admission_id", input.admissionId)
        .eq("hospital_id", input.hospitalId)
        .not("intimation_sent_at", "is", null)
        .limit(1)
        .maybeSingle();
      if (intimRow?.intimation_sent_at) intimationSent = true;

      // Also check insurance_intimations table
      if (!intimationSent) {
        const { data: intimRecord } = await (supabase as any)
          .from("insurance_intimations")
          .select("status")
          .eq("admission_id", input.admissionId)
          .eq("hospital_id", input.hospitalId)
          .in("status", ["sent", "acknowledged"])
          .limit(1)
          .maybeSingle();
        if (intimRecord) intimationSent = true;
      }
    }
    results.push({
      id: "intimation",
      label: "TPA intimation sent",
      category: "mandatory",
      status: intimationSent ? "pass" : input.admissionId ? "warning" : "pass",
      message: intimationSent
        ? "Intimation has been sent to the TPA/insurer"
        : input.admissionId
        ? "Intimation may not have been sent yet. Submitting pre-auth without intimation can lead to rejection."
        : "Pre-admission pre-auth — intimation will be sent on admission.",
    });

    // ── ACCIDENT / TRAUMA CHECKS ────────────────────

    // 9. MLC number for accident cases
    if (input.isAccidentCase) {
      results.push({
        id: "mlc_number",
        label: "MLC number (accident/trauma)",
        category: "mandatory",
        status: input.mlcNumber.trim().length > 0 ? "pass" : "fail",
        message: input.mlcNumber.trim().length > 0
          ? `MLC: ${input.mlcNumber}`
          : "MLC number is MANDATORY for accident/trauma cases. Claims will be rejected without it.",
      });

      results.push({
        id: "fir_number",
        label: "FIR number (if applicable)",
        category: "document",
        status: input.firNumber.trim().length > 0 ? "pass" : "warning",
        message: input.firNumber.trim().length > 0
          ? `FIR: ${input.firNumber}`
          : "FIR number not provided. Many TPAs require this for accident claims.",
      });
    }

    // ── DOCUMENT CHECKS ─────────────────────────────

    // 10. Check uploaded documents count
    let uploadedDocCount = 0;
    if (input.patientId) {
      const { count } = await (supabase as any)
        .from("patient_documents")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", input.patientId);
      uploadedDocCount = count || 0;
      setDocCount(uploadedDocCount);
    }

    results.push({
      id: "documents_uploaded",
      label: "Supporting documents uploaded",
      category: "document",
      status: uploadedDocCount >= 2 ? "pass" : uploadedDocCount >= 1 ? "warning" : "warning",
      message: uploadedDocCount > 0
        ? `${uploadedDocCount} document(s) uploaded for this patient`
        : "No documents uploaded yet. Consider uploading ID proof, insurance card, or referral letter.",
    });

    // 11. TPA-specific required documents
    if (input.requiredDocuments && input.requiredDocuments.length > 0) {
      results.push({
        id: "tpa_required_docs",
        label: `TPA-specific documents (${input.tpaName})`,
        category: "tpa",
        status: uploadedDocCount >= input.requiredDocuments.length ? "pass" : "warning",
        message: uploadedDocCount >= input.requiredDocuments.length
          ? `All ${input.requiredDocuments.length} TPA-required document types appear covered`
          : `${input.tpaName} requires: ${input.requiredDocuments.join(", ")}. Verify all are uploaded.`,
      });
    }

    // 12. Room rent ceiling check (if applicable)
    if (input.admissionId && input.hospitalId && input.tpaName) {
      const { data: tpaConfig } = await (supabase as any)
        .from("tpa_config")
        .select("room_rent_ceiling")
        .eq("tpa_name", input.tpaName)
        .eq("hospital_id", input.hospitalId)
        .eq("is_active", true)
        .maybeSingle();

      const ceiling = Number(tpaConfig?.room_rent_ceiling || 0);
      if (ceiling > 0) {
        results.push({
          id: "room_rent_ceiling",
          label: "Room rent within TPA limit",
          category: "tpa",
          status: "pass",
          message: `TPA room rent ceiling: ₹${ceiling.toLocaleString("en-IN")}/day. Ensure patient's room is within this limit.`,
        });
      }
    }

    setChecks(results);
    setLoading(false);
  };

  // ── Compute verdict ──────────────────────────────

  const failCount = checks.filter(c => c.status === "fail").length;
  const warnCount = checks.filter(c => c.status === "warning").length;
  const passCount = checks.filter(c => c.status === "pass").length;

  const verdict: GateVerdict =
    failCount > 0 ? "blocked" : warnCount > 0 ? "warning" : "pass";

  const canProceed =
    verdict === "pass" || (verdict === "warning" && overrideAcknowledged);

  const verdictConfig = {
    pass: {
      icon: ShieldCheck,
      label: "ALL CHECKS PASSED",
      color: "text-emerald-700",
      bg: "bg-emerald-50 border-emerald-200",
      desc: "This pre-auth request meets all quality requirements. Ready to submit.",
    },
    warning: {
      icon: ShieldAlert,
      label: "WARNINGS — REVIEW REQUIRED",
      color: "text-amber-700",
      bg: "bg-amber-50 border-amber-200",
      desc: "Some checks have warnings. Review the items below and acknowledge to proceed.",
    },
    blocked: {
      icon: ShieldX,
      label: "SUBMISSION BLOCKED",
      color: "text-red-700",
      bg: "bg-red-50 border-red-200",
      desc: "Critical issues must be fixed before this pre-auth can be submitted.",
    },
  };

  const vc = verdictConfig[verdict];
  const VerdictIcon = vc.icon;

  // ── Group checks by category ──────────────────────

  const groupedChecks = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = checks.filter(c => c.category === cat);
    if (items.length > 0) acc.push({ category: cat, items });
    return acc;
  }, [] as { category: string; items: CheckResult[] }[]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} /> Pre-Auth Quality Gate
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 size={28} className="animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Running quality checks…</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── Verdict Banner ──────────────────────── */}
            <div className={cn("flex items-start gap-3 p-4 rounded-lg border", vc.bg)}>
              <VerdictIcon size={24} className={cn("shrink-0 mt-0.5", vc.color)} />
              <div>
                <p className={cn("text-sm font-bold uppercase tracking-wide", vc.color)}>
                  {vc.label}
                </p>
                <p className="text-xs text-foreground/70 mt-0.5">{vc.desc}</p>
                <div className="flex gap-3 mt-2">
                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                    {passCount} passed
                  </Badge>
                  {warnCount > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                      {warnCount} warning{warnCount > 1 ? "s" : ""}
                    </Badge>
                  )}
                  {failCount > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">
                      {failCount} failed
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* ── Check Groups ────────────────────────── */}
            {groupedChecks.map(({ category, items }) => (
              <div key={category}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  {CATEGORY_LABELS[category]}
                </p>
                <div className="space-y-1.5">
                  {items.map((check) => {
                    const StatusIcon =
                      check.status === "pass"
                        ? CheckCircle2
                        : check.status === "warning"
                        ? AlertTriangle
                        : XCircle;
                    const statusColor =
                      check.status === "pass"
                        ? "text-emerald-600"
                        : check.status === "warning"
                        ? "text-amber-600"
                        : "text-red-600";
                    const borderColor =
                      check.status === "pass"
                        ? "border-emerald-100"
                        : check.status === "warning"
                        ? "border-amber-100"
                        : "border-red-200";
                    const bgColor =
                      check.status === "fail" ? "bg-red-50/40" : "bg-background";

                    return (
                      <div
                        key={check.id}
                        className={cn(
                          "flex items-start gap-2.5 p-2.5 rounded-md border",
                          borderColor,
                          bgColor
                        )}
                      >
                        <StatusIcon size={14} className={cn("shrink-0 mt-0.5", statusColor)} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-foreground">
                            {check.label}
                          </p>
                          <p className={cn("text-[11px] mt-0.5", statusColor)}>
                            {check.message}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* ── Override acknowledgement (warnings only) ── */}
            {verdict === "warning" && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200">
                <Checkbox
                  id="override-ack"
                  checked={overrideAcknowledged}
                  onCheckedChange={(v) => setOverrideAcknowledged(!!v)}
                  className="mt-0.5"
                />
                <label htmlFor="override-ack" className="text-sm cursor-pointer leading-snug text-amber-800">
                  I have reviewed the warnings above and confirm the pre-auth is ready for submission despite the flagged items.
                </label>
              </div>
            )}

            {/* ── Action buttons ──────────────────────── */}
            <div className="flex gap-2 justify-end pt-2 border-t border-border">
              <Button variant="outline" onClick={onClose}>
                Go Back & Fix
              </Button>
              <Button
                onClick={onProceed}
                disabled={!canProceed}
                className="gap-1.5"
                title={
                  verdict === "blocked"
                    ? "Fix all failed checks before submitting"
                    : verdict === "warning" && !overrideAcknowledged
                    ? "Acknowledge warnings to proceed"
                    : undefined
                }
              >
                <Send size={14} />
                {verdict === "pass"
                  ? "Submit Pre-Auth"
                  : verdict === "warning"
                  ? "Submit with Warnings"
                  : "Blocked — Fix Issues"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PreAuthQualityGate;
