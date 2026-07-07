import { supabase } from "@/integrations/supabase/client";

/**
 * License-validity gate for high-risk clinical sign-offs (lab/radiology/nursing).
 * A clinician is "blocked" (must record an override reason to proceed) if their
 * medical license/registration is expired or absent. Reads the same data the
 * credential-expiry alerts use (staff_profiles.license_expiry_date + staff_credentials).
 */
export interface CredentialGateResult {
  blocked: boolean;
  reason: string;
}

export async function checkClinicianCredential(hospitalId: string, userId: string): Promise<CredentialGateResult> {
  if (!hospitalId || !userId) return { blocked: false, reason: "" };
  const today = new Date().toISOString().split("T")[0];

  const [{ data: profile }, { data: creds }] = await Promise.all([
    (supabase as any).from("staff_profiles").select("license_expiry_date").eq("user_id", userId).maybeSingle(),
    (supabase as any).from("staff_credentials").select("credential_type, expiry_date").eq("hospital_id", hospitalId).eq("user_id", userId),
  ]);

  const profExpiry: string | null = profile?.license_expiry_date || null;
  const credRows: any[] = creds || [];

  // 1. Expired license on the staff profile
  if (profExpiry && profExpiry < today) {
    return { blocked: true, reason: `Medical license expired on ${profExpiry}` };
  }
  // 2. Any expired credential
  const expired = credRows.find((c) => c.expiry_date && c.expiry_date < today);
  if (expired) {
    return { blocked: true, reason: `Credential "${expired.credential_type}" expired on ${expired.expiry_date}` };
  }
  // 3. No license/registration on record at all
  if (!profExpiry && credRows.length === 0) {
    return { blocked: true, reason: "No medical license / registration on record" };
  }
  return { blocked: false, reason: "" };
}
