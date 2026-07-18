import { supabase } from "@/integrations/supabase/client";
import { calcGST } from "@/lib/currency";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { findOrCreateAdmissionBill } from "@/lib/admissionBill";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { getModuleDefaultRate } from "@/lib/serviceRates";
import { recordServiceCharge } from "@/lib/serviceBilling";
import {
  IpdAncillaryMode,
  fetchIpdAncillaryPolicy,
  resolveChargePaymentStatus,
  serviceForSourceModule,
  shouldDebitAdvance,
} from "@/lib/ipdAncillaryGate";

export interface PostChargeOpts {
  hospitalId: string;
  patientId: string;
  admissionId?: string | null;      // set → IPD track
  encounterId?: string | null;
  description: string;
  /**
   * The bill_line_items.item_type. NOTE: this column has a CHECK constraint — use the
   * canonical values ("lab", "radiology", "pharmacy", …), not prose. "lab_test" is NOT
   * valid and will be rejected by the DB.
   */
  itemType: string;
  quantity?: number;
  unitPrice?: number;                // override; else fetched from service_master
  /**
   * GST % to apply to unitPrice. Only consulted when unitPrice is supplied — when it is not,
   * the rate lookup below resolves GST alongside the fee.
   *
   * Passing unitPrice WITHOUT this silently bills 0% GST. That matters most in pre_paid mode,
   * where the cashier collects a number now that must equal the bill line at discharge; any
   * gap becomes a refund.
   */
  gstPercent?: number;
  sourceModule: "lab" | "radiology" | "ot" | "dialysis" | "physio" | "blood_bank" | "nursing" | "pharmacy";
  sourceId: string;                  // FK to originating record
  dedupeKey?: string;                // defaults to `${sourceModule}:${sourceId}`
  orderedBy?: string;
  /**
   * Post onto this exact bill instead of resolving one. Used by 'separate' receipt mode,
   * where the caller mints one receipt bill per order and posts each item onto it — the
   * charge deliberately does NOT go on the admission bill.
   */
  billId?: string;
  /**
   * The hospital's pre/post-paid mode for this service. Supply it when you already hold the
   * policy to skip a settings read; omit it and this resolves it itself. Ignored for modules
   * the policy does not govern (see serviceForSourceModule).
   */
  mode?: IpdAncillaryMode;
  /**
   * Whether an IPD charge may debit the admission's advance ledger. Defaults true, which is
   * the long-standing behaviour for dialysis/physio. lab/radiology/pharmacy pass false — the
   * discharge sweep never debited advances for them, and starting to would silently move
   * ipd_advance_balances for every admitted patient in the system.
   */
  debitAdvance?: boolean;
}

export interface PostChargeResult {
  success: boolean;
  billItemId?: string;
  billId?: string;
  amount?: number;
  paymentStatus?: "pending_payment" | "advance_covered";
  error?: string;
}

/**
 * Point-of-Care Charge Capture: creates a bill line item at ORDER time.
 *
 * OPD → payment_status = pending_payment (must pay at cash counter before service)
 * IPD → depends on the hospital's per-service policy (see lib/ipdAncillaryGate.ts):
 *   - post_paid (the default, and every non-ancillary module) → advance_covered, i.e.
 *     "the admission is carrying this, settle at discharge", and the advance is debited.
 *   - pre_paid (pharmacy/lab/radiology only, opt-in) → pending_payment, which puts the
 *     charge in the cashier's worklist and blocks the service until it is collected.
 */
export async function postCharge(opts: PostChargeOpts): Promise<PostChargeResult> {
  const {
    hospitalId, patientId, admissionId, encounterId,
    description, itemType, quantity = 1, unitPrice,
    sourceModule, sourceId, orderedBy,
  } = opts;

  const dedupeKey = opts.dedupeKey || `${sourceModule}:${sourceId}`;
  const isIPD = !!admissionId;

  // Only pharmacy/lab/radiology are governed. For every other module — dialysis, physio, OT,
  // blood bank, nursing — serviceForSourceModule returns null, which pins mode to post_paid
  // and reproduces this function's original hardcoded ternary exactly. The short-circuit also
  // means their charge path never pays for a settings read.
  const service = isIPD ? serviceForSourceModule(sourceModule) : null;
  const mode: IpdAncillaryMode = !service
    ? "post_paid"
    : opts.mode ?? (await fetchIpdAncillaryPolicy(hospitalId))[service].mode;
  const paymentStatus = resolveChargePaymentStatus({ isIPD, mode });

  try {
    // 1. Idempotency check — skip if already posted
    const { data: existing } = await (supabase as any)
      .from("bill_line_items")
      .select("id, bill_id, total_amount")
      .eq("hospital_id", hospitalId)
      .eq("source_dedupe_key", dedupeKey)
      .maybeSingle();

    if (existing) {
      return { success: true, billItemId: existing.id, billId: existing.bill_id, amount: existing.total_amount, paymentStatus };
    }

    // 2. Resolve unit price
    let resolvedRate = unitPrice;
    // Seed from the caller. This used to be a bare `0`, so any caller supplying unitPrice
    // skipped the lookup below and silently billed 0% GST. Callers that omit both still get
    // their GST resolved from service_master exactly as before.
    let gstPct = opts.gstPercent ?? 0;
    if (!resolvedRate) {
      const { data: svc } = await (supabase as any)
        .from("service_master")
        .select("fee, gst_percent, gst_applicable")
        .eq("hospital_id", hospitalId)
        .eq("item_type", itemType)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      resolvedRate = svc?.fee ? Number(svc.fee) : 0;
      // An explicitly supplied gstPercent wins over the master — the caller resolved the rate
      // this charge was quoted at, and the quote must match the bill.
      if (opts.gstPercent === undefined) {
        gstPct = svc?.gst_applicable ? Number(svc.gst_percent) || 0 : 0;
      }
      // Last resort: the module's configured default rate (service_rates) so
      // specialized modules bill the configured amount instead of ₹0.
      if (!resolvedRate) {
        const r = await getModuleDefaultRate(hospitalId, itemType, 0);
        resolvedRate = r.rate;
        if (!gstPct) gstPct = r.gst;
      }
    }

    const taxable = resolvedRate * quantity;
    const gstAmount = calcGST(taxable, gstPct);
    const totalAmount = taxable + gstAmount;

    // 3. Find or create bill
    let billId: string;

    if (opts.billId) {
      // Caller owns the bill (separate-receipt mode). Nothing to resolve.
      billId = opts.billId;
    } else if (isIPD && admissionId) {
      // Resolve the admission's bill by its own type (ipd or daycare). Hardcoding 'ipd' here
      // meant a day care patient's charge could not see their daycare bill and minted a
      // second, wrongly-typed one.
      try {
        const resolved = await findOrCreateAdmissionBill(hospitalId, patientId, admissionId);
        billId = resolved.id;
      } catch (e: any) {
        return { success: false, error: e?.message || "Admission bill creation failed" };
      }
    } else {
      // OPD: find or create bill for this encounter
      let opdBill: any = null;
      if (encounterId) {
        const { data } = await (supabase as any)
          .from("bills")
          .select("id")
          .eq("hospital_id", hospitalId)
          .eq("patient_id", patientId)
          .eq("encounter_id", encounterId)
          .eq("bill_type", "opd")
          .limit(1)
          .maybeSingle();
        opdBill = data;
      }

      if (opdBill) {
        billId = opdBill.id;
      } else {
        const prefix = sourceModule === "lab" ? "LAB" : sourceModule === "radiology" ? "RAD" : "OPD";
        const billNumber = await generateBillNumber(hospitalId, prefix);
        const { data: newBill, error: be } = await (supabase as any)
          .from("bills")
          .insert({
            hospital_id: hospitalId,
            patient_id: patientId,
            encounter_id: encounterId || null,
            bill_number: billNumber,
            bill_type: "opd",
            bill_date: new Date().toISOString().split("T")[0],
            bill_status: "final",
            payment_status: "unpaid",
            subtotal: 0, gst_amount: 0, total_amount: 0, patient_payable: 0, balance_due: 0,
          })
          .select("id")
          .maybeSingle();
        if (be || !newBill) return { success: false, error: be?.message || "OPD bill creation failed" };
        billId = newBill.id;
      }
    }

    // 4. Insert line item with payment_status
    const { data: li, error: lie } = await (supabase as any)
      .from("bill_line_items")
      .insert({
        hospital_id: hospitalId,
        bill_id: billId,
        description,
        item_type: itemType,
        quantity,
        unit_rate: resolvedRate,
        taxable_amount: taxable,
        gst_percent: gstPct,
        gst_amount: gstAmount,
        total_amount: totalAmount,
        source_module: sourceModule,
        source_record_id: sourceId,
        source_dedupe_key: dedupeKey,
        ordered_by: orderedBy || null,
        service_date: new Date().toISOString().split("T")[0],
        payment_status: paymentStatus,
      })
      .select("id")
      .maybeSingle();

    if (lie || !li) return { success: false, error: lie?.message || "Line item insert failed" };

    // 5. Recalculate bill totals
    await recalculateBillTotalsSafe(billId);

    // Record for LeakageDashboard.tsx — postCharge is a second, parallel
    // billing engine (Dialysis/Physio) that never wrote service_charges.
    recordServiceCharge({
      hospitalId, patientId, admissionId, encounterId,
      serviceModule: sourceModule,
      serviceRefId: sourceId,
      serviceName: description,
      quantity, unitRate: resolvedRate,
      gstPercent: gstPct, gstAmount, totalAmount,
      billId, performedBy: orderedBy,
    });

    // 6. IPD: debit the advance balance.
    //
    // This condition keys off paymentStatus, NOT off isIPD as it once did. In pre_paid mode
    // the cashier physically takes cash for this charge; debiting the advance as well takes
    // the money twice from a patient who already handed it over. The debit must follow "the
    // admission is carrying this" (advance_covered), never the care setting.
    if (isIPD && admissionId && totalAmount > 0 &&
        shouldDebitAdvance({ paymentStatus, debitAdvance: opts.debitAdvance })) {
      await (supabase as any).from("ipd_advances").insert({
        hospital_id: hospitalId,
        admission_id: admissionId,
        patient_id: patientId,
        amount: totalAmount,
        transaction_type: "service_debit",
        description: `Service: ${description}`,
        collected_by: orderedBy || null,
      });
    }

    // No explicit journal posting here: the bill this charge attaches to (bill_status
    // 'final' for OPD, or 'final' at IPD discharge) is posted by the DB trigger
    // trg_auto_post_bill_journal via bill_finalized_opd/bill_finalized_ipd — both have
    // real auto_posting_rules. A prior explicit call here (triggerEvent
    // `charge_posted_${sourceModule}`) had no matching rule for ANY sourceModule this
    // function supports and had never once succeeded — removed as dead weight that
    // only permanently cluttered accounting_posting_failures.

    return { success: true, billItemId: li.id, billId, amount: totalAmount, paymentStatus };
  } catch (err: any) {
    console.error("postCharge error:", err);
    return { success: false, error: err?.message || "Unknown error" };
  }
}

/**
 * Syncs bill_line_items.payment_status to "paid" after a real payment has
 * already been recorded elsewhere (recordBillPayment: bill_payments row + GL
 * + audit log). Does NOT itself record a payment, post to the GL, or write an
 * audit log — call recordBillPayment first, this only updates line-item status.
 */
export async function syncBillItemPaymentStatus(opts: {
  billItemId?: string;
  billId?: string;
  collectedBy: string;
}): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    if (opts.billItemId) {
      await (supabase as any)
        .from("bill_line_items")
        .update({ payment_status: "paid", payment_collected_at: now, payment_collected_by: opts.collectedBy })
        .eq("id", opts.billItemId);
    } else if (opts.billId) {
      await (supabase as any)
        .from("bill_line_items")
        .update({ payment_status: "paid", payment_collected_at: now, payment_collected_by: opts.collectedBy })
        .eq("bill_id", opts.billId)
        .eq("payment_status", "pending_payment");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Lookup service rate from service_master by itemType name match.
 */
export async function lookupServiceRate(hospitalId: string, itemType: string, nameLike?: string): Promise<number> {
  const q = (supabase as any)
    .from("service_master")
    .select("fee")
    .eq("hospital_id", hospitalId)
    .eq("item_type", itemType)
    .eq("is_active", true)
    .limit(1);
  if (nameLike) q.ilike("name", `%${nameLike}%`);
  const { data } = await q.maybeSingle();
  return data?.fee ? Number(data.fee) : 0;
}
