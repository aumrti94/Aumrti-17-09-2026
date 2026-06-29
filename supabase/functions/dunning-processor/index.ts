// @ts-nocheck
// dunning-processor — Sprint 8B
//
// Cron function (runs every 12 hours) that manages the dunning cadence for
// past_due subscriptions BEFORE trial-lifecycle-cron suspends them on day 7.
//
// Dunning cadence (relative to past_due transition date):
//   Day 1:  Email (payment_failed template)
//   Day 2:  Email + WhatsApp
//   Day 4:  Email + SMS
//   Day 6:  Email to admin + flag for manual follow-up
//   Day 7+: trial-lifecycle-cron suspends (already built)
//
// Does NOT double-fire: checks dunning_attempts for each hospital before sending.
//
// Schedule via pg_cron:
//   SELECT cron.schedule('aumrti-dunning', '0 6,18 * * *', $$
//     SELECT net.http_post(
//       url := 'https://[project-ref].supabase.co/functions/v1/dunning-processor',
//       headers := '{"Authorization": "Bearer [service-role-key]"}'::jsonb
//     )
//   $$);

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTIONS_URL = SUPABASE_URL.replace(".supabase.co", ".supabase.co/functions/v1");

interface Attempt { attempt_number: number; channel: string }

const CADENCE: Record<number, Attempt[]> = {
  1: [{ attempt_number: 1, channel: "email" }],
  2: [{ attempt_number: 2, channel: "email" }, { attempt_number: 2, channel: "whatsapp" }],
  4: [{ attempt_number: 3, channel: "email" }, { attempt_number: 3, channel: "sms" }],
  6: [{ attempt_number: 4, channel: "email" }],
};

async function invoke(fnName: string, body: Record<string, unknown>) {
  await fetch(`${FUNCTIONS_URL}/${fnName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
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
  const results = { processed: 0, attempts_sent: 0, errors: 0 };

  try {
    // Fetch all past_due subscriptions that are in the 1–6 day window
    const { data: subs } = await db
      .from("hospital_subscriptions")
      .select(`
        id,
        hospital_id,
        updated_at,
        hospitals!inner(name),
        hospital_id
      `)
      .eq("status", "past_due")
      .gte("updated_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .lte("updated_at", new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString());

    for (const sub of (subs ?? [])) {
      const daysPastDue = Math.floor(
        (Date.now() - new Date(sub.updated_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      const schedule = CADENCE[daysPastDue];
      if (!schedule) continue;

      // Check if this day's dunning already sent for this hospital
      const { data: existing } = await db
        .from("dunning_attempts")
        .select("id")
        .eq("hospital_id", sub.hospital_id)
        .eq("attempt_number", schedule[0].attempt_number)
        .limit(1);

      if (existing && existing.length > 0) continue; // already sent today

      // Fetch admin contact
      const { data: admin } = await db
        .from("users")
        .select("email, full_name, phone")
        .eq("hospital_id", sub.hospital_id)
        .eq("role", "hospital_admin")
        .limit(1)
        .maybeSingle();

      if (!admin) continue;

      results.processed++;

      for (const attempt of schedule) {
        let sent = false;
        try {
          if (attempt.channel === "email") {
            await invoke("send-subscription-notification", {
              event: "payment_failed",
              hospital_id: sub.hospital_id,
              email: admin.email,
              full_name: admin.full_name,
            });
            sent = true;
          } else if (attempt.channel === "sms" && admin.phone) {
            await invoke("send-sms", {
              to: admin.phone,
              message: `Aumrti HMS: Payment overdue for your hospital. Please update payment to avoid service suspension. Login at app.aumrti.com`,
              hospital_id: sub.hospital_id,
            });
            sent = true;
          } else if (attempt.channel === "whatsapp" && admin.phone) {
            await invoke("send-whatsapp-meta", {
              to: admin.phone,
              message: `⚠️ Aumrti HMS: Your subscription payment is overdue. Please renew to avoid service disruption. Visit app.aumrti.com`,
              hospital_id: sub.hospital_id,
            });
            sent = true;
          }

          if (sent) {
            await db.from("dunning_attempts").insert({
              hospital_id: sub.hospital_id,
              subscription_id: sub.id,
              attempt_number: attempt.attempt_number,
              channel: attempt.channel,
              status: "sent",
            });
            results.attempts_sent++;
          }
        } catch (err) {
          console.error(`Dunning attempt failed for ${sub.hospital_id}/${attempt.channel}:`, err);
          await db.from("dunning_attempts").insert({
            hospital_id: sub.hospital_id,
            subscription_id: sub.id,
            attempt_number: attempt.attempt_number,
            channel: attempt.channel,
            status: "failed",
            error_message: err instanceof Error ? err.message : String(err),
          });
          results.errors++;
        }
      }
    }
  } catch (err) {
    console.error("dunning-processor error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }

  console.log(`Dunning processor: ${JSON.stringify(results)}`);
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
