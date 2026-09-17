/**
 * Phase 6, AI-function plumbing — ai-history-digest.
 *
 * New finding, logged as KNOWN-BUG-204: no auth check at all — the same "no auth check at
 * all" defect class as KNOWN-BUG-126/-199. This is the reduce step of ai-history-ingest's
 * self-re-invoking worker (see that file's invokeFunction()) and is never called from the
 * browser (confirmed by grep of src/) — only ai-history-ingest self-invokes it, with the
 * service-role secret. Without a check, any caller holding only the public anon key could
 * name ANOTHER hospital's job_id, forcing a digest rebuild against that hospital's AI
 * entitlement/budget and triggering finalizeAndPurge() to delete that hospital's staged scan
 * files early. Fixed as internal-only, requiring the exact service-role secret, matching
 * ai-safety-guard's fix (KNOWN-BUG-199).
 */
import { describe, it, expect } from "vitest";
import { localSupabaseUrl, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable, tokenFor } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

async function callDigest(auth: string | null, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/ai-history-digest`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

describe.skipIf(!runtimeUp)("ai-history-digest", () => {
  it("1. no Authorization header is rejected — this is internal-only", async () => {
    const res = await callDigest(null, { job_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(401);
  });

  it("2. an ordinary logged-in user's own session JWT is rejected too — not just any authenticated caller", async () => {
    const token = await tokenFor("a", "hospital_admin");
    const res = await callDigest(`Bearer ${token}`, { job_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(401);
  });

  it("3. the real service-role secret is accepted and reaches the job lookup (a nonexistent job_id is a clean 404, not an auth error) — the regression test for the fix (this was reachable by anyone before it)", async () => {
    const res = await callDigest(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`, { job_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });

  it("4. missing job_id is a clean 400 once authenticated", async () => {
    const res = await callDigest(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`, {});
    expect(res.status).toBe(400);
  });
});
