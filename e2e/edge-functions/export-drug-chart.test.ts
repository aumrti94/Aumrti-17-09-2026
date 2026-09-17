/**
 * Phase 6, Priority 1 (PHI-handling) — export-drug-chart.
 *
 * Structurally correct on read (auth/isolation identical to the already-verified
 * export-lab-reports pattern, and all three sub-queries — ipd_medications, pharmacy_dispensing
 * via an inner join, nursing_mar — are each properly scoped by admission_id, unlike
 * export-lab-reports's KNOWN-BUG-169). This test exists to confirm that live, not just by
 * reading the code.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, PATIENTS_A, staffUserId } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenDoctorA = "";
let tokenDoctorB = "";
let admissionId = "";
const FIXTURE_DRUG = "TestamolFixture 500mg";

if (runtimeUp) {
  [tokenDoctorA, tokenDoctorB] = await Promise.all([tokenFor("a", "doctor"), tokenFor("b", "doctor")]);
  const svc = serviceClient();
  const doctorAId = staffUserId("a", "doctor");

  const { data: adm, error: admErr } = await svc
    .from("admissions")
    .insert({
      hospital_id: HOSPITAL_A.id,
      patient_id: PATIENTS_A[0].id,
      admitting_doctor_id: doctorAId,
      admission_type: "daycare",
    })
    .select("id")
    .single();
  if (admErr) throw new Error(`Could not create test admission: ${admErr.message}`);
  admissionId = adm.id;

  const { error: medErr } = await svc.from("ipd_medications").insert({
    hospital_id: HOSPITAL_A.id,
    admission_id: admissionId,
    drug_name: FIXTURE_DRUG,
    ordered_by: doctorAId,
    dose: "500mg",
    route: "oral",
    frequency: "BD",
  });
  if (medErr) throw new Error(`Could not create test medication: ${medErr.message}`);
}

afterAll(async () => {
  if (!runtimeUp || !admissionId) return;
  const svc = serviceClient();
  await svc.from("ipd_medications").delete().eq("admission_id", admissionId);
  await svc.from("admissions").delete().eq("id", admissionId);
});

describe.skipIf(!runtimeUp)("export-drug-chart", () => {
  it("1. a valid authenticated request for the caller's own hospital succeeds", async () => {
    const res = await callFunction("export-drug-chart", { token: tokenDoctorA, body: { admission_id: admissionId } });
    expect(res.status).toBe(200);
    expect(res.json.file_url).toMatch(/^https?:\/\//);
  });

  it("2a. missing Authorization header is rejected", async () => {
    const res = await callFunction("export-drug-chart", { token: null, body: { admission_id: admissionId } });
    expect(res.status).toBe(401);
  });

  it("2b. a garbage bearer token is rejected", async () => {
    const res = await callFunction("export-drug-chart", { token: "garbage", body: { admission_id: admissionId } });
    expect(res.status).toBe(401);
  });

  it("3a. malformed JSON does not 500 with a stack trace", async () => {
    const res = await callFunction("export-drug-chart", { token: tokenDoctorA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("3b. a missing admission_id is a clean 400", async () => {
    const res = await callFunction("export-drug-chart", { token: tokenDoctorA, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's doctor cannot export hospital A's drug chart", async () => {
    const res = await callFunction("export-drug-chart", { token: tokenDoctorB, body: { admission_id: admissionId } });
    expect(res.status).toBe(403);
  });

  it("5. the generated chart actually contains this admission's medication order", async () => {
    const res = await callFunction("export-drug-chart", { token: tokenDoctorA, body: { admission_id: admissionId } });
    expect(res.status).toBe(200);
    const externalUrl = res.json.file_url.replace(/^https?:\/\/[^/]+/, "http://127.0.0.1:54321");
    const html = await (await fetch(externalUrl)).text();
    expect(html).toContain(FIXTURE_DRUG);
    expect(html).not.toContain("No IPD medication orders found");
  });
});
