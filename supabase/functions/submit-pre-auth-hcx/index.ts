/**
 * submit-pre-auth-hcx — Supabase Edge Function
 *
 * Builds a FHIR R4 CoverageEligibilityRequest bundle and submits it to
 * the TPA's configured API endpoint.  If the TPA has no direct API,
 * falls back to the hospital's HCX gateway via hcx-claim-submit.
 *
 * Input:  { pre_auth_id: string, hospital_id: string }
 * Output: { success: boolean, tpa_reference_number?: string, message: string }
 */

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── FHIR bundle builder ────────────────────────────────────────────────────────

function buildFhirBundle(opts: {
  preAuthId:       string;
  patientId:       string;
  patientName:     string;
  patientGender:   string;
  patientDob:      string | null;
  patientUhid:     string;
  tpaName:         string;
  tpaHcxCode:      string | null;
  policyNumber:    string | null;
  estimatedAmount: number;
  icd10Codes:      { code: string; description: string }[];
  procedureCodes:  string[];
  notes:           string | null;
  admittedAt:      string | null;
  hospitalName:    string;
}): object {
  const now = new Date().toISOString();
  const bundleId = crypto.randomUUID();

  // Build Condition resources from ICD-10 codes
  const conditions = opts.icd10Codes.map((icd, i) => ({
    fullUrl: `urn:uuid:condition-${i}`,
    resource: {
      resourceType: "Condition",
      id: `condition-${i}`,
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
      },
      code: {
        coding: [{
          system: "http://hl7.org/fhir/sid/icd-10",
          code: icd.code,
          display: icd.description,
        }],
        text: icd.description,
      },
      subject: { reference: `Patient/${opts.patientId}` },
      onsetDateTime: opts.admittedAt ?? now,
      note: opts.notes ? [{ text: opts.notes }] : [],
    },
  }));

  // Build Procedure resources from procedure codes
  const procedures = opts.procedureCodes.map((code, i) => ({
    fullUrl: `urn:uuid:procedure-${i}`,
    resource: {
      resourceType: "Procedure",
      id: `procedure-${i}`,
      status: "preparation",
      code: {
        coding: [{ system: "http://snomed.info/sct", code, display: code }],
        text: code,
      },
      subject: { reference: `Patient/${opts.patientId}` },
    },
  }));

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: {
      lastUpdated: now,
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/CoverageEligibilityRequest"],
    },
    identifier: {
      system: "https://www.tmh.org.in/",
      value: bundleId,
    },
    type: "collection",
    timestamp: now,
    entry: [
      // CoverageEligibilityRequest — the root resource
      {
        fullUrl: `urn:uuid:${opts.preAuthId}`,
        resource: {
          resourceType: "CoverageEligibilityRequest",
          id: opts.preAuthId,
          meta: {
            profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/CoverageEligibilityRequest"],
          },
          text: {
            status: "generated",
            div: `<div xmlns="http://www.w3.org/1999/xhtml">CoverageEligibilityRequest for ${opts.patientName}</div>`,
          },
          identifier: [{ system: "https://www.tmh.org.in/coverage-eligibility-request", value: opts.preAuthId }],
          status: "active",
          purpose: ["auth-requirements"],
          patient: { reference: `Patient/${opts.patientId}`, display: opts.patientName },
          created: now.slice(0, 10),
          enterer: { display: opts.hospitalName },
          insurer: { display: opts.tpaName + (opts.tpaHcxCode ? ` [${opts.tpaHcxCode}]` : "") },
          insurance: [{
            focal: true,
            coverage: {
              display: `Coverage for ${opts.patientName}`,
              identifier: opts.policyNumber
                ? [{ system: "http://hospitalid.in/Policy", value: opts.policyNumber }]
                : undefined,
            },
          }],
          item: [
            {
              category: {
                coding: [{ system: "http://terminology.hl7.org/CodeSystem/ex-benefitcategory", code: "49", display: "Hospital Room and Board" }],
              },
              productOrService: {
                coding: opts.procedureCodes.length > 0
                  ? opts.procedureCodes.map(c => ({ system: "http://snomed.info/sct", code: c, display: c }))
                  : [{ system: "http://snomed.info/sct", code: "409063005", display: "Counselling" }],
              },
              diagnosis: conditions.map((_, i) => ({
                diagnosisReference: { reference: `Condition/condition-${i}` },
              })),
              unitPrice: { value: opts.estimatedAmount, currency: "INR" },
              quantity: { value: 1 },
            },
          ],
        },
      },
      // Patient resource
      {
        fullUrl: `Patient/${opts.patientId}`,
        resource: {
          resourceType: "Patient",
          id: opts.patientId,
          meta: {
            profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient"],
          },
          identifier: [{ system: "https://healthid.abdm.gov.in", value: opts.patientUhid }],
          name: [{ text: opts.patientName }],
          gender: opts.patientGender || "unknown",
          birthDate: opts.patientDob ?? undefined,
        },
      },
      ...conditions,
      ...procedures,
    ],
  };
}

// ── Handler ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anonSb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authErr } = await anonSb.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify user belongs to the given hospital
    const { pre_auth_id, hospital_id } = await req.json();
    if (!pre_auth_id || !hospital_id) return json({ error: "pre_auth_id and hospital_id are required" }, 400);

    const { data: userRow } = await sb.from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!userRow || userRow.hospital_id !== hospital_id) {
      return json({ error: "Forbidden" }, 403);
    }

    // ── 2. Fetch pre-auth, patient, TPA config ────────────────────────────────
    // Was a single query embedding `tpa_config!inner(...)` off insurance_pre_auth — PostgREST
    // can only embed across a REAL foreign-key relationship, and none exists between these two
    // tables (they only share a `tpa_name` text value, never declared as an FK). Confirmed live
    // against this project's own PostgREST: it returns PGRST200 "Could not find a relationship
    // between 'insurance_pre_auth' and 'tpa_config'" for every single call. Since the code
    // treated ANY query error as "Pre-auth not found" (`if (paErr || !pa) return 404`), this
    // function has returned a 404 for every real pre-auth submission attempt ever made,
    // regardless of whether the pre-auth existed — the entire feature has never worked once.
    // Found via Phase 6 edge-function testing. Fixed by fetching each table separately, the
    // pattern already used everywhere else in this file for admissions/patients/hospitals.
    const { data: pa, error: paErr } = await (sb as any)
      .from("insurance_pre_auth")
      .select(`
        id, patient_id, admission_id, tpa_name, policy_number,
        estimated_amount, diagnosis_codes, procedure_codes,
        icd10_codes, notes, status, hospital_id,
        admissions(admitted_at)
      `)
      .eq("id", pre_auth_id)
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    if (paErr || !pa) return json({ error: "Pre-auth not found" }, 404);

    if (!["pending", "draft", "under_review"].includes(pa.status)) {
      return json({ error: `Pre-auth is already in status '${pa.status}'` }, 422);
    }

    const { data: patient } = await sb.from("patients")
      .select("id, full_name, gender, date_of_birth, uhid")
      .eq("id", pa.patient_id)
      .maybeSingle();

    const { data: hospital } = await sb.from("hospitals")
      .select("name")
      .eq("id", hospital_id)
      .maybeSingle();

    const { data: tpa } = await (sb as any)
      .from("tpa_config")
      .select("id, tpa_name, api_endpoint, api_key_encrypted, tpa_hcx_code, submission_method")
      .eq("hospital_id", hospital_id)
      .eq("tpa_name", pa.tpa_name)
      .limit(1)
      .maybeSingle();

    if (!tpa) return json({ error: `No TPA configuration found for "${pa.tpa_name}". Add it in Settings → Insurance → TPA Configuration.` }, 422);

    // ── 3. Resolve ICD-10 codes (handle both formats) ─────────────────────────
    let icd10Codes: { code: string; description: string }[] = [];
    if (pa.icd10_codes && Array.isArray(pa.icd10_codes)) {
      // New JSONB format from ICD10Search: [{code, description}]
      icd10Codes = pa.icd10_codes as any;
    } else if (pa.diagnosis_codes && Array.isArray(pa.diagnosis_codes)) {
      // Legacy string-array format
      icd10Codes = pa.diagnosis_codes.map((c: string) => ({ code: c, description: c }));
    }

    const procedureCodes: string[] = pa.procedure_codes ?? [];

    // ── 4. Build FHIR bundle ─────────────────────────────────────────────────
    const fhirBundle = buildFhirBundle({
      preAuthId:       pa.id,
      patientId:       pa.patient_id,
      patientName:     patient?.full_name ?? "Unknown Patient",
      patientGender:   patient?.gender ?? "unknown",
      patientDob:      patient?.date_of_birth ?? null,
      patientUhid:     patient?.uhid ?? pa.patient_id,
      tpaName:         pa.tpa_name,
      tpaHcxCode:      tpa?.tpa_hcx_code ?? null,
      policyNumber:    pa.policy_number ?? null,
      estimatedAmount: Number(pa.estimated_amount ?? 0),
      icd10Codes,
      procedureCodes,
      notes:           pa.notes ?? null,
      admittedAt:      pa.admissions?.admitted_at ?? null,
      hospitalName:    hospital?.name ?? "Hospital",
    });

    // ── 5. Submit ─────────────────────────────────────────────────────────────
    const apiEndpoint   = tpa?.api_endpoint;
    const apiKey        = tpa?.api_key_encrypted;

    let tpaReferenceNumber: string | null = null;
    let submissionError: string | null = null;

    if (apiEndpoint && apiKey) {
      // Direct TPA API submission
      try {
        const res = await fetch(apiEndpoint, {
          method:  "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type":  "application/fhir+json",
            "X-HCX-Request-ID": pa.id,
          },
          body: JSON.stringify(fhirBundle),
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          submissionError = `TPA API responded with HTTP ${res.status}: ${errBody.slice(0, 200)}`;
        } else {
          const responseBody = await res.json().catch(() => ({}));
          // Try common TPA response fields for the reference number
          tpaReferenceNumber =
            (responseBody as any)?.reference_number ??
            (responseBody as any)?.preAuthId ??
            (responseBody as any)?.id ??
            `TPA-${Date.now()}`;
        }
      } catch (fetchErr: any) {
        submissionError = `Network error: ${fetchErr.message}`;
      }
    } else {
      // No direct API — fall back to HCX gateway via the existing function.
      // Was called with the service-role key as bearer — hcx-claim-submit requires a real
      // user JWT (a deliberate Phase 4 hardening: "any logged-in staff of any hospital could
      // pull another hospital's HCX gateway secret" — see KNOWN_BUGS.md), so it has ALWAYS
      // rejected this call with 401, regardless of hospital or configuration. This function
      // already validated the caller belongs to `hospital_id` above (step 1), so forwarding
      // that same already-verified bearer preserves the trust chain hcx-claim-submit's own
      // auth check expects, instead of presenting a credential it was never going to accept.
      // Found via Phase 6 edge-function testing.
      try {
        const hcxRes = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/hcx-claim-submit`,
          {
            method:  "POST",
            headers: {
              "Authorization":  authHeader,
              "Content-Type":   "application/json",
            },
            body: JSON.stringify({
              hospital_id,
              bill_id: pa.admission_id, // HCX function accepts admission_id as bill_id for pre-auth
              claim_type: "preauth",
              pre_auth_id: pa.id,
            }),
          },
        );
        const hcxBody = await hcxRes.json().catch(() => ({}));
        if (!hcxRes.ok || (hcxBody as any).error) {
          submissionError = (hcxBody as any).error ?? `HCX gateway HTTP ${hcxRes.status}`;
        } else {
          tpaReferenceNumber = (hcxBody as any).tpa_reference_number ?? (hcxBody as any).correlation_id ?? `HCX-${Date.now()}`;
        }
      } catch (hcxErr: any) {
        submissionError = `HCX gateway error: ${hcxErr.message}`;
      }
    }

    // ── 6. Persist result ─────────────────────────────────────────────────────
    // The three `.insert(...).catch(() => {})` calls below were the same non-existent-.catch()
    // defect found repeatedly this session — each threw synchronously and would have crashed
    // this handler with a 500 before its own intended response was returned, discarding
    // whichever real outcome (failure or success) had already been determined. Found via
    // Phase 6 edge-function testing. `event_type: "auto_submit_preauth"` was ALSO a second,
    // independent bug stacked on both inserts: insurance_automation_log_event_type_check has
    // never allowed that exact string — the real, already-established value for this event
    // (used correctly by the sibling function insurance-automation/index.ts) is
    // "pre_auth_auto_submitted", word order swapped from what was written here.
    if (submissionError) {
      // Log failure without touching pre-auth status
      const { error: failLogErr } = await (sb as any).from("insurance_automation_log").insert({
        hospital_id,
        pre_auth_id: pa.id,
        event_type:  "pre_auth_auto_submitted",
        status:      "failed",
        payload:     { error: submissionError, bundle_id: (fhirBundle as any).id },
        ai_used:     false,
        triggered_by: "user",
      });
      if (failLogErr) console.error("submit-pre-auth-hcx: automation log insert failed:", failLogErr.message);

      const { error: alertErr } = await (sb as any).from("clinical_alerts").insert({
        hospital_id,
        alert_type:      "pre_auth_submission_failed",
        alert_message:   `Auto-submit failed for pre-auth ${pa.id}: ${submissionError}`,
        severity:        "high",
        is_acknowledged: false,
      });
      if (alertErr) console.error("submit-pre-auth-hcx: alert insert failed:", alertErr.message);

      return json({ success: false, message: submissionError }, 502);
    }

    // Success: update pre-auth record
    const { error: preAuthUpdateErr } = await (sb as any).from("insurance_pre_auth").update({
      status:               "submitted",
      submitted_at:         new Date().toISOString(),
      submission_mode:      "automated",
      tpa_reference_number: tpaReferenceNumber,
    }).eq("id", pa.id);
    if (preAuthUpdateErr) console.error("submit-pre-auth-hcx: insurance_pre_auth update failed:", preAuthUpdateErr.message);

    const { error: successLogErr } = await (sb as any).from("insurance_automation_log").insert({
      hospital_id,
      pre_auth_id:   pa.id,
      event_type:    "pre_auth_auto_submitted",
      status:        "success",
      payload:       { tpa_reference_number: tpaReferenceNumber, api_endpoint: apiEndpoint ?? "hcx_gateway" },
      ai_used:       false,
      triggered_by:  "user",
    });
    if (successLogErr) console.error("submit-pre-auth-hcx: automation log insert failed:", successLogErr.message);

    return json({
      success:              true,
      tpa_reference_number: tpaReferenceNumber,
      message:              `Pre-auth submitted successfully. TPA Reference: ${tpaReferenceNumber}`,
    });
  } catch (err: any) {
    console.error("submit-pre-auth-hcx:", sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return json({ success: false, message: err.message }, 500);
  }
});
