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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    // Only hospital_admin or super_admin may edit another staff member's login credentials
    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("role, hospital_id")
      .eq("auth_user_id", caller.id)
      .maybeSingle();

    if (!callerProfile || !["hospital_admin", "super_admin"].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: "Only admins can edit a staff member's login credentials" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // This function doubles as both password-reset and email-change — one deployed
    // slot handles both since the project's function count is capped on the current
    // Supabase plan. Pass new_password and/or new_email; at least one is required.
    const { user_id, new_password, new_email } = await req.json();

    if (!user_id || (!new_password && !new_email)) {
      return new Response(JSON.stringify({ error: "user_id and (new_password or new_email) are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new_password && new_password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let normalizedEmail: string | undefined;
    if (new_email) {
      normalizedEmail = String(new_email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return new Response(JSON.stringify({ error: "Enter a valid email address" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Verify the target user belongs to the same hospital and has a login
    const { data: targetUser } = await supabaseAdmin
      .from("users")
      .select("id, hospital_id, auth_user_id")
      .eq("id", user_id)
      .maybeSingle();

    if (!targetUser) {
      return new Response(JSON.stringify({ error: "Staff member not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (targetUser.hospital_id !== callerProfile.hospital_id) {
      return new Response(JSON.stringify({ error: "Staff member belongs to a different hospital" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetUser.auth_user_id) {
      return new Response(JSON.stringify({ error: "This staff member has no login credentials yet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      targetUser.auth_user_id,
      {
        ...(new_password ? { password: new_password } : {}),
        ...(normalizedEmail ? { email: normalizedEmail, email_confirm: true } : {}),
      }
    );

    if (updateErr) {
      const msg = /already been registered|already exists/i.test(updateErr.message)
        ? "This email is already used by another login account."
        : updateErr.message;
      return new Response(JSON.stringify({ error: msg }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, email: normalizedEmail }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
