/**
 * create-razorpay-subscription
 *
 * Called by the hospital frontend when a hospital wants to subscribe or upgrade.
 * Uses AUMRTI's own Razorpay account (not the hospital's patient-billing keys).
 *
 * Required Supabase secrets (set via Dashboard → Edge Functions → Secrets):
 *   RAZORPAY_SUBSCRIPTION_KEY_ID     — Aumrti's Razorpay public key
 *   RAZORPAY_SUBSCRIPTION_KEY_SECRET — Aumrti's Razorpay secret key
 *
 * Request body:
 *   { plan_id: string, hospital_id: string, coupon_code?: string,
 *     billing_cycle?: 'monthly' | 'yearly' }
 *
 * Response:
 *   { subscription_id, razorpay_key_id, plan_name, amount_paise, billing_cycle,
 *     price_source, customer_name, customer_email, customer_contact }
 *
 * Pricing correctness (see migration 20261008000154)
 * --------------------------------------------------
 * This function used to bind every subscription to a single
 * `subscription_plans.razorpay_plan_id` at LIST price, while separately
 * computing a discounted figure for the response body. The result was that
 * neither `hospital_pricing_overrides` nor any coupon ever reduced what was
 * actually charged — the customer saw one number and was billed another.
 *
 * A Razorpay plan is an immutable (period, interval, amount) tuple, so the
 * amount now selects the plan rather than the other way round:
 *   resolveEffectivePrice → claim_razorpay_plan_slot → create only on miss.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveEffectivePrice,
  razorpayPeriodForCycle,
  totalCountForCycle,
  type BillingCycle,
} from "../_shared/platform-billing.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const JSON_HEADERS = { ...CORS, "Content-Type": "application/json" };

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: JSON_HEADERS });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── Auth: verify the caller is a signed-in hospital user ──────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("Unauthorized", 401);

    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const anonKey      = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const keyId        = Deno.env.get("RAZORPAY_SUBSCRIPTION_KEY_ID");
    const keySecret    = Deno.env.get("RAZORPAY_SUBSCRIPTION_KEY_SECRET");

    if (!keyId || !keySecret) return err("Payment gateway not configured. Contact support.", 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    // ── Parse body ────────────────────────────────────────────────────────
    const { plan_id, hospital_id, coupon_code, billing_cycle } = await req.json();
    if (!plan_id || !hospital_id) return err("plan_id and hospital_id are required");

    const cycle: BillingCycle = billing_cycle === "yearly" ? "yearly" : "monthly";

    // Use service role for all internal queries
    const db = createClient(supabaseUrl, serviceKey);

    // ── Fetch plan ────────────────────────────────────────────────────────
    const { data: plan } = await db
      .from("subscription_plans")
      .select("id, name, price_monthly, price_yearly, razorpay_plan_id, is_custom_price")
      .eq("id", plan_id)
      .maybeSingle();

    if (!plan) return err("Plan not found");
    if (plan.is_custom_price) return err("Enterprise plans require a custom quote. Please contact support@aumrti.in");

    // ── Validate coupon ───────────────────────────────────────────────────
    // Must happen BEFORE price resolution: the coupon changes the amount, and
    // the amount decides which Razorpay plan the subscription binds to.
    let discountPct = 0;
    let couponApplied: string | null = null;

    if (coupon_code) {
      const code = String(coupon_code).toUpperCase().trim();
      const { data: coupon } = await db
        .from("discount_codes")
        .select("*")
        .eq("code", code)
        .eq("is_active", true)
        .maybeSingle();

      if (!coupon) return err(`Coupon code "${code}" is invalid or expired`);
      if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
        return err(`Coupon code "${code}" has expired`);
      }
      if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
        return err(`Coupon code "${code}" has reached its usage limit`);
      }
      if (coupon.applies_to !== "all" && coupon.applies_to !== plan.name.toLowerCase()) {
        return err(`Coupon code "${code}" does not apply to the ${plan.name} plan`);
      }
      discountPct = coupon.discount_type === "percentage" ? Number(coupon.discount_value) : 0;
      couponApplied = code;
    }

    // ── Resolve the price this hospital is actually charged ───────────────
    // Negotiated rate (if any and still valid) → coupon. Both were previously
    // display-only; this is the value that reaches the payment gateway.
    const { data: override } = await db
      .from("hospital_pricing_overrides")
      .select("monthly_price, yearly_price, valid_until")
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    const price = resolveEffectivePrice({ plan, override, cycle, couponPct: discountPct });

    if (!price.available) {
      return err(price.reason ?? `The ${plan.name} plan is not available ${cycle}`);
    }

    // ── Resolve the Razorpay plan for (plan, cycle, amount) ───────────────
    const authBasic = btoa(`${keyId}:${keySecret}`);

    const { data: cachedPlanId } = await db.rpc("claim_razorpay_plan_slot", {
      p_plan_id: plan.id,
      p_billing_cycle: cycle,
      p_amount_paise: price.amountPaise,
      p_razorpay_plan_id: null,
    });

    let razorpayPlanId: string | null = cachedPlanId ?? null;

    if (!razorpayPlanId) {
      const cycleWord = cycle === "yearly" ? "annual" : "monthly";
      const createPlanRes = await fetch("https://api.razorpay.com/v1/plans", {
        method: "POST",
        headers: { "Authorization": `Basic ${authBasic}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          period:   razorpayPeriodForCycle(cycle),
          interval: 1,
          item: {
            name:        `Aumrti HMS ${plan.name} (${cycleWord})`,
            amount:      price.amountPaise,
            currency:    "INR",
            description: `Aumrti HMS ${plan.name} ${cycleWord} subscription`,
          },
        }),
      });
      if (!createPlanRes.ok) {
        const rzpErr = await createPlanRes.json().catch(() => ({}));
        console.error("Auto-create Razorpay plan failed:", rzpErr);
        return err("Payment gateway error while setting up plan. Contact support@aumrti.in", 502);
      }
      const rzpPlan = await createPlanRes.json();

      // Claim the slot. If another request won the race, this returns THEIR
      // plan id and we bind to it — the plan we just created is left unused
      // rather than becoming a second live plan at the same price.
      const { data: claimed } = await db.rpc("claim_razorpay_plan_slot", {
        p_plan_id: plan.id,
        p_billing_cycle: cycle,
        p_amount_paise: price.amountPaise,
        p_razorpay_plan_id: rzpPlan.id,
      });
      razorpayPlanId = claimed ?? rzpPlan.id;

      if (razorpayPlanId !== rzpPlan.id) {
        console.log(`Lost plan-slot race; using ${razorpayPlanId}, discarding ${rzpPlan.id}`);
      } else {
        console.log(`Created Razorpay plan ${razorpayPlanId} for ${plan.name} ${cycle} @ ${price.amountPaise}p`);
      }
    }

    // ── Fetch hospital + admin contact ────────────────────────────────────
    const [hospRes, adminRes] = await Promise.all([
      db.from("hospitals").select("name, gstin").eq("id", hospital_id).maybeSingle(),
      db.from("users")
        .select("full_name, email, phone")
        .eq("hospital_id", hospital_id)
        .in("role", ["super_admin", "hospital_admin"])
        .limit(1)
        .maybeSingle(),
    ]);

    const hospital   = hospRes.data;
    const adminUser  = adminRes.data;

    // ── Create Razorpay subscription ──────────────────────────────────────

    const subscriptionBody: Record<string, unknown> = {
      plan_id:        razorpayPlanId,
      total_count:    totalCountForCycle(cycle),   // ~20 years of cycles
      quantity:       1,
      customer_notify: 1,
      // The webhook reads these back — it has no other way to know which cycle
      // or amount a payment belongs to when Razorpay sends a bare payment event.
      notes: {
        hospital_id,
        hospital_name: hospital?.name ?? "",
        plan_id: plan.id,
        plan_name: plan.name,
        billing_cycle: cycle,
        amount_paise: String(price.amountPaise),
        price_source: price.source,
        ...(couponApplied ? { coupon_code: couponApplied } : {}),
      },
    };

    const rzpRes = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authBasic}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscriptionBody),
    });

    if (!rzpRes.ok) {
      const rzpErr = await rzpRes.json().catch(() => ({}));
      console.error("Razorpay subscription creation failed:", rzpErr);
      return err(rzpErr?.error?.description ?? "Payment gateway error. Please try again.", 502);
    }

    const rzpSub = await rzpRes.json();

    // ── Upsert hospital_subscriptions (pending until webhook confirms) ────
    await db.from("hospital_subscriptions").upsert({
      hospital_id,
      plan_id: plan.id,
      status: "trial",               // stays trial until webhook confirms payment
      razorpay_subscription_id: rzpSub.id,
      razorpay_plan_id: razorpayPlanId,
      billing_cycle: cycle,
      // What we will actually be charging, so MRR/dunning/invoices stop
      // re-deriving it from the list price and diverging from reality.
      effective_amount_inr: price.amountInr,
      ...(couponApplied ? {
        discount_code_applied: couponApplied,
        discount_pct: discountPct,
      } : {}),
    }, { onConflict: "hospital_id" });

    // ── Return checkout params to frontend ────────────────────────────────
    // Same resolver as the gateway binding above — the displayed amount and the
    // charged amount cannot disagree by construction.
    return new Response(JSON.stringify({
      subscription_id:    rzpSub.id,
      razorpay_key_id:    keyId,
      plan_name:          plan.name,
      amount_paise:       price.amountPaise,
      billing_cycle:      cycle,
      price_source:       price.source,
      list_price_inr:     price.listInr,
      discount_pct:       discountPct,
      customer_name:      adminUser?.full_name ?? hospital?.name ?? "",
      customer_email:     adminUser?.email ?? "",
      customer_contact:   adminUser?.phone ?? "",
    }), { status: 200, headers: JSON_HEADERS });

  } catch (e) {
    console.error("create-razorpay-subscription error:", e);
    return err("Internal server error", 500);
  }
});
