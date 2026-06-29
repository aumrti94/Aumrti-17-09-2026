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
 *   { new_plan_id: string, hospital_id: string, coupon_code?: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const rzpKeyId    = Deno.env.get("RAZORPAY_SUBSCRIPTION_KEY_ID");
    const rzpSecret   = Deno.env.get("RAZORPAY_SUBSCRIPTION_KEY_SECRET");

    // ── Auth: verify caller is a hospital super_admin ──────────────────────
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const { new_plan_id, hospital_id, coupon_code } = await req.json();
    if (!new_plan_id || !hospital_id) return err("new_plan_id and hospital_id required");

    const db = createClient(supabaseUrl, serviceKey);

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
      .select("id, plan_id, status, razorpay_subscription_id, subscription_plans!inner(name, slug, price_monthly, is_custom_price)")
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    // ── Fetch target plan ──────────────────────────────────────────────────
    const { data: newPlan } = await db
      .from("subscription_plans")
      .select("id, name, slug, price_monthly, price_yearly, razorpay_plan_id, is_custom_price, trial_days")
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

    // ── Auto-create Razorpay plan ID if missing ────────────────────────────
    let rzpPlanId = newPlan.razorpay_plan_id;
    if (!rzpPlanId && rzpKeyId && rzpSecret) {
      const auth = btoa(`${rzpKeyId}:${rzpSecret}`);
      const createPlanRes = await fetch("https://api.razorpay.com/v1/plans", {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          period: "monthly",
          interval: 1,
          item: {
            name: `Aumrti HMS ${newPlan.name}`,
            amount: Math.round(newPlan.price_monthly * 100),
            currency: "INR",
            description: `Aumrti HMS ${newPlan.name} monthly subscription`,
          },
        }),
      });
      if (createPlanRes.ok) {
        const rzpPlan = await createPlanRes.json();
        rzpPlanId = rzpPlan.id;
        await db.from("subscription_plans").update({ razorpay_plan_id: rzpPlanId }).eq("id", new_plan_id);
      }
    }

    if (!rzpPlanId) {
      return err("Payment gateway not configured for this plan. Contact support@aumrti.in");
    }

    // ── Cancel existing Razorpay subscription ─────────────────────────────
    if (currentSub?.razorpay_subscription_id && rzpKeyId && rzpSecret) {
      const auth = btoa(`${rzpKeyId}:${rzpSecret}`);
      // cancel_at_cycle_end=1 for downgrade (let current period expire), 0 for upgrade (immediate)
      const cancelAtCycleEnd = isUpgrade ? 0 : 1;
      await fetch(`https://api.razorpay.com/v1/subscriptions/${currentSub.razorpay_subscription_id}/cancel`, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd }),
      }).catch((e) => console.error("Razorpay cancel failed:", e.message));
    }

    // ── Create new Razorpay subscription ───────────────────────────────────
    let newRzpSubId: string | null = null;
    if (rzpKeyId && rzpSecret) {
      const auth = btoa(`${rzpKeyId}:${rzpSecret}`);
      const rzpRes = await fetch("https://api.razorpay.com/v1/subscriptions", {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: rzpPlanId,
          total_count: 240,
          quantity: 1,
          customer_notify: 1,
          notes: {
            hospital_id,
            plan_id: new_plan_id,
            plan_name: newPlan.name,
            change_type: isUpgrade ? "upgrade" : "downgrade",
          },
        }),
      });
      if (rzpRes.ok) {
        const rzpSub = await rzpRes.json();
        newRzpSubId = rzpSub.id;
      }
    }

    // ── Update hospital_subscriptions ──────────────────────────────────────
    await db.from("hospital_subscriptions").upsert({
      hospital_id,
      plan_id: new_plan_id,
      status: currentStatus === "active" ? "active" : "trial",
      razorpay_subscription_id: newRzpSubId,
      razorpay_plan_id: rzpPlanId,
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
    const effectivePrice = discountPct > 0
      ? newPlan.price_monthly * (1 - discountPct / 100)
      : newPlan.price_monthly;

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
      amount_paise:     Math.round(effectivePrice * 100),
      customer_name:    adminContact?.full_name || "",
      customer_email:   adminContact?.email     || "",
      customer_contact: adminContact?.phone      || "",
    }), { status: 200, headers: JSON_H });

  } catch (e) {
    console.error("change-subscription-plan error:", e);
    return err("Internal server error", 500);
  }
});
