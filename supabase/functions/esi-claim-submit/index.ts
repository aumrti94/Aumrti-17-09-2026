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
    // This function had no auth check at all — any request naming another
    // hospital's id could file a government ESI claim for that hospital's
    // patient. Found in the Phase 4 isolation audit — see KNOWN_BUGS.md.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hospital_id, patient_id, admission_id, claimed_amount, procedure_codes, ip_number } = await req.json();

    if (!hospital_id || !patient_id || !claimed_amount) {
      return new Response(JSON.stringify({ error: "hospital_id, patient_id, claimed_amount required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: staff } = await sb
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!staff || staff.hospital_id !== hospital_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify patient has ESI enrollment
    const { data: esi } = await sb
      .from("esi_beneficiaries")
      .select("*")
      .eq("patient_id", patient_id)
      .eq("hospital_id", hospital_id)
      .eq("status", "active")
      .maybeSingle();

    if (!esi) {
      return new Response(JSON.stringify({
        success: false,
        error: "No active ESI enrollment found for this patient.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Generate claim number (in production would call ESIC portal API)
    const claimNumber = `ESI-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;

    // Create claim record
    const { data: claim, error } = await sb
      .from("govt_scheme_claims")
      .insert({
        hospital_id,
        patient_id,
        admission_id: admission_id || null,
        scheme_type: "ESI",
        claim_number: claimNumber,
        procedure_codes: procedure_codes || [],
        claimed_amount,
        status: "submitted",
        submitted_at: new Date().toISOString(),
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    // Checklist validation
    const checklist = {
      ip_number_verified: !!ip_number || !!(esi.ip_number),
      dispensary_referral: !!esi.dispensary_code,
      claim_amount_valid: claimed_amount > 0 && claimed_amount <= 500000,
    };

    return new Response(JSON.stringify({
      success: true,
      claim_id: claim.id,
      claim_number: claimNumber,
      status: "submitted",
      checklist,
      message: "ESI claim submitted successfully. Reference: " + claimNumber,
      esic_portal: "https://www.esic.in",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("esi-claim-submit error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
