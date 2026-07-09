import { supabase } from "@/integrations/supabase/client";

export interface ReturnCreditLine {
  drugName: string;
  quantity: number;
  unitRate: number;
  gstPercent: number;
  gstAmount: number;
  lineTotal: number;
}

export interface ReturnCreditResult {
  /** True when the return pushed the bill into overpayment (paid_amount now exceeds the new total) — a refund is owed regardless of the bill's prior payment_status. */
  overpaid: boolean;
  overpaidAmount: number;
}

/**
 * Reduces a bill's totals/balance for a confirmed drug return and records a
 * matching negative bill_line_items row, so the itemized ledger reflects the
 * return instead of leaving credit_notes as an audit-only record.
 */
export async function applyReturnCreditToBill(
  billId: string,
  hospitalId: string,
  creditNoteId: string,
  lines: ReturnCreditLine[],
  baseAmount: number,
  gstAmount: number,
  totalRefund: number
): Promise<ReturnCreditResult> {
  const { data: bill, error: billErr } = await (supabase as any)
    .from("bills")
    .select("subtotal, gst_amount, total_amount, patient_payable, paid_amount, balance_due, payment_status")
    .eq("id", billId)
    .maybeSingle();

  if (billErr || !bill) return { overpaid: false, overpaidAmount: 0 };

  await (supabase as any).from("bill_line_items").insert(
    lines.map((l) => ({
      hospital_id: hospitalId,
      bill_id: billId,
      item_type: "pharmacy",
      description: `Return — ${l.drugName}`,
      quantity: -l.quantity,
      unit_rate: l.unitRate,
      gst_percent: l.gstPercent,
      gst_amount: -l.gstAmount,
      total_amount: -l.lineTotal,
      source_module: "pharmacy",
      source_record_id: creditNoteId,
    }))
  );

  const newSubtotal = Number(bill.subtotal || 0) - baseAmount;
  const newGst = Number(bill.gst_amount || 0) - gstAmount;
  const newTotal = Number(bill.total_amount || 0) - totalRefund;
  const newPatientPayable = Number(bill.patient_payable || 0) - totalRefund;
  const paidAmount = Number(bill.paid_amount || 0);
  const newBalanceDue = Math.max(newTotal - paidAmount, 0);
  const overpaid = paidAmount > newTotal;
  const newPaymentStatus = overpaid ? "refund_pending" : bill.payment_status;

  await (supabase as any)
    .from("bills")
    .update({
      subtotal: newSubtotal,
      gst_amount: newGst,
      total_amount: newTotal,
      patient_payable: newPatientPayable,
      balance_due: newBalanceDue,
      payment_status: newPaymentStatus,
    })
    .eq("id", billId);

  return { overpaid, overpaidAmount: overpaid ? roundToCents(paidAmount - newTotal) : 0 };
}

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}
