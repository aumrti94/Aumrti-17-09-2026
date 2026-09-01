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

// Resolved once per run and reused after that. Two separate product bugs have now each
// managed to blank out hospitals.name mid-run (a Branding save race, then an unvalidated
// Hospital Profile save) and cascade-failed everything after them purely because this
// function re-resolves the tenant by name on every call. Once the id is known it never needs
// the name again — re-querying it on every one of a thousand-plus calls only exists to
// re-expose the same fragility. A test that specifically wants to assert on a corrupted name
// should read hospitals.name directly rather than go through this helper.
const hospitalIdCache = new Map<'A' | 'B', string>();

export async function hospitalIdFor(key: 'A' | 'B'): Promise<string> {
  const cached = hospitalIdCache.get(key);
  if (cached) return cached;

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
  hospitalIdCache.set(key, data.id);
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

/**
 * Recompute a bill's total_amount/patient_payable/balance_due/payment_status from its live
 * line items and payments.
 *
 * WHY THIS EXISTS, NOT AN IMPORT OF src/lib/billTotals.ts: a test that inserts a payment
 * directly via the service-role client (bypassing the browser) needs something to recompute
 * the bill afterward — nothing else will (there is no DB trigger, and the
 * `recalculate_bill_totals` RPC the app's client-side fallback tries first does not exist as
 * a Postgres function on this project). `billTotals.ts` cannot be imported into a Playwright
 * spec: it transitively imports `src/integrations/supabase/client.ts`, which reads
 * `import.meta.env.VITE_SUPABASE_URL` — a Vite-browser-only global that is `undefined` under
 * Playwright's Node runtime, so the import would crash the test process. This re-derives the
 * same arithmetic independently, using only the already-imported service-role `db()` client.
 */
export async function recomputeBillTotalsForTest(billId: string): Promise<void> {
  const [{ data: items }, { data: payments }, { data: bill }] = await Promise.all([
    db().from('bill_line_items').select('taxable_amount, gst_amount').eq('bill_id', billId),
    db().from('bill_payments').select('amount').eq('bill_id', billId),
    db().from('bills').select('discount_amount, advance_received, insurance_amount').eq('id', billId).maybeSingle(),
  ]);
  const subtotal = (items ?? []).reduce((s: number, i: { taxable_amount: number }) => s + Number(i.taxable_amount || 0), 0);
  const gst = (items ?? []).reduce((s: number, i: { gst_amount: number }) => s + Number(i.gst_amount || 0), 0);
  const b = bill as { discount_amount: number | null; advance_received: number | null; insurance_amount: number | null } | null;
  const discount = Number(b?.discount_amount || 0);
  const total = Math.max(subtotal + gst - discount, 0);
  const patientPayable = Math.max(total - Number(b?.advance_received || 0) - Number(b?.insurance_amount || 0), 0);
  const paid = (payments ?? []).reduce((s: number, p: { amount: number }) => s + Number(p.amount || 0), 0);
  const balanceDue = Math.max(patientPayable - paid, 0);
  const paymentStatus = balanceDue <= 0 && paid > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

  const { error } = await db().from('bills')
    .update({
      total_amount: total, patient_payable: patientPayable,
      balance_due: balanceDue, payment_status: paymentStatus,
    } as never)
    .eq('id', billId);
  if (error) throw new Error(`recomputeBillTotalsForTest: ${error.message}`);
}
