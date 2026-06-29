import React, { useState, useEffect, useCallback } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import CollapsiblePanel from "@/components/layout/CollapsiblePanel";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasTabAccess } from "@/lib/tabPermissions";
import { cn } from "@/lib/utils";
import { autoPullAdmissionCharges as autoPullAdmissionChargesUtil } from "@/lib/ipdBilling";
import { AlertTriangle, Lock, X, Receipt } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import NABHBadge from "@/components/nabh/NABHBadge";

import BillQueue from "@/components/billing/BillQueue";
import BillEditor from "@/components/billing/BillEditor";
import NewBillModal from "@/components/billing/NewBillModal";
import AdvanceReceiptModal from "@/components/billing/AdvanceReceiptModal";
import CollectionsTab from "@/components/billing/tabs/CollectionsTab";
import PendingCollectionsPanel from "@/components/billing/PendingCollectionsPanel";
import DiscountApprovalsInbox from "@/components/billing/DiscountApprovalsInbox";
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
  const [dischargeBillCreated, setDischargeBillCreated] = useState(false);
  const [activeTab, setActiveTab] = useState("bills");
  const [pendingDiscountCount, setPendingDiscountCount] = useState(0);

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

  // Check whether yesterday's cash closure is locked
  useEffect(() => {
    if (!hospitalId) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yd = yesterday.toISOString().split("T")[0];
    (supabase as any)
      .from("daily_cash_closure")
      .select("status")
      .eq("hospital_id", hospitalId)
      .eq("closure_date", yd)
      .maybeSingle()
      .then(({ data }: any) => {
        setPrevDayClosed(data?.status === "locked");
      });
  }, [hospitalId]);

  // Handle discharge billing URL params: /billing?action=new&admission_id=X&type=ipd
  useEffect(() => {
    if (!hospitalId || dischargeBillCreated) return;
    const action = searchParams.get("action");
    const admissionId = searchParams.get("admission_id");
    const billType = searchParams.get("type");
    if (action === "new" && admissionId && billType === "ipd") {
      createDischargeBill(admissionId);
    }
  }, [hospitalId, searchParams, dischargeBillCreated]);

  const createDischargeBill = async (admissionId: string) => {
    if (!hospitalId) return;
    setDischargeBillCreated(true);

    // Check if bill already exists for this admission
    const { data: existing } = await supabase
      .from("bills")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", admissionId)
      .eq("bill_type", "ipd")
      .order("created_at", { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      await autoPullAdmissionCharges(existing[0].id, admissionId);
      // Widen the date filter so bills created on previous days (multi-day stays) are visible.
      // Changing dateFilter triggers fetchBills automatically via useCallback deps.
      setDateFilter("month");
      setSelectedBillId(existing[0].id);
      setSearchParams({});
      return;
    }

    // Get admission + patient info
    const { data: admission } = await supabase
      .from("admissions")
      .select("*, patients(id, full_name, uhid)")
      .eq("id", admissionId)
      .maybeSingle();

    if (!admission) return;

    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase.from("users").select("id")
      .eq("auth_user_id", user?.id || "").maybeSingle();

    const billNumber = await generateBillNumber(hospitalId, "BILL");

    const { data: newBill, error } = await supabase.from("bills").insert({
      hospital_id: hospitalId,
      bill_number: billNumber,
      patient_id: admission.patient_id,
      admission_id: admissionId,
      bill_type: "ipd",
      bill_status: "draft",
      created_by: userData?.id || null,
    }).select("id").maybeSingle();

    if (error || !newBill) {
      toast({ title: "Error creating discharge bill", variant: "destructive" });
      return;
    }

    // Auto-pull charges for this admission
    await autoPullAdmissionCharges(newBill.id, admissionId);

    toast({ title: `IPD Discharge Bill #${billNumber} created with auto-pulled charges` });
    setDateFilter("month");
    setSelectedBillId(newBill.id);
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
      .select("*, patients!inner(full_name, uhid), admission:admissions(is_mlc, payer_type)")
      .eq("hospital_id", hospitalId)
      .gte("bill_date", dateStart)
      .lte("bill_date", dateEnd)
      .gt("total_amount", 0)
      .order("created_at", { ascending: false });

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

    // Find active admissions WITHOUT an IPD bill — surface as virtual "Pending IPD" rows
    let virtualBills: BillRecord[] = [];
    if (statusFilter === "all" || statusFilter === "unpaid") {
      const { data: activeAdms } = await supabase
        .from("admissions")
        .select("id, admitted_at, admission_number, patient_id, is_mlc, payer_type, patients!inner(full_name, uhid)")
        .eq("hospital_id", hospitalId)
        .eq("status", "active");

      const admissionsWithBills = new Set(
        realBills.filter((b) => b.bill_type === "ipd" && b.admission_id).map((b) => b.admission_id)
      );
      // Also check bills that fall outside the date filter
      const { data: existingIpd } = await supabase
        .from("bills")
        .select("admission_id")
        .eq("hospital_id", hospitalId)
        .eq("bill_type", "ipd")
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
  }, [hospitalId, statusFilter, dateFilter, startDate, endDate]);

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

  const selectedBill = bills.find((b) => b.id === selectedBillId) || null;

  const todayCollection = bills
    .filter((b) => b.paid_amount > 0)
    .reduce((s, b) => s + b.paid_amount, 0);
  const pendingAmount = bills.reduce((s, b) => s + b.balance_due, 0);

  // Show time-based day-close reminder after 22:30
  const now = new Date();
  const isAfterClosingTime = now.getHours() > 22 || (now.getHours() === 22 && now.getMinutes() >= 30);
  const yesterdayStr = new Date(now.setDate(now.getDate() - 1)).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short",
  });

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">

      {/* Day-not-closed banner */}
      {prevDayClosed === false && (
        <div className="flex-shrink-0 bg-destructive text-white px-4 py-1.5 flex items-center gap-3 text-[12px] font-semibold">
          <AlertTriangle size={14} className="shrink-0" />
          {isAfterClosingTime
            ? `Day not closed! All transactions from ${yesterdayStr} require end-of-day closure before continuing.`
            : `${yesterdayStr} is not closed. Complete cash reconciliation before end of day.`}
          <button
            className="ml-2 underline hover:no-underline text-white"
            onClick={() => navigate("/billing/closure")}
          >
            Close Day Now →
          </button>
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
          </button>
        ))}
        <div className="flex-1" />
        <NABHBadge standardCodes={["ROM.2", "IMS.1", "IMS.3"]} />
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
      </div>

      {activeTab === "bills" ? (
        <div className="flex-1 overflow-hidden flex">
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
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <PendingCollectionsPanel />
        </div>
      )}

      {/* ── Bill Editor Modal ── */}
      <Dialog open={!!selectedBillId && !!selectedBill} onOpenChange={(open) => { if (!open) setSelectedBillId(null); }}>
        <DialogContent className="max-w-[96vw] w-[1400px] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
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
