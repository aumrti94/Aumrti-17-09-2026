/**
 * DayCareAdmitGateModal — the financial clearance gate shown when Admit is blocked.
 *
 * Shape follows the two gates this app already has:
 *   - DoctorTeleconsultPage.checkPaymentAndJoin  → blocking modal + role-checked override
 *     audited into clinical_alerts as alert_type 'payment_override'
 *   - OTCaseWorkspace.gateAction/submitOverride  → mandatory reason capture
 *
 * The rule itself lives in lib/dayCareGate.ts, and is enforced independently by
 * enforce_daycare_financial_clearance() (20261008000140) — this modal explains the block
 * and offers the two legitimate ways out: collect the money, or override with a reason.
 */

import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import AdvanceReceiptModal from "@/components/billing/AdvanceReceiptModal";
import { formatINRExact } from "@/lib/currency";
import { getCurrentUserRowId } from "@/lib/currentUser";
import { DayCareClearance, DayCarePaymentPolicy, canOverrideDayCareGate } from "@/lib/dayCareGate";
import { ShieldAlert, IndianRupee } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  admissionId: string;
  patient: { id: string; full_name: string; uhid: string };
  clearance: DayCareClearance;
  policy: DayCarePaymentPolicy;
  role: string | null;
  /** Re-check clearance (after a deposit) without admitting. */
  onRecheck: () => void;
  /** Admit, passing an override reason when the user chose to override. */
  onAdmit: (overrideReason?: string) => void;
}

/** Human explanation of why the patient is blocked — never make the user guess. */
function explain(c: DayCareClearance): string {
  switch (c.reason) {
    case "no_estimate":
      return "No estimate has been given to this patient. Record an estimate and deposit before admitting.";
    case "deposit_short":
      return c.basis === "preauth_gap"
        ? "The payer approved less than the estimate. The difference is payable by the patient before the procedure."
        : "The required deposit has not been collected in full.";
    default:
      return "This patient is not financially cleared for admission.";
  }
}

const DayCareAdmitGateModal: React.FC<Props> = ({
  open, onClose, hospitalId, admissionId, patient, clearance, policy, role, onRecheck, onAdmit,
}) => {
  const [showAdvance, setShowAdvance] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canOverride = canOverrideDayCareGate(role, policy);

  const handleOverride = async () => {
    if (!reason.trim()) {
      toast({ title: "A reason is required to override", variant: "destructive" });
      return;
    }
    setSubmitting(true);

    // Audit first, so the override is on record even if the admit write then fails.
    // Three schema bugs fixed here: `message` was never a real column (`alert_message` is);
    // `severity: "warning"` was never a valid CHECK value; `admission_id` never existed as a
    // column at all — so despite this file's own header comment claiming every override is
    // "audited into clinical_alerts", this insert has never once succeeded, silently.
    const userId = await getCurrentUserRowId();
    const { error: alertErr } = await (supabase as any).from("clinical_alerts").insert({
      hospital_id: hospitalId,
      patient_id: patient.id,
      admission_id: admissionId,
      alert_type: "payment_override",
      severity: "high",
      alert_message:
        `Day care financial gate overridden by ${role || "unknown role"} for ${patient.full_name} ` +
        `(${patient.uhid}) — ${formatINRExact(clearance.shortfall)} uncollected. Reason: ${reason.trim()}`,
      created_by: userId,
    });
    if (alertErr) console.error("DayCareAdmitGateModal: clinical_alerts insert failed:", alertErr.message);

    onAdmit(reason.trim());
    setSubmitting(false);
  };

  return (
    <>
      <Dialog open={open && !showAdvance} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-amber-600" />
              Payment required before admission
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm">
              <span className="font-medium">{patient.full_name}</span>{" "}
              <span className="text-muted-foreground text-xs">{patient.uhid}</span>
            </div>

            <p className="text-xs text-muted-foreground">{explain(clearance)}</p>

            <div className="rounded-lg border divide-y text-sm">
              <Row label="Deposit required" value={formatINRExact(clearance.requiredDeposit ?? 0)} />
              <Row label="Collected so far" value={formatINRExact(clearance.advanceBalance)} />
              <Row
                label="Shortfall"
                value={formatINRExact(clearance.shortfall)}
                emphasis
              />
            </div>

            {clearance.basis === "preauth_gap" && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                The TPA approved only part of the estimate. {formatINRExact(clearance.requiredDeposit ?? 0)}{" "}
                is the patient&apos;s share and must be collected before the procedure.
              </p>
            )}

            {!overrideMode ? (
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                {canOverride && clearance.reason !== "no_estimate" && (
                  <Button variant="outline" size="sm" onClick={() => setOverrideMode(true)}>
                    Override…
                  </Button>
                )}
                <Button
                  size="sm"
                  className="bg-teal-600 hover:bg-teal-700 gap-1"
                  onClick={() => setShowAdvance(true)}
                  disabled={clearance.reason === "no_estimate"}
                >
                  <IndianRupee size={13} />
                  Collect {formatINRExact(clearance.shortfall)}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-medium">
                  Reason for admitting without payment * <span className="text-muted-foreground">(audited)</span>
                </label>
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Free camp patient, approved by MD"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setOverrideMode(false)}>Back</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleOverride}
                    disabled={submitting || !reason.trim()}
                  >
                    {submitting ? "Admitting…" : "Override & Admit"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {showAdvance && (
        <AdvanceReceiptModal
          hospitalId={hospitalId}
          admissionId={admissionId}
          prefilledPatient={patient}
          prefilledAmount={clearance.shortfall}
          onClose={() => setShowAdvance(false)}
          onCreated={() => {
            setShowAdvance(false);
            toast({ title: "Deposit collected", description: "Re-checking clearance…" });
            onRecheck();
          }}
        />
      )}
    </>
  );
};

const Row: React.FC<{ label: string; value: string; emphasis?: boolean }> = ({ label, value, emphasis }) => (
  <div className="flex items-center justify-between px-3 py-2">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={emphasis ? "text-sm font-semibold text-red-600" : "text-sm font-medium"}>{value}</span>
  </div>
);

export default DayCareAdmitGateModal;
