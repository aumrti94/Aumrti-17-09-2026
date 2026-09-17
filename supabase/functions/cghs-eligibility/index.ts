import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    // Previously had NO auth check at all, and no hospital scoping on the query below —
    // the same "no auth check at all" defect class the Phase 4 isolation audit found and
    // fixed 24 times over (KNOWN-BUG-126), missed here entirely (this function was never
    // in that audit's 107-function list output). Any unauthenticated caller who knew or
    // guessed a beneficiary_id could retrieve a government employee's/dependent's full
    // CGHS/ECHS beneficiary record — name, employee name, card numbers, entitlement group,
    // ward entitlement — for ANY hospital, with no login required at all. Found via Phase 6
    // edge-function testing.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const anonSb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonSb.auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: staff } = await sb.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!staff) return new Response(JSON.stringify({ error: "User record not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const callerHospitalId = staff.hospital_id as string;

    const { beneficiary_id, scheme_type, patient_id, hospital_id } = await req.json();

    if (hospital_id && hospital_id !== callerHospitalId) {
      return new Response(JSON.stringify({ error: "Forbidden: hospital_id does not match authenticated user" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The ONLY real caller (ClaimsPackWizard.tsx) sends { patient_id, hospital_id } — never
    // beneficiary_id/scheme_type, so the OLD "beneficiary_id and scheme_type required" 400
    // fired on every single real invocation, ever. A hospital records a patient's CGHS/ECHS
    // enrollment against their patient_id at intake (cghs_echs_beneficiaries.patient_id), so
    // looking up by (patient_id, hospital_id) is both what the real caller has on hand and
    // what the schema was already built to support — explicit beneficiary_id/scheme_type
    // (e.g. a future portal-driven lookup) is still accepted if provided. Found via Phase 6.
    if (!beneficiary_id && !patient_id) {
      return new Response(JSON.stringify({ error: "beneficiary_id or patient_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check existing enrollment record — always scoped to the caller's own hospital.
    let query = sb.from("cghs_echs_beneficiaries").select("*").eq("hospital_id", callerHospitalId);
    query = beneficiary_id
      ? query.eq("beneficiary_id", beneficiary_id).eq("scheme_type", scheme_type ?? "CGHS")
      : query.eq("patient_id", patient_id);
    const { data: existing } = await query.maybeSingle();

    if (existing) {
      const isExpired = existing.valid_till && new Date(existing.valid_till) < new Date();
      return new Response(JSON.stringify({
        eligible: existing.status === "active" && !isExpired,
        status: isExpired ? "expired" : existing.status,
        beneficiary: existing,
        message: isExpired
          ? "Card expired. Please renew at nearest CGHS wellness centre."
          : existing.status === "active"
          ? "Beneficiary is eligible for cashless treatment."
          : `Beneficiary status: ${existing.status}`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Not found locally — simulate online check response
    // In production this would call the CGHS/ECHS portal API
    return new Response(JSON.stringify({
      eligible: false,
      status: "not_enrolled",
      message: "Beneficiary not found in local records. Verify card at CGHS portal.",
      portal_url: scheme_type === "CGHS"
        ? "https://cghs.nic.in/cghs_login_2013.htm"
        : "https://echs.gov.in",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("cghs-eligibility error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
