/**
 * trial-lifecycle-cron
 *
 * Scheduled daily cron job that manages trial and past_due subscription lifecycles:
 *   - Sends 7-day, 3-day, 1-day trial expiry warnings
 *   - Suspends expired trials (trial_ends_at < now())
 *   - Suspends past_due accounts older than 7 days
 *
 * Triggered by pg_cron via HTTP POST (no auth body required — service role key in header).
 * Can also be triggered manually by a CEO from the platform dashboard.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: Record<string, number> = {
    expired_suspended: 0,
    past_due_suspended: 0,
    warnings_7days: 0,
    warnings_3days: 0,
    warnings_1day: 0,
  };

  try {
    // ── 1. Fetch all active trials with admin emails ───────────────────────
    const { data: trials } = await db
      .from("hospital_subscriptions")
      .select(`
        hospital_id,
        trial_ends_at,
        plan_id,
        hospitals!inner(name),
        subscription_plans!inner(name)
      `)
      .eq("status", "trial")
      .not("trial_ends_at", "is", null);

    for (const row of (trials || [])) {
      const endsAt    = new Date(row.trial_ends_at);
      const now       = new Date();
      const msLeft    = endsAt.getTime() - now.getTime();
      const daysLeft  = Math.floor(msLeft / (1000 * 60 * 60 * 24));

      // Fetch admin email for this hospital
      const { data: admin } = await db
        .from("users")
        .select("email, full_name")
        .eq("hospital_id", row.hospital_id)
        .in("role", ["super_admin", "hospital_admin"])
        .limit(1)
        .maybeSingle();

      const hospName  = (row as any).hospitals?.name || "";
      const planName  = (row as any).subscription_plans?.name || "";
      const adminEmail = admin?.email;

      if (daysLeft < 0) {
        // Trial expired — suspend
        await db
          .from("hospital_subscriptions")
          .update({ status: "suspended", updated_at: now.toISOString() })
          .eq("hospital_id", row.hospital_id);

        await db.from("subscription_events").insert({
          hospital_id: row.hospital_id,
          event_type:  "trial_expired_suspended",
          old_status:  "trial",
          new_status:  "suspended",
          metadata:    { trial_ends_at: row.trial_ends_at, days_overdue: Math.abs(daysLeft) },
        }).catch(() => {});

        if (adminEmail) {
          await db.functions.invoke("send-subscription-notification", {
            body: {
              event:         "trial_expired",
              hospital_id:   row.hospital_id,
              email:         adminEmail,
              full_name:     admin?.full_name,
              hospital_name: hospName,
              plan_name:     planName,
            },
          }).catch(() => {});
        }

        results.expired_suspended++;

      } else if (daysLeft === 0) {
        // Trial ends today
        if (adminEmail) {
          await db.functions.invoke("send-subscription-notification", {
            body: {
              event:            "trial_1day",
              hospital_id:      row.hospital_id,
              email:            adminEmail,
              full_name:        admin?.full_name,
              hospital_name:    hospName,
              plan_name:        planName,
              trial_days_left:  0,
            },
          }).catch(() => {});
          results.warnings_1day++;
        }

      } else if (daysLeft === 1) {
        if (adminEmail) {
          await db.functions.invoke("send-subscription-notification", {
            body: {
              event:            "trial_1day",
              hospital_id:      row.hospital_id,
              email:            adminEmail,
              full_name:        admin?.full_name,
              hospital_name:    hospName,
              plan_name:        planName,
              trial_days_left:  1,
            },
          }).catch(() => {});
          results.warnings_1day++;
        }

      } else if (daysLeft === 3) {
        if (adminEmail) {
          await db.functions.invoke("send-subscription-notification", {
            body: {
              event:            "trial_3days",
              hospital_id:      row.hospital_id,
              email:            adminEmail,
              full_name:        admin?.full_name,
              hospital_name:    hospName,
              plan_name:        planName,
              trial_days_left:  3,
            },
          }).catch(() => {});
          results.warnings_3days++;
        }

      } else if (daysLeft === 7) {
        if (adminEmail) {
          await db.functions.invoke("send-subscription-notification", {
            body: {
              event:            "trial_7days",
              hospital_id:      row.hospital_id,
              email:            adminEmail,
              full_name:        admin?.full_name,
              hospital_name:    hospName,
              plan_name:        planName,
              trial_days_left:  7,
            },
          }).catch(() => {});
          results.warnings_7days++;
        }
      }
    }

    // ── 2. Suspend past_due accounts past the configured buffer ───────────
    // Uses the durable past_due_since anchor (stamped by the webhook on halt)
    // and the /platform-configured access_grace_days — the same buffer the
    // access rule enforces. This only converts past_due → the harder
    // `suspended` state (which cancels retries/notifies); the access rule
    // already made the account read-only at the buffer boundary regardless of
    // whether this cron fired. Legacy rows with no anchor fall back to updated_at.
    const { data: billingSettings } = await db
      .from("platform_billing_settings")
      .select("access_grace_days")
      .eq("id", 1)
      .maybeSingle();
    const graceDays = Number.isFinite(billingSettings?.access_grace_days)
      ? Number(billingSettings!.access_grace_days) : 3;
    const graceMs = graceDays * 24 * 60 * 60 * 1000;

    const { data: pastDue } = await db
      .from("hospital_subscriptions")
      .select("hospital_id, past_due_since, updated_at")
      .eq("status", "past_due");

    const nowMs = Date.now();
    for (const row of (pastDue || [])) {
      const anchor = row.past_due_since ?? row.updated_at;
      if (!anchor || nowMs - new Date(anchor).getTime() <= graceMs) continue;

      await db
        .from("hospital_subscriptions")
        .update({ status: "suspended", updated_at: new Date().toISOString() })
        .eq("hospital_id", row.hospital_id);

      await db.from("subscription_events").insert({
        hospital_id: row.hospital_id,
        event_type:  "past_due_suspended",
        old_status:  "past_due",
        new_status:  "suspended",
        metadata:    { past_due_since: row.past_due_since, grace_days: graceDays },
      }).catch(() => {});

      // Notify admin
      const { data: admin } = await db
        .from("users")
        .select("email, full_name")
        .eq("hospital_id", row.hospital_id)
        .in("role", ["super_admin", "hospital_admin"])
        .limit(1)
        .maybeSingle();

      if (admin?.email) {
        await db.functions.invoke("send-subscription-notification", {
          body: {
            event:       "subscription_suspended",
            hospital_id: row.hospital_id,
            email:       admin.email,
            full_name:   admin.full_name,
          },
        }).catch(() => {});
      }

      results.past_due_suspended++;
    }

    // ── 3. Expire time-limited discounts (e.g. referee's "20% off for 3 months") ──
    try {
      const { data: expired } = await db.rpc("expire_lapsed_discounts");
      results.discounts_expired = Number(expired ?? 0);
    } catch (e) {
      console.error("trial-lifecycle-cron: discount expiry failed:", e);
    }

    // ── 4. Send conversion emails for trial→active flips ───────────────────
    // The conversion itself is handled by a DB trigger (any write path flips the
    // status), so the email is dispatched here off the event log rather than from
    // whichever UI happened to make the change.
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: conversions } = await db
        .from("subscription_events")
        .select("id, hospital_id, metadata, new_plan_id")
        .eq("event_type", "converted")
        .gte("created_at", since);

      for (const ev of conversions ?? []) {
        // Skip ones already emailed on an earlier run within the window.
        if ((ev.metadata as any)?.notified_at) continue;

        const { data: admin } = await db
          .from("users")
          .select("email, full_name")
          .eq("hospital_id", ev.hospital_id)
          .in("role", ["super_admin", "hospital_admin"])
          .limit(1)
          .maybeSingle();
        if (!admin?.email) continue;

        const { data: plan } = await db
          .from("subscription_plans")
          .select("name")
          .eq("id", ev.new_plan_id)
          .maybeSingle();

        await db.functions.invoke("send-subscription-notification", {
          body: {
            event: "converted",
            email: admin.email,
            full_name: admin.full_name,
            plan_name: plan?.name ?? "",
            period_end: (ev.metadata as any)?.period_end ?? null,
            discount_pct: (ev.metadata as any)?.discount_pct ?? 0,
            discount_expires_at: (ev.metadata as any)?.discount_expires_at ?? null,
          },
        }).catch(() => {});

        await db.from("subscription_events")
          .update({ metadata: { ...(ev.metadata as any ?? {}), notified_at: new Date().toISOString() } })
          .eq("id", ev.id);

        results.conversions_notified = (results.conversions_notified ?? 0) + 1;
      }
    } catch (e) {
      console.error("trial-lifecycle-cron: conversion notifications failed:", e);
    }

    console.log("trial-lifecycle-cron completed:", results);

    return new Response(JSON.stringify({ status: "done", results }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("trial-lifecycle-cron error:", err);
    return new Response(JSON.stringify({ error: err.message, partial: results }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
