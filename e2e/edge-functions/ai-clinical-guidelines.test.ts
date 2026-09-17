/**
 * Phase 6, AI-function plumbing — ai-clinical-guidelines.
 *
 * S2, found and fixed, logged as KNOWN-BUG-200: no entitlement check at all. Unlike its
 * sibling AI functions, this one makes NO AI provider call at all (pure deterministic
 * clinical_guidelines DB lookup + rule matching — no resolveAiConfig/callAiChat anywhere in
 * the file), so it was never protected transitively either; it needed its own explicit
 * checkAIAllowed() call, added here (master-switch only, since no dedicated per-feature key
 * is defined for this function in AI_FEATURE_DEFS).
 *
 * Auth/cross-hospital isolation was already correctly fixed in Phase 4 (KNOWN-BUG-126) — this
 * test re-confirms that fix live alongside the new entitlement gate.
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

describe.skipIf(!runtimeUp)("ai-clinical-guidelines", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("ai-clinical-guidelines", { token: null, body: { hospital_id: HOSPITAL_A.id, diagnosis: "diabetes" } });
    expect(res.status).toBe(401);
  });

  it("2. missing diagnosis/icd10_code is a clean 400", async () => {
    const res = await callFunction("ai-clinical-guidelines", { token: tokenA, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("3. cross-hospital: hospital B's token cannot query against hospital A's id", async () => {
    const res = await callFunction("ai-clinical-guidelines", { token: tokenB, body: { hospital_id: HOSPITAL_A.id, diagnosis: "diabetes" } });
    expect(res.status).toBe(403);
  });

  it("4. with no hospital_subscriptions row (HOSPITAL_A's real local state), the new entitlement gate fails open and genuinely reaches the guideline lookup — the regression test for the fix not over-blocking normal use", async () => {
    const res = await callFunction("ai-clinical-guidelines", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, diagnosis: "a-condition-with-no-seeded-guideline" } });
    expect(res.status).toBe(200);
    expect(res.json.matched).toBe(false); // no clinical_guidelines rows seeded locally — an honest, real DB miss
  });

  it("5. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("ai-clinical-guidelines", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
