/**
 * Phase 6, Priority 2 (Money) — razorpay-settlement-reconcile.
 *
 * Cron/manual-trigger function: for every subscription_invoices row with a
 * razorpay_payment_id, calls GET /v1/payments/{id} on Razorpay and flags a mismatch. No
 * caller exists anywhere in src/ — it is meant to be internal-only, like dunning-processor.
 * Makes a REAL outbound Razorpay call when configured — no credentials exist locally, so
 * this is tested up to the "Razorpay keys not configured" boundary, the same judgment call
 * already applied to its sibling functions.
 *
 * One bug found and fixed writing this test, logged as KNOWN-BUG-184: no auth check at all
 * beyond the platform's own JWT verification (which accepts any logged-in user's session,
 * not just the service role) — the same gap class as KNOWN-BUG-181(a) (dunning-processor).
 */
import { describe, it, expect } from "vitest";
import { localSupabaseUrl, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable, tokenFor } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

async function callReconcile(auth: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/razorpay-settlement-reconcile`, { method: "POST", headers });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json };
}

describe.skipIf(!runtimeUp)("razorpay-settlement-reconcile", () => {
  it("1. no Authorization header is rejected — this is meant to be internal-only", async () => {
    const res = await callReconcile(null);
    expect(res.status).toBe(401);
  });

  it("2. a forged/garbage bearer is rejected", async () => {
    const res = await callReconcile("Bearer garbage-not-a-real-key");
    expect(res.status).toBe(401);
  });

  it("3. an ordinary logged-in user's own session JWT is rejected too — the regression test for the fix (platform JWT verification alone accepted any authenticated session)", async () => {
    const token = await tokenFor("a", "hospital_admin");
    const res = await callReconcile(`Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("4. the real service-role secret is accepted and reaches the function's own code — no Razorpay credentials configured locally, so this is the correct terminal state, not a raw crash", async () => {
    const res = await callReconcile(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`);
    expect(res.status).toBe(500);
    expect(res.json.error).toMatch(/Razorpay keys not configured/);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
