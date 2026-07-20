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
 *
 * Payment-level events (no subscription entity in the payload):
 *   payment.failed          → records a 'payment_attempt' row (status 'failed')
 *   refund.created          → records a 'credit_note' row, marks the original
 *   refund.processed          invoice refunded / partially_refunded
 *
 * Why those matter: only successful charges were ever recorded, so a hospital
 * whose card was declined had no trace of it anywhere, and a refund left the
 * original invoice still reading "paid". Payment history could not be trusted
 * for support or for reconciliation.
 *
 * Note on retries: the idempotency insert into razorpay_webhook_log happens
 * BEFORE the event-type filter, so event ids seen (and ignored) before this
 * deploy are already burned and will not be reprocessed. Harmless here — there
 * were zero invoices when this shipped.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computePeriodEnd, type BillingCycle } from "../_shared/platform-billing.ts";

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

// Payment-level events arrive WITHOUT a subscription entity, so they are routed
// separately from the status-mapping flow above.
const PAYMENT_EVENTS = new Set(["payment.failed", "refund.created", "refund.processed"]);

/** Card last4 / UPI VPA / bank — whatever Razorpay gives us for this method. */
function paymentMethodDetail(p: any): string | null {
  if (!p) return null;
  if (p.card?.last4) return `•••• ${p.card.last4}${p.card.network ? ` ${p.card.network}` : ""}`;
  if (p.vpa) return String(p.vpa);
  if (p.bank) return String(p.bank);
  if (p.wallet) return String(p.wallet);
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  let rawBody = "";

  try {

  rawBody = await req.text();
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

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── Webhook-level idempotency (prevents double-processing on retries) ──
  // Shares razorpay_webhook_log with razorpay-webhook — Razorpay event IDs
  // are unique per account regardless of which endpoint receives them.
  const webhookId = req.headers.get("x-razorpay-event-id");
  if (webhookId) {
    const { error: dedupError } = await db
      .from("razorpay_webhook_log")
      .insert({ webhook_id: webhookId, event: event ?? "unknown" });

    if (dedupError?.code === "23505") {
      return new Response(JSON.stringify({ ok: true, skipped: "duplicate" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  // ─────────────────────────────────────────────────────────────────────

  // ── Payment-level events ──────────────────────────────────────────────────
  // These carry a payment (or refund) entity and NO subscription entity, so they
  // must be routed and returned before the subscription flow's `!subEntity`
  // guard, which would otherwise silently drop them.
  if (PAYMENT_EVENTS.has(event)) {
    const refundEntity = payload?.payload?.refund?.entity;

    if (event === "payment.failed") {
      const p = paymentEntity;
      const notes = p?.notes ?? {};
      let hospId: string | undefined = notes.hospital_id;
      let planName: string = notes.plan_name || "Subscription";
      let subRow: any = null;

      // Fallback: route via the subscription this payment belongs to.
      const subId = p?.subscription_id ?? notes.subscription_id;
      if (!hospId && subId) {
        const { data } = await db
          .from("hospital_subscriptions")
          .select("id, hospital_id, billing_cycle, subscription_plans(name)")
          .eq("razorpay_subscription_id", subId)
          .maybeSingle();
        subRow = data;
        hospId = data?.hospital_id;
        planName = (data as any)?.subscription_plans?.name ?? planName;
      }

      if (!hospId) {
        console.warn("payment.failed with no routable hospital_id — skipping");
        return new Response("ok", { status: 200 });
      }

      const { data: docNo } = await db.rpc("next_document_number", {
        p_hospital_id: hospId,
        p_kind: "payment_attempt",
      });

      // plan_name is NOT NULL on this table, hence the fallbacks above.
      await db.from("subscription_invoices").insert({
        hospital_id:              hospId,
        invoice_number:           docNo,
        invoice_type:             "payment_attempt",
        status:                   "failed",
        plan_name:                planName,
        amount_inr:               (p?.amount ?? 0) / 100,
        razorpay_payment_id:      p?.id ?? null,
        razorpay_subscription_id: subId ?? null,
        subscription_id:          subRow?.id ?? null,
        billing_cycle:            subRow?.billing_cycle ?? null,
        payment_method:           p?.method ?? null,
        payment_method_detail:    paymentMethodDetail(p),
        failure_code:             p?.error_code ?? null,
        failure_reason:           p?.error_description ?? p?.error_reason ?? null,
      });

      await db.from("subscription_events").insert({
        hospital_id: hospId,
        event_type:  "payment_failed",
        razorpay_event: event,
        metadata: {
          razorpay_payment_id: p?.id ?? null,
          error_code: p?.error_code ?? null,
          error_description: p?.error_description ?? null,
        },
      }).catch(() => {});

      console.log(`✓ ${event} → hospital ${hospId} → attempt recorded`);
      return new Response(JSON.stringify({ status: "processed", event, hospitalId: hospId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── Refunds ──
    // The refund entity carries the original payment id, which is the reliable
    // way back to the hospital: the invoice we already wrote for that charge.
    const paymentId = refundEntity?.payment_id ?? paymentEntity?.id;
    if (!paymentId) {
      console.warn(`${event} with no payment_id — skipping`);
      return new Response("ok", { status: 200 });
    }

    const { data: original } = await db
      .from("subscription_invoices")
      .select("id, hospital_id, plan_name, amount_inr, billing_cycle, subscription_id, razorpay_subscription_id")
      .eq("razorpay_payment_id", paymentId)
      .eq("invoice_type", "tax_invoice")
      .maybeSingle();

    if (!original) {
      console.warn(`${event}: no original invoice for payment ${paymentId} — skipping`);
      return new Response("ok", { status: 200 });
    }

    const refundInr = (refundEntity?.amount ?? 0) / 100;
    const fullyRefunded = refundInr >= Number(original.amount_inr);

    const { data: cnNo } = await db.rpc("next_document_number", {
      p_hospital_id: original.hospital_id,
      p_kind: "credit_note",
    });

    await db.from("subscription_invoices").insert({
      hospital_id:              original.hospital_id,
      invoice_number:           cnNo,
      invoice_type:             "credit_note",
      status:                   "refunded",
      plan_name:                original.plan_name,
      amount_inr:               refundInr,
      refund_amount_inr:        refundInr,
      refunded_at:              new Date().toISOString(),
      razorpay_refund_id:       refundEntity?.id ?? null,
      razorpay_payment_id:      paymentId,
      razorpay_subscription_id: original.razorpay_subscription_id,
      subscription_id:          original.subscription_id,
      billing_cycle:            original.billing_cycle,
    });

    // The original tax invoice must stop reading "paid".
    await db.from("subscription_invoices")
      .update({
        status:            fullyRefunded ? "refunded" : "partially_refunded",
        refund_amount_inr: refundInr,
        refunded_at:       new Date().toISOString(),
        razorpay_refund_id: refundEntity?.id ?? null,
      })
      .eq("id", original.id);

    await db.from("subscription_events").insert({
      hospital_id: original.hospital_id,
      event_type:  "refund",
      razorpay_event: event,
      metadata: {
        razorpay_payment_id: paymentId,
        razorpay_refund_id: refundEntity?.id ?? null,
        refund_amount_inr: refundInr,
        fully_refunded: fullyRefunded,
      },
    }).catch(() => {});

    console.log(`✓ ${event} → hospital ${original.hospital_id} → credit note ${cnNo}`);
    return new Response(JSON.stringify({ status: "processed", event }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

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

  const newStatus = EVENT_STATUS[event];

  // ── Build update payload ──────────────────────────────────────────────────
  const update: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  // The cycle we put in the subscription notes at checkout — Razorpay echoes
  // notes back on every event, so this is how a renewal knows whether it is a
  // monthly or annual charge.
  const cycle: BillingCycle = notes.billing_cycle === "yearly" ? "yearly" : "monthly";

  // Set billing period when subscription activates or renews
  if (["subscription.activated", "subscription.charged"].includes(event)) {
    const periodStart = subEntity.current_start
      ? new Date(subEntity.current_start * 1000)
      : new Date();
    update.current_period_start = periodStart.toISOString();

    // Razorpay's own current_end stays authoritative; computePeriodEnd is only
    // the fallback for events that omit it (which would otherwise leave the
    // "next billing" date blank).
    update.current_period_end = subEntity.current_end
      ? new Date(subEntity.current_end * 1000).toISOString()
      : computePeriodEnd(periodStart, cycle).toISOString();

    update.billing_cycle = cycle;
    // End the trial on first activation
    update.trial_ends_at = new Date().toISOString();
  }

  // Capture Razorpay payment ID + how they paid, on a successful charge
  if (event === "subscription.charged" && paymentEntity?.id) {
    update.razorpay_plan_id = subEntity.plan_id;
    if (paymentEntity.method) update.payment_method = paymentEntity.method;
    const detail = paymentMethodDetail(paymentEntity);
    if (detail) update.payment_method_detail = detail;
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
        billing_period_end:       periodEnd ?? computePeriodEnd(periodStart ?? new Date(), cycle).toISOString(),
        billing_cycle:            cycle,
        payment_method:           paymentEntity.method ?? null,
        payment_method_detail:    paymentMethodDetail(paymentEntity),
        payment_captured_at:      paymentEntity.created_at
          ? new Date(paymentEntity.created_at * 1000).toISOString()
          : new Date().toISOString(),
      },
    }).catch((e: Error) => console.error("generate-invoice call failed:", e.message));
  }

  // ── Retire a superseded mandate after the new one is confirmed ────────────
  // change-subscription-plan deliberately leaves the OLD subscription running
  // through an upgrade, so an abandoned checkout never leaves the hospital with
  // no mandate at all. Once the new one actually activates, the old one is safe
  // to cancel — and this is the only place that knows it succeeded.
  if (event === "subscription.activated" && notes.supersedes_subscription_id) {
    const rzpKeyId  = Deno.env.get("RAZORPAY_SUBSCRIPTION_KEY_ID");
    const rzpSecret = Deno.env.get("RAZORPAY_SUBSCRIPTION_KEY_SECRET");
    if (rzpKeyId && rzpSecret) {
      const auth = btoa(`${rzpKeyId}:${rzpSecret}`);
      await fetch(
        `https://api.razorpay.com/v1/subscriptions/${notes.supersedes_subscription_id}/cancel`,
        {
          method: "POST",
          headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify({ cancel_at_cycle_end: 0 }),
        },
      ).catch((e) => console.error("Superseded-mandate cancel failed:", e.message));
      console.log(`Cancelled superseded mandate ${notes.supersedes_subscription_id}`);
    }
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
      let parsedPayload: Record<string, unknown> = {};
      try { parsedPayload = rawBody ? JSON.parse(rawBody) : {}; } catch { /* ignore */ }
      await dlqClient.from("webhook_dlq").insert({
        source: "razorpay_subscription",
        event_type: (parsedPayload as any)?.event ?? "unknown",
        payload: parsedPayload,
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
