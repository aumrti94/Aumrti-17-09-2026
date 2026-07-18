/**
 * DayCareCancelModal — cancel a booking, or mark it a no-show.
 *
 * Both are the same form (a reason, and a decision about any held deposit) with different
 * wording, so `mode` switches the copy rather than duplicating the component.
 *
 * The reason-capture shape follows DayCareAdmitGateModal: mandatory reason, submit disabled
 * until it's given, audit written before the record changes.
 */

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatINRExact } from "@/lib/currency";
import { useConfigValues } from "@/hooks/useConfigValues";
import {
  CancelStatus,
  DepositDisposition,
  cancelDayCareBooking,
  planDepositDisposition,
} from "@/lib/dayCareCancel";
import { XCircle, UserX, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  mode: CancelStatus;
  hospitalId: string;
  admissionId: string;
  patient: { id: string; full_name: string; uhid: string };
  procedureName: string;
  onDone: () => void;
}

const DISPOSITIONS: { value: DepositDisposition; label: string; hint: string }[] = [
  { value: "refund", label: "Refund the full deposit", hint: "Raised for approval — cash leaves only once a second person approves it." },
  { value: "retain_fee", label: "Retain a fee, refund the rest", hint: "The fee is billed as a cancellation charge so it is recognised as revenue." },
  { value: "carry_forward", label: "Hold it against a future booking", hint: "Nothing is refunded; the deposit stays on this booking. To keep the same booking on a later date, use Reschedule instead." },
];

const DayCareCancelModal: React.FC<Props> = ({
  open, onClose, mode, hospitalId, admissionId, patient, procedureName, onDone,
}) => {
  const reasons = useConfigValues("cancellation_reasons");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [disposition, setDisposition] = useState<DepositDisposition>("refund");
  const [fee, setFee] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isNoShow = mode === "no_show";

  useEffect(() => {
    if (!open) return;
    setReason(isNoShow ? "patient_no_show" : "");
    setNote(""); setDisposition("refund"); setFee(""); setBalance(null);
    (supabase as any)
      .from("ipd_advance_balances")
      .select("balance")
      .eq("admission_id", admissionId)
      .maybeSingle()
      .then(({ data }: any) => setBalance(Math.max(0, Number(data?.balance) || 0)));
  }, [open, admissionId, isNoShow]);

  const held = balance ?? 0;
  const plan = useMemo(
    () => planDepositDisposition(held, disposition, fee === "" ? null : Number(fee)),
    [held, disposition, fee]
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await cancelDayCareBooking({
        hospitalId, admissionId,
        patientId: patient.id,
        patientName: patient.full_name,
        status: mode,
        reason,
        note,
        disposition,
        retainedFee: fee === "" ? null : Number(fee),
      });
      toast({
        title: isNoShow ? "Marked as no-show" : "Booking cancelled",
        description: res.refundRequested > 0
          ? `${formatINRExact(res.refundRequested)} sent for refund approval.`
          : res.feeBilled > 0
          ? `${formatINRExact(res.feeBilled)} retained as a cancellation fee.`
          : res.holdAmount > 0
          ? `${formatINRExact(res.holdAmount)} held against a future booking.`
          : undefined,
      });
      onDone();
      onClose();
    } catch (e: any) {
      // Includes the locked-cash-day rejection: the booking stays scheduled rather than
      // being cancelled while the hospital still holds the patient's money.
      toast({
        title: isNoShow ? "Could not mark no-show" : "Could not cancel",
        description: e?.message || "Unknown error",
        variant: "destructive",
      });
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isNoShow ? <UserX size={18} className="text-amber-600" /> : <XCircle size={18} className="text-red-600" />}
            {isNoShow ? "Mark as No-Show" : "Cancel Booking"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm">
            <span className="font-medium">{patient.full_name}</span>{" "}
            <span className="text-muted-foreground text-xs">{patient.uhid}</span>
            <div className="text-xs text-muted-foreground">{procedureName}</div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Reason *</label>
            <select
              className="w-full border rounded px-2 py-2 text-sm bg-background"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">Select a reason…</option>
              {reasons.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Note</label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Optional detail…" />
          </div>

          {balance === null ? (
            <p className="text-xs text-muted-foreground">Checking deposit…</p>
          ) : held > 0 ? (
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Deposit held</span>
                <span className="text-sm font-bold">{formatINRExact(held)}</span>
              </div>

              <div className="space-y-2">
                {DISPOSITIONS.map((d) => (
                  <label key={d.value} className="flex gap-2 items-start cursor-pointer">
                    <input
                      type="radio"
                      className="mt-1"
                      checked={disposition === d.value}
                      onChange={() => setDisposition(d.value)}
                    />
                    <span>
                      <span className="text-sm font-medium">{d.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{d.hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              {disposition === "retain_fee" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Fee to retain (₹)</label>
                  <Input type="number" value={fee} onChange={(e) => setFee(e.target.value)}
                    className="h-9 text-sm" placeholder="0" autoFocus />
                </div>
              )}

              {plan.error ? (
                <p className="text-xs text-red-600">{plan.error}</p>
              ) : (
                <div className="text-xs flex flex-wrap gap-x-4 gap-y-1 border-t pt-2">
                  {plan.feeToBill > 0 && <span>Retain <strong>{formatINRExact(plan.feeToBill)}</strong></span>}
                  {plan.refundAmount > 0 && <span className="text-emerald-700">Refund <strong>{formatINRExact(plan.refundAmount)}</strong></span>}
                  {plan.holdAmount > 0 && <span className="text-amber-700">Hold <strong>{formatINRExact(plan.holdAmount)}</strong></span>}
                </div>
              )}

              {plan.refundAmount > 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 flex gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  The refund goes to Billing → Approvals. No cash leaves until someone approves it.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No deposit has been collected for this booking.</p>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>Keep Booking</Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleSubmit}
              disabled={submitting || !reason || !!plan.error}
              className={cn(isNoShow && "bg-amber-600 hover:bg-amber-700")}
            >
              {submitting ? "Working…" : isNoShow ? "Mark No-Show" : "Cancel Booking"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DayCareCancelModal;
