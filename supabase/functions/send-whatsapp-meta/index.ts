// Production WhatsApp send path for hospitals on the direct Meta Cloud API provider.
// Credentials (meta_access_token) are read here with the service-role key and never
// returned to the caller — the client only ever sees { success, provider, messageId }.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone, sanitizeMessage, sendMetaSession, sendMetaTemplate } from "../_shared/whatsapp-meta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function errResp(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return errResp("Unauthorized", 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) return errResp("Unauthorized", 401);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Hospital is derived from the caller's own user record — never trust a client-supplied hospitalId.
    const { data: userData } = await svc
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!userData) return errResp("User record not found", 404);

    const body = await req.json();
    const cleanPhone = normalizePhone(String(body.phone ?? "").trim());
    if (!cleanPhone) {
      return errResp("Invalid phone number. Use +91XXXXXXXXXX or a 10-digit Indian mobile.");
    }

    const { data: hospital } = await svc
      .from("hospitals")
      .select("whatsapp_provider, whatsapp_enabled, meta_phone_number_id, meta_access_token")
      .eq("id", userData.hospital_id)
      .maybeSingle();

    const h = hospital as any;
    if (!h?.whatsapp_enabled || h?.whatsapp_provider !== "meta_cloud") {
      return errResp("Meta Cloud API is not the active WhatsApp provider for this hospital.", 422);
    }
    if (!h.meta_phone_number_id || !h.meta_access_token) {
      return errResp("Meta Cloud API credentials are not configured. Set them in Settings → WhatsApp.", 422);
    }

    const sendType = body.type === "template" ? "template" : "session";
    let result;

    if (sendType === "template") {
      const templateName = String(body.metaTemplateName ?? "");
      if (!templateName) return errResp("metaTemplateName is required for template sends.");
      const bodyParams: string[] = Array.isArray(body.parameters)
        ? body.parameters.map((p: any) => String(p?.value ?? ""))
        : [];
      result = await sendMetaTemplate(
        h.meta_phone_number_id,
        h.meta_access_token,
        cleanPhone,
        templateName,
        String(body.languageCode || "en"),
        bodyParams,
      );
    } else {
      const cleanMessage = sanitizeMessage(String(body.message ?? ""));
      if (!cleanMessage) return errResp("Message text is required.");
      result = await sendMetaSession(h.meta_phone_number_id, h.meta_access_token, cleanPhone, cleanMessage);
    }

    if (body.notificationId) {
      await svc
        .from("whatsapp_notifications")
        .update({ sent_at: result.success ? new Date().toISOString() : null } as any)
        .eq("id", body.notificationId);
    }

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-whatsapp-meta error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
