import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { beneficiary_id, scheme_type, patient_id, hospital_id } = await req.json();

    if (!beneficiary_id || !scheme_type) {
      return new Response(JSON.stringify({ error: "beneficiary_id and scheme_type required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check existing enrollment record
    const { data: existing } = await sb
      .from("cghs_echs_beneficiaries")
      .select("*")
      .eq("beneficiary_id", beneficiary_id)
      .eq("scheme_type", scheme_type)
      .maybeSingle();

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
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
