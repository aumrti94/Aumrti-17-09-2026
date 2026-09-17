/**
 * send-push-notification
 *
 * Sends FCM push notifications to registered devices for a hospital user.
 * Supports Android, iOS (via APNs through FCM), and Web Push.
 *
 * POST body:
 *   { hospital_id, user_id?, topic?, title, body, data?, image_url? }
 *
 * If user_id provided → sends to all active tokens for that user.
 * If topic provided → sends to FCM topic (e.g. "hospital_<id>_doctors").
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const fcmServerKey       = Deno.env.get("FCM_SERVER_KEY");

  if (!fcmServerKey) {
    return new Response(JSON.stringify({ error: "FCM_SERVER_KEY not configured. Set it in Supabase Vault." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    // Previously had no auth check at all — any request naming a hospital_id
    // and user_id could pull that user's FCM tokens and push an
    // attacker-controlled notification (title/body are also caller-supplied)
    // to their device. Found in the Phase 4 isolation audit — see
    // KNOWN_BUGS.md. Same fix shape as send-sms/index.ts: require a real
    // signed-in caller and verify hospital_id against THEIR record rather
    // than trusting the request body.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user }, error: authErr } = await db.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hospital_id, user_id, topic, title, body, data, image_url } = await req.json();

    if (!hospital_id || !title || !body) {
      return new Response(JSON.stringify({ error: "hospital_id, title, body are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: staff } = await db
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!staff || staff.hospital_id !== hospital_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let tokens: string[] = [];

    if (user_id) {
      // Fetch active FCM tokens for this user
      const { data: rows } = await db
        .from("fcm_tokens")
        .select("token")
        .eq("hospital_id", hospital_id)
        .eq("user_id", user_id)
        .eq("is_active", true);
      tokens = (rows || []).map((r: any) => r.token);
    }

    if (tokens.length === 0 && !topic) {
      return new Response(JSON.stringify({ sent: 0, message: "No active tokens found for user" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fcmPayload: any = {
      notification: {
        title,
        body,
        ...(image_url ? { image: image_url } : {}),
      },
      data: {
        hospital_id,
        ...(data || {}),
        click_action: "FLUTTER_NOTIFICATION_CLICK",
      },
      android: { priority: "high", notification: { sound: "default", channel_id: "clinical_alerts" } },
      apns: { payload: { aps: { sound: "default", badge: 1 } } },
    };

    let sentCount = 0;
    const errors: string[] = [];

    if (topic) {
      // Topic messaging
      fcmPayload.topic = topic;
      const fcmProjectId = Deno.env.get("FCM_PROJECT_ID") || "aumrti-hms";
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmProjectId}/messages:send`, {
        method: "POST",
        headers: {
          "Authorization": `key=${fcmServerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: fcmPayload }),
      });
      if (res.ok) sentCount++;
      else errors.push(await res.text());
    } else {
      // Per-token messaging (multicast via legacy API)
      const multicastPayload = {
        registration_ids: tokens,
        notification: fcmPayload.notification,
        data: fcmPayload.data,
        android: fcmPayload.android,
        apns: fcmPayload.apns,
      };

      const res = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: {
          "Authorization": `key=${fcmServerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(multicastPayload),
      });

      const result = await res.json();
      sentCount = result.success || 0;

      // Invalidate tokens that are no longer registered
      if (result.results) {
        const invalidTokens = tokens.filter((_, i) =>
          result.results[i]?.error === "NotRegistered" || result.results[i]?.error === "InvalidRegistration"
        );
        if (invalidTokens.length > 0) {
          await db.from("fcm_tokens").update({ is_active: false }).in("token", invalidTokens);
        }
      }
    }

    // Log push notification
    await db.from("push_notifications").insert({
      hospital_id,
      user_id: user_id || null,
      title,
      body,
      data: data || null,
      platform: "all",
      status: sentCount > 0 ? "sent" : "failed",
      error_message: errors.length ? errors.join("; ") : null,
    });

    return new Response(JSON.stringify({ sent: sentCount, total_tokens: tokens.length, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
