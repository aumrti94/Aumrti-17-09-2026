/**
 * Phase 6, Priority 3 (Statutory/external) — submit-pre-auth-hcx.
 *
 * Uses HOSPITAL_B, not HOSPITAL_A: exercising the real success path needs a
 * hospital_abdm_config row with feature_hcx_claims=true (to reach hcx-claim-submit's sandbox
 * mode rather than its "HCX claims not enabled" 400) — and abdm-hpr-verify.test.ts /
 * abdm-sandbox-test.test.ts both assert HOSPITAL_A has NO such row at all. HOSPITAL_B is free.
 *
 * Three bugs found and fixed writing this test, logged as KNOWN-BUG-186 (the first, a total
 * feature failure, is the most significant single functional bug found this phase):
 * (a) the query embedded `tpa_config!inner(...)` off insurance_pre_auth via a PostgREST embed
 *     that requires a real foreign-key relationship — none exists between these two tables
 *     (confirmed live against this project's own PostgREST: PGRST200, "no relationship
 *     found"). Every query has always returned that error, and the code treated ANY error as
 *     "Pre-auth not found" — so this function has returned 404 for every real submission
 *     attempt ever made, regardless of whether the pre-auth existed;
 * (b) once (a) is fixed enough to reach the no-direct-API fallback, it called hcx-claim-submit
 *     with the service-role key as bearer — but hcx-claim-submit deliberately requires a real
 *     user JWT (a Phase 4 hardening fix, see KNOWN_BUGS.md), so that fallback has ALSO always
 *     401'd, for every hospital, regardless of configuration;
 * (c) all three `insurance_automation_log`/`clinical_alerts` inserts used `.catch(() => {})`
 *     (the non-existent-.catch()-on-a-query-builder defect found repeatedly this session), and
 *     both `insurance_automation_log` inserts used `event_type: "auto_submit_preauth"`, a
 *     value the CHECK constraint has never allowed (the real, already-established value, used
 *     correctly by the sibling insurance-automation function, is "pre_auth_auto_submitted").
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_B, staffUserId } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const ADMISSION_ID = "b0000000-0000-4000-8000-900000000020";
const PREAUTH_ID = "b0000000-0000-4000-8000-900000000021";
const PREAUTH_ALREADY_SUBMITTED_ID = "b0000000-0000-4000-8000-900000000022";
const TPA_NAME = "Phase6 Fixture TPA Submit";

let tokenOwnHospital = "";
let tokenOtherHospital = "";

if (runtimeUp) {
  [tokenOwnHospital, tokenOtherHospital] = await Promise.all([tokenFor("b", "hospital_admin"), tokenFor("a", "hospital_admin")]);

  const svc = serviceClient();
  await svc.from("insurance_pre_auth").delete().in("id", [PREAUTH_ID, PREAUTH_ALREADY_SUBMITTED_ID]);
  await svc.from("admissions").delete().eq("id", ADMISSION_ID);
  await svc.from("tpa_config").delete().eq("hospital_id", HOSPITAL_B.id).eq("tpa_name", TPA_NAME);
  await svc.from("hospital_abdm_config").delete().eq("hospital_id", HOSPITAL_B.id);

  await svc.from("admissions").insert({
    id: ADMISSION_ID,
    hospital_id: HOSPITAL_B.id,
    patient_id: PATIENTS_B[0].id,
    admission_type: "daycare",
    admitting_doctor_id: staffUserId("b", "doctor"),
    insurance_type: "insurance",
    status: "active",
  });
  // feature_hcx_claims=true, no participant credentials — reaches hcx-claim-submit's sandbox
  // mode rather than its "HCX claims not enabled" 400.
  await svc.from("hospital_abdm_config").insert({
    hospital_id: HOSPITAL_B.id,
    feature_hcx_claims: true,
  });
  await svc.from("tpa_config").insert({
    hospital_id: HOSPITAL_B.id,
    tpa_name: TPA_NAME,
    // No api_endpoint/api_key_encrypted — forces the hcx-claim-submit gateway fallback.
  });
  await svc.from("insurance_pre_auth").insert({
    id: PREAUTH_ID,
    hospital_id: HOSPITAL_B.id,
    admission_id: ADMISSION_ID,
    patient_id: PATIENTS_B[0].id,
    tpa_name: TPA_NAME,
    estimated_amount: 30000,
    status: "pending",
  });
  await svc.from("insurance_pre_auth").insert({
    id: PREAUTH_ALREADY_SUBMITTED_ID,
    hospital_id: HOSPITAL_B.id,
    admission_id: ADMISSION_ID,
    patient_id: PATIENTS_B[0].id,
    tpa_name: TPA_NAME,
    estimated_amount: 30000,
    status: "submitted",
  });
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("insurance_automation_log").delete().in("pre_auth_id", [PREAUTH_ID, PREAUTH_ALREADY_SUBMITTED_ID]);
  await svc.from("clinical_alerts").delete().eq("hospital_id", HOSPITAL_B.id).eq("alert_type", "pre_auth_submission_failed");
  await svc.from("insurance_claims").delete().eq("bill_id", ADMISSION_ID);
  await svc.from("insurance_pre_auth").delete().in("id", [PREAUTH_ID, PREAUTH_ALREADY_SUBMITTED_ID]);
  await svc.from("tpa_config").delete().eq("hospital_id", HOSPITAL_B.id).eq("tpa_name", TPA_NAME);
  await svc.from("hospital_abdm_config").delete().eq("hospital_id", HOSPITAL_B.id);
  await svc.from("admissions").delete().eq("id", ADMISSION_ID);
});

describe.skipIf(!runtimeUp)("submit-pre-auth-hcx", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("submit-pre-auth-hcx", { token: null, body: { pre_auth_id: PREAUTH_ID, hospital_id: HOSPITAL_B.id } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("submit-pre-auth-hcx", { token: "garbage", body: { pre_auth_id: PREAUTH_ID, hospital_id: HOSPITAL_B.id } });
    expect(res.status).toBe(401);
  });

  it("3. missing pre_auth_id is a clean 400", async () => {
    const res = await callFunction("submit-pre-auth-hcx", { token: tokenOwnHospital, body: { hospital_id: HOSPITAL_B.id } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital A's token cannot submit hospital B's pre-auth", async () => {
    const res = await callFunction("submit-pre-auth-hcx", { token: tokenOtherHospital, body: { pre_auth_id: PREAUTH_ID, hospital_id: HOSPITAL_B.id } });
    expect(res.status).toBe(403);
  });

  it("5. an unknown pre_auth_id is a clean 404", async () => {
    const res = await callFunction("submit-pre-auth-hcx", { token: tokenOwnHospital, body: { pre_auth_id: "00000000-0000-0000-0000-000000000000", hospital_id: HOSPITAL_B.id } });
    expect(res.status).toBe(404);
  });

  it("6. a pre-auth already past pending/draft/under_review is a clean 422, not resubmitted", async () => {
    const res = await callFunction("submit-pre-auth-hcx", { token: tokenOwnHospital, body: { pre_auth_id: PREAUTH_ALREADY_SUBMITTED_ID, hospital_id: HOSPITAL_B.id } });
    expect(res.status).toBe(422);
  });

  it("7. a valid pending pre-auth genuinely submits via the HCX sandbox fallback and updates the record — the regression test for all three fixes", async () => {
    const res = await callFunction("submit-pre-auth-hcx", { token: tokenOwnHospital, body: { pre_auth_id: PREAUTH_ID, hospital_id: HOSPITAL_B.id } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.tpa_reference_number).toBeTruthy();

    const svc = serviceClient();
    const { data: pa } = await svc.from("insurance_pre_auth").select("status, submission_mode, tpa_reference_number").eq("id", PREAUTH_ID).maybeSingle();
    expect(pa?.status).toBe("submitted");
    expect(pa?.submission_mode).toBe("automated");

    const { data: logs } = await svc.from("insurance_automation_log").select("event_type, status").eq("pre_auth_id", PREAUTH_ID);
    expect(logs!.length).toBeGreaterThan(0); // before the fixes, this insert never even ran to completion
    expect(logs![0].event_type).toBe("pre_auth_auto_submitted"); // the regression test for the CHECK-constraint fix
    expect(logs![0].status).toBe("success");
  });

  it("8. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("submit-pre-auth-hcx", { token: tokenOwnHospital, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
