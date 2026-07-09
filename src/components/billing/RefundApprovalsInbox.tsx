import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Clock, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/currency";
import { formatDistanceToNow } from "date-fns";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasActionAccess } from "@/lib/tabPermissions";
import { autoPostJournalEntry } from "@/lib/accounting";

interface BillSummary {
  bill_number: string;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_status: string;
  bill_type: string;
}

interface RefundRow {
  id: string;
  amount: number;
  refund_mode: string;
  status: string;
  notes: string | null;
  rejection_reason: string | null;
  credit_note_id: string | null;
  bill_id: string | null;
  admission_id: string | null;
  patient_id: string | null;
  created_at: string;
  patient: { full_name: string; uhid: string } | null;
  bill: BillSummary | null;
  credit_note: { credit_note_number: string; original_bill_id: string | null; bill: BillSummary | null } | null;
  requester: { full_name: string } | null;
}

interface Props {
  hospitalId: string;
  onBillSelect?: (billId: string) => void;
}

const REFUND_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
};

const RefundApprovalsInbox: React.FC<Props> = ({ hospitalId, onBillSelect }) => {
  const { toast } = useToast();
  const { permissions, role } = useHospitalContext();
  const canApproveRefund = hasActionAccess("billing", "approve_refund", permissions, role);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const fetchRefunds = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any)
      .from("refund_payables")
      .select(`
        id, amount, refund_mode, status, notes, rejection_reason,
        credit_note_id, bill_id, admission_id, patient_id, created_at,
        patient:patients!refund_payables_patient_id_fkey(full_name, uhid),
        bill:bills!refund_payables_bill_id_fkey(bill_number, total_amount, paid_amount, balance_due, payment_status, bill_type),
        credit_note:credit_notes!refund_payables_credit_note_id_fkey(
          credit_note_number, original_bill_id,
          bill:bills!credit_notes_original_bill_id_fkey(bill_number, total_amount, paid_amount, balance_due, payment_status, bill_type)
        ),
        requester:users!refund_payables_requested_by_fkey(full_name)
      `)
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false });
    if (filter === "pending") q = q.eq("status", "pending_approval");
    const { data, error } = await q;
    if (error) console.error("Refund approvals load error:", error);
    setRefunds(data || []);
    setLoading(false);
  }, [hospitalId, filter]);

  useEffect(() => { fetchRefunds(); }, [fetchRefunds]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => setCurrentUserId(data?.id || null));
    });
  }, []);

  const effectiveBillId = (row: RefundRow) => row.bill_id || row.credit_note?.original_bill_id || null;
  const effectiveBill = (row: RefundRow) => row.bill || row.credit_note?.bill || null;

  const approveRefund = async (row: RefundRow) => {
    if (!canApproveRefund) {
      toast({ title: "You don't have permission to approve refunds", variant: "destructive" });
      return;
    }
    setProcessingId(row.id);
    const billId = effectiveBillId(row);
    const bill = effectiveBill(row);
    if (billId && bill) {
      const paidAmount = Number(bill.paid_amount || 0);
      const totalAmount = Number(bill.total_amount || 0);
      const newPaid = Math.max(paidAmount - row.amount, 0);
      const newBalance = Math.max(totalAmount - newPaid, 0);
      const newStatus = newPaid <= 0 ? "refunded" : newBalance > 0 ? "partial" : "paid";
      const { error: billErr } = await supabase.from("bills").update({
        paid_amount: newPaid,
        balance_due: newBalance,
        payment_status: newStatus,
      } as any).eq("id", billId);
      if (billErr) {
        toast({ title: "Failed to update bill", variant: "destructive" });
        setProcessingId(null);
        return;
      }
    }

    // Billing-desk cash refunds (RefundModal always sets bill_id) also record
    // an advance-ledger disbursement entry — moved here from request time so
    // nothing is disbursed before a second person approves it. Pharmacy-return
    // refunds (credit_note_id only, no bill_id) never had this entry and still
    // don't.
    if (row.bill_id && row.admission_id && row.patient_id) {
      await (supabase as any).from("ipd_advances").insert({
        hospital_id: hospitalId,
        admission_id: row.admission_id,
        patient_id: row.patient_id,
        amount: row.amount,
        transaction_type: "refund",
        payment_mode: row.refund_mode,
        description: "Refund disbursed",
        collected_by: currentUserId,
      });
    }

    // GL posting — sourceId is the refund_payables row, not the bill, since
    // the bill's posted_to_journal flag is already true from its original
    // bill_payment_* posting and would silently short-circuit this call.
    await autoPostJournalEntry({
      triggerEvent: "refund_payout",
      sourceModule: "billing",
      sourceId: row.id,
      amount: row.amount,
      description: `Refund - ${row.patient?.full_name || "Patient"}${bill ? ` - Bill ${bill.bill_number}` : ""}`,
      hospitalId,
      postedBy: currentUserId || "",
    });

    const { error } = await (supabase as any).from("refund_payables").update({
      status: "processed",
      approved_by: currentUserId,
      processed_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (error) {
      toast({ title: "Failed to approve refund", variant: "destructive" });
    } else {
      toast({ title: `Refund of ${formatINR(row.amount)} processed for ${row.patient?.full_name || "patient"}` });
    }
    setProcessingId(null);
    fetchRefunds();
  };

  const handleReject = async (row: RefundRow) => {
    if (!canApproveRefund) {
      toast({ title: "You don't have permission to approve refunds", variant: "destructive" });
      return;
    }
    setProcessingId(row.id);
    await (supabase as any).from("refund_payables").update({
      status: "rejected",
      approved_by: currentUserId,
      processed_at: new Date().toISOString(),
      rejection_reason: rejectionReason || "Rejected by approver",
    }).eq("id", row.id);
    toast({ title: "Refund request rejected" });
    setRejectingId(null);
    setRejectionReason("");
    setProcessingId(null);
    fetchRefunds();
  };

  const pendingCount = refunds.filter((r) => r.status === "pending_approval").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card flex items-center gap-3">
        <Wallet size={16} className="text-primary" />
        <h2 className="text-sm font-bold text-foreground">Refund Approval Inbox</h2>
        {pendingCount > 0 && (
          <span className="text-[10px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold">{pendingCount} Pending</span>
        )}
        <div className="ml-auto flex rounded-lg border border-border overflow-hidden">
          {(["pending", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "text-xs px-3 py-1.5 font-medium capitalize transition-colors",
                filter === f ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              {f === "pending" ? "Pending" : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : refunds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <CheckCircle2 size={40} className="text-emerald-500/50" />
            <p className="text-sm font-medium text-muted-foreground">
              {filter === "pending" ? "No pending refund approvals" : "No refund records found"}
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {refunds.map((row) => {
              const bill = effectiveBill(row);
              const billId = effectiveBillId(row);
              return (
                <div
                  key={row.id}
                  className={cn(
                    "bg-card border rounded-xl overflow-hidden",
                    row.status === "pending_approval" ? "border-amber-300" : "border-border"
                  )}
                >
                  {/* Row header */}
                  <div className={cn(
                    "px-4 py-2.5 flex items-center gap-3",
                    row.status === "pending_approval" ? "bg-amber-50" : "bg-muted/30"
                  )}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">
                          {row.patient?.full_name || "—"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{row.patient?.uhid}</span>
                        {bill?.bill_type && (
                          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium uppercase">
                            {bill.bill_type}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {bill ? `Bill #${bill.bill_number} · Total ${formatINR(Number(bill.total_amount) || 0)}` : "No bill linked"}
                        {row.credit_note?.credit_note_number && ` · Credit Note ${row.credit_note.credit_note_number}`}
                      </p>
                    </div>
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize",
                      row.status === "pending_approval" ? "bg-amber-200 text-amber-800" :
                      row.status === "processed" ? "bg-emerald-100 text-emerald-700" :
                      "bg-destructive/10 text-destructive"
                    )}>
                      {row.status === "pending_approval" ? <><Clock size={10} className="inline mr-0.5" />Pending</> : row.status}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="px-4 py-3 grid grid-cols-3 gap-3 text-xs border-t border-border/50">
                    <div>
                      <p className="text-muted-foreground">Refund Amount</p>
                      <p className="font-bold text-destructive text-base">{formatINR(row.amount)}</p>
                      <p className="text-muted-foreground">{REFUND_MODE_LABELS[row.refund_mode] || row.refund_mode}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Requested By</p>
                      <p className="font-medium">{row.requester?.full_name || "—"}</p>
                      <p className="text-muted-foreground">{formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Bill Balance</p>
                      <p className="font-medium">{bill ? formatINR(Number(bill.balance_due) || 0) : "—"}</p>
                      <p className="text-muted-foreground capitalize">{bill?.payment_status?.replace(/_/g, " ") || "—"}</p>
                    </div>
                  </div>

                  {row.notes && (
                    <div className="px-4 pb-3 text-xs">
                      <p className="text-muted-foreground font-medium">Notes</p>
                      <p className="text-foreground mt-0.5 bg-muted/40 rounded-lg px-3 py-2">{row.notes}</p>
                    </div>
                  )}
                  {row.rejection_reason && (
                    <div className="px-4 pb-3 text-xs">
                      <p className="text-muted-foreground font-medium">Rejection Reason</p>
                      <p className="text-destructive mt-0.5 bg-destructive/5 rounded-lg px-3 py-2">{row.rejection_reason}</p>
                    </div>
                  )}

                  {/* Reject inline form */}
                  {rejectingId === row.id && (
                    <div className="px-4 pb-3">
                      <textarea
                        autoFocus
                        className="w-full px-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                        rows={2}
                        placeholder="Rejection reason…"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Actions */}
                  {row.status === "pending_approval" && !canApproveRefund && (
                    <div className="px-4 pb-3 text-[11px] text-muted-foreground border-t border-border/50 pt-3">
                      You don't have permission to approve or reject refunds.
                    </div>
                  )}
                  {row.status === "pending_approval" && canApproveRefund && (
                    <div className="px-4 pb-3 flex items-center justify-between border-t border-border/50 pt-3">
                      {onBillSelect && billId && (
                        <button
                          onClick={() => onBillSelect(billId)}
                          className="text-[11px] text-primary hover:underline font-medium"
                        >
                          Open Bill →
                        </button>
                      )}
                      <div className="flex gap-2 ml-auto">
                        {rejectingId !== row.id ? (
                          <button
                            onClick={() => { setRejectingId(row.id); setRejectionReason(""); }}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 border border-destructive/40 text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
                          >
                            <XCircle size={13} /> Reject
                          </button>
                        ) : (
                          <>
                            <button onClick={() => setRejectingId(null)} className="text-xs px-3 py-1.5 border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
                            <button
                              onClick={() => handleReject(row)}
                              disabled={processingId === row.id}
                              className="text-xs px-3 py-1.5 bg-destructive text-white rounded-lg font-semibold hover:bg-destructive/90 transition-all disabled:opacity-50"
                            >
                              Confirm Reject
                            </button>
                          </>
                        )}
                        {rejectingId !== row.id && (
                          <button
                            onClick={() => approveRefund(row)}
                            disabled={processingId === row.id}
                            className="flex items-center gap-1.5 text-xs px-4 py-1.5 bg-emerald-500 text-white rounded-lg font-semibold hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50"
                          >
                            <CheckCircle2 size={13} />
                            {processingId === row.id ? "Processing…" : "Approve & Process"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default RefundApprovalsInbox;
