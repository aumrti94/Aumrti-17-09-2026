/**
 * Phase 6, Priority 3 (Statutory/external) — pmjay-claim-submit.
 *
 * Three bugs found and fixed writing this test, logged as KNOWN-BUG-191 — the second total
 * feature failure among the Priority-3 edge functions this phase (after KNOWN-BUG-187):
 * (a) the HCX-config lookup queried `hospital_settings` (a generic key-value table — columns
 *     id/hospital_id/key/value only) for columns like `hcx_client_id` that simply don't exist
 *     there. The query's error was never checked, so the config was always null regardless of
 *     what was actually configured, and the entire live-HCX submission code path has been
 *     unreachable dead code since this function shipped — every call, for every hospital, has
 *     always silently run in sandbox mode. The real table, confirmed against every sibling
 *     ABDM/HCX function, is `hospital_abdm_config` — which also uses `is_production`, not the
 *     `hcx_is_production` this function separately read;
 * (b) `scheme_type: "pmjay"` (lowercase) — govt_scheme_claims_scheme_type_check only ever
 *     allowed the uppercase 'PMJAY';
 * (c) `onConflict: "hospital_id,scheme_type,claim_number"` named a unique constraint that
 *     never existed on this table at all — Postgres rejects an ON CONFLICT target with no
 *     matching constraint outright.
 * (b) and (c) stacked on the same upsert meant this function has never once successfully
 * persisted a claim record, sandbox or live, while still reporting `success: true`.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A, staffUserId } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const ADMISSION_ID = "a0000000-0000-4000-8000-900000000040";
const PACKAGE_CODE = "HBP-P6FIX-00001";

let tokenA = "";
let tokenB = "";

if (runtimeUp) {
  [tokenA, tokenB] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("b", "hospital_admin")]);

  const svc = serviceClient();
  await svc.from("admissions").delete().eq("id", ADMISSION_ID);
  await svc.from("pmjay_package_master" as any).delete().eq("hospital_id", HOSPITAL_A.id).eq("package_code", PACKAGE_CODE);

  await svc.from("admissions").insert({
    id: ADMISSION_ID,
    hospital_id: HOSPITAL_A.id,
    patient_id: PATIENTS_A[0].id,
    admission_type: "daycare",
    admitting_doctor_id: staffUserId("a", "doctor"),
    insurance_type: "insurance",
    status: "active",
    admitted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await svc.from("pmjay_package_master" as any).insert({
    hospital_id: HOSPITAL_A.id,
    package_code: PACKAGE_CODE,
    package_name: "Phase6 Fixture Package",
    base_rate: 25000,
    is_active: true,
  });
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("govt_scheme_claims").delete().eq("hospital_id", HOSPITAL_A.id).eq("pmjay_package_code", PACKAGE_CODE);
  await svc.from("pmjay_package_master" as any).delete().eq("hospital_id", HOSPITAL_A.id).eq("package_code", PACKAGE_CODE);
  await svc.from("admissions").delete().eq("id", ADMISSION_ID);
});

describe.skipIf(!runtimeUp)("pmjay-claim-submit", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("pmjay-claim-submit", { token: null, body: { hospital_id: HOSPITAL_A.id, admission_id: ADMISSION_ID, package_code: PACKAGE_CODE, beneficiary_id: "BEN123" } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("pmjay-claim-submit", { token: "garbage", body: { hospital_id: HOSPITAL_A.id, admission_id: ADMISSION_ID, package_code: PACKAGE_CODE, beneficiary_id: "BEN123" } });
    expect(res.status).toBe(401);
  });

  it("3. missing beneficiary_id is a clean 400", async () => {
    const res = await callFunction("pmjay-claim-submit", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, admission_id: ADMISSION_ID, package_code: PACKAGE_CODE } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's token cannot submit a PMJAY claim under hospital A's id", async () => {
    const res = await callFunction("pmjay-claim-submit", { token: tokenB, body: { hospital_id: HOSPITAL_A.id, admission_id: ADMISSION_ID, package_code: PACKAGE_CODE, beneficiary_id: "BEN123" } });
    expect(res.status).toBe(403);
  });

  it("5. an unknown package_code is a clean 404", async () => {
    const res = await callFunction("pmjay-claim-submit", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, admission_id: ADMISSION_ID, package_code: "NOT-A-REAL-PACKAGE", beneficiary_id: "BEN123" } });
    expect(res.status).toBe(404);
  });

  it("6. a valid claim genuinely submits via the sandbox mock and persists to govt_scheme_claims — the regression test for all three fixes", async () => {
    const res = await callFunction("pmjay-claim-submit", {
      token: tokenA,
      body: { hospital_id: HOSPITAL_A.id, admission_id: ADMISSION_ID, package_code: PACKAGE_CODE, beneficiary_id: "BEN-PHASE6-FIXTURE", claim_type: "claim" },
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.sandbox).toBe(true);
    expect(res.json.hcx_id).toMatch(/^PMJAY-MOCK-/);
    expect(res.json.amount).toBe(25000);

    const svc = serviceClient();
    const { data: claim } = await svc
      .from("govt_scheme_claims")
      .select("scheme_type, status, claimed_amount, pmjay_beneficiary_id")
      .eq("hcx_claim_id", res.json.hcx_id)
      .maybeSingle();
    // Before the fixes: scheme_type "pmjay" (lowercase) violated the CHECK constraint, AND
    // the onConflict target didn't exist — this row was never written at all.
    expect(claim?.scheme_type).toBe("PMJAY");
    expect(claim?.status).toBe("submitted");
    expect(Number(claim?.claimed_amount)).toBe(25000);
    expect(claim?.pmjay_beneficiary_id).toBe("BEN-PHASE6-FIXTURE");
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("pmjay-claim-submit", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
