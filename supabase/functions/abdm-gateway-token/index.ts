/**
 * abdm-gateway-token — ABDM gateway session token manager.
 *
 * Fetches and caches a short-lived access token from the NHA gateway.
 * All other ABDM edge functions call this one instead of hitting the
 * sessions endpoint directly, so token refresh logic lives in one place.
 *
 * NHA docs ref: ABDM Integration Guide v3 — Section 4.1 Authentication
 * Endpoint: POST {abdmBaseUrl}/api/hiecm/gateway/v3/sessions
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Refresh the token this many seconds before it actually expires. */
const TOKEN_BUFFER_SECS = 120;

/** Milliseconds to wait before the single retry on network failure. */
const RETRY_DELAY_MS = 2000;

interface AbdmConfig {
  id: string;
  hospital_id: string;
  abdm_client_id: string | null;
  abdm_client_secret: string | null;
  abdm_base_url: string;
  is_production: boolean;
  abdm_access_token: string | null;
  abdm_token_expires_at: string | null;
}

interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken?: string;
}

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
    // ── Auth ──────────────────────────────────────────────────────────────
    // No auth check at all previously. This function is purely internal —
    // "All other ABDM edge functions call this one instead of hitting the
    // sessions endpoint directly" (see this file's own header), always via
    // getAbdmToken() in _shared/abdm-auth.ts, which invokes it using the
    // CALLING function's service-role client. It is never invoked from
    // src/ (confirmed by grep). So any request naming a hospital_id
    // returned that hospital's live NHA gateway bearer token to whoever
    // asked — letting an outsider impersonate that hospital's HIP/HIU
    // registration directly against the government ABDM gateway. Found in
    // the Phase 4 isolation audit — see KNOWN_BUGS.md. Restricted to the
    // one caller that has ever legitimately called it: the service-role key.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const hospitalId: string | undefined = body.hospital_id;
    const forceRefresh: boolean = body.force_refresh === true;

    if (!hospitalId) {
      return json({ error: "hospital_id is required" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
    );

    // ── 1. Load hospital ABDM config ────────────────────────────────────────
    const { data: cfg, error: cfgErr } = await sb
      .from("hospital_abdm_config")
      .select(
        "id, hospital_id, abdm_client_id, abdm_client_secret, abdm_base_url, is_production, abdm_access_token, abdm_token_expires_at",
      )
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (cfgErr) return json({ error: cfgErr.message }, 500);
    if (!cfg) {
      return json({ error: "No ABDM configuration found for this hospital" }, 404);
    }

    const abdmCfg = cfg as AbdmConfig;

    // ── 2. Return cached token if still valid ────────────────────────────────
    if (!forceRefresh && abdmCfg.abdm_access_token && abdmCfg.abdm_token_expires_at) {
      const expiresMs = new Date(abdmCfg.abdm_token_expires_at).getTime();
      if (expiresMs - Date.now() > TOKEN_BUFFER_SECS * 1000) {
        return json({
          accessToken: abdmCfg.abdm_access_token,
          mode: abdmCfg.is_production ? "production" : "sandbox",
          cached: true,
        });
      }
    }

    // ── 3. Resolve credentials ───────────────────────────────────────────────
    // Env vars take priority (single-tenant / ops-managed secret).
    // Fall back to per-hospital DB values for multi-tenant deployments.
    const clientId =
      Deno.env.get("ABDM_CLIENT_ID") || abdmCfg.abdm_client_id || null;
    const clientSecret =
      Deno.env.get("ABDM_CLIENT_SECRET") || abdmCfg.abdm_client_secret || null;
    const abdmBaseUrl =
      abdmCfg.abdm_base_url || "https://dev.abdm.gov.in";
    const xCmId = abdmCfg.is_production ? "abdm" : "sbx";

    if (!clientId || !clientSecret) {
      return json({ accessToken: null, mode: "sandbox_format_only" });
    }

    // ── 4. Fetch token from NHA gateway (with one retry) ────────────────────
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }

      const requestId = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const endpoint = "/api/hiecm/gateway/v3/sessions";

      try {
        const tokenRes = await fetch(`${abdmBaseUrl}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "REQUEST-ID": requestId,
            "TIMESTAMP": timestamp,
            "X-CM-ID": xCmId,
          },
          body: JSON.stringify({
            clientId,
            clientSecret,
            grantType: "client_credentials",
          }),
        });

        const statusCode = tokenRes.status;
        // Redact secret from log payload
        const logPayload = {
          requestId,
          clientId: `${clientId.slice(0, 4)}***`,
          timestamp,
          attempt: attempt + 1,
        };

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          lastError = `NHA auth failed (${statusCode}): ${errText.slice(0, 300)}`;

          // Every abdm_gateway_logs insert in this file used column names that don't exist
          // on this table at all (request_id/endpoint/payload/status_code/error/response —
          // the real columns are action/direction/request_payload/response_payload/status),
          // plus `direction: "OUTBOUND"` against a CHECK constraint that only ever allowed
          // lowercase 'inbound'/'outbound'. Every log insert in this function has always
          // failed, silently (the error was never checked) — purely an audit-trail gap, since
          // the actual token fetch/cache logic below doesn't depend on these writes
          // succeeding. Found via Phase 6 edge-function testing.
          const { error: logErr } = await sb.from("abdm_gateway_logs").insert({
            hospital_id: hospitalId,
            action: "gateway_token",
            direction: "outbound",
            request_payload: { ...logPayload, endpoint },
            status: "error",
            response_payload: { status_code: statusCode, error: lastError },
          });
          if (logErr) console.error("abdm-gateway-token: gateway log insert failed:", logErr.message);

          continue; // retry
        }

        const tokenData = (await tokenRes.json()) as Partial<TokenResponse>;
        const accessToken = tokenData.accessToken;
        const expiresIn = tokenData.expiresIn ?? 600;

        if (!accessToken) {
          lastError = "NHA gateway returned no accessToken in response";
          continue;
        }

        // ── 5. Cache token in DB ─────────────────────────────────────────────
        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        const { error: cacheErr } = await sb
          .from("hospital_abdm_config")
          .update({
            abdm_access_token: accessToken,
            abdm_token_expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("hospital_id", hospitalId);
        if (cacheErr) console.error("abdm-gateway-token: token cache update failed:", cacheErr.message);

        // Log success (no token in payload)
        const { error: successLogErr } = await sb.from("abdm_gateway_logs").insert({
          hospital_id: hospitalId,
          action: "gateway_token",
          direction: "outbound",
          request_payload: { ...logPayload, endpoint },
          status: "ok",
          response_payload: { tokenType: tokenData.tokenType, expiresIn, expiresAt, status_code: statusCode },
        });
        if (successLogErr) console.error("abdm-gateway-token: gateway log insert failed:", successLogErr.message);

        return json({
          accessToken,
          expiresIn,
          mode: abdmCfg.is_production ? "production" : "sandbox",
          cached: false,
        });
      } catch (fetchErr) {
        lastError =
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(`abdm-gateway-token attempt ${attempt + 1} error:`, lastError);
      }
    }

    // Both attempts failed
    const { error: finalLogErr } = await sb.from("abdm_gateway_logs").insert({
      hospital_id: hospitalId,
      action: "gateway_token",
      direction: "outbound",
      request_payload: { endpoint: "/api/hiecm/gateway/v3/sessions" },
      status: "error",
      response_payload: { error: lastError },
    });
    if (finalLogErr) console.error("abdm-gateway-token: gateway log insert failed:", finalLogErr.message);

    return json(
      { error: lastError || "ABDM gateway unreachable", accessToken: null },
      502,
    );
  } catch (err) {
    console.error("abdm-gateway-token unhandled error:", err instanceof Error ? err.message : String(err));
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
