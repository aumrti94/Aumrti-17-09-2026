/**
 * Live-HTTP helper for testing Edge Functions (Phase 6, PHASED_TEST_PLAN.md).
 *
 * WHY LIVE HTTP AND NOT A UNIT TEST. Every function under supabase/functions/ imports
 * Deno-specific remote URLs (`https://deno.land/...`, `https://esm.sh/...`) at module scope,
 * so none of them can be `import`ed into vitest/Node — confirmed during the Phase 5 settings
 * sweep (see docs/testing/PHASE_5_COMPLETION.md §2b) for exactly this reason. `supabase
 * functions serve` runs the real Deno edge-runtime in Docker and serves every function over
 * HTTP; asserting on the HTTP response is the only way to exercise this code at all without
 * refactoring 109 functions. Requires `npx supabase functions serve` running locally first —
 * these tests are skipped with a clear reason (not a false pass) when the runtime is unreachable.
 *
 * Auth tokens come from the same Tier-0 fixture Playwright's global-setup uses
 * (`e2e/fixtures/constants.ts` + `tenantClient`), so a "valid authenticated request" test is a
 * REAL signed-in seeded staff account, not a hand-crafted JWT.
 */
import { localSupabaseUrl, tenantClient, LOCAL_ANON_KEY } from "./serviceClient";
import { staffEmail, TEST_PASSWORD, type TenantKey, type SeededRole } from "./constants";

export interface FunctionCallResult {
  status: number;
  json: any;
  text: string;
  headers: Headers;
}

/**
 * Invoke an Edge Function over HTTP exactly as the browser client would.
 *
 * `token: null` sends no Authorization header at all (the "missing auth" case);
 * `token: "garbage"` sends a malformed bearer token (the "invalid auth" case);
 * omit `token` to default to the anon key, matching an unauthenticated public request.
 */
export async function callFunction(
  name: string,
  opts: {
    token?: string | null;
    body?: unknown;
    /** Raw request body string — for the "malformed payload" assertion (invalid JSON). */
    rawBody?: string;
    method?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<FunctionCallResult> {
  const url = `${localSupabaseUrl()}/functions/v1/${name}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  };
  if (opts.token !== null) {
    headers["Authorization"] = `Bearer ${opts.token ?? LOCAL_ANON_KEY}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "POST",
      headers,
      body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch (err: any) {
    throw new Error(
      `Could not reach ${url}: ${err.message}. Is 'npx supabase functions serve' running?`,
    );
  }

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON — leave json null, callers that expect JSON will fail their own assertion */
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** A real access token for a seeded Tier-0 staff account — a genuinely valid authenticated call. */
export async function tokenFor(tenant: TenantKey, role: SeededRole): Promise<string> {
  const client = await tenantClient(staffEmail(tenant, role), TEST_PASSWORD);
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) {
    throw new Error(`Could not obtain a session for ${staffEmail(tenant, role)}: ${error?.message}`);
  }
  return data.session.access_token;
}

/** True when the local Edge Functions runtime is reachable — gate tests on this, don't hang. */
export async function edgeRuntimeReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/__nonexistent_probe__`, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOCAL_ANON_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    // Any HTTP response (even 404) proves the runtime is up and routing; a network error does not.
    return res.status !== undefined;
  } catch {
    return false;
  }
}
