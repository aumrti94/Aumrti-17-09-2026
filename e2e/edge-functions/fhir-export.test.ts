/**
 * Phase 6, Priority 1 (PHI-handling) — fhir-export.
 *
 * CRITICAL FINDING: the "action-based mode" (action/source_id/hospital_id) had NO auth check
 * at all — hospital_id came straight from the unauthenticated request body, so any caller with
 * zero authentication could name any hospital_id + source_id and receive that record's complete
 * FHIR bundle: patient name, DOB, gender, phone, ABHA number, diagnoses, medications, lab
 * results, radiology reports. A fully unauthenticated cross-tenant PHI leak — the same defect
 * class the Phase 4 audit found and fixed 24 times over (KNOWN-BUG-126), missed here. The only
 * real caller is abdm-fhir-package, invoked via its own service-role client, so this is fixed
 * as internal-only (requires the actual service-role secret), matching the precedent already
 * set for abdm-gateway-token/generate-invoice.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A, staffUserId } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenDoctorA = "";
let tokenId = "";
let encounterId = "";
const FIXTURE_COMPLAINT = "Fixture chief complaint for fhir-export test";

if (runtimeUp) {
  tokenDoctorA = await tokenFor("a", "doctor");
  const svc = serviceClient();
  const doctorAId = staffUserId("a", "doctor");

  const { data: token, error: tokenErr } = await svc
    .from("opd_tokens")
    .insert({ hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id, token_number: `FHIRTEST-${Date.now()}` })
    .select("id")
    .single();
  if (tokenErr) throw new Error(`Could not create test token: ${tokenErr.message}`);
  tokenId = token.id;

  const { data: enc, error: encErr } = await svc
    .from("opd_encounters")
    .insert({
      hospital_id: HOSPITAL_A.id,
      token_id: tokenId,
      patient_id: PATIENTS_A[0].id,
      doctor_id: doctorAId,
      chief_complaint: FIXTURE_COMPLAINT,
    })
    .select("id")
    .single();
  if (encErr) throw new Error(`Could not create test encounter: ${encErr.message}`);
  encounterId = enc.id;
}

afterAll(async () => {
  if (!runtimeUp || !encounterId) return;
  const svc = serviceClient();
  await svc.from("opd_encounters").delete().eq("id", encounterId);
  await svc.from("opd_tokens").delete().eq("id", tokenId);
});

describe.skipIf(!runtimeUp)("fhir-export — action-based mode", () => {
  it("1. no Authorization header is rejected — the regression test for the unauthenticated-PHI-leak fix", async () => {
    const res = await callFunction("fhir-export", {
      token: null,
      body: { action: "opd_consultation", source_id: encounterId, hospital_id: HOSPITAL_A.id },
    });
    expect(res.status).toBe(401);
    expect(res.text).not.toContain(FIXTURE_COMPLAINT);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("fhir-export", {
      token: "garbage-not-service-role",
      body: { action: "opd_consultation", source_id: encounterId, hospital_id: HOSPITAL_A.id },
    });
    expect(res.status).toBe(401);
  });

  it("3. an ordinary doctor's own valid session JWT is REJECTED for the action-based path — only the service-role secret is accepted (internal-only)", async () => {
    const res = await callFunction("fhir-export", {
      token: tokenDoctorA,
      body: { action: "opd_consultation", source_id: encounterId, hospital_id: HOSPITAL_A.id },
    });
    expect(res.status).toBe(401);
    expect(res.text).not.toContain(FIXTURE_COMPLAINT);
  });

  it("4. missing source_id/hospital_id with a valid service-role token is a clean 400", async () => {
    const res = await callFunction("fhir-export", { token: LOCAL_SERVICE_ROLE_KEY, body: { action: "opd_consultation" } });
    expect(res.status).toBe(400);
  });

  it("5. an unknown action is a clean 400, not a 500", async () => {
    const res = await callFunction("fhir-export", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { action: "delete_everything", source_id: encounterId, hospital_id: HOSPITAL_A.id },
    });
    expect(res.status).toBe(400);
  });

  it("6. the real service-role secret succeeds and returns a genuine FHIR bundle for the record", async () => {
    const res = await callFunction("fhir-export", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { action: "opd_consultation", source_id: encounterId, hospital_id: HOSPITAL_A.id },
    });
    expect(res.status).toBe(200);
    expect(res.json.bundle.resourceType).toBe("Bundle");
    const composition = res.json.bundle.entry.find((e: any) => e.resource.resourceType === "Composition");
    expect(composition?.resource.section.some((s: any) => s.text?.div?.includes(FIXTURE_COMPLAINT))).toBe(true);
  });

  it("7. naming hospital B while the record actually belongs to hospital A returns not-found, not hospital A's data", async () => {
    const res = await callFunction("fhir-export", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { action: "opd_consultation", source_id: encounterId, hospital_id: HOSPITAL_B.id },
    });
    expect(res.status).toBe(500); // buildOpdConsultation throws "not found", caught as 500 by this function's own handler
    expect(res.text).not.toContain(FIXTURE_COMPLAINT);
  });
});
