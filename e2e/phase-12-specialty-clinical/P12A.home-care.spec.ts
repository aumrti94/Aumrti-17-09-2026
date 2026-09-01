/**
 * Phase 12 · Section A — Home Care (domiciliary / NABH AAC.12.f)
 *
 * WHAT THIS SECTION EXISTS TO LOCK DOWN
 *
 * Home Care shipped with three defects that all failed SILENTLY in different ways.
 * Each has a test here, and each is written so that reintroducing the bug turns the
 * test red rather than merely changing a number:
 *
 *   1. created_by FK (the visible one)
 *      HomeCareActivePlansTab wrote `supabase.auth.getUser().id` — the AUTH user id —
 *      into home_care_plans.created_by, which FKs public.users(id). Every save died on
 *      "violates foreign key constraint home_care_plans_created_by_fkey". This was the
 *      only one of the three a user could actually see.
 *
 *   2. bills.bill_type CHECK (the expensive one)
 *      autoChargeService's standalone branch derives bill_type as
 *      serviceModule.replace("_","") → 'homecare', which was NOT in bills_bill_type_check.
 *      Home care visits pass no admissionId/encounterId so they ALWAYS take that branch:
 *      the bills INSERT failed the CHECK, autoChargeService threw on nb!.id, and
 *      HomeCareVisitTab's `.catch(() => {})` swallowed it. Every recorded visit produced
 *      ZERO revenue and no error anywhere. Fixed in 20260821000002.
 *
 *   3. billing idempotency (the dangerous one)
 *      autoChargeService's duplicate guard reads sourceTable.billing_status.
 *      home_care_visits had no such column, so the guard never fired, and
 *      idx_bill_line_items_dedupe is NOT unique — nothing stopped a double charge.
 *
 * DB-dependent assertions are gated on QA_DB_AVAILABLE, matching phases 1-5.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectNoCrossTenantRows } from '../utils/db-verify';
import { PASSWORD, staffByRole } from '../fixtures/mock-data';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';

const HOME_CARE_TABLES = [
  'home_care_plans',
  'home_care_visits',
  'home_tele_monitoring',
] as const;

/** Artefacts this section creates, removed so re-runs start clean. */
async function purgeHomeCareArtefacts(hospitalId: string, diagnosisTag: string) {
  const client = db();
  const { data: plans } = await client
    .from('home_care_plans').select('id')
    .eq('hospital_id', hospitalId).eq('diagnosis', diagnosisTag);
  const planIds = (plans ?? []).map((p: { id: string }) => p.id);
  if (planIds.length === 0) return;
  await client.from('home_tele_monitoring').delete().in('plan_id', planIds);
  await client.from('home_care_visits').delete().in('plan_id', planIds);
  await client.from('home_care_plans').delete().in('id', planIds);
}

const TAG = 'E2E-P12A wound care';

test.describe('P12A — Home Care plan creation', () => {
  test.skip(!DB_ON(), 'Requires QA_DB_AVAILABLE=true and a seeded hospital.');

  test.afterEach(async () => {
    const hid = await hospitalIdFor('A');
    await purgeHomeCareArtefacts(hid, TAG);
  });

  test('creating a plan persists it and auto-generates the visit schedule', async ({ page, loginAs }) => {
    await loginAs('nurse');
    const hid = await hospitalIdFor('A');

    await page.goto('/home-care');
    await expect(page.getByText('Home Care')).toBeVisible();

    await page.getByRole('button', { name: /new plan/i }).click();

    // Patient search matches on full_name and needs at least 2 characters
    const patient = MOCK.patients.find(p => p.hospital === 'A');
    test.skip(!patient, 'Seeded hospital-A patient required — run scripts/qa-seed.mjs.');
    await page.getByPlaceholder(/search patient name/i).fill(patient!.name.slice(0, 6));
    await page.getByRole('button', { name: new RegExp(patient!.name, 'i') }).first().click();

    await page.getByPlaceholder(/post-op wound care/i).fill(TAG);
    await page.getByLabel(/wound dressing/i).check();

    await page.getByRole('button', { name: /create plan/i }).click();

    // THE REGRESSION: before the fix this toast read
    // "Save failed — violates foreign key constraint home_care_plans_created_by_fkey"
    await expect(page.getByText(/visit(s)? scheduled/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/save failed/i)).toHaveCount(0);

    // The plan must appear in the list — not merely have toasted success
    await expect(page.getByText(TAG)).toBeVisible();

    const { data: plans } = await db()
      .from('home_care_plans').select('id, created_by, care_coordinator, status')
      .eq('hospital_id', hid).eq('diagnosis', TAG);
    expect(plans, 'plan row was not written').toHaveLength(1);

    // created_by must be a public.users id, resolvable in that table. If the auth
    // id were written again the FK would reject it, but assert the join too so a
    // future migration dropping the FK cannot silently reintroduce the bug.
    const { data: userRow } = await db()
      .from('users').select('id').eq('id', plans![0].created_by).maybeSingle();
    expect(userRow?.id, 'created_by does not resolve to a public.users row').toBeTruthy();

    const { data: visits } = await db()
      .from('home_care_visits').select('id, scheduled_date, status')
      .eq('plan_id', plans![0].id);
    expect(visits!.length, 'no visits were generated for the plan').toBeGreaterThan(0);
    expect(visits!.every(v => v.status === 'scheduled')).toBe(true);
  });
});

test.describe('P12A — Home Care visit billing', () => {
  test.skip(!DB_ON(), 'Requires QA_DB_AVAILABLE=true and a seeded hospital.');

  test('bills.bill_type accepts the value the home care path actually writes', async () => {
    const hid = await hospitalIdFor('A');
    const { data: patient } = await db()
      .from('patients').select('id').eq('hospital_id', hid).limit(1).maybeSingle();
    test.skip(!patient, 'Seeded patient required.');

    // Direct probe of the CHECK constraint. This is what silently rejected every
    // home care bill: autoChargeService writes bill_type 'homecare' and the
    // constraint did not list it.
    const { data, error } = await db().from('bills').insert({
      hospital_id: hid,
      patient_id: patient!.id,
      bill_number: `E2E-P12A-${Date.now()}`,
      bill_type: 'homecare',
      bill_date: new Date().toISOString().split('T')[0],
      bill_status: 'final',
      payment_status: 'unpaid',
      subtotal: 0, gst_amount: 0, total_amount: 0,
      patient_payable: 0, balance_due: 0,
    }).select('id').maybeSingle();

    expect(
      error?.message ?? '',
      'bills_bill_type_check still rejects "homecare" — migration 20260821000002 has not been applied',
    ).not.toContain('bill_type');
    expect(data?.id).toBeTruthy();

    if (data?.id) await db().from('bills').delete().eq('id', data.id);
  });

  test('home_care_visits carries the columns autoChargeService needs for idempotency', async () => {
    const hid = await hospitalIdFor('A');
    // A select on a missing column errors — which is exactly how the duplicate
    // guard was failing, invisibly, inside autoChargeService.
    const { error } = await db()
      .from('home_care_visits')
      .select('billing_status, bill_id, billed_at')
      .eq('hospital_id', hid)
      .limit(1);
    expect(
      error?.message ?? '',
      'billing_status/bill_id/billed_at missing — the duplicate-charge guard cannot work',
    ).toBe('');
  });
});

test.describe('P12A — Home Care tenant isolation', () => {
  test.skip(!DB_ON(), 'Requires QA_DB_AVAILABLE=true and both hospitals seeded.');

  for (const table of HOME_CARE_TABLES) {
    test(`${table} does not leak across hospitals`, async () => {
      const other = await hospitalIdFor('B');
      const staff = staffByRole('A', 'nurse', 0);
      await expectNoCrossTenantRows(table, staff.email, PASSWORD, other);
    });
  }
});
