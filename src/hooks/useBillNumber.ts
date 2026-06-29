import { supabase } from "@/integrations/supabase/client";

/**
 * Atomic bill number generator using Supabase RPC.
 * Uses INSERT ON CONFLICT with RETURNING to guarantee uniqueness
 * even under concurrent access.
 *
 * @param hospitalId - The hospital UUID
 * @param prefix - Bill prefix (BILL, OPD, PHARM, DIAL, PHYS, CHEMO, DENT, AYSH, VACC, RET)
 * @returns A unique bill number like "BILL-20260407-0001"
 */
export async function generateBillNumber(hospitalId: string, prefix = "BILL"): Promise<string> {
  const { data, error } = await supabase.rpc("generate_bill_number", {
    p_hospital_id: hospitalId,
    p_prefix: prefix,
  });
  if (error) throw new Error(`Bill number generation failed: ${error.message}`);
  return data as string;
}
