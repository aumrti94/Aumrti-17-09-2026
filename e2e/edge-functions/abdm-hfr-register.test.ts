/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-hfr-register.
 *
 * With no hospital_abdm_config row for HOSPITAL_A locally, this correctly 404s at "No ABDM
 * configuration found" before ever reaching the NHA calls — the honest local boundary.
 *
 * Two bugs found and fixed writing this test, logged as KNOWN-BUG-192 alongside
 * abdm-gateway-token's identical instances: both `abdm_gateway_logs` inserts in this file
 * used column names that don't exist on that table (request_id/endpoint/payload/response/
 * status_code/error, uppercase direction "OUTBOUND") and discarded their error via
 * `.then(() => {})` — an audit-trail gap only, not reachable from this local environment
 * (requires a real hospital_abdm_config + NHA call to get past the 404 below).
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
let tokenNurse = "";
if (runtimeUp) {
  [tokenA, tokenNurse] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("a", "nurse")]);
}

describe.skipIf(!runtimeUp)("abdm-hfr-register", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("abdm-hfr-register", { token: null, body: {} });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("abdm-hfr-register", { token: "garbage", body: {} });
    expect(res.status).toBe(401);
  });

  it("3. a non-admin role (nurse) is forbidden from registering the bridge URL", async () => {
    const res = await callFunction("abdm-hfr-register", { token: tokenNurse, body: {} });
    expect(res.status).toBe(403);
  });

  it("4. a hospital admin with no ABDM configuration gets an honest 404, not a crash", async () => {
    const res = await callFunction("abdm-hfr-register", { token: tokenA, body: {} });
    expect(res.status).toBe(404);
    expect(res.json.error).toMatch(/No ABDM configuration found/);
  });

  it("5. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("abdm-hfr-register", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
