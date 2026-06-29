/**
 * abdm-abha-verify — Verify whether an ABHA number/address exists in the NHA registry.
 *
 * Updated to use _shared/abdm-auth.ts helpers when hospital_id is provided.
 * Original interface preserved for backward compatibility.
 *
 * Accepts:
 *   { abha_number, hospital_id? }        → verify a specific ABHA
 *   { mode: "ping", hospital_id? }       → test gateway connectivity only
 *
 * NHA endpoint: POST /v1/search/existsByHealthId
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
    const body = await req.json() as {
      abha_number?: string;
      mode?: string;
      hospital_id?: string;
    };

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // ── Resolve token ────────────────────────────────────────────────────────
    // Path A: hospital_id provided → use shared token manager (preferred)
    // Path B: no hospital_id → use global env creds for backward compatibility
    let token: string | null = null;
    let isProduction = false;
    let abdmBaseUrl = Deno.env.get("ABDM_BASE_URL") || "https://dev.abdm.gov.in";

    if (body.hospital_id && SUPABASE_URL && SERVICE_KEY) {
      const sb = createClient(SUPABASE_URL, SERVICE_KEY);

      const { data: cfg } = await sb
        .from("hospital_abdm_config")
        .select("abdm_base_url, is_production")
        .eq("hospital_id", body.hospital_id)
        .maybeSingle();

      if (cfg) {
        abdmBaseUrl = (cfg as { abdm_base_url: string; is_production: boolean }).abdm_base_url
          || abdmBaseUrl;
        isProduction = (cfg as { abdm_base_url: string; is_production: boolean }).is_production
          ?? false;
      }

      token = await getAbdmToken(body.hospital_id, sb);
    } else {
      // Backward-compatible env-credentials path (upgraded to V3 sessions)
      const clientId = Deno.env.get("ABDM_CLIENT_ID");
      const clientSecret = Deno.env.get("ABDM_CLIENT_SECRET");

      if (clientId && clientSecret) {
        try {
          const tokenRes = await fetch(
            `${abdmBaseUrl}/api/hiecm/gateway/v3/sessions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "REQUEST-ID": crypto.randomUUID(),
                "TIMESTAMP": new Date().toISOString(),
                "X-CM-ID": "sbx",
              },
              body: JSON.stringify({
                clientId,
                clientSecret,
                grantType: "client_credentials",
              }),
            },
          );
          const tokenData = await tokenRes.json();
          token = tokenData.accessToken ?? null;
        } catch {
          token = null;
        }
      }
    }

    // ── Ping / connection test mode ──────────────────────────────────────────
    if (body.mode === "ping") {
      if (!token) {
        return json({ status: "sandbox", mode: "sandbox_format_only", connected: false });
      }
      // A successful token fetch means gateway is reachable
      return json({ status: "connected", mode: isProduction ? "production" : "sandbox", connected: true });
    }

    // ── ABHA verification ────────────────────────────────────────────────────
    const abhaNumber = body.abha_number;
    if (!abhaNumber) {
      return json({ verified: false, error: "abha_number is required" }, 400);
    }

    // Format check (both paths)
    const normalised = String(abhaNumber).replace(/-/g, "");
    const isValidFormat = /^\d{14}$/.test(normalised) || /.+@.+/.test(String(abhaNumber));

    if (!token) {
      // Sandbox format-only mode — no credentials configured
      return json({
        verified: isValidFormat,
        mode: "sandbox_format_only",
        message: isValidFormat
          ? "ABHA format valid (sandbox mode — live verification requires ABDM credentials)"
          : "Invalid ABHA format — must be 14 digits or user@abdm address",
      });
    }

    // Live lookup
    const verifyRes = await fetch(`${abdmBaseUrl}/v1/search/existsByHealthId`, {
      method: "POST",
      headers: abdmHeaders(token, isProduction),
      body: JSON.stringify({ healthId: abhaNumber }),
    });
    const verifyData = await verifyRes.json().catch(() => ({})) as Record<string, unknown>;

    return json({
      verified: verifyData.status === true,
      mode: isProduction ? "live_production" : "live",
      abha_number: abhaNumber,
    });
  } catch (error) {
    console.error("abdm-abha-verify error:", error);
    return json({ verified: false, error: "Verification service unavailable" }, 500);
  }
});
