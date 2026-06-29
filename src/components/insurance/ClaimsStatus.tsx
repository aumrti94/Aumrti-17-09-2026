import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { differenceInDays, addDays, format } from "date-fns";
import EmptyState from "@/components/EmptyState";
import AppealLetterModal, { type AppealClaim } from "./AppealLetterModal";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { formatINR } from "@/lib/currency";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useConfigValues } from "@/hooks/useConfigValues";

interface Claim {
  id: string;
  claim_number: string | null;
  patient_name: string;
  tpa_name: string;
  claimed_amount: number;
  approved_amount: number | null;
  settled_amount: number | null;
  status: string;
  submitted_at: string | null;
  denial_reason: string | null;
  rejection_code: string | null;
  rejection_notice_date: string | null;
  appeal_deadline: string | null;
  appeal_submitted_at: string | null;
  appeal_status: string | null;
  policy_number?: string | null;
  settlement_date?: string | null;
  tpa_reference?: string | null;
  bill_id: string | null;
  pre_auth_id: string | null;
  patient_id: string;
  resubmission_count: number;
  resubmission_deadline: string | null;
}

const statusOptions = ["all", "submitted", "under_review", "approved", "partially_approved", "rejected", "settled", "written_off"];

const DENIAL_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--destructive))"];

function irdaiBadge(claim: Claim): React.ReactNode {
  if (claim.status !== "submitted" && claim.status !== "under_review") return null;
  if (!claim.submitted_at) return null;
  const deadline = addDays(new Date(claim.submitted_at), 45);
  const daysLeft = differenceInDays(deadline, new Date());
  if (daysLeft < 0) return <StatusBadge status="irdai_overdue" className="text-[10px]" />;
  if (daysLeft <= 7) return <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">IRDAI: {daysLeft}d left</Badge>;
  return <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50">IRDAI: {daysLeft}d left</Badge>;
}

function appealDeadlineBadge(claim: Claim): React.ReactNode {
  if (claim.status !== "rejected") return null;
  if (!claim.appeal_deadline) return null;
  const days = differenceInDays(new Date(claim.appeal_deadline), new Date());
  const dateStr = format(new Date(claim.appeal_deadline), "dd MMM yyyy");
  if (claim.appeal_submitted_at) {
    return <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50">✓ Appealed</Badge>;
  }
  if (days < 0)  return <Badge variant="outline" className="text-[10px] text-red-700 border-red-300 bg-red-50">⚠ Appeal deadline passed</Badge>;
  if (days <= 7) return <Badge variant="outline" className="text-[10px] text-red-700 border-red-300 bg-red-50 animate-pulse">🔴 CRITICAL — Appeal by {dateStr} ({days}d)</Badge>;
  if (days <= 14) return <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">⏰ Appeal by {dateStr} ({days}d left)</Badge>;
  return <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-200 bg-blue-50">Appeal by {dateStr} ({days}d left)</Badge>;
}

function resubmitDeadlineBadge(claim: Claim): React.ReactNode {
  if (claim.status !== "rejected") return null;
  const base = claim.resubmission_deadline || (claim.submitted_at ? addDays(new Date(claim.submitted_at), 60).toISOString() : null);
  if (!base) return null;
  const daysLeft = differenceInDays(new Date(base), new Date());
  if (daysLeft <= 0) return <Badge variant="outline" className="text-[10px] text-red-700 border-red-300 bg-red-50">Deadline Passed</Badge>;
  if (daysLeft <= 14) return <Badge variant="outline" className="text-[10px] text-red-700 border-red-300 bg-red-50">⚠ Resubmit by {format(new Date(base), "dd/MM/yy")} ({daysLeft}d)</Badge>;
  return <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">Resubmit by {format(new Date(base), "dd/MM/yy")}</Badge>;
}


interface ClaimsStatusProps {
  initialFilter?: string;
}

const ClaimsStatus: React.FC<ClaimsStatusProps> = ({ initialFilter = "all" }) => {
  const rejectionCodeOptions    = useConfigValues("claim_rejection_codes");
  const denialCategoryOptions   = useConfigValues("claim_denial_categories");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [filter, setFilter] = useState(initialFilter);
  const [loading, setLoading] = useState(true);
  const [planTier, setPlanTier] = useState("manual");
  const [appealClaim, setAppealClaim] = useState<Claim | null>(null);
  const [denialModal, setDenialModal] = useState<Claim | null>(null);
  const [denialReason, setDenialReason] = useState("");
  const [denialCategory, setDenialCategory] = useState("");
  // Enhanced rejection form state
  const [rejectionCode, setRejectionCode] = useState("");
  const [rejectionTpaRef, setRejectionTpaRef] = useState("");
  const [rejectionNoticeDate, setRejectionNoticeDate] = useState(new Date().toISOString().slice(0, 10));
  const [denialStats, setDenialStats] = useState<{ category: string; count: number }[]>([]);
  const [topDenialsByTPA, setTopDenialsByTPA] = useState<{ tpa: string; reasons: string[] }[]>([]);
  const [resubmitClaim, setResubmitClaim] = useState<Claim | null>(null);
  const [resubmitReason, setResubmitReason] = useState("");
  const [resubmitConfirmed, setResubmitConfirmed] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [tpaDecisionClaim, setTpaDecisionClaim] = useState<Claim | null>(null);
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();

  useEffect(() => { loadData(); loadDenialStats(); }, [filter]);
  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any).from("hospital_insurance_settings").select("plan_tier").eq("hospital_id", hospitalId).maybeSingle()
      .then(({ data }: any) => { if (data?.plan_tier) setPlanTier(data.plan_tier); });
  }, [hospitalId]);

  const loadData = async () => {
    setLoading(true);
    let q = supabase.from("insurance_claims").select("*").order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;

    if (!data?.length) { setClaims([]); setLoading(false); return; }

    const patientIds = [...new Set(data.map(c => c.patient_id))];
    const { data: patients } = await supabase.from("patients").select("id, full_name").in("id", patientIds);
    const pMap = Object.fromEntries((patients || []).map(p => [p.id, p.full_name]));

    setClaims(data.map(c => {
      const ca = c as any;
      return {
        id: c.id,
        claim_number: c.claim_number,
        patient_name: pMap[c.patient_id] || "Unknown",
        patient_id: c.patient_id,
        tpa_name: c.tpa_name,
        claimed_amount: Number(c.claimed_amount),
        approved_amount: c.approved_amount ? Number(c.approved_amount) : null,
        settled_amount: c.settled_amount ? Number(c.settled_amount) : null,
        status: c.status,
        submitted_at: c.submitted_at,
        denial_reason: c.denial_reason,
        policy_number: ca.policy_number || null,
        settlement_date: ca.settlement_date || null,
        tpa_reference: ca.tpa_reference || null,
        bill_id:               c.bill_id              || null,
        pre_auth_id:           ca.pre_auth_id          || null,
        rejection_code:        ca.rejection_code        || null,
        rejection_notice_date: ca.rejection_notice_date || null,
        appeal_deadline:       ca.appeal_deadline       || null,
        appeal_submitted_at:   ca.appeal_submitted_at   || null,
        appeal_status:         ca.appeal_status         || null,
        resubmission_count:    Number(ca.resubmission_count || 0),
        resubmission_deadline: ca.resubmission_deadline || null,
      };
    }));
    setLoading(false);
  };

  const loadDenialStats = async () => {
    const { data: logs } = await supabase.from("denial_logs").select("category, denial_reason, claim_id");
    if (!logs?.length) return;

    const catMap: Record<string, number> = {};
    logs.forEach(l => { const c = l.category || "other"; catMap[c] = (catMap[c] || 0) + 1; });
    setDenialStats(Object.entries(catMap).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count));

    const claimIds = [...new Set(logs.map(l => l.claim_id).filter(Boolean))];
    if (claimIds.length > 0) {
      const { data: claimData } = await supabase.from("insurance_claims").select("id, tpa_name").in("id", claimIds);
      const claimTpaMap = Object.fromEntries((claimData || []).map(c => [c.id, c.tpa_name]));
      const tpaReasons: Record<string, string[]> = {};
      logs.forEach(l => {
        const tpa = claimTpaMap[l.claim_id] || "Unknown";
        if (!tpaReasons[tpa]) tpaReasons[tpa] = [];
        if (l.denial_reason && !tpaReasons[tpa].includes(l.denial_reason)) tpaReasons[tpa].push(l.denial_reason);
      });
      setTopDenialsByTPA(Object.entries(tpaReasons).map(([tpa, reasons]) => ({ tpa, reasons: reasons.slice(0, 3) })));
    }
  };

  const printTPAReceipt = (c: Claim) => {
    const fmtAmt = (n: number | null | undefined) => n != null ? formatINR(n) : "—";
    const html = `<div style="font-family:Arial,sans-serif;padding:40px;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 4px;color:#1e3a5f">TPA Claim Receipt</h2>
      <p style="font-size:11px;color:#64748b;margin:0 0 16px">Generated on ${new Date().toLocaleString()}</p>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        <tr><td style="padding:5px 0;color:#64748b;width:40%">Claim Number</td><td style="padding:5px 0;font-weight:600">${c.claim_number || "—"}</td></tr>
        <tr><td style="padding:5px 0;color:#64748b">Patient</td><td style="padding:5px 0">${c.patient_name}</td></tr>
        <tr><td style="padding:5px 0;color:#64748b">TPA / Insurer</td><td style="padding:5px 0">${c.tpa_name}</td></tr>
        ${c.policy_number ? `<tr><td style="padding:5px 0;color:#64748b">Policy Number</td><td style="padding:5px 0">${c.policy_number}</td></tr>` : ""}
        <tr><td style="padding:5px 0;color:#64748b">Submitted On</td><td style="padding:5px 0">${c.submitted_at ? new Date(c.submitted_at).toLocaleDateString("en-IN") : "—"}</td></tr>
        ${c.settlement_date ? `<tr><td style="padding:5px 0;color:#64748b">Settlement Date</td><td style="padding:5px 0">${new Date(c.settlement_date).toLocaleDateString("en-IN")}</td></tr>` : ""}
        ${c.tpa_reference ? `<tr><td style="padding:5px 0;color:#64748b">TPA Reference</td><td style="padding:5px 0;font-family:monospace">${c.tpa_reference}</td></tr>` : ""}
        <tr><td colspan="2"><hr style="margin:12px 0;border-color:#e2e8f0" /></td></tr>
        <tr><td style="padding:5px 0;color:#64748b">Claimed Amount</td><td style="padding:5px 0">${fmtAmt(c.claimed_amount)}</td></tr>
        <tr><td style="padding:5px 0;color:#64748b">Approved Amount</td><td style="padding:5px 0;font-weight:600;color:#15803d">${fmtAmt(c.approved_amount)}</td></tr>
        ${c.settled_amount != null ? `<tr><td style="padding:5px 0;color:#64748b">Settled Amount</td><td style="padding:5px 0;font-size:16px;font-weight:700;color:#1e3a5f">${fmtAmt(c.settled_amount)}</td></tr>` : ""}
        <tr><td style="padding:5px 0;color:#64748b">Status</td><td style="padding:5px 0;font-weight:600;text-transform:capitalize">${c.status.replace("_", " ")}</td></tr>
      </table>
    </div>`;
    const w = window.open("", "_blank", "noopener,noreferrer,width=700,height=600");
    if (w) { w.document.write(`<html><head><title>TPA Receipt - ${c.claim_number || c.id}</title><style>@media print{body{padding:0}}</style></head><body>${html}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); }
  };

  const logRejectionDetails = async (claim: Claim) => {
    if (!rejectionCode && !denialReason) {
      toast({ title: "Select a rejection code or enter a reason", variant: "destructive" }); return;
    }
    if (!rejectionNoticeDate) {
      toast({ title: "Enter the date of rejection notice", variant: "destructive" }); return;
    }
    const { data: userData } = await supabase.from("users").select("hospital_id")
      .eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id || "").maybeSingle();
    const appealDeadline = addDays(new Date(rejectionNoticeDate), 30).toISOString().slice(0, 10);

    await Promise.all([
      // Update insurance_claims with structured rejection data
      (supabase as any).from("insurance_claims").update({
        denial_reason:         denialReason || null,
        rejection_code:        rejectionCode || null,
        rejection_notice_date: rejectionNoticeDate,
        appeal_deadline:       appealDeadline,
        tpa_reference_number:  rejectionTpaRef || undefined,
      }).eq("id", claim.id),

      // Also insert into denial_logs for analytics
      supabase.from("denial_logs").insert({
        hospital_id:   userData?.hospital_id || hospitalId || "",
        claim_id:      claim.id,
        denial_reason: denialReason || rejectionCode || "",
        category:      denialCategory || rejectionCode || "other",
      }),
    ]);

    toast({
      title: "Rejection details saved ✓",
      description: `Appeal deadline: ${format(new Date(appealDeadline), "dd MMM yyyy")} (30 days from notice)`,
    });
    setDenialModal(null);
    setDenialReason(""); setDenialCategory(""); setRejectionCode(""); setRejectionTpaRef("");
    setRejectionNoticeDate(new Date().toISOString().slice(0, 10));
    loadData(); loadDenialStats();
  };


  const handleResubmit = async () => {
    if (!resubmitClaim || !hospitalId) return;
    if (resubmitReason.trim().length < 20) {
      toast({ title: "Reason must be at least 20 characters", variant: "destructive" });
      return;
    }
    if (!resubmitConfirmed) {
      toast({ title: "Please confirm documents have been updated", variant: "destructive" });
      return;
    }

    setResubmitting(true);
    try {
      const c = resubmitClaim;
      const newCount = c.resubmission_count + 1;
      const claimNumber = `${c.claim_number || "CLM"}-R${newCount}`;
      const now = new Date().toISOString();

      await (supabase as any).from("insurance_claims").insert({
        hospital_id: hospitalId,
        bill_id: c.bill_id,
        patient_id: c.patient_id,
        tpa_name: c.tpa_name,
        claim_number: claimNumber,
        claimed_amount: c.claimed_amount,
        status: "submitted",
        submitted_at: now,
        pre_auth_id: c.pre_auth_id,
        parent_claim_id: c.id,
        resubmission_count: newCount,
        resubmission_deadline: addDays(new Date(), 60).toISOString(),
      });

      toast({ title: `Claim resubmitted ✓`, description: `New claim number: ${claimNumber}` });
      setResubmitClaim(null);
      setResubmitReason("");
      setResubmitConfirmed(false);
      loadData();
    } catch (e: any) {
      toast({ title: "Resubmission failed", description: e.message, variant: "destructive" });
    } finally {
      setResubmitting(false);
    }
  };

  const statusBadge = (s: string) => {
    const m: Record<string, string> = {
      submitted: "bg-blue-50 text-blue-700",
      under_review: "bg-purple-50 text-purple-700",
      approved: "bg-emerald-50 text-emerald-700",
      partially_approved: "bg-amber-50 text-amber-700",
      rejected: "bg-red-50 text-red-700",
      settled: "bg-emerald-100 text-emerald-800",
      written_off: "bg-muted text-muted-foreground",
    };
    return <Badge variant="outline" className={`text-[10px] capitalize ${m[s] || ""}`}>{s.replace("_", " ")}</Badge>;
  };

  const counts = statusOptions.slice(1).reduce((acc, s) => {
    acc[s] = claims.filter(c => c.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {statusOptions.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
              filter === s ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {s === "all" ? "All" : `${s.replace("_", " ")} ${filter === "all" && counts[s] ? `(${counts[s]})` : ""}`}
          </button>
        ))}
      </div>

      <div className="bg-background rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Claim #</TableHead>
              <TableHead className="text-[11px]">Patient</TableHead>
              <TableHead className="text-[11px]">TPA</TableHead>
              <TableHead className="text-[11px]">Claimed</TableHead>
              <TableHead className="text-[11px]">Approved</TableHead>
              <TableHead className="text-[11px]">Status</TableHead>
              <TableHead className="text-[11px]">Days</TableHead>
              <TableHead className="text-[11px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center text-sm py-8">Loading...</TableCell></TableRow>
            ) : claims.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="p-0 h-48">
                  <EmptyState icon="🏥" title="No claims to show" description="Insurance claims from billing will appear here" />
                </TableCell>
              </TableRow>
            ) : claims.map(c => (
              <TableRow key={c.id}>
                <TableCell className="text-xs font-mono">{c.claim_number || "—"}</TableCell>
                <TableCell className="text-[13px] font-medium">{c.patient_name}</TableCell>
                <TableCell className="text-xs">{c.tpa_name}</TableCell>
                <TableCell className="text-[13px] font-bold tabular-nums">{formatINR(c.claimed_amount)}</TableCell>
                <TableCell className="text-xs tabular-nums">
                  {c.approved_amount ? formatINR(c.approved_amount) : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    {statusBadge(c.status)}
                    {irdaiBadge(c)}
                    {appealDeadlineBadge(c)}
                    {resubmitDeadlineBadge(c)}
                  </div>
                </TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {c.submitted_at ? differenceInDays(new Date(), new Date(c.submitted_at)) : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {/* Record TPA Decision — for any non-terminal status */}
                    {!["settled", "written_off"].includes(c.status) && (
                      <Button size="sm" variant="outline" className="text-[10px] h-6 border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => setTpaDecisionClaim(c)}>
                        📋 Record Decision
                      </Button>
                    )}
                    {(c.status === "approved" || c.status === "settled" || c.status === "partially_approved") && (
                      <Button size="sm" variant="outline" className="text-[10px] h-6" onClick={() => printTPAReceipt(c)}>🖨️ Receipt</Button>
                    )}
                    {c.status === "rejected" && (
                      <>
                        <Button
                          size="sm"
                          className="text-[10px] h-6 bg-red-600 hover:bg-red-700 text-white"
                          onClick={() => {
                            setDenialModal(c);
                            setRejectionCode(c.rejection_code || "");
                            setRejectionTpaRef(c.tpa_reference || "");
                            setRejectionNoticeDate(c.rejection_notice_date || new Date().toISOString().slice(0, 10));
                            setDenialReason(c.denial_reason || "");
                          }}
                        >
                          📋 {c.rejection_code ? "Update Rejection" : "Log Rejection"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-6 border-violet-300 text-violet-700 hover:bg-violet-50"
                          onClick={() => setAppealClaim(c)}
                          disabled={!c.rejection_code && !c.denial_reason}
                          title={!c.rejection_code && !c.denial_reason ? "Log rejection details first" : undefined}
                        >
                          ⚖️ Appeal
                        </Button>
                        <Button size="sm" variant="outline" className="text-[10px] h-6 border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => { setResubmitClaim(c); setResubmitReason(""); setResubmitConfirmed(false); }}>
                          Resubmit
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AppealLetterModal
        open={!!appealClaim}
        onOpenChange={(open) => !open && setAppealClaim(null)}
        claim={appealClaim as AppealClaim | null}
        hospitalId={hospitalId || ""}
        planTier={planTier}
        onAppealSubmitted={() => { setAppealClaim(null); loadData(); }}
      />

      {tpaDecisionClaim && (
        <RecordTPADecisionModal
          claim={tpaDecisionClaim}
          onClose={() => setTpaDecisionClaim(null)}
          onSaved={() => { setTpaDecisionClaim(null); loadData(); loadDenialStats(); }}
        />
      )}

      {/* Enhanced Rejection Capture Modal */}
      <Dialog open={!!denialModal} onOpenChange={(open) => !open && setDenialModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              📋 Log Rejection Details
            </DialogTitle>
          </DialogHeader>
          {denialModal && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {denialModal.claim_number || "—"} · {denialModal.tpa_name} · {formatINR(denialModal.claimed_amount)}
              </div>

              <div>
                <Label className="text-sm font-semibold">Rejection Code *</Label>
                <Select value={rejectionCode} onValueChange={v => { setRejectionCode(v); setDenialCategory(v); }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select rejection reason code" /></SelectTrigger>
                  <SelectContent>
                    {rejectionCodeOptions.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-semibold">Rejection Reason (TPA's exact wording)</Label>
                <Input
                  className="mt-1"
                  value={denialReason}
                  onChange={e => setDenialReason(e.target.value)}
                  placeholder="e.g. Treatment not medically necessary as per policy clause 4.2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-semibold">TPA Rejection Reference #</Label>
                  <Input
                    className="mt-1"
                    value={rejectionTpaRef}
                    onChange={e => setRejectionTpaRef(e.target.value)}
                    placeholder="TPA/REJ/2026/XXXX"
                  />
                </div>
                <div>
                  <Label className="text-sm font-semibold">Date of Rejection Notice *</Label>
                  <Input
                    className="mt-1"
                    type="date"
                    value={rejectionNoticeDate}
                    onChange={e => setRejectionNoticeDate(e.target.value)}
                  />
                </div>
              </div>

              {rejectionNoticeDate && (
                <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                  Appeal deadline will be set to: <strong>{format(addDays(new Date(rejectionNoticeDate), 30), "dd MMM yyyy")}</strong> (30 days from notice)
                </div>
              )}

              <Button onClick={() => logRejectionDetails(denialModal)} className="w-full gap-1.5">
                Save Rejection Details &amp; Set Appeal Deadline
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resubmission Sheet */}
      <Sheet open={!!resubmitClaim} onOpenChange={(open) => !open && setResubmitClaim(null)}>
        <SheetContent className="w-[420px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Resubmit Claim</SheetTitle>
          </SheetHeader>
          {resubmitClaim && (
            <div className="space-y-4 mt-4">
              {/* Claim summary */}
              <div className="bg-muted/50 rounded-md p-3 text-sm space-y-1">
                <div><span className="text-muted-foreground">Claim #:</span> <span className="font-mono font-medium">{resubmitClaim.claim_number || "—"}</span></div>
                <div><span className="text-muted-foreground">Patient:</span> {resubmitClaim.patient_name}</div>
                <div><span className="text-muted-foreground">TPA:</span> {resubmitClaim.tpa_name}</div>
                <div><span className="text-muted-foreground">Claimed Amount:</span> <span className="font-semibold">{formatINR(resubmitClaim.claimed_amount)}</span></div>
                {resubmitClaim.resubmission_count > 0 && (
                  <div><span className="text-muted-foreground">Previous resubmissions:</span> {resubmitClaim.resubmission_count}</div>
                )}
              </div>

              <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>New claim number will be <strong>{resubmitClaim.claim_number || "CLM"}-R{resubmitClaim.resubmission_count + 1}</strong>. The original claim remains unchanged.</span>
              </div>

              <div>
                <Label className="text-sm font-semibold">Resubmission Reason *</Label>
                <Textarea
                  className="mt-1 text-sm"
                  rows={4}
                  placeholder="Describe what was corrected or updated in this resubmission (min 20 characters)…"
                  value={resubmitReason}
                  onChange={e => setResubmitReason(e.target.value)}
                />
                {resubmitReason.length > 0 && resubmitReason.length < 20 && (
                  <p className="text-xs text-red-600 mt-0.5">{20 - resubmitReason.length} more characters required</p>
                )}
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="resubmit-confirm"
                  checked={resubmitConfirmed}
                  onCheckedChange={v => setResubmitConfirmed(!!v)}
                  className="mt-0.5"
                />
                <label htmlFor="resubmit-confirm" className="text-sm cursor-pointer leading-snug">
                  I confirm the supporting documents have been corrected / updated and are ready for resubmission.
                </label>
              </div>

              <Button
                className="w-full"
                onClick={handleResubmit}
                disabled={resubmitting || resubmitReason.trim().length < 20 || !resubmitConfirmed}
              >
                {resubmitting ? "Submitting…" : "Confirm Resubmission"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Denial Analysis Section */}
      {denialStats.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-background rounded-lg border border-border p-4">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-3">Denial Categories</p>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={denialStats} dataKey="count" nameKey="category" cx="50%" cy="50%" outerRadius={60} innerRadius={30} label={({ category, count }) => `${(category as string).replace(/_/g, " ")} (${count})`} labelLine={false}>
                  {denialStats.map((_, i) => (
                    <Cell key={i} fill={DENIAL_COLORS[i % DENIAL_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number, name: string) => [v, name.replace(/_/g, " ")]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-background rounded-lg border border-border p-4">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-3">Top Denial Reasons by TPA</p>
            <div className="space-y-3">
              {topDenialsByTPA.map(t => (
                <div key={t.tpa}>
                  <p className="text-[13px] font-medium text-foreground">{t.tpa}</p>
                  <ul className="ml-3 mt-1 space-y-0.5">
                    {t.reasons.map((r, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground">• {r}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {topDenialsByTPA.length === 0 && <p className="text-xs text-muted-foreground">No denial data yet</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DECISION_STATUSES = [
  { value: "approved", label: "Approved", cls: "bg-emerald-600 text-white border-emerald-600" },
  { value: "partially_approved", label: "Partially Approved", cls: "bg-amber-500 text-white border-amber-500" },
  { value: "under_review", label: "Under Review", cls: "bg-purple-600 text-white border-purple-600" },
  { value: "rejected", label: "Rejected", cls: "bg-red-600 text-white border-red-600" },
  { value: "settled", label: "Settled", cls: "bg-emerald-800 text-white border-emerald-800" },
  { value: "written_off", label: "Write Off", cls: "bg-slate-600 text-white border-slate-600" },
] as const;

const RecordTPADecisionModal: React.FC<{
  claim: Claim;
  onClose: () => void;
  onSaved: () => void;
}> = ({ claim, onClose, onSaved }) => {
  const [status, setStatus] = useState(claim.status === "rejected" ? "rejected" : "approved");
  const [approvedAmount, setApprovedAmount] = useState(claim.approved_amount?.toString() || "");
  const [tpaReference, setTpaReference] = useState(claim.tpa_reference || "");
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().slice(0, 10));
  const [denialReason, setDenialReason] = useState(claim.denial_reason || "");
  const [denialCategory, setDenialCategory] = useState("");
  const [writeOffReason, setWriteOffReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();

  const save = async () => {
    setSaving(true);
    const payload: Record<string, any> = { status, tpa_reference: tpaReference || null };
    if (["approved", "partially_approved"].includes(status)) {
      payload.approved_amount = Number(approvedAmount) || null;
    }
    if (status === "settled") {
      payload.approved_amount = Number(approvedAmount) || null;
      payload.settled_amount = Number(approvedAmount) || null;
      payload.settlement_date = settlementDate;
    }
    if (status === "rejected") {
      payload.denial_reason = denialReason || null;
    }
    if (status === "written_off") {
      payload.denial_reason = writeOffReason || null;
    }
    await supabase.from("insurance_claims").update(payload).eq("id", claim.id);

    if (status === "rejected" && denialCategory && denialReason) {
      const { data: userData } = await supabase.from("users").select("hospital_id")
        .eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id || "").maybeSingle();
      await supabase.from("denial_logs").insert({
        hospital_id: userData?.hospital_id || hospitalId || "",
        claim_id: claim.id,
        denial_reason: denialReason,
        category: denialCategory,
      });
    }

    setSaving(false);
    toast({ title: `Claim updated: ${status.replace(/_/g, " ")} ✓` });
    onSaved();
  };

  const needsAmount = ["approved", "partially_approved", "settled"].includes(status);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Record TPA Decision</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
            {claim.claim_number || "—"} · {claim.tpa_name} · {formatINR(claim.claimed_amount)}
          </div>

          <div>
            <Label className="text-sm font-semibold">TPA Decision</Label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {DECISION_STATUSES.map(d => (
                <button
                  key={d.value}
                  onClick={() => setStatus(d.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    status === d.value ? d.cls : "bg-background border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {needsAmount && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-semibold">
                  {status === "settled" ? "Settled Amount (₹)" : "Approved Amount (₹)"}
                </Label>
                <input type="number" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={approvedAmount} onChange={e => setApprovedAmount(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label className="text-sm font-semibold">TPA Reference</Label>
                <input type="text" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={tpaReference} onChange={e => setTpaReference(e.target.value)} placeholder="TPA auth code" />
              </div>
            </div>
          )}

          {status === "settled" && (
            <div>
              <Label className="text-sm font-semibold">Settlement Date</Label>
              <input type="date" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={settlementDate} onChange={e => setSettlementDate(e.target.value)} />
            </div>
          )}

          {status === "rejected" && (
            <>
              <div>
                <Label className="text-sm font-semibold">Denial Category</Label>
                <Select value={denialCategory} onValueChange={setDenialCategory}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {denialCategoryOptions.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-semibold">Denial Reason</Label>
                <input type="text" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={denialReason} onChange={e => setDenialReason(e.target.value)} placeholder="Specific reason from TPA" />
              </div>
            </>
          )}

          {status === "written_off" && (
            <div>
              <Label className="text-sm font-semibold">Write-Off Reason</Label>
              <input type="text" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={writeOffReason} onChange={e => setWriteOffReason(e.target.value)} placeholder="Reason for writing off this claim" />
            </div>
          )}

          {!needsAmount && !["rejected", "written_off"].includes(status) && (
            <div>
              <Label className="text-sm font-semibold">TPA Reference (optional)</Label>
              <input type="text" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={tpaReference} onChange={e => setTpaReference(e.target.value)} placeholder="TPA case ID or reference" />
            </div>
          )}

          <Button onClick={save} disabled={saving} className="w-full gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save TPA Decision
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ClaimsStatus;
