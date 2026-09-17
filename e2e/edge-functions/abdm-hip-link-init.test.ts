/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-hip-link-init.
 *
 * No bugs found writing this test — already correctly gated, and the "no ABHA profile" 404
 * is reached before hospital_abdm_config is ever touched, avoiding that singleton table
 * entirely (see abdm-auto-link-care-context.test.ts for why). Logged here as clean coverage:
 * this function is also the one KNOWN-BUG-193 identified as requiring a real user JWT rather
 * than the service-role key its one internal caller was previously using.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A } from "../fixtures/constants";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
let tokenB = "";
if (runtimeUp) {
  [tokenA, tokenB] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("b", "hospital_admin")]);
}

describe.skipIf(!runtimeUp)("abdm-hip-link-init", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("abdm-hip-link-init", { token: null, body: {} });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("abdm-hip-link-init", { token: "garbage", body: {} });
    expect(res.status).toBe(401);
  });

  it("3. missing required fields is a clean 400", async () => {
    const res = await callFunction("abdm-hip-link-init", { token: tokenA, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's token cannot act against hospital A's id", async () => {
    const res = await callFunction("abdm-hip-link-init", {
      token: tokenB,
      body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, care_context_ids: ["00000000-0000-0000-0000-000000000000"] },
    });
    expect(res.status).toBe(403);
  });

  it("5. a patient with no ABHA address linked is a clean 404, reached before hospital_abdm_config is touched at all", async () => {
    const res = await callFunction("abdm-hip-link-init", {
      token: tokenA,
      body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, care_context_ids: ["00000000-0000-0000-0000-000000000000"] },
    });
    expect(res.status).toBe(404);
    expect(res.json.error).toMatch(/no ABHA address/);
  });

  it("6. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("abdm-hip-link-init", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
