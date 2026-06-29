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
 *   { plan_id: string, hospital_id: string, coupon_code?: string }
 *
 * Response:
 *   { subscription_id, razorpay_key_id, plan_name, amount_paise,
 *     customer_name, customer_email, customer_contact }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { plan_id, hospital_id, coupon_code } = await req.json();
    if (!plan_id || !hospital_id) return err("plan_id and hospital_id are required");

    // Use service role for all internal queries
    const db = createClient(supabaseUrl, serviceKey);

    // ── Fetch plan ────────────────────────────────────────────────────────
    const { data: plan } = await db
      .from("subscription_plans")
      .select("id, name, price_monthly, razorpay_plan_id, is_custom_price")
      .eq("id", plan_id)
      .maybeSingle();

    if (!plan) return err("Plan not found");
    if (plan.is_custom_price) return err("Enterprise plans require a custom quote. Please contact support@aumrti.in");

    // Auto-create Razorpay plan ID if not yet configured
    let razorpayPlanId = plan.razorpay_plan_id;
    if (!razorpayPlanId) {
      if (!keyId || !keySecret) {
        return err("Payment gateway not configured. Contact support@aumrti.in", 500);
      }
      const authBasic = btoa(`${keyId}:${keySecret}`);
      const createPlanRes = await fetch("https://api.razorpay.com/v1/plans", {
        method: "POST",
        headers: { "Authorization": `Basic ${authBasic}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          period:   "monthly",
          interval: 1,
          item: {
            name:        `Aumrti HMS ${plan.name}`,
            amount:      Math.round(plan.price_monthly * 100), // paise
            currency:    "INR",
            description: `Aumrti HMS ${plan.name} monthly subscription`,
          },
        }),
      });
      if (!createPlanRes.ok) {
        const rzpErr = await createPlanRes.json().catch(() => ({}));
        console.error("Auto-create Razorpay plan failed:", rzpErr);
        return err("Payment gateway error while setting up plan. Contact support@aumrti.in", 502);
      }
      const rzpPlan = await createPlanRes.json();
      razorpayPlanId = rzpPlan.id;
      // Persist the plan ID so future calls don't repeat this step
      await db.from("subscription_plans")
        .update({ razorpay_plan_id: razorpayPlanId })
        .eq("id", plan_id);
      console.log(`Auto-created Razorpay plan ${razorpayPlanId} for plan ${plan.name}`);
    }

    // ── Validate coupon ───────────────────────────────────────────────────
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
    const auth = btoa(`${keyId}:${keySecret}`);

    const subscriptionBody: Record<string, unknown> = {
      plan_id:        razorpayPlanId,
      total_count:    240,        // 20 years — effectively perpetual
      quantity:       1,
      customer_notify: 1,
      notes: {
        hospital_id,
        hospital_name: hospital?.name ?? "",
        plan_id: plan.id,
        plan_name: plan.name,
        ...(couponApplied ? { coupon_code: couponApplied } : {}),
      },
    };

    const rzpRes = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
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
      ...(couponApplied ? {
        discount_code_applied: couponApplied,
        discount_pct: discountPct,
      } : {}),
    }, { onConflict: "hospital_id" });

    // ── Return checkout params to frontend ────────────────────────────────
    const effectiveMonthly = discountPct > 0
      ? plan.price_monthly * (1 - discountPct / 100)
      : plan.price_monthly;

    return new Response(JSON.stringify({
      subscription_id:    rzpSub.id,
      razorpay_key_id:    keyId,
      plan_name:          plan.name,
      amount_paise:       Math.round(effectiveMonthly * 100),
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
