import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import {
  Link2, CalendarDays, MessageSquare, HandCoins, RefreshCw,
  Copy, ExternalLink, AlertTriangle, CheckCircle2, Megaphone, QrCode
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import CollectionCampaignModal from "@/components/billing/CollectionCampaignModal";

interface OutstandingBill {
  id: string;
  bill_number: string;
  patient_id: string;
  patient_name: string;
  uhid: string;
  bill_date: string;
  total_amount: number;
  balance_due: number;
  bill_type: string;
  days_overdue: number;
}

interface EMIPlan {
  id: string;
  patient_name: string;
  total_amount: number;
  installments: number;
  installment_amount: number;
  amount_collected: number;
  status: string;
  next_due: string | null;
  frequency: string;
}

interface PayLink {
  id: string;
  patient_name: string;
  bill_number: string;
  amount: number;
  status: string;
  sent_via: string[];
  expires_at: string;
  link_token: string;
  short_url: string | null;
}

interface CollectionsTabProps {
  hospitalId: string;
}

const CollectionsTab: React.FC<CollectionsTabProps> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [bills, setBills] = useState<OutstandingBill[]>([]);
  const [emiPlans, setEmiPlans] = useState<EMIPlan[]>([]);
  const [payLinks, setPayLinks] = useState<PayLink[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [billTypeFilter, setBillTypeFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState("all");
  const [amountFilter, setAmountFilter] = useState("all");

  // EMI modal
  const [emiModal, setEmiModal] = useState<OutstandingBill | null>(null);
  const [emiInstallments, setEmiInstallments] = useState(3);
  const [emiFrequency, setEmiFrequency] = useState("monthly");
  const [emiCreating, setEmiCreating] = useState(false);

  // Collect modal
  const [collectModal, setCollectModal] = useState<OutstandingBill | null>(null);
  const [collectAmount, setCollectAmount] = useState("");
  const [collectMode, setCollectMode] = useState("cash");
  const [collecting, setCollecting] = useState(false);

  // Pay Link modal
  const [payLinkModal, setPayLinkModal] = useState<OutstandingBill | null>(null);
  const [payLinkAmount, setPayLinkAmount] = useState(0);
  const [payLinkExpiry, setPayLinkExpiry] = useState(7);
  const [payLinkGenerating, setPayLinkGenerating] = useState(false);
  const [generatedPayUrl, setGeneratedPayUrl] = useState("");
  const [generatedPayToken, setGeneratedPayToken] = useState("");

  // Campaign modal
  const [showCampaign, setShowCampaign] = useState(false);

  // EMI reminder sweep
  const [sendingReminders, setSendingReminders] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);

    // Outstanding bills
    const { data: billsData } = await supabase
      .from("bills")
      .select("id, bill_number, patient_id, bill_date, total_amount, balance_due, bill_type, patients(full_name, uhid)")
      .eq("hospital_id", hospitalId)
      .gt("balance_due", 0)
      .order("bill_date", { ascending: true })
      .limit(500);

    const outstanding: OutstandingBill[] = (billsData || []).map((b: any) => ({
      id: b.id,
      bill_number: b.bill_number,
      patient_id: b.patient_id,
      patient_name: b.patients?.full_name || "Unknown",
      uhid: b.patients?.uhid || "",
      bill_date: b.bill_date,
      total_amount: Number(b.total_amount) || 0,
      balance_due: Number(b.balance_due) || 0,
      bill_type: b.bill_type,
      days_overdue: differenceInDays(new Date(), new Date(b.bill_date)),
    }));
    setBills(outstanding);

    // EMI Plans
    const { data: emiData } = await supabase
      .from("emi_plans" as any)
      .select("*, patients(full_name)")
      .eq("hospital_id", hospitalId)
      .in("status", ["active"])
      .order("created_at", { ascending: false });

    const plans: EMIPlan[] = [];
    for (const p of (emiData || []) as any[]) {
      // Get next due installment
      const { data: nextInst } = await supabase
        .from("emi_installments" as any)
        .select("due_date")
        .eq("plan_id", p.id)
        .eq("status", "pending")
        .order("due_date")
        .limit(1);

      plans.push({
        id: p.id,
        patient_name: p.patients?.full_name || "Unknown",
        total_amount: Number(p.total_amount),
        installments: p.installments,
        installment_amount: Number(p.installment_amount),
        amount_collected: Number(p.amount_collected),
        status: p.status,
        frequency: p.frequency,
        next_due: (nextInst as any)?.[0]?.due_date || null,
      });
    }
    setEmiPlans(plans);

    // Pay Links
    const { data: linksData } = await supabase
      .from("payment_links" as any)
      .select("*, patients(full_name), bills(bill_number)")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(50);

    setPayLinks((linksData || []).map((l: any) => ({
      id: l.id,
      patient_name: l.patients?.full_name || "Unknown",
      bill_number: l.bills?.bill_number || "",
      amount: Number(l.amount),
      status: l.status,
      sent_via: l.sent_via || [],
      expires_at: l.expires_at,
      link_token: l.link_token,
      short_url: l.short_url,
    })));

    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { loadData(); }, [loadData]);

  // KPIs
  const totalOutstanding = bills.reduce((s, b) => s + b.balance_due, 0);
  const over30 = bills.filter(b => b.days_overdue > 30).reduce((s, b) => s + b.balance_due, 0);
  const over60 = bills.filter(b => b.days_overdue > 60).reduce((s, b) => s + b.balance_due, 0);
  const over90 = bills.filter(b => b.days_overdue > 90).reduce((s, b) => s + b.balance_due, 0);

  // Filtered bills
  const filtered = bills.filter(b => {
    if (billTypeFilter !== "all" && b.bill_type !== billTypeFilter) return false;
    if (daysFilter === "30" && b.days_overdue < 30) return false;
    if (daysFilter === "60" && b.days_overdue < 60) return false;
    if (daysFilter === "90" && b.days_overdue < 90) return false;
    if (amountFilter === "1000" && b.balance_due < 1000) return false;
    if (amountFilter === "5000" && b.balance_due < 5000) return false;
    if (amountFilter === "10000" && b.balance_due < 10000) return false;
    return true;
  });

  const overdueRowBg = (days: number) => {
    if (days > 90) return "bg-red-50";
    if (days > 60) return "bg-amber-100/50";
    if (days > 30) return "bg-amber-50/50";
    return "";
  };

  const fmt = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  // Generate pay link with full modal flow
  const generatePayLink = async () => {
    if (!payLinkModal) return;
    setPayLinkGenerating(true);
    const { data: userData } = await supabase.from("users").select("id").limit(1).maybeSingle();
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + payLinkExpiry * 86400000).toISOString();

    // Try to create a real Razorpay payment link
    let razorpayLinkId: string | null = null;
    let razorpayLinkUrl: string | null = null;
    let shortUrl: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const rzpRes = await supabase.functions.invoke("create-razorpay-payment-link", {
        body: {
          bill_id: payLinkModal.id,
          amount: payLinkAmount,
          patient_name: payLinkModal.patient_name,
          phone: payLinkModal.phone || null,
          hospital_id: hospitalId,
        },
      });
      if (!rzpRes.error && rzpRes.data?.razorpay_link_id) {
        razorpayLinkId = rzpRes.data.razorpay_link_id;
        razorpayLinkUrl = rzpRes.data.razorpay_link_url;
        shortUrl = rzpRes.data.short_url;
      }
    } catch {
      // Razorpay not configured — fall through to local link
    }

    const { error } = await supabase.from("payment_links" as any).insert({
      hospital_id: hospitalId,
      bill_id: payLinkModal.id,
      patient_id: payLinkModal.patient_id,
      link_token: token,
      amount: payLinkAmount,
      expires_at: expiresAt,
      created_by: userData?.id,
      sent_via: [],
      razorpay_link_id: razorpayLinkId,
      razorpay_link_url: razorpayLinkUrl,
      short_url: shortUrl,
    });

    if (error) {
      toast({ title: "Failed to create pay link", variant: "destructive" });
    } else {
      const url = shortUrl || `${window.location.origin}/pay/${token}`;
      setGeneratedPayUrl(url);
      setGeneratedPayToken(token);
      toast({ title: razorpayLinkId ? "Razorpay payment link generated ✓" : "Payment link generated ✓" });
      loadData();
    }
    setPayLinkGenerating(false);
  };

  const openPayLinkModal = (bill: OutstandingBill) => {
    setPayLinkModal(bill);
    setPayLinkAmount(bill.balance_due);
    setPayLinkExpiry(7);
    setGeneratedPayUrl("");
    setGeneratedPayToken("");
  };

  const sendPayLinkWhatsApp = async (bill: OutstandingBill, url: string) => {
    // Get patient phone
    const { data: patient } = await supabase.from("patients").select("phone").eq("id", bill.patient_id).maybeSingle();
    if (!patient?.phone) {
      toast({ title: "Patient phone not found", variant: "destructive" });
      return;
    }
    const msg = `Dear ${bill.patient_name}, your bill of ₹${bill.balance_due.toLocaleString("en-IN")} is pending. Pay securely here: ${url}`;
    const cleanPhone = patient.phone.replace(/\D/g, "");
    const fullPhone = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;
    window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");

    // Update sent_via
    if (generatedPayToken) {
      await supabase.from("payment_links" as any).update({ sent_via: ["whatsapp"] }).eq("link_token", generatedPayToken);
    }
    toast({ title: "Sent via WhatsApp" });
  };

  // WhatsApp reminder for outstanding bill
  const sendReminder = async (bill: OutstandingBill) => {
    const { data: patient } = await supabase.from("patients").select("phone").eq("id", bill.patient_id).maybeSingle();
    if (!patient?.phone) {
      toast({ title: "Patient phone not found", variant: "destructive" });
      return;
    }
    const msg = `Dear ${bill.patient_name}, your bill ${bill.bill_number} of ₹${bill.balance_due.toLocaleString("en-IN")} is overdue by ${bill.days_overdue} days. Please visit us or contact the hospital to settle.`;
    const cleanPhone = patient.phone.replace(/\D/g, "");
    const fullPhone = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;
    window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
    toast({ title: "Reminder sent via WhatsApp" });
  };

  // Check EMI reminders on load
  useEffect(() => {
    const checkEMIReminders = async () => {
      const threeDaysFromNow = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
      const { data: upcoming } = await supabase
        .from("emi_installments" as any)
        .select("id, installment_number, amount, due_date, reminder_sent_count")
        .eq("hospital_id", hospitalId)
        .eq("status", "pending")
        .lte("due_date", threeDaysFromNow)
        .is("last_reminder_at", null)
        .limit(20);

      if (upcoming && (upcoming as any[]).length > 0) {
        toast({ title: `${(upcoming as any[]).length} EMI installments due within 3 days — check Collections tab` });
      }
    };
    checkEMIReminders();
  }, [hospitalId]);

  const sendEMIReminders = async () => {
    setSendingReminders(true);
    const threeDaysFromNow = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];

    const { data: installments } = await supabase
      .from("emi_installments" as any)
      .select("id, amount, due_date, reminder_sent_count, plan_id, emi_plans!inner(patient_id, bill_id)")
      .eq("hospital_id", hospitalId)
      .eq("status", "pending")
      .gte("due_date", today)
      .lte("due_date", threeDaysFromNow)
      .limit(50);

    if (!installments || (installments as any[]).length === 0) {
      toast({ title: "No EMI reminders due in next 3 days" });
      setSendingReminders(false);
      return;
    }

    let sent = 0;
    for (const inst of installments as any[]) {
      const patientId = inst.emi_plans?.patient_id;
      if (!patientId) continue;

      const { data: patient } = await supabase.from("patients").select("full_name, phone").eq("id", patientId).maybeSingle();
      if (!patient?.phone) continue;

      const cleanPhone = patient.phone.replace(/\D/g, "");
      const fullPhone = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;
      const daysLeft = differenceInDays(new Date(inst.due_date), new Date());
      const msg = `Dear ${patient.full_name}, your EMI installment of ₹${Number(inst.amount).toLocaleString("en-IN")} is due on ${format(new Date(inst.due_date), "dd/MM/yyyy")} (${daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`}). Please arrange payment. Thank you.`;

      window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");

      await supabase
        .from("emi_installments" as any)
        .update({
          last_reminder_at: new Date().toISOString(),
          reminder_sent_count: (inst.reminder_sent_count || 0) + 1,
        })
        .eq("id", inst.id);

      sent++;
    }

    toast({ title: `EMI reminders sent: ${sent} of ${(installments as any[]).length} installments` });
    setSendingReminders(false);
  };

  // Create EMI plan
  const createEMI = async () => {
    if (!emiModal) return;
    setEmiCreating(true);
    const { data: userData } = await supabase.from("users").select("id").limit(1).maybeSingle();
    const installmentAmt = Math.ceil(emiModal.balance_due / emiInstallments);
    const firstDate = new Date();
    firstDate.setDate(firstDate.getDate() + (emiFrequency === "weekly" ? 7 : emiFrequency === "fortnightly" ? 14 : 30));

    const { data: plan, error } = await supabase.from("emi_plans" as any).insert({
      hospital_id: hospitalId,
      bill_id: emiModal.id,
      patient_id: emiModal.patient_id,
      total_amount: emiModal.balance_due,
      installments: emiInstallments,
      frequency: emiFrequency,
      first_payment_date: firstDate.toISOString().split("T")[0],
      installment_amount: installmentAmt,
      created_by: userData?.id,
    }).select("id").maybeSingle();

    if (error || !plan) {
      toast({ title: "Failed to create EMI plan", variant: "destructive" });
      setEmiCreating(false);
      return;
    }

    // Create installments
    const installments = [];
    for (let i = 0; i < emiInstallments; i++) {
      const dueDate = new Date(firstDate);
      if (emiFrequency === "weekly") dueDate.setDate(dueDate.getDate() + i * 7);
      else if (emiFrequency === "fortnightly") dueDate.setDate(dueDate.getDate() + i * 14);
      else dueDate.setMonth(dueDate.getMonth() + i);

      installments.push({
        hospital_id: hospitalId,
        plan_id: (plan as any).id,
        installment_number: i + 1,
        due_date: dueDate.toISOString().split("T")[0],
        amount: i === emiInstallments - 1
          ? emiModal.balance_due - installmentAmt * (emiInstallments - 1)
          : installmentAmt,
      });
    }

    await supabase.from("emi_installments" as any).insert(installments);
    toast({ title: `EMI plan created: ${emiInstallments} installments of ${fmt(installmentAmt)}` });
    setEmiModal(null);
    setEmiCreating(false);
    loadData();
  };

  // Mark collected
  const markCollected = async () => {
    if (!collectModal) return;
    setCollecting(true);
    const amount = parseFloat(collectAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      setCollecting(false);
      return;
    }

    const { data: userData } = await supabase.from("users").select("id").limit(1).maybeSingle();
    const { error } = await supabase.from("bill_payments").insert({
      hospital_id: hospitalId,
      bill_id: collectModal.id,
      amount,
      payment_mode: collectMode,
      received_by: userData?.id,
    });

    if (error) {
      toast({ title: "Failed to record payment", variant: "destructive" });
    } else {
      // Update bill
      const newPaid = amount;
      const newBalance = Math.max(0, collectModal.balance_due - amount);
      await supabase.from("bills").update({
        paid_amount: supabase.rpc ? newPaid : newPaid,
        balance_due: newBalance,
        payment_status: newBalance <= 0 ? "paid" : "partially_paid",
      }).eq("id", collectModal.id);

      toast({ title: `${fmt(amount)} collected via ${collectMode}` });
    }

    setCollectModal(null);
    setCollecting(false);
    loadData();
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/portal/pay/${token}`);
    toast({ title: "Link copied" });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><p className="text-sm text-muted-foreground">Loading collections...</p></div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* KPI pills */}
      <div className="flex gap-2 px-4 py-3 border-b border-border flex-shrink-0 flex-wrap">
        <Badge variant="outline" className="text-xs px-3 py-1.5 font-mono">Total: {fmt(totalOutstanding)}</Badge>
        <Badge variant="outline" className="text-xs px-3 py-1.5 font-mono bg-amber-50 text-amber-700 border-amber-200">&gt;30d: {fmt(over30)}</Badge>
        <Badge variant="outline" className="text-xs px-3 py-1.5 font-mono bg-orange-50 text-orange-700 border-orange-200">&gt;60d: {fmt(over60)}</Badge>
        <Badge variant="outline" className="text-xs px-3 py-1.5 font-mono bg-red-50 text-red-700 border-red-200">&gt;90d: {fmt(over90)}</Badge>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-4 py-2 border-b border-border flex-shrink-0 items-center flex-wrap">
        <Select value={billTypeFilter} onValueChange={setBillTypeFilter}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="opd">OPD</SelectItem>
            <SelectItem value="ipd">IPD</SelectItem>
            <SelectItem value="pharmacy">Pharmacy</SelectItem>
          </SelectContent>
        </Select>
        <Select value={daysFilter} onValueChange={setDaysFilter}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Days</SelectItem>
            <SelectItem value="30">30+ days</SelectItem>
            <SelectItem value="60">60+ days</SelectItem>
            <SelectItem value="90">90+ days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={amountFilter} onValueChange={setAmountFilter}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Amounts</SelectItem>
            <SelectItem value="1000">&gt;₹1,000</SelectItem>
            <SelectItem value="5000">&gt;₹5,000</SelectItem>
            <SelectItem value="10000">&gt;₹10,000</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={loadData}>
          <RefreshCw size={12} /> Refresh
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1 ml-auto" onClick={() => setShowCampaign(true)}>
          <Megaphone size={12} /> Run Campaign
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Outstanding Bills */}
        <div className="px-4 py-3">
          <h3 className="text-sm font-bold mb-2">Outstanding Bills ({filtered.length})</h3>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">Patient</th>
                  <th className="px-3 py-2 text-left">UHID</th>
                  <th className="px-3 py-2 text-left">Bill #</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-right">Due</th>
                  <th className="px-3 py-2 text-center">Days</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">No outstanding bills</td></tr>
                ) : filtered.slice(0, 100).map((b) => (
                  <tr key={b.id} className={cn("border-t border-border", overdueRowBg(b.days_overdue))}>
                    <td className="px-3 py-2 text-xs font-medium truncate max-w-[120px]">{b.patient_name}</td>
                    <td className="px-3 py-2 text-[11px] font-mono text-muted-foreground">{b.uhid}</td>
                    <td className="px-3 py-2 text-[11px] font-mono">{b.bill_number}</td>
                    <td className="px-3 py-2 text-xs">{format(new Date(b.bill_date), "dd/MM/yyyy")}</td>
                    <td className="px-3 py-2 text-xs text-right font-mono font-bold">{fmt(b.balance_due)}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant="outline" className={cn("text-[9px]",
                        b.days_overdue > 90 ? "bg-red-100 text-red-700" :
                        b.days_overdue > 60 ? "bg-orange-100 text-orange-700" :
                        b.days_overdue > 30 ? "bg-amber-100 text-amber-700" :
                        "bg-muted text-muted-foreground"
                      )}>{b.days_overdue}d</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Pay Link" onClick={() => openPayLinkModal(b)}>
                          <Link2 size={13} />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-1.5" title="EMI Plan" onClick={() => { setEmiModal(b); setEmiInstallments(3); }}>
                          <CalendarDays size={13} />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-1.5" title="WhatsApp Remind" onClick={() => sendReminder(b)}>
                          <MessageSquare size={13} />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Mark Collected" onClick={() => { setCollectModal(b); setCollectAmount(String(b.balance_due)); }}>
                          <HandCoins size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active EMI Plans */}
        {emiPlans.length > 0 && (
          <div className="px-4 py-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold">Active EMI Plans ({emiPlans.length})</h3>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={sendEMIReminders}
                disabled={sendingReminders}
              >
                <MessageSquare size={12} />
                {sendingReminders ? "Sending..." : "Send Reminders"}
              </Button>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                    <th className="px-3 py-2 text-left">Patient</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-center">Plan</th>
                    <th className="px-3 py-2 text-left">Next Due</th>
                    <th className="px-3 py-2 text-right">Collected</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {emiPlans.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-3 py-2 text-xs font-medium">{p.patient_name}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono">{fmt(p.total_amount)}</td>
                      <td className="px-3 py-2 text-center text-[11px]">{p.installments}× {fmt(p.installment_amount)} ({p.frequency})</td>
                      <td className="px-3 py-2 text-xs">
                        {p.next_due ? (
                          <span className={cn(new Date(p.next_due) < new Date() ? "text-red-600 font-bold" : "")}>
                            {format(new Date(p.next_due), "dd/MM/yyyy")}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-right font-mono">{fmt(p.amount_collected)}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className="text-[9px] capitalize">{p.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Active Pay Links */}
        {payLinks.length > 0 && (
          <div className="px-4 py-3 border-t border-border">
            <h3 className="text-sm font-bold mb-2">Payment Links ({payLinks.length})</h3>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                    <th className="px-3 py-2 text-left">Patient</th>
                    <th className="px-3 py-2 text-left">Bill</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-left">Sent Via</th>
                    <th className="px-3 py-2 text-left">Expires</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payLinks.map((l) => (
                    <tr key={l.id} className={cn("border-t border-border", l.status === "expired" ? "opacity-50" : "")}>
                      <td className="px-3 py-2 text-xs">{l.patient_name}</td>
                      <td className="px-3 py-2 text-[11px] font-mono">{l.bill_number}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono">{fmt(l.amount)}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className={cn("text-[9px] capitalize",
                          l.status === "paid" ? "bg-emerald-50 text-emerald-700" :
                          l.status === "expired" ? "bg-muted text-muted-foreground" :
                          "bg-blue-50 text-blue-700"
                        )}>{l.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-[11px]">{(l.sent_via || []).join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-xs">{format(new Date(l.expires_at), "dd/MM/yy")}</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => copyLink(l.link_token)}>
                          <Copy size={13} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* EMI Modal */}
      <Dialog open={!!emiModal} onOpenChange={() => setEmiModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarDays size={16} /> Create EMI Plan</DialogTitle>
          </DialogHeader>
          {emiModal && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <p><strong>{emiModal.patient_name}</strong> • {emiModal.bill_number}</p>
                <p className="text-lg font-bold mt-1">{fmt(emiModal.balance_due)} outstanding</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Installments</Label>
                  <Select value={String(emiInstallments)} onValueChange={(v) => setEmiInstallments(Number(v))}>
                    <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[2, 3, 4, 6, 8, 10, 12].map(n => (
                        <SelectItem key={n} value={String(n)}>{n} installments</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Frequency</Label>
                  <Select value={emiFrequency} onValueChange={setEmiFrequency}>
                    <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="fortnightly">Fortnightly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <p className="text-sm font-bold text-emerald-700">
                  {emiInstallments}× {fmt(Math.ceil(emiModal.balance_due / emiInstallments))} ({emiFrequency})
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmiModal(null)}>Cancel</Button>
            <Button onClick={createEMI} disabled={emiCreating}>
              {emiCreating ? "Creating..." : "Create EMI Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collect Modal */}
      <Dialog open={!!collectModal} onOpenChange={() => setCollectModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><HandCoins size={16} /> Record Collection</DialogTitle>
          </DialogHeader>
          {collectModal && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <p><strong>{collectModal.patient_name}</strong> • {collectModal.bill_number}</p>
                <p className="font-mono mt-1">Balance: {fmt(collectModal.balance_due)}</p>
              </div>
              <div>
                <Label className="text-xs">Amount (₹)</Label>
                <Input type="number" value={collectAmount} onChange={(e) => setCollectAmount(e.target.value)} className="h-9 mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Mode</Label>
                <Select value={collectMode} onValueChange={setCollectMode}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectModal(null)}>Cancel</Button>
            <Button onClick={markCollected} disabled={collecting}>
              {collecting ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Link Modal */}
      <Dialog open={!!payLinkModal} onOpenChange={() => setPayLinkModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 size={16} /> Generate Payment Link</DialogTitle>
          </DialogHeader>
          {payLinkModal && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <p><strong>{payLinkModal.patient_name}</strong> • {payLinkModal.bill_number}</p>
                <p className="font-mono mt-1">Balance: {fmt(payLinkModal.balance_due)}</p>
              </div>

              <div>
                <Label className="text-xs">Amount (₹)</Label>
                <Input type="number" value={payLinkAmount} onChange={(e) => setPayLinkAmount(Number(e.target.value))} className="h-9 mt-1 font-mono" />
              </div>

              <div>
                <Label className="text-xs mb-2 block">Expiry</Label>
                <div className="flex gap-2">
                  {[1, 3, 7, 30].map(d => (
                    <Button key={d} size="sm" variant={payLinkExpiry === d ? "default" : "outline"}
                      className="h-7 text-xs" onClick={() => setPayLinkExpiry(d)}>
                      {d} day{d > 1 ? "s" : ""}
                    </Button>
                  ))}
                </div>
              </div>

              {!generatedPayUrl ? (
                <Button onClick={generatePayLink} disabled={payLinkGenerating || payLinkAmount <= 0} className="w-full">
                  {payLinkGenerating ? "Generating..." : "Generate Pay Link"}
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="bg-muted/30 rounded-lg p-3 border border-border">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Pay Link</p>
                    <p className="text-xs font-mono break-all text-foreground">{generatedPayUrl}</p>
                  </div>

                  <div className="flex justify-center">
                    <QRCodeSVG value={generatedPayUrl} size={120} />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => {
                      navigator.clipboard.writeText(generatedPayUrl);
                      toast({ title: "Link copied ✓" });
                    }}>
                      <Copy size={13} /> Copy Link
                    </Button>
                    <Button size="sm" className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => sendPayLinkWhatsApp(payLinkModal, generatedPayUrl)}>
                      <MessageSquare size={13} /> WhatsApp
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Campaign Modal */}
      {showCampaign && (
        <CollectionCampaignModal
          hospitalId={hospitalId}
          onClose={() => setShowCampaign(false)}
          onComplete={() => { setShowCampaign(false); loadData(); }}
        />
      )}
    </div>
  );
};

export default CollectionsTab;
