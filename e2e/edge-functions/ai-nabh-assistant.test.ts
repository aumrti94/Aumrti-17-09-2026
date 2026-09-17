/**
 * Phase 6, AI-function plumbing — ai-nabh-assistant.
 *
 * Already correctly gated by Phase 4 (KNOWN-BUG-126: auth + cross-hospital check). This
 * session added the missing AIDisabledError → 403 handling (KNOWN-BUG-200) — this test
 * confirms the still-reachable boundaries weren't broken by that change.
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

describe.skipIf(!runtimeUp)("ai-nabh-assistant", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("ai-nabh-assistant", { token: null, body: { hospital_id: HOSPITAL_A.id, context_type: "nabh_matrix" } });
    expect(res.status).toBe(401);
  });

  it("2. missing context_type is a clean 400", async () => {
    const res = await callFunction("ai-nabh-assistant", { token: tokenA, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("3. cross-hospital: hospital B's token cannot pull hospital A's NABH data", async () => {
    const res = await callFunction("ai-nabh-assistant", { token: tokenB, body: { hospital_id: HOSPITAL_A.id, context_type: "nabh_matrix" } });
    expect(res.status).toBe(403);
  });

  it("4. a valid request reaches the real AI-config boundary honestly (no credentials configured locally) — never a false 403 from the entitlement fix", async () => {
    const res = await callFunction("ai-nabh-assistant", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, context_type: "nabh_matrix" } });
    expect(res.status).not.toBe(403);
  });

  it("5. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("ai-nabh-assistant", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
