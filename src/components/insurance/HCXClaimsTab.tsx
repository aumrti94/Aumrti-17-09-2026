import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  RefreshCw, Send, CheckCircle2, Clock, AlertCircle, ChevronDown,
  ChevronRight, ShieldCheck, FileText, Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────

interface HcxBillRow {
  id: string;
  bill_number: string;
  bill_date: string;
  total_amount: number;
  insurance_amount: number | null;
  bill_status: string;
  patient_id: string;
  admission_id: string | null;
  // from patients join
  patient_name: string;
  // from insurance_claims join (may be absent)
  claim_id: string | null;
  hcx_claim_id: string | null;
  hcx_correlation_id: string | null;
  hcx_status: HcxStatus | null;
  hcx_submitted_at: string | null;
  claim_status: string | null;
}

type HcxStatus = "submitted" | "acknowledged" | "processing" | "approved" | "rejected" | "error";

// ─── HCX status display helpers ──────────────────────────────────────────────

const HCX_STATUS_META: Record<HcxStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  submitted:    { label: "Submitted",    cls: "bg-blue-100 text-blue-700 border-blue-200",     icon: <Send className="h-3 w-3" /> },
  acknowledged: { label: "Acknowledged", cls: "bg-cyan-100 text-cyan-700 border-cyan-200",      icon: <Clock className="h-3 w-3" /> },
  processing:   { label: "Processing",   cls: "bg-amber-100 text-amber-700 border-amber-200",   icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
  approved:     { label: "Approved",     cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected:     { label: "Rejected",     cls: "bg-red-100 text-red-600 border-red-200",         icon: <AlertCircle className="h-3 w-3" /> },
  error:        { label: "Error",        cls: "bg-red-100 text-red-600 border-red-200",         icon: <AlertCircle className="h-3 w-3" /> },
};

// Pre-auth → approved → claim submitted → claim approved → settled
const HCX_LIFECYCLE: Array<{ key: string; label: string }> = [
  { key: "preauth",           label: "Pre-Auth Sent" },
  { key: "preauth_approved",  label: "Pre-Auth Approved" },
  { key: "claim_submitted",   label: "Claim Submitted" },
  { key: "claim_approved",    label: "Claim Approved" },
  { key: "settled",           label: "Settled" },
];

function lifecycleStep(row: HcxBillRow): number {
  if (row.claim_status === "settled") return 4;
  if (row.hcx_status === "approved" && row.claim_id) return 3;
  if (row.hcx_status === "submitted" && row.claim_id) return 2;
  if (row.hcx_status === "approved") return 1;
  if (row.hcx_status === "submitted") return 0;
  return -1;
}

// ─── HCX Claims Tab ───────────────────────────────────────────────────────────

const HCXClaimsTab: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [bills, setBills] = useState<HcxBillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hcxEnabled, setHcxEnabled] = useState(false);

  const fetchBills = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    // Check HCX feature flag
    const { data: cfg } = await supabase
      .from("hospital_abdm_config" as any)
      .select("feature_hcx_claims")
      .eq("hospital_id", hospitalId)
      .maybeSingle();
    setHcxEnabled(!!(cfg as any)?.feature_hcx_claims);

    // Fetch insurance-type bills (not self-pay, not already settled)
    const { data: rawBills } = await supabase
      .from("bills")
      .select(`
        id, bill_number, bill_date, total_amount, insurance_amount,
        bill_status, patient_id, admission_id,
        patients!inner(full_name)
      `)
      .eq("hospital_id", hospitalId)
      .in("bill_status", ["final", "draft", "submitted"])
      .order("bill_date", { ascending: false })
      .limit(100) as any;

    // Fetch HCX claim status for each bill
    const billIds = (rawBills ?? []).map((b: any) => b.id);
    const { data: claims } = await supabase
      .from("insurance_claims")
      .select("id, bill_id, hcx_claim_id, hcx_correlation_id, hcx_status, hcx_submitted_at, status")
      .in("bill_id", billIds.length > 0 ? billIds : ["00000000-0000-0000-0000-000000000000"])
      .eq("hospital_id", hospitalId) as any;

    const claimByBillId = new Map<string, any>();
    for (const c of (claims ?? [])) {
      claimByBillId.set(c.bill_id, c);
    }

    const rows: HcxBillRow[] = (rawBills ?? []).map((b: any) => {
      const c = claimByBillId.get(b.id);
      return {
        id: b.id,
        bill_number: b.bill_number,
        bill_date: b.bill_date,
        total_amount: Number(b.total_amount ?? 0),
        insurance_amount: b.insurance_amount ? Number(b.insurance_amount) : null,
        bill_status: b.bill_status,
        patient_id: b.patient_id,
        admission_id: b.admission_id,
        patient_name: b.patients?.full_name ?? "—",
        claim_id: c?.id ?? null,
        hcx_claim_id: c?.hcx_claim_id ?? null,
        hcx_correlation_id: c?.hcx_correlation_id ?? null,
        hcx_status: c?.hcx_status ?? null,
        hcx_submitted_at: c?.hcx_submitted_at ?? null,
        claim_status: c?.status ?? null,
      };
    });

    setBills(rows);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const handleSubmit = async (row: HcxBillRow, claimType: "preauth" | "claim") => {
    if (!hospitalId) return;
    setSubmitting(row.id + claimType);
    try {
      const { data, error } = await supabase.functions.invoke("hcx-claim-submit", {
        body: { hospital_id: hospitalId, bill_id: row.id, claim_type: claimType },
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string; claim_id?: string; mode?: string; message?: string };
      if (!res.success) throw new Error(res.error ?? "Submission failed");
      toast({
        title: `HCX ${claimType === "preauth" ? "Pre-Auth" : "Claim"} submitted`,
        description: `${res.mode === "sandbox" ? "[Sandbox] " : ""}${res.message}`,
      });
      await fetchBills();
    } catch (err) {
      toast({
        title: "HCX submission failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
    setSubmitting(null);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!hcxEnabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
        <ShieldCheck className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-sm font-medium text-foreground">HCX Claims Exchange not enabled</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Enable HCX in <strong>Settings → ABDM</strong> (feature_hcx_claims). Configure participant code and credentials to submit claims via the NHCX gateway.
        </p>
      </div>
    );
  }

  const pendingBills = bills.filter(b => !b.hcx_status || b.hcx_status === "error");
  const submittedBills = bills.filter(b => b.hcx_status && b.hcx_status !== "error");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b bg-card">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-violet-100 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">
            <Zap className="h-3 w-3" />
            HCX Protocol
          </span>
          <span className="text-xs text-muted-foreground">{pendingBills.length} pending · {submittedBills.length} submitted</span>
        </div>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={fetchBills} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">

        {/* ── Pending submissions ─────────────────────────────────────────── */}
        {pendingBills.length > 0 && (
          <section>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Pending HCX Submission ({pendingBills.length})
            </p>
            <div className="space-y-2">
              {pendingBills.map((row) => (
                <div key={row.id} className="rounded-lg border bg-card px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold">{row.bill_number}</span>
                      <span className="text-[10px] text-muted-foreground">{row.patient_name}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">{row.bill_date}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      ₹{row.total_amount.toLocaleString("en-IN")}
                      {row.insurance_amount ? ` (₹${Number(row.insurance_amount).toLocaleString("en-IN")} insured)` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {row.hcx_status === "error" && (
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium", HCX_STATUS_META.error.cls)}>
                        {HCX_STATUS_META.error.icon} Error — retry
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      disabled={submitting === row.id + "preauth"}
                      onClick={() => handleSubmit(row, "preauth")}
                    >
                      {submitting === row.id + "preauth" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                      Pre-Auth
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={submitting === row.id + "claim"}
                      onClick={() => handleSubmit(row, "claim")}
                    >
                      {submitting === row.id + "claim" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Submit Claim
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Submitted / in-flight ───────────────────────────────────────── */}
        {submittedBills.length > 0 && (
          <section>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
              HCX Claim Tracker ({submittedBills.length})
            </p>
            <div className="space-y-2">
              {submittedBills.map((row) => {
                const meta = row.hcx_status ? (HCX_STATUS_META[row.hcx_status] ?? HCX_STATUS_META.submitted) : HCX_STATUS_META.submitted;
                const step = lifecycleStep(row);
                const isOpen = expanded === row.id;

                return (
                  <div key={row.id} className="rounded-lg border bg-card">
                    <button
                      className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-muted/30 transition-colors"
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold">{row.bill_number}</span>
                          <span className="text-[10px] text-muted-foreground">{row.patient_name}</span>
                          <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium", meta.cls)}>
                            {meta.icon} {meta.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          ₹{row.total_amount.toLocaleString("en-IN")} · submitted {row.hcx_submitted_at ? new Date(row.hcx_submitted_at).toLocaleDateString("en-IN") : "—"}
                        </p>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 border-t bg-muted/20">
                        {/* Lifecycle timeline */}
                        <div className="flex items-center gap-0 mt-3 mb-3">
                          {HCX_LIFECYCLE.map((lc, idx) => (
                            <React.Fragment key={lc.key}>
                              <div className="flex flex-col items-center gap-1">
                                <div className={cn(
                                  "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2",
                                  idx <= step
                                    ? "bg-emerald-500 border-emerald-500 text-white"
                                    : "bg-muted border-border text-muted-foreground"
                                )}>
                                  {idx <= step ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{idx + 1}</span>}
                                </div>
                                <span className={cn("text-[9px] text-center leading-tight max-w-[56px]", idx <= step ? "text-emerald-700 font-medium" : "text-muted-foreground")}>
                                  {lc.label}
                                </span>
                              </div>
                              {idx < HCX_LIFECYCLE.length - 1 && (
                                <div className={cn("flex-1 h-0.5 mb-3", idx < step ? "bg-emerald-400" : "bg-border")} />
                              )}
                            </React.Fragment>
                          ))}
                        </div>

                        {/* Correlation ID */}
                        {row.hcx_correlation_id && (
                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-medium">Correlation ID:</span>{" "}
                            <code className="font-mono">{row.hcx_correlation_id}</code>
                          </div>
                        )}
                        {row.hcx_claim_id && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            <span className="font-medium">API Call ID:</span>{" "}
                            <code className="font-mono">{row.hcx_claim_id}</code>
                          </div>
                        )}

                        {/* Re-submit actions */}
                        {(row.hcx_status === "approved" || row.hcx_status === "acknowledged") && !row.claim_id && (
                          <div className="mt-3">
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              disabled={submitting === row.id + "claim"}
                              onClick={() => handleSubmit(row, "claim")}
                            >
                              {submitting === row.id + "claim" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              Submit Final Claim
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!loading && bills.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No insurance bills found.</p>
            <p className="text-xs text-muted-foreground">Bills with insurance payer type will appear here for HCX submission.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default HCXClaimsTab;
