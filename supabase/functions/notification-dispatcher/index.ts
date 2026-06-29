// @ts-nocheck
// notification-dispatcher — Sprint 8C
//
// Cron function (runs every 2 minutes) that dispatches pending notifications
// from the notification_queue table to the appropriate send-* edge functions.
//
// Provides: deduplication (via dedup_key unique index), retry with exponential
// back-off, and dead-lettering after max_retries.
//
// Callers can insert directly into notification_queue for dedup + retry guarantees,
// OR continue calling send-* functions directly (backward-compatible).
//
// Schedule via pg_cron:
//   SELECT cron.schedule('aumrti-notification-dispatcher', '*/2 * * * *', $$
//     SELECT net.http_post(
//       url := 'https://[project-ref].supabase.co/functions/v1/notification-dispatcher',
//       headers := '{"Authorization": "Bearer [service-role-key]"}'::jsonb
//     )
//   $$);

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTIONS_URL = SUPABASE_URL.replace(".supabase.co", ".supabase.co/functions/v1");

// Exponential back-off delays in minutes: [2m, 10m, 30m]
const RETRY_DELAYS = [2, 10, 30];

const CHANNEL_TO_FUNCTION: Record<string, string> = {
  sms:       "send-sms",
  email:     "send-email",
  whatsapp:  "send-whatsapp-meta",
  push:      "send-push-notification",
};

async function dispatch(channel: string, entry: Record<string, unknown>): Promise<boolean> {
  const fnName = CHANNEL_TO_FUNCTION[channel];
  if (!fnName) return false;

  const body: Record<string, unknown> = {
    hospital_id: entry.hospital_id,
    ...(entry.metadata as Record<string, unknown> ?? {}),
  };

  if (channel === "sms") {
    body.to = entry.recipient;
    body.message = entry.body;
  } else if (channel === "email") {
    body.to = entry.recipient;
    body.subject = entry.subject ?? "Notification from Aumrti HMS";
    body.body_html = `<p>${String(entry.body).replace(/\n/g, "<br>")}</p>`;
    body.body_text = entry.body;
  } else if (channel === "whatsapp") {
    body.to = entry.recipient;
    body.message = entry.body;
  } else if (channel === "push") {
    body.token = entry.recipient;
    body.title = entry.subject ?? "Aumrti HMS";
    body.body = entry.body;
  }

  const res = await fetch(`${FUNCTIONS_URL}/${fnName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });

  return res.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const results = { dispatched: 0, failed: 0, dead: 0 };

  try {
    // Pick up to 50 pending/failed entries due for retry
    const { data: entries, error } = await db
      .from("notification_queue")
      .select("*")
      .in("status", ["pending", "failed"])
      .lte("next_retry_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) throw error;

    for (const entry of (entries ?? [])) {
      let success = false;
      let errorMsg = "";

      try {
        success = await dispatch(entry.channel, entry);
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`Dispatch failed for notification ${entry.id} (${entry.channel}):`, errorMsg);
      }

      if (success) {
        await db.from("notification_queue").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error: null,
        }).eq("id", entry.id);
        results.dispatched++;
      } else {
        const newRetryCount = entry.retry_count + 1;
        if (newRetryCount >= entry.max_retries) {
          await db.from("notification_queue").update({
            status: "dead",
            retry_count: newRetryCount,
            error: errorMsg || "Max retries exceeded",
          }).eq("id", entry.id);
          console.error(`Notification ${entry.id} exceeded max retries — marked DEAD`);
          results.dead++;
        } else {
          const delayMs = (RETRY_DELAYS[newRetryCount - 1] ?? 30) * 60_000;
          await db.from("notification_queue").update({
            status: "failed",
            retry_count: newRetryCount,
            next_retry_at: new Date(Date.now() + delayMs).toISOString(),
            error: errorMsg,
          }).eq("id", entry.id);
          results.failed++;
        }
      }
    }
  } catch (err) {
    console.error("notification-dispatcher error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }

  console.log(`Notification dispatcher: ${JSON.stringify(results)}`);
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
