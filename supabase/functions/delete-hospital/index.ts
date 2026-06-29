// ============================================================
// DELETE HOSPITAL — Complete data purge edge function
//
// What this does (in safe order):
//   1. Verify caller is an active aumrti_admin
//   2. Collect all auth_user_ids for the hospital BEFORE any deletes
//   3. Clean up storage files (hospital logos, assets)
//   4. Call purge_hospital(p_id) — a stored function that explicitly
//      deletes every table in dependency order (grandchildren first,
//      then direct hospital_id children, then the hospital row itself).
//      This bypasses FK constraint issues entirely.
//   5. Delete auth.users for each staff member — done LAST so that
//      any residual FKs from nursing_mar / teleconsult_sessions
//      (which reference auth.users) are already gone by step 4
//
// Why NOT direct delete from frontend:
//   auth.users lives in Supabase's auth schema and can only be
//   purged with the Admin API (service-role key). The anon/user
//   JWT cannot do this.
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
    // ── Admin client (service role — bypasses RLS, can touch auth.users) ──
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 1. Verify caller is an active aumrti_admin ──────────────────────
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

    // ── 2. Parse and validate request body ─────────────────────────────
    const { hospital_id } = await req.json();
    if (!hospital_id) return json({ error: "hospital_id is required" }, 400);

    // Verify the hospital actually exists
    const { data: hospital } = await admin
      .from("hospitals")
      .select("id, name")
      .eq("id", hospital_id)
      .maybeSingle();

    if (!hospital) return json({ error: "Hospital not found" }, 404);

    const hospitalName = hospital.name;
    const warnings: string[] = [];
    let deletedAuthUsers = 0;

    // ── 3. Collect auth_user_ids BEFORE we delete anything ─────────────
    // We read this now because the hospital delete (step 5) will
    // cascade-delete public.users, making them unreachable afterwards.
    const { data: staffRows } = await admin
      .from("users")
      .select("auth_user_id")
      .eq("hospital_id", hospital_id)
      .not("auth_user_id", "is", null);

    const authUserIds: string[] = (staffRows ?? [])
      .map((r: { auth_user_id: string | null }) => r.auth_user_id)
      .filter((id): id is string => !!id);

    // ── 4. Delete storage files ─────────────────────────────────────────
    // Hospitals typically upload to paths prefixed by their hospital_id.
    // We try both common bucket names; any failure is logged as a warning.
    const storageBuckets = ["hospital-logos", "hospital-assets", "hospital-documents"];

    for (const bucket of storageBuckets) {
      try {
        const { data: files, error: listErr } = await admin.storage
          .from(bucket)
          .list(hospital_id, { limit: 500 });

        if (listErr) {
          // Bucket might not exist — silently skip
          continue;
        }

        if (files && files.length > 0) {
          const paths = files.map((f) => `${hospital_id}/${f.name}`);
          const { error: removeErr } = await admin.storage
            .from(bucket)
            .remove(paths);
          if (removeErr) {
            warnings.push(`Storage cleanup warning (${bucket}): ${removeErr.message}`);
          }
        }
      } catch (e) {
        warnings.push(`Storage bucket ${bucket} skipped: ${(e as Error).message}`);
      }
    }

    // ── 5. Call purge_hospital() — explicit ordered DELETE ──────────────
    // This stored function (created in migration 20260602) deletes every
    // table in the correct dependency order, bypassing FK constraint
    // issues entirely. It handles transitive grandchild tables
    // (ot_team_members, pharmacy_dispensing_items, etc.) before removing
    // parent rows, then finally deletes the hospital record itself.
    const { error: purgeErr } = await admin.rpc("purge_hospital", {
      p_id: hospital_id,
    });

    if (purgeErr) {
      return json({
        error: `Hospital purge failed: ${purgeErr.message}`,
        hint: "Ensure migration 20260602_hospital_delete_complete.sql has been applied.",
      }, 500);
    }

    // ── 6. Delete auth.users for hospital staff ─────────────────────────
    // Now safe: public.users (and nursing_mar / teleconsult_sessions that
    // referenced these auth IDs) were all removed in step 5's cascade.
    for (const authUserId of authUserIds) {
      const { error: delAuthErr } = await admin.auth.admin.deleteUser(authUserId);
      if (delAuthErr) {
        // Don't abort — the hospital data is already gone. Log it.
        warnings.push(`Auth user ${authUserId} not deleted: ${delAuthErr.message}`);
      } else {
        deletedAuthUsers++;
      }
    }

    // ── 7. Return summary ───────────────────────────────────────────────
    return json({
      success: true,
      hospital_name: hospitalName,
      deleted_auth_users: deletedAuthUsers,
      total_staff_accounts: authUserIds.length,
      warnings: warnings.length > 0 ? warnings : undefined,
    });

  } catch (err) {
    console.error("delete-hospital error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
