// send-sms — Standalone SMS dispatch via MSG91 (primary) with Twilio fallback.
// Callable from any module that needs to send an SMS notification.
// Credentials are read from Supabase secrets, never from the client payload.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    // Validate caller is a logged-in user
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Derive hospital_id from the authenticated user — never trust the payload
    const { data: userData } = await svc
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!userData?.hospital_id) return json({ error: "User record not found" }, 404);
    const hospitalId: string = userData.hospital_id;

    const body = await req.json();
    const rawPhone: string = String(body.phone ?? "").trim();
    if (!rawPhone) return json({ error: "phone is required" }, 400);

    const message: string = String(body.message ?? "").trim().slice(0, 459); // SMS max
    if (!message) return json({ error: "message is required" }, 400);

    const notificationId: string | null = body.notification_id ?? null;

    // Normalize to E.164 Indian format
    const digits = rawPhone.replace(/\D/g, "");
    const e164 = digits.startsWith("91") ? `+${digits}` : `+91${digits}`;
    if (digits.length < 10) return json({ error: "Invalid phone number" }, 400);

    const msg91Key = Deno.env.get("MSG91_API_KEY");
    const msg91Sender = Deno.env.get("MSG91_SENDER_ID") || "HOSPIT";
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") || "+1234567890";

    let status = "failed";
    let provider = "none";
    let messageId: string | null = null;
    let errorText: string | null = null;

    if (msg91Key) {
      try {
        const res = await fetch("https://api.msg91.com/api/v5/flow/", {
          method: "POST",
          headers: { "Content-Type": "application/json", "authkey": msg91Key },
          body: JSON.stringify({
            flow_id: Deno.env.get("MSG91_FLOW_ID_GENERIC") || "",
            sender: msg91Sender,
            mobiles: e164.replace("+", ""),
            body: message,
          }),
        });
        const d = await res.json();
        status = d.type === "success" ? "sent" : "failed";
        provider = "msg91";
        messageId = d.request_id ?? null;
        if (d.type !== "success") errorText = JSON.stringify(d);
      } catch (e: any) {
        errorText = e?.message ?? "MSG91 error";
      }
    } else if (twilioSid && twilioToken) {
      try {
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ From: twilioFrom, To: e164, Body: message }),
          },
        );
        const d = await res.json();
        status = d.status === "queued" || d.status === "sent" ? "sent" : "failed";
        provider = "twilio";
        messageId = d.sid ?? null;
        if (status === "failed") errorText = d.message ?? JSON.stringify(d);
      } catch (e: any) {
        errorText = e?.message ?? "Twilio error";
      }
    } else {
      errorText = "No SMS provider configured. Set MSG91_API_KEY or TWILIO_ACCOUNT_SID secret.";
      console.error(`send-sms: ${errorText}`);
    }

    // Log delivery attempt
    await svc.from("sms_notifications").insert({
      hospital_id: hospitalId,
      to_phone: e164,
      message,
      provider,
      message_id: messageId,
      status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      error_text: errorText,
      notification_id: notificationId,
    });

    return json({ success: status === "sent", provider, message_id: messageId, error: errorText });

  } catch (err: any) {
    console.error("send-sms error:", err);
    return json({ error: err.message }, 500);
  }
});
