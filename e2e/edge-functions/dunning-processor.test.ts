/**
 * Phase 6, Priority 2 (Money) — dunning-processor.
 *
 * Cron-only function (pg_cron every 12h) that emails/SMSes/WhatsApps a hospital's admin
 * once its subscription goes past_due, per an admin-configurable cadence in
 * dunning_cadence_rules. Uses HOSPITAL_B, not HOSPITAL_A: `hospital_subscriptions` has a
 * hard UNIQUE(hospital_id) — one row per hospital, ever — and HOSPITAL_A's row is already
 * exercised by razorpay-subscription-webhook.test.ts / create-razorpay-subscription.test.ts /
 * change-subscription-plan.test.ts in the same suite run; sharing it here would race.
 *
 * Two real defects found and fixed writing this test, logged as KNOWN-BUG-181:
 * (a) no auth check of any kind beyond the platform's own JWT verification, which accepts
 *     any logged-in user's session token, not just the service role this is meant to be
 *     cron-only-restricted to (the same gap class as KNOWN-BUG-126's internal-only findings);
 * (b) the `invoke()` helper never checked the downstream call's HTTP status, so a failed
 *     notification send was recorded as `dunning_attempts.status = "sent"` — indistinguishable
 *     from a real delivery.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, serviceClient, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { HOSPITAL_B } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable, tokenFor } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let realPlanId = "";

async function callDunning(auth: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/dunning-processor`, { method: "POST", headers });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json };
}

if (runtimeUp) {
  const svc = serviceClient();
  const { data: plan } = await svc.from("subscription_plans").select("id").eq("is_custom_price", false).eq("is_active", true).limit(1).maybeSingle();
  realPlanId = plan?.id ?? "";

  // Day-1-past-due fixture: the cadence seed's day_offset=1 rule is attempt_number 1,
  // channel "email" — 25h ago so daysPastDue floors to 1, not 0.
  const oneDayPlusAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await svc.from("hospital_subscriptions").upsert({
    hospital_id: HOSPITAL_B.id,
    plan_id: realPlanId,
    status: "past_due",
    updated_at: oneDayPlusAgo,
  }, { onConflict: "hospital_id" });
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("dunning_attempts").delete().eq("hospital_id", HOSPITAL_B.id);
  await svc.from("hospital_subscriptions").delete().eq("hospital_id", HOSPITAL_B.id);
});

describe.skipIf(!runtimeUp)("dunning-processor", () => {
  it("1. no Authorization header is rejected — this is meant to be cron/service-role only", async () => {
    const res = await callDunning(null);
    expect(res.status).toBe(401);
  });

  it("2. an ordinary logged-in user's session JWT is rejected too — the regression test for the fix (platform JWT verification alone accepted any authenticated session)", async () => {
    const token = await tokenFor("b", "hospital_admin");
    const res = await callDunning(`Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("3. a forged/garbage bearer is rejected", async () => {
    const res = await callDunning("Bearer garbage-not-a-real-key");
    expect(res.status).toBe(401);
  });

  it("4. the real service-role secret is accepted and sends the day-1 email attempt for the past-due fixture, recording it as sent", async () => {
    const res = await callDunning(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`);
    expect(res.status).toBe(200);
    expect(res.json.errors).toBe(0);

    const svc = serviceClient();
    const { data: attempts } = await svc
      .from("dunning_attempts")
      .select("attempt_number, channel, status")
      .eq("hospital_id", HOSPITAL_B.id);
    expect(attempts).toHaveLength(1);
    expect(attempts![0]).toMatchObject({ attempt_number: 1, channel: "email", status: "sent" });
  });

  it("5. re-running immediately does not double-send today's already-sent attempt", async () => {
    const res = await callDunning(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`);
    expect(res.status).toBe(200);

    const svc = serviceClient();
    const { data: attempts } = await svc
      .from("dunning_attempts")
      .select("id")
      .eq("hospital_id", HOSPITAL_B.id)
      .eq("attempt_number", 1);
    expect(attempts).toHaveLength(1);
  });
});
