import { supabase } from "@/integrations/supabase/client";

let _cachedUserRowId: string | null = null;

/**
 * Resolves the public.users row id for the signed-in user.
 *
 * auth.getUser().id is the auth.users id, which is NOT the same value as
 * public.users.id — they diverged when auth_user_id was introduced. Columns that
 * reference users(id) (acknowledged_by, verified_by, …) must be given this id, not
 * the auth uid, or the write fails the foreign key.
 */
export async function getCurrentUserRowId(): Promise<string | null> {
  if (_cachedUserRowId) return _cachedUserRowId;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (data?.id) _cachedUserRowId = data.id;
  return data?.id ?? null;
}

supabase.auth.onAuthStateChange(() => { _cachedUserRowId = null; });
