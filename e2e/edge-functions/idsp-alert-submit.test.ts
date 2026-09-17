/**
 * Phase 6, Priority 3 (Statutory/external) — idsp-alert-submit.
 *
 * Already correctly gated by the Phase 4 isolation audit (KNOWN-BUG-126) — this test
 * re-proves that fix live and exercises the notifiable-disease logic and submission record
 * end to end, which the original code-review audit did not do.
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
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("idsp_submissions" as any).delete().eq("hospital_id", HOSPITAL_A.id).eq("patient_id", PATIENTS_A[0].id);
});

describe.skipIf(!runtimeUp)("idsp-alert-submit", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("idsp-alert-submit", { token: null, body: { hospital_id: HOSPITAL_A.id, icd_code: "A90" } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("idsp-alert-submit", { token: "garbage", body: { hospital_id: HOSPITAL_A.id, icd_code: "A90" } });
    expect(res.status).toBe(401);
  });

  it("3. missing icd_code is a clean 400", async () => {
    const res = await callFunction("idsp-alert-submit", { token: tokenA, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's token cannot file an IDSP alert under hospital A's id", async () => {
    const res = await callFunction("idsp-alert-submit", { token: tokenB, body: { hospital_id: HOSPITAL_A.id, icd_code: "A90" } });
    expect(res.status).toBe(403);
  });

  it("5. a non-notifiable ICD code is honestly reported, no submission created", async () => {
    const res = await callFunction("idsp-alert-submit", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, icd_code: "Z00" } });
    expect(res.status).toBe(200);
    expect(res.json.notifiable).toBe(false);
  });

  it("6. a notifiable disease (dengue, A90) for a real patient genuinely creates a submission record", async () => {
    const res = await callFunction("idsp-alert-submit", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, icd_code: "A90" } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.notifiable).toBe(true);
    expect(res.json.disease_name).toBe("Dengue");
    expect(res.json.acknowledgment_ref).toMatch(/^IDSP-/);

    const svc = serviceClient();
    const { data: submission } = await svc.from("idsp_submissions" as any).select("disease_code, status, hospital_id").eq("id", res.json.submission_id).maybeSingle();
    expect((submission as any)?.disease_code).toBe("A90");
    expect((submission as any)?.hospital_id).toBe(HOSPITAL_A.id);
    expect(["submitted", "acknowledged", "failed"]).toContain((submission as any)?.status);
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("idsp-alert-submit", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
