import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Auth: verify caller JWT and derive hospital from profile ──────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Was `.eq("id", caller.id)` — public.users.id and auth.users.id (what caller.id is)
    // diverged at migration 20260322111223; every account created since then has a
    // DIFFERENT public.users.id than its own auth uid, so this lookup found zero rows for
    // any such account, and every real staff member got a 403 "Forbidden" regardless of
    // their actual role or hospital. The correct join key is auth_user_id, already used
    // correctly by every other function in this codebase for exactly this reason. Found via
    // Phase 6 edge-function testing — the Tier-0 seed fixture deliberately sets auth_user_id
    // different from id for this exact reason (see the tenant-isolation-testing skill), so a
    // real seeded staff account caught this on the very first live test.
    const { data: callerProfile } = await supabase
      .from("users")
      .select("hospital_id, role")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    if (!callerProfile?.hospital_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hospitalId = callerProfile.hospital_id;
    // ─────────────────────────────────────────────────────────────────────

    const { reportId } = await req.json();
    if (!reportId) {
      return new Response(JSON.stringify({ error: "reportId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch HMIS portal credentials
    const { data: apiConfig } = await supabase
      .from("api_configurations")
      .select("config")
      .eq("hospital_id", hospitalId)
      .eq("service_key", "hmis_portal")
      .eq("is_active", true)
      .maybeSingle();

    if (!apiConfig?.config) {
      return new Response(JSON.stringify({ error: "HMIS portal credentials not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const creds = apiConfig.config as Record<string, any>;
    const { hin_code, facility_code, username, password, portal_url } = creds;

    // Fetch the report
    const { data: report, error: reportErr } = await supabase
      .from("hmis_reports")
      .select("*")
      .eq("id", reportId)
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (reportErr || !report) {
      return new Response(JSON.stringify({ error: "Report not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build submission payload per MoHFW HMIS format
    const payload = {
      hin_code,
      facility_code,
      report_type: report.report_type,
      period_year: report.period_year,
      period_month: report.period_month,
      period_week: report.period_week,
      data: report.report_data,
      submitted_by: username,
      submission_timestamp: new Date().toISOString(),
    };

    // Attempt MoHFW IHIP portal submission
    const portalBase = portal_url || "https://ihip.nhp.gov.in";
    const submitEndpoint = `${portalBase}/api/v1/hmis/submit`;

    let ackRef: string | null = null;
    let submitStatus: "submitted" | "portal_unavailable" = "portal_unavailable";

    try {
      const authRes = await fetch(`${portalBase}/api/v1/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, facility_code }),
        signal: AbortSignal.timeout(8000),
      });

      if (authRes.ok) {
        const authData = await authRes.json();
        const token = authData.access_token || authData.token;

        const submitRes = await fetch(submitEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });

        if (submitRes.ok) {
          const submitData = await submitRes.json();
          ackRef = submitData.acknowledgment_ref || submitData.ack_no || submitData.ref_id || `ACK-${Date.now()}`;
          submitStatus = "submitted";
        }
      }
    } catch {
      // Portal unreachable — mark for manual submission
      console.log("HMIS portal unreachable, marking for manual submission");
    }

    // Update report status and acknowledgment.
    // The DB trigger validate_hmis_report() only ever allowed
    // status IN ('draft','generated','submitted','accepted') — the same 4 values
    // HMISPage.tsx's own filtering already understands (HMISPage.tsx:80-81, :613) — but this
    // function wrote "portal_unavailable" here, a 5th value neither the trigger nor the
    // frontend has ever recognised. Every portal-unreachable submission attempt (the exact
    // fallback path this function exists to handle) has always been rejected by the trigger,
    // silently (the update's error was never checked), leaving the report stuck at whatever
    // status it already had — never actually flagged as needing manual submission. The API
    // response's own `status` field (returned to the caller below) keeps the more
    // descriptive "portal_unavailable" value — HMISPage.tsx's response handling only checks
    // for `=== "submitted"` and treats anything else as the manual-upload branch, so that
    // contract is unaffected. Found via Phase 6 edge-function testing.
    const dbStatus = submitStatus === "submitted" ? "submitted" : "generated";
    const { error: updateErr } = await supabase.from("hmis_reports").update({
      status: dbStatus,
      submitted_at: new Date().toISOString(),
      acknowledgment_ref: ackRef,
    } as any).eq("id", reportId);
    if (updateErr) console.error("hmis-portal-submit: report status update failed:", updateErr.message);

    return new Response(JSON.stringify({
      success: true,
      status: submitStatus,
      acknowledgment_ref: ackRef,
      message: submitStatus === "submitted"
        ? `Report submitted. Acknowledgment: ${ackRef}`
        : "Portal unreachable — report marked for manual upload. Download the Excel and submit via portal.",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("HMIS submit error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
