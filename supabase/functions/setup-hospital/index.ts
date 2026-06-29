import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get authenticated user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { hospital, admin } = await req.json();

    if (!hospital?.name || !admin?.full_name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map bed count string to number
    const bedMap: Record<string, number> = {
      "under_30": 25, "30_50": 40, "51_100": 75,
      "101_200": 150, "201_500": 350, "500_plus": 600,
    };

    const typeMap: Record<string, string> = {
      "Private Hospital": "general",
      "Government Hospital": "general",
      "Trust / NGO Hospital": "general",
      "Corporate Hospital": "general",
      "Nursing Home": "nursing_home",
      "Clinic": "clinic",
      "Specialty Center": "specialty",
      "Dental Clinic": "clinic",
      "AYUSH Center": "clinic",
      "Other": "general",
    };

    const planMap: Record<string, string> = {
      starter: "basic",
      professional: "professional",
      enterprise: "enterprise",
    };

    // Insert hospital
    const { data: hospitalData, error: hospitalError } = await supabaseAdmin
      .from("hospitals")
      .insert({
        name: hospital.name,
        type: typeMap[hospital.type] || "general",
        state: hospital.state || null,
        beds_count: bedMap[hospital.bedCount] || 0,
        address: [hospital.address1, hospital.address2].filter(Boolean).join(", ") || null,
        pincode: hospital.pincode || null,
        gstin: hospital.gstin || null,
        nabh_number: hospital.nabhNumber || null,
        subscription_tier: planMap[hospital.plan] || "basic",
        country: "India",
        is_active: true,
      })
      .select("id")
      .maybeSingle();

    if (hospitalError || !hospitalData) {
      return new Response(
        JSON.stringify({ error: hospitalError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert user record linked to the authenticated user
    const { error: userError } = await supabaseAdmin
      .from("users")
      .insert({
        id: user.id,
        hospital_id: hospitalData.id,
        full_name: admin.full_name,
        email: user.email || admin.email,
        phone: admin.phone || null,
        role: "hospital_admin",
        is_active: true,
      });

    if (userError) {
      // Cleanup hospital
      await supabaseAdmin.from("hospitals").delete().eq("id", hospitalData.id);
      return new Response(
        JSON.stringify({ error: userError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Seed chart of accounts, posting rules, and lab catalog (defence in depth)
    await supabaseAdmin.rpc("seed_hospital_defaults", {
      p_hospital_id: hospitalData.id,
    }).catch(() => {}); // non-fatal — trigger also fires on INSERT

    return new Response(
      JSON.stringify({ success: true, hospitalId: hospitalData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
