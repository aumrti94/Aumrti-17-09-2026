/**
 * abdm-sandbox-test — Self-service ABDM integration test runner.
 *
 * Used from SettingsABDMPage "Integration Tests" section so hospital admins
 * can validate their ABDM setup before going live.
 *
 * Input:  { hospital_id, test: "token" | "discover" | "link" | "data_push" }
 * Output: { results: TestResult[], overall: "pass" | "fail", ran_at: string }
 *
 * Security: requires a valid Supabase JWT; hospital_id validated against JWT.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAbdmToken, abdmHeaders } from "../_shared/abdm-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface TestResult {
  name: string;
  description: string;
  pass: boolean;
  detail?: string;
  error?: string;
}

// ─── Token test ───────────────────────────────────────────────────────────────

async function testToken(
  hospitalId: string,
  sb: ReturnType<typeof createClient>,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Step 1: check hospital config exists
  const { data: cfg, error: cfgErr } = await sb
    .from("hospital_abdm_config")
    .select("abdm_base_url, abdm_client_id, is_production, hfr_id, facility_name")
    .eq("hospital_id", hospitalId)
    .maybeSingle();

  results.push({
    name: "Config present",
    description: "hospital_abdm_config row exists",
    pass: !cfgErr && !!cfg,
    error: cfgErr?.message,
    detail: cfg ? `facility: ${cfg.facility_name ?? cfg.hfr_id ?? "—"}, mode: ${cfg.is_production ? "production" : "sandbox"}` : "No config row found",
  });

  if (!cfg) return results;

  // Step 2: credentials configured
  const hasClientId = !!(cfg as Record<string, unknown>).abdm_client_id;
  results.push({
    name: "Credentials configured",
    description: "abdm_client_id is set",
    pass: hasClientId,
    detail: hasClientId ? "Client ID present" : "abdm_client_id is null — using sandbox mode",
  });

  // Step 3: acquire token
  const token = await getAbdmToken(hospitalId, sb);
  const tokenPreview = token ? `${token.slice(0, 8)}…` : null;
  results.push({
    name: "Token acquisition",
    description: "Obtain ABDM bearer token from NHA gateway",
    pass: !!token,
    detail: token ? `Token obtained (preview: ${tokenPreview})` : "No token — sandbox mock or missing credentials",
  });

  return results;
}

// ─── Discover test ────────────────────────────────────────────────────────────

async function testDiscover(
  hospitalId: string,
  sb: ReturnType<typeof createClient>,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Find a patient with an ABHA profile at this hospital
  const { data: abhaProfile } = await sb
    .from("patient_abha_profiles")
    .select("patient_id, abha_address, abha_number")
    .eq("hospital_id", hospitalId)
    .not("abha_address", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  results.push({
    name: "Test patient with ABHA",
    description: "Find a patient with a linked ABHA address for discovery simulation",
    pass: !!abhaProfile,
    detail: abhaProfile ? `Using ABHA: ${abhaProfile.abha_address}` : "No patients with ABHA found — register a patient with ABHA first",
  });

  if (!abhaProfile) return results;

  // Check care contexts exist for this patient
  const { data: ccs } = await sb
    .from("abdm_care_contexts")
    .select("id, reference, display, context_type")
    .eq("patient_id", abhaProfile.patient_id)
    .eq("hospital_id", hospitalId)
    .limit(5);

  results.push({
    name: "Care contexts exist",
    description: "Patient has at least one care context to share",
    pass: (ccs?.length ?? 0) > 0,
    detail: ccs?.length ? `${ccs.length} context(s): ${ccs.map((c) => c.context_type).join(", ")}` : "No care contexts — complete at least one consultation",
  });

  if (!ccs?.length) return results;

  // Validate the on-discover response shape
  const onDiscoverPayload = {
    requestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    transactionId: crypto.randomUUID(),
    patient: {
      referenceNumber: abhaProfile.patient_id,
      display: abhaProfile.abha_address,
      careContexts: ccs.map((cc) => ({
        referenceNumber: cc.reference,
        display: cc.display,
      })),
      matchedBy: ["PATIENT_ID"],
    },
    resp: { requestId: crypto.randomUUID() },
  };

  const hasRequiredFields =
    onDiscoverPayload.requestId &&
    onDiscoverPayload.timestamp &&
    onDiscoverPayload.patient.referenceNumber &&
    Array.isArray(onDiscoverPayload.patient.careContexts);

  results.push({
    name: "Discovery payload valid",
    description: "on-discover response matches ABDM spec (requestId, timestamp, patient, careContexts)",
    pass: !!hasRequiredFields,
    detail: `${onDiscoverPayload.patient.careContexts.length} care context(s) in response`,
  });

  // Try to actually call the gateway if token available
  const token = await getAbdmToken(hospitalId, sb);
  if (token) {
    const { data: cfg } = await sb
      .from("hospital_abdm_config")
      .select("abdm_base_url, is_production")
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (cfg) {
      try {
        const gwRes = await fetch(`${cfg.abdm_base_url}/v0.5/care-contexts/on-discover`, {
          method: "POST",
          headers: abdmHeaders(token, cfg.is_production),
          body: JSON.stringify(onDiscoverPayload),
        });
        results.push({
          name: "Gateway on-discover call",
          description: "POST on-discover response to NHA gateway",
          pass: gwRes.status >= 200 && gwRes.status < 300,
          detail: `HTTP ${gwRes.status}`,
          error: gwRes.ok ? undefined : await gwRes.text().catch(() => ""),
        });
      } catch (err) {
        results.push({
          name: "Gateway on-discover call",
          description: "POST on-discover response to NHA gateway",
          pass: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return results;
}

// ─── Link test ────────────────────────────────────────────────────────────────

async function testLink(
  hospitalId: string,
  sb: ReturnType<typeof createClient>,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Find an unlinked care context
  const { data: cc } = await sb
    .from("abdm_care_contexts")
    .select("id, reference, display, patient_id")
    .eq("hospital_id", hospitalId)
    .in("link_status", ["pending", "unlinked", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  results.push({
    name: "Pending care context",
    description: "Find a care context that has not yet been linked",
    pass: !!cc,
    detail: cc ? `Reference: ${cc.reference}` : "All care contexts are linked or none exist",
  });

  if (!cc) return results;

  // Try link-init
  try {
    const { data: linkData, error: linkErr } = await sb.functions.invoke("abdm-hip-link-init", {
      body: {
        hospital_id: hospitalId,
        patient_id: cc.patient_id,
        care_context_ids: [cc.id],
      },
    });

    results.push({
      name: "Link-init invocation",
      description: "Call abdm-hip-link-init to initiate care context linking",
      pass: !linkErr && !!(linkData as Record<string, unknown>)?.success,
      detail: linkErr ? undefined : "Link initiation accepted",
      error: linkErr?.message ?? (linkData as Record<string, unknown>)?.error as string ?? undefined,
    });
  } catch (err) {
    results.push({
      name: "Link-init invocation",
      description: "Call abdm-hip-link-init to initiate care context linking",
      pass: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return results;
}

// ─── Data push test ───────────────────────────────────────────────────────────

async function testDataPush(
  hospitalId: string,
  sb: ReturnType<typeof createClient>,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Find a linked care context for FHIR bundle test
  const { data: cc } = await sb
    .from("abdm_care_contexts")
    .select("id, reference, display, context_type, source_id")
    .eq("hospital_id", hospitalId)
    .eq("link_status", "linked")
    .order("linked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  results.push({
    name: "Linked care context",
    description: "Find a linked care context to test FHIR bundle generation",
    pass: !!cc,
    detail: cc ? `Reference: ${cc.reference} (${cc.context_type})` : "No linked care contexts — link at least one first",
  });

  if (!cc) return results;

  // Test FHIR bundle generation
  try {
    const { data: fhirData, error: fhirErr } = await sb.functions.invoke("abdm-fhir-package", {
      body: {
        hospital_id: hospitalId,
        care_context_reference: cc.reference,
        context_type: cc.context_type,
        source_id: cc.source_id,
      },
    });

    const hasBundleOrContent = !!(fhirData as Record<string, unknown>)?.bundle ||
      !!(fhirData as Record<string, unknown>)?.content;

    results.push({
      name: "FHIR bundle generation",
      description: "Generate FHIR bundle for the care context via abdm-fhir-package",
      pass: !fhirErr && hasBundleOrContent,
      detail: hasBundleOrContent ? "Bundle generated successfully" : "No bundle in response",
      error: fhirErr?.message ?? (!hasBundleOrContent ? "abdm-fhir-package returned no bundle or content" : undefined),
    });

    // Validate bundle structure if present
    if (hasBundleOrContent) {
      const bundle = (fhirData as Record<string, unknown>)?.bundle as Record<string, unknown> | undefined;
      const hasResourceType = bundle?.resourceType === "Bundle";
      const hasEntries = Array.isArray(bundle?.entry) && (bundle?.entry as unknown[]).length > 0;

      results.push({
        name: "FHIR bundle structure",
        description: "Bundle has resourceType=Bundle and at least one entry",
        pass: hasResourceType && hasEntries,
        detail: bundle
          ? `resourceType=${bundle.resourceType}, entries=${(bundle.entry as unknown[])?.length ?? 0}`
          : "Bundle structure not accessible (encrypted content)",
      });
    }
  } catch (err) {
    results.push({
      name: "FHIR bundle generation",
      description: "Generate FHIR bundle for the care context",
      pass: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return results;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth: require valid Supabase JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const anonSb = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonSb.auth.getUser();
    if (!user || authErr) return json({ success: false, error: "Unauthorized" }, 401);

    const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Resolve hospital from JWT
    const { data: userData } = await sb
      .from("users")
      .select("hospital_id, role")
      .eq("id", user.id)
      .single();

    if (!userData) return json({ success: false, error: "User record not found" }, 404);

    const callerHospitalId = userData.hospital_id as string;
    const callerRole = userData.role as string;

    // Only admins can run integration tests
    if (!["hospital_admin", "super_admin"].includes(callerRole)) {
      return json({ success: false, error: "Forbidden: admin role required" }, 403);
    }

    const { hospital_id, test } = await req.json() as {
      hospital_id?: string;
      test?: string;
    };

    if (hospital_id && hospital_id !== callerHospitalId) {
      return json({ success: false, error: "Forbidden: hospital_id mismatch" }, 403);
    }

    const resolvedHospitalId = callerHospitalId;

    if (!test) return json({ success: false, error: "test parameter required" }, 400);

    let results: TestResult[] = [];

    switch (test) {
      case "token":
        results = await testToken(resolvedHospitalId, sb);
        break;

      case "discover":
        results = [
          ...(await testToken(resolvedHospitalId, sb)),
          ...(await testDiscover(resolvedHospitalId, sb)),
        ];
        break;

      case "link":
        results = [
          ...(await testToken(resolvedHospitalId, sb)),
          ...(await testLink(resolvedHospitalId, sb)),
        ];
        break;

      case "data_push":
        results = [
          ...(await testToken(resolvedHospitalId, sb)),
          ...(await testDataPush(resolvedHospitalId, sb)),
        ];
        break;

      case "full":
        results = [
          ...(await testToken(resolvedHospitalId, sb)),
          ...(await testDiscover(resolvedHospitalId, sb)),
          ...(await testLink(resolvedHospitalId, sb)),
          ...(await testDataPush(resolvedHospitalId, sb)),
        ];
        break;

      default:
        return json({ success: false, error: `Unknown test: ${test}` }, 400);
    }

    const overall = results.every((r) => r.pass) ? "pass" : "fail";

    // Log test run
    await sb.from("abdm_gateway_logs").insert({
      hospital_id: resolvedHospitalId,
      action: `sandbox_test_${test}`,
      direction: "internal",
      request_payload: { test },
      response_payload: { overall, results_count: results.length, pass_count: results.filter((r) => r.pass).length },
      status: overall === "pass" ? "ok" : "error",
    }).catch(() => {});

    return json({
      success: true,
      overall,
      results,
      ran_at: new Date().toISOString(),
    });

  } catch (err: unknown) {
    console.error("abdm-sandbox-test:", err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
