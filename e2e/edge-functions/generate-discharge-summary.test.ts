/**
 * Phase 6, Priority 1 (PHI-handling) — generate-discharge-summary.
 *
 * This function's OWN auth/isolation/rendering logic is in scope for Phase 6. It delegates
 * clinical content to ai-discharge-summary (an AI clinical-path function), which is Nalini's
 * governance gate — out of scope here. It already degrades deliberately when that call fails
 * or AI is unconfigured (a documented fallback path, not a bug), which is exactly the local
 * test environment's condition — so these tests exercise the fallback path, not AI output
 * quality, and never need real AI credentials.
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

if (runtimeUp) {
  [tokenDoctorA, tokenDoctorB] = await Promise.all([tokenFor("a", "doctor"), tokenFor("b", "doctor")]);
  const svc = serviceClient();
  const { data: adm, error: admErr } = await svc
    .from("admissions")
    .insert({
      hospital_id: HOSPITAL_A.id,
      patient_id: PATIENTS_A[0].id,
      admitting_doctor_id: staffUserId("a", "doctor"),
      admission_type: "daycare",
    })
    .select("id")
    .single();
  if (admErr) throw new Error(`Could not create test admission: ${admErr.message}`);
  admissionId = adm.id;
}

afterAll(async () => {
  if (!runtimeUp || !admissionId) return;
  await serviceClient().from("admissions").delete().eq("id", admissionId);
});

describe.skipIf(!runtimeUp)("generate-discharge-summary", () => {
  it("1. a valid authenticated request for the caller's own hospital succeeds even when AI is unavailable (fallback path)", async () => {
    const res = await callFunction("generate-discharge-summary", { token: tokenDoctorA, body: { admission_id: admissionId } });
    expect(res.status).toBe(200);
    expect(res.json.file_url).toMatch(/^https?:\/\//);
  });

  it("2a. missing Authorization header is rejected", async () => {
    const res = await callFunction("generate-discharge-summary", { token: null, body: { admission_id: admissionId } });
    expect(res.status).toBe(401);
  });

  it("2b. a garbage bearer token is rejected", async () => {
    const res = await callFunction("generate-discharge-summary", { token: "garbage", body: { admission_id: admissionId } });
    expect(res.status).toBe(401);
  });

  it("3a. malformed JSON does not 500 with a stack trace", async () => {
    const res = await callFunction("generate-discharge-summary", { token: tokenDoctorA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("3b. a missing admission_id is a clean 400", async () => {
    const res = await callFunction("generate-discharge-summary", { token: tokenDoctorA, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's doctor cannot generate hospital A's discharge summary", async () => {
    const res = await callFunction("generate-discharge-summary", { token: tokenDoctorB, body: { admission_id: admissionId } });
    expect(res.status).toBe(403);
  });

  it("5. the fallback path is honestly disclosed on the document itself, not silently presented as a real AI summary", async () => {
    const res = await callFunction("generate-discharge-summary", { token: tokenDoctorA, body: { admission_id: admissionId } });
    expect(res.status).toBe(200);
    const externalUrl = res.json.file_url.replace(/^https?:\/\/[^/]+/, "http://127.0.0.1:54321");
    const html = await (await fetch(externalUrl)).text();
    // AI is not configured in this test environment, so the fallback notice must appear —
    // asserting this is itself the proving test for "degrade deliberately, never silently".
    expect(html).toMatch(/AI provider not configured|AI generation unavailable/);
    expect(html).toContain("Clinician must review and countersign before submission");
  });
});
