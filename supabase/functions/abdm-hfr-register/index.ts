/**
 * abdm-hfr-register — Register/update the hospital's bridge callback URL with the ABDM gateway.
 *
 * This must be called once during ABDM onboarding and re-called whenever
 * the callback endpoint URL changes (e.g. after a domain migration).
 *
 * Flow:
 *   1. Get ABDM gateway token
 *   2. PATCH bridge/url  → register our callback URL with NHA
 *   3. GET  bridge-services → verify registration succeeded
 *   4. Update hospital_abdm_config.bridge_url + hfr_registered_at
 *
 * NHA docs ref: ABDM Integration Guide v3 — Section 9 HIP Bridge Registration
 *
 * Endpoint refs:
 *   PATCH {abdmBaseUrl}/api/hiecm/gateway/v3/bridge/url
 *   GET   {abdmBaseUrl}/api/hiecm/gateway/v3/bridge-services
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAbdmToken, abdmHeaders } from "../_shared/abdm-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

    const anonSb = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonSb.auth.getUser();
    if (!user || authErr) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── Resolve hospital ──────────────────────────────────────────────────────
    const { data: userData, error: userErr } = await sb
      .from("users")
      .select("hospital_id, role")
      // auth_user_id, NOT id — the two diverged in migration 20260322111223.
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (userErr || !userData) return json({ error: "User record not found" }, 404);

    // Only admins should be able to register bridge URLs
    const adminRoles = ["super_admin", "hospital_admin"];
    if (!adminRoles.includes((userData as { role: string }).role)) {
      return json({ error: "Forbidden: only hospital_admin may register bridge URLs" }, 403);
    }

    const hospitalId = (userData as { hospital_id: string }).hospital_id;

    // ── Load hospital ABDM config ─────────────────────────────────────────────
    const { data: cfgRaw, error: cfgErr } = await sb
      .from("hospital_abdm_config")
      .select("*")
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (cfgErr) return json({ error: cfgErr.message }, 500);
    if (!cfgRaw) return json({ error: "No ABDM configuration found. Configure ABDM settings first." }, 404);

    const cfg = cfgRaw as {
      abdm_base_url: string;
      is_production: boolean;
      bridge_url: string | null;
    };

    const abdmBaseUrl = cfg.abdm_base_url || "https://dev.abdm.gov.in";
    const isProduction = cfg.is_production ?? false;

    // ── Get ABDM token ────────────────────────────────────────────────────────
    const token = await getAbdmToken(hospitalId, sb);
    if (!token) {
      return json(
        { error: "No ABDM token — configure ABDM_CLIENT_ID and ABDM_CLIENT_SECRET first" },
        400,
      );
    }

    // ── Determine bridge URL ──────────────────────────────────────────────────
    // Use the configured bridge_url if set; otherwise auto-derive from SUPABASE_URL.
    // The callback function (abdm-hip-callback) handles incoming gateway notifications.
    const bridgeUrl = cfg.bridge_url?.trim() ||
      `${SUPABASE_URL}/functions/v1/abdm-hip-callback`;

    // ── Step 1: Register bridge URL with NHA gateway ─────────────────────────
    const patchRequestId = crypto.randomUUID();
    const patchRes = await fetch(
      `${abdmBaseUrl}/api/hiecm/gateway/v3/bridge/url`,
      {
        method: "PATCH",
        headers: abdmHeaders(token, isProduction),
        body: JSON.stringify({ url: bridgeUrl }),
      },
    );
    const patchStatus = patchRes.status;
    const patchData = await patchRes.json().catch(() => ({})) as Record<string, unknown>;

    // Was using columns that don't exist on abdm_gateway_logs at all
    // (request_id/endpoint/payload/response/status_code/error, and uppercase
    // direction: "OUTBOUND" against a lowercase-only CHECK constraint) — the same defect
    // found in abdm-gateway-token (KNOWN-BUG-192). `.then(() => {})` discarded the error
    // explicitly rather than merely leaving it unchecked. Found via Phase 6 testing.
    const { error: patchLogErr } = await sb.from("abdm_gateway_logs").insert({
      hospital_id: hospitalId,
      action: "hfr_bridge_url_register",
      direction: "outbound",
      request_payload: { request_id: patchRequestId, url: bridgeUrl },
      response_payload: patchData,
      status: patchRes.ok ? "ok" : "error",
    });
    if (patchLogErr) console.error("abdm-hfr-register: gateway log insert failed:", patchLogErr.message);

    if (!patchRes.ok) {
      return json(
        {
          success: false,
          error: patchData?.message ?? `Bridge URL registration failed (HTTP ${patchStatus})`,
          details: patchData,
        },
        patchStatus < 500 ? patchStatus : 502,
      );
    }

    // ── Step 2: Verify registration by fetching bridge-services ─────────────
    const servicesRes = await fetch(
      `${abdmBaseUrl}/api/hiecm/gateway/v3/bridge-services`,
      {
        method: "GET",
        headers: abdmHeaders(token, isProduction),
      },
    );
    const servicesData = await servicesRes.json().catch(() => ({})) as Record<string, unknown>;

    const { error: servicesLogErr } = await sb.from("abdm_gateway_logs").insert({
      hospital_id: hospitalId,
      action: "hfr_bridge_services_check",
      direction: "outbound",
      request_payload: null,
      response_payload: servicesData,
      status: servicesRes.ok ? "ok" : "error",
    });
    if (servicesLogErr) console.error("abdm-hfr-register: gateway log insert failed:", servicesLogErr.message);

    // ── Step 3: Update DB ─────────────────────────────────────────────────────
    const now = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("hospital_abdm_config")
      .update({
        bridge_url: bridgeUrl,
        hfr_registered_at: now,
        updated_at: now,
      })
      .eq("hospital_id", hospitalId);
    if (updateErr) console.error("abdm-hfr-register: hospital_abdm_config update failed:", updateErr.message);

    return json({
      success: true,
      bridge_url: bridgeUrl,
      registered_at: now,
      services: servicesData,
    });
  } catch (err) {
    console.error("abdm-hfr-register unhandled error:", err instanceof Error ? err.message : String(err));
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
