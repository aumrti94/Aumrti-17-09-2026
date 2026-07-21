/**
 * admissionBill — single source of truth for "which bill belongs to this admission".
 *
 * The rule used to be spelled `.eq("bill_type", "ipd")`, duplicated in two places:
 * serviceBilling.findIpdBill (the bill resolver behind autoChargeService, which is the
 * canonical charge path for 18 modules) and advanceBillSync.syncAdvanceToBill.
 *
 * That silently excluded day care, whose bills are bill_type='daycare':
 *   - every module charging a day care patient would fail to find the daycare bill and
 *     create a SECOND, bill_type='ipd' bill for the same admission; and
 *   - every advance deposit would fail to mirror into bill_payments, so a paid deposit
 *     never showed against the bill.
 *
 * An admission has exactly one admission_type, so it can hold at most one of these bill
 * types — widening the lookup from `.eq("ipd")` to `.in(["ipd","daycare"])` is a strict
 * no-op for every existing IPD admission.
 *
 * Day care is deliberately NOT collapsed into bill_type='ipd': the bills CHECK already
 * allows 'daycare' (20260520000002), filterSiblingBillsForSweep already treats it as its
 * own type, and collapsing would make day care revenue permanently unsegmentable in every
 * report that groups by bill_type.
 */

import { supabase } from "@/integrations/supabase/client";

export const ADMISSION_BILL_TYPES = ["ipd", "daycare"] as const;
export type AdmissionBillType = (typeof ADMISSION_BILL_TYPES)[number];

/** Payment statuses that mean a bill is still awaiting money. */
const DEFAULT_OPEN_PAYMENT_STATUSES = ["unpaid", "partial"];

/**
 * PURE. Maps admissions.admission_type → the bill_type its charges belong on.
 *
 * Defaults to "ipd" for null/unknown types. That default is load-bearing: admission_type
 * has no CHECK constraint, and misrouting an unrecognised inpatient type to 'daycare'
 * would strand its charges on a bill the IPD flows don't look at.
 */
export function admissionBillType(
  admissionType: string | null | undefined
): AdmissionBillType {
  return (admissionType || "").toLowerCase() === "daycare" ? "daycare" : "ipd";
}

/**
 * PURE. Bill-number prefix for an admission bill.
 *
 * Numbers are now minted by the bills BEFORE INSERT trigger (20261008000161), so this is
 * the TypeScript mirror of its bill_prefix_for_type() — kept as the canonical statement of
 * the rule (and as the regression lock below). Change both together.
 *
 * Both admission bill types share the 'BILL' series, which is what every admission bill in
 * the system already uses (BillingPage has always minted BILL-YYYYMMDD-NNNN for them).
 *
 * Day care bills deliberately do NOT use 'DC': that prefix now identifies a day care
 * ADMISSION (DC-20260717-0001, see lib/admissionNumber.ts). Giving both the same prefix
 * produced two different records with identical-looking identifiers — you could not tell a
 * day care admission number from a day care bill number by reading it.
 *
 * The bill's type is carried by bills.bill_type, not by its number.
 */
export function admissionBillPrefix(_billType: AdmissionBillType): "BILL" {
  return "BILL";
}

/**
 * PURE. Is this bill attached to an admission (and therefore subject to advances,
 * deposits, pre-auth ceilings and auto-pull)?
 *
 * Use this instead of `bill.bill_type === "ipd"`. That literal was scattered through the
 * billing UI and silently excluded day care, so a day care bill showed no advance and its
 * balance ignored the deposit — the patient looked unpaid despite having prepaid in full.
 */
export function isAdmissionBill(billType: string | null | undefined): boolean {
  return ADMISSION_BILL_TYPES.includes((billType || "") as AdmissionBillType);
}

/**
 * Find the admission's bill, across both admission bill types.
 *
 * "Still open for charges" is `payment_status` unpaid/partial **OR** `bill_status='draft'`.
 * The payment_status test alone is not enough: pay-before-procedure settles the bill at
 * ADMIT, so a day care bill is `paid` while still a draft, and every later charge (lens,
 * consumables) would fail to find it and spawn a duplicate bill. The same already happens
 * to any IPD patient whose advance covers the bill mid-stay — there are live `draft`+`paid`
 * IPD bills. A draft is an open worksheet whatever its payment status; a *finalised* bill is
 * an issued invoice and correctly does not take new lines.
 *
 * This is a strict superset of the old `.in("payment_status", ["unpaid","partial"])` rule:
 * every bill that matched before still matches, so no charge can be misrouted.
 *
 * Pass `paymentStatuses: []` to ignore status entirely — use that for "show me this
 * admission's bill" (identity), as opposed to "give me a bill to append a charge to".
 */
export async function findAdmissionBill(
  hospitalId: string,
  admissionId: string,
  opts?: { paymentStatuses?: string[] }
): Promise<{ id: string; bill_type: AdmissionBillType } | null> {
  const statuses = opts?.paymentStatuses ?? DEFAULT_OPEN_PAYMENT_STATUSES;

  let q = (supabase as any)
    .from("bills")
    .select("id, bill_type")
    .eq("hospital_id", hospitalId)
    .eq("admission_id", admissionId)
    .in("bill_type", ADMISSION_BILL_TYPES as unknown as string[]);

  if (statuses.length > 0) {
    q = q.or(`payment_status.in.(${statuses.join(",")}),bill_status.eq.draft`);
  }

  // order + limit(1) is required, not cosmetic: maybeSingle() ERRORS when more than one row
  // matches, and callers that destructure only `data` swallow that error and behave as if
  // no bill exists at all.
  const { data } = await q
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? { id: data.id, bill_type: data.bill_type } : null;
}

/**
 * Find, or create as draft, the bill for an admission. The bill_type is resolved from the
 * admission itself, so callers never have to know whether this is IPD or day care.
 */
export async function findOrCreateAdmissionBill(
  hospitalId: string,
  patientId: string,
  admissionId: string,
  billDate?: string,
  opts?: { paymentStatuses?: string[] }
): Promise<{ id: string; billType: AdmissionBillType; isNew: boolean }> {
  const existing = await findAdmissionBill(hospitalId, admissionId, opts);
  if (existing) return { id: existing.id, billType: existing.bill_type, isNew: false };

  const { data: adm } = await (supabase as any)
    .from("admissions")
    .select("admission_type")
    .eq("id", admissionId)
    .maybeSingle();

  const billType = admissionBillType(adm?.admission_type);

  // bill_number is omitted deliberately: the BEFORE INSERT trigger (20261008000161) mints it
  // in the SAME transaction as this insert, so a failed insert rolls the counter back rather
  // than burning a number. The trigger's bill_prefix_for_type() maps both admission types to
  // 'BILL', matching admissionBillPrefix() below — keep the two in step.
  const { data: newBill } = await (supabase as any)
    .from("bills")
    .insert({
      hospital_id:     hospitalId,
      patient_id:      patientId,
      admission_id:    admissionId,
      bill_type:       billType,
      bill_date:       billDate || new Date().toISOString().split("T")[0],
      bill_status:     "draft",
      payment_status:  "unpaid",
      subtotal:        0,
      gst_amount:      0,
      total_amount:    0,
      patient_payable: 0,
      balance_due:     0,
    })
    .select("id")
    .maybeSingle();

  return { id: newBill!.id, billType, isNew: true };
}
