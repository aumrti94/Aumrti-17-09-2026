import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user: caller }, error: authErr } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only hospital_admin or super_admin may reset MFA
    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("role, hospital_id")
      .eq("auth_user_id", caller.id)
      .maybeSingle();

    if (!callerProfile || !["hospital_admin", "super_admin"].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: "Only admins can reset MFA" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { auth_user_id } = await req.json();
    if (!auth_user_id) {
      return new Response(JSON.stringify({ error: "auth_user_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirm target belongs to same hospital
    const { data: targetUser } = await supabaseAdmin
      .from("users")
      .select("id, hospital_id")
      .eq("auth_user_id", auth_user_id)
      .maybeSingle();

    if (!targetUser) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (targetUser.hospital_id !== callerProfile.hospital_id) {
      return new Response(JSON.stringify({ error: "User belongs to a different hospital" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // List all MFA factors via the Auth Admin REST API
    const listRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${auth_user_id}/factors`,
      { headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` } }
    );

    if (!listRes.ok) {
      const msg = await listRes.text();
      return new Response(JSON.stringify({ error: `Failed to list factors: ${msg}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await listRes.json();
    const factors: any[] = Array.isArray(body) ? body : (body?.factors ?? []);

    // Delete every TOTP factor found
    let deleted = 0;
    for (const factor of factors) {
      if (factor.factor_type === "totp") {
        const delRes = await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${auth_user_id}/factors/${factor.id}`,
          {
            method: "DELETE",
            headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` },
          }
        );
        if (delRes.ok) deleted++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, factors_removed: deleted }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
