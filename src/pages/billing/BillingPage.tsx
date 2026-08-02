import React, { useState, useEffect, useCallback } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import CollapsiblePanel from "@/components/layout/CollapsiblePanel";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import { hasTabAccess, hasActionAccess } from "@/lib/tabPermissions";
import { cn } from "@/lib/utils";
import { ADMISSION_BILL_TYPES, findOrCreateAdmissionBill } from "@/lib/admissionBill";
import { buildDepositHoldings } from "@/lib/depositHoldings";
import {
  DAY_CARE_PROCEDURES_SELECT, listProcedures, mapProcedureRow, totalProcedureCharge,
} from "@/lib/dayCareProcedures";
import { AlertTriangle, Lock, X, Receipt } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import NABHBadge from "@/components/nabh/NABHBadge";

import OnboardingTour from "@/components/onboarding/OnboardingTour";
import BillQueue from "@/components/billing/BillQueue";
import BillEditor from "@/components/billing/BillEditor";
import NewBillModal from "@/components/billing/NewBillModal";
import AdvanceReceiptModal from "@/components/billing/AdvanceReceiptModal";
import CollectionsTab from "@/components/billing/tabs/CollectionsTab";
import BillingDateFilterBar from "@/components/billing/BillingDateFilterBar";
import { resolveBillingDateRange, type BillingDatePreset } from "@/lib/billingDateRange";
import { computeAccrual, rangeContainsToday } from "@/lib/liveAdmissionAccrual";
import { resolveRoomRateFallback } from "@/lib/ipdBilling";
import { bundlesNursingIntoRoom } from "@/lib/payerTypes";
import { getWardNursingRates } from "@/lib/wardNursingRate";
import PendingCollectionsPanel from "@/components/billing/PendingCollectionsPanel";
import DiscountApprovalsInbox from "@/components/billing/DiscountApprovalsInbox";
import RefundApprovalsInbox from "@/components/billing/RefundApprovalsInbox";
import LeakageDashboard from "@/components/billing/RevenueLeak/LeakageDashboard";
import { totalOutstanding } from "@/lib/billStatus";

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
  /** The patient is still admitted, so this bill is still growing. See lib/liveAdmissionAccrual.ts. */
  is_live_admission?: boolean;
  /** Days of stay so far. */
  live_days?: number;
  /** Room + nursing accrued but not yet posted to the bill. Display only — never billed from here. */
  live_unbilled_amount?: number;
}

/** The shared `bills` row shape every query on this page selects. */
const BILL_SELECT =
  "*, patients!inner(full_name, uhid, phone, abha_id), admission:admissions(is_mlc, payer_type)";

/**
 * One row → BillRecord mapping, shared by the bill-queue fetch and the single-bill
 * fetch that opens the editor straight from an IPD discharge link. Keeping it in one
 * place means the directly-fetched bill is byte-identical to the queued one, so the
 * modal doesn't flicker or change shape when the queue catches up.
 */
const mapBillRow = (b: any): BillRecord => ({
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
});

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
  // The bill fetched directly by id when arriving from an IPD discharge link, so the
  // editor can open on ONE round trip instead of waiting for the whole queue query.
  // Also the only way a brand-new ₹0 draft is reachable at all: fetchBills filters
  // `.gt("total_amount", 0)`, so such a bill never appears in `bills`.
  const [directBill, setDirectBill] = useState<BillRecord | null>(null);
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
  // Resolved once here so every tab filters on exactly the same window.
  const sharedDateRange = React.useMemo(
    () => resolveBillingDateRange(dateFilter as BillingDatePreset, startDate, endDate),
    [dateFilter, startDate, endDate],
  );
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

  const createDischargeBill = useCallback(async (admissionId: string) => {
    if (!hospitalId) return;
    setDischargeBillCreated(true);

    const { data: admission } = await supabase
      .from("admissions")
      .select("*, patients(id, full_name, uhid)")
      .eq("id", admissionId)
      .maybeSingle();

    if (!admission) {
      setDischargeBillCreated(false);
      return;
    }

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

    // NOTE: the admission charge sweep is deliberately NOT awaited here. It is a
    // 60-120 round-trip job, and awaiting it kept the editor dialog shut for 5-10
    // seconds behind a blank screen. BillEditor owns that sweep now and runs it
    // after mount, so the modal paints immediately and line items stream in.
    //
    // Fetch just this one bill so the dialog can open without waiting for the queue
    // query (and so a ₹0 draft, excluded by fetchBills' total_amount filter, opens
    // at all).
    const { data: billRow } = await supabase
      .from("bills")
      .select(BILL_SELECT)
      .eq("id", billId)
      .maybeSingle();
    if (billRow) setDirectBill(mapBillRow(billRow));

    if (isNew) toast({ title: "Discharge bill created" });
    // Widen the date filter so bills created on previous days (multi-day stays) are visible.
    // Changing dateFilter triggers fetchBills automatically via useCallback deps. This is
    // now only about the queue behind the modal — it no longer gates the modal itself.
    setDateFilter("month");
    setSelectedBillId(billId);
    setSearchParams({});
  }, [hospitalId, setSearchParams, toast]);

  useEffect(() => {
    if (!hospitalId || dischargeBillCreated) return;
    const action = searchParams.get("action");
    const admissionId = searchParams.get("admission_id");
    const billType = searchParams.get("type");
    if (action === "new" && admissionId && ADMISSION_BILL_TYPES.includes(billType as any)) {
      createDischargeBill(admissionId);
    }
  }, [createDischargeBill, dischargeBillCreated, hospitalId, searchParams]);

  const fetchBills = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    // Same resolver every other tab uses, so all tabs describe the same window.
    // (It also fixes a UTC/IST off-by-one: the old inline `toISOString().slice(0,10)`
    // resolved "today" to yesterday for anyone working before 05:30 IST.)
    const { start: dateStart, end: dateEnd } = sharedDateRange;

    let query = supabase
      .from("bills")
      .select(BILL_SELECT)
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

    const realBills: BillRecord[] = (data || []).map(mapBillRow);

    // "Has a bill" must consider BOTH admission bill types. Checking only 'ipd' meant a day
    // care patient with a perfectly good daycare bill still showed as "Pending IPD — click
    // to create bill", and clicking it minted a duplicate.
    //
    // Hoisted out of the Pending-IPD block because the deposit-holding rows below need the
    // same set: a booking must vanish from BOTH lists the moment a bill exists for it.
    const admissionsWithBills = new Set<string>(
      realBills
        .filter((b) => ADMISSION_BILL_TYPES.includes(b.bill_type as any) && b.admission_id)
        .map((b) => b.admission_id as string)
    );
    // Also check bills that fall outside the date filter
    const { data: existingIpd } = await supabase
      .from("bills")
      .select("admission_id")
      .eq("hospital_id", hospitalId)
      .in("bill_type", ADMISSION_BILL_TYPES as unknown as string[])
      .not("admission_id", "is", null);
    (existingIpd || []).forEach((b: any) => admissionsWithBills.add(b.admission_id));

    // Active admissions, fetched once and used twice below: for the virtual "Pending IPD"
    // rows (admissions with no bill yet) and for the live accrual on admissions that do
    // have one. Hoisted out of the statusFilter branch it used to sit in so the live-bill
    // pass can rely on it whatever status is selected.
    const { data: activeAdms } = await supabase
      .from("admissions")
      .select("id, admitted_at, admission_number, patient_id, ward_id, is_mlc, payer_type, patients!inner(full_name, uhid), wards(rate_per_day), beds!admissions_bed_id_fkey(bed_category)")
      .eq("hospital_id", hospitalId)
      .eq("status", "active");

    // Find active admissions WITHOUT a bill — surface as virtual "Pending IPD" rows
    let virtualBills: BillRecord[] = [];
    if (statusFilter === "all" || statusFilter === "unpaid") {
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

    // Deposits collected against a booking that has no bill yet. Real cash, and until now
    // invisible on this screen — see lib/depositHoldings.ts. Not shown when filtering to a
    // bill payment_status, because a holding has no bill and therefore no such status.
    let depositRows: BillRecord[] = [];
    if (statusFilter === "all" && !patientSearch.trim()) {
      const { data: bookings } = await (supabase as any)
        .from("admissions")
        .select(`
          id, admission_number, patient_id, scheduled_at, insurance_type,
          patients!inner(full_name, uhid),
          estimates:admission_estimates(estimated_amount, created_at),
          ${DAY_CARE_PROCEDURES_SELECT}
        `)
        .eq("hospital_id", hospitalId)
        .eq("admission_type", "daycare")
        .eq("status", "scheduled");

      const bookingIds = (bookings || []).map((b: any) => b.id);
      if (bookingIds.length > 0) {
        const [balRes, advRes] = await Promise.all([
          (supabase as any)
            .from("ipd_advance_balances")
            .select("admission_id, balance")
            .in("admission_id", bookingIds),
          (supabase as any)
            .from("ipd_advances")
            .select("admission_id, transaction_type, payment_mode, created_at")
            .in("admission_id", bookingIds),
        ]);

        const holdings = buildDepositHoldings({
          bookings: (bookings || []).map((b: any) => {
            const items = (b.day_care_items || []).map(mapProcedureRow);
            // Latest estimate wins — counselling can be redone before the patient reports.
            const estimate = [...(b.estimates || [])]
              .sort((x: any, y: any) => String(y.created_at).localeCompare(String(x.created_at)))[0];
            return {
              admissionId:    b.id,
              admissionNumber: b.admission_number,
              patientId:      b.patient_id,
              patientName:    b.patients?.full_name || "Unknown",
              uhid:           b.patients?.uhid || "",
              procedureLabel: listProcedures(items),
              estimate:       Number(estimate?.estimated_amount) || totalProcedureCharge(items),
              scheduledDate:  (b.scheduled_at || "").slice(0, 10),
            };
          }),
          balances: new Map<string, number>(
            (balRes.data || []).map((r: any) => [r.admission_id, Number(r.balance) || 0])
          ),
          advances: advRes.data || [],
          admissionsWithBills,
          from: dateStart,
          to: dateEnd,
        });

        depositRows = holdings.map((h) => ({
          id: `deposit:${h.admissionId}`,
          bill_number: h.admissionNumber,
          patient_id: h.patientId,
          patient_name: h.patientName,
          uhid: h.uhid,
          encounter_id: null,
          admission_id: h.admissionId,
          bill_type: "daycare",
          bill_date: h.collectedOn,
          bill_status: "deposit_held",
          subtotal: 0,
          discount_percent: 0,
          discount_amount: 0,
          gst_amount: 0,
          // The estimate, not a billed total — this is what the deposit is measured against.
          total_amount: h.estimate,
          advance_received: h.collected,
          insurance_amount: 0,
          patient_payable: 0,
          paid_amount: h.collected,
          // Drives the queue's "pending" figure: an under-deposited booking is money still
          // to collect, and it should read that way here as it does on the Day Care board.
          balance_due: h.outstanding,
          payment_status: h.outstanding > 0 ? "partial" : "paid",
          notes: h.procedureLabel,
          irn: null,
          irn_generated_at: null,
          created_at: h.collectedOn,
          is_mlc: false,
          payer_type: null,
        }));
      }
    }

    // ── Bills of patients who are still admitted ──────────────────────────────────────
    //
    // These are filtered out of `realBills` by bill_date the day after admission, which is
    // wrong twice over: the charge is still growing (room and nursing are per-day), and an
    // admitted patient with NO bill yet stays visible in every period as a virtual row. So
    // the same patient vanished from "Today" for no reason but the existence of a draft.
    //
    // Pulled in for any window that contains today, and left out of historical windows —
    // "Yesterday" must not report a figure that changes tomorrow. Search mode already
    // ignores dates entirely, so it needs none of this.
    let liveBills: BillRecord[] = [];
    let datedBills = realBills;
    const activeAdmById = new Map<string, any>((activeAdms || []).map((a: any) => [a.id, a]));

    if (!patientSearch.trim() && rangeContainsToday(sharedDateRange) && activeAdmById.size > 0) {
      const alreadyListed = new Set(realBills.map((b) => b.id));
      let liveQuery = supabase
        .from("bills")
        .select(BILL_SELECT)
        .eq("hospital_id", hospitalId)
        .gt("total_amount", 0)
        .in("admission_id", [...activeAdmById.keys()]);
      // The status filter still applies — asking for "Paid" must not force unpaid live
      // bills back into the list.
      if (statusFilter !== "all") liveQuery = liveQuery.eq("payment_status", statusFilter);

      const { data: liveRaw } = await liveQuery;
      liveBills = (liveRaw || []).map(mapBillRow).filter((b) => !alreadyListed.has(b.id));

      // Everything belonging to a patient who is still admitted gets the accrual, whether
      // the date filter had already caught it or the pass above pulled it back in. Marking
      // only the latter would leave a bill dated today looking settled while the bill next
      // to it, for a patient admitted a week earlier, showed as accruing.
      const accruing = [...datedBills.filter((b) => activeAdmById.has(b.admission_id as string)), ...liveBills];

      if (accruing.length > 0) {
        // Two extra round trips for the whole list, not per patient: the room lines already
        // billed (so we only project days that have NOT been charged), and the per-ward
        // nursing rates.
        const [roomLinesRes, nursingRates] = await Promise.all([
          (supabase as any)
            .from("bill_line_items")
            .select("bill_id, quantity, unit_rate")
            .in("bill_id", accruing.map((b) => b.id))
            .eq("item_type", "room_charge"),
          getWardNursingRates(),
        ]);
        const roomLineByBill = new Map<string, any>(
          (roomLinesRes?.data || []).map((r: any) => [r.bill_id, r])
        );

        const annotate = (b: BillRecord): BillRecord => {
          const adm = activeAdmById.get(b.admission_id as string);
          if (!adm) return b;
          const roomLine = roomLineByBill.get(b.id);
          // Prefer the rate the room line was actually billed at, so the projection agrees
          // with what the sweep will post; fall back to the same resolver the IPD ledger
          // estimate uses when nothing has been billed yet.
          const roomRate = Number(roomLine?.unit_rate) > 0
            ? Number(roomLine.unit_rate)
            : resolveRoomRateFallback(adm.wards?.rate_per_day, adm.beds?.bed_category);
          // Nursing is bundled into room rent for scheme/TPA payers — the same rule the
          // sweep applies, so the projection never promises a line that won't be billed.
          const nursingRate = bundlesNursingIntoRoom(adm.payer_type)
            ? 0
            : (nursingRates?.[adm.ward_id] || 0);

          const accrual = computeAccrual({
            admittedAt: adm.admitted_at,
            billedDays: Number(roomLine?.quantity) || 0,
            roomRate,
            nursingRate,
          });

          return {
            ...b,
            is_live_admission: true,
            live_days: accrual.accruedDays,
            live_unbilled_amount: accrual.unbilledAmount,
          };
        };

        datedBills = datedBills.map(annotate);
        liveBills = liveBills.map(annotate);
      }
    }

    setBills([...virtualBills, ...liveBills, ...depositRows, ...datedBills]);
    setLoading(false);
  }, [hospitalId, statusFilter, sharedDateRange, patientSearch]);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  // Live updates: refetch the bills queue on any change to bills, payments, discounts,
  // or IPD advances/deposits — plus tab-focus/reconnect fallback inside the hook.
  useRealtimeRefetch({
    tables: ["bills", "bill_payments", "bill_discount_approvals", "advance_receipts", "ipd_advances", "admissions"],
    hospitalId,
    onChange: fetchBills,
    channelName: "billing-bills",
  });

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

  // The queue copy wins once it arrives (it is the one fetchBills keeps fresh); the
  // directly-fetched copy carries the modal until then.
  const selectedBill =
    bills.find((b) => b.id === selectedBillId) ||
    (directBill?.id === selectedBillId ? directBill : null);

  const todayCollection = bills
    .filter((b) => b.paid_amount > 0)
    .reduce((s, b) => s + b.paid_amount, 0);
  // Refunded bills carry balance_due = total_amount (the refund flow zeroes paid_amount), so
  // summing the column raw counted money that had been handed BACK as still collectable.
  const pendingAmount = totalOutstanding(bills);

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

      {/* One period for every tab. Bills keeps its own copy of these controls inside
          BillQueue (it also has a patient-search mode that bypasses dates), so the bar is
          shown for the tabs that previously had no date filter at all. */}
      {activeTab !== "bills" && (
        <BillingDateFilterBar
          preset={dateFilter as BillingDatePreset}
          startDate={startDate}
          endDate={endDate}
          onPresetChange={(p) => setDateFilter(p)}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          inactiveNote={
            activeTab === "approvals" || activeTab === "refund_approvals"
              ? "Pending items always show, whatever the period — only decided history is filtered"
              : undefined
          }
        />
      )}

      {activeTab === "bills" ? (
        <div className="flex-1 overflow-hidden flex">
          <OnboardingTour tourKey="billing_intro" />
          <BillQueue
            bills={bills}
            loading={loading}
            selectedBillId={selectedBillId}
            onSelectBill={(id) => {
              if (id.startsWith("deposit:")) {
                // There is nothing to open: the procedure has not been delivered, so no bill
                // exists yet. Minting one here would bill a patient who may still no-show.
                toast({
                  title: "Deposit held — not yet billed",
                  description: "The bill is created when the patient is admitted from the Day Care board.",
                });
              } else if (id.startsWith("pending:")) {
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
        hospitalId && <CollectionsTab hospitalId={hospitalId} dateRange={sharedDateRange} />
      ) : activeTab === "leakage" ? (
        <div className="flex-1 overflow-y-auto">
          <LeakageDashboard dateRange={sharedDateRange} />
        </div>
      ) : activeTab === "approvals" ? (
        <div className="flex-1 overflow-hidden">
          {hospitalId && (
            <DiscountApprovalsInbox
              hospitalId={hospitalId}
              dateRange={sharedDateRange}
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
              dateRange={sharedDateRange}
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
          <PendingCollectionsPanel dateRange={sharedDateRange} />
        </div>
      )}

      {/* ── Bill Editor Modal ── */}
      <Dialog open={!!selectedBillId && !!selectedBill} onOpenChange={(open) => { if (!open) { setSelectedBillId(null); setDirectBill(null); } }}>
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
              onClick={() => { setSelectedBillId(null); setDirectBill(null); }}
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
