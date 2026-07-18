/**
 * ancillaryCharges — the single way an admitted patient's pharmacy/lab/radiology order turns
 * into money.
 *
 * WHY THIS EXISTS. There were four independent IPD order paths (the ward round, the lab
 * modal, the radiology modal, the dispensing workspace), each hand-rolling its own bill
 * creation and line items, each subtly different. That divergence WAS the bug surface: one
 * path set payment_status and another didn't, one wrote a dedupe key and another didn't, one
 * created a bill header with a balance and no lines at all. This function is the one place
 * that decides, so they cannot drift again.
 *
 * WHAT IT REPLACES. Those paths used to mint a standalone bill_type 'lab'/'radiology'/
 * 'pharmacy' bill per order, whose lines carried no source_dedupe_key, while the discharge
 * sweep independently pulled the same order onto the IPD bill under a key of its own. Two
 * lines, one service. Charges now go on the admission bill at ORDER time using the EXACT keys
 * the sweep already writes, so the sweep recognises them and skips — same bill, same lines,
 * same totals, just posted earlier.
 *
 * THE DEDUPE KEYS ARE A CONTRACT with lib/ipdBilling.ts's sweep. They must match byte for
 * byte or the patient is charged twice:
 *   lab:{lab_order_items.id}                    — per TEST, not per order
 *   radiology:{radiology_orders.id}
 *   pharmacy:dispense-item:{pharmacy_dispensing_items.id}
 */

import { supabase } from "@/integrations/supabase/client";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { postCharge } from "@/lib/chargePosting";
import { getInvestigationRate } from "@/lib/investigationBilling";
import {
  ChargePaymentStatus,
  IpdAncillaryPolicy,
  IpdAncillaryService,
  fetchIpdAncillaryPolicy,
  resolveChargePaymentStatus,
} from "@/lib/ipdAncillaryGate";

/** bill_line_items.item_type per service. These are CHECK-constrained — do not invent values. */
const ITEM_TYPE: Record<IpdAncillaryService, string> = {
  lab: "lab",
  radiology: "radiology",
  pharmacy: "pharmacy",
};

/** bills.bill_type used for a separate receipt. */
const RECEIPT_BILL_TYPE: Record<IpdAncillaryService, string> = {
  lab: "lab",
  radiology: "radiology",
  pharmacy: "pharmacy",
};

const RECEIPT_PREFIX: Record<IpdAncillaryService, string> = {
  lab: "LAB",
  radiology: "RAD",
  pharmacy: "PHR",
};

export interface AncillaryChargeItem {
  /** The record the dedupe key is built from (a UUID — source_record_id is UUID-typed). */
  sourceId: string;
  /** MUST match the discharge sweep's key for this record. See the file header. */
  dedupeKey: string;
  description: string;
  unitPrice: number;
  gstPercent: number;
  quantity?: number;
}

export interface PostAncillaryResult {
  ok: boolean;
  /** The bill the charges landed on — the admission bill, or a fresh receipt. */
  billId?: string;
  paymentStatus: ChargePaymentStatus;
  /** The dedupe keys written. Hand these to checkAncillaryClearance to gate the service. */
  dedupeKeys: string[];
  /** Set when a charge failed. In pre_paid mode the caller MUST abort the order. */
  error?: string;
}

/**
 * Post every charge for one ancillary order.
 *
 * FAILURE IS NOT SWALLOWED, deliberately. postCharge's two original callers wrap it in
 * `catch { /* non-blocking *\/ }` because a missing dialysis charge shouldn't stop dialysis.
 * That reasoning inverts here: in pre_paid mode a swallowed failure means no charge line,
 * which the gate reads as `no_charge_found` and clears — a free service. Callers must fail
 * the order when this returns !ok.
 */
export async function postAncillaryOrderCharges(opts: {
  hospitalId: string;
  patientId: string;
  admissionId?: string | null;
  encounterId?: string | null;
  service: IpdAncillaryService;
  items: AncillaryChargeItem[];
  orderedBy?: string;
  /** Pass when already held, to skip a settings read. */
  policy?: IpdAncillaryPolicy;
}): Promise<PostAncillaryResult> {
  const { hospitalId, patientId, admissionId, encounterId, service, items, orderedBy } = opts;
  const isIPD = !!admissionId;
  const dedupeKeys = items.map((i) => i.dedupeKey);

  const policy = opts.policy ?? (await fetchIpdAncillaryPolicy(hospitalId));
  const mode = isIPD ? policy[service].mode : "post_paid";
  const paymentStatus = resolveChargePaymentStatus({ isIPD, mode });

  if (items.length === 0) return { ok: true, paymentStatus, dedupeKeys };

  // A separate receipt only makes sense when the patient is actually being asked to pay now.
  // In post_paid mode the charge belongs on the admission bill by definition.
  const wantsSeparateReceipt =
    isIPD && mode === "pre_paid" && policy[service].receipt === "separate";

  let receiptBillId: string | undefined;
  if (wantsSeparateReceipt && admissionId) {
    const receipt = await createReceiptBill({ hospitalId, patientId, admissionId, service });
    if (!receipt) return { ok: false, paymentStatus, dedupeKeys, error: "Could not create the receipt bill" };
    receiptBillId = receipt;
  }

  let billId: string | undefined = receiptBillId;

  for (const item of items) {
    const res = await postCharge({
      hospitalId,
      patientId,
      admissionId: admissionId ?? null,
      encounterId: encounterId ?? null,
      description: item.description,
      itemType: ITEM_TYPE[service],
      quantity: item.quantity ?? 1,
      unitPrice: item.unitPrice,
      gstPercent: item.gstPercent,
      sourceModule: service,
      sourceId: item.sourceId,
      dedupeKey: item.dedupeKey,
      orderedBy,
      mode,
      billId: receiptBillId,
      // The discharge sweep never debited advances for these three. Starting to would move
      // ipd_advance_balances for every admitted patient in the system — a separate decision,
      // not a side effect of this one.
      debitAdvance: false,
    });

    if (!res.success) {
      return { ok: false, billId, paymentStatus, dedupeKeys, error: res.error || "Charge posting failed" };
    }
    billId = billId || res.billId;
  }

  return { ok: true, billId, paymentStatus, dedupeKeys };
}

/**
 * Charge lab orders created by syncLabOrders (the ward round / package paths).
 *
 * Keyed per lab_order_items row, NOT per order: one order commonly holds several tests, and
 * the discharge sweep pulls from lab_order_items with key lab:{item.id}. Keying per order
 * here would leave the sweep's keys unmatched and bill every test a second time.
 */
export async function chargeLabOrders(opts: {
  hospitalId: string;
  patientId: string;
  admissionId?: string | null;
  encounterId?: string | null;
  orderIds: string[];
  orderedBy?: string;
  policy?: IpdAncillaryPolicy;
}): Promise<PostAncillaryResult> {
  const empty: PostAncillaryResult = { ok: true, paymentStatus: "advance_covered", dedupeKeys: [] };
  if (opts.orderIds.length === 0) return empty;

  const { data: rows } = await (supabase as any)
    .from("lab_order_items")
    .select("id, lab_order_id, lab_test_master:test_id(test_name)")
    .in("lab_order_id", opts.orderIds);

  if (!rows || rows.length === 0) return empty;

  const items: AncillaryChargeItem[] = [];
  for (const r of rows as any[]) {
    const testName = r.lab_test_master?.test_name || "Test";
    const { rate, gstPercent } = await getInvestigationRate(opts.hospitalId, testName, "lab");
    items.push({
      sourceId: r.id,
      dedupeKey: `lab:${r.id}`,
      description: `Lab: ${testName}`,
      unitPrice: rate,
      gstPercent,
    });
  }

  return postAncillaryOrderCharges({ ...opts, service: "lab", items });
}

/** Charge radiology orders created by syncRadiologyOrders. Keyed radiology:{order.id}. */
export async function chargeRadiologyOrders(opts: {
  hospitalId: string;
  patientId: string;
  admissionId?: string | null;
  encounterId?: string | null;
  orderIds: string[];
  orderedBy?: string;
  policy?: IpdAncillaryPolicy;
}): Promise<PostAncillaryResult> {
  const empty: PostAncillaryResult = { ok: true, paymentStatus: "advance_covered", dedupeKeys: [] };
  if (opts.orderIds.length === 0) return empty;

  const { data: rows } = await (supabase as any)
    .from("radiology_orders")
    .select("id, study_name")
    .in("id", opts.orderIds);

  if (!rows || rows.length === 0) return empty;

  const items: AncillaryChargeItem[] = [];
  for (const r of rows as any[]) {
    const studyName = r.study_name || "Study";
    const { rate, gstPercent } = await getInvestigationRate(opts.hospitalId, studyName, "radiology");
    items.push({
      sourceId: r.id,
      dedupeKey: `radiology:${r.id}`,
      description: `Radiology: ${studyName}`,
      unitPrice: rate,
      gstPercent,
    });
  }

  return postAncillaryOrderCharges({ ...opts, service: "radiology", items });
}

/**
 * Mint the one-off bill a 'separate' receipt lands on.
 *
 * admission_id is set so the bill is traceable to the stay, but the discharge sweep must NOT
 * re-pull these charges onto the discharge bill — that is what filterSiblingBillsForSweep
 * (which excludes lab/radiology/pharmacy) and the sweep's admission-wide dedupe together
 * guarantee. The patient pays this receipt at the counter; it is not part of the final bill.
 */
async function createReceiptBill(opts: {
  hospitalId: string;
  patientId: string;
  admissionId: string;
  service: IpdAncillaryService;
}): Promise<string | null> {
  const { hospitalId, patientId, admissionId, service } = opts;
  const billNumber = await generateBillNumber(hospitalId, RECEIPT_PREFIX[service]);

  const { data, error } = await (supabase as any)
    .from("bills")
    .insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      admission_id: admissionId,
      bill_number: billNumber,
      bill_type: RECEIPT_BILL_TYPE[service],
      bill_date: new Date().toISOString().split("T")[0],
      // 'final', not 'draft': this is an issued demand the cashier collects against, and a
      // draft would make findAdmissionBill treat it as an open worksheet for other charges.
      bill_status: "final",
      payment_status: "unpaid",
      subtotal: 0,
      gst_amount: 0,
      total_amount: 0,
      patient_payable: 0,
      balance_due: 0,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}
