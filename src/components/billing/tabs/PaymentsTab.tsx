import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X, Clock } from "lucide-react";
import type { BillRecord } from "@/pages/billing/BillingPage";
import type { PaymentRecord } from "@/components/billing/BillEditor";
import RefundModal from "@/components/billing/RefundModal";
import { recordBillPayment } from "@/lib/billPayments";
import { isAdmissionBill } from "@/lib/admissionBill";
import type { BillMoney } from "@/lib/billMoney";
import { fetchOpenRefund, type OpenRefund } from "@/lib/refundRequests";

const PAYMENT_MODES = [
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
}

const PaymentsTab: React.FC<Props> = ({ bill, hospitalId, payments, netAdvanceBalance, money, onRefresh }) => {
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
  const [showRefundModal, setShowRefundModal] = useState(false);
  // A refund already awaiting approval for this bill. Without this the same
  // bill could have several identical pending requests raised from here.
  const [openRefund, setOpenRefund] = useState<OpenRefund | null>(null);
  // Latches on first click so a double-click cannot submit twice.
  const [refundLocked, setRefundLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOpenRefund({ billId: bill.id, admissionId: (bill as any).admission_id ?? null })
      .then((r) => {
        if (cancelled) return;
        setOpenRefund(r);
        setRefundLocked(!!r);
      });
    return () => { cancelled = true; };
  }, [bill.id, (bill as any).admission_id, bill.payment_status]);

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
  };

  return (
    <div className="space-y-6">
      {/* Advance-settled notice for IPD bills */}
      {isAdmissionBill(bill.bill_type) && netAdvanceBalance != null && effectiveBalanceDue === 0 && bill.balance_due > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <p className="text-[13px] font-semibold text-emerald-800">Bill settled via advance</p>
          <p className="text-[12px] text-emerald-600 mt-0.5">
            Net Advance Balance (₹{netAdvanceBalance.toLocaleString("en-IN")}) covers the full bill. No cash collection needed.
          </p>
        </div>
      )}

      {/* Collect payment form */}
      {effectiveBalanceDue > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
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
                {submitting ? "Processing..." : "Collect & Record Payment"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Payment history */}
      <div>
        <h3 className="text-sm font-bold mb-2">Payment History</h3>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[11px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Mode</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Reference</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-border">
                  <td className="px-3 py-2 text-xs">{p.payment_date}</td>
                  <td className="px-3 py-2 text-xs capitalize">{p.payment_mode.replace("_", " ")}</td>
                  <td className="px-3 py-2 text-right font-bold">₹{p.amount.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{p.transaction_id || "—"}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td colSpan={2} className="px-3 py-2">Total Paid</td>
                <td className="px-3 py-2 text-right text-success">
                  ₹{payments.reduce((s, p) => s + p.amount, 0).toLocaleString("en-IN")}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* A refund already awaiting approval — the action is spent. */}
      {openRefund && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-4 text-[12px] text-amber-900">
          <Clock size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-[13px]">
              Refund of ₹{openRefund.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} already requested
            </p>
            <p className="mt-0.5 text-amber-700">
              {openRefund.status === "approved"
                ? "Approved — awaiting disbursement."
                : "Awaiting approval in Billing → Refunds. It can be approved or rejected there."}
            </p>
          </div>
        </div>
      )}

      {/* Refund section — shown when patient has overpaid and refund not yet processed */}
      {money.settlement === "refund" && !openRefund && bill.payment_status !== 'refunded' && (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold text-blue-800">Refund Due to Patient</p>
              <p className="text-[12px] text-blue-600 mt-0.5">
                ₹{money.refundDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })} to be returned
              </p>
            </div>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={refundLocked}
              onClick={() => { setRefundLocked(true); setShowRefundModal(true); }}
            >
              Process Refund
            </Button>
          </div>
          {showRefundModal && (
            <RefundModal
              open={showRefundModal}
              onClose={() => { setShowRefundModal(false); setRefundLocked(false); }}
              billId={bill.id}
              patientId={bill.patient_id}
              admissionId={(bill as any).admission_id ?? null}
              hospitalId={hospitalId ?? ""}
              refundAmount={money.refundDue}
              onRefunded={() => { setShowRefundModal(false); onRefresh(); }}
            />
          )}
        </>
      )}
    </div>
  );
};

export default PaymentsTab;
