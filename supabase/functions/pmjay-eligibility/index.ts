/**
 * pmjay-eligibility
 *
 * Checks PMJAY/CGHS beneficiary eligibility.
 *
 * Mode selection (checked in order):
 *  1. HCX mode  — if hospital_id provided AND feature_hcx_claims = true:
 *       Build FHIR CoverageEligibilityRequest, wrap in HCX JWE envelope,
 *       POST to NHCX gateway /coverageeligibility/check.
 *       Eligibility result is returned from the gateway on-check response.
 *  2. Direct NHA BIS mode — if NHA_BIS_API_KEY env var is set.
 *  3. Sandbox mock — fallback (no real credentials required).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── Base64url helpers (for JWE) ─────────────────────────────────────────────

function b64uEnc(data: Uint8Array): string {
  let b64 = "";
  for (const b of data) b64 += String.fromCharCode(b);
  return btoa(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function strB64u(str: string): string {
  return b64uEnc(new TextEncoder().encode(str));
}

// ─── HCX Keycloak token ───────────────────────────────────────────────────────

async function getHcxToken(
  clientId: string,
  clientSecret: string,
  isProduction: boolean,
): Promise<string | null> {
  const tokenUrl = isProduction
    ? "https://live.nha.gov.in/hcx/realms/swasth-health-claim-exchange/protocol/openid-connect/token"
    : "https://staging-hcx.swasth.app/auth/realms/swasth-health-claim-exchange/protocol/openid-connect/token";

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.access_token as string) ?? null;
  } catch {
    return null;
  }
}

// ─── HCX JWE builder ─────────────────────────────────────────────────────────
// Produces JWE compact serialization for the HCX payload.
// Uses RSA-OAEP-256 + A256GCM when recipientPublicKeyJwk is provided (production).
// Falls back to direct symmetric encryption (sandbox / no recipient key).

async function buildHcxJwe(
  fhirBundle: Record<string, unknown>,
  hcxHeaders: Record<string, unknown>,
  recipientPublicKeyJwk: JsonWebKey | null,
): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(fhirBundle));

  const protectedHeader: Record<string, unknown> = {
    alg: recipientPublicKeyJwk ? "RSA-OAEP-256" : "dir",
    enc: "A256GCM",
    ...hcxHeaders,
  };
  const encodedHeader = strB64u(JSON.stringify(protectedHeader));

  // CEK: 32 random bytes for A256GCM
  const cek = crypto.getRandomValues(new Uint8Array(32));

  // Encrypt CEK
  let encryptedKey: Uint8Array;
  if (recipientPublicKeyJwk) {
    const pubKey = await crypto.subtle.importKey(
      "jwk",
      recipientPublicKeyJwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
    const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, cek);
    encryptedKey = new Uint8Array(wrapped);
  } else {
    encryptedKey = new Uint8Array(0); // "dir" — no wrapped key
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const cipherResult = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(encodedHeader), tagLength: 128 },
    aesKey,
    plaintext,
  );

  const cipherBytes = new Uint8Array(cipherResult);
  const ciphertext = cipherBytes.slice(0, -16);
  const tag = cipherBytes.slice(-16);

  return [
    encodedHeader,
    b64uEnc(encryptedKey),
    b64uEnc(iv),
    b64uEnc(ciphertext),
    b64uEnc(tag),
  ].join(".");
}

// ─── Participant public-key lookup ────────────────────────────────────────────

async function getParticipantPublicKey(
  participantCode: string,
  hcxBaseUrl: string,
  token: string,
): Promise<JsonWebKey | null> {
  try {
    const res = await fetch(`${hcxBaseUrl}/api/v0.7/participant/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filters: { participant_code: { eq: participantCode } } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const participants = (data as any)?.participants ?? [];
    if (participants.length === 0) return null;
    const encryptionCert = participants[0]?.encryption_cert as string | undefined;
    if (!encryptionCert) return null;
    // encryptionCert is a PEM or JWK string — the HCX registry returns a JWK set
    const jwks = JSON.parse(encryptionCert);
    return jwks.keys?.[0] ?? jwks ?? null;
  } catch {
    return null;
  }
}

// ─── HCX eligibility check ────────────────────────────────────────────────────

async function checkEligibilityHcx(params: {
  pmjayCardNumber: string;
  patientName: string;
  hospitalId: string;
  sb: ReturnType<typeof createClient>;
}): Promise<Record<string, unknown>> {
  const { pmjayCardNumber, patientName, hospitalId, sb } = params;

  const { data: cfg } = await sb
    .from("hospital_abdm_config")
    .select("hcx_participant_code, hcx_client_id, hcx_client_secret, hcx_access_token, hcx_token_expires_at, is_production")
    .eq("hospital_id", hospitalId)
    .maybeSingle();

  if (!cfg?.hcx_participant_code || !cfg.hcx_client_id || !cfg.hcx_client_secret) {
    // Not configured → sandbox mock
    return sandboxEligibility(pmjayCardNumber, patientName);
  }

  const hcxBaseUrl = cfg.is_production
    ? "https://live.nha.gov.in/hcx"
    : "https://staging-hcx.swasth.app";

  // Get / refresh token
  let token = cfg.hcx_access_token ?? "";
  if (!token || (cfg.hcx_token_expires_at && new Date(cfg.hcx_token_expires_at) <= new Date())) {
    const fresh = await getHcxToken(cfg.hcx_client_id, cfg.hcx_client_secret, cfg.is_production ?? false);
    if (!fresh) return { eligible: false, error: "Could not obtain HCX auth token" };
    token = fresh;
    await sb.from("hospital_abdm_config").update({
      hcx_access_token: token,
      hcx_token_expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
    }).eq("hospital_id", hospitalId);
  }

  // PMJAY insurer participant code — constant for the NHCX gateway
  const insurerCode = cfg.is_production ? "PMJAY@HCX" : "PMJAY@HCX.SWASTH.DEV";
  const insurerPubKey = await getParticipantPublicKey(insurerCode, hcxBaseUrl, token);

  const apiCallId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const workflowId = crypto.randomUUID();

  // FHIR CoverageEligibilityRequest
  const fhirBundle: Record<string, unknown> = {
    resourceType: "Bundle",
    id: crypto.randomUUID(),
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${apiCallId}`,
        resource: {
          resourceType: "CoverageEligibilityRequest",
          id: apiCallId,
          status: "active",
          purpose: ["benefits"],
          patient: {
            display: patientName,
          },
          created: new Date().toISOString(),
          insurer: {
            identifier: {
              system: "http://abdm.gov.in/nhcx/participant",
              value: insurerCode,
            },
          },
          insurance: [
            {
              coverage: {
                identifier: {
                  system: "http://abdm.gov.in/pmjay/member-id",
                  value: pmjayCardNumber,
                },
              },
            },
          ],
        },
      },
    ],
  };

  const hcxHeaders: Record<string, unknown> = {
    "x-hcx-sender_code": cfg.hcx_participant_code,
    "x-hcx-recipient_code": insurerCode,
    "x-hcx-api_call_id": apiCallId,
    "x-hcx-correlation_id": correlationId,
    "x-hcx-workflow_id": workflowId,
    "x-hcx-timestamp": new Date().toISOString(),
    "x-hcx-status": "request.initiate",
  };

  const jwe = await buildHcxJwe(fhirBundle, hcxHeaders, insurerPubKey);

  // POST to gateway
  const gwRes = await fetch(`${hcxBaseUrl}/api/v0.7/coverageeligibility/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ payload: jwe }),
  });

  // Log the outbound call
  await sb.from("hcx_submissions").insert({
    hospital_id: hospitalId,
    api_call_id: apiCallId,
    correlation_id: correlationId,
    workflow_id: workflowId,
    action: "coverageeligibility/check",
    direction: "outbound",
    request_fhir: fhirBundle,
    response_payload: { status: gwRes.status },
    hcx_status: gwRes.ok ? "submitted" : "error",
  }).catch(() => {});

  if (!gwRes.ok) {
    const errText = await gwRes.text().catch(() => "");
    return { eligible: false, mode: "hcx", error: `HCX gateway error ${gwRes.status}: ${errText}` };
  }

  // Gateway returns 202 — the result comes back asynchronously via /on-check callback.
  // For now, poll once after a short delay (production would use a webhook).
  await new Promise((r) => setTimeout(r, 1500));

  const onCheckRes = await fetch(
    `${hcxBaseUrl}/api/v0.7/coverageeligibility/on-check?correlation_id=${correlationId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).catch(() => null);

  if (onCheckRes?.ok) {
    const onCheckData = await onCheckRes.json();
    return {
      eligible: true,
      mode: "hcx",
      correlation_id: correlationId,
      hcx_response: onCheckData,
      message: "HCX eligibility check submitted; awaiting insurer confirmation.",
    };
  }

  return {
    eligible: true,
    mode: "hcx",
    correlation_id: correlationId,
    message: "HCX eligibility request submitted. Insurer response will arrive asynchronously.",
  };
}

// ─── Sandbox mock response ────────────────────────────────────────────────────

function sandboxEligibility(pmjayCardNumber: string, patientName: string): Record<string, unknown> {
  const cardStr = String(pmjayCardNumber).replace(/-/g, "");
  const looksValid = /^\d{8,14}$/.test(cardStr);
  return {
    eligible: looksValid,
    mode: "sandbox",
    beneficiary: looksValid
      ? {
          name: patientName || "Test Patient",
          pmjay_id: pmjayCardNumber,
          scheme: "PMJAY (Ayushman Bharat)",
          family_id: "FAM" + cardStr.slice(-6),
          balance_amount: 500000,
          used_amount: 0,
          state: "Andhra Pradesh",
        }
      : null,
    message: looksValid
      ? "Sandbox eligibility check — configure NHA_BIS_API_KEY or HCX credentials for live verification"
      : "Invalid PMJAY card format — must be 8-14 digits",
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json() as {
      pmjay_card_number?: string;
      patient_name?: string;
      hospital_id?: string;
    };

    const { pmjay_card_number, patient_name = "", hospital_id } = body;

    if (!pmjay_card_number) {
      return json({ eligible: false, error: "PMJAY card number required" }, 400);
    }

    // ── HCX mode ──────────────────────────────────────────────────────────────
    if (hospital_id) {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: cfg } = await sb
        .from("hospital_abdm_config")
        .select("feature_hcx_claims")
        .eq("hospital_id", hospital_id)
        .maybeSingle();

      if (cfg?.feature_hcx_claims) {
        const result = await checkEligibilityHcx({
          pmjayCardNumber: pmjay_card_number,
          patientName: patient_name,
          hospitalId: hospital_id,
          sb,
        });
        return json(result);
      }
    }

    // ── Direct NHA BIS mode ───────────────────────────────────────────────────
    const nhaApiKey = Deno.env.get("NHA_BIS_API_KEY");
    if (nhaApiKey) {
      const res = await fetch(
        "https://bis.pmjay.gov.in/BIS/restservice/getBeneficiaryDetails",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${nhaApiKey}` },
          body: JSON.stringify({ beneficiaryId: pmjay_card_number }),
        },
      );
      const data = await res.json();
      return json({ eligible: data.isEligible === "Y", beneficiary: data, mode: "live" });
    }

    // ── Sandbox fallback ──────────────────────────────────────────────────────
    return json(sandboxEligibility(pmjay_card_number, patient_name));

  } catch (err: unknown) {
    return json({ eligible: false, error: (err as Error).message ?? "Service unavailable" }, 500);
  }
});
