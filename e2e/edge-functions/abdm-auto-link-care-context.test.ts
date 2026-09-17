/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-auto-link-care-context.
 *
 * Reaching the full success path needs a hospital_abdm_config row with feature_hip_sharing
 * + hfr_id set — that table is a hard UNIQUE(hospital_id) singleton already exercised for
 * both seeded tenants by four sibling test files this same phase, so this test stays at the
 * "no ABHA profile" short-circuit, which is reached before hospital_abdm_config is ever
 * touched at all — no collision risk.
 *
 * One bug found and fixed, logged as KNOWN-BUG-193: the "notify patient" step called
 * abdm-hip-link-init via `sb.functions.invoke()` on the SERVICE-ROLE client — but
 * abdm-hip-link-init deliberately requires a real user JWT (confirmed live: it rejects the
 * service-role key itself with 401), the same defect class as KNOWN-BUG-187(b)
 * (submit-pre-auth-hcx → hcx-claim-submit). Fixed by forwarding the caller's own
 * already-verified bearer instead — not independently re-provable via a live call here for
 * the reason above (the singleton collision risk), so verified by the same direct
 * service-role curl proof as the sibling finding plus code-level confirmation.
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

describe.skipIf(!runtimeUp)("abdm-auto-link-care-context", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("abdm-auto-link-care-context", { token: null, body: {} });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("abdm-auto-link-care-context", { token: "garbage", body: {} });
    expect(res.status).toBe(401);
  });

  it("3. missing required fields is a clean 400", async () => {
    const res = await callFunction("abdm-auto-link-care-context", { token: tokenA, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's token cannot act against hospital A's id", async () => {
    const res = await callFunction("abdm-auto-link-care-context", {
      token: tokenB,
      body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, event_type: "opd_completed", source_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(403);
  });

  it("5. a patient with no ABHA profile is honestly skipped, not an error — reached before hospital_abdm_config is touched at all", async () => {
    const res = await callFunction("abdm-auto-link-care-context", {
      token: tokenA,
      body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, event_type: "opd_completed", source_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(200);
    expect(res.json.skipped).toBe(true);
    expect(res.json.reason).toBe("no_abha");
  });

  it("6. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("abdm-auto-link-care-context", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
