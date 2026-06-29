import { useHospitalContext } from "@/contexts/HospitalContext";
import { supabase } from "@/integrations/supabase/client";

// Reads from the app-level HospitalContext — zero extra RPCs after first login.
export function useHospitalId() {
  return useHospitalContext();
}

// Standalone async helper for non-hook contexts (edge functions, callbacks).
export async function getHospitalIdAsync(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("users")
    .select("hospital_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return data?.hospital_id || null;
}
