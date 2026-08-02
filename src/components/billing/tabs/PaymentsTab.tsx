import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";
import type { BillRecord } from "@/pages/billing/BillingPage";
import type { PaymentRecord } from "@/components/billing/BillEditor";
import RefundModal from "@/components/billing/RefundModal";
import CollectPaymentForm from "@/components/billing/CollectPaymentForm";
import { isAdmissionBill } from "@/lib/admissionBill";
import type { BillMoney } from "@/lib/billMoney";
import { fetchOpenRefund, type OpenRefund } from "@/lib/refundRequests";

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
  const effectiveBalanceDue = isAdmissionBill(bill.bill_type)
    ? money.balanceDue
    : bill.balance_due;

  // Extracted so the dependency arrays name plain identifiers the linter can
  // check statically, rather than a cast expression or a whole object.
  const billId = bill.id;
  const billAdmissionId = (bill as any).admission_id as string | undefined;
  const billPaymentStatus = bill.payment_status;

  const [showRefundModal, setShowRefundModal] = useState(false);
  // A refund already awaiting approval for this bill. Without this the same
  // bill could have several identical pending requests raised from here.
  const [openRefund, setOpenRefund] = useState<OpenRefund | null>(null);
  // Latches on first click so a double-click cannot submit twice.
  const [refundLocked, setRefundLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOpenRefund({ billId, admissionId: billAdmissionId ?? null })
      .then((r) => {
        if (cancelled) return;
        setOpenRefund(r);
        setRefundLocked(!!r);
      });
    return () => { cancelled = true; };
  }, [billId, billAdmissionId, billPaymentStatus]);

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

      {/* Collect payment form (shared with the header "Pay Bill" modal) */}
      <CollectPaymentForm
        bill={bill}
        hospitalId={hospitalId}
        payments={payments}
        netAdvanceBalance={netAdvanceBalance}
        money={money}
        onRefresh={onRefresh}
      />

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
