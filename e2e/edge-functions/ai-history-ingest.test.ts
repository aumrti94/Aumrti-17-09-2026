/**
 * Phase 6, AI-function plumbing — ai-history-ingest.
 *
 * New finding, logged as KNOWN-BUG-204 (same entry as ai-history-digest — found together,
 * one code trace): no auth check at all on either of this function's two modes.
 *
 * (a) `{ job_id }` mode is called DIRECTLY FROM THE BROWSER with the doctor's own session
 *     (src/components/clinical/PatientHistoryUploadPanel.tsx) to start/resume a scan, and
 *     self-re-invokes with the service-role secret to continue past the wall-clock budget.
 *     Neither path checked that the caller actually belongs to the job's hospital — any
 *     authenticated staff member at ANY hospital (or, since verify_jwt only checks a JWT
 *     signature and the public anon key IS a validly-signed JWT, arguably anyone holding the
 *     anon key shipped in the browser bundle) could name hospital B's job_id and force it to
 *     (re)process, consuming hospital B's AI budget under an attacker they never authorized.
 * (b) `{ sweep: true }` purges EVERY hospital's expired/stalled staging in one call, with no
 *     hospital_id at all — also unauthenticated before this fix.
 *
 * Fixed: `sweep` now requires the exact service-role secret; `job_id` mode accepts either the
 * service-role secret (the legitimate self-invoke path) or a real authenticated user whose
 * OWN hospital_id matches the job's hospital_id — otherwise 403.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, LOCAL_SERVICE_ROLE_KEY, serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, PATIENTS_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable, tokenFor } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

async function callIngest(auth: string | null, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/ai-history-ingest`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

let jobId = "";
let tokenA = "";
let tokenB = "";

if (runtimeUp) {
  const svc = serviceClient();
  // A minimal, already-'complete' job — this test is about the auth gate in front of runJob(),
  // not the AI extraction pipeline, so a terminal status is deliberate: it makes the real
  // per-hospital-scoped query run (fetching the job row and checking hospital ownership)
  // without spending any AI credit or touching storage.
  const { data: job, error } = await svc.from("patient_history_ingest_jobs").insert({
    hospital_id: HOSPITAL_A.id,
    patient_id: PATIENTS_A[0].id,
    status: "complete",
  }).select("id").maybeSingle();
  if (error || !job) throw new Error(`Could not create fixture job: ${error?.message}`);
  jobId = job.id;

  tokenA = await tokenFor("a", "hospital_admin");
  tokenB = await tokenFor("b", "hospital_admin");
}

afterAll(async () => {
  if (!runtimeUp || !jobId) return;
  const svc = serviceClient();
  await svc.from("patient_history_ingest_jobs").delete().eq("id", jobId);
});

describe.skipIf(!runtimeUp)("ai-history-ingest", () => {
  it("1. no Authorization header is rejected", async () => {
    const res = await callIngest(null, { job_id: jobId });
    expect(res.status).toBe(401);
  });

  it("2. sweep mode requires the exact service-role secret — a real user session is rejected", async () => {
    const res = await callIngest(`Bearer ${tokenA}`, { sweep: true });
    expect(res.status).toBe(401);
  });

  it("3. sweep mode accepts the real service-role secret", async () => {
    const res = await callIngest(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`, { sweep: true });
    expect(res.status).toBe(200);
    expect(typeof res.json.swept).toBe("number");
  });

  it("4. a hospital B user naming hospital A's job_id is rejected — the regression test for the fix (this was reachable cross-tenant before it)", async () => {
    const res = await callIngest(`Bearer ${tokenB}`, { job_id: jobId });
    expect(res.status).toBe(403);
  });

  it("5. hospital A's own user, naming hospital A's own job, is accepted and reaches the real job-status logic (already 'complete', so it reports that rather than reprocessing)", async () => {
    const res = await callIngest(`Bearer ${tokenA}`, { job_id: jobId });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("complete");
  });

  it("6. missing job_id is a clean 400 once authenticated", async () => {
    const res = await callIngest(`Bearer ${tokenA}`, {});
    expect(res.status).toBe(400);
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/ai-history-ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: "{bad",
    });
    expect(res.status).not.toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
