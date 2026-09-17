/**
 * Phase 6, AI-function plumbing — ai-clinical-voice.
 *
 * Confirmed correctly built via code review — hospital_id resolved from the authenticated
 * user, the entitlement gate (checkAIAllowed, feature "voice_scribe") enforced server-side
 * before any provider call, and the allergy/medication context for the in-process safety
 * check scoped by hospital_id (the Phase 4 isolation-audit fix already in place). No code
 * changes here; this is the first live-HTTP regression test written against it.
 *
 * ONE DELIBERATE DEVIATION FROM THE REST OF THE SUITE: this function always answers with
 * HTTP 200, even for "Unauthorized" and validation failures, putting the real outcome in the
 * JSON body's `error` field instead. That is this function's own existing contract (every
 * `new Response(...)` in its source hardcodes `status: 200` outside the one real entitlement
 * 403), not a gap this pass introduced or fixed — the assertions below match that contract
 * rather than the 401/403 convention used elsewhere, so a future change to it shows up as a
 * real diff instead of being masked by a wrong expectation.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
if (runtimeUp) {
  tokenA = await tokenFor("a", "hospital_admin");
}

describe.skipIf(!runtimeUp)("ai-clinical-voice", () => {
  it("1. missing Authorization header reports Unauthorized in the body (this function's own contract answers 200 either way)", async () => {
    const res = await callFunction("ai-clinical-voice", { token: null, body: { transcript: "fever" } });
    expect(res.status).toBe(200);
    expect(res.json.error).toBe("Unauthorized");
  });

  it("2. missing transcript is reported cleanly, not a crash", async () => {
    const res = await callFunction("ai-clinical-voice", { token: tokenA, body: { context_type: "opd_consultation" } });
    expect(res.status).toBe(200);
    expect(res.json.error).toMatch(/Transcript is required/);
  });

  it("3. a valid request reaches the real AI-config boundary honestly (no credentials configured locally) — the entitlement gate fails open on HOSPITAL_A's real local state and never falsely blocks", async () => {
    const res = await callFunction("ai-clinical-voice", { token: tokenA, body: { transcript: "patient has fever for three days", context_type: "opd_consultation" } });
    expect(res.status).toBe(200);
    expect(res.json.error).toMatch(/No AI provider configured/);
  });

  it("4. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("ai-clinical-voice", { token: tokenA, rawBody: "{bad" });
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
