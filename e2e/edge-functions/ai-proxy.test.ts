/**
 * Phase 6 — ai-proxy, the shared choke-point every AI edge function routes provider calls
 * through: auth, cross-hospital isolation, server-side entitlement re-verification
 * (checkAIAllowed — the authoritative twin of the browser callAI() gate, since that gate is
 * trivially bypassed by invoking an edge function directly), prompt-registry resolution,
 * provider dispatch, and usage/cost logging.
 *
 * No real AI provider credentials exist anywhere in this local environment (checked directly:
 * platform_ai_keys is empty, no ANTHROPIC_API_KEY/OPENAI_API_KEY/etc. env vars in the edge
 * runtime) — so a real provider call, and therefore the ai_usage_logs / ai_wallet audit trail
 * that only happens after one succeeds, cannot be exercised from here. Tested up to the "No
 * API key configured" boundary instead, the same judgment call already applied to every
 * external-credential-gated function this phase.
 *
 * The entitlement-DISABLED branch of checkAIAllowed (hospital_feature_overrides /
 * plan_features blocking ai_suite) is not exercised live either: reaching it requires a real
 * hospital_subscriptions row, and that table is already a contested UNIQUE(hospital_id)
 * singleton across five other test files this phase
 * (razorpay-subscription-webhook/create-razorpay-subscription/change-subscription-plan for
 * HOSPITAL_A; submit-pre-auth-hcx/dunning-processor for HOSPITAL_B) — a sixth concurrent
 * writer would race all of them. What IS exercised live: the documented fail-open default
 * (no subscription row → AI allowed), reviewed directly against _shared/ai-entitlement.ts's
 * own design-note header rather than assumed.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { HOSPITAL_A, HOSPITAL_B } from "../fixtures/constants";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
let tokenB = "";
if (runtimeUp) {
  [tokenA, tokenB] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("b", "hospital_admin")]);
}

describe.skipIf(!runtimeUp)("ai-proxy", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("ai-proxy", { token: null, body: { provider: "claude", model: "claude-sonnet-4-6", prompt: "hi", hospitalId: HOSPITAL_A.id } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("ai-proxy", { token: "garbage", body: { provider: "claude", model: "claude-sonnet-4-6", prompt: "hi", hospitalId: HOSPITAL_A.id } });
    expect(res.status).toBe(401);
  });

  it("3. cross-hospital: hospital B's token cannot bill an AI call against hospital A's id — the server-side re-check the browser gate alone cannot provide", async () => {
    const res = await callFunction("ai-proxy", { token: tokenB, body: { provider: "claude", model: "claude-sonnet-4-6", prompt: "hi", hospitalId: HOSPITAL_A.id } });
    expect(res.status).toBe(403);
    expect(res.json.error).toMatch(/Cross-hospital/);
  });

  it("4. with no hospital_subscriptions row (HOSPITAL_A's real local state), the entitlement gate fails open and the call reaches the provider-credential check — never a false 403", async () => {
    const res = await callFunction("ai-proxy", { token: tokenA, body: { provider: "claude", model: "claude-sonnet-4-6", prompt: "hi", hospitalId: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/No API key configured/);
  });

  it("5. an unknown provider is a clean 400, reached only after auth/isolation/entitlement all pass", async () => {
    const res = await callFunction("ai-proxy", { token: tokenA, body: { provider: "not-a-real-provider", model: "x", prompt: "hi", hospitalId: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("6. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("ai-proxy", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
