// ============================================================
// DELETE HOSPITAL — two-phase soft-delete + streaming purge
//
// Phase 1 (deleted_at null): mark for deletion, start 7-day grace window.
//   Returns plain JSON immediately.
// Restore: clear deleted_at within the grace window. Plain JSON.
// Grace gate: deleted_at set but < 7 days old -> 409 JSON (not a failure,
//   the caller must wait or restore).
// Phase 2 (grace elapsed): irreversible purge. Streams Server-Sent Events so
//   the UI can show a real progress bar (row counts + phase labels). The purge
//   is orchestrated step-by-step via the purge_hospital_* RPCs
//   (migration 20261008000148) instead of one opaque purge_hospital() call.
//
// Why NOT direct delete from frontend:
//   auth.users lives in Supabase's auth schema and can only be purged with the
//   Admin API (service-role key); the anon/user JWT cannot do this.
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

const GRACE_PERIOD_DAYS = 7;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Admin client (service role — bypasses RLS, can touch auth.users) ──
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const authHeader = req.headers.get("Authorization");

    // Parse the body up front so we can branch on `action` before the hard
    // auth returns (the non-destructive preflight must be able to REPORT an
    // auth/secret failure rather than just 401 out).
    const { hospital_id, action } =
      await req.json().catch(() => ({ hospital_id: undefined, action: undefined }));

    // ── Preflight: non-destructive prerequisite check. Never throws; 200. ──
    // Confirms the three deploy prerequisites for the frontend:
    //   deployed         — reaching this code proves the function is deployed
    //   service_role_key — the SUPABASE_SERVICE_ROLE_KEY secret is present
    //   authenticated    — the caller's JWT resolves to a user
    //   admin            — that user is an active aumrti_admin
    if (action === "preflight") {
      const hasKey = !!serviceKey;
      let authenticated = false;
      let isAdmin = false;
      if (authHeader && hasKey) {
        try {
          const { data: { user }, error } =
            await admin.auth.getUser(authHeader.replace("Bearer ", ""));
          authenticated = !!user && !error;
          if (authenticated && user) {
            const { data: row } = await admin
              .from("aumrti_admins")
              .select("id")
              .eq("auth_user_id", user.id)
              .eq("is_active", true)
              .maybeSingle();
            isAdmin = !!row;
          }
        } catch {
          /* leave as false — the check itself is the diagnostic */
        }
      }
      return json({
        ok: hasKey && authenticated && isAdmin,
        checks: { deployed: true, service_role_key: hasKey, authenticated, admin: isAdmin },
      });
    }

    // ── 1. Verify caller is an active aumrti_admin ──────────────────────
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

    // ── 2. Validate request body ───────────────────────────────────────
    if (!hospital_id) return json({ error: "hospital_id is required" }, 400);

    const { data: hospital } = await admin
      .from("hospitals")
      .select("id, name, deleted_at")
      .eq("id", hospital_id)
      .maybeSingle();

    if (!hospital) return json({ error: "Hospital not found" }, 404);

    const hospitalName = hospital.name;

    // ── 2b. Restore: clear a pending soft-delete within the grace window ──
    if (action === "restore") {
      if (!hospital.deleted_at) {
        return json({ error: "Hospital is not marked for deletion" }, 400);
      }
      const { error: restoreErr } = await admin
        .from("hospitals")
        .update({ deleted_at: null })
        .eq("id", hospital_id);
      if (restoreErr) return json({ error: `Restore failed: ${restoreErr.message}` }, 500);
      return json({ success: true, restored: true, hospital_name: hospitalName });
    }

    // ── 2c. Phase 1 — mark for deletion (do NOT purge yet) ───────────────
    if (!hospital.deleted_at) {
      const { error: markErr } = await admin
        .from("hospitals")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", hospital_id);
      if (markErr) return json({ error: `Failed to mark hospital for deletion: ${markErr.message}` }, 500);

      const permanentAfter = new Date(Date.now() + GRACE_PERIOD_DAYS * 86400000).toISOString();
      return json({
        success: true,
        soft_deleted: true,
        hospital_name: hospitalName,
        permanent_after: permanentAfter,
        message: `${hospitalName} has been marked for deletion. It will be permanently and irreversibly purged after ${GRACE_PERIOD_DAYS} days unless restored before then.`,
      });
    }

    // ── 2d. Grace gate — deleted_at set but window not yet elapsed ────────
    const deletedAt = new Date(hospital.deleted_at as string).getTime();
    const graceElapsedMs = Date.now() - deletedAt;
    if (graceElapsedMs < GRACE_PERIOD_DAYS * 86400000) {
      const daysRemaining = Math.ceil((GRACE_PERIOD_DAYS * 86400000 - graceElapsedMs) / 86400000);
      return json({
        error: `${hospitalName} is within its ${GRACE_PERIOD_DAYS}-day deletion grace period (${daysRemaining} day(s) remaining). Restore it, or wait until the grace period elapses to permanently purge it.`,
        soft_deleted: true,
        days_remaining: daysRemaining,
      }, 409);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Phase 2 — irreversible purge, STREAMED as Server-Sent Events.
    // ══════════════════════════════════════════════════════════════════════
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

        const warnings: string[] = [];
        let cumulative = 0;

        try {
          // Collect staff auth_user_ids BEFORE any deletes (cascade removes them).
          const { data: staffRows } = await admin
            .from("users")
            .select("auth_user_id")
            .eq("hospital_id", hospital_id)
            .not("auth_user_id", "is", null);
          const authUserIds: string[] = (staffRows ?? [])
            .map((r: { auth_user_id: string | null }) => r.auth_user_id)
            .filter((id): id is string => !!id);

          // ── total (denominator for the progress bar) ──
          const { data: estData } = await admin.rpc("purge_hospital_estimate", { p_id: hospital_id });
          const total = Number(estData ?? 0);
          send("total", { rows: total });

          // ── grandchildren (join-only child tables) ──
          send("phase", { label: "Removing linked records", cumulative });
          const { data: gcData, error: gcErr } = await admin.rpc("purge_hospital_grandchildren", { p_id: hospital_id });
          if (gcErr) warnings.push(`Grandchild cleanup warning: ${gcErr.message}`);
          cumulative += Number(gcData ?? 0);
          send("phase", { label: "Removing linked records", cumulative });

          // ── direct hospital_id tables, one at a time ──
          const { data: planData, error: planErr } = await admin.rpc("purge_hospital_plan", { p_id: hospital_id });
          if (planErr) throw new Error(`Could not build purge plan: ${planErr.message}`);
          const tables: string[] = (planData ?? []).map((r: { table_name: string }) => r.table_name);

          const failed: string[] = [];
          for (let i = 0; i < tables.length; i++) {
            const t = tables[i];
            const { data: rc, error: tErr } = await admin.rpc("purge_hospital_table", { p_id: hospital_id, p_table: t });
            if (tErr) { failed.push(t); continue; }
            const deleted = Number(rc ?? 0);
            cumulative += deleted;
            send("progress", { table: t, i: i + 1, n: tables.length, deleted, cumulative });
          }

          // ── retry sweep for FK-ordering failures (2-pass equivalent) ──
          if (failed.length > 0) {
            send("phase", { label: "Resolving remaining records", cumulative });
            for (const t of failed) {
              const { data: rc, error: tErr } = await admin.rpc("purge_hospital_table", { p_id: hospital_id, p_table: t });
              if (tErr) { warnings.push(`Table ${t}: ${tErr.message}`); continue; }
              cumulative += Number(rc ?? 0);
              send("progress", { table: t, i: tables.length, n: tables.length, deleted: Number(rc ?? 0), cumulative });
            }
          }

          // ── storage cleanup ──
          send("phase", { label: "Cleaning up files", cumulative });
          for (const bucket of ["hospital-logos", "hospital-assets", "hospital-documents"]) {
            try {
              const { data: files, error: listErr } = await admin.storage.from(bucket).list(hospital_id, { limit: 500 });
              if (listErr) continue;
              if (files && files.length > 0) {
                const paths = files.map((f) => `${hospital_id}/${f.name}`);
                const { error: removeErr } = await admin.storage.from(bucket).remove(paths);
                if (removeErr) warnings.push(`Storage cleanup warning (${bucket}): ${removeErr.message}`);
              }
            } catch (e) {
              warnings.push(`Storage bucket ${bucket} skipped: ${(e as Error).message}`);
            }
          }

          // ── finalize: delete the hospital row itself (must succeed) ──
          send("phase", { label: "Finalizing", cumulative });
          const { error: finErr } = await admin.rpc("purge_hospital_finalize", { p_id: hospital_id });
          if (finErr) throw new Error(`Final hospital delete failed: ${finErr.message}`);

          // ── delete auth.users for staff (now safe) ──
          send("phase", { label: "Removing staff accounts", cumulative });
          let deletedAuthUsers = 0;
          for (const authUserId of authUserIds) {
            const { error: delAuthErr } = await admin.auth.admin.deleteUser(authUserId);
            if (delAuthErr) warnings.push(`Auth user ${authUserId} not deleted: ${delAuthErr.message}`);
            else deletedAuthUsers++;
          }

          send("done", {
            hospital_name: hospitalName,
            deleted_auth_users: deletedAuthUsers,
            total_staff_accounts: authUserIds.length,
            cumulative,
            warnings: warnings.length > 0 ? warnings : undefined,
          });
        } catch (err) {
          send("error", { error: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...CORS,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });

  } catch (err) {
    console.error("delete-hospital error:", err instanceof Error ? err.message : String(err));
    return json({ error: "Internal error" }, 500);
  }
});
