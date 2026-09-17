/**
 * Phase 6, Priority 2 (Money) — change-subscription-plan.
 *
 * Self-service upgrade/downgrade, called from SettingsPlanPage. Like
 * create-razorpay-subscription, it makes REAL outbound Razorpay calls when fully
 * configured — no credentials exist locally, so these tests cover everything up to
 * the "payment gateway not configured" boundary. Unlike create-razorpay-subscription,
 * this function validates the target plan BEFORE checking gateway config (see its
 * source, lines ~90-169), so an unknown plan_id here is a clean 400 "Plan not found",
 * not a 500 — worth pinning explicitly since the two sibling functions differ.
 *
 * Also fixed two `.insert()/.invoke().catch()` calls found while writing this test —
 * the same defect class as KNOWN-BUG-172/175/177/179, logged as KNOWN-BUG-180.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenAdminA = "";
let tokenAdminB = "";
let realPlanId = "";

if (runtimeUp) {
  [tokenAdminA, tokenAdminB] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("b", "hospital_admin")]);
  const { data: plan } = await serviceClient().from("subscription_plans").select("id").eq("is_custom_price", false).eq("is_active", true).limit(1).maybeSingle();
  realPlanId = plan?.id ?? "";
}

describe.skipIf(!runtimeUp)("change-subscription-plan", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("change-subscription-plan", { token: null, body: { hospital_id: HOSPITAL_A.id, new_plan_id: realPlanId } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("change-subscription-plan", { token: "garbage", body: { hospital_id: HOSPITAL_A.id, new_plan_id: realPlanId } });
    expect(res.status).toBe(401);
  });

  it("3. missing new_plan_id is a clean 400", async () => {
    const res = await callFunction("change-subscription-plan", { token: tokenAdminA, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's admin cannot change hospital A's plan", async () => {
    const res = await callFunction("change-subscription-plan", {
      token: tokenAdminB,
      body: { hospital_id: HOSPITAL_A.id, new_plan_id: realPlanId },
    });
    expect(res.status).toBe(403);
  });

  it("5. an unknown plan_id is a clean 400 'Plan not found' — plan lookup runs before the gateway check here, unlike create-razorpay-subscription", async () => {
    const res = await callFunction("change-subscription-plan", {
      token: tokenAdminA,
      body: { hospital_id: HOSPITAL_A.id, new_plan_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/Plan not found/);
  });

  it("6. a valid, in-scope request reaches the payment-gateway boundary honestly — no Razorpay credentials configured locally", async () => {
    const res = await callFunction("change-subscription-plan", {
      token: tokenAdminA,
      body: { hospital_id: HOSPITAL_A.id, new_plan_id: realPlanId },
    });
    expect(res.status).toBe(500);
    expect(res.json.error).toMatch(/Payment gateway not configured/);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("7. an invalid coupon code never surfaces a raw stack trace", async () => {
    const res = await callFunction("change-subscription-plan", {
      token: tokenAdminA,
      body: { hospital_id: HOSPITAL_A.id, new_plan_id: realPlanId, coupon_code: "NOPE-DOES-NOT-EXIST" },
    });
    expect([400, 500]).toContain(res.status);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("8. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("change-subscription-plan", { token: tokenAdminA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
