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
import { getRazorpaySubscriptionKeys } from "../_shared/platform-razorpay-config.ts";
import { SUPPORT_EMAIL } from "../_shared/brand.ts";

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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    // ── Parse body ────────────────────────────────────────────────────────
    const { plan_id, hospital_id, coupon_code, billing_cycle, purpose, amount_inr } = await req.json();
    if (!hospital_id) return err("hospital_id is required");

    // Use service role for all internal queries
    const db = createClient(supabaseUrl, serviceKey);

    // The ai_wallet_topup branch already checked this; the plain subscription
    // flow below never did — any signed-in user of any hospital could name
    // another hospital's id, read its negotiated pricing/add-ons/bed count,
    // and create a real Razorpay subscription mandate against it. Checked
    // once here, ahead of both branches. Found in the Phase 4 isolation
    // audit — see KNOWN_BUGS.md.
    const { data: callerRow } = await db
      .from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!callerRow || callerRow.hospital_id !== hospital_id) return err("Forbidden", 403);

    // Razorpay keys: /platform-configured row first, env vars as fallback.
    const { keyId, keySecret } = await getRazorpaySubscriptionKeys(db);
    if (!keyId || !keySecret) {
      return err("Payment gateway not configured. Add your Razorpay keys in /platform → Payments.", 500);
    }

    // ── AI-wallet top-up: a one-time order, not a subscription ─────────────
    // Folded into this function (rather than a dedicated one) to stay within the
    // project's edge-function quota. The wallet is credited by
    // razorpay-subscription-webhook on payment.captured (notes.purpose).
    if (purpose === "ai_wallet_topup") {
      const amount = Number(amount_inr);
      if (!Number.isFinite(amount) || amount < 100 || amount > 500_000) {
        return err("Top-up amount must be between ₹100 and ₹5,00,000");
      }
      // Caller must be a super/hospital admin of this hospital.
      const { data: caller } = await db
        .from("users").select("role, hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (!caller || caller.hospital_id !== hospital_id) return err("Forbidden", 403);
      if (!["super_admin", "hospital_admin"].includes(caller.role)) return err("Forbidden", 403);

      const amountPaise = Math.round(amount * 100);
      const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Authorization": `Basic ${btoa(`${keyId}:${keySecret}`)}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountPaise, currency: "INR",
          notes: { purpose: "ai_wallet_topup", hospital_id },
        }),
      });
      if (!orderRes.ok) {
        const e = await orderRes.json().catch(() => ({}));
        console.error("AI wallet order failed:", e);
        return err(e?.error?.description ?? "Payment gateway error. Please try again.", 502);
      }
      const order = await orderRes.json();
      return new Response(JSON.stringify({
        order_id: order.id, razorpay_key_id: keyId, amount_paise: amountPaise, currency: "INR",
      }), { status: 200, headers: JSON_HEADERS });
    }

    // ── Subscription flow (requires a plan) ────────────────────────────────
    if (!plan_id) return err("plan_id and hospital_id are required");
    const cycle: BillingCycle = billing_cycle === "yearly" ? "yearly" : "monthly";

    // ── Fetch plan ────────────────────────────────────────────────────────
    const { data: plan } = await db
      .from("subscription_plans")
      .select("id, name, price_monthly, price_yearly, razorpay_plan_id, is_custom_price, beds_included, bed_block_size, price_per_bed_block, price_per_bed_block_yearly")
      .eq("id", plan_id)
      .maybeSingle();

    if (!plan) return err("Plan not found");
    if (plan.is_custom_price) return err(`Enterprise plans require a custom quote. Please contact ${SUPPORT_EMAIL}`);

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

    // ── Bed-banded pricing (v3): bill the live active-bed count ───────────
    // Same definition as the migration-150 enforcement trigger, via the
    // canonical current_active_beds() RPC — the billed count and the enforced
    // count cannot diverge. NULL bed columns on the plan = no bed fee.
    const { data: activeBeds } = await db.rpc("current_active_beds", {
      p_hospital_id: hospital_id,
    });

    // Purchased add-ons must be inside the mandate amount from the start —
    // otherwise a hospital that owns add-ons and re-subscribes (e.g. after a
    // lapsed mandate) would authorise the base price and silently stop paying
    // for them until the next reconciliation.
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
      plan, override, cycle, couponPct: discountPct, activeBeds,
      addonsMonthlyInr,
      addonsYearlyInr: addonsYearlyInr > 0 ? addonsYearlyInr : null,
    });

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
        return err(`Payment gateway error while setting up plan. Contact ${SUPPORT_EMAIL}`, 502);
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
    //
    // NEVER DEMOTE AN ALREADY-ACTIVE HOSPITAL TO "trial".
    //
    // This upsert used to write `status: "trial"` unconditionally. On a first-time checkout
    // that is right. On a RE-SUBSCRIBE or a plan change by a hospital that is already paying,
    // it is a silent outage:
    //
    //   · the webhook stamps `trial_ends_at = new Date().toISOString()` on first activation
    //     (razorpay-subscription-webhook/index.ts), i.e. the activation instant — permanently
    //     in the past;
    //   · so the moment status flips back to "trial", resolveSubscriptionAccess() sees a trial
    //     that ended `graceDays` ago and returns blocked;
    //   · `enforce_subscription_access()` (migration ...163) then refuses EVERY write from
    //     every user of that hospital, and the read-only banner appears.
    //
    // A paying hospital is put into read-only by starting a checkout. It happened to the QA
    // tenant on 2026-08-31 and took a manual database edit to undo.
    //
    // `change-subscription-plan/index.ts` already guards this correctly; this is the same
    // guard. Reading the current status first is what makes the upsert non-destructive.
    const { data: existingSub } = await db
      .from("hospital_subscriptions")
      .select("status")
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    const currentStatus = String(existingSub?.status ?? "").toLowerCase();

    await db.from("hospital_subscriptions").upsert({
      hospital_id,
      plan_id: plan.id,
      // An active hospital stays active while it re-subscribes; anything else stays/becomes
      // trial until the webhook confirms payment.
      status: currentStatus === "active" ? "active" : "trial",
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
