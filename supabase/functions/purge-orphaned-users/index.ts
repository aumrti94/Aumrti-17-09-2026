// ============================================================
// PURGE ORPHANED AUTH USERS — one-time cleanup edge function
//
// Finds every auth.user that:
//   • Is NOT linked to a public.users row for any existing hospital
//   • Is NOT an active aumrti_admin (platform team)
//
// Deletes them via the Admin API (requires service_role key).
// Safe to run multiple times — only orphaned accounts are touched.
//
// Invoke (POST, no body needed):
//   curl -X POST <SUPABASE_URL>/functions/v1/purge-orphaned-users \
//     -H "Authorization: Bearer <aumrti_admin_jwt>"
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 1. Verify caller is an active aumrti_admin ──────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { data: { user: caller }, error: authErr } =
      await admin.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authErr || !caller) return json({ error: "Unauthorized" }, 401);

    const { data: adminRow } = await admin
      .from("aumrti_admins")
      .select("id")
      .eq("auth_user_id", caller.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!adminRow) return json({ error: "Forbidden: aumrti_admin role required" }, 403);

    // ── 2. Fetch all auth users (paginated) ─────────────────────────
    let page = 1;
    const allAuthUsers: { id: string; email: string | undefined }[] = [];
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !data?.users?.length) break;
      allAuthUsers.push(...data.users.map((u) => ({ id: u.id, email: u.email })));
      if (data.users.length < 1000) break;
      page++;
    }

    if (allAuthUsers.length === 0) {
      return json({ success: true, deleted: 0, kept: 0, message: "No auth users found." });
    }

    // ── 3. Collect IDs to keep ──────────────────────────────────────
    // Keep: linked to a user row in an existing hospital
    const { data: linkedRows } = await admin
      .from("users")
      .select("auth_user_id")
      .in("hospital_id",
        (await admin.from("hospitals").select("id")).data?.map((h: { id: string }) => h.id) ?? []
      )
      .not("auth_user_id", "is", null);

    const linkedIds = new Set(
      (linkedRows ?? []).map((r: { auth_user_id: string | null }) => r.auth_user_id).filter(Boolean)
    );

    // Keep: active platform admins
    const { data: platformAdmins } = await admin
      .from("aumrti_admins")
      .select("auth_user_id")
      .eq("is_active", true)
      .not("auth_user_id", "is", null);

    const adminIds = new Set(
      (platformAdmins ?? []).map((r: { auth_user_id: string | null }) => r.auth_user_id).filter(Boolean)
    );

    // ── 4. Identify orphans ─────────────────────────────────────────
    const orphans = allAuthUsers.filter(
      (u) => !linkedIds.has(u.id) && !adminIds.has(u.id)
    );

    if (orphans.length === 0) {
      return json({
        success: true,
        deleted: 0,
        kept: allAuthUsers.length,
        message: "No orphaned auth users found — all accounts are linked to existing hospitals or platform admins.",
      });
    }

    // ── 5. Delete orphaned auth users ───────────────────────────────
    const deleted: string[] = [];
    const failed: { id: string; email: string | undefined; error: string }[] = [];

    for (const orphan of orphans) {
      const { error: delErr } = await admin.auth.admin.deleteUser(orphan.id);
      if (delErr) {
        failed.push({ id: orphan.id, email: orphan.email, error: delErr.message });
      } else {
        deleted.push(orphan.email ?? orphan.id);
      }
    }

    return json({
      success: true,
      deleted_count: deleted.length,
      deleted_emails: deleted,
      failed_count: failed.length,
      failures: failed.length > 0 ? failed : undefined,
      kept: allAuthUsers.length - orphans.length,
      message: `Deleted ${deleted.length} orphaned auth user(s). ${failed.length} failed.`,
    });

  } catch (err) {
    console.error("purge-orphaned-users error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
