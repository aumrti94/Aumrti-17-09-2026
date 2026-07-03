import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Receipt, Printer, MessageSquare, FileText, Send, Lock, AlertTriangle, ShieldAlert } from "lucide-react";
import { printDocument, printHeader, printAmount } from "@/lib/printUtils";
import { logRecordAccess } from "@/lib/ims";
import { Badge } from "@/components/ui/badge";
import RevenueIntelligencePanel from "@/components/billing/RevenueIntelligencePanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import LineItemsTab from "@/components/billing/tabs/LineItemsTab";
import PaymentsTab from "@/components/billing/tabs/PaymentsTab";
import InsuranceTab from "@/components/billing/tabs/InsuranceTab";
import DiscountTab from "@/components/billing/tabs/DiscountTab";
import AdvanceApplicationTab from "@/components/billing/tabs/AdvanceApplicationTab";
import GSTInvoiceModal from "@/components/billing/GSTInvoiceModal";
import PaymentLinkModal from "@/components/billing/PaymentLinkModal";
import { useWhatsAppNotification } from "@/components/whatsapp/WhatsAppNotificationCard";
import { sendBillGenerated } from "@/lib/whatsapp-notifications";
import { validateGSTLineItems } from "@/lib/compliance-checks";
import { autoPostJournalEntry } from "@/lib/accounting";
import { logAudit } from "@/lib/auditLog";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { autoPullAdmissionCharges } from "@/lib/ipdBilling";
import { formatINR } from "@/lib/currency";
import type { BillRecord } from "@/pages/billing/BillingPage";

interface DiscountApproval {
  id: string;
  discount_amount: number;
  discount_pct: number;
  reason: string;
  required_approver_role: string;
  status: string;
  requested_at: string;
  approved_at: string | null;
  rejection_reason: string | null;
  requester: { full_name: string } | null;
  approver: { full_name: string } | null;
}

export interface LineItem {
  id: string;
  description: string;
  item_type: string;
  quantity: number;
  unit_rate: number;
  discount_percent: number;
  gst_percent: number;
  total_amount: number;
  source_module: string | null;
  service_id: string | null;
  hsn_code: string | null;
}

export interface PaymentRecord {
  id: string;
  payment_mode: string;
  amount: number;
  payment_date: string;
  transaction_id: string | null;
  notes: string | null;
}

const statusBadgeStyle: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  final: "bg-primary/10 text-primary",
  unpaid: "bg-destructive/10 text-destructive",
  partial: "bg-accent/10 text-accent",
  paid: "bg-success/10 text-success",
  pending_approval: "bg-amber-100 text-amber-700",
};

interface Props {
  bill: BillRecord | null;
  hospitalId: string | null;
  onRefresh: () => void;
}

interface AdmissionEstimate {
  estimated_days: number;
  estimated_amount: number;
  deposit_required: number;
  remarks: string | null;
}

const BillEditor: React.FC<Props> = ({ bill, hospitalId, onRefresh }) => {
  const { toast } = useToast();
  const { show: showWaNotif, card: waCard } = useWhatsAppNotification();
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [showGstInvoice, setShowGstInvoice] = useState(false);
  const [showPaymentLink, setShowPaymentLink] = useState(false);
  const [hospitalInfo, setHospitalInfo] = useState<any>(null);
  const [estimateData, setEstimateData] = useState<AdmissionEstimate | null>(null);
  const [netAdvanceBalance, setNetAdvanceBalance] = useState<number | null>(null);
  const [discountApprovals, setDiscountApprovals] = useState<DiscountApproval[]>([]);

  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("hospitals").select("name, gstin, address, logo_url, primary_color").eq("id", hospitalId).maybeSingle()
      .then(({ data }) => setHospitalInfo(data));
  }, [hospitalId]);

  // Fetch admission estimate + net advance balance for IPD bills
  useEffect(() => {
    if (!bill || bill.bill_type !== "ipd" || !bill.admission_id || !hospitalId) {
      setEstimateData(null); setNetAdvanceBalance(null); return;
    }
    (supabase as any)
      .from("admission_estimates")
      .select("estimated_days, estimated_amount, deposit_required, remarks")
      .eq("admission_id", bill.admission_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: any) => setEstimateData(data || null));

    Promise.all([
      (supabase as any)
        .from("ipd_advance_balances")
        .select("balance")
        .eq("admission_id", bill.admission_id)
        .eq("hospital_id", hospitalId)
        .maybeSingle(),
      (supabase as any)
        .from("advance_receipts")
        .select("amount, receipt_number")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", bill.patient_id),
      (supabase as any)
        .from("ipd_advances")
        .select("reference_no")
        .eq("admission_id", bill.admission_id)
        .not("reference_no", "is", null),
    ]).then(([advRes, receiptsRes, refsRes]: any[]) => {
      const mirroredRefs = new Set((refsRes.data || []).map((r: any) => r.reference_no));
      const unmirroredTotal = (receiptsRes.data || [])
        .filter((r: any) => !mirroredRefs.has(r.receipt_number))
        .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
      setNetAdvanceBalance(Number(advRes.data?.balance || 0) + unmirroredTotal);
    });
  }, [bill?.id, bill?.admission_id, hospitalId]);

  // Auto-reconcile DB when advance + cash fully cover the bill but DB still shows partial/unpaid.
  // This corrects stale balance_due/payment_status written before the fix was in place.
  useEffect(() => {
    if (!bill || bill.bill_type !== "ipd" || netAdvanceBalance === null || payments.length === 0 && netAdvanceBalance === 0) return;
    if (bill.payment_status === "paid" || bill.payment_status === "refunded") return;
    const patientPayable = Math.max(0, (bill.patient_payable ?? bill.total_amount) - Number(bill.discount_amount || 0));
    const directCashPaid = payments.reduce((s, p) => s + p.amount, 0);
    const effectiveBalance = Math.max(0, patientPayable - netAdvanceBalance - directCashPaid);
    if (effectiveBalance === 0 && patientPayable > 0) {
      (supabase as any).from("bills").update({
        balance_due: 0,
        payment_status: "paid",
      }).eq("id", bill.id).then(() => onRefresh());
    }
  }, [netAdvanceBalance, payments, bill?.id, bill?.payment_status]);

  const fetchLineItems = useCallback(async () => {
    if (!bill) return;
    setLoadingItems(true);
    const { data } = await (supabase as any)
      .from("bill_line_items")
      .select("*")
      .eq("bill_id", bill.id)
      .order("created_at", { ascending: true });
    setLineItems(
      (data || []).map((d: any) => ({
        id: d.id,
        description: d.description,
        item_type: d.item_type,
        quantity: Number(d.quantity),
        unit_rate: Number(d.unit_rate),
        discount_percent: Number(d.discount_percent),
        gst_percent: Number(d.gst_percent),
        total_amount: Number(d.total_amount),
        source_module: d.source_module,
        service_id: d.service_id,
        hsn_code: d.hsn_code,
      }))
    );
    setLoadingItems(false);
  }, [bill]);

  const fetchPayments = useCallback(async () => {
    if (!bill) return;
    const { data } = await supabase
      .from("bill_payments")
      .select("*")
      .eq("bill_id", bill.id)
      .order("created_at", { ascending: true });
    setPayments(
      (data || [])
        .filter((p: any) => !p.is_advance)
        .map((p: any) => ({
          id: p.id,
          payment_mode: p.payment_mode,
          amount: Number(p.amount),
          payment_date: p.payment_date,
          transaction_id: p.transaction_id,
          notes: p.notes,
        }))
    );
  }, [bill]);

  const fetchDiscountApprovals = useCallback(async () => {
    if (!bill) return;
    const { data } = await (supabase as any)
      .from("bill_discount_approvals")
      .select("*, requester:users!bill_discount_approvals_requested_by_fkey(full_name), approver:users!bill_discount_approvals_approved_by_fkey(full_name)")
      .eq("bill_id", bill.id)
      .order("requested_at", { ascending: false });
    setDiscountApprovals(data || []);
  }, [bill]);

  useEffect(() => {
    fetchLineItems();
    fetchPayments();
    fetchDiscountApprovals();
  }, [fetchLineItems, fetchPayments, fetchDiscountApprovals]);

  // Auto-pull admission charges on first open of a draft IPD bill
  const autoPulledRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!bill || !hospitalId) return;
    if (bill.bill_type !== "ipd" || !bill.admission_id) return;
    if (bill.bill_status !== "draft") return;
    if (autoPulledRef.current.has(bill.id)) return;
    autoPulledRef.current.add(bill.id);
    (async () => {
      const result = await autoPullAdmissionCharges(bill.id, bill.admission_id!, hospitalId);
      if (result.ok && result.insertedCount > 0) {
        toast({ title: `Pulled ${result.insertedCount} IPD charges`, description: "Room, doctor visits, lab, radiology, pharmacy, nursing." });
        fetchLineItems();
        onRefresh();
      }
      if (result.usedFallbackRate) {
        toast({ title: "Using fallback rates", description: "Configure service rates in Settings → Service Rates." });
      }
    })();
  }, [bill, hospitalId, fetchLineItems, onRefresh, toast]);

  const handleFinalize = async () => {
    if (!bill || !hospitalId) return;

    // CGHS/ECHS referral check
    const { data: patientData } = await (supabase as any)
      .from("patients").select("patient_category").eq("id", bill.patient_id).maybeSingle();
    if (patientData?.patient_category === "cghs" || patientData?.patient_category === "echs") {
      const { data: cghs } = await (supabase as any)
        .from("cghs_echs_beneficiaries")
        .select("referral_date, referral_hospital")
        .eq("patient_id", bill.patient_id).eq("hospital_id", hospitalId)
        .not("referral_date", "is", null).limit(1).maybeSingle();
      if (!cghs) {
        toast({
          title: "CGHS / ECHS Referral Missing",
          description: "Add a valid referral in Insurance → CGHS / ECHS before finalising this bill.",
          variant: "destructive",
        });
        return;
      }
    }

    // GST compliance: check HSN codes
    // Hard-block only if hospital has a GSTIN (formal GST invoice required).
    // Without GSTIN, show a warning but allow finalisation.
    const missingHSN = validateGSTLineItems(lineItems);
    if (missingHSN.length > 0) {
      if (hospitalInfo?.gstin) {
        toast({
          title: "HSN code missing",
          description: `HSN code missing for: ${[...new Set(missingHSN)].join(", ")}. Add HSN codes in Settings → Service Rates before finalising.`,
          variant: "destructive",
        });
        return;
      } else {
        toast({
          title: "HSN codes not set",
          description: `${[...new Set(missingHSN)].join(", ")} — add HSN codes in Settings → Service Rates for GST invoicing.`,
        });
      }
    }

    await supabase.from("bills").update({ bill_status: "final" }).eq("id", bill.id);

    // --- Accrual Revenue Recognition ---
    // Ensure posting rules exist for this hospital
    await (supabase as any).rpc("ensure_billing_posting_rules", { p_hospital_id: hospitalId });

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    const postedBy = user?.id || "system";

    // Determine trigger event based on bill type
    const billTypeMap: Record<string, string> = {
      opd: "bill_finalized_opd",
      ipd: "bill_finalized_ipd",
      lab: "bill_finalized_lab",
      radiology: "bill_finalized_radiology",
      pharmacy: "bill_finalized_pharmacy",
      ot: "bill_finalized_ot",
    };
    const triggerEvent = billTypeMap[bill.bill_type] || "bill_finalized_generic";

    // Post revenue journal entry: Dr. AR / Cr. Revenue
    const totalAmount = bill.total_amount || 0;
    if (totalAmount > 0) {
      await autoPostJournalEntry({
        triggerEvent,
        sourceModule: "billing",
        sourceId: bill.id,
        amount: totalAmount,
        description: `Revenue: Bill #${bill.bill_number} (${bill.bill_type.toUpperCase()}) — ${bill.patient_name}`,
        entryDate: bill.bill_date,
        hospitalId,
        postedBy,
      });

      // If insurance component exists, reclassify: Dr. Insurance Receivable / Cr. AR
      const insuranceAmount = bill.insurance_amount || 0;
      if (insuranceAmount > 0) {
        await autoPostJournalEntry({
          triggerEvent: "bill_insurance_reclassify",
          sourceModule: "billing",
          sourceId: bill.id,
          amount: insuranceAmount,
          description: `Insurance reclassification: Bill #${bill.bill_number} — ${bill.patient_name}`,
          entryDate: bill.bill_date,
          hospitalId,
          postedBy,
        });
      }
    }

    toast({ title: "Bill finalized" });
    logAudit({ action: "updated", module: "billing", entityType: "bill", entityId: bill.id, details: { status: "finalized", amount: bill.total_amount, billNumber: bill.bill_number } });

    // Trigger WhatsApp notification
    const { data: patient } = await supabase.from("patients").select("full_name, phone").eq("id", bill.patient_id).maybeSingle();
    if (patient?.phone && hospitalInfo) {
      const result = await sendBillGenerated({
        hospitalId,
        hospitalName: hospitalInfo.name || "Hospital",
        patientId: bill.patient_id,
        patientName: patient.full_name,
        phone: patient.phone,
        billNumber: bill.bill_number,
        billDate: bill.bill_date,
        totalAmount: bill.total_amount,
        insuranceAmount: bill.insurance_amount,
        patientPayable: bill.patient_payable,
      });
      showWaNotif(patient.full_name, "bill_generated", result.waUrl);
    }

    onRefresh();
  };

  const isIRNLocked = !!bill?.irn;

  const handleGenerateGST = () => {
    toast({
      title: "Live e-Invoice not configured",
      description: "NIC IRP API integration is required for GST e-Invoice generation. Contact your implementation partner to enable this feature.",
      variant: "destructive",
    });
  };

  const recalcBillTotals = async () => {
    if (!bill || !hospitalId) return;
    const result = await recalculateBillTotalsSafe(bill.id);
    if (!result.ok) {
      console.error("Bill total recalculation failed:", result.error);
      toast({ title: "Bill total update failed", description: result.error || "Please refresh the page", variant: "destructive" });
    }
    onRefresh();
  };

  if (!bill) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-muted/30">
        <Receipt size={48} className="text-muted-foreground/30 mb-3" />
        <p className="text-base text-muted-foreground">Select a bill or create a new one</p>
      </div>
    );
  }

  return (
    <>
    {waCard}
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-muted/30">
      {/* Header */}
      <div className="bg-card border-b border-border px-5 py-3 flex items-center gap-4 flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
          {bill.patient_name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-foreground">{bill.patient_name}</p>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] h-5">{bill.uhid}</Badge>
            <span className="text-[11px] font-mono text-muted-foreground">Bill #{bill.bill_number}</span>
          </div>
        </div>
        <div className="text-center">
          <Badge variant="outline" className="text-[10px] h-5 mb-1">{bill.bill_type.toUpperCase()}</Badge>
          <p className="text-[11px] text-muted-foreground">{bill.bill_date}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={cn("text-[10px]", statusBadgeStyle[bill.payment_status] || statusBadgeStyle.unpaid)}>
            {bill.payment_status.toUpperCase()}
          </Badge>
          {isIRNLocked && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-700">
              <Lock size={10} /> IRN Locked
            </Badge>
          )}
          {bill.bill_status === "draft" && (
            <Button size="sm" className="h-7 text-[11px]" onClick={handleFinalize}>Finalise Bill</Button>
          )}
          {bill.bill_status === "pending_approval" && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 border border-amber-300">
              <ShieldAlert size={13} className="text-amber-600 shrink-0" />
              <span className="text-[11px] font-semibold text-amber-800">Awaiting discount approval</span>
            </div>
          )}
          {bill.bill_status === "final" && bill.gst_amount > 0 && !isIRNLocked && (
            <Button size="sm" className="h-7 text-[11px] gap-1 bg-emerald-700 hover:bg-emerald-800 text-white" onClick={handleGenerateGST}>
              <FileText size={12} /> GST Invoice
            </Button>
          )}
          {bill.balance_due > 0 && (
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setShowPaymentLink(true)}>
              <Send size={12} /> Payment Link
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => {
            const itemsHtml = lineItems.map((i, idx) => {
              const taxable = i.quantity * i.unit_rate * (1 - i.discount_percent / 100);
              const gst = taxable * i.gst_percent / 100;
              return `<tr><td>${idx + 1}</td><td>${i.description}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">${printAmount(i.unit_rate)}</td><td style="text-align:right">${printAmount(taxable + gst)}</td></tr>`;
            }).join("");
            const totalAmt = lineItems.reduce((s, i) => s + i.total_amount, 0);
            const body = `${printHeader(hospitalInfo?.name || "Hospital", `Bill #${bill.bill_number}`, `<p style="font-size:11px;color:#64748b">${hospitalInfo?.address || ""}</p>`, hospitalInfo?.logo_url, hospitalInfo?.primary_color)}
              <div class="row"><span class="label">Patient:</span><span>${bill.patient_name} (${bill.uhid})</span></div>
              <div class="row"><span class="label">Date:</span><span>${bill.bill_date}</span></div>
              <div class="row"><span class="label">Type:</span><span class="badge">${bill.bill_type.toUpperCase()}</span></div>
              <table><tr><th>#</th><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr>${itemsHtml}</table>
              <div class="row"><span class="label">Subtotal</span><span class="amount">${printAmount(bill.subtotal)}</span></div>
              ${bill.gst_amount > 0 ? `<div class="row"><span class="label">GST</span><span class="amount">${printAmount(bill.gst_amount)}</span></div>` : ""}
              ${bill.discount_amount > 0 ? `<div class="row"><span class="label">Discount</span><span class="amount">-${printAmount(bill.discount_amount)}</span></div>` : ""}
              <div class="total-row"><span>Total</span><span class="amount">${printAmount(bill.total_amount)}</span></div>
              ${bill.advance_received > 0 ? `<div class="row"><span class="label">Advance</span><span>-${printAmount(bill.advance_received)}</span></div>` : ""}
              ${bill.insurance_amount > 0 ? `<div class="row"><span class="label">Insurance</span><span>-${printAmount(bill.insurance_amount)}</span></div>` : ""}
              <div class="row" style="font-weight:bold;font-size:15px"><span>Patient Payable</span><span class="amount">${printAmount(Math.max(0, bill.patient_payable))}</span></div>
              ${bill.paid_amount > 0 ? `<div class="row"><span class="label">Paid</span><span>${printAmount(bill.paid_amount)}</span></div>` : ""}
              ${bill.balance_due > 0 ? `<div class="row" style="color:#dc2626;font-weight:bold"><span>Balance Due</span><span>${printAmount(bill.balance_due)}</span></div>` : ""}
              ${discountApprovals.filter(a => a.status === "approved").length > 0 ? `
                <div style="margin-top:12px;border-top:1px dashed #ccc;padding-top:10px">
                  <p style="font-size:10px;font-weight:bold;text-transform:uppercase;color:#555;margin-bottom:6px">Discount Authorisation</p>
                  ${discountApprovals.filter(a => a.status === "approved").map(a => `
                    <div style="font-size:10px;color:#444;margin-bottom:3px">
                      ${printAmount(a.discount_amount)} (${Number(a.discount_pct).toFixed(1)}%) discount approved by ${a.approver?.full_name || "—"} on ${a.approved_at ? new Date(a.approved_at).toLocaleDateString("en-IN") : "—"}
                      — <em>${a.reason}</em>
                    </div>
                  `).join("")}
                </div>
              ` : ""}`;
            logRecordAccess({ hospitalId, recordType: "Billing", recordId: bill.id, patientId: bill.patient_id, action: "print" });
            printDocument(`Bill ${bill.bill_number}`, body);
          }}>
            <Printer size={12} /> Print
          </Button>
        </div>
      </div>

      {/* AI Revenue Intelligence */}
      <RevenueIntelligencePanel bill={bill} hospitalId={hospitalId} lineItems={lineItems} />

      {/* Estimate vs Actual comparison (IPD bills only) */}
      {estimateData && bill.bill_type === "ipd" && (() => {
        const actual = Math.max(0, bill.patient_payable ?? bill.total_amount);
        const estimated = estimateData.estimated_amount || 0;
        const overrun = estimated > 0 ? ((actual - estimated) / estimated) * 100 : 0;
        const isOverBudget = overrun > 20;
        return (
          <div className={cn(
            "flex-shrink-0 mx-5 mt-3 mb-1 rounded-lg border px-4 py-3",
            isOverBudget ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"
          )}>
            <p className="text-[11px] font-bold uppercase text-slate-500 mb-2">Estimate vs Actual</p>
            <div className="flex items-center gap-6 flex-wrap">
              <div>
                <p className="text-[10px] text-slate-500">Estimated</p>
                <p className="text-sm font-bold text-slate-700">₹{estimated.toLocaleString("en-IN")}</p>
                <p className="text-[10px] text-slate-400">{estimateData.estimated_days}d stay</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Actual (so far)</p>
                <p className={cn("text-sm font-bold", isOverBudget ? "text-red-600" : "text-slate-700")}>
                  ₹{actual.toLocaleString("en-IN")}
                </p>
              </div>
              {netAdvanceBalance !== null && (
                <div>
                  <p className="text-[10px] text-slate-500">Net Advance Balance</p>
                  <p className="text-sm font-bold text-emerald-700">₹{netAdvanceBalance.toLocaleString("en-IN")}</p>
                </div>
              )}
              {estimated > 0 && (
                <div className="ml-auto">
                  <span className={cn(
                    "text-[11px] font-semibold px-2 py-1 rounded-full",
                    isOverBudget ? "bg-red-100 text-red-700" : overrun > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  )}>
                    {overrun > 0 ? `+${overrun.toFixed(0)}% over estimate` : overrun < 0 ? `${Math.abs(overrun).toFixed(0)}% under estimate` : "On estimate"}
                  </span>
                  {isOverBudget && (
                    <p className="text-[10px] text-red-600 font-medium mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> More than 20% over estimate
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Tabs */}
      <Tabs defaultValue="items" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="bg-card border-b border-border rounded-none h-11 px-5 flex-shrink-0">
          <TabsTrigger value="items" className="text-xs">Line Items</TabsTrigger>
          <TabsTrigger value="payments" className="text-xs">Payments</TabsTrigger>
          <TabsTrigger value="insurance" className="text-xs">Insurance</TabsTrigger>
          {bill.bill_type === "ipd" && bill.admission_id && (
            <TabsTrigger value="advance" className="text-xs flex items-center gap-1">
              Advance
              {(bill as any).advance_applied > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="discount" className="text-xs flex items-center gap-1">
            Discount
            {bill.bill_status === "pending_approval" && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="items" className="flex-1 flex flex-col overflow-hidden mt-0 min-h-0">
          <LineItemsTab
            bill={bill}
            hospitalId={hospitalId}
            lineItems={lineItems}
            loading={loadingItems}
            payments={payments}
            onRefresh={() => { fetchLineItems(); recalcBillTotals(); }}
          />
        </TabsContent>
        <TabsContent value="payments" className="overflow-auto max-h-full mt-0 p-5">
          <PaymentsTab
            bill={bill}
            hospitalId={hospitalId}
            payments={payments}
            netAdvanceBalance={netAdvanceBalance}
            onRefresh={() => { fetchPayments(); onRefresh(); }}
          />
        </TabsContent>
        <TabsContent value="insurance" className="overflow-auto max-h-full mt-0 p-5">
          <InsuranceTab bill={bill} hospitalId={hospitalId} onRefresh={onRefresh} />
        </TabsContent>
        {bill.bill_type === "ipd" && bill.admission_id && (
          <TabsContent value="advance" className="overflow-auto max-h-full mt-0 p-5">
            <AdvanceApplicationTab
              billId={bill.id}
              admissionId={bill.admission_id}
              patientId={bill.patient_id}
              hospitalId={hospitalId}
              totalAmount={Math.max(0, (bill.patient_payable ?? bill.total_amount) - Number(bill.discount_amount || 0))}
              advanceApplied={(bill as any).advance_applied ?? bill.advance_received ?? 0}
              paidAmount={bill.paid_amount}
              paymentStatus={bill.payment_status}
              directCashPaid={payments.reduce((s, p) => s + p.amount, 0)}
              onRefresh={onRefresh}
            />
          </TabsContent>
        )}
        <TabsContent value="discount" className="overflow-auto max-h-full mt-0 p-5">
          {hospitalId && (
            <DiscountTab
              bill={bill}
              hospitalId={hospitalId}
              onRefresh={() => { fetchDiscountApprovals(); onRefresh(); }}
            />
          )}
        </TabsContent>
      </Tabs>

      {showGstInvoice && hospitalInfo && (
        <GSTInvoiceModal
          bill={bill}
          lineItems={lineItems}
          hospitalName={hospitalInfo.name || "Hospital"}
          hospitalGstin={hospitalInfo.gstin || ""}
          hospitalAddress={hospitalInfo.address || ""}
          irn={bill.notes || `DEMO-${bill.bill_number}`}
          onClose={() => setShowGstInvoice(false)}
        />
      )}
      {showPaymentLink && hospitalInfo && hospitalId && (
        <PaymentLinkModal
          bill={bill}
          hospitalId={hospitalId}
          hospitalName={hospitalInfo.name || "Hospital"}
          hospitalPhone=""
          razorpayConfigured={!!hospitalInfo.razorpay_key_id}
          onClose={() => setShowPaymentLink(false)}
        />
      )}
    </div>
    </>
  );
};

export default BillEditor;
