// ============================================================
// UPDATE OAUTH PROVIDERS — sync social-login keys to the project's GoTrue config
//
// Supabase's built-in OAuth (supabase.auth.signInWithOAuth) reads provider client
// IDs/secrets from the PROJECT auth config — not from any DB table. This function is
// the bridge: an active aumrti_admin saves keys into public.oauth_provider_settings
// (via the Platform UI), then calls this function, which reads that table (service
// role) and PATCHes the project auth config through the Supabase Management API.
//
// Secrets in play (set as Supabase function secrets — NEVER in the DB or client).
// NOTE: secret names cannot start with SUPABASE_ (reserved by the platform):
//   MANAGEMENT_API_PAT  — Supabase Personal Access Token (full project control)
//   PROJECT_REF         — project ref (optional; auto-derived from SUPABASE_URL if absent)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Map our provider keys → GoTrue config field prefixes.
const PROVIDER_FIELD: Record<string, string> = {
  google: "external_google",
  azure: "external_azure",
  facebook: "external_facebook",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
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

    // ── 2. Management API credentials ───────────────────────────────────
    const pat = Deno.env.get("MANAGEMENT_API_PAT");
    if (!pat) {
      return json({ error: "MANAGEMENT_API_PAT is not configured for this project." }, 500);
    }
    const projectRef =
      Deno.env.get("PROJECT_REF") ||
      (Deno.env.get("SUPABASE_URL") || "").match(/https:\/\/([^.]+)\.supabase\./)?.[1];
    if (!projectRef) {
      return json({ error: "Unable to determine SUPABASE_PROJECT_REF." }, 500);
    }

    // ── 3. Read provider settings (source of truth) ─────────────────────
    const { data: rows, error: readErr } = await admin
      .from("oauth_provider_settings")
      .select("provider, enabled, client_id, client_secret");
    if (readErr) return json({ error: readErr.message }, 500);

    // ── 4. Build the GoTrue auth-config patch ───────────────────────────
    // Always send the enabled flag. Only send client_id / secret when present so a blank
    // secret never wipes an existing one (mirrors the UI's write-only secret field).
    const body: Record<string, unknown> = {};
    for (const row of rows || []) {
      const prefix = PROVIDER_FIELD[row.provider];
      if (!prefix) continue;
      body[`${prefix}_enabled`] = !!row.enabled;
      if (row.client_id) body[`${prefix}_client_id`] = row.client_id;
      if (row.client_secret) body[`${prefix}_secret`] = row.client_secret;
    }

    // ── 5. PATCH the project auth config ────────────────────────────────
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${pat}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const detail = await res.text();
      return json({ error: `Management API error (${res.status})`, detail }, 502);
    }

    // Return only which providers were applied + their enabled state — never the secrets.
    const applied = (rows || []).map((r) => ({ provider: r.provider, enabled: !!r.enabled }));
    return json({ success: true, applied });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
