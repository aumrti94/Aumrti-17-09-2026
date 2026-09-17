/**
 * Phase 6, AI-function plumbing — ai-clarifying-questions.
 *
 * Confirmed correctly built via code review (KNOWN-BUG-200's survey) — already resolves
 * hospital_id from the authenticated user (never trusts the request body), already threads
 * AIDisabledError to a clean 403, already uses prompt_registry with a byte-identical fallback.
 * Per Dr. Nalini's governance review (docs/testing/PHASE_6_AI_GOVERNANCE.md), this is the
 * best-designed of the eight clinical AI functions on governance grounds and was approved
 * as-is — no code-fix condition attached, only the systemic PHI/consent finding that applies
 * across all eight. No code changes here; this is the first live-HTTP regression test written
 * against it.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
if (runtimeUp) {
  tokenA = await tokenFor("a", "hospital_admin");
}

describe.skipIf(!runtimeUp)("ai-clarifying-questions", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("ai-clarifying-questions", { token: null, body: { chief_complaint: "fever" } });
    expect(res.status).toBe(401);
  });

  it("2. missing chief_complaint is a clean 400", async () => {
    const res = await callFunction("ai-clarifying-questions", { token: tokenA, body: {} });
    expect(res.status).toBe(400);
  });

  it("3. a valid request reaches the real AI-config boundary honestly (no credentials configured locally) — never a false 403 from unrelated entitlement plumbing", async () => {
    const res = await callFunction("ai-clarifying-questions", { token: tokenA, body: { chief_complaint: "fever for 3 days" } });
    expect(res.status).toBe(503);
    expect(res.json.error).toMatch(/No AI provider configured/);
  });

  it("4. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("ai-clarifying-questions", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
