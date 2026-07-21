import { supabase } from "@/integrations/supabase/client";

/**
 * Where should an authenticated user land?
 *
 * An Aumrti platform admin has a row in `aumrti_admins` but NO row in `users`, so the
 * hospital context resolves `role = null` and every RoleGuard denies them — including
 * /dashboard itself, which bounces back to /dashboard forever behind an "Access denied"
 * toast. Any code path that routes a freshly-authenticated (or already-signed-in) user
 * must ask this helper instead of hard-coding "/dashboard".
 *
 * Mirrors the precedence in the `resolve_oauth_login()` RPC: platform admin wins.
 */
export async function resolvePostAuthRoute(fallback = "/dashboard"): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "/login";
  return (await isPlatformAdmin(user.id)) ? "/platform" : fallback;
}

/** True when this auth user is an active Aumrti platform admin. */
export async function isPlatformAdmin(authUserId: string): Promise<boolean> {
  const { data } = await (supabase as any)
    .from("aumrti_admins")
    .select("id")
    .eq("auth_user_id", authUserId)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}
