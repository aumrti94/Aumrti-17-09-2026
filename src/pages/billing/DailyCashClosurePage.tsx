import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { autoPostJournalEntry } from "@/lib/accounting";
import { formatINR } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Lock, Unlock, CheckCircle2, AlertTriangle, Clock, ChevronDown, Printer, ShieldAlert } from "lucide-react";
import { computeDayClosureTotals, EMPTY_TOTALS, type SystemTotals } from "@/lib/dayClosureTotals";
import { useModuleAccess } from "@/components/access/useModuleAccess";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { logConfigChange } from "@/lib/ims";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentRow {
  id: string;
  payment_mode: string;
  amount: number;
  payment_time: string;
  patient_name: string;
  bill_number: string;
  received_by_name: string;
}

interface ClosureRecord {
  closure_date: string;
  status: string;
  system_total: number;
  variance: number;
  closed_at: string | null;
}

const MODES = ["cash", "upi", "card", "cheque", "net_banking", "insurance"] as const;
const MODE_LABELS: Record<string, string> = {
  cash: "Cash", upi: "UPI", card: "Card",
  cheque: "Cheque", net_banking: "Net Banking", insurance: "Insurance / TPA",
};

// bill_line_items.item_type → Tally revenue head label
const LINE_ITEM_GROUP: Record<string, string> = {
  consultation: "OPD Consultation",
  procedure:    "OPD Consultation",
  room_charge:  "IPD Room & Nursing",
  nursing:      "IPD Room & Nursing",
  surgery:      "Surgery / OT",
  lab:          "Laboratory",
  radiology:    "Radiology",
  pharmacy:     "Pharmacy",
  package:      "Packages",
  blood:        "Other Services",
  oxygen:       "Other Services",
  consumable:   "Other Services",
  other:        "Other Services",
};

// ─── Component ────────────────────────────────────────────────────────────────

const DailyCashClosurePage: React.FC = () => {
  const { toast } = useToast();
  const { actionAllowed } = useModuleAccess();
  const { role } = useHospitalContext();
  const canCloseDay = actionAllowed("billing", "day_closure");
  // Reopening a locked (finalised) day is a sensitive, finance-authority action.
  const canReopen = ["super_admin", "hospital_admin", "cfo"].includes(role ?? "");
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [hospitalName, setHospitalName] = useState<string>("Hospital");

  const todayStr = new Date().toISOString().split("T")[0];
  const [closureDate, setClosureDate] = useState<string>(todayStr);
  const [systemTotals, setSystemTotals] = useState<SystemTotals>(EMPTY_TOTALS);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  // Existing closure for today (if already closed)
  const [existing, setExisting] = useState<{ status: string; closed_at: string | null } | null>(null);

  // Manual count inputs
  const [manual, setManual] = useState<Record<string, string>>({
    cash: "", upi: "", card: "", cheque: "", net_banking: "", insurance: "",
  });
  const [varianceReason, setVarianceReason] = useState("");

  // Revenue by service head (for Tally summary)
  const [revenueByHead, setRevenueByHead] = useState<Record<string, number>>({});

  // Recent history
  const [history, setHistory] = useState<ClosureRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id, hospital_id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => {
          if (data?.hospital_id) {
            setHospitalId(data.hospital_id);
            // Fetch hospital name for the print header
            supabase.from("hospitals").select("name").eq("id", data.hospital_id).maybeSingle()
              .then(({ data: h }) => { if (h?.name) setHospitalName(h.name); });
          }
          if (data?.id) setUserId(data.id);
        });
    });
  }, []);

  // ── Fetch day's payments and existing closure ─────────────────────────────

  const loadDay = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    // Fetch all payments for closure_date
    const { data: pData } = await (supabase as any)
      .from("bill_payments")
      .select("id, payment_mode, amount, payment_time, bill_id, received_by, bills!inner(bill_number, patients!inner(full_name))")
      .eq("hospital_id", hospitalId)
      .eq("payment_date", closureDate)
      .order("payment_time", { ascending: false });

    const rows: PaymentRow[] = (pData || []).map((p: any) => ({
      id: p.id,
      payment_mode: p.payment_mode,
      amount: Number(p.amount),
      payment_time: p.payment_time,
      patient_name: p.bills?.patients?.full_name || "—",
      bill_number: p.bills?.bill_number || "—",
      received_by_name: "",
    }));
    setPayments(rows);

    // Refunds processed today — real money OUT, deducted from the tender it left by.
    const { data: refundsData } = await (supabase as any)
      .from("refund_payables")
      .select("amount, refund_mode")
      .eq("hospital_id", hospitalId)
      .eq("status", "processed")
      .gte("processed_at", closureDate)
      .lte("processed_at", closureDate + "T23:59:59");

    // Advance deposits received today, and the slice of them syncAdvanceToBill has
    // already mirrored into bill_payments.
    const { data: advancesData } = await (supabase as any)
      .from("ipd_advances")
      .select("amount, payment_mode")
      .eq("hospital_id", hospitalId)
      .eq("transaction_type", "deposit")
      .gte("created_at", closureDate)
      .lte("created_at", closureDate + "T23:59:59");

    const { data: mirroredAdvancesData } = await (supabase as any)
      .from("bill_payments")
      .select("amount, payment_mode")
      .eq("hospital_id", hospitalId)
      .eq("payment_date", closureDate)
      .eq("is_advance", true);

    const totals = computeDayClosureTotals({
      payments: rows.map(r => ({ mode: r.payment_mode, amount: r.amount })),
      refunds: (refundsData || []).map((r: any) => ({ mode: r.refund_mode, amount: Number(r.amount || 0) })),
      advanceDeposits: (advancesData || []).map((a: any) => ({ mode: a.payment_mode, amount: Number(a.amount || 0) })),
      mirroredAdvances: (mirroredAdvancesData || []).map((p: any) => ({ mode: p.payment_mode, amount: Number(p.amount || 0) })),
    });
    setSystemTotals(totals);

    // Fetch revenue by service type for today's finalized bills (for Tally summary)
    const { data: lineItemsData } = await supabase
      .from("bill_line_items")
      .select("item_type, total_amount, gst_amount")
      .eq("hospital_id", hospitalId)
      .gte("created_at", closureDate)
      .lte("created_at", closureDate + "T23:59:59");

    const revMap: Record<string, number> = {};
    for (const li of lineItemsData || []) {
      const head = LINE_ITEM_GROUP[(li as any).item_type as string] || "Other Services";
      // taxable amount = total - GST (revenue recognised excl. GST)
      const taxable = Number((li as any).total_amount || 0) - Number((li as any).gst_amount || 0);
      revMap[head] = (revMap[head] || 0) + taxable;
    }
    setRevenueByHead(revMap);

    // Check for existing closure record
    const { data: cls } = await (supabase as any)
      .from("daily_cash_closure")
      .select("status, closed_at, manual_cash, manual_upi, manual_card, manual_cheque, manual_net_banking, variance_reason")
      .eq("hospital_id", hospitalId)
      .eq("closure_date", closureDate)
      .maybeSingle();

    if (cls) {
      setExisting({ status: cls.status, closed_at: cls.closed_at });
      if (cls.status !== "open") {
        setManual({
          cash: String(cls.manual_cash ?? ""),
          upi: String(cls.manual_upi ?? ""),
          card: String(cls.manual_card ?? ""),
          cheque: String(cls.manual_cheque ?? ""),
          net_banking: String(cls.manual_net_banking ?? ""),
          insurance: "",
        });
        setVarianceReason(cls.variance_reason || "");
      }
    } else {
      setExisting(null);
    }

    // Load last 7 closure records for history
    const { data: hist } = await (supabase as any)
      .from("daily_cash_closure")
      .select("closure_date, status, system_total, variance, closed_at")
      .eq("hospital_id", hospitalId)
      .order("closure_date", { ascending: false })
      .limit(7);
    setHistory(hist || []);

    setLoading(false);
  }, [hospitalId, closureDate]);

  useEffect(() => { loadDay(); }, [loadDay]);

  // ── Computed values ───────────────────────────────────────────────────────

  const manualTotal = MODES.reduce((s, m) => s + (parseFloat(manual[m]) || 0), 0);
  const variance = manualTotal - systemTotals.total;
  const varianceZero = Math.abs(variance) < 0.005;
  const allManualFilled = MODES.every(m => manual[m] !== "");
  const canLock = allManualFilled && (varianceZero || varianceReason.trim().length > 0);
  const isLocked = existing?.status === "locked";

  // ── Lock Day ──────────────────────────────────────────────────────────────

  const lockDay = async () => {
    if (!hospitalId || !userId || !canLock) return;
    if (!confirm(`Lock ${new Date(closureDate + "T00:00:00").toLocaleDateString("en-IN")}? This cannot be undone without CFO approval.`)) return;

    setLocking(true);
    try {
      const payload = {
        hospital_id:      hospitalId,
        closure_date:     closureDate,
        sys_cash:         systemTotals.cash,
        sys_upi:          systemTotals.upi,
        sys_card:         systemTotals.card,
        sys_cheque:       systemTotals.cheque,
        sys_net_banking:  systemTotals.net_banking,
        sys_insurance:    systemTotals.insurance,
        sys_other:        systemTotals.other,
        system_total:     systemTotals.total,
        manual_cash:      parseFloat(manual.cash) || 0,
        manual_upi:       parseFloat(manual.upi) || 0,
        manual_card:      parseFloat(manual.card) || 0,
        manual_cheque:    parseFloat(manual.cheque) || 0,
        manual_net_banking: parseFloat(manual.net_banking) || 0,
        manual_count:     manualTotal,
        variance:         variance,
        variance_reason:  varianceReason.trim() || null,
        status:           "locked",
        closed_by:        userId,
        closed_at:        new Date().toISOString(),
      };

      const { data: saved, error } = await (supabase as any)
        .from("daily_cash_closure")
        .upsert(payload, { onConflict: "hospital_id,closure_date" })
        .select("id")
        .maybeSingle();

      if (error) throw error;

      // Post journal entry for day-close (best-effort; no rule = no-op)
      if (saved?.id) {
        await autoPostJournalEntry({
          triggerEvent:  "daily_cash_closure",
          sourceModule:  "billing",
          sourceId:      saved.id,
          amount:        systemTotals.total,
          description:   `Daily Cash Closure — ${new Date(closureDate + "T00:00:00").toLocaleDateString("en-IN")}`,
          entryDate:     closureDate,
          hospitalId,
          postedBy:      userId,
        });
      }

      toast({ title: `Day ${new Date(closureDate + "T00:00:00").toLocaleDateString("en-IN")} locked successfully` });
      loadDay();
    } catch (err: any) {
      toast({ title: "Lock failed", description: err.message, variant: "destructive" });
    } finally {
      setLocking(false);
    }
  };

  // ── Reopen (unlock) a locked day ──────────────────────────────────────────
  // Sets a locked day back to 'reconciled' so bills/payments for that date can
  // be corrected, then it can be re-locked. Restricted to finance authority and
  // always audit-logged with a mandatory reason.

  const reopenDay = async () => {
    if (!hospitalId || !canReopen) return;
    const reason = reopenReason.trim();
    if (!reason) {
      toast({ title: "Reason required", description: "Enter why this day is being reopened.", variant: "destructive" });
      return;
    }
    setReopening(true);
    try {
      const { error } = await (supabase as any)
        .from("daily_cash_closure")
        .update({ status: "reconciled", closed_by: null, closed_at: null })
        .eq("hospital_id", hospitalId)
        .eq("closure_date", closureDate);
      if (error) throw error;

      logConfigChange({
        hospitalId,
        configArea: "daily_cash_closure",
        itemId: closureDate,
        oldValue: { status: "locked" },
        newValue: { status: "reconciled" },
        reason,
        userId,
      });

      toast({ title: `Day ${new Date(closureDate + "T00:00:00").toLocaleDateString("en-IN")} reopened` });
      setReopenOpen(false);
      setReopenReason("");
      loadDay();
    } catch (err: any) {
      toast({ title: "Reopen failed", description: err.message, variant: "destructive" });
    } finally {
      setReopening(false);
    }
  };

  // ── Tally Day Summary print ───────────────────────────────────────────────

  const dateLabel = new Date(closureDate + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });

  const printTallySummary = useCallback(() => {
    const fmtAmt = (n: number) =>
      n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const totalRevenue = Object.values(revenueByHead).reduce((a, b) => a + b, 0);
    const digitalTotal = systemTotals.upi + systemTotals.card + systemTotals.net_banking;
    const netVariance = systemTotals.total - totalRevenue;
    const balanced = Math.abs(netVariance) < 1;

    // Each bucket is NET of advances received and refunds paid out, so those are
    // NOT listed as extra rows here — that would debit/credit them a second time.
    // A bucket can legitimately go negative (a day whose refunds exceed its
    // takings in that tender), which posts as CR; a `> 0` guard would have
    // dropped the row and silently unbalanced the voucher.
    const ledgerRow = (label: string, amount: number) =>
      Math.abs(amount) >= 0.005 &&
      `<tr><td class="lbl">${label}</td><td class="amt">₹ ${fmtAmt(Math.abs(amount))}</td>` +
      `<td class="tag ${amount >= 0 ? "dr" : "cr"}">${amount >= 0 ? "DR" : "CR"}</td></tr>`;

    const collectionRows = [
      ledgerRow("Cash in Hand", systemTotals.cash),
      ledgerRow("Bank — UPI / Card / Net Banking", digitalTotal),
      ledgerRow("Bank — Cheque", systemTotals.cheque),
      ledgerRow("AR — Insurance / TPA", systemTotals.insurance),
      ledgerRow("Other Receipts", systemTotals.other),
    ].filter(Boolean).join("");

    const revenueRows = Object.entries(revenueByHead)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([head, amt]) =>
        `<tr><td class="lbl">${head}</td><td class="amt">₹ ${fmtAmt(amt)}</td><td class="tag cr">CR</td></tr>`
      ).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Tally Day Summary — ${dateLabel}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Courier New',monospace; font-size:12px; color:#000; padding:20px 24px; max-width:460px; margin:auto; }
    h1 { font-size:15px; font-weight:bold; text-align:center; border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:6px; }
    .meta { font-size:10px; text-align:center; color:#444; margin-bottom:14px; }
    h2 { font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:.8px;
         background:#000; color:#fff; padding:3px 6px; margin:12px 0 0; }
    table { width:100%; border-collapse:collapse; }
    td { padding:3px 4px; vertical-align:middle; }
    td.lbl { width:65%; }
    td.amt { width:25%; text-align:right; font-variant-numeric:tabular-nums; }
    td.tag { width:10%; text-align:center; font-size:9px; font-weight:bold; border-radius:2px; padding:1px 3px; }
    td.dr { background:#dbeafe; color:#1e40af; }
    td.cr { background:#dcfce7; color:#166534; }
    tr.total td { border-top:1px solid #000; font-weight:bold; padding-top:5px; margin-top:2px; }
    .variance { margin-top:14px; padding:8px; border:1px solid #000; font-size:11px; }
    .variance .val { font-size:14px; font-weight:bold; }
    .balanced { color:green; }
    .unbalanced { color:red; }
    .instruction { margin-top:14px; font-size:10px; border:1px dashed #888; padding:8px; line-height:1.6; }
    .footer { margin-top:14px; font-size:9px; color:#666; border-top:1px dashed #ccc; padding-top:6px; text-align:center; }
    @media print {
      body { padding:8px; }
      button { display:none; }
    }
  </style>
</head>
<body>
  <h1>TALLY DAY SUMMARY</h1>
  <div class="meta">
    ${hospitalName} &nbsp;|&nbsp; ${dateLabel} &nbsp;|&nbsp; Generated: ${new Date().toLocaleTimeString("en-IN", { hour12: true })}
  </div>

  <h2>Collections Today &nbsp;<small style="font-weight:normal;font-size:9px">(Debit entries in Tally)</small></h2>
  <table>
    ${collectionRows}
    <tr class="total">
      <td class="lbl">TOTAL COLLECTIONS</td>
      <td class="amt">₹ ${fmtAmt(systemTotals.total)}</td>
      <td></td>
    </tr>
  </table>

  <h2>Revenue by Service &nbsp;<small style="font-weight:normal;font-size:9px">(Credit entries in Tally)</small></h2>
  <table>
    ${revenueRows || `<tr><td class="lbl" colspan="3" style="color:#888;font-size:10px;">No bills finalised today yet</td></tr>`}
    ${totalRevenue > 0 ? `<tr class="total"><td class="lbl">TOTAL REVENUE</td><td class="amt">₹ ${fmtAmt(totalRevenue)}</td><td></td></tr>` : ""}
  </table>

  <div class="variance">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span>Collections – Revenue (Variance)</span>
      <span class="val ${balanced ? "balanced" : "unbalanced"}">
        ₹ ${fmtAmt(Math.abs(netVariance))} &nbsp;${balanced ? "✓ BALANCED" : "⚠ DIFFERENCE"}
      </span>
    </div>
    ${!balanced ? `<div style="font-size:10px;color:#888;margin-top:4px;">Tip: variance may be due to unpaid bills (AR) or yesterday's collections.</div>` : ""}
  </div>

  <div class="instruction">
    <strong>Post in Tally Prime (one voucher):</strong><br>
    Voucher Type: <strong>Receipt</strong><br>
    Date: <strong>${dateLabel}</strong><br>
    Narration: <strong>Day Collection — ${dateLabel}</strong><br>
    <br>
    Debit entries → Cash / Bank / AR (as shown above)<br>
    Credit entries → Revenue accounts (as shown above)
  </div>

  <div class="footer">
    Aumrti HMS · Printed by billing supervisor · ${new Date().toLocaleString("en-IN")}<br>
    This summary is computer-generated from HMS transaction records.
  </div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=520,height=750");
    if (!win) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site to print the summary.", variant: "destructive" });
      return;
    }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 400);
  }, [systemTotals, revenueByHead, dateLabel, hospitalName, toast]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const fmt = (n: number) => formatINR(n);
  const fmtTime = (ts: string) =>
    new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  // ─────────────────────────────────────────────────────────────────────────

  if (!canCloseDay) {
    return (
      <div className="flex h-[calc(100vh-56px)] flex-col items-center justify-center gap-2 text-center px-6">
        <ShieldAlert size={28} className="text-amber-600" />
        <p className="text-sm font-semibold text-foreground">Cash Closure is restricted for your role.</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          Ask an administrator to enable the “Day Closure” action for your role under
          Settings → Roles → Billing → Action Controls.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading day summary…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-muted/20">

      {/* ── Reopen (unlock) confirmation modal ── */}
      {reopenOpen && (
        <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4" onClick={() => setReopenOpen(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Unlock size={16} className="text-amber-600" />
              <h3 className="text-base font-bold text-foreground">
                Reopen {new Date(closureDate + "T00:00:00").toLocaleDateString("en-IN")}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              This unlocks the day so bills, payments, and refunds for this date can be corrected.
              The action is logged. Re-lock the day once corrections are complete.
            </p>
            <label className="text-xs font-medium text-foreground block mb-1">Reason (required)</label>
            <Textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="e.g. Missed a cash receipt that must be added to 16 Jul"
              className="mb-4 min-h-[72px] text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setReopenOpen(false)} disabled={reopening}>Cancel</Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={reopenDay}
                disabled={reopening || !reopenReason.trim()}
              >
                {reopening ? "Reopening…" : "Reopen Day"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="h-12 flex-shrink-0 bg-card border-b border-border px-5 flex items-center gap-3">
        <Lock size={16} className={isLocked ? "text-green-600" : "text-amber-600"} />
        <span className="text-[15px] font-bold text-foreground">End of Day Closure</span>
        <Input
          type="date"
          value={closureDate}
          max={todayStr}
          onChange={(e) => e.target.value && setClosureDate(e.target.value)}
          className="h-7 w-[150px] text-[12px]"
        />
        {isLocked && (
          <Badge className="bg-green-100 text-green-700 text-[11px]">
            <CheckCircle2 size={11} className="mr-1" /> Locked
          </Badge>
        )}
        {isLocked && canReopen && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-[11px] gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => setReopenOpen(true)}
          >
            <Unlock size={12} /> Reopen Day
          </Button>
        )}
        {!isLocked && (
          <Badge className="bg-amber-100 text-amber-700 text-[11px]">
            <Clock size={11} className="mr-1" /> Open
          </Badge>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-3 text-[11px] gap-1.5"
          onClick={printTallySummary}
        >
          <Printer size={12} /> Tally Summary
        </Button>
        <button
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground ml-2"
          onClick={() => setShowHistory(v => !v)}
        >
          Recent Closures <ChevronDown size={12} className={showHistory ? "rotate-180" : ""} />
        </button>
      </div>

      {/* ── History dropdown ── */}
      {showHistory && (
        <div className="flex-shrink-0 bg-card border-b border-border px-5 py-2">
          <div className="flex gap-3 overflow-x-auto">
            {history.length === 0 && <p className="text-[11px] text-muted-foreground">No previous closures.</p>}
            {history.map(h => (
              <button
                key={h.closure_date}
                onClick={() => { setClosureDate(h.closure_date); setShowHistory(false); }}
                className={`flex-shrink-0 text-left border rounded-lg px-3 py-2 text-[11px] min-w-[130px] hover:bg-muted/50 transition-colors ${
                  h.closure_date === closureDate ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <p className="font-semibold">
                  {new Date(h.closure_date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                </p>
                <p className="text-muted-foreground">{fmt(h.system_total)}</p>
                <span className={`font-bold ${h.status === "locked" ? "text-green-600" : "text-amber-600"}`}>
                  {h.status}
                </span>
                {h.variance !== 0 && (
                  <p className="text-destructive">Var: {fmt(h.variance)}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Reconciliation grid ── */}
      <div className="flex-shrink-0 grid grid-cols-2 gap-0 border-b border-border">
        {/* System totals */}
        <div className="bg-card border-r border-border px-5 py-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">System Totals (from transactions)</p>
          <div className="space-y-1.5">
            {MODES.map(m => (
              <div key={m} className="flex justify-between items-center text-[12px]">
                <span className="text-muted-foreground w-32">{MODE_LABELS[m]}</span>
                <span className="font-mono font-semibold tabular-nums">{fmt(systemTotals[m as keyof SystemTotals] as number)}</span>
              </div>
            ))}
            {systemTotals.other > 0 && (
              <div className="flex justify-between items-center text-[12px]">
                <span className="text-muted-foreground w-32">Other</span>
                <span className="font-mono font-semibold tabular-nums">{fmt(systemTotals.other)}</span>
              </div>
            )}
            {(systemTotals.advances > 0 || systemTotals.refunds > 0) && (
              <div className="mt-2 pt-1.5 border-t border-dashed border-border space-y-1">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                  Included above — for reference
                </p>
                {systemTotals.advances > 0 && (
                  <div className="flex justify-between items-center text-[12px] text-emerald-700">
                    <span className="w-32">Advance deposits taken</span>
                    <span className="font-mono font-semibold tabular-nums">+{fmt(systemTotals.advances)}</span>
                  </div>
                )}
                {systemTotals.refunds > 0 && (
                  <div className="flex justify-between items-center text-[12px] text-destructive">
                    <span className="w-32">Refunds Paid Out</span>
                    <span className="font-mono font-semibold tabular-nums">-{fmt(systemTotals.refunds)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-2 pt-2 border-t border-border flex justify-between items-center">
            <span className="text-[12px] font-bold">System Total</span>
            <span className="text-[14px] font-bold tabular-nums">{fmt(systemTotals.total)}</span>
          </div>
        </div>

        {/* Manual counts */}
        <div className="bg-muted/10 px-5 py-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Supervisor Physical Count</p>
          <div className="space-y-1">
            {MODES.map(m => (
              <div key={m} className="flex items-center gap-3 text-[12px]">
                <span className="text-muted-foreground w-32">{MODE_LABELS[m]}</span>
                <Input
                  type="number"
                  // No min: a tender's net movement is legitimately negative on a
                  // day its refunds exceed its takings (e.g. a ₹3,500 cash refund
                  // against ₹2,177 cash in), and the count must be able to match.
                  step="0.01"
                  placeholder="0"
                  value={manual[m]}
                  onChange={e => setManual(prev => ({ ...prev, [m]: e.target.value }))}
                  disabled={isLocked}
                  className="h-7 w-32 text-right text-[12px] font-mono"
                />
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-border flex justify-between items-center">
            <span className="text-[12px] font-bold">Manual Total</span>
            <span className="text-[14px] font-bold tabular-nums">{fmt(manualTotal)}</span>
          </div>
        </div>
      </div>

      {/* ── Variance bar ── */}
      <div className={`flex-shrink-0 px-5 py-2.5 border-b border-border flex items-center gap-4 ${
        varianceZero ? "bg-green-50" : "bg-red-50"
      }`}>
        {varianceZero ? (
          <CheckCircle2 size={16} className="text-green-600 shrink-0" />
        ) : (
          <AlertTriangle size={16} className="text-destructive shrink-0" />
        )}
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold">Variance:</span>
          <span className={`text-[14px] font-bold tabular-nums ${varianceZero ? "text-green-700" : "text-destructive"}`}>
            {variance >= 0 ? "+" : ""}{fmt(variance)}
          </span>
          {varianceZero && <span className="text-[11px] text-green-600">— Balanced</span>}
        </div>
        {!varianceZero && !isLocked && (
          <Textarea
            placeholder="Reason for variance (required to lock)"
            value={varianceReason}
            onChange={e => setVarianceReason(e.target.value)}
            className="h-8 text-[11px] flex-1 min-h-0 py-1 resize-none"
          />
        )}
        {!varianceZero && isLocked && varianceReason && (
          <p className="text-[11px] text-muted-foreground flex-1">{varianceReason}</p>
        )}
        <div className="ml-auto shrink-0">
          {!isLocked ? (
            <Button
              size="sm"
              className="h-8 px-5 text-xs font-bold bg-destructive hover:bg-destructive/90"
              disabled={!canLock || locking}
              onClick={lockDay}
            >
              <Lock size={13} className="mr-1.5" />
              {locking ? "Locking…" : "Lock Day"}
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 text-green-700 text-[12px] font-semibold">
              <CheckCircle2 size={14} />
              Locked {existing?.closed_at ? new Date(existing.closed_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : ""}
            </div>
          )}
        </div>
      </div>

      {/* ── Transaction list ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-shrink-0 px-5 py-1.5 bg-muted/50 border-b border-border/50 flex items-center">
          <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
            {payments.length} Transaction{payments.length !== 1 ? "s" : ""} — {dateLabel}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-muted/60 z-10">
              <tr>
                <th className="text-left px-5 py-1.5 text-[10px] font-bold uppercase text-muted-foreground">Time</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground">Patient</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground">Bill #</th>
                <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground">Mode</th>
                <th className="text-right px-5 py-1.5 text-[10px] font-bold uppercase text-muted-foreground">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-border/30 hover:bg-muted/20">
                  <td className="px-5 py-1.5 text-muted-foreground">{fmtTime(p.payment_time)}</td>
                  <td className="px-3 py-1.5 font-medium">{p.patient_name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground font-mono">{p.bill_number}</td>
                  <td className="px-3 py-1.5">
                    <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold uppercase">
                      {p.payment_mode}
                    </span>
                  </td>
                  <td className="px-5 py-1.5 text-right font-semibold tabular-nums">{fmt(p.amount)}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">No payments recorded for {dateLabel}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DailyCashClosurePage;
