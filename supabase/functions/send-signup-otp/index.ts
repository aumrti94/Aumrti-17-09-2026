// @ts-nocheck
// send-signup-otp — Platform-level OTP dispatch for the /register signup wizard.
//
// There is NO tenant/hospital and NO logged-in user at signup, so the per-hospital
// send paths (send-whatsapp-meta, send-sms) cannot be used. This function generates a
// 6-digit code server-side, stores only its SHA-256 hash in signup_otp_verifications,
// and delivers it via the first configured provider:
//   1. Meta WhatsApp Cloud API authentication TEMPLATE  (real WhatsApp — preferred)
//   2. MSG91 OTP API (SMS)
//   3. Twilio SMS
//   4. Dev fallback (returns the code in the response) — ONLY when ALLOW_OTP_DEV_FALLBACK="true"
//
// Required Supabase secrets for WhatsApp delivery (set once, platform-wide):
//   PLATFORM_META_PHONE_NUMBER_ID, PLATFORM_META_ACCESS_TOKEN, PLATFORM_META_OTP_TEMPLATE
//   (optional) PLATFORM_META_OTP_TEMPLATE_LANG  (default "en")
// SMS fallback: MSG91_API_KEY + MSG91_OTP_TEMPLATE_ID, or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// In-memory IP rate limiter: max 10 OTP requests per IP per hour.
const ipRateMap = new Map<string, { count: number; resetAt: number }>();
function checkIpRate(ip: string): boolean {
  const now = Date.now();
  const e = ipRateMap.get(ip);
  if (!e || now > e.resetAt) {
    ipRateMap.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (e.count >= 10) return false;
  e.count++;
  return true;
}

function normalizeIndianMobile(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Provider sends ─────────────────────────────────────────────────────────────
// Each returns { ok, channel, provider, error } and never throws.

interface MetaCreds {
  phoneNumberId?: string | null;
  accessToken?: string | null;
  templateName?: string | null;
  lang?: string | null;
}

async function sendViaMeta(phone10: string, code: string, creds: MetaCreds) {
  // DB (platform_settings) is the source of truth; env vars are a fallback.
  const phoneNumberId = creds.phoneNumberId || Deno.env.get("PLATFORM_META_PHONE_NUMBER_ID");
  const accessToken = creds.accessToken || Deno.env.get("PLATFORM_META_ACCESS_TOKEN");
  const templateName = creds.templateName || Deno.env.get("PLATFORM_META_OTP_TEMPLATE");
  const lang = creds.lang || Deno.env.get("PLATFORM_META_OTP_TEMPLATE_LANG") || "en";
  if (!phoneNumberId || !accessToken || !templateName) return null; // not configured

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: `91${phone10}`,
        type: "template",
        template: {
          name: templateName,
          language: { code: lang },
          // Meta "authentication" templates require the code in the body AND in the
          // copy-code button (sub_type "url", index 0).
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: code }] },
          ],
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, channel: "whatsapp", provider: "meta" };
    return { ok: false, channel: "whatsapp", provider: "meta", error: body?.error?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, channel: "whatsapp", provider: "meta", error: String(e?.message ?? e) };
  }
}

async function sendViaMsg91(phone10: string, code: string) {
  const authkey = Deno.env.get("MSG91_API_KEY");
  const templateId = Deno.env.get("MSG91_OTP_TEMPLATE_ID");
  if (!authkey || !templateId) return null; // not configured

  try {
    // MSG91 OTP API — we pass our own code so it matches the hash we stored.
    const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=91${phone10}&otp=${code}&authkey=${encodeURIComponent(authkey)}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d?.type === "success") return { ok: true, channel: "sms", provider: "msg91" };
    return { ok: false, channel: "sms", provider: "msg91", error: JSON.stringify(d) };
  } catch (e) {
    return { ok: false, channel: "sms", provider: "msg91", error: String(e?.message ?? e) };
  }
}

async function sendViaTwilio(phone10: string, code: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) return null; // not configured

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from,
        To: `+91${phone10}`,
        Body: `Your Aumrti verification code is ${code}. Valid for 10 minutes. Do not share it with anyone.`,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && (d.status === "queued" || d.status === "sent")) return { ok: true, channel: "sms", provider: "twilio" };
    return { ok: false, channel: "sms", provider: "twilio", error: d?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, channel: "sms", provider: "twilio", error: String(e?.message ?? e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!checkIpRate(clientIp)) {
    return json({ error: "Too many code requests. Please try again later." }, 429);
  }

  try {
    const { phone } = await req.json();
    const phone10 = normalizeIndianMobile(phone || "");
    if (!phone10) return json({ error: "Enter a valid 10-digit Indian mobile number." }, 400);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Platform WhatsApp credentials (managed from Platform → Settings). DB is the source
    // of truth; sendViaMeta falls back to PLATFORM_META_* env secrets when these are null.
    const { data: settings } = await svc
      .from("platform_settings")
      .select("meta_phone_number_id, meta_access_token, meta_otp_template, meta_otp_template_lang")
      .limit(1)
      .maybeSingle();
    const metaCreds = {
      phoneNumberId: settings?.meta_phone_number_id ?? null,
      accessToken: settings?.meta_access_token ?? null,
      templateName: settings?.meta_otp_template ?? null,
      lang: settings?.meta_otp_template_lang ?? null,
    };

    // Per-phone throttle: max 5 sends per phone per rolling hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentSends } = await svc
      .from("signup_otp_verifications")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone10)
      .gte("created_at", oneHourAgo);
    if ((recentSends ?? 0) >= 5) {
      return json({ error: "Too many codes sent to this number. Please try again in an hour." }, 429);
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await sha256(code);

    // Try providers in priority order; first configured one wins.
    let result =
      (await sendViaMeta(phone10, code, metaCreds)) ||
      (await sendViaMsg91(phone10, code)) ||
      (await sendViaTwilio(phone10, code));

    const devFallback = Deno.env.get("ALLOW_OTP_DEV_FALLBACK") === "true";
    let devCode: string | undefined;

    if (!result) {
      // No provider configured at all.
      if (!devFallback) {
        console.error("send-signup-otp: no OTP provider configured and dev fallback disabled");
        return json({ error: "OTP delivery is not configured. Please contact support." }, 503);
      }
      result = { ok: true, channel: "dev", provider: "dev" };
      devCode = code;
    } else if (!result.ok) {
      // A provider was configured but the send failed.
      console.error("send-signup-otp: provider send failed", result.provider, result.error);
      if (devFallback) {
        result = { ok: true, channel: "dev", provider: "dev" };
        devCode = code;
      } else {
        return json({ error: "Could not send the verification code. Please try again." }, 502);
      }
    }

    const { error: insErr } = await svc.from("signup_otp_verifications").insert({
      phone: phone10,
      otp_hash: otpHash,
      channel: result.channel,
      provider: result.provider,
      send_count: (recentSends ?? 0) + 1,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      request_ip: clientIp,
    });
    if (insErr) {
      console.error("send-signup-otp: insert failed", insErr);
      return json({ error: "Could not start verification. Please try again." }, 500);
    }

    return json({ success: true, channel: result.channel, ...(devCode ? { devCode } : {}) });
  } catch (err) {
    console.error("send-signup-otp error:", err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});
