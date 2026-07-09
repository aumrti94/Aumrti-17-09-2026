/**
 * serviceBilling.ts — Unified auto-billing for all clinical modules
 *
 * Every module that delivers a service should call autoChargeService().
 * The function is:
 *   - IDEMPOTENT: guarded by a billing_status check on the source record
 *   - IPD-aware: appends to the active IPD discharge bill when admission_id present
 *   - OPD-aware: finds or creates an OPD encounter bill
 *   - Self-pay-aware: creates a standalone bill for walk-in services
 *   - GST-aware: looks up service_master for GST % before billing
 *
 * Calling convention:
 *   const result = await autoChargeService({
 *     hospitalId,
 *     patientId,
 *     admissionId,           // IPD patient — omit for OPD/standalone
 *     encounterId,           // OPD encounter — omit for IPD/standalone
 *     serviceName,           // e.g. "Dialysis Session", "Physiotherapy - 30 min"
 *     serviceModule,         // one of the MODULE_ constants below
 *     sourceTable,           // DB table holding the service record (for billing_status update)
 *     sourceId,              // PK of the source record
 *     quantity,
 *     unitRate,              // 0 = look up from service_master
 *     performedBy,           // user.id of provider
 *   });
 */

import { supabase } from "@/integrations/supabase/client";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { roundCurrency, calcGST } from "@/lib/currency";
import { getModuleDefaultRate, getRate, SERVICE_RATE_CODES } from "@/lib/serviceRates";

// ── Module constants (match service_charges.service_module CHECK constraint) ──
export const MODULE_DIALYSIS      = "dialysis";
export const MODULE_PHYSIO        = "physiotherapy";
export const MODULE_HOME_CARE     = "home_care";
export const MODULE_MENTAL_HEALTH = "mental_health";
export const MODULE_AYUSH         = "ayush";
export const MODULE_MORTUARY      = "mortuary";
export const MODULE_DIETETICS     = "dietetics";
export const MODULE_AMBULANCE     = "ambulance";
export const MODULE_CSSD          = "cssd";
export const MODULE_OPD_CONSULT   = "opd_consult";
export const MODULE_ED            = "ed";
export const MODULE_ONCOLOGY      = "oncology";
export const MODULE_BLOOD_BANK    = "blood_bank";
export const MODULE_VACCINATION   = "vaccination";
export const MODULE_DENTAL        = "dental";
export const MODULE_IVF           = "ivf";
export const MODULE_OTHER         = "other";
export const MODULE_OT            = "ot";

export interface ServiceBillingResult {
  billId:   string;
  lineItemId?: string;
  total:    number;
  isNewBill: boolean;
}

export interface AutoChargeServiceOpts {
  hospitalId:    string;
  patientId:     string;
  admissionId?:  string | null;   // IPD: append to discharge bill
  encounterId?:  string | null;   // OPD: find/create encounter bill
  serviceName:   string;
  serviceModule: string;
  sourceTable?:  string;          // table to update billing_status on (optional)
  sourceId?:     string;          // PK to mark as billed (optional)
  quantity?:     number;
  unitRate?:     number;          // 0 = auto-lookup from service_master
  gstPercent?:   number;          // override; default = from service_master
  performedBy?:  string | null;
  serviceDate?:  string;          // YYYY-MM-DD; default = today
  notes?:        string;
}

/**
 * Look up the rate for a service from service_master.
 * Falls back to 0 if not configured (caller must handle 0 rate gracefully).
 */
async function lookupServiceRate(
  hospitalId: string,
  serviceName: string,
  moduleKey: string,
): Promise<{ fee: number; gstPercent: number }> {
  const { data } = await (supabase as any)
    .from("service_master")
    .select("fee, gst_percent, gst_applicable")
    .eq("hospital_id", hospitalId)
    .eq("is_active", true)
    .or(`item_type.eq.${moduleKey},item_type.ilike.%${moduleKey}%`)
    .ilike("name", `%${serviceName.split(" ")[0]}%`)
    .limit(1)
    .maybeSingle();

  return {
    fee:        Number(data?.fee) || 0,
    gstPercent: data?.gst_applicable ? Number(data.gst_percent) || 0 : 0,
  };
}

/**
 * Find the active IPD bill for an admission (the bill that auto-pull feeds into).
 */
async function findIpdBill(
  hospitalId: string, admissionId: string,
): Promise<string | null> {
  const { data } = await (supabase as any)
    .from("bills")
    .select("id")
    .eq("hospital_id", hospitalId)
    .eq("admission_id", admissionId)
    .eq("bill_type", "ipd")
    .in("payment_status", ["unpaid", "partial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Find or create an OPD consultation bill for an encounter.
 */
async function findOrCreateOpdBill(
  hospitalId: string, patientId: string,
  encounterId: string, billType = "opd",
): Promise<string> {
  const { data: existing } = await (supabase as any)
    .from("bills")
    .select("id")
    .eq("hospital_id", hospitalId)
    .eq("patient_id", patientId)
    .eq("encounter_id", encounterId)
    .eq("bill_type", billType)
    .in("payment_status", ["unpaid", "partial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const billNumber = await generateBillNumber(hospitalId, billType.toUpperCase().slice(0, 3));
  const { data: newBill } = await (supabase as any)
    .from("bills")
    .insert({
      hospital_id:     hospitalId,
      patient_id:      patientId,
      encounter_id:    encounterId,
      bill_number:     billNumber,
      bill_type:       billType,
      bill_date:       new Date().toISOString().split("T")[0],
      bill_status:     "final",
      payment_status:  "unpaid",
      subtotal:        0,
      gst_amount:      0,
      total_amount:    0,
      patient_payable: 0,
      balance_due:     0,
    })
    .select("id")
    .maybeSingle();

  return newBill!.id;
}

/**
 * Find or create the 'emergency' bill for an ED visit.
 * ED bills are keyed by bills.ed_visit_id (bills.encounter_id FKs opd_encounters and
 * cannot hold an ed_visit id). Consolidates every ED charge for the visit onto one bill.
 */
async function findOrCreateEdBill(
  hospitalId: string, patientId: string, edVisitId: string,
): Promise<string> {
  const { data: existing } = await (supabase as any)
    .from("bills")
    .select("id")
    .eq("hospital_id", hospitalId)
    .eq("ed_visit_id", edVisitId)
    .eq("bill_type", "emergency")
    .in("payment_status", ["unpaid", "partial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const billNumber = await generateBillNumber(hospitalId, "ER");
  const { data: newBill } = await (supabase as any)
    .from("bills")
    .insert({
      hospital_id:     hospitalId,
      patient_id:      patientId,
      ed_visit_id:     edVisitId,
      bill_number:     billNumber,
      bill_type:       "emergency",
      bill_date:       new Date().toISOString().split("T")[0],
      bill_status:     "final",
      payment_status:  "unpaid",
      subtotal:        0,
      gst_amount:      0,
      total_amount:    0,
      patient_payable: 0,
      balance_due:     0,
    })
    .select("id")
    .maybeSingle();

  return newBill!.id;
}

/**
 * Main entry point — call from any module when a service is delivered.
 */
export async function autoChargeService(
  opts: AutoChargeServiceOpts,
): Promise<ServiceBillingResult | null> {

  const {
    hospitalId, patientId, admissionId, encounterId,
    serviceName, serviceModule, sourceTable, sourceId,
    quantity = 1, performedBy, notes,
    serviceDate = new Date().toISOString().split("T")[0],
  } = opts;

  // ── Idempotency guard ──────────────────────────────────────────────────────
  if (sourceTable && sourceId) {
    const { data: existing } = await (supabase as any)
      .from(sourceTable)
      .select("billing_status")
      .eq("id", sourceId)
      .maybeSingle();

    if (existing?.billing_status === "billed") {
      return null; // Already billed — do nothing
    }
  }

  // ── Rate lookup ────────────────────────────────────────────────────────────
  let unitRate   = opts.unitRate ?? 0;
  let gstPercent = opts.gstPercent ?? 0;

  if (unitRate === 0) {
    const looked = await lookupServiceRate(hospitalId, serviceName, serviceModule);
    unitRate   = looked.fee;
    gstPercent = looked.gstPercent;
  }

  if (unitRate === 0) {
    // Last resort: the module's configured default rate (service_rates) so
    // specialized modules bill the configured amount instead of ₹0.
    const r = await getModuleDefaultRate(hospitalId, serviceModule, 0);
    if (r.rate > 0) {
      unitRate = r.rate;
      if (!gstPercent) gstPercent = r.gst;
    }
  }

  if (unitRate === 0) {
    // No rate configured — record in service_charges as unbilled (not a bill error)
    await (supabase as any).from("service_charges").insert({
      hospital_id:    hospitalId,
      patient_id:     patientId,
      admission_id:   admissionId ?? null,
      encounter_id:   encounterId ?? null,
      service_module: serviceModule,
      service_ref_id: sourceId ?? null,
      service_date:   serviceDate,
      service_name:   serviceName,
      quantity,
      unit_rate:      0,
      gst_percent:    0,
      gst_amount:     0,
      total_amount:   0,
      therapist_id:   performedBy ?? null,
      notes:          notes ?? "Rate not configured in service master — manual billing required",
      billing_status: "unbilled",
      created_by:     performedBy ?? null,
    }).catch(() => {});
    return null;
  }

  // ── Calculate amounts ──────────────────────────────────────────────────────
  const taxable  = roundCurrency(unitRate * quantity);
  const gstAmt   = calcGST(taxable, gstPercent);
  const total    = roundCurrency(taxable + gstAmt);

  // ── Find/create the bill to attach to ─────────────────────────────────────
  let billId:   string;
  let isNewBill = false;

  if (admissionId) {
    // IPD: append to active IPD bill
    const ipdBillId = await findIpdBill(hospitalId, admissionId);
    if (ipdBillId) {
      billId = ipdBillId;
    } else {
      // No IPD bill yet — create one (edge case: service before bill creation)
      const bn = await generateBillNumber(hospitalId, "IPD");
      const { data: nb } = await (supabase as any)
        .from("bills")
        .insert({
          hospital_id:    hospitalId, patient_id: patientId,
          admission_id:   admissionId,
          bill_number:    bn, bill_type: "ipd", bill_date: serviceDate,
          bill_status:    "draft", payment_status: "unpaid",
          subtotal: 0, gst_amount: 0, total_amount: 0,
          patient_payable: 0, balance_due: 0,
        })
        .select("id").maybeSingle();
      billId    = nb!.id;
      isNewBill = true;
    }
  } else if (encounterId) {
    if (serviceModule === MODULE_ED) {
      // ED: encounterId carries the ed_visit id. Consolidate onto one 'emergency' bill
      // keyed by bills.ed_visit_id (NOT encounter_id, which FKs opd_encounters).
      billId = await findOrCreateEdBill(hospitalId, patientId, encounterId);
    } else {
      // OPD encounter: find/create encounter bill
      billId = await findOrCreateOpdBill(hospitalId, patientId, encounterId, "opd");
    }
  } else {
    // Standalone (ambulance, mortuary, etc.) — create a new bill
    const bn = await generateBillNumber(hospitalId, serviceModule.toUpperCase().slice(0, 3));
    const { data: nb } = await (supabase as any)
      .from("bills")
      .insert({
        hospital_id:    hospitalId, patient_id: patientId,
        bill_number:    bn,
        bill_type:      serviceModule.toLowerCase().replace("_", ""),
        bill_date:      serviceDate,
        bill_status:    "final", payment_status: "unpaid",
        subtotal:       taxable,
        gst_amount:     gstAmt,
        total_amount:   total,
        patient_payable: total,
        balance_due:    total,
      })
      .select("id").maybeSingle();
    billId    = nb!.id;
    isNewBill = true;
  }

  // ── Insert bill_line_item ──────────────────────────────────────────────────
  const { data: lineItem } = await (supabase as any)
    .from("bill_line_items")
    .insert({
      hospital_id:      hospitalId,
      bill_id:          billId,
      description:      serviceName,
      item_type:        serviceModule,
      quantity,
      unit_rate:        unitRate,
      taxable_amount:   taxable,
      gst_percent:      gstPercent,
      gst_amount:       gstAmt,
      total_amount:     total,
      service_date:     serviceDate,
      source_module:    serviceModule,
      source_record_id: sourceId ?? null,
      source_dedupe_key: sourceId ? `${serviceModule}:${sourceId}` : null,
      ordered_by:       performedBy ?? null,
    })
    .select("id")
    .maybeSingle();

  // ── Recalculate bill totals ────────────────────────────────────────────────
  await recalculateBillTotalsSafe(billId);

  // ── Record in service_charges for leakage dashboard ───────────────────────
  await (supabase as any).from("service_charges").insert({
    hospital_id:    hospitalId,
    patient_id:     patientId,
    admission_id:   admissionId ?? null,
    encounter_id:   encounterId ?? null,
    service_module: serviceModule,
    service_ref_id: sourceId ?? null,
    service_date:   serviceDate,
    service_name:   serviceName,
    quantity,
    unit_rate:      unitRate,
    gst_percent:    gstPercent,
    gst_amount:     gstAmt,
    total_amount:   total,
    therapist_id:   performedBy ?? null,
    notes:          notes ?? null,
    billing_status: "billed",
    bill_id:        billId,
    billed_at:      new Date().toISOString(),
    created_by:     performedBy ?? null,
  }).then(() => {}); // non-blocking

  // ── Mark source record as billed ──────────────────────────────────────────
  if (sourceTable && sourceId) {
    await (supabase as any)
      .from(sourceTable)
      .update({ billing_status: "billed", bill_id: billId, billed_at: new Date().toISOString() })
      .eq("id", sourceId);
  }

  // ── Post GL journal entry (non-blocking) ──────────────────────────────────
  if (isNewBill) {
    autoPostJournalEntry({
      hospitalId,
      triggerEvent: "bill_submitted",
      sourceModule: serviceModule,
      sourceId:     billId,
      amount:       total,
      description:  `${serviceName} — ${serviceModule}`,
    }).catch(() => {});
  }

  return { billId, lineItemId: lineItem?.id, total, isNewBill };
}

export interface RecordServiceChargeOpts {
  hospitalId: string;
  patientId: string;
  admissionId?: string | null;
  encounterId?: string | null;
  serviceModule: string;
  serviceRefId?: string | null;
  serviceDate?: string;
  serviceName: string;
  quantity?: number;
  unitRate: number;
  gstPercent?: number;
  gstAmount?: number;
  totalAmount: number;
  billId: string;
  performedBy?: string | null;
  notes?: string | null;
}

/**
 * Additive-only: records an already-billed charge (a bill_line_item a module
 * created by hand, not through autoChargeService above) into service_charges
 * too, so LeakageDashboard.tsx's revenue figures — and any other reporting
 * that reads this table — can see it. Mirrors the exact fields/convention
 * autoChargeService itself writes (billing_status:"billed", bill_id set).
 * Never throws — a reporting-visibility write must not be able to break the
 * actual billing action it's attached to.
 */
export async function recordServiceCharge(opts: RecordServiceChargeOpts): Promise<void> {
  await (supabase as any).from("service_charges").insert({
    hospital_id:    opts.hospitalId,
    patient_id:     opts.patientId,
    admission_id:   opts.admissionId ?? null,
    encounter_id:   opts.encounterId ?? null,
    service_module: opts.serviceModule,
    service_ref_id: opts.serviceRefId ?? null,
    service_date:   opts.serviceDate || new Date().toISOString().split("T")[0],
    service_name:   opts.serviceName,
    quantity:       opts.quantity ?? 1,
    unit_rate:      opts.unitRate,
    gst_percent:    opts.gstPercent ?? 0,
    gst_amount:     opts.gstAmount ?? 0,
    total_amount:   opts.totalAmount,
    billing_status: "billed",
    bill_id:        opts.billId,
    billed_at:      new Date().toISOString(),
    created_by:     opts.performedBy ?? null,
    notes:          opts.notes ?? null,
  }).catch(() => {});
}

/**
 * Read the configured Casualty / Emergency consultation fee from service_master
 * (item_type = 'ed_consultation', set in Settings → Services & Fees → Emergency).
 * Returns { fee: 0 } when not configured so callers can skip billing gracefully.
 */
export async function getEdChargeRate(
  hospitalId: string,
): Promise<{ fee: number; gstPct: number }> {
  if (!hospitalId) return { fee: 0, gstPct: 0 };
  const { data } = await (supabase as any)
    .from("service_master")
    .select("fee, gst_percent, gst_applicable")
    .eq("hospital_id", hospitalId)
    .eq("item_type", "ed_consultation")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!data) return { fee: 0, gstPct: 0 };
  return {
    fee: Number(data.fee) || 0,
    gstPct: data.gst_applicable ? Number(data.gst_percent) || 0 : 0,
  };
}

/**
 * Read a configured ED charge rate by service_master item_type
 * (e.g. 'ed_observation', 'ed_specialist_consult'), set in Settings →
 * Services & Fees → Emergency. Used by the itemized ED charges panel for its
 * quick-charge shortcuts. Returns { fee: 0 } when not configured.
 */
export async function getEdItemRate(
  hospitalId: string,
  itemType: string,
): Promise<{ fee: number; gstPct: number }> {
  if (!hospitalId || !itemType) return { fee: 0, gstPct: 0 };
  const { data } = await (supabase as any)
    .from("service_master")
    .select("fee, gst_percent, gst_applicable")
    .eq("hospital_id", hospitalId)
    .eq("item_type", itemType)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!data) return { fee: 0, gstPct: 0 };
  return {
    fee: Number(data.fee) || 0,
    gstPct: data.gst_applicable ? Number(data.gst_percent) || 0 : 0,
  };
}

/**
 * Record a service that cannot be billed yet (no rate, no patient link)
 * but needs to appear in the leakage dashboard.
 */
export async function recordUnbilledService(opts: {
  hospitalId:    string;
  patientId?:    string;
  admissionId?:  string;
  serviceModule: string;
  serviceRefId?: string;
  serviceName:   string;
  serviceDate?:  string;
  notes?:        string;
}): Promise<void> {
  await (supabase as any).from("service_charges").insert({
    hospital_id:    opts.hospitalId,
    patient_id:     opts.patientId ?? null,
    admission_id:   opts.admissionId ?? null,
    service_module: opts.serviceModule,
    service_ref_id: opts.serviceRefId ?? null,
    service_date:   opts.serviceDate ?? new Date().toISOString().split("T")[0],
    service_name:   opts.serviceName,
    quantity:       1,
    unit_rate:      0,
    gst_percent:    0,
    gst_amount:     0,
    total_amount:   0,
    billing_status: "unbilled",
    notes:          opts.notes ?? null,
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────
// OT billing (Phase 7 consolidation) — was triplicated across EndCaseModal.tsx,
// OTBillingTab.tsx and ipdBilling.ts, each with its own rate lookup + line-item
// construction. `buildOTChargeLineItems` is the shared, pure computation; the
// three call sites differ only in how they resolve/create the *target bill*
// (IPD append vs. daycare bill vs. discharge sweep's own batched insert), so
// that part stays with each caller.
// ─────────────────────────────────────────────────────────────────────────

interface OTScheduleForBilling {
  id: string;
  surgery_name: string;
  anaesthesia_type?: string | null;
  surgeon_id?: string | null;
  anaesthetist_id?: string | null;
  actual_start_time?: string | null;
  actual_end_time?: string | null;
  estimated_duration_minutes?: number | null;
  patient_id?: string | null;
  admission_id?: string | null;
}

/**
 * Record billed OT charges into service_charges — the table every other module's
 * autoChargeService() call already writes to, and the one the Revenue Leakage
 * Dashboard reads from. OT's own billing path (chargeOTCase/buildOTChargeLineItems)
 * bypasses autoChargeService entirely (see file header), so without this OT charges
 * were invisible to that reporting even though they were being billed correctly.
 */
export async function recordOTServiceCharges(opts: {
  hospitalId: string;
  patientId?: string | null;
  admissionId?: string | null;
  scheduleId: string;
  billId: string;
  items: any[]; // bill_line_items-shaped rows that were actually posted
}): Promise<void> {
  const { hospitalId, patientId, admissionId, scheduleId, billId, items } = opts;
  if (!patientId || items.length === 0) return;
  const { data: { user } } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const rows = items.map((item) => ({
    hospital_id: hospitalId,
    patient_id: patientId,
    admission_id: admissionId ?? null,
    service_module: MODULE_OT,
    service_ref_id: scheduleId,
    service_date: now.split("T")[0],
    service_name: item.description,
    quantity: item.quantity,
    unit_rate: item.unit_rate,
    gst_percent: item.gst_percent,
    gst_amount: item.gst_amount,
    total_amount: item.total_amount,
    therapist_id: user?.id || null,
    billing_status: "billed",
    bill_id: billId,
    billed_at: now,
    created_by: user?.id || null,
  }));
  await (supabase as any).from("service_charges").insert(rows).catch(() => {});
}

/** service_master rate lookup, optionally scoped to a specific doctor_id. */
async function getServiceMasterRate(
  hospitalId: string,
  itemType: string,
  fallback: number,
  doctorId: string | null = null,
): Promise<{ fee: number; gstPct: number; gst: number; hsn: string }> {
  let query = (supabase as any)
    .from("service_master")
    .select("fee, gst_percent, gst_applicable, hsn_code")
    .eq("hospital_id", hospitalId)
    .eq("item_type", itemType)
    .eq("is_active", true);
  query = doctorId ? query.eq("doctor_id", doctorId) : query.is("doctor_id", null);
  const { data } = await query.limit(1).maybeSingle();
  if (!data) return { fee: fallback, gstPct: 0, gst: 0, hsn: "" };
  const fee = Number(data.fee) || fallback;
  const gstPct = data.gst_applicable ? (Number(data.gst_percent) || 0) : 0;
  return { fee, gstPct, gst: calcGST(fee, gstPct), hsn: data.hsn_code || "" };
}

/**
 * Resolve a surgeon/anaesthetist fee: per-doctor rate first (service_master row
 * scoped by doctor_id — same mechanism SettingsStaffPage already uses for
 * per-doctor consultation fees, see idx_service_master_doctor_unique), then the
 * hospital-wide service_master default, then service_rates, then a hardcoded floor.
 */
async function resolveOtStaffFee(
  hospitalId: string,
  itemType: "surgeon_fee" | "anaesthesia_fee",
  doctorId: string | null | undefined,
  fallbackRateCode: string,
  hardcoded: number,
): Promise<{ fee: number; gstPct: number; gst: number; hsn: string }> {
  if (doctorId) {
    const doctorRate = await getServiceMasterRate(hospitalId, itemType, 0, doctorId);
    if (doctorRate.fee > 0) return doctorRate;
  }
  const fallback = await getRate(hospitalId, fallbackRateCode, hardcoded);
  return getServiceMasterRate(hospitalId, itemType, fallback, null);
}

/**
 * Pure computation: given an OT case, returns the bill_line_items rows it should
 * have (OT facility charge, surgeon fee, anaesthetist fee, unbilled implants) —
 * no insert, no dedupe filtering, no side effects. Callers decide how to dedupe
 * and insert against their target bill.
 */
export async function buildOTChargeLineItems(
  hospitalId: string,
  billId: string,
  ot: OTScheduleForBilling,
): Promise<{ items: any[]; implantIds: string[] }> {
  const items: any[] = [];

  const otRate = await getServiceMasterRate(hospitalId, "ot_charge", 2000, null);
  const actualDuration =
    ot.actual_start_time && ot.actual_end_time
      ? Math.ceil((new Date(ot.actual_end_time).getTime() - new Date(ot.actual_start_time).getTime()) / 3600000)
      : Math.ceil((ot.estimated_duration_minutes || 60) / 60);
  const hours = Math.max(1, actualDuration);
  const otFee = roundCurrency(hours * otRate.fee);
  items.push({
    hospital_id: hospitalId, bill_id: billId,
    item_type: "ot_charge",
    description: `OT Charges: ${ot.surgery_name} (${hours} hr)`,
    quantity: hours, unit_rate: otRate.fee,
    taxable_amount: otFee, gst_percent: otRate.gstPct,
    gst_amount: calcGST(otFee, otRate.gstPct),
    total_amount: roundCurrency(otFee + calcGST(otFee, otRate.gstPct)),
    hsn_code: otRate.hsn || "999315", source_module: MODULE_OT,
    source_record_id: ot.id,
    source_dedupe_key: `ot:${ot.id}:ot_charge`,
  });

  if (ot.surgeon_id) {
    const surgRate = await resolveOtStaffFee(hospitalId, "surgeon_fee", ot.surgeon_id, SERVICE_RATE_CODES.SURGERY_FEE, 5000);
    items.push({
      hospital_id: hospitalId, bill_id: billId,
      item_type: "surgeon_fee",
      description: `Surgeon Fee: ${ot.surgery_name}`,
      quantity: 1, unit_rate: surgRate.fee,
      taxable_amount: surgRate.fee, gst_percent: surgRate.gstPct,
      gst_amount: surgRate.gst, total_amount: roundCurrency(surgRate.fee + surgRate.gst),
      hsn_code: surgRate.hsn || "999316", source_module: MODULE_OT,
      source_record_id: ot.id,
      source_dedupe_key: `ot:${ot.id}:surgeon_fee`,
    });
  }

  if (ot.anaesthetist_id) {
    const anaesRate = await resolveOtStaffFee(hospitalId, "anaesthesia_fee", ot.anaesthetist_id, SERVICE_RATE_CODES.ANAESTHESIA_FEE, 1500);
    items.push({
      hospital_id: hospitalId, bill_id: billId,
      item_type: "anaesthesia_fee",
      description: `Anaesthesia: ${ot.anaesthesia_type || "General"}`,
      quantity: 1, unit_rate: anaesRate.fee,
      taxable_amount: anaesRate.fee, gst_percent: anaesRate.gstPct,
      gst_amount: anaesRate.gst, total_amount: roundCurrency(anaesRate.fee + anaesRate.gst),
      hsn_code: anaesRate.hsn || "999317", source_module: MODULE_OT,
      source_record_id: ot.id,
      source_dedupe_key: `ot:${ot.id}:anaesthesia_fee`,
    });
  }

  const { data: unbilledImplants } = await (supabase as any)
    .from("ot_implants")
    .select("id, item_name, unit_cost, quantity")
    .eq("schedule_id", ot.id)
    .eq("billed", false);

  const implantIds: string[] = [];
  (unbilledImplants || []).forEach((imp: any) => {
    const cost = Number(imp.unit_cost || 0);
    if (cost <= 0) return;
    const qty = Number(imp.quantity || 1);
    const total = roundCurrency(cost * qty);
    items.push({
      hospital_id: hospitalId, bill_id: billId,
      item_type: "implant",
      description: `Implant: ${imp.item_name}`,
      quantity: qty, unit_rate: cost,
      taxable_amount: total, gst_percent: 12,
      gst_amount: calcGST(total, 12),
      total_amount: roundCurrency(total + calcGST(total, 12)),
      hsn_code: "9021", source_module: MODULE_OT,
      source_record_id: ot.id,
      source_dedupe_key: `ot:${ot.id}:implant:${imp.id}`,
    });
    implantIds.push(imp.id);
  });

  return { items, implantIds };
}

export interface ChargeOTCaseResult {
  billId: string;
  total: number;
  itemsAdded: number;
}

/**
 * Orchestrates a full OT charge run against an already-resolved bill: dedupe
 * against existing bill_line_items for this case, insert what's missing,
 * recalc totals, mark the schedule/implants billed, post the GL entry.
 * Used by EndCaseModal.tsx (auto-fire on case end) and OTBillingTab.tsx
 * (manual "Push"/"Re-sync"); ipdBilling.ts's discharge sweep uses
 * `buildOTChargeLineItems` directly instead, to stay inside its own
 * single-batch-insert transaction shape.
 */
export async function chargeOTCase(opts: {
  hospitalId: string;
  billId: string;
  schedule: OTScheduleForBilling;
}): Promise<ChargeOTCaseResult> {
  const { hospitalId, billId, schedule } = opts;

  const { data: existingItems } = await (supabase as any)
    .from("bill_line_items")
    .select("source_dedupe_key")
    .eq("bill_id", billId)
    .eq("source_module", MODULE_OT);
  const existingKeys = new Set<string>((existingItems || []).map((i: any) => i.source_dedupe_key).filter(Boolean));

  const { items: candidateItems, implantIds } = await buildOTChargeLineItems(hospitalId, billId, schedule);
  const newItems = candidateItems.filter((li) => !li.source_dedupe_key || !existingKeys.has(li.source_dedupe_key));

  if (newItems.length === 0) {
    return { billId, total: 0, itemsAdded: 0 };
  }

  await supabase.from("bill_line_items").insert(newItems);
  await recalculateBillTotalsSafe(billId);

  const { data: updatedBill } = await supabase.from("bills").select("total_amount").eq("id", billId).maybeSingle();
  const total = Number(updatedBill?.total_amount || 0);

  await (supabase as any)
    .from("ot_schedules")
    .update({ billed: true, bill_id: billId })
    .eq("id", schedule.id);

  await recordOTServiceCharges({
    hospitalId, patientId: schedule.patient_id, admissionId: schedule.admission_id,
    scheduleId: schedule.id, billId, items: newItems,
  });

  const billedImplantIds = implantIds.filter((id) =>
    newItems.some((li) => li.source_dedupe_key === `ot:${schedule.id}:implant:${id}`)
  );
  if (billedImplantIds.length > 0) {
    await (supabase as any).from("ot_implants").update({ billed: true }).in("id", billedImplantIds);
  }

  const { data: { user } } = await supabase.auth.getUser();
  await autoPostJournalEntry({
    triggerEvent: "bill_finalized_ot",
    sourceModule: MODULE_OT,
    sourceId: billId,
    amount: total,
    description: `OT Revenue - ${schedule.surgery_name}`,
    hospitalId,
    postedBy: user?.id || "",
  });

  return { billId, total, itemsAdded: newItems.length };
}
