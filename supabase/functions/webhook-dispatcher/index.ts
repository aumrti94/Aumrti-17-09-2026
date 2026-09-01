// @ts-nocheck
/**
 * webhook-dispatcher — outbound webhook delivery.
 *
 * Runs every minute on pg_cron. Two jobs:
 *   1. Claim newly emitted outbox events and fan them out to subscribing endpoints.
 *   2. Re-attempt deliveries whose backoff has elapsed.
 *
 * Distinct from webhook-dlq-processor, which retries INBOUND Razorpay callbacks. That function
 * has nothing to do with delivery to hospitals; the only thing shared is the DLQ table where
 * both put deliveries that have exhausted their retries.
 *
 * Contract: docs/api/EVENT_CATALOG.md
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** EVENT_CATALOG.md §6. Index = attempt number - 1; past the end the delivery is dead. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 1440];

/** Consecutive failures before an endpoint is switched off and the admin told. */
const AUTO_DISABLE_AFTER = 15;

/** The receiver's budget. Acknowledge fast and process asynchronously — see §6. */
const DELIVERY_TIMEOUT_MS = 10_000;

const EVENT_BATCH = 100;
const RETRY_BATCH = 100;

/** Enough of the response to debug with; never enough to become a data store. */
const RESPONSE_SNIPPET_BYTES = 2048;

const db = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const sb = db();
  const started = Date.now();

  try {
    const fanned = await dispatchNewEvents(sb);
    const retried = await retryDueDeliveries(sb);

    return json({
      ok: true,
      events_dispatched: fanned.events,
      deliveries_attempted: fanned.deliveries + retried.attempted,
      succeeded: fanned.succeeded + retried.succeeded,
      failed: fanned.failed + retried.failed,
      endpoints_disabled: fanned.disabled + retried.disabled,
      duration_ms: Date.now() - started,
    });
  } catch (err) {
    console.error("webhook-dispatcher failed:", err instanceof Error ? err.stack : err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── Fan-out ──────────────────────────────────────────────────────────────────────────────────

async function dispatchNewEvents(sb: any) {
  // Atomic claim — overlapping runs take disjoint batches rather than double-sending.
  const { data: events, error } = await sb.rpc("claim_api_events", { p_limit: EVENT_BATCH });
  if (error) throw new Error(`claim_api_events: ${error.message}`);
  if (!events?.length) return { events: 0, deliveries: 0, succeeded: 0, failed: 0, disabled: 0 };

  let deliveries = 0, succeeded = 0, failed = 0, disabled = 0;

  for (const event of events) {
    const { data: endpoints } = await sb
      .from("webhook_endpoints")
      .select("id, url, secret, events, failure_count, include_phi")
      .eq("hospital_id", event.hospital_id)
      .eq("is_active", true)
      .contains("events", [event.event_type]);

    for (const endpoint of endpoints ?? []) {
      deliveries++;
      const outcome = await attempt(sb, event, endpoint, 1);
      if (outcome.ok) succeeded++;
      else {
        failed++;
        if (outcome.disabled) disabled++;
      }
    }
  }

  return { events: events.length, deliveries, succeeded, failed, disabled };
}

// ── Retries ──────────────────────────────────────────────────────────────────────────────────

async function retryDueDeliveries(sb: any) {
  const { data: due, error } = await sb
    .from("webhook_deliveries")
    .select("id, endpoint_id, event_id, attempt, hospital_id")
    .eq("status", "failed")
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", new Date().toISOString())
    .order("next_retry_at", { ascending: true })
    .limit(RETRY_BATCH);

  if (error) throw new Error(`retry scan: ${error.message}`);
  if (!due?.length) return { attempted: 0, succeeded: 0, failed: 0, disabled: 0 };

  let attempted = 0, succeeded = 0, failed = 0, disabled = 0;

  for (const row of due) {
    const [{ data: event }, { data: endpoint }] = await Promise.all([
      sb.from("api_events").select("*").eq("id", row.event_id).maybeSingle(),
      sb.from("webhook_endpoints")
        .select("id, url, secret, failure_count, include_phi, is_active")
        .eq("id", row.endpoint_id).maybeSingle(),
    ]);

    // The endpoint was deleted or switched off while this delivery was waiting. Stop retrying
    // and close the row out rather than leaving it to be rescanned every minute forever.
    if (!event || !endpoint || !endpoint.is_active) {
      await sb.from("webhook_deliveries")
        .update({ status: "dead", next_retry_at: null, error_message: "Endpoint removed or disabled before retry." })
        .eq("id", row.id);
      continue;
    }

    // Claim this row so a concurrent run does not send the same attempt twice.
    const { data: claimed } = await sb.from("webhook_deliveries")
      .update({ next_retry_at: null })
      .eq("id", row.id)
      .eq("status", "failed")
      .not("next_retry_at", "is", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    attempted++;
    const outcome = await attempt(sb, event, endpoint, row.attempt + 1);
    if (outcome.ok) succeeded++;
    else {
      failed++;
      if (outcome.disabled) disabled++;
    }
  }

  return { attempted, succeeded, failed, disabled };
}

// ── One delivery attempt ─────────────────────────────────────────────────────────────────────

async function attempt(sb: any, event: any, endpoint: any, attemptNo: number) {
  const timestamp = Math.floor(Date.now() / 1000);

  // v1 sends the thin payload to every endpoint. endpoint.include_phi is the schema-level gate
  // for fat payloads (and cannot be set without a recorded DPDP purpose), but fat payloads are
  // not implemented — no endpoint can currently receive more than this.
  const body = JSON.stringify({
    event_id: event.event_id,
    type: event.event_type,
    occurred_at: event.occurred_at,
    environment: event.environment,
    data: event.payload,
  });

  const signature = await sign(endpoint.secret, timestamp, body);

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Aumrti-Webhooks/1.0",
        "Aumrti-Signature": `t=${timestamp},v1=${signature}`,
        "Aumrti-Event-Id": event.event_id,
        "Aumrti-Event-Type": event.event_type,
        // Lets a receiver deduplicate a redelivery without parsing the body.
        "Aumrti-Delivery-Attempt": String(attemptNo),
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    responseStatus = res.status;
    responseBody = (await res.text().catch(() => ""))?.slice(0, RESPONSE_SNIPPET_BYTES) || null;
  } catch (err) {
    // Never log endpoint.url with the error: a hospital's endpoint URL can embed a token.
    errorMessage = (err as Error).name === "AbortError"
      ? `No response within ${DELIVERY_TIMEOUT_MS / 1000}s.`
      : `Could not reach endpoint: ${(err as Error).message}`.slice(0, 500);
  }

  const durationMs = Date.now() - startedAt;
  const ok = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;

  const nextRetryAt = ok ? null : nextRetry(attemptNo);
  const exhausted = !ok && nextRetryAt === null;

  await sb.from("webhook_deliveries").insert({
    hospital_id: event.hospital_id,
    endpoint_id: endpoint.id,
    event_id: event.id,
    attempt: attemptNo,
    status: ok ? "succeeded" : exhausted ? "dead" : "failed",
    response_status: responseStatus,
    response_body: responseBody,
    duration_ms: durationMs,
    error_message: errorMessage,
    next_retry_at: nextRetryAt,
    delivered_at: ok ? new Date().toISOString() : null,
  });

  if (ok) {
    // Reset rather than decrement: failure_count counts CONSECUTIVE failures, so one success
    // clears the streak however long it was.
    if ((endpoint.failure_count ?? 0) > 0) {
      await sb.from("webhook_endpoints").update({ failure_count: 0 }).eq("id", endpoint.id);
    }
    await sb.from("webhook_endpoints")
      .update({ last_fired_at: new Date().toISOString() }).eq("id", endpoint.id);
    return { ok: true, disabled: false };
  }

  const consecutive = (endpoint.failure_count ?? 0) + 1;
  let disabled = false;

  if (consecutive >= AUTO_DISABLE_AFTER) {
    await sb.from("webhook_endpoints").update({
      failure_count: consecutive,
      is_active: false,
      disabled_at: new Date().toISOString(),
      disabled_reason: `Automatically disabled after ${consecutive} consecutive delivery failures. `
                     + `Last error: ${errorMessage ?? `HTTP ${responseStatus}`}`,
    }).eq("id", endpoint.id);
    disabled = true;
    await notifyAdmin(sb, event.hospital_id, endpoint, consecutive);
  } else {
    await sb.from("webhook_endpoints").update({ failure_count: consecutive }).eq("id", endpoint.id);
  }

  if (exhausted) await toDlq(sb, event, endpoint, errorMessage ?? `HTTP ${responseStatus}`);

  return { ok: false, disabled };
}

// ── Signing ──────────────────────────────────────────────────────────────────────────────────

/**
 * HMAC-SHA256 over `{timestamp}.{body}`.
 *
 * The timestamp is inside the signed string, not merely alongside it. A signature over the body
 * alone stays valid forever, so a captured delivery could be replayed at any time and would
 * verify. Receivers reject timestamps older than five minutes — see EVENT_CATALOG.md §5.
 */
async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, "0")).join("");
}

// ── Retry schedule ───────────────────────────────────────────────────────────────────────────

function nextRetry(attemptNo: number): string | null {
  const minutes = BACKOFF_MINUTES[attemptNo - 1];
  if (minutes === undefined) return null; // ladder exhausted
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

// ── Terminal handling ────────────────────────────────────────────────────────────────────────

async function toDlq(sb: any, event: any, endpoint: any, error: string): Promise<void> {
  try {
    await sb.from("webhook_dlq").insert({
      source: "hospital_outbound",
      hospital_id: event.hospital_id,
      endpoint_id: endpoint.id,
      webhook_id: event.event_id,
      event_type: event.event_type,
      payload: event.payload,
      error_message: error.slice(0, 1000),
      retry_count: BACKOFF_MINUTES.length,
      status: "dead",
    });
  } catch (err) {
    console.error("webhook-dispatcher: DLQ write failed:", (err as Error).message);
  }
}

/**
 * A silently disabled endpoint is worse than a failing one: the hospital believes its integration
 * is running, and discovers otherwise when something downstream has been stale for a week.
 */
async function notifyAdmin(sb: any, hospitalId: string, endpoint: any, failures: number): Promise<void> {
  try {
    // notification_queue is a delivery queue drained by notification-dispatcher, not an in-app
    // store — it needs a channel and a real recipient. Deliberately NOT clinical_alerts: that
    // surface is for patient safety, and putting integration warnings on it is how alert fatigue
    // starts on the screen where it matters most.
    const { data: admins } = await sb
      .from("users")
      .select("email")
      .eq("hospital_id", hospitalId)
      .eq("role", "hospital_admin")
      .eq("is_active", true)
      .not("email", "is", null)
      .limit(3);

    if (!admins?.length) {
      console.warn(`webhook-dispatcher: endpoint ${endpoint.id} disabled but no admin email on file.`);
      return;
    }

    for (const admin of admins) {
      await sb.from("notification_queue").insert({
        hospital_id: hospitalId,
        channel: "email",
        recipient: admin.email,
        subject: "Aumrti: a webhook endpoint has been disabled",
        // The endpoint URL is deliberately omitted — it can embed a token, and this is an email.
        body: `An integration endpoint was switched off automatically after ${failures} consecutive `
            + `delivery failures.\n\nEvents are no longer being sent to it. Open Settings → API Portal `
            + `to review the delivery log and re-enable the endpoint once the receiving system is fixed.`,
        // One notification per endpoint per disable event, however many times this runs.
        dedup_key: `webhook_endpoint_disabled:${endpoint.id}`,
      });
    }
  } catch (err) {
    // Best effort. The endpoint is already disabled with disabled_reason recorded on the row.
    console.warn("webhook-dispatcher: admin notification failed:", (err as Error).message);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
