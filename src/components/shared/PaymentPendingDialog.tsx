/**
 * PaymentPendingDialog — what a clinician sees when a pre-paid hospital's ancillary order
 * has not been paid for yet.
 *
 * Shared by all three block points (lab sample collection, radiology "Start Study", pharmacy
 * "Confirm Dispense") so the explanation, the route to fixing it, and the override are
 * identical wherever the gate fires.
 *
 * The override demands a typed reason: an override without a "why" is not an audit trail.
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, IndianRupee } from "lucide-react";
import { formatINRExact } from "@/lib/currency";

interface Props {
  open: boolean;
  onClose: () => void;
  /** What the patient still owes for this order. */
  unpaidAmount: number;
  /** True when this user's role is allowed to override (from the gate's evaluation). */
  overrideAvailable: boolean;
  /** Called with the typed reason once the user confirms an override. */
  onOverride: (reason: string) => void | Promise<void>;
  /** e.g. "sample cannot be collected" — completes the sentence describing what is blocked. */
  blockedAction: string;
  busy?: boolean;
}

const PaymentPendingDialog: React.FC<Props> = ({
  open, onClose, unpaidAmount, overrideAvailable, onOverride, blockedAction, busy,
}) => {
  const navigate = useNavigate();
  const [showOverride, setShowOverride] = useState(false);
  const [reason, setReason] = useState("");

  const close = () => {
    setShowOverride(false);
    setReason("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600" />
            Payment pending
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This hospital collects payment before the service is performed, so the{" "}
            {blockedAction} until the amount below is paid at the billing counter.
          </p>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <span className="text-sm text-muted-foreground">Amount due</span>
            <span className="font-mono text-base font-semibold">{formatINRExact(unpaidAmount)}</span>
          </div>

          {showOverride ? (
            <div className="space-y-2 pt-1">
              <Label className="text-xs">Reason for overriding the payment gate *</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Patient unstable — clinically cannot wait for the attendant to reach the counter"
                rows={3}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                This is recorded against the patient with your name. The charge still stands and
                remains payable — an override releases the service, it does not waive the bill.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              The charge is already on the bill and waiting in the billing counter's collections
              list.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>

          {!showOverride && (
            <Button variant="outline" onClick={() => navigate("/billing")} disabled={busy} className="gap-1">
              <IndianRupee size={14} /> Collect payment
            </Button>
          )}

          {overrideAvailable && !showOverride && (
            <Button variant="destructive" onClick={() => setShowOverride(true)} disabled={busy}>
              Override
            </Button>
          )}

          {showOverride && (
            <Button
              variant="destructive"
              disabled={!reason.trim() || busy}
              onClick={() => onOverride(reason.trim())}
            >
              {busy ? "Working…" : "Confirm override"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PaymentPendingDialog;
