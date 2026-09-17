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
        JSON.stringify({ error: hospitalError?.message ?? "Failed to create hospital record" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Seed default role permissions for the new hospital — must happen
    // before the user insert below, since users.role now has a foreign key
    // into role_permissions(hospital_id, role_name).
    await supabaseAdmin.rpc("seed_default_roles_for_hospital", {
      p_hospital_id: hospitalData.id,
    });

    // Insert user record linked to the authenticated user.
    // Was `id: user.id` with no `auth_user_id` set at all — conflating public.users.id with
    // the auth uid (the two are deliberately separate identifiers; see CLAUDE.md, migration
    // 20260322111223) and leaving `auth_user_id` null. Since every RLS policy and
    // `get_user_hospital_id()` itself resolve a caller via `.eq("auth_user_id", auth.uid())`,
    // a user created this way could never actually be resolved anywhere else in the app —
    // the hospital and auth account would exist, but the admin would be functionally locked
    // out immediately. No caller of this function exists anywhere in src/ today (confirmed by
    // grep), so this has not yet caused live harm, but the bug is real. Found via Phase 6
    // Priority-4 (tenant lifecycle) edge-function testing.
    const { error: userError } = await supabaseAdmin
      .from("users")
      .insert({
        id: crypto.randomUUID(),
        auth_user_id: user.id,
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

    // Seed chart of accounts, posting rules, and lab catalog (defence in depth).
    // Was `.rpc(...).catch(() => {})` — `.rpc()` returns the same non-Promise
    // PostgrestBuilder as `.from()` (confirmed: no real `.catch()`, unlike
    // `.functions.invoke()`, which genuinely is a Promise) — so this threw synchronously on
    // EVERY call, crashing this handler with a 500 after the hospital and user had already
    // been created successfully. Found via Phase 6 edge-function testing.
    try {
      await supabaseAdmin.rpc("seed_hospital_defaults", { p_hospital_id: hospitalData.id });
    } catch (_) { /* non-fatal — trigger also fires on INSERT */ }

    return new Response(
      JSON.stringify({ success: true, hospitalId: hospitalData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("setup-hospital error:", err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
