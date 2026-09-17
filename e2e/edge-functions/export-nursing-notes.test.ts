/**
 * Phase 6, Priority 1 (PHI-handling) — export-nursing-notes.
 *
 * Structurally correct on read: auth/isolation match the already-verified pattern from
 * export-lab-reports/export-drug-chart, and (checked directly against the live schema before
 * writing this test, given the pattern of wrong-column-name bugs found in this same batch —
 * KNOWN-BUG-168, KNOWN-BUG-170) every selected nursing_vitals and nursing_mar column genuinely
 * exists. This test confirms that live.
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
const FIXTURE_NOTE = "Patient comfortable, TestFixture nursing note.";

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

  const { error: vitalsErr } = await svc.from("nursing_vitals").insert({
    hospital_id: HOSPITAL_A.id,
    admission_id: admissionId,
    patient_id: PATIENTS_A[0].id,
    recorded_by: doctorAId,
    temperature: 37.0,
    pulse: 78,
    bp_systolic: 118,
    bp_diastolic: 76,
    spo2: 98,
    notes: FIXTURE_NOTE,
  });
  if (vitalsErr) throw new Error(`Could not create test vitals: ${vitalsErr.message}`);
}

afterAll(async () => {
  if (!runtimeUp || !admissionId) return;
  const svc = serviceClient();
  await svc.from("nursing_vitals").delete().eq("admission_id", admissionId);
  await svc.from("admissions").delete().eq("id", admissionId);
});

describe.skipIf(!runtimeUp)("export-nursing-notes", () => {
  it("1. a valid authenticated request for the caller's own hospital succeeds", async () => {
    const res = await callFunction("export-nursing-notes", { token: tokenDoctorA, body: { admission_id: admissionId } });
    expect(res.status).toBe(200);
    expect(res.json.file_url).toMatch(/^https?:\/\//);
  });

  it("2a. missing Authorization header is rejected", async () => {
    const res = await callFunction("export-nursing-notes", { token: null, body: { admission_id: admissionId } });
    expect(res.status).toBe(401);
  });

  it("2b. a garbage bearer token is rejected", async () => {
    const res = await callFunction("export-nursing-notes", { token: "garbage", body: { admission_id: admissionId } });
    expect(res.status).toBe(401);
  });

  it("3a. malformed JSON does not 500 with a stack trace", async () => {
    const res = await callFunction("export-nursing-notes", { token: tokenDoctorA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("3b. a missing admission_id is a clean 400", async () => {
    const res = await callFunction("export-nursing-notes", { token: tokenDoctorA, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's doctor cannot export hospital A's nursing chart", async () => {
    const res = await callFunction("export-nursing-notes", { token: tokenDoctorB, body: { admission_id: admissionId } });
    expect(res.status).toBe(403);
  });

  it("5. the generated chart actually contains this admission's recorded vitals", async () => {
    const res = await callFunction("export-nursing-notes", { token: tokenDoctorA, body: { admission_id: admissionId } });
    expect(res.status).toBe(200);
    const externalUrl = res.json.file_url.replace(/^https?:\/\/[^/]+/, "http://127.0.0.1:54321");
    const html = await (await fetch(externalUrl)).text();
    expect(html).toContain("118 / 76");
    expect(html).toContain(FIXTURE_NOTE);
    expect(html).not.toContain("No vital signs recorded");
  });
});
