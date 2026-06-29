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
import { getModuleDefaultRate } from "@/lib/serviceRates";

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
    // OPD encounter: find/create encounter bill
    const billType = serviceModule === MODULE_ED ? "ed"
      : serviceModule === MODULE_OPD_CONSULT ? "opd"
      : "opd";
    billId    = await findOrCreateOpdBill(hospitalId, patientId, encounterId, billType);
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
