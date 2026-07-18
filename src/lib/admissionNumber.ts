/**
 * admissionNumber — the one place an admission number is minted.
 *
 * Admission numbers used to be pseudo-random, not sequences:
 *   Day care : `DC-${Date.now().toString().slice(-8)}`  → DC-80918818
 *   IPD      : `IPD-${date}-${Math.random()...}`        → IPD-20260716-1318
 *
 * Neither could be ordered, counted or reconciled, neither started at 1, and two admissions
 * created in the same millisecond could collide. Bills have always done this properly, so
 * admissions now use the same shape via generate_admission_number() (20261008000143):
 *
 *   DC-20260717-0001    day care
 *   IPD-20260717-0001   inpatient
 *
 * The sequence lives in its own table (not bill_sequences): a day care BILL is already
 * numbered from the 'DC' bill prefix, and sharing one counter would interleave the two
 * series and make an admission number indistinguishable from a bill number.
 */

import { supabase } from "@/integrations/supabase/client";
import { admissionBillType } from "@/lib/admissionBill";

export type AdmissionNumberPrefix = "IPD" | "DC";

/** PURE. Which admission-number series an admission_type belongs to. */
export function admissionNumberPrefix(
  admissionType: string | null | undefined
): AdmissionNumberPrefix {
  return admissionBillType(admissionType) === "daycare" ? "DC" : "IPD";
}

/**
 * Mint the next admission number for this hospital and admission type.
 *
 * Atomic and per-hospital; resets to 0001 each IST day. Throws if the RPC fails — an
 * admission must never be written with an unnumbered or guessed identifier.
 */
export async function generateAdmissionNumber(
  hospitalId: string,
  admissionType: string | null | undefined
): Promise<string> {
  const prefix = admissionNumberPrefix(admissionType);
  const { data, error } = await (supabase as any).rpc("generate_admission_number", {
    p_hospital_id: hospitalId,
    p_prefix: prefix,
  });
  if (error || !data) {
    throw new Error(error?.message || "Could not generate an admission number");
  }
  return data as string;
}
