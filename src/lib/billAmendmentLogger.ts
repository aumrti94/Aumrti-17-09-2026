/**
 * Bill Amendment Audit Logger
 *
 * Call logBillAmendment() whenever a finalized or in-progress bill is modified.
 * Captures before/after snapshots for NABH compliance and insurance dispute evidence.
 */

import { supabase } from "@/integrations/supabase/client";

export type AmendmentType =
  | "line_item_added"
  | "line_item_removed"
  | "rate_changed"
  | "discount_applied"
  | "insurance_updated"
  | "status_changed"
  | "advance_applied"
  | "cancelled";

interface LogAmendmentParams {
  billId:        string;
  hospitalId:    string;
  amendmentType: AmendmentType;
  fieldChanged?: string;
  oldValue?:     Record<string, unknown> | unknown;
  newValue?:     Record<string, unknown> | unknown;
  reason?:       string;
}

export async function logBillAmendment(params: LogAmendmentParams): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    let userId: string | undefined;

    if (user?.id) {
      const { data: u } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      userId = u?.id;
    }

    await (supabase as any).from("bill_amendments").insert({
      bill_id:        params.billId,
      hospital_id:    params.hospitalId,
      amendment_type: params.amendmentType,
      field_changed:  params.fieldChanged ?? null,
      old_value:      params.oldValue !== undefined ? params.oldValue : null,
      new_value:      params.newValue !== undefined ? params.newValue : null,
      reason:         params.reason ?? null,
      changed_by:     userId ?? null,
      changed_at:     new Date().toISOString(),
    });
  } catch {
    // Non-blocking — audit failure must not break the billing workflow
  }
}

/**
 * Convenience: log a line item added to a bill
 */
export function logLineItemAdded(
  billId: string, hospitalId: string,
  item: { description: string; unit_rate: number; quantity: number; total_amount: number },
  reason?: string,
) {
  return logBillAmendment({
    billId, hospitalId,
    amendmentType: "line_item_added",
    fieldChanged:  "bill_line_items",
    newValue:      item,
    reason,
  });
}

/**
 * Convenience: log a line item removed from a bill
 */
export function logLineItemRemoved(
  billId: string, hospitalId: string,
  item: { description: string; unit_rate: number; total_amount: number },
  reason?: string,
) {
  return logBillAmendment({
    billId, hospitalId,
    amendmentType: "line_item_removed",
    fieldChanged:  "bill_line_items",
    oldValue:      item,
    reason,
  });
}

/**
 * Convenience: log an insurance amount update
 */
export function logInsuranceUpdate(
  billId: string, hospitalId: string,
  before: { insurance_amount: number; patient_payable: number },
  after:  { insurance_amount: number; patient_payable: number },
) {
  return logBillAmendment({
    billId, hospitalId,
    amendmentType: "insurance_updated",
    fieldChanged:  "insurance_amount",
    oldValue:      before,
    newValue:      after,
  });
}

/**
 * Convenience: log advance application
 */
export function logAdvanceApplied(
  billId: string, hospitalId: string,
  amount: number, newBalanceDue: number,
) {
  return logBillAmendment({
    billId, hospitalId,
    amendmentType: "advance_applied",
    fieldChanged:  "advance_applied",
    newValue:      { amount_applied: amount, new_balance_due: newBalanceDue },
  });
}

/**
 * Fetch amendment history for a bill (for the history drawer in BillEditor)
 */
export async function fetchBillAmendments(billId: string) {
  const { data, error } = await (supabase as any)
    .from("bill_amendments")
    .select("id, amendment_type, field_changed, old_value, new_value, reason, changed_at, users(full_name)")
    .eq("bill_id", billId)
    .order("changed_at", { ascending: false })
    .limit(50);

  if (error) return [];
  return data ?? [];
}
