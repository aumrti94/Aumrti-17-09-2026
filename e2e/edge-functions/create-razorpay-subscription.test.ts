/**
 * Phase 6, Priority 2 (Money) — create-razorpay-subscription.
 *
 * Already fixed in Phase 4 (KNOWN-BUG-126): "any signed-in user of any hospital could name
 * another hospital's id, read its negotiated pricing/add-ons/bed count, and create a real
 * Razorpay subscription mandate against it." Proves that fix live.
 *
 * This function creates REAL live Razorpay payment mandates when fully configured — no
 * Razorpay credentials exist in this local/test environment (by design; this is not a
 * function to exercise against a live payment gateway from an automated test), so these
 * tests cover everything up to the "payment gateway not configured" boundary, which is
 * itself the real, correct local behaviour rather than a gap in coverage.
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
  const { data: plan } = await serviceClient().from("subscription_plans").select("id").eq("is_custom_price", false).limit(1).maybeSingle();
  realPlanId = plan?.id ?? "";
}

describe.skipIf(!runtimeUp)("create-razorpay-subscription", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("create-razorpay-subscription", { token: null, body: { hospital_id: HOSPITAL_A.id, plan_id: realPlanId } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("create-razorpay-subscription", { token: "garbage", body: { hospital_id: HOSPITAL_A.id, plan_id: realPlanId } });
    expect(res.status).toBe(401);
  });

  it("3. missing hospital_id is a clean 400", async () => {
    const res = await callFunction("create-razorpay-subscription", { token: tokenAdminA, body: { plan_id: realPlanId } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's admin cannot create a subscription mandate against hospital A's id — the regression test for the fix", async () => {
    const res = await callFunction("create-razorpay-subscription", {
      token: tokenAdminB,
      body: { hospital_id: HOSPITAL_A.id, plan_id: realPlanId },
    });
    expect(res.status).toBe(403);
  });

  it("5. an unknown plan_id never surfaces a raw stack trace (the payment-gateway-not-configured check runs first locally, before plan lookup — a real, honest 500, not a crash)", async () => {
    const res = await callFunction("create-razorpay-subscription", {
      token: tokenAdminA,
      body: { hospital_id: HOSPITAL_A.id, plan_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect([400, 500]).toContain(res.status);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("6. a valid, in-scope request reaches the payment-gateway boundary honestly — no Razorpay credentials configured locally, so this is the correct terminal state, not a raw crash", async () => {
    const res = await callFunction("create-razorpay-subscription", {
      token: tokenAdminA,
      body: { hospital_id: HOSPITAL_A.id, plan_id: realPlanId },
    });
    expect(res.status).toBe(500);
    expect(res.json.error).toMatch(/Payment gateway not configured/);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("create-razorpay-subscription", { token: tokenAdminA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
