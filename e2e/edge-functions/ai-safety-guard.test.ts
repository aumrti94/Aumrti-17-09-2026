/**
 * Phase 6, AI-function plumbing — ai-safety-guard.
 *
 * S2, found and fixed, logged as KNOWN-BUG-199: no auth check at all — the exact "no auth
 * check at all" defect class the Phase 4 isolation audit found and fixed 24 times over
 * (KNOWN-BUG-126), missed here. Any unauthenticated caller could log arbitrary "safety flag"
 * rows against any hospital_id, polluting that hospital's clinical-safety audit trail. The
 * only confirmed caller (grepped src/ and supabase/functions/) is ai-differential-diagnosis,
 * invoking this over HTTP with its own service-role client — fixed as internal-only,
 * requiring the exact service-role secret.
 *
 * NOTE ON SCOPE: `evaluateSafety()` (the deterministic drug/allergy/dose logic this endpoint
 * wraps) is pure, synchronous, and has no clinical-content bugs found here — this is plumbing
 * verification (auth, and that a real flag genuinely persists), not a judgment on whether the
 * safety RULES themselves are clinically sufficient, which is Nalini's (CDO) call, not this
 * session's.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, LOCAL_SERVICE_ROLE_KEY, serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable, tokenFor } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

async function callSafetyGuard(auth: string | null, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/ai-safety-guard`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("ai_safety_flags").delete().eq("hospital_id", HOSPITAL_A.id).eq("feature_key", "phase6-fixture-test");
});

describe.skipIf(!runtimeUp)("ai-safety-guard", () => {
  it("1. no Authorization header is rejected — this is internal-only", async () => {
    const res = await callSafetyGuard(null, {});
    expect(res.status).toBe(401);
  });

  it("2. an ordinary logged-in user's own session JWT is rejected too — not just any authenticated caller", async () => {
    const token = await tokenFor("a", "hospital_admin");
    const res = await callSafetyGuard(`Bearer ${token}`, {});
    expect(res.status).toBe(401);
  });

  it("3. a forged/garbage bearer is rejected", async () => {
    const res = await callSafetyGuard("Bearer garbage-not-a-real-key", {});
    expect(res.status).toBe(401);
  });

  it("4. a real penicillin-allergy cross-reactivity case is flagged critical and genuinely persisted — the regression test for the fix (this insert was reachable by anyone before it)", async () => {
    const res = await callSafetyGuard(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`, {
      feature_key: "phase6-fixture-test",
      ai_output: { prescriptions: [{ drug: "Amoxicillin", dose: "500mg" }] },
      patient_context: { age: 40, known_allergies: ["Penicillin"] },
      hospital_id: HOSPITAL_A.id,
    });
    expect(res.status).toBe(200);
    expect(res.json.safe).toBe(false);
    expect(res.json.flags.some((f: any) => f.severity === "critical" && /ALLERGY/.test(f.message))).toBe(true);

    const svc = serviceClient();
    const { data: rows } = await svc.from("ai_safety_flags").select("flags").eq("hospital_id", HOSPITAL_A.id).eq("feature_key", "phase6-fixture-test");
    expect(rows!.length).toBeGreaterThan(0);
  });

  it("5. a clean prescription with no known issues is honestly reported safe, with nothing persisted (fire-and-forget log only fires when there's something to record)", async () => {
    const res = await callSafetyGuard(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`, {
      feature_key: "phase6-fixture-test-clean",
      ai_output: { prescriptions: [{ drug: "Vitamin D3", dose: "1000IU" }] },
      patient_context: { age: 40, known_allergies: [] },
      hospital_id: HOSPITAL_A.id,
    });
    expect(res.status).toBe(200);
    expect(res.json.safe).toBe(true);
    expect(res.json.flags).toHaveLength(0);
  });

  it("6. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/ai-safety-guard`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` },
      body: "{bad",
    });
    expect(res.status).not.toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
