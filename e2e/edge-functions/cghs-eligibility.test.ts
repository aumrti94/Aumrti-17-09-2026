/**
 * Phase 6, Priority 3 (Statutory/external) — cghs-eligibility.
 *
 * Two bugs found and fixed writing this test, logged as KNOWN-BUG-188:
 * (a) S1, no waiver — zero authentication and zero hospital scoping on a lookup returning
 *     the full cghs_echs_beneficiaries row (name, employee name, card numbers, entitlement
 *     group) for any beneficiary_id, to any caller, for any hospital. The exact defect class
 *     the Phase 4 isolation audit (KNOWN-BUG-126) found and fixed 24 times over — this
 *     function was simply never in that audit's scan;
 * (b) the function required `beneficiary_id`+`scheme_type`, but its only real caller
 *     (ClaimsPackWizard.tsx) has only ever sent `{ patient_id, hospital_id }` — so every real
 *     UI-driven eligibility check has always failed with a 400 "required" error.
 *
 * This test proves the cross-tenant fix with the real negative case: a beneficiary genuinely
 * exists (for HOSPITAL_B), and HOSPITAL_A's own caller must not be able to retrieve it even by
 * guessing its exact beneficiary_id.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A, PATIENTS_B } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const BENEFICIARY_ID = "PHASE6FIXTURE0001";
let tokenA = "";
let tokenB = "";

if (runtimeUp) {
  [tokenA, tokenB] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("b", "hospital_admin")]);

  const svc = serviceClient();
  await svc.from("cghs_echs_beneficiaries").delete().eq("beneficiary_id", BENEFICIARY_ID);
  await svc.from("cghs_echs_beneficiaries").delete().eq("patient_id", PATIENTS_A[0].id);

  // Real fixture, seeded for HOSPITAL_B only — the negative case this test hinges on.
  await svc.from("cghs_echs_beneficiaries").insert({
    hospital_id: HOSPITAL_B.id,
    patient_id: PATIENTS_B[0].id,
    beneficiary_id: BENEFICIARY_ID,
    scheme_type: "CGHS",
    beneficiary_name: "Phase6 Fixture Beneficiary",
    card_type: "cghs",
    status: "active",
    valid_till: "2099-12-31",
  });
  // Real fixture for HOSPITAL_A, looked up by patient_id (the real caller's shape).
  await svc.from("cghs_echs_beneficiaries").insert({
    hospital_id: HOSPITAL_A.id,
    patient_id: PATIENTS_A[0].id,
    beneficiary_id: "PHASE6FIXTURE0002",
    scheme_type: "CGHS",
    beneficiary_name: "Phase6 Fixture Beneficiary A",
    card_type: "cghs",
    status: "active",
    valid_till: "2099-12-31",
  });
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("cghs_echs_beneficiaries").delete().eq("beneficiary_id", BENEFICIARY_ID);
  await svc.from("cghs_echs_beneficiaries").delete().eq("patient_id", PATIENTS_A[0].id);
});

describe.skipIf(!runtimeUp)("cghs-eligibility", () => {
  it("1. no Authorization header is rejected", async () => {
    const res = await callFunction("cghs-eligibility", { token: null, body: { beneficiary_id: BENEFICIARY_ID, scheme_type: "CGHS" } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("cghs-eligibility", { token: "garbage", body: { beneficiary_id: BENEFICIARY_ID, scheme_type: "CGHS" } });
    expect(res.status).toBe(401);
  });

  it("3. cross-tenant: hospital A's own authenticated caller CANNOT retrieve hospital B's real beneficiary record by guessing its exact beneficiary_id — the regression test for the isolation fix", async () => {
    const res = await callFunction("cghs-eligibility", { token: tokenA, body: { beneficiary_id: BENEFICIARY_ID, scheme_type: "CGHS" } });
    expect(res.status).toBe(200);
    expect(res.json.eligible).toBe(false);
    expect(res.json.status).toBe("not_enrolled");
    expect(res.json.beneficiary).toBeUndefined(); // never HOSPITAL_B's real name/card data
  });

  it("4. hospital B's own caller CAN retrieve its own real beneficiary by beneficiary_id", async () => {
    const res = await callFunction("cghs-eligibility", { token: tokenB, body: { beneficiary_id: BENEFICIARY_ID, scheme_type: "CGHS" } });
    expect(res.status).toBe(200);
    expect(res.json.eligible).toBe(true);
    expect(res.json.beneficiary.beneficiary_name).toBe("Phase6 Fixture Beneficiary");
  });

  it("5. the real caller's actual shape — patient_id + hospital_id, no beneficiary_id — now genuinely works, the regression test for fix (b)", async () => {
    const res = await callFunction("cghs-eligibility", { token: tokenA, body: { patient_id: PATIENTS_A[0].id, hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(200);
    expect(res.json.eligible).toBe(true);
    expect(res.json.beneficiary.beneficiary_name).toBe("Phase6 Fixture Beneficiary A");
  });

  it("6. hospital_id in the body naming another hospital is rejected outright, not silently ignored", async () => {
    const res = await callFunction("cghs-eligibility", { token: tokenA, body: { patient_id: PATIENTS_A[0].id, hospital_id: HOSPITAL_B.id } });
    expect(res.status).toBe(403);
  });

  it("7. neither beneficiary_id nor patient_id is a clean 400", async () => {
    const res = await callFunction("cghs-eligibility", { token: tokenA, body: {} });
    expect(res.status).toBe(400);
  });

  it("8. a genuinely unenrolled patient is an honest not_enrolled, not an error", async () => {
    const res = await callFunction("cghs-eligibility", { token: tokenA, body: { patient_id: PATIENTS_A[1].id, hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("not_enrolled");
  });

  it("9. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("cghs-eligibility", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
