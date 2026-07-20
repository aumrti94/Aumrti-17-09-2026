/**
 * The display/decision contract for bill money. Pure — no I/O.
 *
 * Why this exists
 * ---------------
 * Four surfaces (BillEditor header, LineItemsTab footer, AdvanceApplicationTab,
 * IPDFinancialTab) each hand-rolled their own arithmetic, and they disagreed on
 * the same bill: charges shown as ₹6,000 in one place and ₹1,500 in another,
 * advances as ₹35,000 and ₹20,000, and a "Refund Due to Patient ₹29,000" that
 * did not exist. Every surface now derives its numbers here.
 *
 * Relationship to billTotals.ts
 * -----------------------------
 * `computeBillTotals` is the PERSISTENCE contract — it owns what lands in the
 * `bills` columns. This module is the PRESENTATION contract. They are kept
 * separate on purpose: conflating the two is how `patient_payable` ended up
 * meaning three different things (gross payable, residual balance, and
 * "charges so far"). The two agree on subtotal/gst/netCharges by construction —
 * both sum the same `taxable_amount` / `gst_amount` columns.
 *
 * Semantics — read before adding a field
 * --------------------------------------
 * • `patientPayable` is GROSS OF ADVANCE. It answers "what does this patient
 *   owe in total", not "what is left to pay". Anything wanting the residual
 *   uses `balanceDue`. Netting the advance into it is what produced the
 *   ₹1,500 "Actual (so far)" on a bill with ₹6,000 of charges.
 * • `netAdvance` is likewise GROSS OF APPLICATION — advance already applied to
 *   this bill still counts as a credit, because patientPayable has not been
 *   reduced by it.
 * • `balanceDue` and `refundDue` are mutually exclusive and both non-negative.
 *   Never derive a refund by negating a balance; read `settlement`.
 */

export type Money = number | string | null | undefined;

const num = (v: Money): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Currency rounding to 2dp, matching billTotals.roundCurrency. */
const round = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface BillMoneyLineItem {
  taxable_amount?: Money;
  gst_amount?: Money;
}

export interface BillMoneyInput {
  lineItems: BillMoneyLineItem[];
  discountAmount?: Money;
  insuranceAmount?: Money;
  /** Admission-scoped, gross of application. See lib/advanceLedger.ts. */
  netAdvance?: Money;
  /** Sum of bill_payments where is_advance = false. Never bills.paid_amount, which is inflated by advance sync. */
  directPaid?: Money;
}

export interface BillMoney {
  subtotal: number;
  gst: number;
  /** subtotal + gst, before discount. */
  grossCharges: number;
  discount: number;
  /** Net of discount. Equals bills.total_amount by convention. */
  netCharges: number;
  insuranceCovered: number;
  /** max(netCharges - insurance, 0). GROSS of advance — never a balance. */
  patientPayable: number;
  netAdvance: number;
  directPaid: number;
  totalCredits: number;
  /** max(patientPayable - totalCredits, 0). */
  balanceDue: number;
  /** max(totalCredits - patientPayable, 0). */
  refundDue: number;
  settlement: "due" | "settled" | "refund";
  paymentStatus: "paid" | "partial" | "unpaid";
}

export function computeBillMoney(input: BillMoneyInput): BillMoney {
  const items = input.lineItems || [];
  const subtotal = round(items.reduce((s, i) => s + num(i.taxable_amount), 0));
  const gst = round(items.reduce((s, i) => s + num(i.gst_amount), 0));
  const grossCharges = round(subtotal + gst);
  const discount = round(num(input.discountAmount));
  const netCharges = round(Math.max(grossCharges - discount, 0));
  const insuranceCovered = round(num(input.insuranceAmount));
  const patientPayable = round(Math.max(netCharges - insuranceCovered, 0));

  const netAdvance = round(num(input.netAdvance));
  const directPaid = round(num(input.directPaid));
  const totalCredits = round(netAdvance + directPaid);

  const delta = round(patientPayable - totalCredits);
  const balanceDue = Math.max(delta, 0);
  const refundDue = Math.max(-delta, 0);

  const settlement: BillMoney["settlement"] =
    refundDue > 0 ? "refund" : balanceDue > 0 ? "due" : "settled";

  const paymentStatus: BillMoney["paymentStatus"] =
    balanceDue <= 0 && totalCredits > 0 ? "paid" : totalCredits > 0 ? "partial" : "unpaid";

  return {
    subtotal, gst, grossCharges, discount, netCharges, insuranceCovered,
    patientPayable, netAdvance, directPaid, totalCredits,
    balanceDue, refundDue, settlement, paymentStatus,
  };
}
