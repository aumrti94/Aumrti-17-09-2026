/**
 * change-subscription-plan
 *
 * Self-service plan upgrade or downgrade for hospital admins.
 * Called from SettingsPlanPage (Upgrade / Downgrade buttons).
 *
 * Flow:
 *   1. Validate caller is super_admin of the hospital
 *   2. Fetch current + target plan
 *   3. Cancel existing Razorpay subscription (at end of billing period for downgrades)
 *   4. Create new Razorpay subscription for target plan
 *   5. Update hospital_subscriptions row
 *   6. Log subscription_event
 *   7. Send email notification
 *
 * Required Supabase secrets:
 *   RAZORPAY_SUBSCRIPTION_KEY_ID
 *   RAZORPAY_SUBSCRIPTION_KEY_SECRET
 *
 * Request body:
 *   { new_plan_id: string, hospital_id: string, coupon_code?: string,
 *     billing_cycle?: 'monthly' | 'yearly' }   // defaults to the current cycle
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveEffectivePrice,
  razorpayPeriodForCycle,
  totalCountForCycle,
  type BillingCycle,
} from "../_shared/platform-billing.ts";
import { getRazorpaySubscriptionKeys } from "../_shared/platform-razorpay-config.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const JSON_H = { ...CORS, "Content-Type": "application/json" };

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: JSON_H });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("Unauthorized", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth: verify caller is a hospital super_admin ──────────────────────
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const { new_plan_id, hospital_id, coupon_code, billing_cycle } = await req.json();
    if (!new_plan_id || !hospital_id) return err("new_plan_id and hospital_id required");

    const db = createClient(supabaseUrl, serviceKey);

    // Razorpay keys: /platform-configured row first, env vars as fallback.
    const { keyId: rzpKeyId, keySecret: rzpSecret } = await getRazorpaySubscriptionKeys(db);

    // Verify caller belongs to this hospital and is super_admin
    const { data: callerUser } = await db
      .from("users")
      .select("role, hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!callerUser || callerUser.hospital_id !== hospital_id) return err("Forbidden", 403);
    if (!["super_admin", "hospital_admin"].includes(callerUser.role)) return err("Forbidden", 403);

    // ── Fetch current subscription ─────────────────────────────────────────
    const { data: currentSub } = await db
      .from("hospital_subscriptions")
      .select("id, plan_id, status, billing_cycle, razorpay_subscription_id, subscription_plans!inner(name, slug, price_monthly, is_custom_price)")
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    // ── Fetch target plan ──────────────────────────────────────────────────
    const { data: newPlan } = await db
      .from("subscription_plans")
      .select("id, name, slug, price_monthly, price_yearly, razorpay_plan_id, is_custom_price, trial_days, beds_included, bed_block_size, price_per_bed_block, price_per_bed_block_yearly")
      .eq("id", new_plan_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!newPlan) return err("Plan not found");
    if (newPlan.is_custom_price) return err("Enterprise plans require a custom quote. Contact support@aumrti.in");

    const currentPlan = (currentSub as any)?.subscription_plans;
    const currentStatus = currentSub?.status || "no_subscription";
    const isUpgrade = !currentPlan || (newPlan.price_monthly > (currentPlan.price_monthly || 0));

    // ── Validate coupon ────────────────────────────────────────────────────
    let discountPct = 0;
    if (coupon_code) {
      const code = String(coupon_code).toUpperCase().trim();
      const { data: coupon } = await db
        .from("discount_codes")
        .select("discount_type, discount_value, valid_until, max_uses, used_count, is_active, applies_to")
        .eq("code", code)
        .eq("is_active", true)
        .maybeSingle();

      if (!coupon) return err(`Coupon "${code}" is invalid`);
      if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) return err(`Coupon "${code}" has expired`);
      if (coupon.max_uses && coupon.used_count >= coupon.max_uses) return err(`Coupon "${code}" has reached its limit`);
      discountPct = coupon.discount_type === "percentage" ? Number(coupon.discount_value) : 0;
    }

    // ── Resolve the price actually charged on the new plan ─────────────────
    // Same resolver as checkout. Previously this function bound the subscription
    // to a list-price plan while reporting a discounted figure, so neither the
    // negotiated rate nor the coupon reached the gateway.
    const { data: override } = await db
      .from("hospital_pricing_overrides")
      .select("monthly_price, yearly_price, valid_until")
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    const cycle: BillingCycle = billing_cycle === "yearly"
      ? "yearly"
      : (currentSub?.billing_cycle === "yearly" ? "yearly" : "monthly");

    // Bed-banded pricing (v3): a plan change re-bills against the live
    // active-bed count via the canonical current_active_beds() RPC (mirrors the
    // migration-150 enforcement trigger). NULL bed columns = no bed fee.
    const { data: activeBeds } = await db.rpc("current_active_beds", {
      p_hospital_id: hospital_id,
    });

    // Add-ons survive a plan change — they are bought separately from the tier,
    // so the new mandate must carry them or the hospital keeps the access and
    // stops paying for it.
    const { data: addonRows } = await db
      .from("hospital_addons")
      .select("addon_skus(price_monthly, price_yearly)")
      .eq("hospital_id", hospital_id)
      .eq("status", "active");

    const addonsMonthlyInr = (addonRows ?? []).reduce(
      (s: number, r: { addon_skus?: { price_monthly?: number | string | null } | null }) =>
        s + Number(r.addon_skus?.price_monthly ?? 0), 0);
    const addonsYearlyInr = (addonRows ?? []).reduce(
      (s: number, r: { addon_skus?: { price_yearly?: number | string | null } | null }) =>
        s + Number(r.addon_skus?.price_yearly ?? 0), 0);

    const price = resolveEffectivePrice({
      plan: newPlan, override, cycle, couponPct: discountPct, activeBeds,
      addonsMonthlyInr,
      addonsYearlyInr: addonsYearlyInr > 0 ? addonsYearlyInr : null,
    });
    if (!price.available) {
      return err(price.reason ?? `The ${newPlan.name} plan is not available ${cycle}`);
    }

    if (!rzpKeyId || !rzpSecret) {
      return err("Payment gateway not configured. Contact support@aumrti.in", 500);
    }
    const auth = btoa(`${rzpKeyId}:${rzpSecret}`);

    // ── Resolve the Razorpay plan for (plan, cycle, amount) ────────────────
    const { data: cachedPlanId } = await db.rpc("claim_razorpay_plan_slot", {
      p_plan_id: new_plan_id,
      p_billing_cycle: cycle,
      p_amount_paise: price.amountPaise,
      p_razorpay_plan_id: null,
    });

    let rzpPlanId: string | null = cachedPlanId ?? null;

    if (!rzpPlanId) {
      const cycleWord = cycle === "yearly" ? "annual" : "monthly";
      const createPlanRes = await fetch("https://api.razorpay.com/v1/plans", {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          period: razorpayPeriodForCycle(cycle),
          interval: 1,
          item: {
            name: `Aumrti HMS ${newPlan.name} (${cycleWord})`,
            amount: price.amountPaise,
            currency: "INR",
            description: `Aumrti HMS ${newPlan.name} ${cycleWord} subscription`,
          },
        }),
      });
      if (!createPlanRes.ok) {
        const rzpErr = await createPlanRes.json().catch(() => ({}));
        console.error("Auto-create Razorpay plan failed:", rzpErr);
        return err("Payment gateway error while setting up plan. Contact support@aumrti.in", 502);
      }
      const rzpPlan = await createPlanRes.json();
      const { data: claimed } = await db.rpc("claim_razorpay_plan_slot", {
        p_plan_id: new_plan_id,
        p_billing_cycle: cycle,
        p_amount_paise: price.amountPaise,
        p_razorpay_plan_id: rzpPlan.id,
      });
      rzpPlanId = claimed ?? rzpPlan.id;
    }

    if (!rzpPlanId) {
      return err("Payment gateway not configured for this plan. Contact support@aumrti.in");
    }

    // ── Create the NEW Razorpay subscription first ─────────────────────────
    // Order matters. This used to cancel the old mandate before creating the
    // new one, so a customer who abandoned checkout was left with a cancelled
    // subscription and an unpaid new one — no active mandate at all. The old
    // mandate is now cancelled only after the new subscription exists (and for
    // an upgrade, only once the webhook confirms the first charge).
    let newRzpSubId: string | null = null;
    const rzpRes = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: rzpPlanId,
        total_count: totalCountForCycle(cycle),
        quantity: 1,
        customer_notify: 1,
        notes: {
          hospital_id,
          plan_id: new_plan_id,
          plan_name: newPlan.name,
          billing_cycle: cycle,
          amount_paise: String(price.amountPaise),
          price_source: price.source,
          change_type: isUpgrade ? "upgrade" : "downgrade",
          ...(currentSub?.razorpay_subscription_id
            ? { supersedes_subscription_id: currentSub.razorpay_subscription_id }
            : {}),
        },
      }),
    });

    if (!rzpRes.ok) {
      const rzpErr = await rzpRes.json().catch(() => ({}));
      console.error("Razorpay subscription creation failed:", rzpErr);
      // Nothing has been cancelled yet, so the hospital keeps its current
      // mandate and can retry.
      return err(rzpErr?.error?.description ?? "Payment gateway error. Please try again.", 502);
    }
    newRzpSubId = (await rzpRes.json()).id;

    // ── Now retire the old mandate ─────────────────────────────────────────
    // Downgrade: let the paid period run out (cancel_at_cycle_end=1).
    // Upgrade: the new mandate needs authorisation before it charges, so the old
    // one is left running and is cancelled by the webhook on the new
    // subscription's first `activated`. Cancelling it here would leave a gap.
    if (currentSub?.razorpay_subscription_id && !isUpgrade) {
      await fetch(`https://api.razorpay.com/v1/subscriptions/${currentSub.razorpay_subscription_id}/cancel`, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      }).catch((e) => console.error("Razorpay cancel failed:", e.message));
    }

    // ── Update hospital_subscriptions ──────────────────────────────────────
    await db.from("hospital_subscriptions").upsert({
      hospital_id,
      plan_id: new_plan_id,
      status: currentStatus === "active" ? "active" : "trial",
      razorpay_subscription_id: newRzpSubId,
      razorpay_plan_id: rzpPlanId,
      billing_cycle: cycle,
      effective_amount_inr: price.amountInr,
      ...(discountPct > 0 ? { discount_pct: discountPct } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: "hospital_id" });

    // ── Log event ──────────────────────────────────────────────────────────
    await db.from("subscription_events").insert({
      hospital_id,
      event_type:  isUpgrade ? "plan_upgraded" : "plan_downgraded",
      old_status:  currentStatus,
      new_status:  currentStatus === "active" ? "active" : "trial",
      old_plan_id: currentSub?.plan_id || null,
      new_plan_id: new_plan_id,
      metadata:    { change_type: isUpgrade ? "upgrade" : "downgrade", new_plan_name: newPlan.name },
    }).catch(() => {});

    // ── Notify admin ───────────────────────────────────────────────────────
    const { data: admin } = await db
      .from("users")
      .select("email, full_name")
      .eq("hospital_id", hospital_id)
      .in("role", ["super_admin", "hospital_admin"])
      .limit(1)
      .maybeSingle();

    if (admin?.email) {
      await db.functions.invoke("send-subscription-notification", {
        body: {
          event:       isUpgrade ? "plan_upgraded" : "plan_downgraded",
          hospital_id,
          email:       admin.email,
          full_name:   admin.full_name,
          plan_name:   newPlan.name,
        },
      }).catch(() => {});
    }

    // ── Return Razorpay checkout params for new subscription ───────────────
    const { data: adminContact } = await db
      .from("users")
      .select("full_name, email, phone")
      .eq("hospital_id", hospital_id)
      .in("role", ["super_admin", "hospital_admin"])
      .limit(1)
      .maybeSingle();

    return new Response(JSON.stringify({
      success:          true,
      change_type:      isUpgrade ? "upgrade" : "downgrade",
      subscription_id:  newRzpSubId,
      razorpay_key_id:  rzpKeyId,
      plan_name:        newPlan.name,
      amount_paise:     price.amountPaise,
      billing_cycle:    cycle,
      price_source:     price.source,
      customer_name:    adminContact?.full_name || "",
      customer_email:   adminContact?.email     || "",
      customer_contact: adminContact?.phone      || "",
    }), { status: 200, headers: JSON_H });

  } catch (e) {
    console.error("change-subscription-plan error:", e);
    return err("Internal server error", 500);
  }
});
