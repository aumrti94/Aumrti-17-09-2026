// admin-impersonate-start — audited "view as hospital" for aumrti_admins.
//
// Design note: this does NOT bypass RLS or add any cross-tenant read policy.
// It generates a real, short-lived session for one of the TARGET hospital's
// own existing staff accounts (their real super_admin, or the oldest active
// user if none), the same way "login as" features work at most SaaS
// companies (e.g. django-hijack). Every existing RLS policy keeps working
// unchanged, because get_user_hospital_id() correctly resolves to that
// user's own hospital — nothing is bypassed, and the fact this only works
// through a real staff account is itself a safety property, not a
// limitation. Every start/end is written to admin_audit_log.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user: caller }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !caller) return json({ error: "Unauthorized" }, 401);

    const { data: adminRow } = await admin
      .from("aumrti_admins")
      .select("id, full_name")
      .eq("auth_user_id", caller.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!adminRow) return json({ error: "Forbidden: aumrti_admin role required" }, 403);

    const { hospital_id } = await req.json();
    if (!hospital_id) return json({ error: "hospital_id is required" }, 400);

    const { data: hospital } = await admin.from("hospitals").select("id, name").eq("id", hospital_id).maybeSingle();
    if (!hospital) return json({ error: "Hospital not found" }, 404);

    // Prefer the hospital's own super_admin; fall back to the oldest active user.
    const { data: candidates } = await admin
      .from("users")
      .select("id, auth_user_id, email, full_name, role")
      .eq("hospital_id", hospital_id)
      .eq("is_active", true)
      .not("auth_user_id", "is", null)
      .order("role", { ascending: true }) // 'super_admin' sorts before most other role strings
      .limit(20);

    const target = (candidates || []).find((c) => c.role === "super_admin") || (candidates || [])[0];
    if (!target?.email) {
      return json({ error: "No active staff account with a login found for this hospital — nothing to impersonate." }, 404);
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: target.email,
    });
    if (linkErr || !linkData) return json({ error: `Failed to create impersonation session: ${linkErr?.message}` }, 500);

    await admin.from("admin_audit_log").insert({
      admin_id: adminRow.id,
      admin_name: adminRow.full_name,
      action: "impersonation_start",
      target_hospital_id: hospital_id,
      target_hospital_name: hospital.name,
      details: { impersonated_user_id: target.id, impersonated_email: target.email, impersonated_role: target.role },
    });

    return json({
      hashed_token: (linkData.properties as any)?.hashed_token,
      hospital_name: hospital.name,
      impersonated_name: target.full_name,
      impersonated_role: target.role,
    });
  } catch (err) {
    console.error("admin-impersonate-start error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
