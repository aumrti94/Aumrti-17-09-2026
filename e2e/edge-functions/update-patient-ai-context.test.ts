/**
 * Phase 6, Priority 1 (PHI-handling) — update-patient-ai-context.
 *
 * Its own comment says "this endpoint returns PHI (diagnoses, allergies, medications), so it
 * must never be reachable without a valid session" — the auth and hospital-scoping code backs
 * that up correctly (verified JWT, hospital_id resolved server-side, cross-hospital patient
 * lookup returns 404 rather than leaking). The gap found writing this test was different: the
 * catch-all handler returned the raw `String(err)` to the caller and never logged anything
 * server-side — an unhandled failure here (this function upserts a patient's own clinical data)
 * could echo PHI-shaped content back in the response body. Fixed alongside this test.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenDoctorA = "";
let tokenDoctorB = "";

if (runtimeUp) {
  [tokenDoctorA, tokenDoctorB] = await Promise.all([tokenFor("a", "doctor"), tokenFor("b", "doctor")]);
}

describe.skipIf(!runtimeUp)("update-patient-ai-context", () => {
  it("1. a valid authenticated request for the caller's own hospital's patient succeeds", async () => {
    const res = await callFunction("update-patient-ai-context", {
      token: tokenDoctorA,
      body: { patient_id: PATIENTS_A[1].id }, // the seeded patient with a documented Penicillin allergy
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.known_allergies.join(" ")).toMatch(/penicillin/i);
  });

  it("2a. missing Authorization header is rejected", async () => {
    const res = await callFunction("update-patient-ai-context", {
      token: null,
      body: { patient_id: PATIENTS_A[0].id },
    });
    expect(res.status).toBe(401);
  });

  it("2b. a garbage bearer token is rejected", async () => {
    const res = await callFunction("update-patient-ai-context", {
      token: "garbage-not-a-jwt",
      body: { patient_id: PATIENTS_A[0].id },
    });
    expect(res.status).toBe(401);
  });

  it("3a. malformed JSON returns a clean 400, not a 500 with a raw error", async () => {
    const res = await callFunction("update-patient-ai-context", {
      token: tokenDoctorA,
      rawBody: "{not valid json at all",
    });
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("3b. a missing patient_id is a clean 400", async () => {
    const res = await callFunction("update-patient-ai-context", { token: tokenDoctorA, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's doctor gets 404, not hospital A's patient PHI, when naming hospital A's patient id", async () => {
    const res = await callFunction("update-patient-ai-context", {
      token: tokenDoctorB,
      body: { patient_id: PATIENTS_A[1].id },
    });
    expect(res.status).toBe(404);
    expect(res.text).not.toMatch(/penicillin/i);
  });

  it("5. the response never contains an unredacted internal error even on a bad patient_id shape", async () => {
    const res = await callFunction("update-patient-ai-context", {
      token: tokenDoctorA,
      body: { patient_id: "not-a-uuid-at-all" },
    });
    // Either a clean 404 (no row matches a malformed id) or a generic 500 — never a raw
    // Postgres/driver error message.
    expect([404, 500]).toContain(res.status);
    expect(res.text).not.toMatch(/invalid input syntax/i);
    expect(res.text.length).toBeLessThan(300);
  });

  it("6. actually persists the computed context to patient_ai_context, scoped to the right hospital", async () => {
    await callFunction("update-patient-ai-context", { token: tokenDoctorA, body: { patient_id: PATIENTS_A[1].id } });
    const svc = serviceClient();
    const { data } = await svc
      .from("patient_ai_context")
      .select("hospital_id, known_allergies")
      .eq("patient_id", PATIENTS_A[1].id)
      .maybeSingle();
    expect(data?.hospital_id).toBe(HOSPITAL_A.id);
    expect((data?.known_allergies ?? []).join(" ")).toMatch(/penicillin/i);
  });
});
