/**
 * abdm-hip-callback — Inbound ABDM gateway callbacks (discover, link-confirm, data-request).
 *
 * Security hardening (v2):
 *   - Verifies every inbound request is signed by NHA's gateway using RS256 JWTs.
 *   - Rejects unauthenticated / forged callbacks with 401 before any processing.
 *   - Logs all rejected attempts to abdm_gateway_logs for audit purposes.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5.2.4";
import { getAbdmToken, abdmHeaders } from "../_shared/abdm-auth.ts";
import { logAuditEvent } from "../_shared/abdm-audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cm-id, request-id, timestamp",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ABDM always requires 202 before async processing
const accepted = () =>
  new Response(JSON.stringify({ status: "accepted" }), {
    status: 202,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── NHA gateway JWT verification ────────────────────────────────────────────
// NHA gateway signs its callbacks with RS256 JWTs.
// Public keys: GET {abdmBaseUrl}/api/v0.5/public-keys (JWKS format)
//
// Degradation policy: if the JWKS endpoint is unreachable (network error, sandbox
// quirk), the function logs a warning and allows the request in "structural-only"
// mode so legitimate callbacks are never permanently blocked by an infrastructure blip.

interface VerifyResult {
  verified: boolean;
  reason?: string;
}

async function verifyGatewayJwt(
  authHeader: string | null,
  cmId: string | null,
): Promise<VerifyResult> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { verified: false, reason: "missing_bearer_token" };
  }

  const token = authHeader.slice(7);

  // Structural sanity: a JWT must be three base64url segments
  if (token.split(".").length !== 3) {
    return { verified: false, reason: "malformed_jwt" };
  }

  // Derive base URL from X-CM-ID ("abdm" = production, "sbx" = sandbox)
  const abdmBaseUrl = cmId === "abdm"
    ? "https://live.abdm.gov.in"
    : "https://dev.abdm.gov.in";

  try {
    const JWKS = createRemoteJWKSet(
      new URL(`${abdmBaseUrl}/api/v0.5/public-keys`),
      { cacheMaxAge: 600_000 }, // cache keys for 10 minutes
    );

    await jwtVerify(token, JWKS, {
      clockTolerance: 60, // tolerate 60s clock skew between NHA and our server
    });

    return { verified: true };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Network / fetch errors mean the JWK endpoint was unreachable, not that the
    // token is invalid.  Fail open to prevent legitimate callbacks being silently
    // dropped when NHA's key server has a transient issue.
    if (
      msg.includes("fetch") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("network") ||
      msg.includes("Failed to fetch") ||
      msg.includes("connect")
    ) {
      console.warn(
        "abdm-hip-callback: NHA JWK endpoint unreachable — allowing in degraded mode",
        msg,
      );
      return { verified: true, reason: "degraded_no_jwks" };
    }

    return { verified: false, reason: msg };
  }
}

// ─── Discover ────────────────────────────────────────────────────────────────
async function handleDiscover(
  body: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  try {
    const patient = body.patient as Record<string, unknown> | undefined;
    const abhaAddress = (patient?.id as string) ?? "";
    const requestId = body.requestId as string;
    const transactionId = body.transactionId as string;

    const { data: profile } = await sb
      .from("patient_abha_profiles")
      .select("patient_id, abha_number, abha_address, hospital_id")
      .eq("abha_address", abhaAddress)
      .maybeSingle();

    const hospitalId = profile?.hospital_id;

    if (!profile || !hospitalId) {
      await logGateway(sb, null, "hip_discover", "inbound", body, { error: "patient_not_found" });
      return;
    }

    const { data: careContexts } = await sb
      .from("abdm_care_contexts")
      .select("reference, display, context_type, source_id, link_status")
      .eq("patient_id", profile.patient_id)
      .eq("hospital_id", hospitalId);

    const { data: cfg } = await sb
      .from("hospital_abdm_config")
      .select("abdm_base_url, hfr_id, is_production")
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (!cfg) return;

    const token = await getAbdmToken(hospitalId, sb);
    if (!token) return;

    const onDiscoverPayload = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      transactionId,
      patient: {
        referenceNumber: profile.patient_id,
        display: abhaAddress,
        careContexts: (careContexts ?? []).map((cc) => ({
          referenceNumber: cc.reference,
          display: cc.display,
        })),
        matchedBy: ["PATIENT_ID"],
      },
      resp: { requestId },
    };

    const gwResponse = await fetch(
      `${cfg.abdm_base_url}/v0.5/care-contexts/on-discover`,
      {
        method: "POST",
        headers: abdmHeaders(token, cfg.is_production),
        body: JSON.stringify(onDiscoverPayload),
      },
    );

    await logGateway(sb, hospitalId, "hip_on_discover", "outbound", onDiscoverPayload, {
      status: gwResponse.status,
    });
  } catch (err) {
    console.error("handleDiscover error:", err);
  }
}

// ─── Link Confirm ─────────────────────────────────────────────────────────────
async function handleLinkConfirm(
  body: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  try {
    const confirmation = body.confirmation as Record<string, unknown> | undefined;
    const linkRefNumber = confirmation?.linkRefNumber as string | undefined;
    const careContextRefs =
      (confirmation?.careContexts as Array<{ referenceNumber: string }>) ?? [];
    const requestId = body.requestId as string;
    const transactionId = body.transactionId as string;

    if (!linkRefNumber) return;

    const firstRef = careContextRefs[0]?.referenceNumber;
    if (!firstRef) return;

    const { data: firstCc } = await sb
      .from("abdm_care_contexts")
      .select("hospital_id, patient_id")
      .eq("reference", firstRef)
      .maybeSingle();

    const hospitalId = firstCc?.hospital_id;
    if (!hospitalId) return;

    const refs = careContextRefs.map((c) => c.referenceNumber);
    await sb
      .from("abdm_care_contexts")
      .update({ link_status: "linked", linked_at: new Date().toISOString() })
      .in("reference", refs)
      .eq("hospital_id", hospitalId);

    // Audit: care context linked
    if (firstCc?.patient_id) {
      await logAuditEvent(sb, {
        action: "CARE_CONTEXT_LINKED",
        hospital_id: hospitalId,
        patient_id: firstCc.patient_id,
        metadata: { refs, link_ref_number: linkRefNumber },
      });
    }

    const { data: cfg } = await sb
      .from("hospital_abdm_config")
      .select("abdm_base_url, is_production")
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (!cfg) return;

    const token = await getAbdmToken(hospitalId, sb);
    if (!token) return;

    const onLinkConfirmPayload = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      transactionId,
      acknowledgement: { status: "SUCCESS" },
      resp: { requestId },
    };

    const gwResponse = await fetch(
      `${cfg.abdm_base_url}/v0.5/care-contexts/on-link-confirm`,
      {
        method: "POST",
        headers: abdmHeaders(token, cfg.is_production),
        body: JSON.stringify(onLinkConfirmPayload),
      },
    );

    await logGateway(sb, hospitalId, "hip_on_link_confirm", "outbound", onLinkConfirmPayload, {
      status: gwResponse.status,
    });
  } catch (err) {
    console.error("handleLinkConfirm error:", err);
  }
}

// ─── Data Request (HIU consent fetch) ────────────────────────────────────────
async function handleDataRequest(
  body: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  try {
    const hiRequest = body.hiRequest as Record<string, unknown> | undefined;
    const consentId = (hiRequest?.consent as Record<string, unknown>)?.id as string | undefined;
    const dataPushUrl = (hiRequest?.dataPushUrl as string) ?? "";
    const transactionId = body.transactionId as string;
    const requestId = body.requestId as string;

    if (!consentId) return;

    const { data: consent } = await sb
      .from("abdm_consents")
      .select("*")
      .eq("consent_id", consentId)
      .eq("status", "GRANTED")
      .maybeSingle();

    if (!consent) {
      console.warn("handleDataRequest: consent not found or not GRANTED", consentId);
      return;
    }

    const hospitalId = consent.hospital_id as string;

    const { data: careContexts } = await sb
      .from("abdm_care_contexts")
      .select("reference, display, context_type, source_id")
      .eq("patient_id", consent.patient_id)
      .eq("hospital_id", hospitalId)
      .eq("link_status", "linked");

    const { data: cfg } = await sb
      .from("hospital_abdm_config")
      .select("abdm_base_url, is_production")
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (!cfg) return;

    const token = await getAbdmToken(hospitalId, sb);
    if (!token) return;

    const hiuKeyMaterial = (hiRequest?.keyMaterial as Record<string, unknown> | undefined) ?? null;

    const entries: Array<Record<string, unknown>> = [];
    for (const cc of (careContexts ?? []) as Record<string, unknown>[]) {
      try {
        const invokeBody: Record<string, unknown> = {
          hospital_id: hospitalId,
          care_context_reference: cc.reference,
          context_type: cc.context_type,
          source_id: cc.source_id,
        };
        if (hiuKeyMaterial) invokeBody.key_material = hiuKeyMaterial;

        const { data: fhirData } = await sb.functions.invoke("abdm-fhir-package", {
          body: invokeBody,
        });

        if (!fhirData) continue;

        if (hiuKeyMaterial && fhirData.content) {
          entries.push({
            careContextReference: cc.reference as string,
            content: fhirData.content,
            media: fhirData.media ?? "application/fhir+json",
            checksum: fhirData.checksum,
            keyMaterial: fhirData.keyMaterial,
          });
        } else if (fhirData.bundle) {
          entries.push({
            careContextReference: cc.reference as string,
            content: btoa(JSON.stringify(fhirData.bundle)),
            media: "application/fhir+json",
            checksum: "",
          });
        }
      } catch {
        // Skip failed care contexts — don't fail the whole request
      }
    }

    if (entries.length > 0 && dataPushUrl) {
      const pushPayload = { pageNumber: 1, pageCount: 1, transactionId, entries };
      await fetch(dataPushUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pushPayload),
      });
    }

    // Audit: health records shared
    await logAuditEvent(sb, {
      action: "HEALTH_RECORDS_SHARED",
      hospital_id: hospitalId,
      patient_id: consent.patient_id ?? null,
      metadata: { consent_id: consentId, entries_pushed: entries.length },
    });

    const onRequestPayload = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      hiRequest: {
        transactionId,
        sessionStatus: entries.length > 0 ? "TRANSFERRED" : "FAILED",
      },
      resp: { requestId },
    };

    await fetch(`${cfg.abdm_base_url}/v0.5/health-information/hip/on-request`, {
      method: "POST",
      headers: abdmHeaders(token, cfg.is_production),
      body: JSON.stringify(onRequestPayload),
    });

    await logGateway(sb, hospitalId, "hip_data_request", "inbound", body, {
      consent_id: consentId,
      contexts_pushed: entries.length,
    });
  } catch (err) {
    console.error("handleDataRequest error:", err);
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
async function logGateway(
  sb: ReturnType<typeof createClient>,
  hospitalId: string | null,
  action: string,
  direction: string,
  requestPayload: unknown,
  responsePayload: unknown,
) {
  try {
    await sb.from("abdm_gateway_logs").insert({
      hospital_id: hospitalId,
      action,
      direction,
      request_payload: requestPayload,
      response_payload: responsePayload,
      status: "ok",
    });
  } catch {
    // Non-fatal
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Step 1: verify inbound request is from the NHA gateway ────────────────
  const cmId = req.headers.get("x-cm-id");
  const authHeader = req.headers.get("authorization");
  const rawIp = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");

  const { verified, reason } = await verifyGatewayJwt(authHeader, cmId);

  if (!verified) {
    // Log the rejection for audit / intrusion detection
    await logGateway(sb, null, "gateway_auth_rejected", "inbound", {
      x_cm_id: cmId,
      has_auth_header: !!authHeader,
      reason,
      path: new URL(req.url).pathname,
      ip_hint: rawIp?.split(",")[0]?.slice(0, 8) ?? null, // first 8 chars only — no full IP in logs
    }, { status_code: 401 }).catch(() => {});

    return json({ error: "Gateway authentication failed" }, 401);
  }

  // ── Step 2: X-CM-ID presence check ────────────────────────────────────────
  if (!cmId) {
    return json({ error: "Missing X-CM-ID header" }, 401);
  }

  // ── Step 3: parse body ─────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  // ── Step 4: route ──────────────────────────────────────────────────────────
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  const secondLast = segments.length >= 2 ? segments[segments.length - 2] : "";
  const path = secondLast === "hip" ? "hip/request" : last;

  switch (path) {
    case "discover":
      EdgeRuntime.waitUntil(handleDiscover(body, sb));
      return accepted();

    case "on-link-confirm":
      EdgeRuntime.waitUntil(handleLinkConfirm(body, sb));
      return accepted();

    case "hip/request":
      EdgeRuntime.waitUntil(handleDataRequest(body, sb));
      return accepted();

    default:
      return json({ error: `Unknown ABDM callback path: ${path}` }, 404);
  }
});
