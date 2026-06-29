/**
 * Credit Limit Enforcement
 *
 * Called before finalizing a bill or creating a new bill for a payer
 * (corporate, TPA, government scheme) that has a credit_limit set in payer_masters.
 *
 * Returns: { allowed: boolean; reason?: string; outstanding?: number; limit?: number }
 */

import { supabase } from "@/integrations/supabase/client";

export interface CreditCheckResult {
  allowed:      boolean;
  onHold:       boolean;
  outstanding:  number;
  limit:        number | null;
  utilizationPct: number | null;
  reason?:      string;
}

/**
 * Check credit availability for a payer (TPA, corporate, govt scheme).
 * Pass `newBillAmount` to check if adding this bill would breach the limit.
 */
export async function checkPayerCreditLimit(
  hospitalId:    string,
  payerMasterId: string,
  newBillAmount: number = 0,
): Promise<CreditCheckResult> {
  const { data: payer } = await (supabase as any)
    .from("payer_masters")
    .select("credit_limit, credit_hold, credit_hold_reason, outstanding_amount")
    .eq("id", payerMasterId)
    .eq("hospital_id", hospitalId)
    .maybeSingle();

  if (!payer) {
    return { allowed: true, onHold: false, outstanding: 0, limit: null, utilizationPct: null };
  }

  const outstanding    = Number(payer.outstanding_amount) || 0;
  const limit          = payer.credit_limit != null ? Number(payer.credit_limit) : null;
  const onHold         = !!payer.credit_hold;

  if (onHold) {
    return {
      allowed:       false,
      onHold:        true,
      outstanding,
      limit,
      utilizationPct: limit ? Math.round((outstanding / limit) * 100) : null,
      reason:        payer.credit_hold_reason || "Account on credit hold. Contact finance team.",
    };
  }

  if (limit === null) {
    // No limit configured — allow unrestricted
    return { allowed: true, onHold: false, outstanding, limit: null, utilizationPct: null };
  }

  const projectedOutstanding = outstanding + newBillAmount;
  const utilizationPct       = Math.round((projectedOutstanding / limit) * 100);

  if (projectedOutstanding > limit) {
    return {
      allowed:        false,
      onHold:         false,
      outstanding,
      limit,
      utilizationPct,
      reason: `Credit limit exceeded. Outstanding: ₹${outstanding.toLocaleString("en-IN")} + New: ₹${newBillAmount.toLocaleString("en-IN")} = ₹${projectedOutstanding.toLocaleString("en-IN")} > Limit: ₹${limit.toLocaleString("en-IN")}`,
    };
  }

  return { allowed: true, onHold: false, outstanding, limit, utilizationPct };
}

/**
 * After a bill is paid / settled, reduce the payer's outstanding_amount.
 */
export async function decreasePayerOutstanding(
  hospitalId:    string,
  payerMasterId: string,
  paidAmount:    number,
): Promise<void> {
  const { data: payer } = await (supabase as any)
    .from("payer_masters")
    .select("outstanding_amount, credit_limit")
    .eq("id", payerMasterId)
    .maybeSingle();

  if (!payer) return;

  const newOutstanding = Math.max(0, (Number(payer.outstanding_amount) || 0) - paidAmount);
  const onHold         = payer.credit_hold && newOutstanding <= (Number(payer.credit_limit) || Infinity);

  await (supabase as any).from("payer_masters").update({
    outstanding_amount: newOutstanding,
    // Auto-lift hold if outstanding now within limit
    ...(payer.credit_hold && onHold ? { credit_hold: false, credit_hold_reason: null, credit_hold_at: null } : {}),
  }).eq("id", payerMasterId).eq("hospital_id", hospitalId);
}

/**
 * Increase outstanding when a new bill is created for a payer.
 */
export async function increasePayerOutstanding(
  hospitalId:    string,
  payerMasterId: string,
  billAmount:    number,
): Promise<void> {
  const { data: payer } = await (supabase as any)
    .from("payer_masters")
    .select("outstanding_amount, credit_limit")
    .eq("id", payerMasterId)
    .maybeSingle();

  if (!payer) return;

  const newOutstanding = (Number(payer.outstanding_amount) || 0) + billAmount;
  const limit          = payer.credit_limit ? Number(payer.credit_limit) : null;
  const shouldHold     = limit !== null && newOutstanding > limit * 1.1; // auto-hold at 110% utilization

  await (supabase as any).from("payer_masters").update({
    outstanding_amount: newOutstanding,
    ...(shouldHold ? {
      credit_hold:        true,
      credit_hold_reason: `Auto-hold: outstanding ₹${newOutstanding.toLocaleString("en-IN")} exceeds 110% of credit limit`,
      credit_hold_at:     new Date().toISOString(),
    } : {}),
  }).eq("id", payerMasterId).eq("hospital_id", hospitalId);
}
