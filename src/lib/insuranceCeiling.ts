import { supabase } from "@/integrations/supabase/client";

export interface PreAuthCeiling {
  ceiling: number;
  preAuthId: string;
  preAuthNumber: string | null;
  tpaName: string | null;
}

/**
 * Fetch the most-recently-approved pre-auth ceiling for an IPD admission.
 * Returns null when no approved pre-auth exists (non-insurance bill — no ceiling applies).
 */
export async function fetchPreAuthCeiling(
  admissionId: string,
  hospitalId: string
): Promise<PreAuthCeiling | null> {
  const { data } = await (supabase as any)
    .from("insurance_pre_auth")
    .select("id, approved_amount, pre_auth_number, tpa_name")
    .eq("admission_id", admissionId)
    .eq("hospital_id", hospitalId)
    .eq("status", "approved")
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || !data.approved_amount) return null;

  return {
    ceiling: Number(data.approved_amount),
    preAuthId: data.id,
    preAuthNumber: data.pre_auth_number ?? null,
    tpaName: data.tpa_name ?? null,
  };
}
