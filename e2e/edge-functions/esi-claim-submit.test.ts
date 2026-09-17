/**
 * Phase 6, Priority 3 (Statutory/external) — esi-claim-submit.
 *
 * Already correctly gated by the Phase 4 isolation audit (KNOWN-BUG-126) — this test
 * re-proves that fix live and exercises the actual claim-filing logic end to end, which the
 * original audit (a code-review pass, not a live-HTTP one) did not do.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
let tokenB = "";

if (runtimeUp) {
  [tokenA, tokenB] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("b", "hospital_admin")]);

  const svc = serviceClient();
  await svc.from("esi_beneficiaries").delete().eq("patient_id", PATIENTS_A[0].id);
  await svc.from("esi_beneficiaries").insert({
    hospital_id: HOSPITAL_A.id,
    patient_id: PATIENTS_A[0].id,
    esi_number: "ESI-PHASE6-FIXTURE-0001",
    status: "active",
  });
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("govt_scheme_claims").delete().eq("patient_id", PATIENTS_A[0].id).eq("scheme_type", "ESI");
  await svc.from("esi_beneficiaries").delete().eq("patient_id", PATIENTS_A[0].id);
});

describe.skipIf(!runtimeUp)("esi-claim-submit", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("esi-claim-submit", { token: null, body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, claimed_amount: 5000 } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("esi-claim-submit", { token: "garbage", body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, claimed_amount: 5000 } });
    expect(res.status).toBe(401);
  });

  it("3. missing claimed_amount is a clean 400", async () => {
    const res = await callFunction("esi-claim-submit", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's token cannot file a claim under hospital A's id — re-proving the Phase 4 fix live", async () => {
    const res = await callFunction("esi-claim-submit", { token: tokenB, body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, claimed_amount: 5000 } });
    expect(res.status).toBe(403);
  });

  it("5. a patient with no active ESI enrollment is an honest failure, not an error", async () => {
    const res = await callFunction("esi-claim-submit", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, patient_id: "00000000-0000-0000-0000-000000000000", claimed_amount: 5000 } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(false);
  });

  it("6. a valid claim for an enrolled ESI beneficiary genuinely persists to govt_scheme_claims", async () => {
    const res = await callFunction("esi-claim-submit", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, claimed_amount: 12000, procedure_codes: ["99213"] } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.claim_number).toMatch(/^ESI-/);

    const svc = serviceClient();
    const { data: claim } = await svc.from("govt_scheme_claims").select("scheme_type, status, claimed_amount").eq("id", res.json.claim_id).maybeSingle();
    expect(claim?.scheme_type).toBe("ESI");
    expect(claim?.status).toBe("submitted");
    expect(Number(claim?.claimed_amount)).toBe(12000);
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("esi-claim-submit", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
