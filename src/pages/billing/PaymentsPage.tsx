import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { IndianRupee, CreditCard, Link2, Wallet, Download, Printer, Search, Send, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { recordBillPayment } from "@/lib/billPayments";
import { printReceiptDoc } from "@/lib/receiptPrint";
import PaymentLinkModal from "@/components/billing/PaymentLinkModal";
import type { BillRecord } from "@/pages/billing/BillingPage";

// Razorpay payment method -> this app's payment_mode enum. Unrecognised
// methods (wallet, emi, ...) fall back to "upi" (always has a seeded
// auto_posting_rules row, so GL posting never silently no-ops).
const RAZORPAY_METHOD_MAP: Record<string, string> = { upi: "upi", card: "card", netbanking: "net_banking" };

const modeColors: Record<string, string> = {
  cash: "#10B981",
  upi: "#6366F1",
  card: "#3B82F6",
  insurance: "#F59E0B",
  pmjay: "#8B5CF6",
  net_banking: "#14B8A6",
  cheque: "#6B7280",
  advance_adjust: "#EC4899",
  credit: "#F97316",
  donation: "#9333EA",
};

const modeIcons: Record<string, string> = {
  cash: "💵",
  upi: "📱",
  card: "💳",
  insurance: "🏥",
  pmjay: "🏛️",
  net_banking: "🌐",
  cheque: "📝",
  advance_adjust: "🔄",
  credit: "🏥",
  donation: "🤝",
};

interface PaymentRow {
  id: string;
  payment_mode: string;
  amount: number;
  payment_date: string;
  payment_time: string;
  transaction_id: string | null;
  notes: string | null;
  bill_number: string;
  patient_name: string;
  uhid: string;
  bill_type: string;
}

const PaymentsPage: React.FC = () => {
  const { toast } = useToast();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  // Bumped by realtime/focus events to re-run all data effects on this screen live.
  const [reloadKey, setReloadKey] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [hospital80G, setHospital80G] = useState<{ name: string; registration_80g?: string; trust_pan?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState("today");
  const [modeFilter, setModeFilter] = useState("all");

  // Manual reconciliation
  const [manualTxnId, setManualTxnId] = useState("");
  const [outstandingTotal, setOutstandingTotal] = useState<number | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState<Record<string, any> | null>(null);

  // "Links Sent" / "Advances" KPIs
  const [linksSentCount, setLinksSentCount] = useState<number | null>(null);
  const [advancesOnHold, setAdvancesOnHold] = useState<number | null>(null);
  const [razorpayConfigured, setRazorpayConfigured] = useState(false);

  // Find-a-bill (attach reconciled payment / send payment link)
  const [billSearchTerm, setBillSearchTerm] = useState("");
  const [searchingBill, setSearchingBill] = useState(false);
  const [billSearchError, setBillSearchError] = useState("");
  const [foundBill, setFoundBill] = useState<BillRecord | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [showPaymentLinkModal, setShowPaymentLinkModal] = useState(false);

  // Fetch outstanding balance
  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("bills")
        .select("balance_due")
        .eq("hospital_id", hospitalId)
        .neq("payment_status", "paid");
      if (data) {
        const total = data.reduce((s: number, r: any) => s + (Number(r.balance_due) || 0), 0);
        setOutstandingTotal(total);
      }
    })();
  }, [hospitalId, payments, reloadKey]);

  // Links Sent (this period) + Advances on hold (all-time, mirrors Outstanding)
  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const now = new Date();
      let dateStart: string;
      switch (dateFilter) {
        case "yesterday": { const y = new Date(now); y.setDate(y.getDate() - 1); dateStart = y.toISOString().slice(0, 10); break; }
        case "week": { const w = new Date(now); w.setDate(w.getDate() - 7); dateStart = w.toISOString().slice(0, 10); break; }
        case "month": { const m = new Date(now); m.setMonth(m.getMonth() - 1); dateStart = m.toISOString().slice(0, 10); break; }
        default: dateStart = now.toISOString().slice(0, 10);
      }
      const [{ count: linkCount }, { data: advRows }] = await Promise.all([
        (supabase as any).from("payment_links").select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId).gte("created_at", dateStart),
        (supabase as any).from("advance_receipts").select("amount")
          .eq("hospital_id", hospitalId).eq("is_adjusted", false),
      ]);
      setLinksSentCount(linkCount ?? 0);
      setAdvancesOnHold((advRows || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0));
    })();
  }, [hospitalId, dateFilter, reloadKey]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (data?.hospital_id) {
        setUserId(data.id);
        setHospitalId(data.hospital_id);
        const { data: hosp } = await (supabase as any).from("hospitals")
          .select("name, registration_80g, trust_pan").eq("id", data.hospital_id).maybeSingle();
        if (hosp) setHospital80G(hosp);
        const { data: rzp } = await (supabase as any).from("api_configurations")
          .select("id").eq("hospital_id", data.hospital_id).eq("service_key", "razorpay").eq("is_active", true).maybeSingle();
        setRazorpayConfigured(!!rzp);
      }
    })();
  }, []);

  const searchBill = async () => {
    if (!hospitalId || !billSearchTerm.trim()) return;
    setSearchingBill(true);
    setBillSearchError("");
    setFoundBill(null);
    const term = billSearchTerm.trim();
    // Try by bill number first, then by patient UHID.
    let { data: bill } = await (supabase as any)
      .from("bills").select("*, patients!inner(full_name, uhid)")
      .eq("hospital_id", hospitalId).ilike("bill_number", `%${term}%`)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!bill) {
      const res = await (supabase as any)
        .from("bills").select("*, patients!inner(full_name, uhid)")
        .eq("hospital_id", hospitalId).ilike("patients.uhid", `%${term}%`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      bill = res.data;
    }
    setSearchingBill(false);
    if (!bill) { setBillSearchError("No bill found for that number or UHID"); return; }
    setFoundBill({
      ...bill,
      patient_name: bill.patients?.full_name || "Patient",
      uhid: bill.patients?.uhid || "",
    });
  };

  const attachLookupToFoundBill = async () => {
    if (!foundBill || !lookupResult || !hospitalId) return;
    setAttaching(true);
    try {
      const amount = Number(lookupResult.amount || 0);
      const mode = RAZORPAY_METHOD_MAP[lookupResult.method as string] || "upi";
      const newPaidAmount = Number(foundBill.paid_amount || 0) + amount;
      const newBalanceDue = Math.max(0, Number(foundBill.total_amount || 0) - newPaidAmount);
      const newPaymentStatus = newBalanceDue <= 0 ? "paid" : newPaidAmount > 0 ? "partial" : "unpaid";
      const result = await recordBillPayment({
        hospitalId,
        billId: foundBill.id,
        billNumber: foundBill.bill_number,
        patientId: foundBill.patient_id,
        admissionId: foundBill.admission_id,
        rows: [{ mode, amount, reference: manualTxnId.trim() }],
        collectedBy: userId,
        newPaidAmount,
        newBalanceDue,
        newPaymentStatus,
        sendReceipt: true,
      });
      if (!result.ok) throw new Error(result.error || "Failed to record payment");
      toast({ title: `₹${amount.toLocaleString("en-IN")} attached to Bill #${foundBill.bill_number} ✓` });
      setLookupResult(null);
      setManualTxnId("");
      setFoundBill(null);
      setBillSearchTerm("");
      fetchPayments();
    } catch (err: any) {
      toast({ title: "Failed to attach payment", description: err?.message, variant: "destructive" });
    } finally {
      setAttaching(false);
    }
  };

  const print80GReceipt = (p: PaymentRow) => {
    if (!hospitalId) return;
    const h = hospital80G;
    // Statutory identifiers (PAN, 80G registration) shown as a block on the shared receipt.
    const statutory = (h?.trust_pan || h?.registration_80g)
      ? `<div style="border-top:1px dashed #cbd5e1;padding-top:8px;margin-top:10px;font-size:11px;color:#64748b;">
          ${h?.trust_pan ? `<div>PAN: ${h.trust_pan}</div>` : ""}
          ${h?.registration_80g ? `<div>80G Registration: ${h.registration_80g}</div>` : ""}
        </div>`
      : "";
    void printReceiptDoc(hospitalId, {
      title: "80G DONATION RECEIPT",
      receiptNumber: p.bill_number,
      date: p.payment_date,
      patientName: p.patient_name,
      receivedFrom: p.patient_name,
      towards: "Donation",
      amountReceived: p.amount,
      paymentMode: p.payment_mode,
      reference: p.transaction_id,
      extraSections: statutory,
      footerNote: "Donation is eligible for income tax deduction under Section 80G of the Income Tax Act, 1961, subject to applicable limits.",
    });
  };

  const lookUpRazorpayTxn = async () => {
    if (!manualTxnId || !hospitalId) return;
    setLookingUp(true);
    setLookupResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("razorpay-lookup", {
        body: { payment_id: manualTxnId.trim(), hospital_id: hospitalId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error || res.data?.error) {
        toast({ title: "Lookup failed", description: res.data?.error || res.error?.message, variant: "destructive" });
      } else {
        setLookupResult(res.data);
      }
    } catch (e: any) {
      toast({ title: "Lookup error", description: e?.message, variant: "destructive" });
    }
    setLookingUp(false);
  };

  const fetchPayments = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const now = new Date();
    let dateStart: string;
    switch (dateFilter) {
      case "yesterday": {
        const y = new Date(now); y.setDate(y.getDate() - 1);
        dateStart = y.toISOString().slice(0, 10); break;
      }
      case "week": {
        const w = new Date(now); w.setDate(w.getDate() - 7);
        dateStart = w.toISOString().slice(0, 10); break;
      }
      case "month": {
        const m = new Date(now); m.setMonth(m.getMonth() - 1);
        dateStart = m.toISOString().slice(0, 10); break;
      }
      default: dateStart = now.toISOString().slice(0, 10);
    }

    let query = supabase
      .from("bill_payments")
      .select("*, bills!inner(bill_number, bill_type, patients!inner(full_name, uhid))")
      .eq("hospital_id", hospitalId)
      .gte("payment_date", dateStart)
      .order("payment_time", { ascending: false });

    if (modeFilter !== "all") query = query.eq("payment_mode", modeFilter);

    const { data } = await query;
    setPayments((data || []).map((p: any) => ({
      id: p.id,
      payment_mode: p.payment_mode,
      amount: Number(p.amount),
      payment_date: p.payment_date,
      payment_time: p.payment_time,
      transaction_id: p.transaction_id,
      notes: p.notes,
      bill_number: p.bills?.bill_number || "",
      patient_name: p.bills?.patients?.full_name || "",
      uhid: p.bills?.patients?.uhid || "",
      bill_type: p.bills?.bill_type || "",
    })));
    setLoading(false);
  }, [hospitalId, dateFilter, modeFilter]);

  useEffect(() => { fetchPayments(); }, [fetchPayments, reloadKey]);

  // Live updates for the payments list, outstanding, and advances-on-hold tiles.
  useRealtimeRefetch({
    tables: ["bill_payments", "bills", "advance_receipts", "payment_links"],
    hospitalId,
    onChange: () => setReloadKey((k) => k + 1),
    channelName: "billing-payments",
  });

  // KPIs
  const todayTotal = payments.reduce((s, p) => s + p.amount, 0);
  const byMode: Record<string, number> = {};
  payments.forEach((p) => { byMode[p.payment_mode] = (byMode[p.payment_mode] || 0) + p.amount; });
  const chartData = Object.entries(byMode).map(([mode, amount]) => ({ mode, amount }));

  // Outstanding (separate query would be ideal, using placeholder)
  const fmt = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0 });

  const dateFilters = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "week", label: "This Week" },
    { value: "month", label: "This Month" },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-muted/30">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-base font-bold text-foreground">Payment Collections</h1>
          <p className="text-xs text-muted-foreground">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => {
            const { printDocument } = require("@/lib/printUtils");
            printDocument("Outstanding Payments Summary", `<h2 style="color:#1A2F5A">Outstanding Payments Summary</h2><p class="label">Generated on ${new Date().toLocaleDateString("en-IN")}</p>`);
          }}>
            <Printer size={14} /> Print Summary
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 px-6 py-4 flex-shrink-0">
        <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><IndianRupee size={16} className="text-emerald-600" /></div>
            <span className="text-[11px] font-medium text-muted-foreground uppercase">Collected</span>
          </div>
          <p className="text-xl font-bold text-emerald-600 tabular-nums">{fmt(todayTotal)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {Object.entries(byMode).slice(0, 3).map(([m, a]) => `${m}: ${fmt(a)}`).join(" · ")}
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center"><Wallet size={16} className="text-destructive" /></div>
            <span className="text-[11px] font-medium text-muted-foreground uppercase">Outstanding</span>
          </div>
          <p className="text-xl font-bold text-destructive tabular-nums">{outstandingTotal !== null ? fmt(outstandingTotal) : "—"}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{outstandingTotal !== null ? "Unpaid bills" : "Loading..."}</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center"><Link2 size={16} className="text-blue-600" /></div>
            <span className="text-[11px] font-medium text-muted-foreground uppercase">Links Sent</span>
          </div>
          <p className="text-xl font-bold text-blue-600 tabular-nums">{linksSentCount !== null ? linksSentCount : "—"}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{dateFilters.find(f => f.value === dateFilter)?.label} · awaiting payment</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center"><CreditCard size={16} className="text-violet-600" /></div>
            <span className="text-[11px] font-medium text-muted-foreground uppercase">Advances</span>
          </div>
          <p className="text-xl font-bold text-violet-600 tabular-nums">{advancesOnHold !== null ? fmt(advancesOnHold) : "—"}</p>
          <p className="text-[10px] text-muted-foreground mt-1">On hold, not yet adjusted</p>
        </div>
      </div>

      {/* Main content: Table + Chart */}
      <div className="flex-1 flex overflow-hidden px-6 pb-4 gap-4">
        {/* Table */}
        <div className="flex-1 flex flex-col bg-card rounded-xl border border-border overflow-hidden">
          {/* Filters */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
            <div className="flex gap-1">
              {dateFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setDateFilter(f.value)}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${dateFilter === f.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Select value={modeFilter} onValueChange={setModeFilter}>
              <SelectTrigger className="w-[140px] h-7 text-xs">
                <SelectValue placeholder="All Modes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modes</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="insurance">Insurance</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                  <th className="px-4 py-2 text-left">Time</th>
                  <th className="px-4 py-2 text-left">Patient</th>
                  <th className="px-4 py-2 text-left">Bill #</th>
                  <th className="px-4 py-2 text-center">Mode</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Reference</th>
                  <th className="px-4 py-2 text-left"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</td></tr>
                ) : payments.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No payments found for this period</td></tr>
                ) : payments.map((p) => (
                  <tr key={p.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {p.payment_time ? new Date(p.payment_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-xs font-medium text-foreground">{p.patient_name}</p>
                      <p className="text-[10px] text-muted-foreground">{p.uhid}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{p.bill_number}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge
                        variant="outline"
                        className="text-[10px] h-5"
                        style={{ borderColor: modeColors[p.payment_mode] || "#6B7280", color: modeColors[p.payment_mode] || "#6B7280" }}
                      >
                        {modeIcons[p.payment_mode] || "💰"} {p.payment_mode.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-bold text-foreground tabular-nums">{fmt(p.amount)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{p.transaction_id || "—"}</td>
                    <td className="px-4 py-2.5">
                      {p.payment_mode === "donation" && hospital80G?.registration_80g && (
                        <button onClick={() => print80GReceipt(p)}
                          className="text-[10px] px-2 py-0.5 rounded border border-purple-300 text-purple-700 hover:bg-purple-50 font-semibold flex items-center gap-1">
                          <Printer size={10} /> 80G
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {payments.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/30 font-bold border-t-2 border-border">
                    <td colSpan={5} className="px-4 py-2.5 text-xs text-right text-muted-foreground uppercase">Total</td>
                    <td className="px-4 py-2.5 text-right text-sm text-foreground tabular-nums">{fmt(todayTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Right sidebar: Chart + Reconciliation */}
        <div className="w-[280px] flex flex-col gap-4 flex-shrink-0">
          {/* Chart */}
          <div className="bg-card rounded-xl border border-border p-4 flex-1">
            <p className="text-[11px] font-bold uppercase text-muted-foreground mb-3">Collection by Mode</p>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="mode" width={65} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(val: number) => fmt(val)}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={18}>
                    {chartData.map((entry) => (
                      <Cell key={entry.mode} fill={modeColors[entry.mode] || "#6B7280"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">No data</p>
            )}
          </div>

          {/* Find a Bill — for sending a payment link or attaching a reconciled payment */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">Find a Bill</p>
            <div className="flex gap-1.5 mb-2">
              <Input
                placeholder="Bill # or UHID"
                value={billSearchTerm}
                onChange={(e) => { setBillSearchTerm(e.target.value); setFoundBill(null); setBillSearchError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") searchBill(); }}
                className="text-xs h-8"
              />
              <Button size="sm" variant="outline" className="h-8 px-2.5 shrink-0" disabled={!billSearchTerm.trim() || searchingBill} onClick={searchBill}>
                <Search size={13} />
              </Button>
            </div>
            {billSearchError && <p className="text-[10px] text-destructive mb-1">{billSearchError}</p>}
            {foundBill && (
              <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-2 text-[11px]">
                <div>
                  <p className="font-bold text-foreground">{foundBill.patient_name}</p>
                  <p className="text-muted-foreground">#{foundBill.bill_number} · {foundBill.uhid} · Balance {fmt(foundBill.balance_due)}</p>
                </div>
                <Button size="sm" variant="outline" className="w-full h-7 text-[11px] gap-1" onClick={() => setShowPaymentLinkModal(true)}>
                  <Send size={11} /> Send Payment Link
                </Button>
                {lookupResult?.status === "captured" && (
                  <Button size="sm" className="w-full h-7 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={attaching} onClick={attachLookupToFoundBill}>
                    <CheckCircle2 size={11} /> {attaching ? "Attaching…" : `Attach ₹${Number(lookupResult.amount).toLocaleString("en-IN")} Payment`}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Manual Reconciliation */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">Manual Reconciliation</p>
            <p className="text-[10px] text-muted-foreground mb-3">
              Enter Razorpay payment ID to look up transaction details, then find the bill above to attach it.
            </p>
            <Input
              placeholder="pay_xxxxxxxxxxxxx"
              value={manualTxnId}
              onChange={(e) => { setManualTxnId(e.target.value); setLookupResult(null); }}
              className="text-xs h-8 mb-2"
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs h-8"
              disabled={!manualTxnId || lookingUp}
              onClick={lookUpRazorpayTxn}
            >
              {lookingUp ? "Looking up..." : "Look Up Transaction"}
            </Button>
            {lookupResult && (
              <div className="mt-3 rounded-lg border border-border bg-muted/30 p-2.5 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`font-bold capitalize ${lookupResult.status === "captured" ? "text-green-600" : "text-amber-600"}`}>{lookupResult.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-bold">₹{Number(lookupResult.amount).toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Method</span>
                  <span className="capitalize">{lookupResult.method || "—"}</span>
                </div>
                {lookupResult.contact && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contact</span>
                    <span>{lookupResult.contact}</span>
                  </div>
                )}
                {lookupResult.captured_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Captured</span>
                    <span>{new Date(lookupResult.captured_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                )}
                {lookupResult.status === "captured" && !foundBill && (
                  <p className="text-[10px] text-muted-foreground pt-1">Find the bill above, then attach this payment.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showPaymentLinkModal && foundBill && hospitalId && (
        <PaymentLinkModal
          bill={foundBill}
          hospitalId={hospitalId}
          hospitalName={hospital80G?.name || "Hospital"}
          razorpayConfigured={razorpayConfigured}
          onClose={() => setShowPaymentLinkModal(false)}
        />
      )}
    </div>
  );
};

export default PaymentsPage;
