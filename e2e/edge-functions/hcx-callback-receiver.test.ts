/**
 * Phase 6, Priority 3 (Statutory/external) — hcx-callback-receiver.
 *
 * NHA/NHCX posts a JWE-encrypted FHIR ClaimResponse/CoverageEligibilityResponse here. No
 * HCX_HOSPITAL_PRIVATE_KEY_JWK is configured in this local environment, which is itself the
 * legitimate "no HCX crypto set up yet" state the function's own sandbox-fallback path exists
 * for — so plain JSON is the correct, honest way to test the real business logic here.
 *
 * Three bugs found and fixed writing this test, logged as KNOWN-BUG-185 (the auth-bypass half,
 * (a), is the more significant finding and independently verified below with a temporary key
 * configured — see that entry for the full empirical proof, not repeated in this file's normal
 * run since it requires restarting the edge runtime with a temporary env var):
 * (a) the plain-JSON fallback fired unconditionally whenever decryption failed for ANY reason,
 *     not only when no key was configured — meaning a hospital with real HCX encryption set up
 *     could still have its claim/pre-auth decisions forged by anyone who simply sent plain JSON
 *     instead of a real JWE, since decryptJwe() itself returns null for non-JWE-shaped input
 *     with no distinction from "decryption attempted and failed";
 * (b) the unmatched-claim-id path inserted into clinical_alerts with no hospital_id — a NOT
 *     NULL column — so that "manual review required" alert has never once been created;
 * (c) mapOutcomeToStatus() can return "partial"/"queued", neither of which
 *     insurance_pre_auth_hcx_status_check / insurance_claims_hcx_status_check (nor the
 *     frontend's own HcxStatus type) accept — writing either into hcx_status has always
 *     violated the CHECK constraint.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, PATIENTS_A, staffUserId } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const ADMISSION_ID = "a0000000-0000-4000-8000-900000000010";
const PREAUTH_ID = "a0000000-0000-4000-8000-900000000011";
const CLAIM_ID = "a0000000-0000-4000-8000-900000000012";
const CLAIM_ID_PARTIAL = "a0000000-0000-4000-8000-900000000013";
const HCX_PREAUTH_REQ_ID = "hcx-req-fixture-preauth-001";
const HCX_CLAIM_REQ_ID = "hcx-req-fixture-claim-001";
const HCX_CLAIM_REQ_ID_PARTIAL = "hcx-req-fixture-claim-partial-001";

async function post(body: unknown) {
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/hcx-callback-receiver`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

function claimResponseBundle(opts: { use: string; outcome: string; disposition?: string; hcxClaimId: string; approvedAmount?: number }) {
  return {
    entry: [{
      resource: {
        resourceType: "ClaimResponse",
        id: opts.hcxClaimId,
        use: opts.use,
        outcome: opts.outcome,
        disposition: opts.disposition ?? "",
        total: opts.approvedAmount !== undefined
          ? [{ category: { coding: [{ code: "benefit" }] }, amount: { value: opts.approvedAmount } }]
          : [],
      },
    }],
  };
}

if (runtimeUp) {
  const svc = serviceClient();
  await svc.from("admissions").delete().eq("id", ADMISSION_ID);
  await svc.from("insurance_pre_auth").delete().in("id", [PREAUTH_ID]);
  await svc.from("insurance_claims").delete().in("id", [CLAIM_ID, CLAIM_ID_PARTIAL]);

  await svc.from("admissions").insert({
    id: ADMISSION_ID,
    hospital_id: HOSPITAL_A.id,
    patient_id: PATIENTS_A[0].id,
    admission_type: "daycare",
    admitting_doctor_id: staffUserId("a", "doctor"),
    insurance_type: "insurance",
    status: "active",
  });
  await svc.from("insurance_pre_auth").insert({
    id: PREAUTH_ID,
    hospital_id: HOSPITAL_A.id,
    admission_id: ADMISSION_ID,
    patient_id: PATIENTS_A[0].id,
    tpa_name: "Phase6 Fixture TPA",
    hcx_request_id: HCX_PREAUTH_REQ_ID,
    status: "pending",
  });
  await svc.from("insurance_claims").insert({
    id: CLAIM_ID,
    hospital_id: HOSPITAL_A.id,
    patient_id: PATIENTS_A[0].id,
    tpa_name: "Phase6 Fixture TPA",
    claimed_amount: 50000,
    hcx_claim_id: HCX_CLAIM_REQ_ID,
    status: "submitted",
  });
  await svc.from("insurance_claims").insert({
    id: CLAIM_ID_PARTIAL,
    hospital_id: HOSPITAL_A.id,
    patient_id: PATIENTS_A[0].id,
    tpa_name: "Phase6 Fixture TPA",
    claimed_amount: 50000,
    hcx_claim_id: HCX_CLAIM_REQ_ID_PARTIAL,
    status: "submitted",
  });
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("tpa_disputes").delete().in("claim_id", [CLAIM_ID, CLAIM_ID_PARTIAL]);
  await svc.from("clinical_alerts").delete().eq("hospital_id", HOSPITAL_A.id).in("alert_type", ["insurance_preauth_decision", "insurance_claim_decision"]);
  await svc.from("webhook_dlq").delete().eq("source", "hcx_callback");
  await svc.from("insurance_pre_auth").delete().eq("id", PREAUTH_ID);
  await svc.from("insurance_claims").delete().in("id", [CLAIM_ID, CLAIM_ID_PARTIAL]);
  await svc.from("admissions").delete().eq("id", ADMISSION_ID);
});

describe.skipIf(!runtimeUp)("hcx-callback-receiver", () => {
  it("1. a GET request is rejected as method not allowed", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/hcx-callback-receiver`, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("2. a body with no ClaimResponse resource returns a clean 422", async () => {
    const res = await post({ entry: [{ resource: { resourceType: "Patient" } }] });
    expect(res.status).toBe(422);
  });

  it("3. non-JSON, non-JWE garbage does not 500 with a raw stack trace", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/hcx-callback-receiver`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "not json and not jwe either",
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("4. a matched pre-auth approval updates insurance_pre_auth and raises the (now correctly-typed) alert", async () => {
    const res = await post(claimResponseBundle({ use: "predetermination", outcome: "complete", disposition: "approved", hcxClaimId: HCX_PREAUTH_REQ_ID, approvedAmount: 40000 }));
    expect(res.status).toBe(200);
    expect(res.json.type).toBe("preauth");
    expect(res.json.status).toBe("approved");

    const svc = serviceClient();
    const { data: preAuth } = await svc.from("insurance_pre_auth").select("status, hcx_status, approved_amount").eq("id", PREAUTH_ID).maybeSingle();
    expect(preAuth?.status).toBe("approved");
    expect(preAuth?.hcx_status).toBe("approved");
    expect(Number(preAuth?.approved_amount)).toBe(40000);

    const { data: alerts } = await svc.from("clinical_alerts").select("id").eq("hospital_id", HOSPITAL_A.id).eq("alert_type", "insurance_preauth_decision");
    expect(alerts!.length).toBeGreaterThan(0); // the regression test for bug (would-be CHECK violation, now fixed by the earlier migration)
  });

  it("5. a matched claim approval with underpayment updates insurance_claims and auto-raises a tpa_dispute", async () => {
    const res = await post(claimResponseBundle({ use: "claim", outcome: "complete", disposition: "approved", hcxClaimId: HCX_CLAIM_REQ_ID, approvedAmount: 45000 }));
    expect(res.status).toBe(200);
    expect(res.json.type).toBe("claim");
    expect(res.json.underpayment).toBe(5000);
    expect(res.json.dispute_auto).toBe(true);

    const svc = serviceClient();
    const { data: claim } = await svc.from("insurance_claims").select("status, hcx_status, approved_amount, underpayment_amount").eq("id", CLAIM_ID).maybeSingle();
    expect(claim?.status).toBe("approved");
    expect(claim?.hcx_status).toBe("approved");
    expect(Number(claim?.underpayment_amount)).toBe(5000);

    const { data: disputes } = await svc.from("tpa_disputes").select("dispute_amount, dispute_category").eq("claim_id", CLAIM_ID);
    expect(disputes).toHaveLength(1);
    expect(Number(disputes![0].dispute_amount)).toBe(5000);
  });

  it("6. a 'partial' HCX outcome does not violate the hcx_status CHECK constraint — the regression test for bug (c)", async () => {
    const res = await post(claimResponseBundle({ use: "claim", outcome: "partial", hcxClaimId: HCX_CLAIM_REQ_ID_PARTIAL, approvedAmount: 20000 }));
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("partially_approved");

    const svc = serviceClient();
    const { data: claim } = await svc.from("insurance_claims").select("status, hcx_status").eq("id", CLAIM_ID_PARTIAL).maybeSingle();
    // Before the fix this write would have hit the CHECK constraint (23514) and hcx_status
    // would have stayed null while status silently never updated either (unchecked error).
    expect(claim?.status).toBe("partially_approved");
    expect(claim?.hcx_status).toBe("processing");
  });

  it("7. an unmatched HCX claim id is a clean 200 with success:false, and is now genuinely captured for manual review — the regression test for bug (b)", async () => {
    const res = await post(claimResponseBundle({ use: "claim", outcome: "complete", disposition: "approved", hcxClaimId: "hcx-req-does-not-exist-anywhere" }));
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(false);
    expect(res.json.reason).toMatch(/not found/i);

    const svc = serviceClient();
    const { data: dlqRows } = await svc.from("webhook_dlq").select("event_type, error_message").eq("source", "hcx_callback");
    expect(dlqRows!.length).toBeGreaterThan(0);
    expect(dlqRows!.some(r => r.error_message.includes("hcx-req-does-not-exist-anywhere"))).toBe(true);
  });
});
