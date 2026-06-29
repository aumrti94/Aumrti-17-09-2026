/**
 * razorpay-subscription-webhook
 *
 * Receives subscription lifecycle events from Razorpay and updates
 * hospital_subscriptions accordingly.
 *
 * Separate from the existing razorpay-webhook (which handles patient billing).
 * Register THIS URL in Razorpay Dashboard → Webhooks for subscription events:
 *   https://[project-ref].supabase.co/functions/v1/razorpay-subscription-webhook
 *
 * Required Supabase secrets:
 *   RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET — from Razorpay Dashboard → Webhooks
 *
 * Events handled:
 *   subscription.activated  → status = 'active', set billing period
 *   subscription.charged    → status = 'active', update billing period
 *   subscription.halted     → status = 'past_due'   (payment failed, retrying)
 *   subscription.cancelled  → status = 'cancelled'
 *   subscription.completed  → status = 'cancelled'  (all charges done)
 *   subscription.paused     → status = 'suspended'
 *   subscription.resumed    → status = 'active'
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Map Razorpay subscription events to our status values
const EVENT_STATUS: Record<string, string> = {
  "subscription.activated":  "active",
  "subscription.charged":    "active",
  "subscription.halted":     "past_due",
  "subscription.cancelled":  "cancelled",
  "subscription.completed":  "cancelled",
  "subscription.paused":     "suspended",
  "subscription.resumed":    "active",
  "subscription.pending":    "trial",   // created but not yet paid
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {

  const rawBody  = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  const secret   = Deno.env.get("RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET");

  // ── HMAC-SHA256 signature verification ───────────────────────────────────
  if (secret) {
    if (!signature) {
      console.warn("Missing x-razorpay-signature header");
      return new Response("Missing signature", { status: 401 });
    }
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac  = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const computed = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (computed !== signature) {
      console.error("Signature mismatch — possible forgery attempt");
      return new Response("Invalid signature", { status: 401 });
    }
  } else {
    console.warn("RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET not set — skipping signature check");
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const event = payload?.event as string;
  const subEntity = payload?.payload?.subscription?.entity;
  const paymentEntity = payload?.payload?.payment?.entity;

  // Ignore events we don't handle
  if (!EVENT_STATUS[event]) {
    console.log(`Ignored event: ${event}`);
    return new Response(JSON.stringify({ status: "ignored", event }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!subEntity) {
    console.warn("No subscription entity in payload");
    return new Response("ok", { status: 200 });
  }

  const razorpaySubId: string = subEntity.id;
  const notes = subEntity.notes ?? {};
  const hospitalId: string | undefined = notes.hospital_id;
  const planId: string | undefined = notes.plan_id;
  const couponCode: string | undefined = notes.coupon_code;

  if (!hospitalId) {
    console.warn("No hospital_id in subscription notes — cannot route event");
    return new Response("ok", { status: 200 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const newStatus = EVENT_STATUS[event];

  // ── Build update payload ──────────────────────────────────────────────────
  const update: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  // Set billing period when subscription activates or renews
  if (["subscription.activated", "subscription.charged"].includes(event)) {
    if (subEntity.current_start) {
      update.current_period_start = new Date(subEntity.current_start * 1000).toISOString();
    }
    if (subEntity.current_end) {
      update.current_period_end = new Date(subEntity.current_end * 1000).toISOString();
    }
    // End the trial on first activation
    update.trial_ends_at = new Date().toISOString();
  }

  // Capture Razorpay payment ID on first successful charge
  if (event === "subscription.charged" && paymentEntity?.id) {
    update.razorpay_plan_id = subEntity.plan_id;
  }

  // ── Upsert hospital_subscriptions ────────────────────────────────────────
  const { error: upsertErr } = await db.from("hospital_subscriptions")
    .update(update)
    .eq("hospital_id", hospitalId);

  if (upsertErr) {
    // Fallback: row might not exist yet (race condition), try upsert
    if (planId) {
      await db.from("hospital_subscriptions").upsert({
        hospital_id: hospitalId,
        plan_id: planId,
        razorpay_subscription_id: razorpaySubId,
        ...update,
      }, { onConflict: "hospital_id" });
    } else {
      console.error("hospital_subscriptions update failed:", upsertErr);
    }
  }

  // ── Increment coupon used_count on first activation ───────────────────────
  if (event === "subscription.activated" && couponCode) {
    await db.rpc("increment_discount_used_count" as any, { p_code: couponCode }).catch(() => {
      // Non-fatal — increment manually as fallback
      db.from("discount_codes")
        .select("used_count")
        .eq("code", couponCode)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            db.from("discount_codes")
              .update({ used_count: (data.used_count || 0) + 1 })
              .eq("code", couponCode);
          }
        });
    });
  }

  // ── Log subscription event ────────────────────────────────────────────────
  await db.from("subscription_events").insert({
    hospital_id: hospitalId,
    event_type:  event.replace("subscription.", ""),
    new_status:  newStatus,
    new_plan_id: planId || null,
    razorpay_event: event,
    metadata: {
      razorpay_subscription_id: razorpaySubId,
      ...(paymentEntity?.id ? { razorpay_payment_id: paymentEntity.id } : {}),
    },
  }).catch(() => {}); // non-fatal

  // ── Generate invoice on successful charge ─────────────────────────────────
  if (event === "subscription.charged" && paymentEntity) {
    const amountInr  = (paymentEntity.amount ?? 0) / 100; // paise → INR
    const periodStart = subEntity.current_start
      ? new Date(subEntity.current_start * 1000).toISOString()
      : null;
    const periodEnd   = subEntity.current_end
      ? new Date(subEntity.current_end   * 1000).toISOString()
      : null;

    await db.functions.invoke("generate-invoice", {
      body: {
        hospital_id:              hospitalId,
        plan_name:                subEntity.notes?.plan_name || "Subscription",
        amount_inr:               amountInr,
        razorpay_payment_id:      paymentEntity.id || null,
        razorpay_subscription_id: razorpaySubId,
        billing_period_start:     periodStart,
        billing_period_end:       periodEnd,
      },
    }).catch((e: Error) => console.error("generate-invoice call failed:", e.message));
  }

  // ── Send notifications for payment failure / suspension ───────────────────
  if (event === "subscription.halted" || event === "subscription.paused") {
    // Fetch admin email
    const { data: adminUser } = await db
      .from("users")
      .select("email, full_name")
      .eq("hospital_id", hospitalId)
      .in("role", ["super_admin", "hospital_admin"])
      .limit(1)
      .maybeSingle();

    if (adminUser?.email) {
      const notifEvent = event === "subscription.halted" ? "payment_failed" : "subscription_suspended";
      await db.functions.invoke("send-subscription-notification", {
        body: {
          event:        notifEvent,
          hospital_id:  hospitalId,
          email:        adminUser.email,
          full_name:    adminUser.full_name,
        },
      }).catch(() => {});
    }
  }

  console.log(`✓ ${event} → hospital ${hospitalId} → status: ${newStatus}`);

  return new Response(JSON.stringify({ status: "processed", event, hospitalId, newStatus }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  } catch (err) {
    console.error("razorpay-subscription-webhook error:", err);
    // Persist failure to DLQ for retry by webhook-dlq-processor
    try {
      const dlqClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await dlqClient.from("webhook_dlq").insert({
        source: "razorpay_subscription",
        event_type: "unknown",
        payload: {},
        error_message: err instanceof Error ? err.message : String(err),
      });
    } catch (dlqErr) {
      console.error("Failed to write to webhook_dlq:", dlqErr);
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
