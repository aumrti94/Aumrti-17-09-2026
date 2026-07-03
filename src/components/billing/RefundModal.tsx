import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  billId: string;
  patientId: string;
  admissionId: string | null;
  hospitalId: string;
  refundAmount: number;
  onRefunded: () => void;
}

const RefundModal: React.FC<Props> = ({
  open, onClose, billId, patientId, admissionId, hospitalId, refundAmount, onRefunded,
}) => {
  const { toast } = useToast();
  const [amount, setAmount] = useState(String(refundAmount));
  const [mode, setMode] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid refund amount", variant: "destructive" });
      return;
    }
    if (amt > refundAmount) {
      toast({ title: `Refund cannot exceed balance due (₹${refundAmount.toLocaleString("en-IN")})`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await (supabase as any)
        .from("users")
        .select("id")
        .eq("auth_user_id", user?.id || "")
        .maybeSingle();
      const userId = userData?.id ?? null;

      // 1. Record in refund_payables
      const { error: rpErr } = await (supabase as any).from("refund_payables").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        admission_id: admissionId,
        bill_id: billId,
        credit_note_id: null,
        amount: amt,
        refund_mode: mode,
        status: "processed",
        requested_by: userId,
        approved_by: userId,
        processed_at: new Date().toISOString(),
        notes: notes || null,
      });
      if (rpErr) throw rpErr;

      // 2. IPD advance ledger entry (audit trail)
      if (admissionId) {
        const { error: advErr } = await (supabase as any).from("ipd_advances").insert({
          hospital_id: hospitalId,
          admission_id: admissionId,
          patient_id: patientId,
          amount: amt,
          transaction_type: "refund",
          payment_mode: mode,
          reference_no: reference || null,
          description: "Refund disbursed",
          collected_by: userId,
        });
        if (advErr) throw advErr;
      }

      // 3. Mark bill as refunded and reduce paid_amount by the refund
      const { data: billData } = await (supabase as any)
        .from("bills")
        .select("paid_amount, total_amount")
        .eq("id", billId)
        .maybeSingle();
      const currentPaid   = Number(billData?.paid_amount  || 0);
      const totalAmt      = Number(billData?.total_amount || 0);
      const newPaidAmount = Math.max(0, currentPaid - amt);
      const newBalanceDue = Math.max(0, totalAmt - newPaidAmount);

      const { error: billErr } = await (supabase as any)
        .from("bills")
        .update({
          payment_status: "refunded",
          paid_amount:    newPaidAmount,
          balance_due:    newBalanceDue,
        })
        .eq("id", billId);
      if (billErr) throw billErr;

      toast({ title: `Refund of ₹${amt.toLocaleString("en-IN")} recorded` });
      onRefunded();
    } catch (err: any) {
      toast({ title: "Failed to record refund", description: err?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Process Patient Refund</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Refund Amount (₹)</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAmount(v > refundAmount ? String(refundAmount) : e.target.value);
                }}
                className="mt-1 h-9 text-sm"
                min={0.01}
                max={refundAmount}
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Max: ₹{refundAmount.toLocaleString("en-IN")}
              </p>
            </div>
            <div>
              <Label className="text-xs">Refund Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Reference / Transaction No. (optional)</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UPI ref, cheque no., UTR..."
              className="mt-1 h-9 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for refund..."
              className="mt-1 h-9 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Confirm Refund
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RefundModal;
