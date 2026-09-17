/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-gateway-token.
 *
 * Internal-only (KNOWN-BUG-126: exact service-role secret required, since it hands back a
 * hospital's live NHA gateway bearer token). Uses HOSPITAL_A's own natural "no
 * hospital_abdm_config row" state rather than creating one: that table is a hard
 * UNIQUE(hospital_id) singleton already exercised by abdm-hpr-verify.test.ts and
 * abdm-sandbox-test.test.ts for HOSPITAL_A, and submit-pre-auth-hcx.test.ts for HOSPITAL_B —
 * a third concurrent writer would race all of them.
 *
 * Four bugs found and fixed writing this test, logged as KNOWN-BUG-192: all four
 * `abdm_gateway_logs` inserts in this file used column names that don't exist on that table
 * at all (`request_id`/`endpoint`/`payload`/`status_code`/`error`/`response` — the real
 * columns are `action`/`direction`/`request_payload`/`response_payload`/`status`), and
 * `direction: "OUTBOUND"` against a CHECK constraint that only ever allowed lowercase
 * `'inbound'`/`'outbound'`. Every gateway-log insert in this function has always failed,
 * silently — an audit-trail gap only, since the actual token fetch/cache logic doesn't
 * depend on these writes succeeding, and is not independently re-verified live here: it
 * requires real `abdm_client_id`/`abdm_client_secret` on a `hospital_abdm_config` row to be
 * reached at all, and creating one risks exactly the singleton race described above. Relies
 * on code-review confirmation against the table's real schema instead.
 */
import { describe, it, expect } from "vitest";
import { localSupabaseUrl, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { HOSPITAL_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable, tokenFor } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

async function callGatewayToken(auth: string | null, body: unknown = { hospital_id: HOSPITAL_A.id }) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/abdm-gateway-token`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

describe.skipIf(!runtimeUp)("abdm-gateway-token", () => {
  it("1. no Authorization header is rejected — this is internal-only", async () => {
    const res = await callGatewayToken(null);
    expect(res.status).toBe(401);
  });

  it("2. an ordinary logged-in user's own session JWT is rejected too — not just any authenticated caller", async () => {
    const token = await tokenFor("a", "hospital_admin");
    const res = await callGatewayToken(`Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("3. a forged/garbage bearer is rejected", async () => {
    const res = await callGatewayToken("Bearer garbage-not-a-real-key");
    expect(res.status).toBe(401);
  });

  it("4. missing hospital_id with the real service-role secret is a clean 400", async () => {
    const res = await callGatewayToken(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`, {});
    expect(res.status).toBe(400);
  });

  it("5. the real service-role secret is accepted and honestly reports no ABDM config exists for HOSPITAL_A locally", async () => {
    const res = await callGatewayToken(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`);
    expect(res.status).toBe(404);
    expect(res.json.error).toMatch(/No ABDM configuration found/);
  });
});
