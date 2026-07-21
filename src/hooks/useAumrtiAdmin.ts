import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AumrtiAdmin {
  id: string;
  auth_user_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

async function fetchAumrtiAdmin(): Promise<AumrtiAdmin | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("aumrti_admins" as any)
    .select("id, auth_user_id, full_name, email, is_active, created_at")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  return data ?? null;
}

export function useAumrtiAdmin(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["aumrti-admin-me"],
    queryFn: fetchAumrtiAdmin,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    enabled,
  });
  // A disabled query is never "loading" — callers must not block on it.
  return { admin: data ?? null, isAdmin: !!data, isLoading: enabled && isLoading, refetch };
}
