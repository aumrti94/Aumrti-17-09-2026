/**
 * pmjay-claim-submit
 *
 * Submits a PMJAY (Pradhan Mantri Jan Arogya Yojana) claim via the
 * NHA HCX gateway using the PMJAY-specific FHIR profile.
 *
 * Key differences from commercial TPA claims:
 *   - Insurer code: "PMJAY" / "NHA"
 *   - Package code replaces itemized billing (HBP-XXXXX-XXXXX)
 *   - Beneficiary ID (PMJAY ID / BIS ID) required
 *   - Pre-auth reference is mandatory for IPD claims
 *   - Claim type is always "institutional"
 *
 * Input:
 *   { hospital_id, admission_id, package_code, beneficiary_id,
 *     pre_auth_reference, claim_type: "preauth" | "claim" }
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

function b64uEnc(data: Uint8Array): string {
  let b64 = "";
  for (const b of data) b64 += String.fromCharCode(b);
  return btoa(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function strB64u(str: string): string {
  return b64uEnc(new TextEncoder().encode(str));
}

async function getHcxToken(clientId: string, clientSecret: string, isProduction: boolean): Promise<string | null> {
  const tokenUrl = isProduction
    ? "https://live.nha.gov.in/hcx/realms/swasth-health-claim-exchange/protocol/openid-connect/token"
    : "https://staging-hcx.swasth.app/auth/realms/swasth-health-claim-exchange/protocol/openid-connect/token";
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as any).access_token ?? null;
  } catch { return null; }
}

function buildPmjayClaimBundle(params: {
  claimId:           string;
  use:               "predetermination" | "claim";
  beneficiaryId:     string;
  hfrId:             string;
  packageCode:       string;
  packageName:       string;
  packageAmount:     number;
  admitDate:         string;
  dischargeDate:     string;
  icd10Codes:        string[];
  preAuthReference?: string;
}): Record<string, unknown> {
  const claim: Record<string, unknown> = {
    resourceType: "Claim",
    id:           params.claimId,
    status:       "active",
    type: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/claim-type", code: "institutional" }],
    },
    use:     params.use,
    patient: { identifier: { system: "https://pmjay.gov.in/beneficiary", value: params.beneficiaryId } },
    billablePeriod: { start: params.admitDate, end: params.dischargeDate },
    created:  new Date().toISOString(),
    insurer: {
      identifier: { system: "http://abdm.gov.in/nhcx/participant", value: "PMJAY" },
      display: "Pradhan Mantri Jan Arogya Yojana",
    },
    provider: {
      identifier: { system: "http://abdm.gov.in/nhcx/participant", value: params.hfrId },
    },
    priority: { coding: [{ code: "normal" }] },
    diagnosis: params.icd10Codes.map((code, i) => ({
      sequence: i + 1,
      diagnosisCodeableConcept: {
        coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code }],
      },
      type: [{ coding: [{ code: i === 0 ? "principal" : "admitting" }] }],
    })),
    // PMJAY uses package-based billing — single line item with the package code
    item: [{
      sequence: 1,
      productOrService: {
        coding: [{
          system: "https://pmjay.gov.in/package-code",
          code:   params.packageCode,
          display: params.packageName,
        }],
      },
      servicedPeriod: { start: params.admitDate, end: params.dischargeDate },
      unitPrice:  { value: params.packageAmount, currency: "INR" },
      net:        { value: params.packageAmount, currency: "INR" },
    }],
    total: { value: params.packageAmount, currency: "INR" },
  };

  // Link to pre-auth if claim (not pre-auth itself)
  if (params.use === "claim" && params.preAuthReference) {
    claim.related = [{
      reference: { identifier: { value: params.preAuthReference } },
      relationship: { coding: [{ code: "prior" }] },
    }];
  }

  return {
    resourceType: "Bundle",
    id:           `bundle-${params.claimId}`,
    type:         "collection",
    entry:        [{ resource: claim }],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json() as {
      hospital_id:        string;
      admission_id:       string;
      package_code:       string;
      beneficiary_id:     string;
      pre_auth_reference?: string;
      claim_type:         "preauth" | "claim";
    };

    const { hospital_id, admission_id, package_code, beneficiary_id, pre_auth_reference, claim_type } = body;

    if (!hospital_id || !admission_id || !package_code || !beneficiary_id) {
      return json({ error: "Missing required fields" }, 400);
    }

    // ── 1. Fetch admission + patient details ─────────────────────────────────
    const { data: admission } = await supabase
      .from("admissions")
      .select("id, admitted_at, discharged_at, patient_id, patients(full_name, abha_id), insurance_pre_auth(icd10_codes)")
      .eq("id", admission_id)
      .maybeSingle();

    if (!admission) return json({ error: "Admission not found" }, 404);

    // ── 2. Fetch PMJAY package rate ───────────────────────────────────────────
    const { data: pkg } = await (supabase as any)
      .from("pmjay_package_master")
      .select("package_name, base_rate, speciality_rate, icd10_codes")
      .eq("hospital_id", hospital_id)
      .eq("package_code", package_code)
      .eq("is_active", true)
      .maybeSingle();

    if (!pkg) return json({ error: `PMJAY package ${package_code} not found or inactive` }, 404);

    // ── 3. Fetch HCX configuration ────────────────────────────────────────────
    const { data: hcxConfig } = await (supabase as any)
      .from("hospital_settings")
      .select("hcx_participant_code, hcx_client_id, hcx_client_secret, hcx_is_production, hfr_id")
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    const isSandbox     = !hcxConfig?.hcx_client_id || !hcxConfig?.hcx_is_production;
    const isProduction  = !!hcxConfig?.hcx_is_production;
    const hfrId         = hcxConfig?.hfr_id || "HFR-DEFAULT";
    const hcxBaseUrl    = isProduction
      ? "https://live.nha.gov.in/hcx"
      : "https://staging-hcx.swasth.app";

    // ── 4. Build FHIR bundle ──────────────────────────────────────────────────
    const claimId = crypto.randomUUID();
    const preAuthCodes = (admission as any).insurance_pre_auth?.[0]?.icd10_codes ?? [];
    const icd10Codes   = preAuthCodes.length > 0 ? preAuthCodes : (pkg.icd10_codes ?? ["Z03.8"]);
    const packageAmount = Number(pkg.speciality_rate || pkg.base_rate) || 0;

    const fhirBundle = buildPmjayClaimBundle({
      claimId,
      use:              claim_type === "preauth" ? "predetermination" : "claim",
      beneficiaryId:    beneficiary_id,
      hfrId,
      packageCode:      package_code,
      packageName:      pkg.package_name,
      packageAmount,
      admitDate:        (admission as any).admitted_at?.split("T")[0] ?? new Date().toISOString().split("T")[0],
      dischargeDate:    (admission as any).discharged_at?.split("T")[0] ?? new Date().toISOString().split("T")[0],
      icd10Codes,
      preAuthReference: pre_auth_reference,
    });

    // ── 5. Submit (sandbox mock or live HCX) ──────────────────────────────────
    if (isSandbox) {
      // Sandbox: deterministic mock response
      const mockHcxId = `PMJAY-MOCK-${claimId.slice(0, 8).toUpperCase()}`;

      await (supabase as any).from("govt_scheme_claims").upsert({
        hospital_id,
        patient_id:       (admission as any).patient_id,
        scheme_type:      "pmjay",
        claim_number:     mockHcxId,
        pmjay_package_code: package_code,
        pmjay_beneficiary_id: beneficiary_id,
        pmjay_pre_auth_id:  pre_auth_reference ?? null,
        hcx_claim_id:     mockHcxId,
        claimed_amount:   packageAmount,
        status:           "submitted",
        submitted_at:     new Date().toISOString(),
      }, { onConflict: "hospital_id,scheme_type,claim_number" });

      return json({
        success:    true,
        sandbox:    true,
        hcx_id:     mockHcxId,
        claim_id:   claimId,
        amount:     packageAmount,
        package:    package_code,
        message:    "PMJAY claim submitted (sandbox mock). Configure HCX credentials for live submission.",
      });
    }

    // Live: submit to NHCX
    const token = await getHcxToken(hcxConfig.hcx_client_id, hcxConfig.hcx_client_secret, isProduction);
    if (!token) return json({ error: "HCX authentication failed" }, 502);

    const apiPath = claim_type === "preauth"
      ? "/api/v0.7/coverageeligibility/check"
      : "/api/v0.7/claim/submit";

    // Build minimal JWE (no encryption key lookup for PMJAY sandbox)
    const hcxHeaders = {
      "x-hcx-sender_code":    hcxConfig.hcx_participant_code,
      "x-hcx-recipient_code": "PMJAY",
      "x-hcx-api_call_id":    claimId,
      "x-hcx-timestamp":      new Date().toISOString(),
      "x-hcx-workflow_id":    admission_id,
    };

    const encodedHeader  = strB64u(JSON.stringify({ alg: "dir", enc: "A256GCM", ...hcxHeaders }));
    const iv             = crypto.getRandomValues(new Uint8Array(12));
    const cek            = crypto.getRandomValues(new Uint8Array(32));
    const aesKey         = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
    const plaintext      = new TextEncoder().encode(JSON.stringify(fhirBundle));
    const cipherResult   = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(encodedHeader), tagLength: 128 },
      aesKey, plaintext,
    );
    const cipherBytes    = new Uint8Array(cipherResult);
    const jwe            = [
      encodedHeader, b64uEnc(new Uint8Array(0)),
      b64uEnc(iv), b64uEnc(cipherBytes.slice(0, -16)), b64uEnc(cipherBytes.slice(-16)),
    ].join(".");

    const hcxRes = await fetch(`${hcxBaseUrl}${apiPath}`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ payload: jwe }),
    });

    if (!hcxRes.ok) {
      const errText = await hcxRes.text();
      return json({ error: "HCX submission failed", detail: errText }, 502);
    }

    const hcxResponse  = await hcxRes.json() as any;
    const hcxCorrelationId = hcxResponse?.correlation_id ?? hcxResponse?.x_hcx_api_call_id ?? claimId;

    // Persist claim record
    await (supabase as any).from("govt_scheme_claims").upsert({
      hospital_id,
      patient_id:       (admission as any).patient_id,
      scheme_type:      "pmjay",
      claim_number:     hcxCorrelationId,
      pmjay_package_code: package_code,
      pmjay_beneficiary_id: beneficiary_id,
      pmjay_pre_auth_id:  pre_auth_reference ?? null,
      hcx_claim_id:     hcxCorrelationId,
      claimed_amount:   packageAmount,
      status:           "submitted",
      submitted_at:     new Date().toISOString(),
    }, { onConflict: "hospital_id,scheme_type,claim_number" });

    return json({
      success: true,
      hcx_id:  hcxCorrelationId,
      amount:  packageAmount,
      package: package_code,
    });

  } catch (err: any) {
    console.error("pmjay-claim-submit error:", err);
    return json({ error: err.message }, 500);
  }
});
