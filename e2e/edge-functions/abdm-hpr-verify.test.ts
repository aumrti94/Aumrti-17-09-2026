/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-hpr-verify.
 *
 * Sandbox mode (no hospital_abdm_config row with abdm_client_id) is the real, honest local
 * state — no ABDM credentials exist here — so the deterministic mock path is exercised, same
 * judgment call as every other ABDM/Razorpay function tested this phase.
 *
 * One bug found and fixed writing this test, logged alongside KNOWN-BUG-186: the gateway-log
 * `.insert(...).catch(() => {})` was the same non-existent-.catch() defect found repeatedly
 * this session — it crashed with a 500 before the successful verification response could ever
 * be returned, meaning this function has never once returned a 200 to a real caller.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, staffUserId } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
let tokenB = "";

if (runtimeUp) {
  [tokenA, tokenB] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("b", "hospital_admin")]);
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("abdm_gateway_logs").delete().eq("hospital_id", HOSPITAL_A.id).eq("action", "hpr_verify");
  await svc.from("users").update({ hpr_id: null, hpr_verified_at: null }).eq("id", staffUserId("a", "doctor"));
});

describe.skipIf(!runtimeUp)("abdm-hpr-verify", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("abdm-hpr-verify", { token: null, body: { hpr_id: "12345678901234" } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("abdm-hpr-verify", { token: "garbage", body: { hpr_id: "12345678901234" } });
    expect(res.status).toBe(401);
  });

  it("3. missing hpr_id is a clean 400", async () => {
    const res = await callFunction("abdm-hpr-verify", { token: tokenA, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. an out-of-range hpr_id length is a clean 400", async () => {
    const res = await callFunction("abdm-hpr-verify", { token: tokenA, body: { hpr_id: "123" } });
    expect(res.status).toBe(400);
  });

  it("5. cross-hospital: hospital B's token cannot verify against hospital A's id", async () => {
    const res = await callFunction("abdm-hpr-verify", { token: tokenB, body: { hpr_id: "12345678901234", hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(403);
  });

  it("6. a valid request in sandbox mode (no ABDM credentials configured locally) genuinely succeeds and logs the gateway call — the regression test for the fix", async () => {
    const res = await callFunction("abdm-hpr-verify", { token: tokenA, body: { hpr_id: "12345678901234" } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.doctor.hpr_id).toBe("12345678901234");

    const svc = serviceClient();
    const { data: logs } = await svc.from("abdm_gateway_logs").select("id, status").eq("hospital_id", HOSPITAL_A.id).eq("action", "hpr_verify");
    expect(logs!.length).toBeGreaterThan(0); // before the fix, this insert never even ran to completion
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("abdm-hpr-verify", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
