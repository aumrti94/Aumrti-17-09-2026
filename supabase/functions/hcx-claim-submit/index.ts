/**
 * hcx-claim-submit
 *
 * Builds a FHIR Claim (or CoverageEligibilityRequest for pre-auth),
 * wraps it in an HCX JWE envelope, and submits it to the NHCX gateway.
 *
 * Input:
 *   { hospital_id, bill_id, claim_type: "preauth" | "claim" }
 *
 * Modes:
 *   - Sandbox (hcx_participant_code not configured) → deterministic mock response
 *   - Staging (is_production = false, credentials set) → staging-hcx.swasth.app
 *   - Production (is_production = true) → live.nha.gov.in/hcx
 *
 * HCX protocol:
 *   - All payloads are FHIR R4 Bundles wrapped in JWE compact serialization
 *   - JWE: RSA-OAEP-256 (recipient pub key) + A256GCM content encryption
 *   - Auth: Keycloak OAuth2 client-credentials flow
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

// ─── Base64url helpers ────────────────────────────────────────────────────────

function b64uEnc(data: Uint8Array): string {
  let b64 = "";
  for (const b of data) b64 += String.fromCharCode(b);
  return btoa(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function strB64u(str: string): string {
  return b64uEnc(new TextEncoder().encode(str));
}

// ─── HCX auth ─────────────────────────────────────────────────────────────────

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

// ─── Participant public-key lookup ────────────────────────────────────────────

async function getParticipantPubKey(
  code: string,
  baseUrl: string,
  token: string,
): Promise<JsonWebKey | null> {
  try {
    const res = await fetch(`${baseUrl}/api/v0.7/participant/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filters: { participant_code: { eq: code } } }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { participants?: Record<string, unknown>[] };
    const p = data.participants?.[0];
    if (!p?.encryption_cert) return null;
    const jwks = typeof p.encryption_cert === "string" ? JSON.parse(p.encryption_cert) : p.encryption_cert;
    return (jwks.keys?.[0] ?? jwks) as JsonWebKey;
  } catch {
    return null;
  }
}

// ─── JWE builder ─────────────────────────────────────────────────────────────

async function buildHcxJwe(
  fhirBundle: Record<string, unknown>,
  hcxHeaders: Record<string, unknown>,
  recipientPubKeyJwk: JsonWebKey | null,
): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(fhirBundle));

  const protectedHeader: Record<string, unknown> = {
    alg: recipientPubKeyJwk ? "RSA-OAEP-256" : "dir",
    enc: "A256GCM",
    ...hcxHeaders,
  };
  const encodedHeader = strB64u(JSON.stringify(protectedHeader));

  // CEK
  const cek = crypto.getRandomValues(new Uint8Array(32));
  let encryptedKey: Uint8Array;
  if (recipientPubKeyJwk) {
    const pubKey = await crypto.subtle.importKey(
      "jwk",
      recipientPubKeyJwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
    const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, cek);
    encryptedKey = new Uint8Array(wrapped);
  } else {
    encryptedKey = new Uint8Array(0);
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const cipherResult = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(encodedHeader), tagLength: 128 },
    aesKey,
    plaintext,
  );

  const cipherBytes = new Uint8Array(cipherResult);
  return [
    encodedHeader,
    b64uEnc(encryptedKey),
    b64uEnc(iv),
    b64uEnc(cipherBytes.slice(0, -16)),
    b64uEnc(cipherBytes.slice(-16)),
  ].join(".");
}

// ─── FHIR resource helpers ────────────────────────────────────────────────────

function fhirMoney(amount: number) {
  return { value: Number(amount ?? 0), currency: "INR" };
}

function buildFhirClaim(params: {
  claimId: string;
  use: "predetermination" | "claim";
  patientAbha: string;
  hfrId: string;
  tpaCode: string;
  admitDate: string;
  dischargeDate: string;
  diagnoses: Array<{ icd10_code: string | null }>;
  items: Array<{ service_code?: string | null; description: string; unit_price: number; quantity: number; total: number; sequence: number }>;
  totalAmount: number;
}): Record<string, unknown> {
  return {
    resourceType: "Claim",
    id: params.claimId,
    status: "active",
    type: {
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/claim-type",
        code: "institutional",
      }],
    },
    use: params.use,
    patient: { reference: `Patient/${params.patientAbha}` },
    billablePeriod: {
      start: params.admitDate,
      end: params.dischargeDate,
    },
    created: new Date().toISOString(),
    insurer: {
      identifier: {
        system: "http://abdm.gov.in/nhcx/participant",
        value: params.tpaCode,
      },
    },
    provider: {
      identifier: {
        system: "http://abdm.gov.in/nhcx/participant",
        value: params.hfrId,
      },
    },
    priority: { coding: [{ code: "normal" }] },
    diagnosis: params.diagnoses
      .filter((d) => d.icd10_code)
      .map((d, i) => ({
        sequence: i + 1,
        diagnosisCodeableConcept: {
          coding: [{
            system: "http://hl7.org/fhir/sid/icd-10",
            code: d.icd10_code,
          }],
        },
      })),
    item: params.items.map((item) => ({
      sequence: item.sequence,
      productOrService: {
        coding: item.service_code
          ? [{ system: "http://abdm.gov.in/nhcx/service-code", code: item.service_code }]
          : [],
        text: item.description,
      },
      quantity: { value: item.quantity },
      unitPrice: fhirMoney(item.unit_price),
      net: fhirMoney(item.total),
    })),
    total: fhirMoney(params.totalAmount),
  };
}

// ─── Sandbox mock ─────────────────────────────────────────────────────────────

function sandboxClaimResponse(claimType: string, billId: string): Record<string, unknown> {
  const mockClaimId = `HCX-MOCK-${Date.now()}`;
  const correlationId = crypto.randomUUID();
  return {
    success: true,
    mode: "sandbox",
    claim_id: mockClaimId,
    correlation_id: correlationId,
    status: "submitted",
    message: `Sandbox HCX ${claimType === "preauth" ? "pre-determination" : "claim"} submitted for bill ${billId}. Configure HCX credentials in Settings → ABDM for live gateway.`,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { hospital_id, bill_id, claim_type } = await req.json() as {
      hospital_id?: string;
      bill_id?: string;
      claim_type?: "preauth" | "claim";
    };

    if (!hospital_id || !bill_id) return json({ error: "hospital_id and bill_id required" }, 400);
    if (claim_type !== "preauth" && claim_type !== "claim") return json({ error: "claim_type must be 'preauth' or 'claim'" }, 400);

    // ── Fetch HCX config ──────────────────────────────────────────────────────
    const { data: cfg } = await sb
      .from("hospital_abdm_config")
      .select("hcx_participant_code, hcx_client_id, hcx_client_secret, hcx_access_token, hcx_token_expires_at, hfr_id, is_production, feature_hcx_claims")
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    if (!cfg?.feature_hcx_claims) {
      return json({ error: "HCX claims not enabled for this hospital. Enable via Settings → ABDM." }, 400);
    }

    // ── Sandbox mode ──────────────────────────────────────────────────────────
    if (!cfg.hcx_participant_code || !cfg.hcx_client_id || !cfg.hcx_client_secret) {
      const mockRes = sandboxClaimResponse(claim_type, bill_id);
      // Still store a mock record for UI testing
      await sb.from("insurance_claims").upsert({
        hospital_id,
        bill_id,
        tpa_name: "HCX-Sandbox",
        claimed_amount: 0,
        status: "submitted",
        hcx_claim_id: mockRes.claim_id as string,
        hcx_correlation_id: mockRes.correlation_id as string,
        hcx_status: "submitted",
        hcx_submitted_at: new Date().toISOString(),
        hcx_response_json: mockRes,
      }, { onConflict: "bill_id" }).catch(() => {});
      return json(mockRes);
    }

    const hcxBaseUrl = cfg.is_production
      ? "https://live.nha.gov.in/hcx"
      : "https://staging-hcx.swasth.app";

    // ── Get / refresh HCX token ───────────────────────────────────────────────
    let token = cfg.hcx_access_token ?? "";
    if (!token || (cfg.hcx_token_expires_at && new Date(cfg.hcx_token_expires_at) <= new Date())) {
      const fresh = await getHcxToken(cfg.hcx_client_id, cfg.hcx_client_secret, cfg.is_production ?? false);
      if (!fresh) return json({ error: "Could not obtain HCX authentication token. Check credentials." }, 502);
      token = fresh;
      await sb.from("hospital_abdm_config").update({
        hcx_access_token: token,
        hcx_token_expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
      }).eq("hospital_id", hospital_id);
    }

    // ── Fetch bill data ───────────────────────────────────────────────────────
    const { data: bill, error: billErr } = await sb
      .from("bills")
      .select("id, bill_number, total_amount, admission_id, patient_id, insurance_amount, bill_date")
      .eq("id", bill_id)
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    if (billErr || !bill) return json({ error: "Bill not found" }, 404);

    // ── Fetch bill items ──────────────────────────────────────────────────────
    const { data: billItems } = await (sb as any)
      .from("bill_items")
      .select("service_code, description, unit_price, quantity, total")
      .eq("bill_id", bill_id);

    const items = (billItems ?? []).map((item: any, i: number) => ({
      service_code: item.service_code ?? null,
      description: item.description ?? "Service",
      unit_price: Number(item.unit_price ?? 0),
      quantity: Number(item.quantity ?? 1),
      total: Number(item.total ?? 0),
      sequence: i + 1,
    }));

    if (items.length === 0) {
      items.push({ service_code: null, description: "Hospital Services", unit_price: Number(bill.total_amount), quantity: 1, total: Number(bill.total_amount), sequence: 1 });
    }

    // ── Fetch admission + patient ─────────────────────────────────────────────
    let admitDate = bill.bill_date ?? new Date().toISOString().slice(0, 10);
    let dischargeDate = bill.bill_date ?? admitDate;
    let tpaCode = "PMJAY@HCX";
    let patientAbha = `PATIENT-${bill.patient_id}`;

    if (bill.admission_id) {
      const { data: adm } = await sb
        .from("admissions")
        .select("admitted_at, discharged_at, insurance_type, tpa_name")
        .eq("id", bill.admission_id)
        .maybeSingle();
      if (adm) {
        admitDate = adm.admitted_at?.slice(0, 10) ?? admitDate;
        dischargeDate = adm.discharged_at?.slice(0, 10) ?? dischargeDate;
        if (adm.tpa_name) tpaCode = adm.tpa_name;
        // Map known scheme names to HCX participant codes
        if (adm.insurance_type === "pmjay") tpaCode = cfg.is_production ? "PMJAY@HCX" : "PMJAY@HCX.SWASTH.DEV";
        else if (adm.insurance_type === "cghs") tpaCode = "CGHS@HCX";
        else if (adm.insurance_type === "esi") tpaCode = "ESIC@HCX";
      }
    }

    // Patient ABHA address
    const { data: abhaProfile } = await sb
      .from("patient_abha_profiles")
      .select("abha_address, abha_number")
      .eq("patient_id", bill.patient_id)
      .eq("hospital_id", hospital_id)
      .maybeSingle();
    if (abhaProfile?.abha_address) patientAbha = abhaProfile.abha_address;
    else if (abhaProfile?.abha_number) patientAbha = abhaProfile.abha_number;

    // ── Fetch diagnoses ───────────────────────────────────────────────────────
    let diagnoses: Array<{ icd10_code: string | null }> = [];
    if (bill.admission_id) {
      const { data: icdRows } = await (sb as any)
        .from("icd_codings")
        .select("icd_code")
        .eq("admission_id", bill.admission_id)
        .eq("hospital_id", hospital_id)
        .limit(10);
      diagnoses = (icdRows ?? []).map((r: any) => ({ icd10_code: r.icd_code }));
    }
    if (diagnoses.length === 0) diagnoses = [{ icd10_code: null }];

    // ── Build FHIR Claim ──────────────────────────────────────────────────────
    const claimId = crypto.randomUUID();
    const fhirClaim = buildFhirClaim({
      claimId,
      use: claim_type === "preauth" ? "predetermination" : "claim",
      patientAbha,
      hfrId: cfg.hfr_id ?? hospital_id,
      tpaCode,
      admitDate,
      dischargeDate,
      diagnoses,
      items,
      totalAmount: Number(bill.total_amount),
    });

    const fhirBundle: Record<string, unknown> = {
      resourceType: "Bundle",
      id: crypto.randomUUID(),
      type: "collection",
      timestamp: new Date().toISOString(),
      entry: [{ fullUrl: `urn:uuid:${claimId}`, resource: fhirClaim }],
    };

    // ── HCX envelope ──────────────────────────────────────────────────────────
    const apiCallId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const workflowId = crypto.randomUUID();

    const insurerPubKey = await getParticipantPubKey(tpaCode, hcxBaseUrl, token);

    const hcxHeaders: Record<string, unknown> = {
      "x-hcx-sender_code": cfg.hcx_participant_code,
      "x-hcx-recipient_code": tpaCode,
      "x-hcx-api_call_id": apiCallId,
      "x-hcx-correlation_id": correlationId,
      "x-hcx-workflow_id": workflowId,
      "x-hcx-timestamp": new Date().toISOString(),
      "x-hcx-status": "request.initiate",
    };

    const jwe = await buildHcxJwe(fhirBundle, hcxHeaders, insurerPubKey);

    // ── POST to NHCX ──────────────────────────────────────────────────────────
    const endpoint = claim_type === "preauth"
      ? "/api/v0.7/claim/predetermination"
      : "/api/v0.7/claim/submit";

    const gwRes = await fetch(`${hcxBaseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ payload: jwe }),
    });

    const gwStatus = gwRes.status;
    let gwBody: Record<string, unknown> = {};
    try { gwBody = await gwRes.json(); } catch { /* ignore */ }

    // ── Persist to insurance_claims ───────────────────────────────────────────
    const hcxStatus = gwRes.ok ? "submitted" : "error";

    // Look for existing claim record for this bill
    const { data: existingClaim } = await sb
      .from("insurance_claims")
      .select("id")
      .eq("hospital_id", hospital_id)
      .eq("bill_id", bill_id)
      .maybeSingle();

    if (existingClaim?.id) {
      await sb.from("insurance_claims").update({
        hcx_claim_id: apiCallId,
        hcx_correlation_id: correlationId,
        hcx_workflow_id: workflowId,
        hcx_status: hcxStatus,
        hcx_response_json: gwBody,
        hcx_submitted_at: new Date().toISOString(),
        status: gwRes.ok ? "submitted" : "rejected",
      }).eq("id", existingClaim.id);
    } else {
      await sb.from("insurance_claims").insert({
        hospital_id,
        bill_id,
        patient_id: bill.patient_id,
        tpa_name: tpaCode,
        claimed_amount: Number(bill.total_amount),
        status: gwRes.ok ? "submitted" : "rejected",
        hcx_claim_id: apiCallId,
        hcx_correlation_id: correlationId,
        hcx_workflow_id: workflowId,
        hcx_status: hcxStatus,
        hcx_response_json: gwBody,
        hcx_submitted_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
      });
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    await sb.from("hcx_submissions").insert({
      hospital_id,
      api_call_id: apiCallId,
      correlation_id: correlationId,
      workflow_id: workflowId,
      action: endpoint.replace("/api/v0.7/", ""),
      direction: "outbound",
      request_fhir: fhirBundle,
      response_payload: gwBody,
      hcx_status: hcxStatus,
    }).catch(() => {});

    if (!gwRes.ok) {
      return json({
        success: false,
        error: `HCX gateway returned ${gwStatus}`,
        gateway_response: gwBody,
      }, 502);
    }

    return json({
      success: true,
      mode: cfg.is_production ? "production" : "staging",
      claim_id: apiCallId,
      correlation_id: correlationId,
      workflow_id: workflowId,
      status: "submitted",
      message: `HCX ${claim_type === "preauth" ? "pre-determination" : "claim"} submitted successfully. Track via correlation_id.`,
    });

  } catch (err: unknown) {
    console.error("hcx-claim-submit error:", err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
