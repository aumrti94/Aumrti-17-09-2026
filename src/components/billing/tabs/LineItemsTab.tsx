import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, X, ChevronDown, ChevronUp, Sparkles, RefreshCw, AlertTriangle, ShieldAlert, RotateCw, Package, CheckCircle2, Ban, Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BillRecord } from "@/pages/billing/BillingPage";
import type { LineItem, PaymentRecord } from "@/components/billing/BillEditor";
import LeakageScanner from "@/components/billing/LeakageScanner";
import UnbilledServicesModal from "@/components/billing/UnbilledServicesModal";
import EnhancementRequestModal from "@/components/billing/EnhancementRequestModal";
import { autoPullAdmissionCharges } from "@/lib/ipdBilling";
import { isAdmissionBill } from "@/lib/admissionBill";
import { formatINR, roundCurrency } from "@/lib/currency";
import { resolveServiceGstPercent } from "@/lib/gstRules";
import { fetchPreAuthCeiling, type PreAuthCeiling } from "@/lib/insuranceCeiling";
import { computeBillMoney } from "@/lib/billMoney";
import { fetchAdvanceLedger } from "@/lib/advanceLedger";
import { checkBillWritable } from "@/lib/lockedDay";
import {
  fetchPackageContext,
  checkServiceAgainstPackage,
  computePackageInclusionValue,
  type PackageContext,
} from "@/lib/packageGuard";
import { logAudit } from "@/lib/auditLog";
// One implementation of the words conversion, shared with the printed bill — the screen and
// the paper must not word the same amount differently.
import { amountInWords as numberToWords } from "@/lib/billPrint";

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

  // Reopen-for-correction gate — a finalized bill is read-only by default;
  // editing it again requires an explicit, audited reason each time (resets
  // whenever a different bill is selected, so it's never a standing unlock).
  const [reopenedForCorrection, setReopenedForCorrection] = useState(false);
  const [showReopenPrompt, setShowReopenPrompt] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    setReopenedForCorrection(false);
    setShowReopenPrompt(false);
    setReopenReason("");
  }, [bill.id]);

  const refreshCeiling = async () => {
    if (!bill.admission_id || !hospitalId) return;
    setRefreshingCeiling(true);
    const updated = await fetchPreAuthCeiling(bill.admission_id, hospitalId);
    setPreAuthCeiling(updated);
    setRefreshingCeiling(false);
  };

  useEffect(() => {
    if (!bill.admission_id || !hospitalId) return;
    if (isAdmissionBill(bill.bill_type)) {
      fetchPreAuthCeiling(bill.admission_id, hospitalId).then(setPreAuthCeiling);
      // Net advance for this ADMISSION, via the shared ledger. This used to
      // query advance_receipts by patient_id, sweeping in advances from the
      // patient's other stays and inventing a refund that was never owed.
      fetchAdvanceLedger(bill.admission_id, hospitalId).then((l) => setNetAdvance(l.netAdvance));
    }
    if (isAdmissionBill(bill.bill_type)) {
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

  const isFinalized = bill.bill_status === "final";
  // A finalized bill (already printed/handed to the patient) is read-only
  // until someone explicitly reopens it with a logged reason. irn_locked
  // (GST e-invoice generated) stays fully non-editable — that requires a
  // real IRP cancel/amend flow, not a quick reopen toggle.
  const isEditable = bill.bill_status === "draft" || (isFinalized && reopenedForCorrection);

  const handleReopenForCorrection = () => {
    if (!reopenReason.trim()) {
      toast({ title: "Enter a reason for reopening this finalized bill", variant: "destructive" });
      return;
    }
    setReopening(true);
    logAudit({
      action: "updated",
      module: "billing",
      entityType: "bill",
      entityId: bill.id,
      details: { action: "reopened_for_correction", reason: reopenReason.trim(), billNumber: bill.bill_number },
    });
    setReopenedForCorrection(true);
    setShowReopenPrompt(false);
    setReopening(false);
    toast({ title: "Bill reopened for correction", description: "This has been logged to the audit trail." });
  };

  const handleServiceSearch = async (q: string) => {
    setServiceSearch(q);
    if (!q || !hospitalId) { setSearchResults([]); return; }
    const { data } = await supabase
      .from("service_master")
      .select("id, name, fee, category, gst_percent, gst_applicable, hsn_code, item_type, source_table")
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
      .select("id, name, fee, category, gst_percent, gst_applicable, hsn_code, item_type, source_table")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("name")
      .limit(20);
    setSearchResults(data || []);
  };

  /**
   * The one pricing rule for a catalog service. Shared by the pre-auth ceiling
   * projection and the actual insert — those must agree, or the ceiling check
   * guards a different amount than the one that lands on the bill.
   *
   * The catalogued item_type is used as-is. It used to be coerced to "other"
   * for anything outside a 14-value allow-list that mirrored a bill_line_items
   * CHECK constraint — but that constraint was dropped (20261008000051) because
   * the billing engine legitimately writes many other types. The coercion
   * outlived it and silently mis-taxed every catalog service outside the list:
   * "other" carries 18% GST in gstRules, so a room charge, OT fee, or dialysis
   * session added from this picker was taxed at 18% while the exact same service
   * billed by its own module (autoChargeService, chargeOTCase) was exempt. It
   * also erased the item_type that the pre-discharge OT-billing check greps for,
   * so a hand-added OT charge never satisfied it.
   *
   * GST comes from resolveServiceGstPercent (src/lib/gstRules.ts), which splits the
   * catalog in two: for hospital-authored rows (source_table IS NULL) the Settings
   * "GST applicable" checkbox is authoritative in both directions, while mirrored
   * module rows keep the statutory rate derived from item_type. This function used to
   * read item_type alone and ignore gst_applicable entirely — combined with the Add
   * Service drawer not writing item_type (so service_master's DEFAULT 'service' = 18%
   * applied), every service created from Settings was billed at 18% GST while the
   * screen displayed "GST: No".
   */
  const priceServiceLine = (svc: any) => {
    const rate = Number(svc.fee) || 0;
    const itemType = svc.item_type || "other";
    const gstPct = resolveServiceGstPercent(svc, rate);
    const gstAmt = roundCurrency(rate * gstPct / 100);
    return { rate, itemType, gstPct, taxable: rate, gstAmt, total: roundCurrency(rate + gstAmt) };
  };

  /**
   * Refuse a line-item mutation the bill can't absorb, BEFORE writing it.
   * Every handler here writes bill_line_items first and only then recomputes
   * bills totals (via onRefresh → BillEditor.recalcBillTotals), so without
   * this the item commits against a bill whose total is then refused —
   * a partial write the user is never told about clearly.
   */
  const ensureBillWritable = async (): Promise<boolean> => {
    if (!hospitalId) return false;
    const lockError = await checkBillWritable(hospitalId, {
      billDate: bill.bill_date ?? null,
      billStatus: bill.bill_status ?? null,
      admissionId: bill.admission_id ?? null,
    });
    if (lockError) {
      toast({ title: "Bill is locked", description: lockError, variant: "destructive" });
      return false;
    }
    return true;
  };

  const insertServiceLine = async (
    svc: any,
    opts: { isInsuranceCovered?: boolean } = {}
  ) => {
    if (!hospitalId) return;
    if (!(await ensureBillWritable())) return;
    const { rate, itemType, gstPct, taxable, gstAmt, total } = priceServiceLine(svc);

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

        // Advisory-only package overage check — never blocks. If this package's
        // promised inclusions are worth more at market rate than the package price
        // itself, that's a structural revenue-leakage risk worth surfacing, even
        // though no individual charge here is ever "missing".
        const { isOverage, inclusionValue, overage } = await computePackageInclusionValue(packageCtx);
        if (isOverage && hospitalId) {
          const { data: existingAlert } = await (supabase as any)
            .from("revenue_alerts")
            .select("id")
            .eq("bill_id", bill.id)
            .eq("alert_type", "package_overage")
            .eq("resolved", false)
            .maybeSingle();
          if (!existingAlert) {
            await (supabase as any).from("revenue_alerts").insert({
              hospital_id: hospitalId,
              bill_id: bill.id,
              patient_id: bill.patient_id,
              alert_type: "package_overage",
              description: `Package "${packageCtx.package.package_name}" inclusions are worth ~${formatINR(inclusionValue)} against a package price of ${formatINR(packageCtx.package.base_price)} — ${formatINR(overage)} over.`,
              estimated_amount: overage,
              severity: "medium",
            });
          }
        }
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
    if (isAdmissionBill(bill.bill_type) && bill.admission_id && preAuthCeiling) {
      const newItemTotal = priceServiceLine(svc).total;

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
    if (!(await ensureBillWritable())) return;
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
    const item = lineItems.find((i) => i.id === itemId);
    if (!(await ensureBillWritable())) return;
    // Hard delete (is_deleted column not in schema yet)
    const { error: delError } = await (supabase as any).from("bill_line_items").delete().eq("id", itemId);
    if (delError) {
      toast({ title: "Failed to remove item", description: delError.message, variant: "destructive" });
      return;
    }
    logAudit({
      action: "deleted",
      module: "billing",
      entityType: "bill_line_item",
      entityId: itemId,
      details: { billId: bill.id, billNumber: bill.bill_number, description: item?.description, amount: item?.total_amount },
    });
    onRefresh();
  };

  const updateItem = async (itemId: string, field: "quantity" | "unit_rate" | "discount_percent" | "gst_percent", value: number) => {
    const item = lineItems.find((i) => i.id === itemId);
    if (!item) return;
    const previous = item[field];
    if (previous === value) return;
    if (!(await ensureBillWritable())) return;
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
    logAudit({
      action: "updated",
      module: "billing",
      entityType: "bill_line_item",
      entityId: itemId,
      details: { field, from: previous, to: value, billId: bill.id, billNumber: bill.bill_number, description: item.description },
    });
    onRefresh();
  };

  const commitFieldEdit = (item: LineItem, field: "quantity" | "unit_rate" | "discount_percent", raw: string) => {
    const value = Number(raw);
    if (Number.isNaN(value) || value < 0) {
      toast({ title: "Enter a valid non-negative number", variant: "destructive" });
      return;
    }
    if (field === "discount_percent" && value > 100) {
      toast({ title: "Discount % cannot exceed 100", variant: "destructive" });
      return;
    }
    updateItem(item.id, field, value);
  };

  // Calculate totals — via the shared contract so this footer, the editor
  // header and the Advance tab cannot disagree about the same bill.
  // For IPD bills the live net advance balance (deposits − refunds) is used;
  // bill.paid_amount is inflated by syncAdvanceToBill auto-syncs and can diverge.
  const totalDirectCashPaid = payments.reduce((s, p) => s + p.amount, 0);
  const advancePaid = isAdmissionBill(bill.bill_type)
    ? (netAdvance ?? 0)
    : Math.min(bill.paid_amount, bill.advance_received || 0);
  const directPaid = isAdmissionBill(bill.bill_type)
    ? totalDirectCashPaid
    : Math.max(0, bill.paid_amount - advancePaid);

  const money = computeBillMoney({
    lineItems,
    discountAmount: bill.discount_amount,
    insuranceAmount: bill.insurance_amount,
    netAdvance: advancePaid,
    directPaid,
  });

  const gstBreakdown: Record<number, number> = {};
  lineItems.forEach((i) => {
    gstBreakdown[i.gst_percent] = (gstBreakdown[i.gst_percent] || 0) + Number(i.gst_amount || 0);
  });

  const subtotal = money.subtotal;
  const totalGst = money.gst;
  const grossTotal = money.netCharges;
  const patientPayable = money.patientPayable;
  const effectivePaid = money.totalCredits;
  const balanceDue = money.balanceDue;

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

      {/* ── Reopen-for-correction gate (finalized bills only; irn_locked bills have no reopen path) ── */}
      {isFinalized && (
        reopenedForCorrection ? (
          <div className="border-b border-border bg-emerald-50 px-4 py-2 flex items-center gap-2 text-emerald-800 flex-shrink-0">
            <Unlock size={13} className="shrink-0" />
            <span className="text-xs font-semibold">Reopened for correction this session — edits are being logged.</span>
          </div>
        ) : (
          <div className="border-b border-border bg-amber-50 px-4 py-2.5 flex-shrink-0">
            <div className="flex items-center gap-2 text-amber-800">
              <Lock size={14} className="shrink-0" />
              <span className="text-xs font-semibold">This bill is finalized and read-only.</span>
              {!showReopenPrompt && (
                <button
                  onClick={() => setShowReopenPrompt(true)}
                  className="ml-auto flex items-center gap-1 text-xs font-medium text-amber-800 underline hover:text-amber-900"
                >
                  <Unlock size={12} /> Reopen for Correction
                </button>
              )}
            </div>
            {showReopenPrompt && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  autoFocus
                  placeholder="Reason for reopening (required, logged to audit trail)"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  className="h-8 text-xs flex-1"
                />
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setShowReopenPrompt(false); setReopenReason(""); }}>
                  Cancel
                </Button>
                <Button size="sm" className="h-8 text-xs" onClick={handleReopenForCorrection} disabled={reopening}>
                  {reopening ? "Reopening…" : "Confirm Reopen"}
                </Button>
              </div>
            )}
          </div>
        )
      )}

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
            {isAdmissionBill(bill.bill_type) && bill.admission_id && isEditable && (
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
                {isEditable ? (
                  <input
                    key={item.id}
                    type="number" min={0} step="1" defaultValue={item.quantity}
                    className="w-12 text-sm text-center border border-border rounded px-1 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    onBlur={(e) => commitFieldEdit(item, "quantity", e.target.value)}
                  />
                ) : (
                  <span className="text-sm text-center">{item.quantity}</span>
                )}
              </div>

              <div className="flex justify-center">
                {isEditable ? (
                  <input
                    key={item.id}
                    type="number" min={0} step="0.01" defaultValue={item.unit_rate}
                    className="w-20 text-sm text-center border border-border rounded px-1 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    onBlur={(e) => commitFieldEdit(item, "unit_rate", e.target.value)}
                  />
                ) : (
                  <span className="text-sm text-center">{formatINR(item.unit_rate)}</span>
                )}
              </div>

              <div className="flex justify-center">
                {isEditable ? (
                  <input
                    key={item.id}
                    type="number" min={0} max={100} step="0.5" defaultValue={item.discount_percent}
                    className="w-12 text-sm text-center border border-border rounded px-1 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    onBlur={(e) => commitFieldEdit(item, "discount_percent", e.target.value)}
                  />
                ) : (
                  <span className="text-sm text-center">{item.discount_percent}%</span>
                )}
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
            {money.settlement === "due" && (
              <div className="flex justify-between text-destructive font-bold border-t border-border pt-1">
                <span>Balance Due</span>
                <span>{formatINR(money.balanceDue)}</span>
              </div>
            )}
            {money.settlement === "refund" && (
              <div className="flex justify-between text-blue-700 font-bold border-t border-border pt-1 bg-blue-50 -mx-1 px-1 rounded">
                <span>⬅ Refund Due to Patient</span>
                <span>{formatINR(money.refundDue)}</span>
              </div>
            )}
            {money.settlement === "settled" && effectivePaid > 0 && (
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
