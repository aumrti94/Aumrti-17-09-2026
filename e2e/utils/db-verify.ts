/**
 * Database verification helpers.
 *
 * The single most important rule in this QA program:
 *
 *     A GREEN TOAST DOES NOT MEAN THE DATA WAS SAVED.
 *
 * This application has code paths that report success and write nothing.
 * Every automated test therefore asserts the row, not the notification —
 * mirroring the "Supabase Verify" column the manual tester works from.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect } from '@playwright/test';
import { TEST_ENV, checkDbGuard, assertQaHospitalName } from './env';
import { MOCK } from '../fixtures/mock-data';

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS, so it is only for verification. */
export function db(): SupabaseClient {
  const guard = checkDbGuard();
  if (!guard.ok) throw new Error(`[QA GUARD] ${guard.reason}`);
  if (!TEST_ENV.serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — cannot verify database rows.');
  }
  admin ??= createClient(TEST_ENV.supabaseUrl, TEST_ENV.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return admin;
}

/** An anon client, used to prove RLS holds for an ordinary logged-in user. */
export function anonDb(): SupabaseClient {
  const guard = checkDbGuard();
  if (!guard.ok) throw new Error(`[QA GUARD] ${guard.reason}`);
  return createClient(TEST_ENV.supabaseUrl, TEST_ENV.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function hospitalIdFor(key: 'A' | 'B'): Promise<string> {
  const name = MOCK.hospitals[key].name;
  const { data, error } = await db()
    .from('hospitals').select('id, name').eq('name', name).maybeSingle();
  if (error) throw new Error(`Could not resolve Hospital ${key}: ${error.message}`);
  if (!data) {
    throw new Error(
      `Hospital ${key} ("${name}") does not exist. Run: node scripts/qa-seed.mjs`,
    );
  }
  assertQaHospitalName(data.name, `resolving Hospital ${key}`);
  return data.id;
}

/** Assert at least one row matches. Returns the first match. */
export async function expectRow<T = Record<string, unknown>>(
  table: string,
  filters: Record<string, unknown>,
  message?: string,
): Promise<T> {
  let q = db().from(table).select('*');
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as never);
  const { data, error } = await q.limit(1);

  if (error) throw new Error(`Query on "${table}" failed: ${error.message}`);
  expect(
    data && data.length > 0,
    message ??
      `Expected a row in "${table}" matching ${JSON.stringify(filters)}, but found none. ` +
      `The UI may have reported success without writing.`,
  ).toBeTruthy();
  return data![0] as T;
}

/** Assert NO row matches — used constantly for negative and isolation cases. */
export async function expectNoRow(
  table: string,
  filters: Record<string, unknown>,
  message?: string,
): Promise<void> {
  let q = db().from(table).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as never);
  const { count, error } = await q;
  if (error) throw new Error(`Query on "${table}" failed: ${error.message}`);
  expect(
    count ?? 0,
    message ??
      `Expected NO row in "${table}" matching ${JSON.stringify(filters)}, but found ${count}.`,
  ).toBe(0);
}

export async function countRows(
  table: string,
  filters: Record<string, unknown> = {},
): Promise<number> {
  let q = db().from(table).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as never);
  const { count, error } = await q;
  if (error) throw new Error(`Count on "${table}" failed: ${error.message}`);
  return count ?? 0;
}

/**
 * The core tenant-isolation assertion.
 *
 * Signs in as a real Hospital A user through the anon client — i.e. exactly
 * what the browser does — then queries the table with NO hospital filter.
 * If RLS is doing its job, not one Hospital B row comes back.
 */
export async function expectNoCrossTenantRows(
  table: string,
  asEmail: string,
  password: string,
  otherHospitalId: string,
): Promise<void> {
  const client = anonDb();
  const { error: authErr } = await client.auth.signInWithPassword({
    email: asEmail, password,
  });
  if (authErr) throw new Error(`Could not sign in as ${asEmail}: ${authErr.message}`);

  try {
    const { data, error } = await client.from(table).select('hospital_id').limit(1000);
    if (error) {
      // A hard RLS denial is a perfectly good outcome.
      return;
    }
    const leaked = (data ?? []).filter(
      (r: { hospital_id?: string }) => r.hospital_id === otherHospitalId,
    );
    expect(
      leaked.length,
      `TENANT LEAK: "${table}" returned ${leaked.length} row(s) belonging to the other ` +
      `hospital when queried as ${asEmail}. RLS is not isolating this table.`,
    ).toBe(0);
  } finally {
    await client.auth.signOut();
  }
}
