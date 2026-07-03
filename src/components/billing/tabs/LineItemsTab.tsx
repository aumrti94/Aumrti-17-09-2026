import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, X, ChevronDown, ChevronUp, Sparkles, RefreshCw, AlertTriangle, ShieldAlert, RotateCw, Package, CheckCircle2, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BillRecord } from "@/pages/billing/BillingPage";
import type { LineItem, PaymentRecord } from "@/components/billing/BillEditor";
import LeakageScanner from "@/components/billing/LeakageScanner";
import UnbilledServicesModal from "@/components/billing/UnbilledServicesModal";
import EnhancementRequestModal from "@/components/billing/EnhancementRequestModal";
import { autoPullAdmissionCharges } from "@/lib/ipdBilling";
import { formatINR, roundCurrency } from "@/lib/currency";
import { getDefaultGSTRate } from "@/lib/gstRules";
import { fetchPreAuthCeiling, type PreAuthCeiling } from "@/lib/insuranceCeiling";
import {
  fetchPackageContext,
  checkServiceAgainstPackage,
  type PackageContext,
} from "@/lib/packageGuard";

function numberToWords(n: number): string {
  if (n === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const convert = (num: number): string => {
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
    if (num < 1000) return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + convert(num % 100) : "");
    if (num < 100000) return convert(Math.floor(num / 1000)) + " Thousand" + (num % 1000 ? " " + convert(num % 1000) : "");
    if (num < 10000000) return convert(Math.floor(num / 100000)) + " Lakh" + (num % 100000 ? " " + convert(num % 100000) : "");
    return convert(Math.floor(num / 10000000)) + " Crore" + (num % 10000000 ? " " + convert(num % 10000000) : "");
  };
  return convert(Math.floor(n));
}

interface Props {
  bill: BillRecord;
  hospitalId: string | null;
  lineItems: LineItem[];
  loading: boolean;
  payments?: PaymentRecord[];
  onRefresh: () => void;
}

const ITEM_TYPE_COLORS: Record<string, string> = {
  consultation: "bg-primary/10 text-primary",
  lab: "bg-success/10 text-success",
  radiology: "bg-accent/10 text-accent",
  pharmacy: "bg-secondary/10 text-secondary",
  room_charge: "bg-muted text-muted-foreground",
  procedure: "bg-primary/10 text-primary",
  nursing: "bg-success/10 text-success",
};

const LineItemsTab: React.FC<Props> = ({ bill, hospitalId, lineItems, loading, payments = [], onRefresh }) => {
  const { toast } = useToast();
  const [serviceSearch, setServiceSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showGst, setShowGst] = useState(false);
  const [showUnbilled, setShowUnbilled] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // Pre-auth ceiling enforcement (IPD insurance bills only)
  const [preAuthCeiling, setPreAuthCeiling] = useState<PreAuthCeiling | null>(null);
  const [enhancementBlocked, setEnhancementBlocked] = useState<{
    svc: any;
    total: number;
  } | null>(null);
  const [refreshingCeiling, setRefreshingCeiling] = useState(false);

  // Package inclusion guard
  const [packageCtx, setPackageCtx] = useState<PackageContext | null>(null);

  // Net advance balance for IPD bills — fetched from ipd_advance_balances view
  // so the footer "Refund Due" stays in sync with the Advance tab.
  const [netAdvance, setNetAdvance] = useState<number | null>(null);

  const refreshCeiling = async () => {
    if (!bill.admission_id || !hospitalId) return;
    setRefreshingCeiling(true);
    const updated = await fetchPreAuthCeiling(bill.admission_id, hospitalId);
    setPreAuthCeiling(updated);
    setRefreshingCeiling(false);
  };

  useEffect(() => {
    if (!bill.admission_id || !hospitalId) return;
    if (bill.bill_type === "ipd") {
      fetchPreAuthCeiling(bill.admission_id, hospitalId).then(setPreAuthCeiling);
      // Fetch net advance balance — same formula as AdvanceApplicationTab:
      // viewBalance (ipd_advances net) + unmirroredTotal (legacy advance_receipts)
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
        setNetAdvance(Number(advRes.data?.balance || 0) + unmirroredTotal);
      });
    }
    if (bill.bill_type === "ipd" || bill.bill_type === "daycare") {
      fetchPackageContext(bill.admission_id).then(setPackageCtx);
    }
  }, [bill.admission_id, hospitalId, bill.bill_type, bill.id]);

  const handleRecalcIPD = async () => {
    if (!hospitalId || !bill.admission_id) return;
    setRecalculating(true);
    const result = await autoPullAdmissionCharges(bill.id, bill.admission_id, hospitalId);
    setRecalculating(false);
    if (!result.ok) {
      toast({ title: "Recalculation failed", description: result.error || "Try again", variant: "destructive" });
      return;
    }
    toast({
      title: result.insertedCount > 0
        ? `Pulled ${result.insertedCount} new charges`
        : "Already up to date",
      description: "Room, doctor visits, lab, radiology, pharmacy, nursing.",
    });
    if (result.usedFallbackRate) {
      toast({ title: "Using fallback rates", description: "Configure service rates in Settings → Service Rates." });
    }
    onRefresh();
  };

  const isEditable = bill.bill_status === "draft" || bill.bill_status === "final";

  const handleServiceSearch = async (q: string) => {
    setServiceSearch(q);
    if (!q || !hospitalId) { setSearchResults([]); return; }
    const { data } = await supabase
      .from("service_master")
      .select("id, name, fee, category, gst_percent, hsn_code, item_type")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .ilike("name", `%${q}%`)
      .limit(10);
    setSearchResults(data || []);
  };

  // Load all services when search opens (show initial list)
  const loadInitialServices = async () => {
    if (!hospitalId) return;
    const { data } = await supabase
      .from("service_master")
      .select("id, name, fee, category, gst_percent, hsn_code, item_type")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("name")
      .limit(20);
    setSearchResults(data || []);
  };

  const VALID_ITEM_TYPES = ['consultation','procedure','room_charge','lab','radiology','pharmacy','surgery','package','nursing','consumable','blood','oxygen','other','service'];

  const insertServiceLine = async (
    svc: any,
    opts: { isInsuranceCovered?: boolean } = {}
  ) => {
    if (!hospitalId) return;
    const rate = Number(svc.fee) || 0;
    const itemType = VALID_ITEM_TYPES.includes(svc.item_type) ? svc.item_type : "other";
    const gstPct =
      svc.gst_percent != null && svc.gst_percent > 0
        ? Number(svc.gst_percent)
        : getDefaultGSTRate(itemType, rate);
    const taxable = rate;
    const gstAmt = roundCurrency(taxable * gstPct / 100);
    const total = roundCurrency(taxable + gstAmt);

    const payload: Record<string, any> = {
      hospital_id: hospitalId,
      bill_id: bill.id,
      service_id: svc.id,
      item_type: itemType,
      description: svc.name,
      quantity: 1,
      unit_rate: rate,
      taxable_amount: taxable,
      gst_percent: gstPct,
      gst_amount: gstAmt,
      total_amount: total,
      hsn_code: svc.hsn_code,
    };
    if (opts.isInsuranceCovered === false) {
      payload.is_insurance_covered = false;
    }

    const { error } = await supabase.from("bill_line_items").insert(payload);
    if (error) {
      toast({ title: "Failed to add service", description: error.message, variant: "destructive" });
      return;
    }
    setShowSearch(false);
    setServiceSearch("");
    onRefresh();
    toast({ title: `Added: ${svc.name}` });
  };

  const addServiceItem = async (svc: any) => {
    if (!hospitalId) return;

    // ── Package inclusion guard ──────────────────────────────────────────────
    if (bill.admission_id && packageCtx) {
      const guard = checkServiceAgainstPackage(packageCtx, svc.id, svc.category || svc.item_type || null);
      if (guard.status === "included") {
        toast({
          title: `Blocked — included in package`,
          description: `"${svc.name}" is included in the active package "${packageCtx.package.package_name}". It cannot be billed separately.`,
          variant: "destructive",
        });
        return;
      }
      if (guard.status === "extra") {
        toast({
          title: `Package extra — billed separately`,
          description: `"${svc.name}" is a billable extra under "${packageCtx.package.package_name}".${guard.rate != null ? ` Rate: ${formatINR(guard.rate)}.` : ""}`,
        });
      }
    }

    // ── Pre-auth ceiling enforcement (IPD insurance bills only) ──────────────
    if (bill.bill_type === "ipd" && bill.admission_id && preAuthCeiling) {
      const rate = Number(svc.fee) || 0;
      const itemType = VALID_ITEM_TYPES.includes(svc.item_type) ? svc.item_type : "other";
      const gstPct =
        svc.gst_percent != null && svc.gst_percent > 0
          ? Number(svc.gst_percent)
          : getDefaultGSTRate(itemType, rate);
      const newItemTotal = roundCurrency(rate + rate * gstPct / 100);

      const runningNow = roundCurrency(
        lineItems.reduce((s, i) => s + Number(i.total_amount), 0)
      );
      const projectedTotal = roundCurrency(runningNow + newItemTotal);
      const ceiling = preAuthCeiling.ceiling;

      if (projectedTotal > ceiling) {
        // Hard block — open enhancement modal
        setEnhancementBlocked({ svc, total: newItemTotal });
        setShowSearch(false);
        setServiceSearch("");
        return;
      }

      // Yellow warning when crossing the 80 % threshold
      if (
        projectedTotal >= ceiling * 0.8 &&
        runningNow < ceiling * 0.8
      ) {
        const pct = Math.round((projectedTotal / ceiling) * 100);
        toast({
          title: `Running bill is at ${pct}% of approved pre-auth amount`,
          description: `${formatINR(projectedTotal)} of ${formatINR(ceiling)} approved by ${preAuthCeiling.tpaName || "TPA"}. Consider filing an enhancement request now.`,
        });
      }
    }

    await insertServiceLine(svc);
  };

  const addCustomItem = async (desc: string) => {
    if (!hospitalId || !desc) return;
    const { error } = await supabase.from("bill_line_items").insert({
      hospital_id: hospitalId,
      bill_id: bill.id,
      item_type: "other",
      description: desc,
      quantity: 1,
      unit_rate: 0,
      taxable_amount: 0,
      gst_percent: 0,
      gst_amount: 0,
      total_amount: 0,
    });
    if (error) {
      toast({ title: "Failed to add item", description: error.message, variant: "destructive" });
      return;
    }
    setShowSearch(false);
    setServiceSearch("");
    onRefresh();
  };

  const deleteItem = async (itemId: string) => {
    // Hard delete (is_deleted column not in schema yet)
    await (supabase as any).from("bill_line_items").delete().eq("id", itemId);
    onRefresh();
  };

  const updateItem = async (itemId: string, field: string, value: number) => {
    const item = lineItems.find((i) => i.id === itemId);
    if (!item) return;
    const updated = { ...item, [field]: value };
    const taxable = updated.quantity * updated.unit_rate * (1 - updated.discount_percent / 100);
    const gstAmt = taxable * updated.gst_percent / 100;
    const total = taxable + gstAmt;
    await supabase.from("bill_line_items").update({
      taxable_amount: taxable,
      discount_amount: updated.quantity * updated.unit_rate * updated.discount_percent / 100,
      gst_amount: gstAmt,
      total_amount: total,
      ...(field === "quantity" ? { quantity: value } : {}),
      ...(field === "unit_rate" ? { unit_rate: value } : {}),
      ...(field === "discount_percent" ? { discount_percent: value } : {}),
      ...(field === "gst_percent" ? { gst_percent: value } : {}),
    } as any).eq("id", itemId);
    onRefresh();
  };

  // Calculate totals
  const subtotal = lineItems.reduce((s, i) => s + i.quantity * i.unit_rate * (1 - i.discount_percent / 100), 0);
  const gstBreakdown: Record<number, number> = {};
  lineItems.forEach((i) => {
    const taxable = i.quantity * i.unit_rate * (1 - i.discount_percent / 100);
    const gst = taxable * i.gst_percent / 100;
    gstBreakdown[i.gst_percent] = (gstBreakdown[i.gst_percent] || 0) + gst;
  });
  const totalGst = Object.values(gstBreakdown).reduce((a, b) => a + b, 0);
  const grossTotal = Math.max(0, subtotal + totalGst - Number(bill.discount_amount || 0));
  const patientPayable = grossTotal - bill.insurance_amount;
  // For IPD bills use the live net advance balance (deposits − refunds) from the view.
  // bill.paid_amount is inflated by syncAdvanceToBill auto-syncs and can diverge.
  const totalDirectCashPaid = payments.reduce((s, p) => s + p.amount, 0);
  const advancePaid = (bill.bill_type === "ipd" && netAdvance !== null) ? netAdvance : Math.min(bill.paid_amount, bill.advance_received || 0);
  const directPaid  = (bill.bill_type === "ipd") ? totalDirectCashPaid : Math.max(0, bill.paid_amount - advancePaid);
  const effectivePaid = advancePaid + directPaid;
  const balanceDue  = patientPayable - effectivePaid;

  // Ceiling meter (derived from live lineItems to stay in sync)
  const ceilingRunningTotal = roundCurrency(lineItems.reduce((s, i) => s + Number(i.total_amount), 0));
  const ceilingPct = preAuthCeiling && preAuthCeiling.ceiling > 0
    ? Math.min(100, (ceilingRunningTotal / preAuthCeiling.ceiling) * 100)
    : 0;
  const ceilingBreached = preAuthCeiling != null && ceilingRunningTotal >= preAuthCeiling.ceiling;
  const ceilingWarning = preAuthCeiling != null && !ceilingBreached && ceilingPct >= 80;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Package active banner — always visible when a package is running */}
      {packageCtx && (
        <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0 border-b bg-violet-50 border-violet-200">
          <Package size={15} className="text-violet-600 shrink-0" />
          <span className="text-sm font-semibold text-violet-800">
            PACKAGE ACTIVE — {packageCtx.package.package_name}
          </span>
          {packageCtx.package.specialty && (
            <span className="text-xs text-violet-600">· {packageCtx.package.specialty}</span>
          )}
          <span className="text-xs text-violet-500 ml-2">
            {packageCtx.inclusions.length} included · {packageCtx.extras.length} extras
          </span>
          <span className="ml-auto text-xs text-violet-600 font-medium">
            {formatINR(packageCtx.package.base_price)} package rate
          </span>
        </div>
      )}

      {/* Pre-auth ceiling status bar — shown at 80 %+ for IPD insurance bills */}
      {preAuthCeiling && (ceilingWarning || ceilingBreached) && (
        <div
          className={cn(
            "px-4 py-2 flex items-center gap-2 text-sm flex-shrink-0 border-b",
            ceilingBreached
              ? "bg-destructive/10 border-destructive/20 text-destructive"
              : "bg-amber-50 border-amber-200 text-amber-800"
          )}
        >
          {ceilingBreached ? <ShieldAlert size={15} /> : <AlertTriangle size={15} />}
          <span className="font-semibold">
            {ceilingBreached
              ? `Pre-auth ceiling reached — ${formatINR(ceilingRunningTotal)} of ${formatINR(preAuthCeiling.ceiling)} approved`
              : `Running bill at ${Math.round(ceilingPct)}% of ${formatINR(preAuthCeiling.ceiling)} pre-auth ceiling`}
          </span>
          {!ceilingBreached && (
            <span className="text-xs opacity-75">
              Headroom: {formatINR(roundCurrency(preAuthCeiling.ceiling - ceilingRunningTotal))} — consider filing an enhancement
            </span>
          )}
          {preAuthCeiling.tpaName && (
            <span className="text-xs opacity-60">· {preAuthCeiling.tpaName}</span>
          )}
          <button
            onClick={refreshCeiling}
            disabled={refreshingCeiling}
            title="Refresh ceiling (after insurance executive approves enhancement)"
            className="ml-auto flex items-center gap-1 text-xs opacity-60 hover:opacity-100 transition-opacity"
          >
            <RotateCw size={12} className={refreshingCeiling ? "animate-spin" : ""} />
            {ceilingBreached ? "Refresh ceiling" : ""}
          </button>
        </div>
      )}

      {/* Auto-pull banner */}
      {(bill.encounter_id || bill.admission_id) && lineItems.some((i) => i.source_module) && (
        <div className="bg-primary/5 border-l-[3px] border-l-primary px-4 py-2.5 text-xs text-primary flex-shrink-0">
          🔗 Auto-charges pulled from linked clinical modules · {lineItems.filter((i) => i.source_module).length} items
        </div>
      )}

      {/* ── Scrollable content: toolbar + headers + items + totals ── */}
      <div className="flex-1 overflow-y-auto min-h-0">

      {/* ── Action toolbar ── */}
      {isEditable && (
        <div className="border-b border-border bg-muted/20 px-4 py-2">
          {showSearch ? (
            <div className="space-y-2">
              <Input placeholder="Search service (e.g. Consultation, X-Ray, ECG)..."
                value={serviceSearch} onChange={(e) => handleServiceSearch(e.target.value)}
                autoFocus className="h-9 text-sm" />
              {searchResults.length > 0 && (
                <div className="border border-border rounded-lg bg-card shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map((svc) => {
                    const guard = packageCtx
                      ? checkServiceAgainstPackage(packageCtx, svc.id, svc.category || svc.item_type || null)
                      : { status: "no_package" as const };
                    const isIncluded = guard.status === "included";
                    const isExtra    = guard.status === "extra";
                    return (
                      <button key={svc.id} onClick={() => addServiceItem(svc)}
                        className={cn("w-full text-left px-3 py-2 flex items-center justify-between text-sm border-b border-border last:border-0",
                          isIncluded ? "bg-red-50 hover:bg-red-100 cursor-not-allowed" : "hover:bg-muted/50")}>
                        <span className="flex items-center gap-2">
                          {isIncluded && <Ban size={13} className="text-destructive shrink-0" />}
                          {isExtra && <span className="text-[10px] font-bold bg-orange-100 text-orange-700 rounded px-1.5 py-0.5 shrink-0">EXTRA</span>}
                          {!isIncluded && !isExtra && packageCtx && <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />}
                          <span className={isIncluded ? "text-muted-foreground line-through" : ""}>{svc.name}</span>
                          {isIncluded && <span className="text-[10px] text-destructive">Included in package</span>}
                        </span>
                        <span className="text-muted-foreground shrink-0 ml-2">{formatINR(Number(svc.fee) || 0)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {searchResults.length === 0 && serviceSearch && (
                <Button variant="outline" size="sm" className="text-xs" onClick={() => addCustomItem(serviceSearch)}>
                  + Add "{serviceSearch}" as custom item
                </Button>
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-[11px]" onClick={() => addCustomItem("Custom Charge")}>+ Custom Item</Button>
                <Button variant="ghost" size="sm" className="text-[11px]" onClick={() => { setShowSearch(false); setServiceSearch(""); setSearchResults([]); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" className="gap-1 text-xs h-8" onClick={() => { setShowSearch(true); loadInitialServices(); }}>
                <Plus size={13} /> Add Service
              </Button>
              {bill.admission_id && (
                <>
                  <Button variant="outline" size="sm" className="gap-1 text-xs h-8 border-primary/40 text-primary hover:bg-primary/5" onClick={() => setShowUnbilled(true)}>
                    <Sparkles size={13} /> Scan Unbilled
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 text-xs h-8 border-accent/40 text-accent hover:bg-accent/5" onClick={handleRecalcIPD} disabled={recalculating}>
                    <RefreshCw size={13} className={recalculating ? "animate-spin" : ""} />
                    {recalculating ? "Recalculating…" : "Recalculate IPD"}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Column headers (sticky within scroll container) ── */}
      <div className={cn(
        "sticky top-0 z-10 grid px-3 py-2 bg-muted/60 border-b border-border text-[10px] font-bold uppercase text-muted-foreground",
        isEditable ? "grid-cols-[28px_1fr_76px_92px_60px_52px_90px_30px]" : "grid-cols-[28px_1fr_76px_92px_60px_52px_90px]"
      )}>
        <span>#</span>
        <span>Description</span>
        <span className="text-center">Qty</span>
        <span className="text-center">Rate (₹)</span>
        <span className="text-center">Disc%</span>
        <span className="text-center">GST%</span>
        <span className="text-right">Amount (₹)</span>
        {isEditable && <span />}
      </div>

      {/* ── Items list ── */}
      <div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
          </div>
        ) : lineItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Sparkles size={32} className="mb-3 opacity-25" />
            <p className="text-sm font-medium mb-1">No charges on this bill yet</p>
            {bill.bill_type === "ipd" && bill.admission_id && isEditable && (
              <Button size="sm" className="mt-3 gap-1.5 text-xs" onClick={handleRecalcIPD} disabled={recalculating}>
                <RefreshCw size={13} className={recalculating ? "animate-spin" : ""} />
                {recalculating ? "Recalculating…" : "Pull IPD Charges"}
              </Button>
            )}
          </div>
        ) : lineItems.map((item, idx) => {
          const taxable   = item.quantity * item.unit_rate * (1 - item.discount_percent / 100);
          const gst       = taxable * item.gst_percent / 100;
          const amount    = taxable + gst;
          const typeColor = ITEM_TYPE_COLORS[item.item_type] || "bg-muted text-muted-foreground";
          return (
            <div key={item.id}
              className={cn(
                "grid px-3 py-2.5 border-b border-border/50 hover:bg-muted/20 transition-colors items-center",
                isEditable ? "grid-cols-[28px_1fr_76px_92px_60px_52px_90px_30px]" : "grid-cols-[28px_1fr_76px_92px_60px_52px_90px]"
              )}
            >
              <span className="text-[10px] text-muted-foreground">{idx + 1}</span>

              <div className="min-w-0 pr-2">
                <p className="text-sm text-foreground truncate">{item.description}</p>
                <div className="flex gap-1 mt-0.5">
                  <Badge className={cn("text-[9px] h-4", typeColor)}>{item.item_type}</Badge>
                  {item.source_module && <Badge className="text-[9px] h-4 bg-primary/10 text-primary">↗ Auto</Badge>}
                </div>
              </div>

              <div className="flex justify-center">
                <span className="text-sm text-center">{item.quantity}</span>
              </div>

              <div className="flex justify-center">
                <span className="text-sm text-center">{formatINR(item.unit_rate)}</span>
              </div>

              <div className="flex justify-center">
                <span className="text-sm text-center">{item.discount_percent}%</span>
              </div>

              <span className="text-xs text-center">{item.gst_percent}%</span>
              <span className="text-sm font-bold text-right">{formatINR(amount)}</span>

              {isEditable && (
                <div className="flex justify-center">
                  <button onClick={() => deleteItem(item.id)} className="text-destructive hover:text-destructive/80 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* AI Leakage Scanner */}
      <LeakageScanner bill={bill} hospitalId={hospitalId} lineItems={lineItems} onRefresh={onRefresh} />

      {/* Unbilled services modal — IPD only */}
      {showUnbilled && bill.admission_id && hospitalId && (
        <UnbilledServicesModal
          bill={bill}
          hospitalId={hospitalId}
          onClose={() => setShowUnbilled(false)}
          onAdded={onRefresh}
        />
      )}

      {/* Pre-auth ceiling breach — enhancement request modal */}
      {enhancementBlocked && preAuthCeiling && hospitalId && bill.admission_id && (
        <EnhancementRequestModal
          hospitalId={hospitalId}
          admissionId={bill.admission_id}
          preAuthId={preAuthCeiling.preAuthId}
          preAuthNumber={preAuthCeiling.preAuthNumber}
          tpaName={preAuthCeiling.tpaName}
          currentApproved={preAuthCeiling.ceiling}
          runningTotal={ceilingRunningTotal}
          serviceName={enhancementBlocked.svc.name}
          serviceAmount={enhancementBlocked.total}
          onMarkPatientPayable={async () => {
            const blocked = enhancementBlocked;
            setEnhancementBlocked(null);
            await insertServiceLine(blocked.svc, { isInsuranceCovered: false });
            // Re-fetch ceiling: marking patient-payable may have changed the picture
            await refreshCeiling();
            toast({
              title: `${blocked.svc.name} marked as patient payable`,
              description: "This charge is excluded from the TPA claim.",
            });
          }}
          onClose={() => setEnhancementBlocked(null)}
        />
      )}

      {/* Totals */}
      <div className="bg-card border-t-2 border-border px-5 py-4">
        <div className="flex justify-end">
          <div className="w-72 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatINR(subtotal)}</span>
            </div>

            {bill.discount_amount > 0 && (
              <div className="flex justify-between text-destructive">
                <span>Discount ({bill.discount_percent}%)</span>
                <span>-{formatINR(bill.discount_amount)}</span>
              </div>
            )}

            <button
              onClick={() => setShowGst(!showGst)}
              className="flex justify-between w-full text-muted-foreground hover:text-foreground"
            >
              <span className="flex items-center gap-1">
                GST {showGst ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </span>
              <span>{formatINR(totalGst)}</span>
            </button>
            {showGst && Object.entries(gstBreakdown).filter(([, v]) => v > 0).map(([pct, amt]) => (
              <div key={pct} className="flex justify-between pl-4 text-xs text-muted-foreground">
                <span>GST {pct}%</span>
                <span>{formatINR(amt)}</span>
              </div>
            ))}

            <div className="flex justify-between font-bold text-base pt-1 border-t border-border">
              <span>Gross Total</span>
              <span>{formatINR(grossTotal)}</span>
            </div>

            {bill.insurance_amount > 0 && (
              <div className="flex justify-between text-primary">
                <span>Insurance covers</span>
                <span>-{formatINR(bill.insurance_amount)}</span>
              </div>
            )}

            <div className="flex justify-between font-bold text-xl pt-1 border-t border-border">
              <span>Patient Payable</span>
              <span>{formatINR(Math.max(0, patientPayable))}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Rupees {numberToWords(Math.max(0, Math.round(patientPayable)))} Only
            </p>

            {advancePaid > 0 && (
              <div className="flex justify-between text-emerald-600 text-xs">
                <span>└ Net Advance</span>
                <span>-{formatINR(advancePaid)}</span>
              </div>
            )}
            {directPaid > 0 && (
              <div className="flex justify-between text-emerald-600 text-xs">
                <span>└ Cash / Card / UPI</span>
                <span>-{formatINR(directPaid)}</span>
              </div>
            )}
            {effectivePaid > 0 && (
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Total Paid</span>
                <span>{formatINR(effectivePaid)}</span>
              </div>
            )}
            {balanceDue > 0 && (
              <div className="flex justify-between text-destructive font-bold border-t border-border pt-1">
                <span>Balance Due</span>
                <span>{formatINR(balanceDue)}</span>
              </div>
            )}
            {balanceDue < 0 && (
              <div className="flex justify-between text-blue-700 font-bold border-t border-border pt-1 bg-blue-50 -mx-1 px-1 rounded">
                <span>⬅ Refund Due to Patient</span>
                <span>{formatINR(Math.abs(balanceDue))}</span>
              </div>
            )}
            {balanceDue === 0 && effectivePaid > 0 && (
              <div className="flex justify-between text-emerald-700 font-semibold border-t border-border pt-1">
                <span>✓ Fully Settled</span>
                <span>Nil</span>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>{/* end scroll wrapper */}
    </div>
  );
};

export default LineItemsTab;
