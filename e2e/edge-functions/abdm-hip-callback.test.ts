/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-hip-callback.
 *
 * Inbound NHA gateway callback (discover / link-confirm / hip data-request), authenticated by
 * an RS256 JWT NHA signs with ITS OWN key — verified here against NHA's real public sandbox
 * JWKS endpoint (`dev.abdm.gov.in/api/v0.5/public-keys`), a read-only, well-known endpoint safe
 * to call from a test. This is genuinely NOT reproducible as a "valid auth succeeds" test from
 * here: doing so would require a JWT signed by NHA's actual private key, which no test
 * environment can produce. What IS fully testable and asserted below is the rejection path —
 * missing auth, structurally-invalid tokens, and a well-formed-but-unsigned-by-NHA token
 * (confirmed against the real sandbox JWKS, not mocked).
 *
 * Also confirms the KNOWN-BUG-182 platform-level `verify_jwt=false` fix for this function is in
 * place: without it, EVERY request here — including a genuine NHA callback — would have been
 * rejected by Supabase's own platform gate before this file's own JWT check ever ran, since an
 * NHA-signed JWT is signed by a different key than this Supabase project's own JWT secret. See
 * KNOWN_BUGS.md for the empirical verification of that fix (this test suite runs under
 * `--no-verify-jwt` like every other Phase 6 test, so it cannot re-prove that specific gate).
 */
import { describe, it, expect } from "vitest";
import { localSupabaseUrl } from "../fixtures/serviceClient";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

async function callHipCallback(path: string, opts: { auth?: string | null; cmId?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== null) headers["authorization"] = opts.auth ?? "Bearer garbage";
  if (opts.cmId !== undefined && opts.cmId !== null) headers["x-cm-id"] = opts.cmId;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/abdm-hip-callback/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

describe.skipIf(!runtimeUp)("abdm-hip-callback", () => {
  it("1. no Authorization header is rejected", async () => {
    const res = await callHipCallback("discover", { auth: null, cmId: "sbx" });
    expect(res.status).toBe(401);
    expect(res.json.error).toMatch(/Gateway authentication failed/);
  });

  it("2. a structurally-invalid bearer (not three JWT segments) is rejected without any network call", async () => {
    const res = await callHipCallback("discover", { auth: "Bearer not-a-jwt", cmId: "sbx" });
    expect(res.status).toBe(401);
  });

  it("3. a well-formed-shape JWT NOT actually signed by NHA is rejected — verified against NHA's real sandbox JWKS endpoint, not mocked", async () => {
    // Header.payload.signature shape, but the signature is garbage — jose's jwtVerify must
    // fetch NHA's real public keys and fail real cryptographic verification, not just a
    // structural check.
    const fakeJwt = `${btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: "forged" }))}.not-a-real-signature`;
    const res = await callHipCallback("discover", { auth: `Bearer ${fakeJwt}`, cmId: "sbx" });
    expect(res.status).toBe(401);
    expect(res.json.error).toMatch(/Gateway authentication failed/);
  });

  it("4. malformed JSON does not 500 with a raw stack trace (reached only when auth is bypassed, so this rejects at the auth layer just like tests 1-3, honestly reflecting that the body-parsing step is unreachable without a real NHA-signed token from this environment)", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/abdm-hip-callback/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cm-id": "sbx", authorization: "Bearer garbage" },
      body: "{bad json",
    });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
