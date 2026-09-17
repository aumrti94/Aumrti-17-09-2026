/**
 * Phase 6, AI-function plumbing — ai-generate-clinical-note.
 *
 * No caller of this function exists anywhere in src/ today (confirmed by grep) — it is
 * orphaned, so the KNOWN-BUG-200 fix here (AIDisabledError → 403 instead of a confusing 500)
 * has not caused live harm, but is a real fix. Already correctly resolves hospital_id from
 * the authenticated user, never trusting the request body.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
if (runtimeUp) {
  tokenA = await tokenFor("a", "hospital_admin");
}

describe.skipIf(!runtimeUp)("ai-generate-clinical-note", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("ai-generate-clinical-note", { token: null, body: { encounterId: "x" } });
    expect(res.status).toBe(401);
  });

  it("2. missing encounterId is a clean 400", async () => {
    const res = await callFunction("ai-generate-clinical-note", { token: tokenA, body: {} });
    expect(res.status).toBe(400);
  });

  it("3. a valid request reaches the real AI-config boundary honestly (no credentials configured locally) — never a false 403 from the entitlement fix", async () => {
    const res = await callFunction("ai-generate-clinical-note", { token: tokenA, body: { encounterId: "00000000-0000-0000-0000-000000000000" } });
    expect(res.status).toBe(503);
    expect(res.json.error).toMatch(/No AI provider configured/);
  });

  it("4. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("ai-generate-clinical-note", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
