import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BillRecord } from "@/pages/billing/BillingPage";
import type { PaymentRecord } from "@/components/billing/BillEditor";
import { recordBillPayment } from "@/lib/billPayments";
import { isAdmissionBill } from "@/lib/admissionBill";
import type { BillMoney } from "@/lib/billMoney";

export const PAYMENT_MODES = [
  { value: "cash", label: "💵 Cash" },
  { value: "upi", label: "📱 UPI" },
  { value: "card", label: "💳 Card" },
  { value: "net_banking", label: "🌐 Net Banking" },
  { value: "cheque", label: "💳 Cheque" },
  { value: "insurance", label: "🏥 Insurance" },
  { value: "pmjay", label: "🏥 PMJAY / Govt Scheme" },
  { value: "advance_adjust", label: "🔄 Advance Adjust" },
];

interface PayRow {
  mode: string;
  amount: string;
  reference: string;
}

interface Props {
  bill: BillRecord;
  hospitalId: string | null;
  payments: PaymentRecord[];
  netAdvanceBalance?: number | null;
  /** Shared money contract from BillEditor — the same figures every other tab shows. */
  money: BillMoney;
  onRefresh: () => void;
  /** Fired after a successful collection — lets a host modal auto-close. */
  onSuccess?: () => void;
  /** Tightens padding/heading chrome when rendered inside the Pay Bill modal. */
  compact?: boolean;
}

const CollectPaymentForm: React.FC<Props> = ({ bill, hospitalId, payments, netAdvanceBalance, money, onRefresh, onSuccess, compact }) => {
  // Sum of non-advance cash payments already recorded (from Payment History)
  const totalDirectPaid = payments.reduce((s, p) => s + p.amount, 0);

  // Derived from the line items and the admission-scoped advance ledger, not
  // from bills.patient_payable / bills.paid_amount. Those two columns produced
  // a refund of ₹18,500 on a bill owing ₹6,000 against a ₹20,000 advance:
  // patient_payable held an advance-netted residual and paid_amount was
  // inflated by the advance sync, so the error compounded.
  const netPatientPayable = money.patientPayable;

  const effectiveBalanceDue = isAdmissionBill(bill.bill_type)
    ? money.balanceDue
    : bill.balance_due;

  const { toast } = useToast();
  const [rows, setRows] = useState<PayRow[]>([{ mode: "cash", amount: String(effectiveBalanceDue || ""), reference: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [autoReceipt, setAutoReceipt] = useState(true);

  // Re-sync rows when advance balance loads asynchronously
  React.useEffect(() => {
    setRows([{ mode: "cash", amount: String(effectiveBalanceDue > 0 ? effectiveBalanceDue : ""), reference: "" }]);
  }, [effectiveBalanceDue]);

  const addRow = () => setRows([...rows, { mode: "cash", amount: "", reference: "" }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof PayRow, value: string) =>
    setRows(rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const totalCollecting = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const handleCollect = async () => {
    if (!hospitalId) return;
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user?.id || "")
      .maybeSingle();

    const newPaid = bill.paid_amount + totalCollecting;
    // For IPD bills, advance + all direct cash payments determine true balance
    const advanceCovered = isAdmissionBill(bill.bill_type) ? money.netAdvance : 0;
    const allDirectPaid = totalDirectPaid + totalCollecting;
    const newBalance = Math.max(0, netPatientPayable - advanceCovered - allDirectPaid);
    const newStatus: "paid" | "partial" = newBalance <= 0 ? "paid" : "partial";

    const result = await recordBillPayment({
      hospitalId,
      billId: bill.id,
      billNumber: bill.bill_number,
      patientId: bill.patient_id,
      admissionId: bill.admission_id ?? null,
      rows: rows.map((r) => ({ mode: r.mode, amount: Number(r.amount) || 0, reference: r.reference })),
      collectedBy: userData?.id || null,
      newPaidAmount: newPaid,
      newBalanceDue: newBalance,
      newPaymentStatus: newStatus,
      sendReceipt: autoReceipt,
    });

    if (!result.ok) {
      toast({ title: result.error || "Failed to record payment", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    toast({ title: `Payment of ₹${totalCollecting.toLocaleString("en-IN")} collected ✓` });
    setSubmitting(false);
    onRefresh();
    onSuccess?.();
  };

  if (effectiveBalanceDue <= 0) return null;

  return (
    <div className={cn("bg-card border border-border rounded-lg", compact ? "p-3" : "p-4")}>
      <p className="text-base font-bold mb-3">Amount to Collect: ₹{effectiveBalanceDue.toLocaleString("en-IN")}</p>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Select value={row.mode} onValueChange={(v) => updateRow(i, "mode", v)}>
              <SelectTrigger className="w-44 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number" placeholder="₹ Amount" value={row.amount}
              onChange={(e) => updateRow(i, "amount", e.target.value)}
              className="w-32 h-9 text-xs"
            />
            <Input
              placeholder="Ref / Txn ID" value={row.reference}
              onChange={(e) => updateRow(i, "reference", e.target.value)}
              className="flex-1 h-9 text-xs"
            />
            {rows.length > 1 && (
              <button onClick={() => removeRow(i)} className="text-destructive"><X size={14} /></button>
            )}
          </div>
        ))}
      </div>

      <button onClick={addRow} className="text-xs text-primary mt-2 flex items-center gap-1">
        <Plus size={12} /> Add split payment
      </button>

      <div className="flex flex-col gap-2 mt-4">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <Checkbox checked={autoReceipt} onCheckedChange={(v) => setAutoReceipt(!!v)} />
          Auto-send WhatsApp receipt
        </label>
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">
            Collecting: ₹{totalCollecting.toLocaleString("en-IN")}
            {totalCollecting > effectiveBalanceDue && (
              <span className="text-success ml-2">Change: ₹{(totalCollecting - effectiveBalanceDue).toLocaleString("en-IN")}</span>
            )}
          </span>
          <Button onClick={handleCollect} disabled={submitting || totalCollecting <= 0} className="h-10">
            {submitting ? "Processing..." : `Pay ₹${totalCollecting.toLocaleString("en-IN")}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CollectPaymentForm;
