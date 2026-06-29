import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Clock, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/currency";
import { format, formatDistanceToNow } from "date-fns";

interface ApprovalRow {
  id: string;
  discount_amount: number;
  discount_pct: number;
  reason: string;
  required_approver_role: string;
  requested_at: string;
  status: string;
  bill_id: string;
  bill: { bill_number: string; total_amount: number; bill_type: string; patient_name?: string } | null;
  patient: { full_name: string; uhid: string } | null;
  requester: { full_name: string } | null;
}

interface Props {
  hospitalId: string;
  onBillSelect?: (billId: string) => void;
}

const ROLE_LABELS: Record<string, string> = {
  billing_supervisor: "Billing Supervisor",
  cfo: "CFO / Finance",
  admin: "Administrator",
  none: "Auto-approved",
};

const DiscountApprovalsInbox: React.FC<Props> = ({ hospitalId, onBillSelect }) => {
  const { toast } = useToast();
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any)
      .from("bill_discount_approvals")
      .select("*, bill:bills(bill_number, total_amount, bill_type, patient_id, patients!bills_patient_id_fkey(full_name, uhid)), requester:users!bill_discount_approvals_requested_by_fkey(full_name)")
      .eq("hospital_id", hospitalId)
      .order("requested_at", { ascending: false });
    if (filter === "pending") q = q.eq("status", "pending");
    const { data } = await q;
    setApprovals(
      (data || []).map((r: any) => ({
        ...r,
        patient: r.bill?.patients || null,
      }))
    );
    setLoading(false);
  }, [hospitalId, filter]);

  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => setCurrentUserId(data?.id || null));
    });
  }, []);

  const applyDiscountAndApprove = async (row: ApprovalRow) => {
    setProcessingId(row.id);
    // Fetch bill to get subtotal
    const { data: billData } = await supabase.from("bills")
      .select("subtotal, gst_amount, advance_received, insurance_amount, paid_amount")
      .eq("id", row.bill_id).maybeSingle();
    if (!billData) { toast({ title: "Bill not found", variant: "destructive" }); setProcessingId(null); return; }
    const subtotal = Number(billData.subtotal) || 0;
    const newTotal = Math.max(0, subtotal + Number(billData.gst_amount) - row.discount_amount);
    const newPatientPayable = Math.max(0, newTotal - Number(billData.advance_received) - Number(billData.insurance_amount));
    const newBalance = Math.max(0, newPatientPayable - Number(billData.paid_amount));
    const { error: billErr } = await supabase.from("bills").update({
      discount_amount: row.discount_amount,
      discount_percent: row.discount_pct,
      total_amount: Math.round(newTotal * 100) / 100,
      patient_payable: Math.round(newPatientPayable * 100) / 100,
      balance_due: Math.round(newBalance * 100) / 100,
      bill_status: "draft",
    } as any).eq("id", row.bill_id);
    if (billErr) { toast({ title: "Failed to apply discount", variant: "destructive" }); setProcessingId(null); return; }
    await (supabase as any).from("bill_discount_approvals").update({
      status: "approved",
      approved_by: currentUserId,
      approved_at: new Date().toISOString(),
    }).eq("id", row.id);
    toast({ title: `Discount of ${formatINR(row.discount_amount)} approved for Bill #${row.bill?.bill_number}` });
    setProcessingId(null);
    fetchApprovals();
  };

  const handleReject = async (row: ApprovalRow) => {
    setProcessingId(row.id);
    await (supabase as any).from("bill_discount_approvals").update({
      status: "rejected",
      approved_by: currentUserId,
      approved_at: new Date().toISOString(),
      rejection_reason: rejectionReason || "Rejected by approver",
    }).eq("id", row.id);
    await supabase.from("bills").update({ bill_status: "draft" } as any).eq("id", row.bill_id);
    toast({ title: "Discount request rejected" });
    setRejectingId(null);
    setRejectionReason("");
    setProcessingId(null);
    fetchApprovals();
  };

  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card flex items-center gap-3">
        <Shield size={16} className="text-primary" />
        <h2 className="text-sm font-bold text-foreground">Discount Approval Inbox</h2>
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
        ) : approvals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <CheckCircle2 size={40} className="text-emerald-500/50" />
            <p className="text-sm font-medium text-muted-foreground">
              {filter === "pending" ? "No pending discount approvals" : "No approval records found"}
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {approvals.map((row) => (
              <div
                key={row.id}
                className={cn(
                  "bg-card border rounded-xl overflow-hidden",
                  row.status === "pending" ? "border-amber-300" : "border-border"
                )}
              >
                {/* Row header */}
                <div className={cn(
                  "px-4 py-2.5 flex items-center gap-3",
                  row.status === "pending" ? "bg-amber-50" : "bg-muted/30"
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">
                        {row.patient?.full_name || "—"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{row.patient?.uhid}</span>
                      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium uppercase">
                        {row.bill?.bill_type}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Bill #{row.bill?.bill_number} · Total {formatINR(Number(row.bill?.total_amount) || 0)}
                    </p>
                  </div>
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize",
                    row.status === "pending" ? "bg-amber-200 text-amber-800" :
                    row.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                    "bg-destructive/10 text-destructive"
                  )}>
                    {row.status === "pending" ? <><Clock size={10} className="inline mr-0.5" />Pending</> : row.status}
                  </span>
                </div>

                {/* Details */}
                <div className="px-4 py-3 grid grid-cols-3 gap-3 text-xs border-t border-border/50">
                  <div>
                    <p className="text-muted-foreground">Discount Requested</p>
                    <p className="font-bold text-destructive text-base">{formatINR(row.discount_amount)}</p>
                    <p className="text-muted-foreground">{row.discount_pct.toFixed(1)}% of bill</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Required Approver</p>
                    <p className="font-medium">{ROLE_LABELS[row.required_approver_role] || row.required_approver_role}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Requested By</p>
                    <p className="font-medium">{row.requester?.full_name || "—"}</p>
                    <p className="text-muted-foreground">{formatDistanceToNow(new Date(row.requested_at), { addSuffix: true })}</p>
                  </div>
                </div>

                <div className="px-4 pb-3 text-xs">
                  <p className="text-muted-foreground font-medium">Reason</p>
                  <p className="text-foreground mt-0.5 bg-muted/40 rounded-lg px-3 py-2">{row.reason}</p>
                </div>

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
                {row.status === "pending" && (
                  <div className="px-4 pb-3 flex items-center justify-between border-t border-border/50 pt-3">
                    {onBillSelect && (
                      <button
                        onClick={() => onBillSelect(row.bill_id)}
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
                          onClick={() => applyDiscountAndApprove(row)}
                          disabled={processingId === row.id}
                          className="flex items-center gap-1.5 text-xs px-4 py-1.5 bg-emerald-500 text-white rounded-lg font-semibold hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 size={13} />
                          {processingId === row.id ? "Approving…" : "Approve & Apply"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DiscountApprovalsInbox;
