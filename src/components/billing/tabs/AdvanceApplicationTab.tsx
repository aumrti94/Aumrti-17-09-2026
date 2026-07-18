/**
 * AdvanceApplicationTab
 *
 * Shows the IPD advance balance for the patient's admission
 * and lets the billing clerk apply some or all of the advance
 * to the current bill, reducing patient_payable and balance_due.
 *
 * Used as a tab inside BillEditor for IPD bills.
 */

import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncAdvanceToBill } from "@/lib/advanceBillSync";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Wallet, AlertCircle, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import RefundModal from "@/components/billing/RefundModal";

interface Props {
  billId:          string;
  admissionId:     string | null;
  patientId:       string;
  hospitalId:      string;
  totalAmount:     number;
  advanceApplied:  number;   // current bill.advance_applied
  paidAmount:      number;
  paymentStatus:   string;
  directCashPaid?: number;   // sum of non-advance cash payments already collected
  onRefresh:       () => void;
}

interface AdvanceBalance {
  balance:        number;
  total_deposited: number;
  total_debited:  number;
}

interface AdvanceTransaction {
  id:               string;
  amount:           number;
  transaction_type: string;
  payment_mode:     string | null;
  description:      string | null;
  created_at:       string;
}

const inr = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const AdvanceApplicationTab: React.FC<Props> = ({
  billId, admissionId, patientId, hospitalId,
  totalAmount, advanceApplied, paidAmount, paymentStatus, directCashPaid = 0, onRefresh,
}) => {
  const { toast } = useToast();
  const [balance, setBalance]           = useState<AdvanceBalance | null>(null);
  const [transactions, setTransactions] = useState<AdvanceTransaction[]>([]);
  const [loading, setLoading]           = useState(true);
  const [applyAmount, setApplyAmount]   = useState("");
  const [applying, setApplying]         = useState(false);

  const [showRefundModal, setShowRefundModal] = useState(false);

  // New deposit form
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMode, setDepositMode]     = useState("cash");
  const [depositRef, setDepositRef]       = useState("");
  const [depositing, setDepositing]       = useState(false);

  useEffect(() => {
    fetchBalance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionId]);

  const fetchBalance = async () => {
    if (!admissionId) { setLoading(false); return; }
    setLoading(true);

    const [balRes, txRes, receiptsRes, ipdAdvRefs] = await Promise.all([
      (supabase as any)
        .from("ipd_advance_balances")
        .select("balance, total_deposited, total_debited")
        .eq("admission_id", admissionId)
        .eq("hospital_id", hospitalId)
        .maybeSingle(),
      (supabase as any)
        .from("ipd_advances")
        .select("id, amount, transaction_type, payment_mode, description, created_at")
        .eq("admission_id", admissionId)
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false })
        .limit(20),
      // Legacy deposits that live only in advance_receipts (before dual-write fix).
      // Scoped to THIS admission — filtering by patient counted advances from the
      // patient's other stays into this admission's balance (double-counting them).
      (supabase as any)
        .from("advance_receipts")
        .select("id, amount, payment_mode, receipt_number, notes, created_at")
        .eq("hospital_id", hospitalId)
        .eq("admission_id", admissionId)
        .order("created_at", { ascending: false }),
      // reference_nos already mirrored into ipd_advances (to avoid double-count)
      (supabase as any)
        .from("ipd_advances")
        .select("reference_no")
        .eq("admission_id", admissionId)
        .not("reference_no", "is", null),
    ]);

    const ipdTxns: AdvanceTransaction[] = (txRes.data ?? []);

    const mirroredRefs = new Set(
      (ipdAdvRefs.data || []).map((r: any) => r.reference_no)
    );
    const unmirroredReceipts = (receiptsRes.data || []).filter(
      (r: any) => !mirroredRefs.has(r.receipt_number)
    );
    const unmirroredTotal = unmirroredReceipts.reduce(
      (s: number, r: any) => s + Number(r.amount || 0), 0
    );

    const viewBalance  = Number(balRes.data?.balance          || 0);
    const ipdDeposited = Number(balRes.data?.total_deposited  || 0);
    const ipdDebited   = Number(balRes.data?.total_debited    || 0);

    setBalance({
      balance:         viewBalance + unmirroredTotal,  // view already subtracts refunds & service_debits
      total_deposited: ipdDeposited + unmirroredTotal,
      total_debited:   ipdDebited,
    });

    // Merge ipd_advances txns + unmirrored advance_receipts into one list
    const receiptTxns: AdvanceTransaction[] = unmirroredReceipts.map((r: any) => ({
      id:               r.id,
      amount:           Number(r.amount),
      transaction_type: "deposit",
      payment_mode:     r.payment_mode,
      description:      r.notes || "Advance deposit",
      created_at:       r.created_at,
    }));

    const allTxns = [...ipdTxns, ...receiptTxns].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setTransactions(allTxns);
    setLoading(false);
  };

  const availableToApply = Math.max(0, (balance?.balance ?? 0));
  const totalDebited  = balance?.total_debited ?? 0;
  const totalRefunded = Math.max(0,
    (balance?.total_deposited ?? 0) - totalDebited - (balance?.balance ?? 0)
  );
  // Net position: bill total minus advance and any direct cash payments already collected.
  // Do NOT use bills.paid_amount — it is inflated by syncAdvanceToBill auto-syncs.
  const balanceAfterApply = totalAmount - (availableToApply + totalDebited) - directCashPaid;
  const isRefund = balanceAfterApply < 0;

  const applyAdvance = async () => {
    const amount = Number(applyAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (amount > availableToApply) {
      toast({ title: "Amount exceeds available advance balance", variant: "destructive" });
      return;
    }
    if (amount > balanceAfterApply) {
      toast({ title: "Amount exceeds bill balance due", variant: "destructive" });
      return;
    }

    setApplying(true);

    // 1. Record debit in ipd_advances
    const { error: txErr } = await (supabase as any).from("ipd_advances").insert({
      hospital_id:      hospitalId,
      admission_id:     admissionId,
      patient_id:       patientId,
      amount,
      transaction_type: "service_debit",
      description:      `Applied to bill ${billId.slice(0, 8).toUpperCase()}`,
    });

    if (txErr) {
      toast({ title: "Failed to record advance debit", description: txErr.message, variant: "destructive" });
      setApplying(false);
      return;
    }

    // 2. Check if advance was already synced to bill_payments at collection time.
    //    If yes → paid_amount is already correct, only update advance_applied tracking.
    //    If no  → old admission path: use syncAdvanceToBill to create bill_payments + paid_amount.
    const { data: existingAdvPmts } = await (supabase as any)
      .from("bill_payments")
      .select("amount")
      .eq("bill_id",    billId)
      .eq("is_advance", true);

    const alreadySynced = (existingAdvPmts || []).reduce(
      (s: number, p: any) => s + Number(p.amount || 0), 0
    );

    if (alreadySynced < amount) {
      // Old admission: advance was never auto-synced — do it now via syncAdvanceToBill
      if (admissionId) {
        await syncAdvanceToBill({
          admissionId,
          hospitalId,
          amount: amount - alreadySynced,
          paymentMode: "advance_adjust",
          notes: "Advance applied in billing",
        });
      }
    }

    // 3. Refresh bill state after sync so we work with accurate figures
    const { data: freshBill } = await (supabase as any)
      .from("bills")
      .select("paid_amount, total_amount")
      .eq("id", billId)
      .maybeSingle();

    const freshPaid   = Number(freshBill?.paid_amount  || 0);
    const freshTotal  = Number(freshBill?.total_amount || 0);
    const newAdvanceApplied = advanceApplied + amount;
    const newBalanceDue     = Math.max(0, freshTotal - freshPaid);

    const { error: billErr } = await (supabase as any).from("bills").update({
      advance_applied:  newAdvanceApplied,
      advance_received: newAdvanceApplied,
      patient_payable:  newBalanceDue,
      balance_due:      newBalanceDue,
      payment_status:   newBalanceDue <= 0 ? "paid" : "partial",
    }).eq("id", billId);

    if (billErr) {
      toast({ title: "Failed to update bill", description: billErr.message, variant: "destructive" });
    } else {
      toast({ title: `${inr(amount)} advance applied to bill ✓` });
      setApplyAmount("");
      fetchBalance();
      onRefresh();
    }

    setApplying(false);
  };

  const addDeposit = async () => {
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid deposit amount", variant: "destructive" });
      return;
    }
    if (!admissionId) return;
    setDepositing(true);

    const { error } = await (supabase as any).from("ipd_advances").insert({
      hospital_id:      hospitalId,
      admission_id:     admissionId,
      patient_id:       patientId,
      amount,
      transaction_type: "deposit",
      payment_mode:     depositMode,
      reference_no:     depositRef.trim() || null,
      description:      "Advance deposit",
    });

    if (error) {
      toast({ title: "Failed to record deposit", description: error.message, variant: "destructive" });
    } else {
      // Sync to bill_payments so billing totals, analytics, and dashboard reflect this receipt
      if (admissionId) {
        await syncAdvanceToBill({
          admissionId,
          hospitalId,
          amount,
          paymentMode: depositMode,
          referenceNo: depositRef.trim() || null,
          notes: "Advance deposit",
        });
      }
      toast({ title: `${inr(amount)} advance deposited ✓` });
      setDepositAmount("");
      setDepositRef("");
      setShowDeposit(false);
      fetchBalance();
      onRefresh();
    }
    setDepositing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="animate-spin text-muted-foreground" size={20} />
      </div>
    );
  }

  if (!admissionId) {
    return (
      <div className="p-4 text-center text-[13px] text-muted-foreground">
        Advance application is only available for IPD bills linked to an admission.
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Balance summary */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: "Total Deposited",   value: balance?.total_deposited ?? 0, color: "text-emerald-700" },
          { label: "Refunded",          value: totalRefunded,                  color: totalRefunded > 0 ? "text-blue-600" : "text-slate-400" },
          { label: "Applied (debited)", value: totalDebited,                   color: totalDebited > 0 ? "text-orange-600" : "text-slate-400" },
          { label: "Available Balance", value: (balance?.balance ?? 0) - totalAmount + directCashPaid, color: (balance?.balance ?? 0) - totalAmount + directCashPaid > 0 ? "text-blue-700 font-bold" : (balance?.balance ?? 0) - totalAmount + directCashPaid === 0 ? "text-emerald-700 font-bold" : "text-red-600 font-bold" },
          { label: "Actual Bill",       value: totalAmount,                    color: "text-foreground" },
        ].map(s => (
          <div key={s.label} className="border border-border rounded-lg p-2.5 bg-card">
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
            <p className={cn("text-[15px] mt-0.5", s.color)}>{inr(s.value)}</p>
          </div>
        ))}
      </div>

      {/* Current bill status */}
      <div className="bg-muted/40 rounded-lg p-3 text-[12px] space-y-1">
        <div className="flex justify-between"><span className="text-muted-foreground">Bill Total</span><span>{inr(totalAmount)}</span></div>
        {(availableToApply + totalDebited) > 0 && (
          <div className="flex justify-between text-emerald-700">
            <span>└ Net Advance Balance</span>
            <span>- {inr(availableToApply + totalDebited)}</span>
          </div>
        )}
        {directCashPaid > 0 && (
          <div className="flex justify-between text-emerald-700">
            <span>└ Cash / Card / UPI</span>
            <span>- {inr(directCashPaid)}</span>
          </div>
        )}
        <div className={cn("flex justify-between font-bold border-t border-border pt-1", isRefund ? "text-blue-700" : balanceAfterApply === 0 ? "text-emerald-700" : "text-red-600")}>
          <span>{isRefund ? "⬅ Refund Due" : balanceAfterApply === 0 ? "✓ Settled" : "Balance Due"}</span>
          <span>
            {isRefund
              ? inr(Math.abs(balanceAfterApply))
              : balanceAfterApply === 0
              ? "Nil"
              : inr(balanceAfterApply)}
          </span>
        </div>
      </div>

      {/* Apply advance */}
      {availableToApply > 0 && balanceAfterApply > 0 && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-3">
          <p className="text-[13px] font-semibold text-blue-800 flex items-center gap-1.5">
            <Wallet size={14} /> Apply Advance to This Bill
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Amount to apply (max {inr(Math.min(availableToApply, balanceAfterApply))})</Label>
              <Input
                type="number"
                className="mt-1 h-9"
                value={applyAmount}
                onChange={e => setApplyAmount(e.target.value)}
                max={Math.min(availableToApply, balanceAfterApply)}
                min={1}
                step={1}
              />
            </div>
            <Button
              className="h-9 bg-blue-600 hover:bg-blue-700 gap-1 shrink-0"
              onClick={applyAdvance}
              disabled={applying || !applyAmount}
            >
              {applying ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Apply
            </Button>
          </div>
          <button
            className="text-[11px] text-blue-600 underline"
            onClick={() => setApplyAmount(String(Math.min(availableToApply, balanceAfterApply)))}
          >
            Apply full balance ({inr(Math.min(availableToApply, balanceAfterApply))})
          </button>
        </div>
      )}

      {availableToApply <= 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded p-3 text-[12px] text-amber-800">
          <AlertCircle size={14} />
          No advance balance available for this admission.
        </div>
      )}

      {balanceAfterApply === 0 && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded p-3 text-[12px] text-emerald-800">
          <CheckCircle2 size={14} />
          Bill fully settled — no balance due.
        </div>
      )}
      {isRefund && paymentStatus !== 'refunded' && (
        <div className="flex items-start justify-between gap-3 bg-blue-50 border border-blue-200 rounded p-3">
          <div className="flex items-start gap-2 text-[12px] text-blue-800">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Patient has overpaid — refund required</p>
              <p className="mt-0.5 text-blue-600">
                Refund due: <strong>{inr(Math.abs(balanceAfterApply))}</strong>
              </p>
            </div>
          </div>
          <Button size="sm" className="h-8 text-xs shrink-0" onClick={() => setShowRefundModal(true)}>
            Process Refund
          </Button>
        </div>
      )}
      {isRefund && paymentStatus !== 'refunded' && showRefundModal && (
        <RefundModal
          open={showRefundModal}
          onClose={() => setShowRefundModal(false)}
          billId={billId}
          patientId={patientId}
          admissionId={admissionId}
          hospitalId={hospitalId}
          refundAmount={Math.abs(balanceAfterApply)}
          onRefunded={() => { setShowRefundModal(false); fetchBalance(); onRefresh(); }}
        />
      )}

      {/* Add deposit */}
      <div>
        <button
          onClick={() => setShowDeposit(v => !v)}
          className="text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <Plus size={13} /> Collect additional advance deposit
        </button>

        {showDeposit && (
          <div className="mt-3 border border-border rounded-lg p-4 space-y-3">
            <p className="text-[13px] font-medium">Record Advance Deposit</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount (₹)</Label>
                <Input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Payment Mode</Label>
                <select value={depositMode} onChange={e => setDepositMode(e.target.value)}
                  className="mt-1 w-full h-8 text-sm border border-border rounded-md px-2 bg-background">
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="cheque">Cheque</option>
                  <option value="net_banking">Net Banking</option>
                </select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Reference / Transaction No. (optional)</Label>
                <Input value={depositRef} onChange={e => setDepositRef(e.target.value)} placeholder="UPI ref, cheque no..." className="mt-1 h-8 text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-8 text-xs" onClick={addDeposit} disabled={depositing || !depositAmount}>
                {depositing ? <Loader2 size={12} className="animate-spin" /> : "Collect Deposit"}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowDeposit(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* Transaction log */}
      {transactions.length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Advance Transactions</p>
          <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
            {transactions.map(tx => (
              <div key={tx.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                <Badge
                  variant="outline"
                  className={cn("text-[9px] shrink-0",
                    tx.transaction_type === "deposit"      ? "border-emerald-400 text-emerald-700" :
                    tx.transaction_type === "service_debit"? "border-orange-400 text-orange-700"   :
                    tx.transaction_type === "refund"       ? "border-blue-400 text-blue-700"        :
                    "border-slate-400 text-slate-600"
                  )}
                >
                  {tx.transaction_type.replace("_", " ")}
                </Badge>
                <span className={cn("font-semibold",
                  tx.transaction_type === "deposit" ? "text-emerald-700" : "text-orange-700"
                )}>
                  {tx.transaction_type === "deposit" ? "+" : "-"}{inr(tx.amount)}
                </span>
                {tx.payment_mode && <span className="text-muted-foreground capitalize">{tx.payment_mode}</span>}
                {tx.description && <span className="text-muted-foreground truncate flex-1">{tx.description}</span>}
                <span className="text-muted-foreground shrink-0">
                  {new Date(tx.created_at).toLocaleDateString("en-IN")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvanceApplicationTab;
