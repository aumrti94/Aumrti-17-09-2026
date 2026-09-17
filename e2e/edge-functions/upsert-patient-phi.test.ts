/**
 * Phase 6, Priority 1 (PHI-handling) — upsert-patient-phi.
 *
 * This is the function whose header calls it "the ONLY write path for encrypted PHI columns",
 * and the one where the Phase 4 isolation audit found a hospital's own super_admin could
 * decrypt/overwrite ANY other hospital's patient PHI (KNOWN-BUG-121-class, see KNOWN_BUGS.md).
 * These tests exercise the real fix live over HTTP, plus a role-check bug found and fixed while
 * writing this file: DECRYPT_ALLOWED_ROLES listed the non-existent role "admin" instead of the
 * real app_role enum value "hospital_admin".
 *
 * Requires `npx supabase functions serve` running locally — see edgeFunctionClient.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

// Top-level await, not beforeAll: describe.skipIf's condition is evaluated at COLLECTION time,
// strictly before any hook in this file runs — a beforeAll-set flag would still read its stale
// initial value when skipIf checks it. Resolving readiness here, before the describe block is
// even declared, is what makes the skip actually take effect instead of always running.
assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenDoctorA = "";
let tokenAdminA = "";
let tokenReceptionistA = "";
let tokenDoctorB = "";
let testPatientIdA = "";

// Reserved placeholder shapes (check:fixture-phi, D5) — 90000xxxxx for mobile, a repeated-digit
// run for Aadhaar. patients_aadhaar_hash_idx (KNOWN-BUG-166) and phone_hash are both derived
// from these, so a FIXED value across repeated runs collides with a previous run's own leftover
// fixture row — the proactive cleanup below (delete any pre-existing row with this exact fixture
// name before creating a new one) is what actually prevents that, not the value itself; it also
// covers the case where a prior run crashed before its own afterAll got to run.
const TEST_PHONE = "9000000099";
const TEST_AADHAAR = "222222222222";
const FIXTURE_NAME = "PHI Test Fixture (e2e/edge-functions/upsert-patient-phi.test.ts)";

if (runtimeUp) {
  [tokenDoctorA, tokenAdminA, tokenReceptionistA, tokenDoctorB] = await Promise.all([
    tokenFor("a", "doctor"),
    tokenFor("a", "hospital_admin"),
    tokenFor("a", "receptionist"),
    tokenFor("b", "doctor"),
  ]);

  const svc = serviceClient();
  await svc.from("patients").delete().eq("hospital_id", HOSPITAL_A.id).eq("full_name", FIXTURE_NAME);

  // A bare patient row to update PHI columns onto — encrypt_and_write only UPDATEs, per its
  // own header ("caller should have already inserted base row").
  const { data, error } = await svc
    .from("patients")
    .insert({
      hospital_id: HOSPITAL_A.id,
      full_name: FIXTURE_NAME,
      uhid: `${HOSPITAL_A.uhidPrefix}-PHITEST-${Date.now()}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create test patient fixture: ${error.message}`);
  testPatientIdA = data.id;
}

afterAll(async () => {
  if (!runtimeUp || !testPatientIdA) return;
  await serviceClient().from("patients").delete().eq("id", testPatientIdA);
});

describe.skipIf(!runtimeUp)("upsert-patient-phi (skipped — 'npx supabase functions serve' not reachable)", () => {
  it("1. a valid authenticated request succeeds and never echoes plaintext PHI back", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: tokenDoctorA,
      body: {
        operation: "encrypt_and_write",
        hospitalId: HOSPITAL_A.id,
        patientId: testPatientIdA,
        fields: { phone: TEST_PHONE, name: "Ramesh Kumar", address: "12 MG Road Nagpur", aadhaar: TEST_AADHAAR },
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.patientId).toBe(testPatientIdA);
    // Masked, never raw
    expect(res.json.displayValues.phone).not.toBe(TEST_PHONE);
    expect(res.json.displayValues.phone).toContain("***");
    expect(res.json.displayValues.name).not.toBe("Ramesh Kumar");
    // Aadhaar must never be returned to the browser, masked or not — not even the key.
    expect(res.json.displayValues.aadhaar).toBeUndefined();
    expect(res.text).not.toContain(TEST_AADHAAR);
  });

  it("2a. a request with no Authorization header is rejected, not processed", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: null,
      body: { operation: "encrypt_and_write", hospitalId: HOSPITAL_A.id, patientId: testPatientIdA, fields: { phone: "9000000101" } },
    });
    expect(res.status).toBe(401);
  });

  it("2b. a request with a garbage bearer token is rejected, not processed", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: "not-a-real-jwt-at-all",
      body: { operation: "encrypt_and_write", hospitalId: HOSPITAL_A.id, patientId: testPatientIdA, fields: { phone: "9000000102" } },
    });
    expect(res.status).toBe(401);
  });

  it("3a. malformed JSON does not 500 with a stack trace", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: tokenDoctorA,
      rawBody: "{not valid json",
    });
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // no stack-trace-shaped line
  });

  it("3b. an unknown operation is a clean 400, not a 500", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: tokenDoctorA,
      body: { operation: "delete_everything", hospitalId: HOSPITAL_A.id },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/Unknown operation/);
  });

  it("4. cross-hospital: hospital B's doctor cannot write hospital A's patient PHI", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: tokenDoctorB,
      body: {
        operation: "encrypt_and_write",
        hospitalId: HOSPITAL_A.id,
        patientId: testPatientIdA,
        fields: { phone: "9000000103" },
      },
    });
    expect(res.status).toBe(403);
  });

  it("5a. decrypt_for_display denies a role not on the allow-list (receptionist)", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: tokenReceptionistA,
      body: { operation: "decrypt_for_display", hospitalId: HOSPITAL_A.id, patientId: testPatientIdA, fields: ["phone"] },
    });
    expect(res.status).toBe(403);
  });

  it("5b. decrypt_for_display allows hospital_admin — regression test for the 'admin' vs 'hospital_admin' role-string bug fixed in this pass", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: tokenAdminA,
      body: { operation: "decrypt_for_display", hospitalId: HOSPITAL_A.id, patientId: testPatientIdA, fields: ["phone", "name"] },
    });
    expect(res.status).toBe(200);
    expect(res.json.decryptedFields.phone).toBe(TEST_PHONE);
    expect(res.json.decryptedFields.name).toBe("Ramesh Kumar");
  });

  it("5c. decrypt_for_display allows doctor (the documented, unaffected case)", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: tokenDoctorA,
      body: { operation: "decrypt_for_display", hospitalId: HOSPITAL_A.id, patientId: testPatientIdA, fields: ["phone"] },
    });
    expect(res.status).toBe(200);
  });

  it("6. a self-pay-shaped phone search only ever returns masked display data", async () => {
    const res = await callFunction("upsert-patient-phi", {
      token: tokenDoctorA,
      body: { operation: "search_by_phone", hospitalId: HOSPITAL_A.id, phone: TEST_PHONE },
    });
    expect(res.status).toBe(200);
    expect(res.json.patient?.id).toBe(testPatientIdA);
    expect(res.json.patient?.displayPhone).not.toBe(TEST_PHONE);
  });
});
