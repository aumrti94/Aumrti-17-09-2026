/**
 * Phase 6, Priority 2 (Money) — razorpay-subscription-webhook.
 *
 * This webhook only ever receives events and writes to this repo's own database — it makes no
 * outbound Razorpay API call unless live platform keys are configured (bed-reprice, superseded-
 * mandate cancellation), neither of which apply with no keys configured locally. So it can be
 * tested safely and completely: set our OWN webhook secret in platform_billing_settings, sign a
 * fabricated-but-realistic Razorpay payload with it, and send it exactly as Razorpay would.
 *
 * This surfaced a real question worth checking directly rather than assuming: the function's own
 * comment says "Fallback: row might not exist yet (race condition), try upsert" — but it only
 * takes that branch when `.update()` returns an `error`, and a Postgres UPDATE that matches zero
 * rows is NOT an error. Test 5 checks whether a hospital with no pre-existing hospital_subscriptions
 * row genuinely gets one created by a webhook event, which is exactly the race the comment names.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, PATIENTS_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const WEBHOOK_SECRET = "test-fixture-webhook-secret-do-not-use-in-prod";
let testPlanId = "";

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postWebhook(bodyObj: unknown, opts: { signature?: string | null; eventId?: string } = {}) {
  const body = JSON.stringify(bodyObj);
  const signature = opts.signature === null ? undefined : opts.signature ?? (await sign(body));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature) headers["x-razorpay-signature"] = signature;
  if (opts.eventId) headers["x-razorpay-event-id"] = opts.eventId;
  return fetch(`${localSupabaseUrl()}/functions/v1/razorpay-subscription-webhook`, {
    method: "POST", headers, body,
  });
}

function chargedPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: "subscription.charged",
    payload: {
      subscription: {
        entity: {
          id: "sub_fixturetest123",
          plan_id: "plan_fixturetest",
          current_start: Math.floor(Date.now() / 1000),
          current_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          notes: {
            hospital_id: HOSPITAL_A.id,
            plan_id: testPlanId,
            plan_name: "Growth",
            billing_cycle: "monthly",
          },
        },
      },
      payment: {
        entity: { id: "pay_fixturetest123", amount: 590000, method: "card", created_at: Math.floor(Date.now() / 1000) },
      },
    },
    ...overrides,
  };
}

if (runtimeUp) {
  const svc = serviceClient();
  await svc.from("platform_billing_settings").update({ razorpay_subscription_webhook_secret: WEBHOOK_SECRET }).eq("id", 1);
  const { data: plan } = await svc.from("subscription_plans").select("id").eq("is_custom_price", false).limit(1).maybeSingle();
  testPlanId = plan?.id ?? "";
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("platform_billing_settings").update({ razorpay_subscription_webhook_secret: null }).eq("id", 1);
  await svc.from("hospital_subscriptions").delete().eq("razorpay_subscription_id", "sub_fixturetest123");
  await svc.from("subscription_events").delete().eq("hospital_id", HOSPITAL_A.id).eq("metadata->>razorpay_subscription_id", "sub_fixturetest123");
  await svc.from("razorpay_webhook_log").delete().like("webhook_id", "evt_fixturetest%");
});

describe.skipIf(!runtimeUp)("razorpay-subscription-webhook", () => {
  it("1. a request with no signature header is rejected — fails closed", async () => {
    const res = await postWebhook(chargedPayload(), { signature: null });
    expect(res.status).toBe(401);
  });

  it("2. a request with a wrong/forged signature is rejected", async () => {
    const res = await postWebhook(chargedPayload(), { signature: "0".repeat(64) });
    expect(res.status).toBe(401);
  });

  it("3. malformed JSON with an otherwise-valid signature does not 500 with a raw stack trace", async () => {
    const badBody = "{not valid json";
    const signature = await sign(badBody);
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/razorpay-subscription-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-razorpay-signature": signature },
      body: badBody,
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("4. a correctly-signed subscription.charged event is accepted and creates the missing hospital_subscriptions row — the race-condition fallback the code's own comment describes", async () => {
    const res = await postWebhook(chargedPayload(), { eventId: "evt_fixturetest_001" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("processed");
    expect(body.newStatus).toBe("active");

    const svc = serviceClient();
    const { data: sub } = await svc
      .from("hospital_subscriptions")
      .select("hospital_id, status, razorpay_subscription_id")
      .eq("hospital_id", HOSPITAL_A.id)
      .maybeSingle();
    expect(sub?.status).toBe("active");
    expect(sub?.razorpay_subscription_id).toBe("sub_fixturetest123");
  });

  it("5. the same webhook event id replayed is skipped as a duplicate, not reprocessed", async () => {
    const res = await postWebhook(chargedPayload(), { eventId: "evt_fixturetest_001" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe("duplicate");
  });

  it("6. a subscription.halted event marks the subscription past_due and stamps past_due_since", async () => {
    const res = await postWebhook(
      { event: "subscription.halted", payload: { subscription: { entity: { id: "sub_fixturetest123", notes: { hospital_id: HOSPITAL_A.id } } } } },
      { eventId: "evt_fixturetest_002" },
    );
    expect(res.status).toBe(200);

    const svc = serviceClient();
    const { data: sub } = await svc.from("hospital_subscriptions").select("status, past_due_since").eq("hospital_id", HOSPITAL_A.id).maybeSingle();
    expect(sub?.status).toBe("past_due");
    expect(sub?.past_due_since).toBeTruthy();
  });

  it("7. subscription.resumed clears past_due_since and returns the subscription to active", async () => {
    const res = await postWebhook(
      { event: "subscription.resumed", payload: { subscription: { entity: { id: "sub_fixturetest123", notes: { hospital_id: HOSPITAL_A.id } } } } },
      { eventId: "evt_fixturetest_003" },
    );
    expect(res.status).toBe(200);

    const svc = serviceClient();
    const { data: sub } = await svc.from("hospital_subscriptions").select("status, past_due_since").eq("hospital_id", HOSPITAL_A.id).maybeSingle();
    expect(sub?.status).toBe("active");
    expect(sub?.past_due_since).toBeNull();
  });

  it("8. an event type this webhook does not handle is acknowledged as ignored, not an error", async () => {
    const res = await postWebhook({ event: "subscription.updated", payload: {} }, { eventId: "evt_fixturetest_004" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ignored");
  });
});
