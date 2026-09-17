/**
 * Phase 6, AI-function plumbing — ai-revenue-leak-detector.
 *
 * No caller of this function exists anywhere in src/ today (confirmed by grep) — it is
 * orphaned, so the KNOWN-BUG-200 fix here (AIDisabledError → 403 instead of a confusing 500)
 * has not caused live harm, but is a real fix. Already correctly resolves hospital_id from
 * the authenticated user.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
if (runtimeUp) {
  tokenA = await tokenFor("a", "hospital_admin");
}

describe.skipIf(!runtimeUp)("ai-revenue-leak-detector", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("ai-revenue-leak-detector", { token: null, body: {} });
    expect(res.status).toBe(401);
  });

  it("2. a valid request reaches the real AI-config boundary honestly (no credentials configured locally) — never a false 403 from the entitlement fix", async () => {
    const res = await callFunction("ai-revenue-leak-detector", { token: tokenA, body: {} });
    expect(res.status).toBe(503);
  });

  it("3. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("ai-revenue-leak-detector", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
