import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone, sanitizeMessage, sendMetaSession } from "../_shared/whatsapp-meta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_ROLES = new Set(["super_admin", "hospital_admin"]);

// ── Provider send helpers ─────────────────────────────────────────────────────

type SendResult = { success: boolean; provider: string; messageId?: string | null; error?: string };

async function sendViaWati(apiUrl: string, apiKey: string, phone: string, message: string): Promise<SendResult> {
  // WATI session message API requires an active 24-h window (user messaged first).
  // For production sends use sendTemplateMessage. Session is fine for same-number testing.
  const e164 = phone.replace(/^\+/, ""); // WATI omits leading +
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/v1/sendSessionMessage/${e164}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messageText: message }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    success: res.ok,
    provider: "WATI",
    messageId: (body as any)?.messages?.[0]?.id ?? null,
    error: res.ok ? "" : String((body as any)?.errors?.[0] ?? `HTTP ${res.status}`),
  };
}

async function sendViaInterakt(connector: Record<string, string>, phone: string, message: string): Promise<SendResult> {
  const digits = phone.replace(/^\+/, "");
  const countryCode = `+${digits.slice(0, 2)}`;
  const number = digits.slice(2);
  const res = await fetch("https://api.interakt.ai/v1/public/message/", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${connector.api_key}:`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      countryCode,
      phoneNumber: number,
      callbackData: "hms_test",
      type: "Text",
      data: { message },
    }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    success: res.ok,
    provider: "Interakt",
    messageId: (body as any)?.id ?? null,
    error: res.ok ? "" : String((body as any)?.message ?? `HTTP ${res.status}`),
  };
}

async function sendViaGupshup(connector: Record<string, string>, phone: string, message: string): Promise<SendResult> {
  const dest = phone.replace(/^\+/, "");
  const form = new URLSearchParams({
    channel: "whatsapp",
    source: connector.sender_number ?? "",
    destination: dest,
    "src.name": "HMS",
    message: JSON.stringify({ type: "text", text: message }),
  });
  const res = await fetch("https://api.gupshup.io/wa/api/v1/msg", {
    method: "POST",
    headers: { apikey: connector.api_key, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = await res.json().catch(() => ({}));
  return {
    success: res.ok && (body as any)?.status === "submitted",
    provider: "Gupshup",
    messageId: (body as any)?.messageId ?? null,
    error: res.ok ? "" : String((body as any)?.message ?? `HTTP ${res.status}`),
  };
}

async function sendViaTwilio(connector: Record<string, string>, phone: string, message: string): Promise<SendResult> {
  // api_key = Account SID, api_secret = Auth Token (Twilio convention)
  const form = new URLSearchParams({
    From: `whatsapp:${connector.sender_number ?? ""}`,
    To: `whatsapp:${phone}`,
    Body: message,
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${connector.api_key}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${connector.api_key}:${connector.api_secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );
  const body = await res.json().catch(() => ({}));
  return {
    success: res.ok,
    provider: "Twilio",
    messageId: (body as any)?.sid ?? null,
    error: res.ok ? "" : String((body as any)?.message ?? `HTTP ${res.status}`),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

function errResp(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── 1. Authenticate ──────────────────────────────────────────────────────
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

    // Service-role client for sensitive column reads (wati_api_key, connector credentials)
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 2. Authorise — hospital admin only ───────────────────────────────────
    const { data: userData } = await svc
      .from("users")
      .select("id, hospital_id, role")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!userData) return errResp("User record not found", 404);
    if (!ADMIN_ROLES.has(userData.role)) {
      return errResp("Forbidden — only hospital admins may send test messages", 403);
    }

    // ── 3. Validate & sanitize inputs ────────────────────────────────────────
    const { phone, message } = await req.json();

    const cleanPhone = normalizePhone(String(phone ?? "").trim());
    if (!cleanPhone) {
      return errResp("Invalid phone number. Use +91XXXXXXXXXX or a 10-digit Indian mobile.");
    }

    const cleanMessage = sanitizeMessage(String(message ?? ""));
    if (!cleanMessage) return errResp("Message text is required.");

    const { hospital_id: hospitalId } = userData;

    // ── 4. Resolve active provider ───────────────────────────────────────────
    // Priority: dedicated Meta Cloud config (Settings → WhatsApp) → WATI (hospitals table)
    // → active whatsapp_connector (Integrations Hub, for Interakt/Gupshup/Twilio/legacy Meta setups)
    const [{ data: hospital }, { data: waConnector }] = await Promise.all([
      svc.from("hospitals")
        .select("wati_api_url, wati_api_key, whatsapp_provider, meta_phone_number_id, meta_access_token")
        .eq("id", hospitalId).maybeSingle(),
      svc.from("whatsapp_connectors")
        .select("provider, api_key, api_secret, sender_number, base_url")
        .eq("hospital_id", hospitalId)
        .eq("active", true)
        .maybeSingle(),
    ]);

    // ── 5. Send ──────────────────────────────────────────────────────────────
    let result: SendResult;

    const h = hospital as any;
    if (h?.whatsapp_provider === "meta_cloud" && h?.meta_phone_number_id && h?.meta_access_token) {
      result = await sendMetaSession(h.meta_phone_number_id, h.meta_access_token, cleanPhone, cleanMessage);
    } else if (h?.wati_api_url && h?.wati_api_key) {
      result = await sendViaWati(h.wati_api_url, h.wati_api_key, cleanPhone, cleanMessage);
    } else if (waConnector) {
      const c = waConnector as any;
      switch (c.provider) {
        case "interakt":   result = await sendViaInterakt(c, cleanPhone, cleanMessage); break;
        case "gupshup":    result = await sendViaGupshup(c, cleanPhone, cleanMessage); break;
        case "twilio":     result = await sendViaTwilio(c, cleanPhone, cleanMessage); break;
        case "meta_cloud": result = await sendMetaSession(c.sender_number ?? "", c.api_key, cleanPhone, cleanMessage); break;
        default:
          result = { success: false, provider: c.provider, error: "Provider not yet supported for direct test sends." };
      }
    } else {
      return errResp(
        "No WhatsApp provider configured. Connect WATI or enable a provider in Settings → Integrations.",
        422,
      );
    }

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-whatsapp-test error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
