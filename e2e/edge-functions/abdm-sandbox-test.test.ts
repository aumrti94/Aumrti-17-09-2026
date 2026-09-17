/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-sandbox-test.
 *
 * Self-service ABDM integration test runner (SettingsABDMPage "Integration Tests"). With no
 * hospital_abdm_config row for HOSPITAL_A in this local seed, the honest, real result is
 * "Config present: fail" — that's the correct behaviour to assert, not a workaround.
 *
 * One bug found and fixed writing this test, logged as KNOWN-BUG-186 alongside the other five
 * `.catch()`-on-Postgrest-builder instances found in the same pass: the test-run log insert
 * crashed with a 500 before the real results below could ever be returned, meaning this
 * self-service diagnostic tool has never once actually shown a hospital admin a result.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B } from "../fixtures/constants";
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
  await svc.from("abdm_gateway_logs").delete().eq("hospital_id", HOSPITAL_A.id).like("action", "sandbox_test_%");
});

describe.skipIf(!runtimeUp)("abdm-sandbox-test", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("abdm-sandbox-test", { token: null, body: { test: "token" } });
    expect(res.status).toBe(401);
  });

  it("2. missing test parameter is a clean 400", async () => {
    const res = await callFunction("abdm-sandbox-test", { token: tokenA, body: {} });
    expect(res.status).toBe(400);
  });

  it("3. an unknown test name is a clean 400", async () => {
    const res = await callFunction("abdm-sandbox-test", { token: tokenA, body: { test: "not_a_real_test" } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's token cannot run a test against hospital A's id", async () => {
    const res = await callFunction("abdm-sandbox-test", { token: tokenB, body: { test: "token", hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(403);
  });

  it("5. a real 'token' test run genuinely completes and logs, honestly reporting no ABDM config exists locally — the regression test for the fix", async () => {
    const res = await callFunction("abdm-sandbox-test", { token: tokenA, body: { test: "token" } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.overall).toBe("fail"); // no hospital_abdm_config row seeded for HOSPITAL_A — the honest result
    const configStep = res.json.results.find((r: any) => r.name === "Config present");
    expect(configStep.pass).toBe(false);

    const svc = serviceClient();
    const { data: logs } = await svc.from("abdm_gateway_logs").select("id, status").eq("hospital_id", HOSPITAL_A.id).eq("action", "sandbox_test_token");
    expect(logs!.length).toBeGreaterThan(0); // before the fix, this insert never even ran to completion
    expect(logs![0].status).toBe("error"); // overall was "fail"
  });

  it("6. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("abdm-sandbox-test", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
