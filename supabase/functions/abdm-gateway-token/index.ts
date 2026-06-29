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
    const body = await req.json();
    const hospitalId: string | undefined = body.hospital_id;
    const forceRefresh: boolean = body.force_refresh === true;

    if (!hospitalId) {
      return json({ error: "hospital_id is required" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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

          await sb.from("abdm_gateway_logs").insert({
            hospital_id: hospitalId,
            request_id: requestId,
            direction: "OUTBOUND",
            endpoint,
            payload: logPayload,
            status_code: statusCode,
            error: lastError,
          });

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

        await sb
          .from("hospital_abdm_config")
          .update({
            abdm_access_token: accessToken,
            abdm_token_expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("hospital_id", hospitalId);

        // Log success (no token in payload)
        await sb.from("abdm_gateway_logs").insert({
          hospital_id: hospitalId,
          request_id: requestId,
          direction: "OUTBOUND",
          endpoint,
          payload: logPayload,
          response: {
            tokenType: tokenData.tokenType,
            expiresIn,
            expiresAt,
          },
          status_code: statusCode,
        });

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
    await sb.from("abdm_gateway_logs").insert({
      hospital_id: hospitalId,
      direction: "OUTBOUND",
      endpoint: "/api/hiecm/gateway/v3/sessions",
      error: lastError,
      status_code: 0,
    });

    return json(
      { error: lastError || "ABDM gateway unreachable", accessToken: null },
      502,
    );
  } catch (err) {
    console.error("abdm-gateway-token unhandled error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
