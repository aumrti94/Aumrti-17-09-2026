// @ts-nocheck
// dunning-processor — Sprint 8B
//
// Cron function (runs every 12 hours) that manages the dunning cadence for
// past_due subscriptions BEFORE trial-lifecycle-cron suspends them on day 7.
//
// Cadence is admin-configurable via dunning_cadence_rules (Sprint 4) — no
// longer hardcoded here. Default seed matches the original design:
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

interface Attempt { attempt_number: number; channel: string }

async function loadCadence(db: ReturnType<typeof createClient>): Promise<Record<number, Attempt[]>> {
  const { data } = await db
    .from("dunning_cadence_rules")
    .select("day_offset, attempt_number, channel")
    .eq("is_active", true)
    .order("day_offset");
  const cadence: Record<number, Attempt[]> = {};
  for (const row of (data ?? [])) {
    if (!cadence[row.day_offset]) cadence[row.day_offset] = [];
    cadence[row.day_offset].push({ attempt_number: row.attempt_number, channel: row.channel });
  }
  return cadence;
}

async function invoke(db: ReturnType<typeof createClient>, fnName: string, body: Record<string, unknown>) {
  // Was a hand-rolled `fetch` against `SUPABASE_URL.replace(".supabase.co",
  // ".supabase.co/functions/v1")` — a no-op string replace outside a real
  // *.supabase.co deployment (any local or self-hosted environment), silently
  // producing the wrong URL (missing the /functions/v1 prefix entirely) and a
  // 404 from every single downstream call. `db.functions.invoke()` — what every
  // other function in this codebase already uses to call another function —
  // resolves correctly against whatever SUPABASE_URL actually is. Also: the old
  // fetch was fire-and-forget with no status check, so a downstream failure was
  // indistinguishable from success — the caller below set `sent = true` and
  // logged `dunning_attempts.status = "sent"` regardless, meaning a hospital
  // admin could silently never receive a single overdue-payment notice while
  // every attempt reads as delivered. Both found via Phase 6 edge-function
  // testing — logged together as KNOWN-BUG-181.
  const { error } = await db.functions.invoke(fnName, { body });
  if (error) throw new Error(`${fnName} failed: ${error.message}`);
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

  // This function's own header documents it as cron-only, invoked with the
  // service-role key as bearer — but nothing enforced that. `verify_jwt`
  // (supabase/config.toml has no override, so it defaults to true) only checks
  // that the bearer is a validly-signed project JWT, which is true of ANY
  // logged-in hospital user's session token, not just the service role. Any
  // authenticated user — any hospital, any role — could invoke this endpoint
  // directly and trigger a real dunning pass across every past-due hospital in
  // the system. Same class of gap as KNOWN-BUG-126's "internal-only" findings
  // (`generate-invoice`, `abdm-gateway-token`), now closed the same way: require
  // the exact service-role secret. Found via Phase 6 edge-function testing.
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_KEY}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const results = { processed: 0, attempts_sent: 0, errors: 0 };

  try {
    const CADENCE = await loadCadence(db);
    const configuredDays = Object.keys(CADENCE).map(Number);
    // Window derives from whatever days are actually configured, not a
    // hardcoded 1-7 — an admin adding a day-10 rule must not be silently
    // filtered out here.
    const minDay = configuredDays.length ? Math.min(...configuredDays) : 1;
    const maxDay = configuredDays.length ? Math.max(...configuredDays) : 6;

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
      .gte("updated_at", new Date(Date.now() - (maxDay + 1) * 24 * 60 * 60 * 1000).toISOString())
      .lte("updated_at", new Date(Date.now() - minDay * 24 * 60 * 60 * 1000).toISOString());

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
            await invoke(db, "send-subscription-notification", {
              event: "payment_failed",
              hospital_id: sub.hospital_id,
              email: admin.email,
              full_name: admin.full_name,
            });
            sent = true;
          } else if (attempt.channel === "sms" && admin.phone) {
            await invoke(db, "send-sms", {
              to: admin.phone,
              message: `Aumrti HMS: Payment overdue for your hospital. Please update payment to avoid service suspension. Login at app.aumrti.com`,
              hospital_id: sub.hospital_id,
            });
            sent = true;
          } else if (attempt.channel === "whatsapp" && admin.phone) {
            await invoke(db, "send-whatsapp-meta", {
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
          console.error(`Dunning attempt failed for ${sub.hospital_id}/${attempt.channel}:`, err instanceof Error ? err.message : String(err));
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
    console.error("dunning-processor error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`Dunning processor: ${JSON.stringify(results)}`);
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
