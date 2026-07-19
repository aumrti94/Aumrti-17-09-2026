import React, { useState, useEffect, useCallback } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import CollapsiblePanel from "@/components/layout/CollapsiblePanel";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasTabAccess, hasActionAccess } from "@/lib/tabPermissions";
import { cn } from "@/lib/utils";
import { autoPullAdmissionCharges as autoPullAdmissionChargesUtil } from "@/lib/ipdBilling";
import { ADMISSION_BILL_TYPES, findOrCreateAdmissionBill } from "@/lib/admissionBill";
import { AlertTriangle, Lock, X, Receipt } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import NABHBadge from "@/components/nabh/NABHBadge";

import OnboardingTour from "@/components/onboarding/OnboardingTour";
import BillQueue from "@/components/billing/BillQueue";
import BillEditor from "@/components/billing/BillEditor";
import NewBillModal from "@/components/billing/NewBillModal";
import AdvanceReceiptModal from "@/components/billing/AdvanceReceiptModal";
import CollectionsTab from "@/components/billing/tabs/CollectionsTab";
import PendingCollectionsPanel from "@/components/billing/PendingCollectionsPanel";
import DiscountApprovalsInbox from "@/components/billing/DiscountApprovalsInbox";
import RefundApprovalsInbox from "@/components/billing/RefundApprovalsInbox";
import LeakageDashboard from "@/components/billing/RevenueLeak/LeakageDashboard";

export interface BillRecord {
  id: string;
  bill_number: string;
  patient_id: string;
  patient_name: string;
  uhid: string;
  encounter_id: string | null;
  admission_id: string | null;
  bill_type: string;
  bill_date: string;
  bill_status: string;
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  gst_amount: number;
  total_amount: number;
  advance_received: number;
  insurance_amount: number;
  patient_payable: number;
  paid_amount: number;
  balance_due: number;
  payment_status: string;
  notes: string | null;
  irn: string | null;
  irn_generated_at: string | null;
  created_at: string;
  is_mlc?: boolean;
  payer_type?: string | null;
}

const BILLING_TABS = [
  { key: "bills", label: "Bills" },
  { key: "collections", label: "💳 Collections" },
  { key: "pending", label: "🔴 Pending Payments" },
  { key: "leakage", label: "📉 Revenue Leakage" },
  { key: "approvals", label: "🔐 Approvals", hasBadge: true },
  { key: "refund_approvals", label: "💰 Refunds", hasBadge: true },
] as const;

const BillingPage: React.FC = () => {
  const { toast } = useToast();
  const { permissions, role } = useHospitalContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [prevDayClosed, setPrevDayClosed] = useState<boolean | null>(null);
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewBill, setShowNewBill] = useState(false);
  const [showAdvance, setShowAdvance] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("today");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [dischargeBillCreated, setDischargeBillCreated] = useState(false);
  const [activeTab, setActiveTab] = useState("bills");
  const [pendingDiscountCount, setPendingDiscountCount] = useState(0);
  const [pendingRefundCount, setPendingRefundCount] = useState(0);

  // Previous business day — the day that should already be closed.
  // Derive the query key and the banner label from ONE value so they can
  // never drift apart (e.g. across the UTC/local midnight boundary).
  const prevDayISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0]; // matches how closure_date is stored
  })();
  const prevDayLabel = new Date(prevDayISO + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short",
  });

  useEffect(() => {
    const loadHospital = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("users")
        .select("hospital_id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (data?.hospital_id) setHospitalId(data.hospital_id);
    };
    loadHospital();
  }, []);

  // Check whether the previous day's cash closure is locked
  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("daily_cash_closure")
      .select("status")
      .eq("hospital_id", hospitalId)
      .eq("closure_date", prevDayISO)
      .maybeSingle()
      .then(({ data }: any) => {
        setPrevDayClosed(data?.status === "locked");
      });
  }, [hospitalId, prevDayISO]);

  // Handle discharge billing URL params: /billing?action=new&admission_id=X&type=ipd|daycare
  useEffect(() => {
    if (!hospitalId || dischargeBillCreated) return;
    const action = searchParams.get("action");
    const admissionId = searchParams.get("admission_id");
    const billType = searchParams.get("type");
    if (action === "new" && admissionId && ADMISSION_BILL_TYPES.includes(billType as any)) {
      createDischargeBill(admissionId);
    }
  }, [hospitalId, searchParams, dischargeBillCreated]);

  const createDischargeBill = async (admissionId: string) => {
    if (!hospitalId) return;
    setDischargeBillCreated(true);

    const { data: admission } = await supabase
      .from("admissions")
      .select("*, patients(id, full_name, uhid)")
      .eq("id", admissionId)
      .maybeSingle();

    if (!admission) return;

    // Resolve (or create) the admission's bill by its own type. Previously this hardcoded
    // bill_type='ipd' both when looking up and when creating, so opening Billing for a day
    // care admission ignored its existing daycare bill and made a second, IPD-typed one.
    //
    // paymentStatuses: [] — this is an IDENTITY lookup ("open this admission's bill"), not a
    // "find me something to charge" lookup. Without it, a fully-paid bill is invisible here
    // and this function mints a duplicate: exactly what happened to a prepaid day care bill,
    // which is 'paid' from the moment of admission.
    const { id: billId, isNew } = await findOrCreateAdmissionBill(
      hospitalId,
      admission.patient_id,
      admissionId,
      undefined,
      { paymentStatuses: [] },
    );

    await autoPullAdmissionCharges(billId, admissionId);

    if (isNew) toast({ title: "Discharge bill created with auto-pulled charges" });
    // Widen the date filter so bills created on previous days (multi-day stays) are visible.
    // Changing dateFilter triggers fetchBills automatically via useCallback deps.
    setDateFilter("month");
    setSelectedBillId(billId);
    setSearchParams({});
  };

  const autoPullAdmissionCharges = async (billId: string, admissionId: string) => {
    if (!hospitalId) return;
    const result = await autoPullAdmissionChargesUtil(billId, admissionId, hospitalId);
    if (!result.ok) {
      toast({
        title: "Failed to pull some admission charges",
        description: result.error || "Bill totals could not be updated",
        variant: "destructive",
      });
      return;
    }
    if (result.usedFallbackRate) {
      toast({
        title: "Using fallback rates",
        description: "Some service rates are not configured. Set them in Settings → Service Rates.",
      });
    }
  };

  const fetchBills = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    let dateStart: string;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    switch (dateFilter) {
      case "yesterday": {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        dateStart = y.toISOString().slice(0, 10);
        break;
      }
      case "week": {
        const w = new Date(now);
        w.setDate(w.getDate() - 7);
        dateStart = w.toISOString().slice(0, 10);
        break;
      }
      case "month": {
        const m = new Date(now);
        m.setMonth(m.getMonth() - 1);
        dateStart = m.toISOString().slice(0, 10);
        break;
      }
      case "custom":
        dateStart = startDate || todayStr;
        break;
      default:
        dateStart = todayStr;
    }

    const dateEnd = dateFilter === "custom" ? (endDate || dateStart) : todayStr;

    let query = supabase
      .from("bills")
      .select("*, patients!inner(full_name, uhid, phone, abha_id), admission:admissions(is_mlc, payer_type)")
      .eq("hospital_id", hospitalId)
      .gt("total_amount", 0)
      .order("created_at", { ascending: false });

    if (patientSearch.trim()) {
      // Search mode: ignore date filter, match across name / UHID / phone / ABHA ID
      const term = patientSearch.trim();
      query = (query as any).or(
        `full_name.ilike.%${term}%,uhid.ilike.%${term}%,phone.ilike.%${term}%,abha_id.ilike.%${term}%`,
        { foreignTable: "patients" }
      );
    } else {
      query = query.gte("bill_date", dateStart).lte("bill_date", dateEnd);
    }

    if (statusFilter !== "all") {
      query = query.eq("payment_status", statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const realBills: BillRecord[] = (data || []).map((b: any) => ({
      id: b.id,
      bill_number: b.bill_number,
      patient_id: b.patient_id,
      patient_name: b.patients?.full_name || "Unknown",
      uhid: b.patients?.uhid || "",
      encounter_id: b.encounter_id,
      admission_id: b.admission_id,
      bill_type: b.bill_type,
      bill_date: b.bill_date,
      bill_status: b.bill_status,
      subtotal: Number(b.subtotal) || 0,
      discount_percent: Number(b.discount_percent) || 0,
      discount_amount: Number(b.discount_amount) || 0,
      gst_amount: Number(b.gst_amount) || 0,
      total_amount: Number(b.total_amount) || 0,
      advance_received: Number(b.advance_received) || 0,
      insurance_amount: Number(b.insurance_amount) || 0,
      patient_payable: Number(b.patient_payable) || 0,
      paid_amount: Number(b.paid_amount) || 0,
      balance_due: Number(b.balance_due) || 0,
      payment_status: b.payment_status,
      notes: b.notes,
      irn: b.irn || null,
      irn_generated_at: b.irn_generated_at || null,
      created_at: b.created_at,
      is_mlc: (b.admission as any)?.is_mlc || false,
      payer_type: (b.admission as any)?.payer_type || (b as any).payer_type || null,
    }));

    // Find active admissions WITHOUT a bill — surface as virtual "Pending IPD" rows
    let virtualBills: BillRecord[] = [];
    if (statusFilter === "all" || statusFilter === "unpaid") {
      const { data: activeAdms } = await supabase
        .from("admissions")
        .select("id, admitted_at, admission_number, patient_id, is_mlc, payer_type, patients!inner(full_name, uhid)")
        .eq("hospital_id", hospitalId)
        .eq("status", "active");

      // "Has a bill" must consider BOTH admission bill types. Checking only 'ipd' meant a day
      // care patient with a perfectly good daycare bill still showed as "Pending IPD — click
      // to create bill", and clicking it minted a duplicate.
      const admissionsWithBills = new Set(
        realBills
          .filter((b) => ADMISSION_BILL_TYPES.includes(b.bill_type as any) && b.admission_id)
          .map((b) => b.admission_id)
      );
      // Also check bills that fall outside the date filter
      const { data: existingIpd } = await supabase
        .from("bills")
        .select("admission_id")
        .eq("hospital_id", hospitalId)
        .in("bill_type", ADMISSION_BILL_TYPES as unknown as string[])
        .not("admission_id", "is", null);
      (existingIpd || []).forEach((b: any) => admissionsWithBills.add(b.admission_id));

      virtualBills = (activeAdms || [])
        .filter((a: any) => !admissionsWithBills.has(a.id))
        .map((a: any) => ({
          id: `pending:${a.id}`,
          bill_number: `IPD-${a.admission_number || a.id.slice(0, 8)}`,
          patient_id: a.patient_id,
          patient_name: a.patients?.full_name || "Unknown",
          uhid: a.patients?.uhid || "",
          encounter_id: null,
          admission_id: a.id,
          bill_type: "ipd",
          bill_date: (a.admitted_at || new Date().toISOString()).slice(0, 10),
          bill_status: "pending_ipd",
          subtotal: 0,
          discount_percent: 0,
          discount_amount: 0,
          gst_amount: 0,
          total_amount: 0,
          advance_received: 0,
          insurance_amount: 0,
          patient_payable: 0,
          paid_amount: 0,
          balance_due: 0,
          payment_status: "unpaid",
          notes: null,
          irn: null,
          irn_generated_at: null,
          created_at: a.admitted_at || new Date().toISOString(),
          is_mlc: (a as any).is_mlc || false,
          payer_type: (a as any).payer_type || null,
        }));
    }

    setBills([...virtualBills, ...realBills]);
    setLoading(false);
  }, [hospitalId, statusFilter, dateFilter, startDate, endDate, patientSearch]);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("bill_discount_approvals")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hospitalId)
      .eq("status", "pending")
      .then(({ count }: any) => setPendingDiscountCount(count || 0));
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("refund_payables")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hospitalId)
      .eq("status", "pending_approval")
      .then(({ count }: any) => setPendingRefundCount(count || 0));
  }, [hospitalId]);

  const selectedBill = bills.find((b) => b.id === selectedBillId) || null;

  const todayCollection = bills
    .filter((b) => b.paid_amount > 0)
    .reduce((s, b) => s + b.paid_amount, 0);
  const pendingAmount = bills.reduce((s, b) => s + b.balance_due, 0);

  // Show a stronger day-close reminder after 22:30
  const nowHour = new Date().getHours();
  const nowMin = new Date().getMinutes();
  const isAfterClosingTime = nowHour > 22 || (nowHour === 22 && nowMin >= 30);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">

      {/* Day-not-closed banner */}
      {prevDayClosed === false && (
        <div className="flex-shrink-0 bg-destructive text-white px-4 py-1.5 flex items-center gap-3 text-[12px] font-semibold">
          <AlertTriangle size={14} className="shrink-0" />
          {isAfterClosingTime
            ? `Previous day (${prevDayLabel}) is not closed! Complete its end-of-day cash reconciliation before continuing.`
            : `Previous day (${prevDayLabel}) is not closed. Complete its cash reconciliation to keep the books accurate.`}
          {hasActionAccess("billing", "day_closure", permissions, role) && (
            <button
              className="ml-2 underline hover:no-underline text-white"
              onClick={() => navigate("/billing/closure")}
            >
              Close Day Now →
            </button>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div className="h-10 flex-shrink-0 border-b border-border bg-background px-4 flex items-center gap-1">
        {BILLING_TABS.filter((t) => hasTabAccess("billing", t.key, permissions, role)).map((t) => (
          <button
            key={t.key}
            className={cn(
              "px-3 py-1.5 text-xs font-bold rounded-md transition-colors flex items-center gap-1.5",
              t.key === "leakage"
                ? (activeTab === t.key ? "bg-destructive text-destructive-foreground" : "text-red-600 hover:text-red-700")
                : (activeTab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
            )}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
            {t.key === "approvals" && pendingDiscountCount > 0 && (
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center",
                activeTab === "approvals" ? "bg-white text-primary" : "bg-amber-500 text-white"
              )}>
                {pendingDiscountCount}
              </span>
            )}
            {t.key === "refund_approvals" && pendingRefundCount > 0 && (
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center",
                activeTab === "refund_approvals" ? "bg-white text-primary" : "bg-amber-500 text-white"
              )}>
                {pendingRefundCount}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <NABHBadge standardCodes={["ROM.2", "IMS.1", "IMS.3"]} />
        {hasActionAccess("billing", "day_closure", permissions, role) && (
          <button
            className={cn(
              "px-3 py-1.5 text-xs font-bold rounded-md transition-colors flex items-center gap-1",
              prevDayClosed === false
                ? "bg-destructive text-white animate-pulse"
                : "text-muted-foreground hover:text-foreground border border-border"
            )}
            onClick={() => navigate("/billing/closure")}
          >
            <Lock size={11} /> Day Closure
          </button>
        )}
      </div>

      {activeTab === "bills" ? (
        <div className="flex-1 overflow-hidden flex">
          <OnboardingTour tourKey="billing_intro" />
          <BillQueue
            bills={bills}
            loading={loading}
            selectedBillId={selectedBillId}
            onSelectBill={(id) => {
              if (id.startsWith("pending:")) {
                const admissionId = id.slice("pending:".length);
                setDischargeBillCreated(false);
                createDischargeBill(admissionId);
              } else {
                setSelectedBillId(id);
              }
            }}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            dateFilter={dateFilter}
            onDateFilter={setDateFilter}
            startDate={startDate}
            endDate={endDate}
            onStartDate={(d) => { setStartDate(d); setDateFilter("custom"); }}
            onEndDate={(d) => { setEndDate(d); setDateFilter("custom"); }}
            onNewBill={() => setShowNewBill(true)}
            onAdvanceReceipt={() => setShowAdvance(true)}
            todayCollection={todayCollection}
            pendingAmount={pendingAmount}
            billCount={bills.length}
            patientSearch={patientSearch}
            onPatientSearch={setPatientSearch}
          />
          <div className="flex-1 bg-muted/20 flex flex-col items-center justify-center gap-3 text-muted-foreground select-none">
            <Receipt size={48} className="opacity-15" />
            <p className="text-sm font-medium opacity-50">Select a bill to open</p>
          </div>
        </div>
      ) : activeTab === "collections" ? (
        hospitalId && <CollectionsTab hospitalId={hospitalId} />
      ) : activeTab === "leakage" ? (
        <div className="flex-1 overflow-y-auto">
          <LeakageDashboard />
        </div>
      ) : activeTab === "approvals" ? (
        <div className="flex-1 overflow-hidden">
          {hospitalId && (
            <DiscountApprovalsInbox
              hospitalId={hospitalId}
              onBillSelect={(billId) => {
                setActiveTab("bills");
                setSelectedBillId(billId);
                setDateFilter("month");
              }}
            />
          )}
        </div>
      ) : activeTab === "refund_approvals" ? (
        <div className="flex-1 overflow-hidden">
          {hospitalId && (
            <RefundApprovalsInbox
              hospitalId={hospitalId}
              onBillSelect={(billId) => {
                setActiveTab("bills");
                setSelectedBillId(billId);
                setDateFilter("month");
              }}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <PendingCollectionsPanel />
        </div>
      )}

      {/* ── Bill Editor Modal ── */}
      <Dialog open={!!selectedBillId && !!selectedBill} onOpenChange={(open) => { if (!open) setSelectedBillId(null); }}>
        <DialogContent className="max-w-[96vw] w-[1400px] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden [&>button.absolute]:hidden">
          {/* Close button row */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-muted/40">
            <div className="flex items-center gap-2">
              <Receipt size={15} className="text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">
                {selectedBill?.bill_number ?? "Bill"}
              </span>
              {selectedBill && (
                <span className="text-xs text-muted-foreground">
                  · {selectedBill.patient_name} · {selectedBill.bill_type.toUpperCase()}
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedBillId(null)}
              className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          {/* BillEditor fills remaining modal height */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <BillEditor
              bill={selectedBill}
              hospitalId={hospitalId}
              onRefresh={fetchBills}
            />
          </div>
        </DialogContent>
      </Dialog>

      {showNewBill && hospitalId && (
        <NewBillModal
          hospitalId={hospitalId}
          onClose={() => setShowNewBill(false)}
          onCreated={async (id) => {
            setShowNewBill(false);
            const { data: nb } = await (supabase as any)
              .from("bills")
              .select("*, patients!inner(full_name, uhid)")
              .eq("id", id)
              .maybeSingle();
            if (nb) {
              const mapped: BillRecord = {
                id: nb.id,
                bill_number: nb.bill_number,
                patient_id: nb.patient_id,
                patient_name: nb.patients?.full_name || "Unknown",
                uhid: nb.patients?.uhid || "",
                encounter_id: nb.encounter_id ?? null,
                admission_id: nb.admission_id ?? null,
                bill_type: nb.bill_type,
                bill_date: nb.bill_date,
                bill_status: nb.bill_status,
                subtotal: 0, discount_percent: 0, discount_amount: 0, gst_amount: 0,
                total_amount: 0, advance_received: 0, insurance_amount: 0,
                patient_payable: 0, paid_amount: 0, balance_due: 0,
                payment_status: nb.payment_status || "pending",
                notes: null, irn: null, irn_generated_at: null,
                created_at: nb.created_at,
              };
              setBills(prev => [mapped, ...prev]);
            }
            setSelectedBillId(id);
          }}
        />
      )}
      {showAdvance && hospitalId && (
        <AdvanceReceiptModal
          hospitalId={hospitalId}
          onClose={() => setShowAdvance(false)}
          onCreated={() => {
            setShowAdvance(false);
            toast({ title: "Advance receipt created" });
          }}
        />
      )}
    </div>
  );
};

export default BillingPage;
