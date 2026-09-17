/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-abha-create.
 *
 * With no ABDM credentials configured locally, every action correctly returns a clean
 * "ABDM credentials not configured" 400 before ever reaching NHA or this file's own
 * `abdm_gateway_logs`/`patient_abha_profiles` writes — the honest local boundary, matching
 * every other ABDM function tested this phase.
 *
 * Three bugs found and fixed on code inspection, logged as KNOWN-BUG-192/193 — none
 * independently re-provable via a live call from this environment, since all three are only
 * reached after a successful NHA enrollment call this environment cannot make:
 * (a) the shared `logGw` helper (used by all 6 of this file's NHA call sites) used
 *     `abdm_gateway_logs` column names that don't exist on that table at all — the same
 *     defect as KNOWN-BUG-192 (`abdm-gateway-token`, `abdm-hfr-register`);
 * (b) `patient_abha_profiles.linked_by` writes used `user.id` (the auth uid) instead of the
 *     resolved `public.users.id` — `linked_by` FKs to `public.users(id)`, so this violated
 *     the FK constraint for every account created after migration 20260322111223 (i.e.
 *     effectively all real accounts today), silently swallowed by this file's own
 *     surrounding try/catch;
 * (c) `abdm_audit_log.performed_by` had the identical `user.id`-vs-`public.users.id` bug,
 *     silently swallowed by `logAuditEvent`'s own "never throws" contract.
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

describe.skipIf(!runtimeUp)("abdm-abha-create", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("abdm-abha-create", { token: null, body: { action: "initiate_aadhaar", aadhaar: "999999999999" } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("abdm-abha-create", { token: "garbage", body: { action: "initiate_aadhaar", aadhaar: "999999999999" } });
    expect(res.status).toBe(401);
  });

  it("3. missing action is a clean 400", async () => {
    const res = await callFunction("abdm-abha-create", { token: tokenA, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's token cannot act against hospital A's id", async () => {
    const res = await callFunction("abdm-abha-create", { token: tokenB, body: { action: "initiate_aadhaar", aadhaar: "999999999999", hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(403);
  });

  it("5. initiate_aadhaar with no ABDM credentials configured is an honest, clean 400 — never a raw stack trace", async () => {
    const res = await callFunction("abdm-abha-create", { token: tokenA, body: { action: "initiate_aadhaar", aadhaar: "999999999999" } });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/ABDM credentials not configured/);
  });

  it("6. initiate_mobile with no ABDM credentials configured is likewise a clean 400", async () => {
    const res = await callFunction("abdm-abha-create", { token: tokenA, body: { action: "initiate_mobile", mobile: "9000000001" } });
    expect(res.status).toBe(400);
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("abdm-abha-create", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
