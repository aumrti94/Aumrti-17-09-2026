import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EventType = "opd_completed" | "ipd_discharged" | "lab_reported" | "radiology_reported";

interface CareContextMeta {
  reference: string;
  display: string;
  context_type: string;
}

async function buildCareContextMeta(
  sb: ReturnType<typeof createClient>,
  eventType: EventType,
  sourceId: string,
  hospitalId: string,
): Promise<CareContextMeta | null> {
  switch (eventType) {
    case "opd_completed": {
      const { data } = await sb
        .from("opd_tokens")
        .select("token_number, visit_date, doctor:users!doctor_id(full_name)")
        .eq("id", sourceId)
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (!data) return null;
      const doctorName = (data.doctor as Record<string, unknown> | null)?.full_name ?? "Doctor";
      const visitDate = new Date(data.visit_date as string).toLocaleDateString("en-IN");
      return {
        reference: `OPD-${sourceId}`,
        display: `OPD Visit — ${doctorName} — ${visitDate}`,
        context_type: "OPDRecord",
      };
    }

    case "ipd_discharged": {
      const { data } = await sb
        .from("admissions")
        .select("admission_date, discharge_date, ward, bed_number, doctor:users!doctor_id(full_name)")
        .eq("id", sourceId)
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (!data) return null;
      const doctorName = (data.doctor as Record<string, unknown> | null)?.full_name ?? "Doctor";
      const admDate = new Date(data.admission_date as string).toLocaleDateString("en-IN");
      const disDate = data.discharge_date
        ? new Date(data.discharge_date as string).toLocaleDateString("en-IN")
        : "ongoing";
      return {
        reference: `IPD-${sourceId}`,
        display: `IPD Admission — ${doctorName} — ${admDate} to ${disDate}`,
        context_type: "DischargeSummaryRecord",
      };
    }

    case "lab_reported": {
      const { data } = await sb
        .from("lab_reports")
        .select("test_name, reported_at")
        .eq("id", sourceId)
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (!data) return null;
      const reportedDate = new Date(data.reported_at as string).toLocaleDateString("en-IN");
      return {
        reference: `LAB-${sourceId}`,
        display: `Lab Report — ${data.test_name} — ${reportedDate}`,
        context_type: "DiagnosticReportRecord",
      };
    }

    case "radiology_reported": {
      const { data } = await sb
        .from("radiology_reports")
        .select("study_type, reported_at")
        .eq("id", sourceId)
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (!data) return null;
      const reportedDate = new Date(data.reported_at as string).toLocaleDateString("en-IN");
      return {
        reference: `RAD-${sourceId}`,
        display: `Radiology Report — ${data.study_type} — ${reportedDate}`,
        context_type: "DiagnosticReportRecord",
      };
    }

    default:
      return null;
  }
}

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
    // ── Auth ─────────────────────────────────────────────────────────────────
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

    const { data: userRow } = await sb
      .from("users")
      .select("hospital_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!userRow?.hospital_id) return json({ error: "user hospital not found" }, 403);
    const callerHospitalId: string = userRow.hospital_id;

    // ── Input ────────────────────────────────────────────────────────────────
    const body = await req.json() as {
      hospital_id: string;
      patient_id: string;
      event_type: EventType;
      source_id: string;
    };

    if (body.hospital_id !== callerHospitalId) {
      return json({ error: "cross-hospital access denied" }, 403);
    }

    const { patient_id, event_type, source_id } = body;
    if (!patient_id || !event_type || !source_id) {
      return json({ error: "patient_id, event_type, and source_id are required" }, 400);
    }

    // ── Check patient has active ABHA ────────────────────────────────────────
    const { data: profile } = await sb
      .from("patient_abha_profiles")
      .select("abha_address, abha_number")
      .eq("patient_id", patient_id)
      .eq("hospital_id", callerHospitalId)
      .maybeSingle();

    if (!profile?.abha_address) {
      return json({ skipped: true, reason: "no_abha" });
    }

    // ── Check HIP sharing enabled ────────────────────────────────────────────
    const { data: cfg } = await sb
      .from("hospital_abdm_config")
      .select("feature_hip_sharing")
      .eq("hospital_id", callerHospitalId)
      .maybeSingle();

    if (!cfg?.feature_hip_sharing) {
      return json({ skipped: true, reason: "hip_sharing_disabled" });
    }

    // ── Build care context metadata from clinical event ──────────────────────
    const meta = await buildCareContextMeta(sb, event_type, source_id, callerHospitalId);
    if (!meta) {
      return json({ skipped: true, reason: "source_record_not_found" });
    }

    // ── Avoid duplicate care contexts ────────────────────────────────────────
    const { data: existing } = await sb
      .from("abdm_care_contexts")
      .select("id")
      .eq("reference", meta.reference)
      .eq("hospital_id", callerHospitalId)
      .maybeSingle();

    let careContextId: string;

    if (existing) {
      careContextId = existing.id as string;
    } else {
      const { data: inserted, error: insertErr } = await sb
        .from("abdm_care_contexts")
        .insert({
          hospital_id: callerHospitalId,
          patient_id,
          reference: meta.reference,
          display: meta.display,
          context_type: meta.context_type,
          source_id,
          link_status: "unlinked",
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        console.error("Failed to insert care context:", insertErr);
        return json({ error: "failed to create care context" }, 500);
      }

      careContextId = inserted.id as string;
    }

    // ── Trigger HIP link-init to notify patient ──────────────────────────────
    const { data: linkResult, error: linkErr } = await sb.functions.invoke("abdm-hip-link-init", {
      body: {
        hospital_id: callerHospitalId,
        patient_id,
        care_context_ids: [careContextId],
      },
    });

    if (linkErr) {
      // Care context was created — return partial success
      console.warn("Care context created but link-init failed:", linkErr);
      return json({
        success: true,
        care_context_id: careContextId,
        linked: false,
        warning: "Care context recorded; patient notification failed. Retry via HIP link.",
      });
    }

    return json({
      success: true,
      care_context_id: careContextId,
      linked: true,
      transaction_id: (linkResult as Record<string, unknown>)?.transactionId,
      message: `Care context created and link initiated for ${event_type}.`,
    });
  } catch (err) {
    console.error("abdm-auto-link-care-context error:", err);
    return json({ error: "internal server error" }, 500);
  }
});
