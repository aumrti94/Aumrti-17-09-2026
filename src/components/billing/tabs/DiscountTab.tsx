import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Clock, XCircle, Shield, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/currency";
import { format, formatDistanceToNow } from "date-fns";
import type { BillRecord } from "@/pages/billing/BillingPage";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { roleLabels, canApproveTier } from "@/lib/appRoles";

interface DiscountRules {
  t1_amount: number;
  t1_pct: number;
  t2_amount: number;
  t2_pct: number;
  /** Roles authorized to approve tier 2 / tier 3. Admin/Super Admin always override. */
  t2_roles: string[];
  t3_roles: string[];
}

interface DiscountApproval {
  id: string;
  discount_amount: number;
  discount_pct: number;
  reason: string;
  required_approver_role: string;
  required_approver_roles: string[] | null;
  requested_at: string;
  approved_at: string | null;
  status: string;
  rejection_reason: string | null;
  requester: { full_name: string } | null;
  approver: { full_name: string } | null;
}

interface Props {
  bill: BillRecord;
  hospitalId: string | null;
  onRefresh: () => void;
  userRole?: string;
}

/** Sentinel rejection_reason marking a request the REQUESTER withdrew, not one an approver refused. */
const CANCELLED_BY_REQUESTER = "Cancelled by requester";

const DEFAULT_RULES: DiscountRules = {
  t1_amount: 500, t1_pct: 5, t2_amount: 2000, t2_pct: 15,
  t2_roles: ["billing_executive"], t3_roles: ["cfo"],
};

const DiscountTab: React.FC<Props> = ({ bill, hospitalId, onRefresh, userRole }) => {
  const { toast } = useToast();
  const [rules, setRules] = useState<DiscountRules>(DEFAULT_RULES);
  const [approval, setApproval] = useState<DiscountApproval | null>(null);
  const [inputMode, setInputMode] = useState<"amount" | "pct">("amount");
  const [discountInput, setDiscountInput] = useState("");
  const [reason, setReason] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadRulesAndApproval = useCallback(async () => {
    if (!hospitalId) return;
    const [{ data: setting }, { data: approvalRows }] = await Promise.all([
      (supabase as any).from("hospital_settings").select("value").eq("hospital_id", hospitalId).eq("key", "discount_approval_rules").maybeSingle(),
      (supabase as any).from("bill_discount_approvals")
        .select("*, requester:users!bill_discount_approvals_requested_by_fkey(full_name), approver:users!bill_discount_approvals_approved_by_fkey(full_name)")
        .eq("bill_id", bill.id)
        .order("requested_at", { ascending: false })
        .limit(1),
    ]);
    if (setting?.value) {
      try { setRules({ ...DEFAULT_RULES, ...JSON.parse(setting.value) }); } catch {}
    }
    setApproval(approvalRows?.[0] || null);
  }, [hospitalId, bill.id]);

  useEffect(() => {
    loadRulesAndApproval();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => setCurrentUserId(data?.id || null));
    });
  }, [loadRulesAndApproval]);

  const subtotal = bill.subtotal || 0;

  const computeAmounts = (): { amount: number; pct: number } => {
    const val = Number(discountInput) || 0;
    if (inputMode === "amount") {
      return { amount: val, pct: subtotal > 0 ? (val / subtotal) * 100 : 0 };
    } else {
      return { amount: (subtotal * val) / 100, pct: val };
    }
  };

  // Which tier a discount falls into. The approver ROLES for each tier are configurable
  // (Settings → Approval Rules) and resolved via requiredRolesForTier below.
  const getRequiredTier = (amount: number, pct: number): "none" | "t2" | "t3" => {
    if (amount <= rules.t1_amount && pct <= rules.t1_pct) return "none";
    if (amount <= rules.t2_amount && pct <= rules.t2_pct) return "t2";
    return "t3";
  };

  const requiredRolesForTier = (tier: "none" | "t2" | "t3"): string[] =>
    tier === "t2" ? (rules.t2_roles || []) : tier === "t3" ? (rules.t3_roles || []) : [];

  const { amount: previewAmt, pct: previewPct } = computeAmounts();
  const requiredTier = getRequiredTier(previewAmt, previewPct);
  const requiredRoles = requiredRolesForTier(requiredTier);

  const applyDiscount = async (amount: number, pct: number) => {
    const { error } = await supabase.from("bills").update({
      discount_amount: Math.round(amount * 100) / 100,
      discount_percent: Math.round(pct * 100) / 100,
    } as any).eq("id", bill.id);
    if (error) return false;
    const result = await recalculateBillTotalsSafe(bill.id);
    return result.ok;
  };

  const handleSubmit = async () => {
    if (!discountInput || !reason.trim()) {
      toast({ title: "Enter discount amount and reason", variant: "destructive" });
      return;
    }
    const { amount, pct } = computeAmounts();
    if (amount <= 0) { toast({ title: "Discount must be greater than zero", variant: "destructive" }); return; }
    if (amount > subtotal) { toast({ title: "Discount cannot exceed bill subtotal", variant: "destructive" }); return; }

    setSaving(true);
    const tier = getRequiredTier(amount, pct);
    const roles = requiredRolesForTier(tier);

    if (tier === "none") {
      // Apply directly
      const ok = await applyDiscount(amount, pct);
      if (ok) {
        // Log it as an auto-approved approval for audit trail
        await (supabase as any).from("bill_discount_approvals").insert({
          hospital_id: hospitalId,
          bill_id: bill.id,
          discount_amount: amount,
          discount_pct: pct,
          reason: reason.trim(),
          required_approver_role: "none",
          required_approver_roles: [],
          requested_by: currentUserId,
          approved_by: currentUserId,
          approved_at: new Date().toISOString(),
          status: "approved",
        });
        toast({ title: `Discount of ${formatINR(amount)} applied directly (within free threshold)` });
        setShowForm(false);
        setDiscountInput("");
        setReason("");
        onRefresh();
      } else {
        toast({ title: "Failed to apply discount", variant: "destructive" });
      }
    } else {
      // Create approval request + set bill to pending_approval. The authorized role set is
      // frozen onto the row so later config changes don't retroactively alter who may approve
      // this request (and so the DB enforcement trigger can read it).
      const { error: approvalErr } = await (supabase as any).from("bill_discount_approvals").insert({
        hospital_id: hospitalId,
        bill_id: bill.id,
        discount_amount: amount,
        discount_pct: pct,
        reason: reason.trim(),
        required_approver_role: roles[0] || tier,
        required_approver_roles: roles,
        requested_by: currentUserId,
        status: "pending",
      });
      if (approvalErr) {
        toast({ title: "Failed to submit request", description: approvalErr.message, variant: "destructive" });
        setSaving(false);
        return;
      }
      await supabase.from("bills").update({ bill_status: "pending_approval" } as any).eq("id", bill.id);
      toast({ title: `Approval request submitted — awaiting ${roleLabels(roles)}` });
      setShowForm(false);
      setDiscountInput("");
      setReason("");
      onRefresh();
    }
    setSaving(false);
    loadRulesAndApproval();
  };

  const handleApprove = async () => {
    if (!approval) return;
    setSaving(true);
    const ok = await applyDiscount(approval.discount_amount, approval.discount_pct);
    if (!ok) { toast({ title: "Failed to apply discount", variant: "destructive" }); setSaving(false); return; }
    await (supabase as any).from("bill_discount_approvals").update({
      status: "approved",
      approved_by: currentUserId,
      approved_at: new Date().toISOString(),
    }).eq("id", approval.id);
    await supabase.from("bills").update({ bill_status: "draft" } as any).eq("id", bill.id);
    toast({ title: `Discount of ${formatINR(approval.discount_amount)} approved and applied` });
    setSaving(false);
    onRefresh();
    loadRulesAndApproval();
  };

  const handleReject = async () => {
    if (!approval) return;
    setSaving(true);
    await (supabase as any).from("bill_discount_approvals").update({
      status: "rejected",
      approved_by: currentUserId,
      approved_at: new Date().toISOString(),
      rejection_reason: rejectionReason || "Rejected",
    }).eq("id", approval.id);
    await supabase.from("bills").update({ bill_status: "draft" } as any).eq("id", bill.id);
    toast({ title: "Discount request rejected" });
    setShowRejectForm(false);
    setRejectionReason("");
    setSaving(false);
    onRefresh();
    loadRulesAndApproval();
  };

  const handleCancel = async () => {
    if (!approval) return;
    // bill_discount_approvals.status is CHECK-constrained to pending/approved/rejected, so a
    // withdrawal is stored as 'rejected' and told apart by this exact reason string.
    await (supabase as any).from("bill_discount_approvals").update({ status: "rejected", rejection_reason: CANCELLED_BY_REQUESTER }).eq("id", approval.id);
    await supabase.from("bills").update({ bill_status: "draft" } as any).eq("id", bill.id);
    toast({ title: "Discount request cancelled" });
    onRefresh();
    loadRulesAndApproval();
  };

  const handleRemoveDiscount = async () => {
    await supabase.from("bills").update({
      discount_amount: 0,
      discount_percent: 0,
    } as any).eq("id", bill.id);
    await recalculateBillTotalsSafe(bill.id);
    toast({ title: "Discount removed" });
    onRefresh();
    loadRulesAndApproval();
  };

  const isEditable = bill.bill_status === "draft";
  const isPendingApproval = bill.bill_status === "pending_approval";
  // `approval` is only the LATEST request. A rejected or cancelled one is history, not a
  // standing state — gating the form on its mere existence is what made a rejected discount
  // unrepeatable and an applied discount unremovable. Only a PENDING request blocks.
  const hasPendingRequest = approval?.status === "pending";
  const wasWithdrawn = approval?.status === "rejected" && approval.rejection_reason === CANCELLED_BY_REQUESTER;
  // Only a role authorized for THIS request's tier may approve it (Admin/Super Admin always
  // may — see canApproveTier). This mirrors the DB enforcement trigger.
  const canApprove = approval?.status === "pending" &&
    canApproveTier(userRole, approval.required_approver_roles ?? [approval.required_approver_role]);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">

      {/* Pending approval banner */}
      {isPendingApproval && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
          <Clock size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">Awaiting Discount Approval</p>
            <p className="text-xs text-amber-700 mt-0.5">
              This bill cannot be finalized until the discount is approved or rejected.
              {approval && <span> Requested {formatDistanceToNow(new Date(approval.requested_at), { addSuffix: true })} by {approval.requester?.full_name || "billing staff"}.</span>}
            </p>
          </div>
        </div>
      )}

      {/* Current discount display */}
      <div className="bg-muted/40 rounded-xl p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold uppercase text-muted-foreground tracking-wide">Current Discount</p>
          {bill.discount_amount > 0 && isEditable && !hasPendingRequest && (
            <button onClick={handleRemoveDiscount} className="text-[10px] text-destructive/70 hover:text-destructive font-medium transition-colors">Remove</button>
          )}
        </div>
        {bill.discount_amount > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-destructive">-{formatINR(bill.discount_amount)}</span>
            <span className="text-sm text-muted-foreground">({bill.discount_percent.toFixed(1)}% of ₹{subtotal.toLocaleString("en-IN")})</span>
            {approval?.status === "approved" && (
              <span className="ml-auto flex items-center gap-1 text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                <CheckCircle2 size={11} /> Approved by {approval.approver?.full_name || "approver"}
              </span>
            )}
            {approval?.status === "pending" && (
              <span className="ml-auto flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                <Clock size={11} /> Pending approval
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No discount applied</p>
        )}
      </div>

      {/* Threshold rules info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <Info size={15} className="text-blue-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-blue-800 mb-1.5">Discount Approval Rules</p>
            <div className="space-y-1 text-xs text-blue-700">
              <p>• Up to {formatINR(rules.t1_amount)} or {rules.t1_pct}% — <span className="font-semibold">No approval needed</span></p>
              <p>• {formatINR(rules.t1_amount)}–{formatINR(rules.t2_amount)} or {rules.t1_pct}–{rules.t2_pct}% — <span className="font-semibold">{roleLabels(rules.t2_roles)}</span> approval required</p>
              <p>• Above {formatINR(rules.t2_amount)} or {rules.t2_pct}% — <span className="font-semibold">{roleLabels(rules.t3_roles)}</span> approval required</p>
            </div>
          </div>
        </div>
      </div>

      {/* Apply / Request form. A rejected or cancelled request must be repeatable — the
          approver's "no" was to that amount and reason, not to the patient forever, and a
          cancellation is usually a correction the requester intends to redo immediately. */}
      {(isEditable || isPendingApproval) && !hasPendingRequest && bill.discount_amount === 0 && (
        <>
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full border-2 border-dashed border-border rounded-xl py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors font-medium"
            >
              {approval ? "+ Request Discount Again" : "+ Apply Discount to This Bill"}
            </button>
          ) : (
            <div className="border border-border rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-foreground">
                {approval ? "New Discount Request" : "Apply Bill-Level Discount"}
              </p>
              {approval?.status === "rejected" && (
                <p className="text-[11px] text-muted-foreground">
                  Previous request: {formatINR(approval.discount_amount)} — {approval.rejection_reason || "rejected"}.
                </p>
              )}

              {/* Input mode toggle */}
              <div className="flex gap-2 items-center">
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(["amount", "pct"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setInputMode(m); setDiscountInput(""); }}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium transition-colors",
                        inputMode === m ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {m === "amount" ? "₹ Amount" : "% Percent"}
                    </button>
                  ))}
                </div>
                <input
                  autoFocus
                  type="number"
                  min={0}
                  step={inputMode === "amount" ? "1" : "0.5"}
                  className="flex-1 px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder={inputMode === "amount" ? "e.g. 500" : "e.g. 5"}
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                />
                {discountInput && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    = {inputMode === "amount"
                      ? `${previewPct.toFixed(1)}%`
                      : formatINR(previewAmt)
                    }
                  </span>
                )}
              </div>

              {/* Preview + required role */}
              {discountInput && previewAmt > 0 && (
                <div className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
                  requiredTier === "none" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                  requiredTier === "t2" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                  "bg-destructive/10 text-destructive border border-destructive/20"
                )}>
                  {requiredTier === "none"
                    ? <><CheckCircle2 size={13} /> Within free threshold — will be applied directly</>
                    : requiredTier === "t2"
                    ? <><AlertTriangle size={13} /> Requires <strong>{roleLabels(requiredRoles)}</strong> approval</>
                    : <><Shield size={13} /> Requires <strong>{roleLabels(requiredRoles)}</strong> approval</>
                  }
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground">Reason (required)</label>
                <textarea
                  className="w-full mt-1 px-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  rows={2}
                  placeholder="e.g. Patient is a government employee (CGHS). Charity case approved by CMO."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowForm(false); setDiscountInput(""); setReason(""); }} className="text-xs px-3 py-1.5 border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
                <button
                  onClick={handleSubmit}
                  disabled={saving || !discountInput || !reason.trim()}
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg font-semibold active:scale-95 transition-all disabled:opacity-50 text-white",
                    requiredTier === "none" ? "bg-emerald-500 hover:bg-emerald-600" :
                    requiredTier === "t2" ? "bg-amber-500 hover:bg-amber-600" :
                    "bg-destructive hover:bg-destructive/90"
                  )}
                >
                  {saving ? "Processing…" :
                   requiredTier === "none" ? "Apply Discount" :
                   "Request Approval"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Pending approval actions (for approver) */}
      {approval?.status === "pending" && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-amber-800">Pending Approval Request</p>
            <span className="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold">
              {roleLabels(approval.required_approver_roles ?? [approval.required_approver_role])} required
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Requested Amount</p>
              <p className="font-bold text-destructive text-base">{formatINR(approval.discount_amount)} ({approval.discount_pct.toFixed(1)}%)</p>
            </div>
            <div>
              <p className="text-muted-foreground">Requested By</p>
              <p className="font-medium">{approval.requester?.full_name || "—"}</p>
              <p className="text-muted-foreground">{format(new Date(approval.requested_at), "dd MMM yyyy, HH:mm")}</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase">Reason</p>
            <p className="text-xs text-foreground mt-0.5 bg-white rounded-lg border border-amber-200 px-3 py-2">{approval.reason}</p>
          </div>

          {showRejectForm && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Rejection Reason</label>
              <textarea
                className="w-full mt-1 px-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none bg-white"
                rows={2}
                placeholder="Reason for rejection…"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            {/* Requester can cancel */}
            <button onClick={handleCancel} className="text-[11px] text-muted-foreground hover:text-destructive transition-colors font-medium">
              Cancel Request
            </button>
            {canApprove && !showRejectForm && (
              <div className="flex gap-2">
                <button onClick={() => setShowRejectForm(true)} className="flex items-center gap-1 text-xs px-3 py-1.5 border border-destructive/40 text-destructive rounded-lg hover:bg-destructive/10 transition-colors">
                  <XCircle size={13} /> Reject
                </button>
                <button onClick={handleApprove} disabled={saving} className="flex items-center gap-1.5 text-xs px-4 py-1.5 bg-emerald-500 text-white rounded-lg font-semibold hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50">
                  <CheckCircle2 size={13} /> Approve & Apply
                </button>
              </div>
            )}
            {showRejectForm && (
              <div className="flex gap-2">
                <button onClick={() => setShowRejectForm(false)} className="text-xs px-3 py-1.5 border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
                <button onClick={handleReject} disabled={saving} className="text-xs px-3 py-1.5 bg-destructive text-white rounded-lg font-semibold hover:bg-destructive/90 transition-all disabled:opacity-50">
                  Confirm Reject
                </button>
              </div>
            )}
            {!canApprove && !showRejectForm && (
              <span className="text-[11px] text-amber-700 font-medium">
                Awaiting {roleLabels(approval.required_approver_roles ?? [approval.required_approver_role])}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Audit trail */}
      {approval && approval.status !== "pending" && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="bg-muted/50 px-4 py-2 border-b border-border">
            <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wide">Discount Audit Trail</p>
          </div>
          <div className="p-4 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount Amount</span>
              <span className="font-semibold text-destructive">{formatINR(approval.discount_amount)} ({approval.discount_pct.toFixed(1)}%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reason</span>
              <span className="font-medium text-foreground max-w-[60%] text-right">{approval.reason}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Requested By</span>
              <span>{approval.requester?.full_name || "—"} · {format(new Date(approval.requested_at), "dd MMM yyyy, HH:mm")}</span>
            </div>
            {approval.approved_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{approval.status === "approved" ? "Approved By" : "Rejected By"}</span>
                <span className={cn("font-semibold", approval.status === "approved" ? "text-emerald-700" : "text-destructive")}>
                  {approval.approver?.full_name || "—"} · {format(new Date(approval.approved_at), "dd MMM yyyy, HH:mm")}
                </span>
              </div>
            )}
            {approval.status === "rejected" && approval.rejection_reason && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{wasWithdrawn ? "Outcome" : "Rejection Reason"}</span>
                <span className="text-destructive text-right max-w-[60%]">{approval.rejection_reason}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={cn("font-bold uppercase text-[10px] px-2 py-0.5 rounded-full",
                approval.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                wasWithdrawn ? "bg-muted text-muted-foreground" :
                approval.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-700"
              )}>
                {/* A withdrawal is not a refusal — showing "REJECTED" wrongly implies an
                    approver said no to this patient's discount. */}
                {wasWithdrawn ? "Cancelled" : approval.status === "none" ? "Auto-approved" : approval.status}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiscountTab;
