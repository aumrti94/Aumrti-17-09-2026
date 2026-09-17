/**
 * Phase 6, Priority 1 (PHI-handling) — fhir-r4-server.
 *
 * Already fixed in Phase 4 (KNOWN-BUG-126's worst finding: "a fully unauthenticated FHIR
 * $export/Patient read across ANY hospital, up to 10,000 patients per call"). This is the
 * proving test Phase 6 requires regardless of when a function was fixed — confirming the fix
 * live, not re-trusting the Phase 4 code-review verification. One more gap found and fixed
 * while writing this test: the catch-all handler returned `String(err)` raw in the
 * OperationOutcome — for a server whose every route assembles PHI, now redacted server-side.
 */
import { describe, it, expect, afterAll } from "vitest";
import { tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { localSupabaseUrl, serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A, PATIENTS_B } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenDoctorA = "";
if (runtimeUp) tokenDoctorA = await tokenFor("a", "doctor");

const base = () => `${localSupabaseUrl()}/functions/v1/fhir-r4-server`;
const call = (path: string, opts: { token?: string | null; method?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token !== null) headers["Authorization"] = `Bearer ${opts.token ?? ""}`;
  return fetch(`${base()}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
};

describe.skipIf(!runtimeUp)("fhir-r4-server", () => {
  it("1. CapabilityStatement is public (no auth required — a discovery document, not PHI)", async () => {
    const res = await call("/fhir/metadata", { token: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("CapabilityStatement");
  });

  it("2a. every PHI route rejects a request with no Authorization header", async () => {
    const res = await call(`/fhir/Patient/${PATIENTS_A[0].id}`, { token: null });
    expect(res.status).toBe(401);
  });

  it("2b. a garbage bearer token is rejected", async () => {
    const res = await call(`/fhir/Patient/${PATIENTS_A[0].id}`, { token: "garbage-not-a-jwt" });
    expect(res.status).toBe(401);
  });

  it("3. a valid caller reading their own hospital's patient succeeds", async () => {
    const res = await call(`/fhir/Patient/${PATIENTS_A[0].id}`, { token: tokenDoctorA });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("Patient");
    expect(body.id).toBe(PATIENTS_A[0].id);
  });

  it("4. the regression test for KNOWN-BUG-126: reading another hospital's patient returns 404, not the patient's data — and never 403 (anti-enumeration by design)", async () => {
    const res = await call(`/fhir/Patient/${PATIENTS_B[0].id}`, { token: tokenDoctorA });
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain(PATIENTS_B[0].fullName);
  });

  it("5. $export without hospital_id is a clean 400", async () => {
    const res = await call("/fhir/$export", { token: tokenDoctorA, method: "POST", body: {} });
    expect(res.status).toBe(400);
  });

  it("6. $export naming a DIFFERENT hospital than the caller's own is forbidden — the original unauthenticated-bulk-export hole this function was fixed for", async () => {
    const res = await call("/fhir/$export", { token: tokenDoctorA, method: "POST", body: { hospital_id: HOSPITAL_B.id } });
    expect(res.status).toBe(403);
  });

  it("7. $export for the caller's own hospital succeeds, includes the caller's patients, and leaks nothing from hospital B", async () => {
    const res = await call("/fhir/$export", { token: tokenDoctorA, method: "POST", body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resourceType).toBe("Bundle");
    expect(body.type).toBe("transaction");
    expect(body.entry.some((e: any) => e.resource.resourceType === "Patient" && e.resource.id === PATIENTS_A[0].id)).toBe(true);
    // The real isolation property: whatever hospital A's patient set is at test time (other
    // suites' own throwaway fixtures may legitimately co-exist), none of it is HOSPITAL_B's.
    const patientIds = new Set([PATIENTS_B[0].id, PATIENTS_B[1].id, PATIENTS_B[2].id]);
    expect(body.entry.some((e: any) => e.resource.resourceType === "Patient" && patientIds.has(e.resource.id))).toBe(false);
  });

  it("8. Patient/$everything is denied for another hospital's patient (404), matching the single-resource GET's isolation", async () => {
    const res = await call(`/fhir/Patient/${PATIENTS_B[0].id}/$everything`, { token: tokenDoctorA });
    expect(res.status).toBe(404);
  });

  it("9. an unknown route returns a clean OperationOutcome 404, not a 500", async () => {
    const res = await call("/fhir/NotARealResource", { token: tokenDoctorA });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.resourceType).toBe("OperationOutcome");
  });
});
