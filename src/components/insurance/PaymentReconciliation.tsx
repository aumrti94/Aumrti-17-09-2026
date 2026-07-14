import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { callAI } from "@/lib/aiProvider";
import { autoPostJournalEntry } from "@/lib/accounting";
import { formatINR } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, AlertTriangle, IndianRupee, Download,
  Sparkles, Loader2, ChevronRight, TrendingDown, TrendingUp,
  Scale, Clock,
} from "lucide-react";
import { differenceInDays, format, parseISO } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────

type PlanTier = "manual" | "ai_assisted" | "automated";
type AppTab   = "pending" | "dashboard" | "tpa_performance";

interface PendingClaim {
  id:                  string;
  claim_number:        string | null;
  patient_id:          string;
  patient_name:        string;
  tpa_name:            string;
  claimed_amount:      number;
  approved_amount:     number | null;
  submitted_at:        string | null;
  created_at:          string;
  // Existing reconciliation (if entered before)
  recon_id:            string | null;
  recon_paid_amount:   number | null;
  recon_advice_number: string | null;
  recon_bank_ref:      string | null;
  recon_payment_date:  string | null;
  recon_reconciled:    boolean;
  recon_dispute:       boolean;
  recon_dispute_reason:string | null;
}

interface KPIData {
  pendingAmount:            number;
  pendingCount:             number;
  receivedThisMonth:        number;
  underpaymentDisputed:     number;
  underpaymentDisputedCount:number;
  avgSettlementDays:        number | null;
  recoveryRate:             number | null;
}

interface TPAPerformance {
  tpa_name:           string;
  totalClaims:        number;
  approvedClaims:     number;
  approvalRate:       number;
  avgSettlementDays:  number | null;
  totalClaimed:       number;
  totalPaid:          number;
  underpaymentCount:  number;
  underpaymentRate:   number;
  totalReceived:      number;
}

interface PaymentForm {
  tpa_paid_amount:          string;
  payment_date:             string;
  tpa_payment_advice_number:string;
  bank_reference:           string;
}

const DISPUTE_REASONS = [
  "Wrong package rate",
  "Items not accepted by TPA",
  "Co-payment calculation error",
  "Network hospital discount error",
  "Pre-auth amount mismatch",
  "Duplicate deduction",
  "Other",
] as const;

const defaultPaymentForm = (): PaymentForm => ({
  tpa_paid_amount:           "",
  payment_date:              format(new Date(), "yyyy-MM-dd"),
  tpa_payment_advice_number: "",
  bank_reference:            "",
});

// ── KPI card ──────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ icon, label, value, sub, accent = "text-foreground" }) => (
  <div className="flex flex-col gap-1 p-4 bg-background rounded-lg border border-border">
    <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-wide">
      {icon}
      {label}
    </div>
    <p className={cn("text-2xl font-bold tabular-nums leading-none", accent)}>{value}</p>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
  </div>
);

// ── Component ──────────────────────────────────────────────────────────────

const PaymentReconciliation: React.FC = () => {
  const { hospitalId, userId } = useHospitalId() as any;
  const { toast }      = useToast();

  const [tab,              setTab]              = useState<AppTab>("pending");
  const [claims,           setClaims]           = useState<PendingClaim[]>([]);
  const [selectedId,       setSelectedId]       = useState<string | null>(null);
  const [kpis,             setKpis]             = useState<KPIData | null>(null);
  const [tpaPerf,          setTpaPerf]          = useState<TPAPerformance[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [planTier,         setPlanTier]         = useState<PlanTier>("manual");

  // Payment entry form
  const [payForm,          setPayForm]          = useState<PaymentForm>(defaultPaymentForm);
  const [submittingPay,    setSubmittingPay]    = useState(false);

  // Dispute form
  const [showDispute,      setShowDispute]      = useState(false);
  const [disputeReason,    setDisputeReason]    = useState(DISPUTE_REASONS[0] as string);
  const [disputeNotes,     setDisputeNotes]     = useState("");
  const [aiLetter,         setAiLetter]         = useState("");
  const [aiDrafting,       setAiDrafting]       = useState(false);
  const [submittingDispute,setSubmittingDispute]= useState(false);

  const selected = claims.find(c => c.id === selectedId) ?? null;

  // ── Plan tier ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("hospital_insurance_settings")
      .select("plan_tier").eq("hospital_id", hospitalId).maybeSingle()
      .then(({ data }: any) => { if (data?.plan_tier) setPlanTier(data.plan_tier); });
  }, [hospitalId]);

  // ── Data load ────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    // 1. Pending claims (approved, not reconciled)
    const { data: rawClaims } = await (supabase as any)
      .from("insurance_claims")
      .select("id, claim_number, patient_id, tpa_name, claimed_amount, approved_amount, submitted_at, created_at")
      .eq("hospital_id", hospitalId)
      .eq("status", "approved")
      .eq("reconciled", false)
      .order("submitted_at", { ascending: true, nullsFirst: false });

    const rows: any[] = rawClaims ?? [];
    let claimsList: PendingClaim[] = [];

    if (rows.length > 0) {
      const patientIds = [...new Set(rows.map(r => r.patient_id))];
      const claimIds   = rows.map(r => r.id);

      const [pRes, reconRes] = await Promise.all([
        supabase.from("patients").select("id, full_name").in("id", patientIds),
        (supabase as any)
          .from("insurance_payment_reconciliation")
          .select("id, claim_id, tpa_paid_amount, tpa_payment_advice_number, bank_reference, payment_date, reconciled, dispute_raised, dispute_reason")
          .in("claim_id", claimIds)
          .order("created_at", { ascending: false }),
      ]);

      const pMap     = Object.fromEntries((pRes.data ?? []).map((p: any) => [p.id, p.full_name]));
      // Keep only the most recent reconciliation per claim
      const reconMap: Record<string, any> = {};
      for (const r of (reconRes.data ?? [])) {
        if (!reconMap[r.claim_id]) reconMap[r.claim_id] = r;
      }

      claimsList = rows.map(r => {
        const rc = reconMap[r.id];
        return {
          id:                  r.id,
          claim_number:        r.claim_number,
          patient_id:          r.patient_id,
          patient_name:        pMap[r.patient_id] ?? "Unknown",
          tpa_name:            r.tpa_name,
          claimed_amount:      Number(r.claimed_amount ?? 0),
          approved_amount:     r.approved_amount ? Number(r.approved_amount) : null,
          submitted_at:        r.submitted_at,
          created_at:          r.created_at,
          recon_id:            rc?.id ?? null,
          recon_paid_amount:   rc ? Number(rc.tpa_paid_amount) : null,
          recon_advice_number: rc?.tpa_payment_advice_number ?? null,
          recon_bank_ref:      rc?.bank_reference ?? null,
          recon_payment_date:  rc?.payment_date ?? null,
          recon_reconciled:    rc?.reconciled ?? false,
          recon_dispute:       rc?.dispute_raised ?? false,
          recon_dispute_reason:rc?.dispute_reason ?? null,
        };
      });
    }
    setClaims(claimsList);

    // 2. KPI data
    await loadKPIs();

    // 3. TPA performance
    await loadTpaPerformance();

    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId]);

  const loadKPIs = async () => {
    if (!hospitalId) return;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    const [pendingRes, receivedRes, underpayRes] = await Promise.all([
      (supabase as any).from("insurance_claims")
        .select("claimed_amount")
        .eq("hospital_id", hospitalId).eq("status", "approved").eq("reconciled", false),
      (supabase as any).from("insurance_payment_reconciliation")
        .select("tpa_paid_amount")
        .eq("hospital_id", hospitalId).gte("payment_date", monthStart.slice(0, 10)),
      (supabase as any).from("insurance_payment_reconciliation")
        .select("id, tpa_paid_amount, hospital_claimed_amount")
        .eq("hospital_id", hospitalId).eq("dispute_raised", true).eq("reconciled", false),
    ]);

    const pendingAmount = (pendingRes.data ?? []).reduce((s: number, c: any) => s + Number(c.claimed_amount ?? 0), 0);
    const pendingCount  = pendingRes.data?.length ?? 0;
    const receivedThisMonth = (receivedRes.data ?? []).reduce((s: number, r: any) => s + Number(r.tpa_paid_amount ?? 0), 0);
    const underpayItems = underpayRes.data ?? [];
    const underpaymentDisputed = underpayItems.reduce((s: number, r: any) => {
      const diff = Number(r.hospital_claimed_amount ?? 0) - Number(r.tpa_paid_amount ?? 0);
      return s + Math.max(0, diff);
    }, 0);
    const underpaymentDisputedCount = underpayItems.length;

    // Avg settlement days + recovery rate
    const { data: settledData } = await (supabase as any)
      .from("insurance_payment_reconciliation")
      .select("tpa_paid_amount, hospital_claimed_amount, payment_date, created_at")
      .eq("hospital_id", hospitalId).eq("reconciled", true).limit(200);

    let avgSettlementDays: number | null = null;
    let recoveryRate: number | null = null;
    if (settledData?.length) {
      const days = (settledData as any[]).map(r =>
        differenceInDays(parseISO(r.payment_date ?? r.created_at), parseISO(r.created_at))
      ).filter(d => d >= 0 && d < 365);
      if (days.length) avgSettlementDays = Math.round(days.reduce((a, b) => a + b) / days.length);

      const totalClaimed = (settledData as any[]).reduce((s, r) => s + Number(r.hospital_claimed_amount ?? 0), 0);
      const totalPaid    = (settledData as any[]).reduce((s, r) => s + Number(r.tpa_paid_amount ?? 0), 0);
      if (totalClaimed > 0) recoveryRate = Math.round((totalPaid / totalClaimed) * 100);
    }

    setKpis({ pendingAmount, pendingCount, receivedThisMonth, underpaymentDisputed, underpaymentDisputedCount, avgSettlementDays, recoveryRate });
  };

  const loadTpaPerformance = async () => {
    if (!hospitalId) return;

    const [claimsRes, reconRes] = await Promise.all([
      (supabase as any).from("insurance_claims")
        .select("id, tpa_name, claimed_amount, status, submitted_at, settled_amount")
        .eq("hospital_id", hospitalId).limit(1000),
      (supabase as any).from("insurance_payment_reconciliation")
        .select("claim_id, tpa_paid_amount, hospital_claimed_amount, payment_date, created_at, reconciled")
        .eq("hospital_id", hospitalId).limit(1000),
    ]);

    const allClaims: any[] = claimsRes.data ?? [];
    const allRecon:  any[] = reconRes.data  ?? [];
    const reconByClaimId = Object.fromEntries(allRecon.map(r => [r.claim_id, r]));

    // Group by TPA
    const tpaMap: Record<string, {
      total: number; approved: number; claimed: number; paid: number;
      days: number[]; underpay: number;
    }> = {};

    for (const c of allClaims) {
      if (!c.tpa_name) continue;
      if (!tpaMap[c.tpa_name]) tpaMap[c.tpa_name] = { total: 0, approved: 0, claimed: 0, paid: 0, days: [], underpay: 0 };
      const t = tpaMap[c.tpa_name];
      t.total++;
      t.claimed += Number(c.claimed_amount ?? 0);
      if (c.status === "approved") t.approved++;
      const rc = reconByClaimId[c.id];
      if (rc) {
        const paid = Number(rc.tpa_paid_amount ?? 0);
        const claimed = Number(rc.hospital_claimed_amount ?? 0);
        t.paid += paid;
        if (claimed > paid) t.underpay++;
        if (rc.payment_date && rc.created_at) {
          const d = differenceInDays(parseISO(rc.payment_date), parseISO(rc.created_at));
          if (d >= 0 && d < 365) t.days.push(d);
        }
      }
    }

    const perf: TPAPerformance[] = Object.entries(tpaMap).map(([tpa_name, t]) => ({
      tpa_name,
      totalClaims:       t.total,
      approvedClaims:    t.approved,
      approvalRate:      t.total > 0 ? Math.round((t.approved / t.total) * 100) : 0,
      avgSettlementDays: t.days.length ? Math.round(t.days.reduce((a, b) => a + b) / t.days.length) : null,
      totalClaimed:      t.claimed,
      totalPaid:         t.paid,
      underpaymentCount: t.underpay,
      underpaymentRate:  t.approved > 0 ? Math.round((t.underpay / t.approved) * 100) : 0,
      totalReceived:     t.paid,
    })).sort((a, b) => b.totalClaims - a.totalClaims);

    setTpaPerf(perf);
  };

  useEffect(() => { loadData(); }, [loadData]);

  // ── Payment submission ────────────────────────────────────────────

  const submitPayment = async () => {
    if (!selected || !hospitalId) return;
    const paid  = Number(payForm.tpa_paid_amount);
    if (!paid || paid <= 0) { toast({ title: "Enter a valid payment amount", variant: "destructive" }); return; }

    setSubmittingPay(true);
    try {
      const diff       = selected.claimed_amount - paid;
      const isSettled  = diff <= 0;

      // Insert reconciliation record
      const { data: recon, error: reconErr } = await (supabase as any)
        .from("insurance_payment_reconciliation").insert({
          hospital_id:               hospitalId,
          claim_id:                  selected.id,
          tpa_payment_advice_number: payForm.tpa_payment_advice_number || null,
          tpa_paid_amount:           paid,
          hospital_claimed_amount:   selected.claimed_amount,
          payment_date:              payForm.payment_date || null,
          bank_reference:            payForm.bank_reference || null,
          reconciled:                isSettled,
          dispute_raised:            false,
        }).select("id").maybeSingle();

      if (reconErr) throw reconErr;

      // Update claim
      await (supabase as any).from("insurance_claims").update({
        settled_amount:      paid,
        underpayment_amount: Math.max(0, diff),
        reconciled:          isSettled,
      }).eq("id", selected.id);

      // GL: TPA payment received — Dr Bank / Cr AR-Insurance.
      if (recon?.id) {
        await autoPostJournalEntry({
          triggerEvent: "insurance_payment_received",
          sourceModule: "insurance",
          sourceId:     recon.id,
          amount:       paid,
          description:  `TPA payment - ${selected.tpa_name} - ${selected.patient_name}`,
          hospitalId,
          postedBy:     userId || "",
        });
      }

      toast({ title: isSettled ? "Claim fully reconciled ✓" : `Payment recorded — ₹${Math.round(diff).toLocaleString("en-IN")} underpayment` });

      // Pre-populate dispute if underpayment
      if (diff > 0) setShowDispute(true);

      setPayForm(defaultPaymentForm);
      loadData();
    } catch (err: any) {
      toast({ title: "Failed to record payment", description: err?.message, variant: "destructive" });
    } finally {
      setSubmittingPay(false);
    }
  };

  // ── Accept underpayment ───────────────────────────────────────────

  const acceptUnderpayment = async () => {
    if (!selected?.recon_id || !hospitalId) return;
    await Promise.all([
      (supabase as any).from("insurance_payment_reconciliation")
        .update({ reconciled: true }).eq("id", selected.recon_id),
      (supabase as any).from("insurance_claims")
        .update({ reconciled: true }).eq("id", selected.id),
    ]);
    // GL: write off the unrecovered shortfall — Dr Misc Expense / Cr AR-Insurance,
    // clearing the insurer receivable that will never be collected.
    const shortfall = Math.max(0, selected.claimed_amount - (selected.recon_paid_amount ?? 0));
    if (shortfall > 0) {
      await autoPostJournalEntry({
        triggerEvent: "insurance_shortfall_writeoff",
        sourceModule: "insurance",
        sourceId:     selected.recon_id,
        amount:       shortfall,
        description:  `Claim shortfall write-off - ${selected.tpa_name} - ${selected.patient_name}`,
        hospitalId,
        postedBy:     userId || "",
      });
    }
    toast({ title: "Underpayment accepted — claim marked as reconciled" });
    setShowDispute(false);
    loadData();
  };

  // ── AI dispute letter ─────────────────────────────────────────────

  const draftDisputeLetter = async () => {
    if (!selected || !hospitalId) return;
    setAiDrafting(true);
    const paid = selected.recon_paid_amount ?? 0;
    const diff = selected.claimed_amount - paid;
    try {
      const result = await callAI({
        featureKey: "appeal_letter",
        hospitalId,
        prompt: `Draft a formal dispute letter to ${selected.tpa_name} for underpayment on an insurance claim.

Claim details:
- Claim number: ${selected.claim_number ?? "N/A"}
- Patient: ${selected.patient_name}
- Claimed amount: ${formatINR(selected.claimed_amount)}
- TPA paid amount: ${formatINR(paid)}
- Underpayment difference: ${formatINR(diff)}
- Dispute reason: ${disputeReason}
${disputeNotes ? `- Additional context: ${disputeNotes}` : ""}

Requirements:
1. Reference applicable IRDAI regulations (especially IRDAI Regulation 2016 on claim settlement timelines)
2. Cite the Insurance Ombudsman as escalation path
3. Request full settlement within 7 working days
4. Maintain formal, professional tone
5. Under 200 words (body text only — no letterhead or signature)`,
        maxTokens: 400,
      });
      if (result.error) throw new Error(result.error);
      setAiLetter(result.text.trim());
    } catch (err: any) {
      toast({ title: "AI draft failed", description: err?.message ?? "Try again", variant: "destructive" });
    } finally {
      setAiDrafting(false);
    }
  };

  // ── Raise dispute ─────────────────────────────────────────────────

  const raiseDispute = async () => {
    if (!selected?.recon_id || !hospitalId) return;
    setSubmittingDispute(true);
    try {
      await (supabase as any).from("insurance_payment_reconciliation")
        .update({ dispute_raised: true, dispute_reason: disputeReason })
        .eq("id", selected.recon_id);

      await (supabase as any).from("insurance_claims")
        .update({ underpayment_amount: Math.max(0, selected.claimed_amount - (selected.recon_paid_amount ?? 0)) })
        .eq("id", selected.id);

      toast({ title: "Dispute raised ✓" });
      setShowDispute(false);
      setDisputeReason(DISPUTE_REASONS[0]);
      setDisputeNotes("");
      setAiLetter("");
      loadData();
    } catch (err: any) {
      toast({ title: "Failed to raise dispute", description: err?.message, variant: "destructive" });
    } finally {
      setSubmittingDispute(false);
    }
  };

  // ── CSV export ────────────────────────────────────────────────────

  const exportCSV = () => {
    const headers = ["TPA Name", "Total Claims", "Approved Claims", "Approval Rate (%)", "Avg Settlement Days", "Total Claimed (₹)", "Total Paid (₹)", "Underpayment Cases", "Underpayment Rate (%)"];
    const rows = tpaPerf.map(t => [
      t.tpa_name,
      t.totalClaims,
      t.approvedClaims,
      t.approvalRate,
      t.avgSettlementDays ?? "—",
      Math.round(t.totalClaimed),
      Math.round(t.totalPaid),
      t.underpaymentCount,
      t.underpaymentRate,
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url, download: `tpa_performance_${format(new Date(), "yyyyMMdd")}.csv` });
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // ── Derived ───────────────────────────────────────────────────────

  const computedDiff = (() => {
    if (!selected) return null;
    const paid = selected.recon_paid_amount ?? Number(payForm.tpa_paid_amount || 0);
    if (!paid) return null;
    return selected.claimed_amount - paid;
  })();

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Tab bar ── */}
      <div className="flex-shrink-0 border-b border-border px-4 flex items-center gap-1 bg-background pt-2">
        {([
          { key: "pending",         label: `Pending (${claims.length})` },
          { key: "dashboard",       label: "KPI Dashboard"    },
          { key: "tpa_performance", label: "TPA Performance"  },
        ] as { key: AppTab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PENDING TAB ── */}
      {tab === "pending" && (
        <div className="flex flex-1 overflow-hidden">

          {/* List panel */}
          <div className="w-[400px] flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
            <div className="px-4 py-2 bg-muted/30 border-b border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {claims.length} claim{claims.length !== 1 ? "s" : ""} awaiting reconciliation
              </p>
              <p className="text-[10px] text-muted-foreground">Sorted oldest first</p>
            </div>

            {loading ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                <Loader2 size={16} className="animate-spin mr-2" /> Loading…
              </div>
            ) : claims.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <CheckCircle2 size={36} className="opacity-30" />
                <p className="text-sm">All claims reconciled</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto divide-y divide-border">
                {claims.map(c => {
                  const daysSince = differenceInDays(new Date(), parseISO(c.submitted_at ?? c.created_at));
                  const isUrgent  = daysSince > 30;
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedId(c.id); setPayForm(defaultPaymentForm); setShowDispute(false); setAiLetter(""); }}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors border-l-[3px]",
                        selectedId === c.id ? "bg-primary/5 border-l-primary" : isUrgent ? "border-l-red-400" : "border-l-transparent"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{c.patient_name}</p>
                          <p className="text-xs text-muted-foreground">{c.tpa_name}</p>
                          {c.claim_number && (
                            <p className="text-[10px] font-mono text-muted-foreground">#{c.claim_number}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold tabular-nums">{formatINR(c.claimed_amount)}</p>
                          <p className={cn("text-[10px]", isUrgent ? "text-red-600 font-semibold" : "text-muted-foreground")}>
                            {daysSince}d old
                          </p>
                          {c.recon_id && !c.recon_reconciled && (
                            <Badge variant="outline" className={cn(
                              "text-[9px] px-1 py-0 mt-0.5",
                              c.recon_dispute ? "bg-orange-50 text-orange-700 border-orange-200" : "bg-blue-50 text-blue-700 border-blue-200"
                            )}>
                              {c.recon_dispute ? "Disputed" : "Part-paid"}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={12} className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground", selectedId === c.id && "text-primary")} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="flex-1 overflow-y-auto p-5">
            {!selected ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <IndianRupee size={40} className="opacity-20" />
                <p className="text-sm">Select a claim to record payment</p>
              </div>
            ) : (
              <div className="max-w-xl space-y-5">

                {/* Claim header */}
                <div>
                  <h2 className="text-base font-bold">{selected.patient_name}</h2>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                    {selected.claim_number && <span>Claim <span className="font-mono font-semibold text-foreground">#{selected.claim_number}</span></span>}
                    <span>· {selected.tpa_name}</span>
                    <span>· Submitted {selected.submitted_at ? format(parseISO(selected.submitted_at), "dd MMM yyyy") : "—"}</span>
                  </div>
                </div>

                {/* Amounts banner */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/40 rounded-lg p-3">
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">Claimed Amount</p>
                    <p className="text-lg font-bold tabular-nums">{formatINR(selected.claimed_amount)}</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-3">
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">Approved Amount</p>
                    <p className="text-lg font-bold tabular-nums">
                      {selected.approved_amount ? formatINR(selected.approved_amount) : <span className="text-muted-foreground text-sm">Not recorded</span>}
                    </p>
                  </div>
                </div>

                {/* ── Payment already entered ── */}
                {selected.recon_id ? (
                  <div className="space-y-3">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm space-y-1">
                      <p className="font-semibold text-blue-800">Payment Recorded</p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-blue-700">
                        <span>Amount paid</span><span className="font-semibold tabular-nums">{formatINR(selected.recon_paid_amount ?? 0)}</span>
                        {selected.recon_payment_date && <><span>Payment date</span><span>{format(parseISO(selected.recon_payment_date), "dd MMM yyyy")}</span></>}
                        {selected.recon_advice_number && <><span>Advice #</span><span className="font-mono">{selected.recon_advice_number}</span></>}
                        {selected.recon_bank_ref && <><span>Bank ref</span><span className="font-mono">{selected.recon_bank_ref}</span></>}
                      </div>
                    </div>

                    {/* Difference indicator */}
                    {computedDiff !== null && (
                      <div className={cn(
                        "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium border",
                        computedDiff > 0  ? "bg-red-50 border-red-200 text-red-700"     :
                        computedDiff < 0  ? "bg-blue-50 border-blue-200 text-blue-700"  :
                                            "bg-emerald-50 border-emerald-200 text-emerald-700"
                      )}>
                        {computedDiff > 0  ? <AlertTriangle size={14} className="shrink-0" /> :
                         computedDiff < 0  ? <TrendingUp size={14} className="shrink-0" />    :
                                             <CheckCircle2 size={14} className="shrink-0" />  }
                        {computedDiff > 0  ? `⚠️ Underpayment of ${formatINR(computedDiff)}` :
                         computedDiff < 0  ? `💰 Overpayment of ${formatINR(Math.abs(computedDiff))} — verify with TPA` :
                                             "✅ Fully settled"}
                      </div>
                    )}

                    {/* Underpayment actions */}
                    {computedDiff !== null && computedDiff > 0 && !selected.recon_reconciled && (
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                          onClick={acceptUnderpayment}>
                          <CheckCircle2 size={12} /> Accept Underpayment — Write Off {formatINR(computedDiff)}
                        </Button>
                        <Button size="sm" variant="outline"
                          className={cn("gap-1.5 text-xs", showDispute ? "bg-orange-50 border-orange-400 text-orange-700" : "border-orange-300 text-orange-700 hover:bg-orange-50")}
                          onClick={() => setShowDispute(v => !v)}>
                          <Scale size={12} /> Raise Dispute
                        </Button>
                      </div>
                    )}

                    {selected.recon_reconciled && (
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-700">
                        <CheckCircle2 size={14} /> Claim fully reconciled
                      </div>
                    )}

                    {selected.recon_dispute && (
                      <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                        Dispute raised · {selected.recon_dispute_reason}
                      </Badge>
                    )}
                  </div>
                ) : (
                  /* ── Payment entry form ── */
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">Record TPA Payment</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold">TPA Payment Amount (₹) *</Label>
                        <Input type="number" className="mt-1 h-8 text-sm"
                          placeholder="0.00"
                          value={payForm.tpa_paid_amount}
                          onChange={e => setPayForm(p => ({ ...p, tpa_paid_amount: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Payment Date</Label>
                        <Input type="date" className="mt-1 h-8 text-sm"
                          value={payForm.payment_date}
                          onChange={e => setPayForm(p => ({ ...p, payment_date: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">TPA Advice Reference #</Label>
                        <Input className="mt-1 h-8 text-sm"
                          placeholder="ADV/2026/XXXXX"
                          value={payForm.tpa_payment_advice_number}
                          onChange={e => setPayForm(p => ({ ...p, tpa_payment_advice_number: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Bank Reference</Label>
                        <Input className="mt-1 h-8 text-sm"
                          placeholder="NEFT/RTGS reference"
                          value={payForm.bank_reference}
                          onChange={e => setPayForm(p => ({ ...p, bank_reference: e.target.value }))} />
                      </div>
                    </div>

                    {/* Live diff preview */}
                    {payForm.tpa_paid_amount && Number(payForm.tpa_paid_amount) > 0 && (() => {
                      const diff = selected.claimed_amount - Number(payForm.tpa_paid_amount);
                      return (
                        <div className={cn(
                          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border",
                          diff > 0  ? "bg-red-50 border-red-200 text-red-700" :
                          diff < 0  ? "bg-blue-50 border-blue-200 text-blue-700" :
                                      "bg-emerald-50 border-emerald-200 text-emerald-700"
                        )}>
                          {diff > 0  ? <AlertTriangle size={13} className="shrink-0" /> :
                           diff < 0  ? <TrendingUp size={13} className="shrink-0" />    :
                                       <CheckCircle2 size={13} className="shrink-0" />  }
                          {diff > 0  ? `⚠️ Underpayment of ${formatINR(diff)}` :
                           diff < 0  ? `💰 Overpayment of ${formatINR(Math.abs(diff))} — verify with TPA` :
                                       "✅ Fully settled"}
                        </div>
                      );
                    })()}

                    <Button size="sm" className="gap-1.5" disabled={submittingPay || !payForm.tpa_paid_amount}
                      onClick={submitPayment}>
                      {submittingPay ? <Loader2 size={12} className="animate-spin" /> : <IndianRupee size={12} />}
                      Record Payment
                    </Button>
                  </div>
                )}

                {/* ── Dispute form ── */}
                {showDispute && (
                  <div className="border border-orange-200 rounded-lg p-4 space-y-3 bg-orange-50/40">
                    <h3 className="text-sm font-semibold text-orange-800 flex items-center gap-1.5">
                      <Scale size={14} /> Raise Dispute with {selected.tpa_name}
                    </h3>

                    <div>
                      <Label className="text-xs font-semibold">Dispute Reason</Label>
                      <Select value={disputeReason} onValueChange={setDisputeReason}>
                        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DISPUTE_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs font-semibold">Additional Notes (optional)</Label>
                      <textarea
                        rows={2}
                        className="mt-1 w-full text-xs rounded-md border border-input bg-background px-3 py-2 resize-none"
                        placeholder="Specific details for the dispute…"
                        value={disputeNotes}
                        onChange={e => setDisputeNotes(e.target.value)}
                      />
                    </div>

                    {/* AI draft letter */}
                    {(planTier === "ai_assisted" || planTier === "automated") && (
                      <Button size="sm" variant="outline"
                        className="text-xs gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
                        disabled={aiDrafting} onClick={draftDisputeLetter}>
                        {aiDrafting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                        {aiDrafting ? "Drafting…" : "🤖 Draft Dispute Letter"}
                      </Button>
                    )}

                    {aiLetter && (
                      <div>
                        <Label className="text-xs font-semibold">AI-Drafted Dispute Letter</Label>
                        <textarea
                          rows={8}
                          className="mt-1 w-full text-xs rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                          value={aiLetter}
                          onChange={e => setAiLetter(e.target.value)}
                        />
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1.5 text-xs bg-orange-600 hover:bg-orange-700 text-white border-none"
                        disabled={submittingDispute} onClick={raiseDispute}>
                        {submittingDispute ? <Loader2 size={11} className="animate-spin" /> : <Scale size={11} />}
                        Raise Dispute
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs"
                        onClick={() => { setShowDispute(false); setAiLetter(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── KPI DASHBOARD TAB ── */}
      {tab === "dashboard" && (
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!kpis ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              <Loader2 size={16} className="animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Reconciliation Summary
              </h2>

              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                <KpiCard
                  icon={<IndianRupee size={12} />}
                  label="Total Outstanding"
                  value={(() => { const v = kpis.pendingAmount; return v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : formatINR(v); })()}
                  sub={`${kpis.pendingCount} claims approved, awaiting payment`}
                  accent="text-amber-700"
                />
                <KpiCard
                  icon={<TrendingDown size={12} />}
                  label="Received This Month"
                  value={(() => { const v = kpis.receivedThisMonth; return v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : formatINR(v); })()}
                  sub="TPA payments received"
                  accent="text-emerald-700"
                />
                <KpiCard
                  icon={<AlertTriangle size={12} />}
                  label="Underpayments Disputed"
                  value={(() => { const v = kpis.underpaymentDisputed; return v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : formatINR(v); })()}
                  sub={`${kpis.underpaymentDisputedCount} active dispute${kpis.underpaymentDisputedCount !== 1 ? "s" : ""}`}
                  accent={kpis.underpaymentDisputed > 0 ? "text-red-700" : "text-foreground"}
                />
                <KpiCard
                  icon={<Clock size={12} />}
                  label="Avg Settlement"
                  value={kpis.avgSettlementDays !== null ? `${kpis.avgSettlementDays} days` : "—"}
                  sub={kpis.avgSettlementDays !== null ? (kpis.avgSettlementDays > 30 ? "⚠️ Above 30-day target" : "✓ Within target") : "Insufficient data"}
                  accent={kpis.avgSettlementDays === null ? "text-muted-foreground" : kpis.avgSettlementDays > 30 ? "text-red-700" : "text-emerald-700"}
                />
                <KpiCard
                  icon={<TrendingUp size={12} />}
                  label="Recovery Rate"
                  value={kpis.recoveryRate !== null ? `${kpis.recoveryRate}%` : "—"}
                  sub="of claimed amount recovered"
                  accent={
                    kpis.recoveryRate === null ? "text-muted-foreground" :
                    kpis.recoveryRate >= 95    ? "text-emerald-700" :
                    kpis.recoveryRate >= 80    ? "text-amber-700"   : "text-red-700"
                  }
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TPA PERFORMANCE TAB ── */}
      {tab === "tpa_performance" && (
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              TPA-wise Performance
            </h2>
            <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={exportCSV}>
              <Download size={12} /> Export CSV
            </Button>
          </div>

          <div className="rounded-lg border border-border overflow-hidden bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">TPA / Insurer</TableHead>
                  <TableHead className="text-xs text-right">Total Claims</TableHead>
                  <TableHead className="text-xs text-right">Approval Rate</TableHead>
                  <TableHead className="text-xs text-right">Avg Settlement</TableHead>
                  <TableHead className="text-xs text-right">Underpayment Rate</TableHead>
                  <TableHead className="text-xs text-right">Total Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                      <Loader2 size={16} className="animate-spin inline mr-2" /> Loading…
                    </TableCell>
                  </TableRow>
                ) : tpaPerf.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                      No TPA data available
                    </TableCell>
                  </TableRow>
                ) : tpaPerf.map(t => (
                  <TableRow key={t.tpa_name}>
                    <TableCell className="text-sm font-medium">{t.tpa_name}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{t.totalClaims}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      <span className={cn(
                        "font-medium",
                        t.approvalRate >= 80 ? "text-emerald-700" :
                        t.approvalRate >= 60 ? "text-amber-700"   : "text-red-700"
                      )}>
                        {t.approvalRate}%
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {t.avgSettlementDays !== null ? (
                        <span className={t.avgSettlementDays > 30 ? "text-red-600 font-medium" : ""}>
                          {t.avgSettlementDays}d
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      <span className={t.underpaymentRate > 20 ? "text-red-600 font-medium" : ""}>
                        {t.underpaymentRate}%
                      </span>
                      {t.underpaymentCount > 0 && (
                        <span className="text-muted-foreground ml-1">({t.underpaymentCount})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums font-medium">
                      {t.totalReceived >= 100000
                        ? `₹${(t.totalReceived / 100000).toFixed(1)}L`
                        : formatINR(t.totalReceived)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Underpayment rate = cases where TPA paid less than claimed / total approved claims.
            Settlement days computed from reconciliation record creation to payment date.
          </p>
        </div>
      )}
    </div>
  );
};

export default PaymentReconciliation;
