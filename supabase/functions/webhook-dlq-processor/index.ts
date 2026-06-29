// @ts-nocheck
// webhook-dlq-processor — Sprint 7D
//
// Cron function (runs every 15 minutes) that picks up failed webhook deliveries
// from webhook_dlq and re-invokes the original webhook handler.
//
// Schedule: add to supabase/config.toml or via pg_cron:
//   SELECT cron.schedule('webhook-dlq-retry', '*/15 * * * *', $$
//     SELECT net.http_post(
//       url := 'https://[project-ref].supabase.co/functions/v1/webhook-dlq-processor',
//       headers := '{"Authorization": "Bearer [service-role-key]"}'::jsonb
//     )
//   $$);

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTIONS_URL = SUPABASE_URL.replace(".supabase.co", ".supabase.co/functions/v1");

// Exponential back-off: [5m, 15m, 1h, 4h, 12h]
const RETRY_DELAYS_MINUTES = [5, 15, 60, 240, 720];

const SOURCE_TO_FUNCTION: Record<string, string> = {
  razorpay_payment:      "razorpay-webhook",
  razorpay_subscription: "razorpay-subscription-webhook",
};

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

  // Pick up to 20 DLQ entries that are due for retry
  const { data: entries, error } = await db
    .from("webhook_dlq")
    .select("*")
    .in("status", ["pending", "retrying"])
    .lte("next_retry_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("DLQ fetch error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!entries || entries.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  let resolved = 0;
  let dead = 0;
  let retried = 0;

  for (const entry of entries) {
    const fnName = SOURCE_TO_FUNCTION[entry.source];
    if (!fnName) {
      console.warn(`No handler for DLQ source: ${entry.source}`);
      continue;
    }

    let success = false;
    try {
      const res = await fetch(`${FUNCTIONS_URL}/${fnName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify(entry.payload),
      });
      success = res.ok;
      if (!success) {
        const body = await res.text().catch(() => "");
        console.error(`DLQ retry failed for ${entry.id}: ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (fetchErr) {
      console.error(`DLQ network error for ${entry.id}:`, fetchErr);
    }

    if (success) {
      await db.from("webhook_dlq").update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
      }).eq("id", entry.id);
      resolved++;
    } else {
      const newRetryCount = entry.retry_count + 1;
      if (newRetryCount >= entry.max_retries) {
        // Give up — mark dead and alert via console (Supabase logs → Slack/PagerDuty in production)
        await db.from("webhook_dlq").update({
          status: "dead",
          retry_count: newRetryCount,
        }).eq("id", entry.id);
        console.error(`DLQ entry ${entry.id} (${entry.source}/${entry.event_type}) exceeded max retries — marked DEAD`);
        dead++;
      } else {
        const delayMinutes = RETRY_DELAYS_MINUTES[newRetryCount - 1] ?? 720;
        const nextRetry = new Date(Date.now() + delayMinutes * 60_000).toISOString();
        await db.from("webhook_dlq").update({
          status: "retrying",
          retry_count: newRetryCount,
          next_retry_at: nextRetry,
        }).eq("id", entry.id);
        retried++;
      }
    }
  }

  console.log(`DLQ processor: resolved=${resolved}, retried=${retried}, dead=${dead}`);

  return new Response(
    JSON.stringify({ processed: entries.length, resolved, retried, dead }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
