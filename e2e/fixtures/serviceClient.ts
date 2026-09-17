/**
 * The service-role assertion client. **Tests only — never importable from `src/`.**
 *
 * §5 rule 4: "A service-role query client is available to tests only — it is how assertions
 * read across RLS to prove isolation held. It is never importable from `src/`."
 *
 * WHY A SECOND CLIENT AT ALL. An isolation test has to answer two different questions, and
 * they need different privileges:
 *
 *   1. "Can hospital A's session see hospital B's row?"  → must be asked as hospital A,
 *      through RLS, using the app's own anon client. A service-role client here would
 *      bypass the very policy under test and pass unconditionally.
 *   2. "Does hospital B's row actually exist?"           → must be asked WITHOUT RLS, or a
 *      policy that hides everything from everyone looks identical to correct isolation.
 *
 * Question 2 is what this client is for, and only question 2. If an assertion about what a
 * USER can see is written against this client, the test proves nothing — see the guidance in
 * `expectInvisibleToTenant` below.
 *
 * WHY THE KEY IS SAFE HERE. `supabase start` mints the same well-known service-role JWT on
 * every machine — it is published in Supabase's own docs and grants nothing anywhere but a
 * throwaway local container. `assertLocalTarget` refuses to build a client against anything
 * else, so a real key cannot be smuggled in through the environment.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocalTarget } from "./guard.ts";

/**
 * The standard local anon and service-role keys minted by `supabase start`.
 *
 * Hard-coded rather than read from the environment so a CI misconfiguration cannot silently
 * substitute a real key. They are overridable only for a local container on a custom port.
 */
export const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export function localSupabaseUrl(): string {
  return process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
}

function serviceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_ROLE_KEY;
}

function anonKey(): string {
  return process.env.SUPABASE_ANON_KEY ?? LOCAL_ANON_KEY;
}

/**
 * A client that bypasses RLS. Use it to establish GROUND TRUTH, never to stand in for what a
 * user can see.
 */
export function serviceClient(): SupabaseClient {
  const url = localSupabaseUrl();
  assertLocalTarget(url, process.env.SUPABASE_PROJECT_REF);
  return createClient(url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A client subject to RLS, signed in as nobody. Use it to ask what an ANONYMOUS caller can
 * reach — the shape of most "is this endpoint actually protected?" assertions.
 */
export function anonClient(): SupabaseClient {
  const url = localSupabaseUrl();
  assertLocalTarget(url, process.env.SUPABASE_PROJECT_REF);
  return createClient(url, anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A client subject to RLS, signed in as a seeded staff account.
 *
 * This is the client an isolation assertion asks question 1 with. It goes through exactly the
 * policies a real session does.
 */
export async function tenantClient(email: string, password: string): Promise<SupabaseClient> {
  const url = localSupabaseUrl();
  assertLocalTarget(url, process.env.SUPABASE_PROJECT_REF);
  const client = createClient(url, anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Could not sign in seeded account ${email}: ${error.message}. Has the seed run?`);
  }
  return client;
}

/**
 * Assert a row exists at all, using service-role.
 *
 * The other half of every isolation assertion. Without it, "hospital A cannot see this row"
 * is satisfied by the row not existing — and a policy that denies everything to everyone
 * would pass every isolation test in the suite.
 */
export async function expectRowExists(
  svc: SupabaseClient,
  table: string,
  id: string,
): Promise<void> {
  const { data, error } = await svc.from(table).select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`Ground-truth read of ${table}.${id} failed: ${error.message}`);
  if (!data) {
    throw new Error(
      `Ground truth missing: ${table}.${id} does not exist. An isolation assertion against it would pass vacuously.`,
    );
  }
}
