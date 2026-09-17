/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-abha-verify.
 *
 * No bugs found writing this test — the Phase 4 auth fix (KNOWN-BUG-126) is intact and the
 * sandbox-format-only fallback (no ABDM credentials configured locally) is exercised
 * end to end. Logged here as clean coverage, not a KNOWN_BUGS entry.
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

describe.skipIf(!runtimeUp)("abdm-abha-verify", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("abdm-abha-verify", { token: null, body: { abha_number: "12345678901234" } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("abdm-abha-verify", { token: "garbage", body: { abha_number: "12345678901234" } });
    expect(res.status).toBe(401);
  });

  it("3. missing abha_number (and no ping mode) is a clean 400", async () => {
    const res = await callFunction("abdm-abha-verify", { token: tokenA, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's token cannot verify against hospital A's id", async () => {
    const res = await callFunction("abdm-abha-verify", { token: tokenB, body: { abha_number: "12345678901234", hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(403);
  });

  it("5. a correctly-shaped ABHA number is honestly reported valid in sandbox-format-only mode (no ABDM credentials configured locally)", async () => {
    const res = await callFunction("abdm-abha-verify", { token: tokenA, body: { abha_number: "12345678901234" } });
    expect(res.status).toBe(200);
    expect(res.json.mode).toBe("sandbox_format_only");
    expect(res.json.verified).toBe(true);
  });

  it("6. a malformed ABHA number is honestly reported invalid, not an error", async () => {
    const res = await callFunction("abdm-abha-verify", { token: tokenA, body: { abha_number: "not-a-real-abha" } });
    expect(res.status).toBe(200);
    expect(res.json.verified).toBe(false);
  });

  it("7. ping mode honestly reports sandbox connectivity (no ABDM credentials configured locally)", async () => {
    const res = await callFunction("abdm-abha-verify", { token: tokenA, body: { mode: "ping" } });
    expect(res.status).toBe(200);
    expect(res.json.connected).toBe(false);
  });

  it("8. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("abdm-abha-verify", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
