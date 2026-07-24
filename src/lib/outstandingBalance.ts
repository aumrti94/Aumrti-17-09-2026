import { supabase } from "@/integrations/supabase/client";
import { REFUND_PAYMENT_STATUSES } from "@/lib/billStatus";

export interface OutstandingSummary {
  totalOutstanding: number;
  billCount: number;
}

/**
 * Sum of balance_due across all of a patient's bills at this hospital — same
 * aggregation PatientPortalBillsPage already uses for its own "Total Outstanding"
 * banner, reused here for staff-facing surfaces (Collections, new registrations).
 */
export async function fetchPatientOutstandingBalance(
  patientId: string,
  hospitalId: string,
): Promise<OutstandingSummary> {
  const { data } = await supabase
    .from("bills")
    .select("balance_due")
    .eq("patient_id", patientId)
    .eq("hospital_id", hospitalId)
    .gt("balance_due", 0)
    // A refunded bill keeps balance_due = total_amount (the refund zeroes paid_amount), so
    // without this the patient is greeted at registration with an outstanding-balance
    // warning for money the hospital handed back to them.
    .not("payment_status", "in", `(${REFUND_PAYMENT_STATUSES.join(",")})`);

  const bills = data || [];
  return {
    totalOutstanding: bills.reduce((s, b: any) => s + (Number(b.balance_due) || 0), 0),
    billCount: bills.length,
  };
}
