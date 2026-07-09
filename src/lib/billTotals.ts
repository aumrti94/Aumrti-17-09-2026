import { supabase } from "@/integrations/supabase/client";
import { roundCurrency } from "@/lib/currency";

interface RecalculateResult {
  ok: boolean;
  usedFallback: boolean;
  error?: string;
}

type Money = number | string | null | undefined;

export interface BillTotalsInput {
  items: { taxable_amount?: Money; gst_amount?: Money }[];
  discountAmount?: Money;
  advanceReceived?: Money;
  insuranceAmount?: Money;
  paidAmount?: Money;
}

export interface BillTotals {
  subtotal: number;
  gst: number;
  total: number;
  patientPayable: number;
  balanceDue: number;
  paymentStatus: "paid" | "partial" | "unpaid";
}

/**
 * Pure bill-total computation — no I/O, no Supabase.
 * Single source of truth so it can be unit tested directly (revenue surface —
 * @ravi gate). `recalculateBillTotalsSafe` below always calls into this: the
 * "recalculate_bill_totals" RPC it tries first does not exist as a Postgres
 * function on this project (confirmed via pg_proc — every call errors and
 * falls through), so this function is the sole real implementation, not a
 * fallback for a parallel SQL one.
 */
export function computeBillTotals(input: BillTotalsInput): BillTotals {
  const items = input.items || [];
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + Number(item.taxable_amount || 0), 0));
  const gst = roundCurrency(items.reduce((sum, item) => sum + Number(item.gst_amount || 0), 0));
  const discount = roundCurrency(Number(input.discountAmount || 0));
  // total_amount is net-of-discount by convention (matches how DiscountTab/
  // DiscountApprovalsInbox have always applied a discount) — this recalculation
  // must preserve that or a later, unrelated line-item edit silently re-inflates
  // an already-discounted bill back toward its pre-discount total.
  const total = roundCurrency(Math.max(subtotal + gst - discount, 0));
  const advance = roundCurrency(Number(input.advanceReceived || 0));
  const insurance = roundCurrency(Number(input.insuranceAmount || 0));
  const paid = roundCurrency(Number(input.paidAmount || 0));
  const patientPayable = roundCurrency(Math.max(total - advance - insurance, 0));
  const balanceDue = roundCurrency(Math.max(patientPayable - paid, 0));
  const paymentStatus = balanceDue <= 0 && paid > 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
  return { subtotal, gst, total, patientPayable, balanceDue, paymentStatus };
}

export async function recalculateBillTotalsSafe(billId: string): Promise<RecalculateResult> {
  const { error: rpcError } = await (supabase as any).rpc("recalculate_bill_totals", { p_bill_id: billId });

  if (!rpcError) {
    return { ok: true, usedFallback: false };
  }

  try {
    const [{ data: bill, error: billError }, { data: items, error: itemsError }] = await Promise.all([
      supabase
        .from("bills")
        .select("advance_received, insurance_amount, paid_amount, discount_amount")
        .eq("id", billId)
        .maybeSingle(),
      (supabase as any)
        .from("bill_line_items")
        .select("taxable_amount, gst_amount")
        .eq("bill_id", billId),
    ]);

    if (billError || !bill) {
      return { ok: false, usedFallback: true, error: billError?.message || "Bill not found for recalculation" };
    }

    if (itemsError) {
      return { ok: false, usedFallback: true, error: itemsError.message };
    }

    const { subtotal, gst, total, patientPayable, balanceDue, paymentStatus } = computeBillTotals({
      items: items || [],
      discountAmount: bill.discount_amount,
      advanceReceived: bill.advance_received,
      insuranceAmount: bill.insurance_amount,
      paidAmount: bill.paid_amount,
    });

    const { error: updateError } = await (supabase as any)
      .from("bills")
      .update({
        subtotal,
        taxable_amount: subtotal,
        gst_amount: gst,
        total_amount: total,
        patient_payable: patientPayable,
        balance_due: balanceDue,
        payment_status: paymentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", billId);

    if (updateError) {
      return { ok: false, usedFallback: true, error: updateError.message };
    }

    console.error("recalculate_bill_totals RPC failed, client fallback applied:", rpcError.message);
    return { ok: true, usedFallback: true };
  } catch (fallbackError) {
    return {
      ok: false,
      usedFallback: true,
      error: fallbackError instanceof Error ? fallbackError.message : "Unknown bill recalculation error",
    };
  }
}