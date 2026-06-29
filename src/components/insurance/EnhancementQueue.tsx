import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/currency";
import { CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

interface EnhancementRequest {
  id: string;
  admission_id: string;
  pre_auth_id: string;
  current_approved_amount: number;
  service_amount: number;
  additional_amount_requested: number;
  new_requested_total: number;
  new_service_description: string;
  clinical_justification: string;
  status: string;
  created_at: string;
  tpa_reference: string | null;
  tpa_response_notes: string | null;
  // joined
  pre_auth: { pre_auth_number: string | null; tpa_name: string | null } | null;
  patient_name: string | null;
  patient_uhid: string | null;
  submitted_by_name: string | null;
}

type FilterStatus = "pending" | "approved" | "rejected";

const STATUS_STYLE: Record<string, string> = {
  pending:  "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  withdrawn:"bg-muted text-muted-foreground border-border",
};

const EnhancementQueue: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<EnhancementRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("pending");
  // Per-row state for rejection flow
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  // Expandable justification
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch current user's users.id on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      (supabase as any)
        .from("users")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle()
        .then(({ data }: { data: any }) => {
          if (data?.id) setCurrentUserId(data.id);
        });
    });
  }, []);

  const loadRequests = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const { data, error } = await (supabase as any)
      .from("insurance_enhancement_requests")
      .select(`
        id, admission_id, pre_auth_id,
        current_approved_amount, service_amount,
        additional_amount_requested, new_requested_total,
        new_service_description, clinical_justification,
        status, created_at, tpa_reference, tpa_response_notes,
        insurance_pre_auth!pre_auth_id (pre_auth_number, tpa_name),
        admissions!admission_id (
          patients!patient_id (full_name, uhid)
        ),
        submitted_by_user:users!submitted_by (full_name)
      `)
      .eq("hospital_id", hospitalId)
      .eq("status", filter)
      .order("created_at", { ascending: true });

    setLoading(false);

    if (error) {
      console.error("Enhancement queue fetch error:", error.message);
      return;
    }

    setRequests(
      (data || []).map((r: any) => ({
        id: r.id,
        admission_id: r.admission_id,
        pre_auth_id: r.pre_auth_id,
        current_approved_amount: Number(r.current_approved_amount),
        service_amount: Number(r.service_amount),
        additional_amount_requested: Number(r.additional_amount_requested),
        new_requested_total: Number(r.new_requested_total),
        new_service_description: r.new_service_description,
        clinical_justification: r.clinical_justification,
        status: r.status,
        created_at: r.created_at,
        tpa_reference: r.tpa_reference ?? null,
        tpa_response_notes: r.tpa_response_notes ?? null,
        pre_auth: r.insurance_pre_auth
          ? { pre_auth_number: r.insurance_pre_auth.pre_auth_number, tpa_name: r.insurance_pre_auth.tpa_name }
          : null,
        patient_name: r.admissions?.patients?.full_name ?? null,
        patient_uhid: r.admissions?.patients?.uhid ?? null,
        submitted_by_name: r.submitted_by_user?.full_name ?? null,
      }))
    );
  }, [hospitalId, filter]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const handleApprove = async (req: EnhancementRequest) => {
    if (!currentUserId) return;
    setSubmitting(req.id);

    // 1. Mark enhancement request as approved
    const { error: reqErr } = await (supabase as any)
      .from("insurance_enhancement_requests")
      .update({
        status: "approved",
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", req.id);

    if (reqErr) {
      toast({ title: "Approval failed", description: reqErr.message, variant: "destructive" });
      setSubmitting(null);
      return;
    }

    // 2. Raise the pre-auth ceiling to the newly approved total.
    //    This is the value LineItemsTab.fetchPreAuthCeiling() will pick up after
    //    the billing editor is reloaded.
    const { error: authErr } = await (supabase as any)
      .from("insurance_pre_auth")
      .update({ approved_amount: req.new_requested_total })
      .eq("id", req.pre_auth_id);

    if (authErr) {
      // Enhancement record is already approved; log and warn but don't block
      console.error("Pre-auth ceiling update failed:", authErr.message);
      toast({
        title: "Enhancement approved — ceiling update failed",
        description: "Update insurance_pre_auth.approved_amount manually to " + formatINR(req.new_requested_total),
        variant: "destructive",
      });
    } else {
      toast({
        title: "Enhancement approved",
        description: `Pre-auth ceiling raised to ${formatINR(req.new_requested_total)} for ${req.patient_name ?? "patient"}.`,
      });
    }

    setSubmitting(null);
    loadRequests();
  };

  const handleReject = async (req: EnhancementRequest) => {
    if (!rejectReason.trim()) {
      toast({ title: "Rejection reason is required", variant: "destructive" });
      return;
    }
    if (!currentUserId) return;
    setSubmitting(req.id);

    const { error } = await (supabase as any)
      .from("insurance_enhancement_requests")
      .update({
        status: "rejected",
        tpa_response_notes: rejectReason.trim(),
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", req.id);

    setSubmitting(null);

    if (error) {
      toast({ title: "Rejection failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Enhancement rejected", description: `${req.patient_name ?? "Patient"} — billing team notified.` });
    setRejectingId(null);
    setRejectReason("");
    loadRequests();
  };

  const pendingCount = filter === "pending" ? requests.length : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-5 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-foreground">Enhancement Request Queue</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review TPA pre-auth ceiling enhancement requests submitted by the billing team.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount != null && pendingCount > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200">
              {pendingCount} pending
            </span>
          )}
          <Button variant="outline" size="sm" onClick={loadRequests} disabled={loading} className="gap-1.5 text-xs h-8">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex-shrink-0 border-b border-border bg-card px-5 flex gap-1 pt-1">
        {(["pending", "approved", "rejected"] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "text-xs font-medium px-3 py-2 border-b-2 -mb-px capitalize transition-colors",
              filter === s
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-sm text-muted-foreground gap-1">
            <CheckCircle2 size={28} className="text-muted-foreground/30 mb-1" />
            No {filter} enhancement requests.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {requests.map((req) => {
              const isRejecting = rejectingId === req.id;
              const isExpanded = expandedId === req.id;
              const isProcessing = submitting === req.id;
              const submittedAt = new Date(req.created_at).toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              });

              return (
                <div key={req.id} className="bg-card p-4 space-y-3">
                  {/* Row header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">
                          {req.patient_name ?? "Unknown Patient"}
                        </span>
                        {req.patient_uhid && (
                          <span className="text-xs text-muted-foreground font-mono">{req.patient_uhid}</span>
                        )}
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] h-4", STATUS_STYLE[req.status])}
                        >
                          {req.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {req.pre_auth?.tpa_name && (
                          <span>TPA: <strong className="text-foreground">{req.pre_auth.tpa_name}</strong></span>
                        )}
                        {req.pre_auth?.pre_auth_number && (
                          <span>Pre-Auth: <strong className="text-foreground font-mono">{req.pre_auth.pre_auth_number}</strong></span>
                        )}
                        <span>Submitted: {submittedAt}</span>
                        {req.submitted_by_name && (
                          <span>By: {req.submitted_by_name}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Amount summary */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-muted/40 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Current Ceiling</p>
                      <p className="text-sm font-bold text-foreground mt-0.5">{formatINR(req.current_approved_amount)}</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Service Added</p>
                      <p className="text-sm font-bold text-foreground mt-0.5">{formatINR(req.service_amount)}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{req.new_service_description}</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-amber-700 uppercase tracking-wide">Additional Requested</p>
                      <p className="text-sm font-bold text-amber-800 mt-0.5">+{formatINR(req.additional_amount_requested)}</p>
                    </div>
                    <div className="bg-primary/5 border border-primary/10 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-primary uppercase tracking-wide">New Total Requested</p>
                      <p className="text-sm font-bold text-primary mt-0.5">{formatINR(req.new_requested_total)}</p>
                    </div>
                  </div>

                  {/* Clinical justification (expandable) */}
                  <div className="bg-muted/30 rounded-lg px-3 py-2">
                    <button
                      className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground w-full"
                      onClick={() => setExpandedId(isExpanded ? null : req.id)}
                    >
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      Clinical Justification
                    </button>
                    {isExpanded && (
                      <p className="text-sm text-foreground mt-2 leading-relaxed">
                        {req.clinical_justification}
                      </p>
                    )}
                    {!isExpanded && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {req.clinical_justification}
                      </p>
                    )}
                  </div>

                  {/* TPA response (for reviewed records) */}
                  {req.tpa_response_notes && (
                    <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700">
                      <span className="font-semibold text-xs uppercase tracking-wide">Rejection reason: </span>
                      {req.tpa_response_notes}
                    </div>
                  )}
                  {req.tpa_reference && (
                    <div className="text-xs text-muted-foreground">
                      TPA Ref: <span className="font-mono text-foreground">{req.tpa_reference}</span>
                    </div>
                  )}

                  {/* Action buttons — pending only */}
                  {req.status === "pending" && (
                    <div className="flex items-start gap-2 pt-1">
                      {!isRejecting ? (
                        <>
                          <Button
                            size="sm"
                            className="gap-1.5 text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => handleApprove(req)}
                            disabled={isProcessing}
                          >
                            <CheckCircle2 size={13} />
                            {isProcessing ? "Approving..." : `Approve — Raise ceiling to ${formatINR(req.new_requested_total)}`}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs h-8 border-red-200 text-red-700 hover:bg-red-50"
                            onClick={() => { setRejectingId(req.id); setRejectReason(""); }}
                            disabled={isProcessing}
                          >
                            <XCircle size={13} />
                            Reject
                          </Button>
                        </>
                      ) : (
                        <div className="flex-1 space-y-2">
                          <Textarea
                            className="text-sm min-h-[60px]"
                            placeholder="Rejection reason (sent to billing team)..."
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="text-xs h-8 gap-1.5"
                              onClick={() => handleReject(req)}
                              disabled={isProcessing}
                            >
                              <XCircle size={13} />
                              {isProcessing ? "Rejecting..." : "Confirm Rejection"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-8"
                              onClick={() => { setRejectingId(null); setRejectReason(""); }}
                              disabled={isProcessing}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
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

export default EnhancementQueue;
