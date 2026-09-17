/**
 * Phase 6, AI-function plumbing — regression smoke test for the entitlement-threading fix
 * (KNOWN-BUG-200) applied to ai-differential-diagnosis, ai-discharge-summary, ai-icd-suggest,
 * and ai-radiology-impression: each already enforced entitlement transitively via
 * resolveAiConfig()'s internal checkAIAllowed() call, but their outer catch-all didn't
 * special-case the AIDisabledError it throws, so a disabled hospital got a confusing 500
 * instead of a clean 403. The fix checks explicitly up front (correct status/message) and
 * threads the result into resolveAiConfig via `options.entitlement` so the same 4 queries
 * aren't re-run.
 *
 * This file only confirms the fix did not regress each function's own already-reachable
 * boundary (auth passes, a real request reaches the function's own existing logic honestly)
 * — with no hospital_subscriptions row for HOSPITAL_A, the new/threaded checks fail open, so
 * these all reach the SAME boundary they reached before this session's edits. The
 * entitlement-DISABLED branch itself is not independently re-verified live here: it needs a
 * real hospital_subscriptions row, a contested singleton across several other test files this
 * phase (see ai-proxy.test.ts's own note on the same constraint).
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
if (runtimeUp) {
  tokenA = await tokenFor("a", "hospital_admin");
}

describe.skipIf(!runtimeUp)("AI clinical functions — entitlement-threading regression", () => {
  it("ai-differential-diagnosis: still reaches the real AI-config boundary honestly (fail-open, no credentials)", async () => {
    const res = await callFunction("ai-differential-diagnosis", { token: tokenA, body: { chief_complaint: "fever and cough" } });
    expect(res.status).toBe(503);
    expect(res.json.error).toMatch(/No AI provider configured/);
  });

  it("ai-discharge-summary: a nonexistent admission_id still cleanly 404s past the entitlement check", async () => {
    const res = await callFunction("ai-discharge-summary", { token: tokenA, body: { admission_id: "00000000-0000-0000-0000-000000000000" } });
    expect(res.status).toBe(404);
  });

  it("ai-icd-suggest: an unknown visit still reaches the function's own existing logic honestly, not a false 403", async () => {
    const res = await callFunction("ai-icd-suggest", { token: tokenA, body: { visit_type: "opd", visit_id: "00000000-0000-0000-0000-000000000000" } });
    expect(res.status).not.toBe(403);
  });

  it("ai-radiology-impression: still reaches the real AI-config boundary honestly (fail-open, no credentials)", async () => {
    const res = await callFunction("ai-radiology-impression", { token: tokenA, body: { findings: "no acute findings" } });
    expect(res.status).toBe(503);
    expect(res.json.error).toMatch(/No AI provider configured/);
  });
});
