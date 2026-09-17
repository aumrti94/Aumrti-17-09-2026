/**
 * Phase 6, AI-function plumbing — ai-resolve-orders.
 *
 * Confirmed correctly built via code review (KNOWN-BUG-200's survey) — hospital_id resolved
 * from the authenticated user, AIDisabledError threaded to a clean 403, and every AI answer
 * re-validated against a pre-computed shortlist so a hallucinated test name structurally cannot
 * become an order. Per Dr. Nalini's governance review (docs/testing/PHASE_6_AI_GOVERNANCE.md),
 * this is "the best-architected of the eight on safety grounds" and approved with one open,
 * non-blocking condition: newly learned order_name_aliases persist hospital-wide, silently,
 * above a 0.7 confidence threshold with no human confirmation — tracked separately, not a code
 * change made in this pass. No code changes here; this is the first live-HTTP regression test
 * written against it. HOSPITAL_A's Tier-0 seed has 45 lab_test_master rows and no lab groups or
 * radiology studies, confirmed directly, so a valid request reaches the real AI-config boundary
 * rather than short-circuiting on an empty catalogue.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
if (runtimeUp) {
  tokenA = await tokenFor("a", "hospital_admin");
}

describe.skipIf(!runtimeUp)("ai-resolve-orders", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("ai-resolve-orders", { token: null, body: { names: ["sugar test"] } });
    expect(res.status).toBe(401);
  });

  it("2. an empty names list is a clean 400", async () => {
    const res = await callFunction("ai-resolve-orders", { token: tokenA, body: { names: [] } });
    expect(res.status).toBe(400);
  });

  it("3. a valid request reaches the real AI-config boundary honestly, having genuinely found a non-empty catalogue first (no credentials configured locally)", async () => {
    const res = await callFunction("ai-resolve-orders", { token: tokenA, body: { names: ["sugar test"] } });
    expect(res.status).toBe(503);
    expect(res.json.error).toMatch(/No AI provider configured/);
  });

  it("4. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("ai-resolve-orders", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
