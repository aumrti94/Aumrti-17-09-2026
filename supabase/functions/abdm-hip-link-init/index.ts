import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAbdmToken, abdmHeaders } from "../_shared/abdm-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get caller's hospital_id
    const { data: userRow } = await sb
      .from("users")
      .select("hospital_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!userRow?.hospital_id) return json({ error: "user hospital not found" }, 403);
    const callerHospitalId: string = userRow.hospital_id;

    // ── Input ───────────────────────────────────────────────────────────────
    const body = await req.json() as {
      hospital_id: string;
      patient_id: string;
      care_context_ids: string[]; // array of abdm_care_contexts.id (UUID)
    };

    if (body.hospital_id !== callerHospitalId) {
      return json({ error: "cross-hospital access denied" }, 403);
    }
    const { patient_id, care_context_ids } = body;

    if (!patient_id || !care_context_ids?.length) {
      return json({ error: "patient_id and care_context_ids are required" }, 400);
    }

    // ── Fetch patient ABHA address ───────────────────────────────────────────
    const { data: profile } = await sb
      .from("patient_abha_profiles")
      .select("abha_address, abha_number")
      .eq("patient_id", patient_id)
      .eq("hospital_id", callerHospitalId)
      .maybeSingle();

    if (!profile?.abha_address) {
      return json({ error: "patient has no ABHA address linked" }, 404);
    }

    // ── Fetch care contexts ──────────────────────────────────────────────────
    const { data: careContexts } = await sb
      .from("abdm_care_contexts")
      .select("id, reference, display, context_type")
      .in("id", care_context_ids)
      .eq("patient_id", patient_id)
      .eq("hospital_id", callerHospitalId);

    if (!careContexts?.length) {
      return json({ error: "no matching care contexts found" }, 404);
    }

    // ── Fetch hospital config ────────────────────────────────────────────────
    const { data: cfg } = await sb
      .from("hospital_abdm_config")
      .select("abdm_base_url, hfr_id, is_production, feature_hip_sharing")
      .eq("hospital_id", callerHospitalId)
      .maybeSingle();

    if (!cfg) return json({ error: "ABDM not configured for this hospital" }, 400);
    if (!cfg.feature_hip_sharing) return json({ error: "HIP sharing feature not enabled" }, 400);
    if (!cfg.hfr_id) return json({ error: "HFR ID not configured" }, 400);

    // ── Get ABDM token ───────────────────────────────────────────────────────
    const token = await getAbdmToken(callerHospitalId, sb);
    if (!token) return json({ error: "could not obtain ABDM gateway token" }, 503);

    // ── Build link-init payload ──────────────────────────────────────────────
    const transactionId = crypto.randomUUID();
    const linkInitPayload = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      transactionId,
      link: {
        accessToken: token,
        patient: {
          id: profile.abha_address,
          referenceNumber: patient_id,
          display: profile.abha_address,
          careContexts: careContexts.map((cc) => ({
            referenceNumber: cc.reference,
            display: cc.display,
          })),
        },
        hip: {
          id: cfg.hfr_id,
        },
      },
    };

    // ── POST to ABDM gateway ─────────────────────────────────────────────────
    const gwResponse = await fetch(
      `${cfg.abdm_base_url}/v0.5/care-contexts/link-init`,
      {
        method: "POST",
        headers: abdmHeaders(token, cfg.is_production),
        body: JSON.stringify(linkInitPayload),
      },
    );

    const gwText = await gwResponse.text();
    let gwBody: unknown = {};
    try { gwBody = JSON.parse(gwText); } catch { /* non-JSON response */ }

    // ── Mark care contexts as pending ────────────────────────────────────────
    if (gwResponse.status === 202) {
      await sb
        .from("abdm_care_contexts")
        .update({ link_status: "pending" })
        .in("id", care_context_ids)
        .eq("hospital_id", callerHospitalId);
    }

    // ── Log ──────────────────────────────────────────────────────────────────
    await sb.from("abdm_gateway_logs").insert({
      hospital_id: callerHospitalId,
      action: "hip_link_init",
      direction: "outbound",
      request_payload: linkInitPayload,
      response_payload: { status: gwResponse.status, body: gwBody },
      status: gwResponse.status === 202 ? "ok" : "error",
    });

    if (gwResponse.status !== 202) {
      return json({ error: "gateway rejected link-init", detail: gwBody }, 502);
    }

    return json({
      success: true,
      transactionId,
      message: `Link initiated for ${careContexts.length} care context(s). Patient will receive a notification on their PHR app.`,
    });
  } catch (err) {
    console.error("abdm-hip-link-init error:", err);
    return json({ error: "internal server error" }, 500);
  }
});
