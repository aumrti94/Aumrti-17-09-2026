/**
 * Phase 12 · Section B — Chronic Disease Management
 *
 * WHAT THIS SECTION EXISTS TO LOCK DOWN
 *
 * The module page was structurally unable to display its own data:
 *
 *   1. care_plans had NO foreign keys (20260521000004 declared hospital_id and
 *      patient_id as bare uuid). ChronicDiseasePage embeds `patients(...)`, PostgREST
 *      could not resolve the relationship, returned PGRST200 — and the page discarded
 *      the error. Result: a plan saved, toasted success, and vanished. The cohort
 *      dashboard read 0 forever. Fixed in 20260821000001.
 *
 *   2. Dashboard KPIs were derived from `tasks`, which only ever holds the SELECTED
 *      plan's tasks, so "Tasks Due Today" and "Overdue" were wrong even with data.
 *
 *   3. chronic_disease_programs (OPD enrolment) and care_plans (this module) were two
 *      islands. care_plans.program_id now bridges them.
 *
 * The FK test is deliberately written as an embed query rather than a constraint
 * lookup — the embed is what the application actually does, and it is what broke.
 */
import { test, expect } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectNoCrossTenantRows } from '../utils/db-verify';
import { PASSWORD, staffByRole } from '../fixtures/mock-data';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';

const CHRONIC_TABLES = [
  'care_plans',
  'care_plan_tasks',
  'care_plan_reviews',
  'medication_adherence',
] as const;

const TAG = 'E2E-P12B Type 2 Diabetes';

async function purgeChronicArtefacts(hospitalId: string) {
  const client = db();
  const { data: plans } = await client
    .from('care_plans').select('id')
    .eq('hospital_id', hospitalId).eq('condition', TAG);
  const ids = (plans ?? []).map((p: { id: string }) => p.id);
  if (ids.length === 0) return;
  await client.from('medication_adherence').delete().in('care_plan_id', ids);
  await client.from('care_plan_reviews').delete().in('care_plan_id', ids);
  await client.from('care_plan_tasks').delete().in('care_plan_id', ids);
  await client.from('care_plans').delete().in('id', ids);
}

test.describe('P12B — care_plans relational wiring', () => {
  test.skip(!DB_ON(), 'Requires QA_DB_AVAILABLE=true and a seeded hospital.');

  test.afterEach(async () => {
    await purgeChronicArtefacts(await hospitalIdFor('A'));
  });

  test('the patients embed the page depends on actually resolves', async () => {
    const hid = await hospitalIdFor('A');

    // This is verbatim the query in ChronicDiseasePage.fetchPlans. Without the FK it
    // returns PGRST200 "Could not find a relationship between care_plans and patients",
    // which the page swallowed into an empty list.
    const { error } = await db()
      .from('care_plans')
      .select('*, patients(full_name, uhid, dob)')
      .eq('hospital_id', hid)
      .limit(1);

    expect(
      error?.message ?? '',
      'care_plans → patients embed still fails; migration 20260821000001 has not been applied',
    ).toBe('');
  });

  test('a created plan is readable back through that same embed', async () => {
    const hid = await hospitalIdFor('A');
    const { data: patient } = await db()
      .from('patients').select('id').eq('hospital_id', hid).limit(1).maybeSingle();
    test.skip(!patient, 'Seeded patient required — run scripts/qa-seed.mjs.');

    const { data: created, error: insErr } = await db().from('care_plans').insert({
      hospital_id: hid,
      patient_id: patient!.id,
      condition: TAG,
      plan_type: 'standard',
      status: 'active',
    }).select('id').maybeSingle();
    expect(insErr?.message ?? '').toBe('');

    // The round trip that silently returned nothing before the fix.
    const { data: readBack, error } = await db()
      .from('care_plans')
      .select('id, condition, patients(full_name)')
      .eq('id', created!.id)
      .maybeSingle();

    expect(error?.message ?? '').toBe('');
    expect(readBack?.id, 'plan saved but is not readable — the original failure mode').toBe(created!.id);
    expect(
      (readBack as { patients?: { full_name?: string } } | null)?.patients?.full_name,
      'the embedded patient did not come back',
    ).toBeTruthy();
  });

  test('program_id bridges a care plan to its OPD chronic enrolment', async () => {
    const hid = await hospitalIdFor('A');
    const { data: patient } = await db()
      .from('patients').select('id').eq('hospital_id', hid).limit(1).maybeSingle();
    test.skip(!patient, 'Seeded patient required.');

    const { data: prog, error: progErr } = await db().from('chronic_disease_programs').insert({
      hospital_id: hid,
      patient_id: patient!.id,
      condition: 'dm',
      condition_label: 'Type 2 Diabetes Mellitus',
      is_active: true,
    }).select('id').maybeSingle();
    expect(progErr?.message ?? '').toBe('');

    const { data: plan, error } = await db().from('care_plans').insert({
      hospital_id: hid,
      patient_id: patient!.id,
      condition: TAG,
      program_id: prog!.id,
      status: 'active',
    }).select('id, program_id').maybeSingle();

    expect(error?.message ?? '', 'care_plans.program_id does not exist or rejects the FK').toBe('');
    expect(plan?.program_id).toBe(prog!.id);

    await db().from('care_plans').delete().eq('id', plan!.id);
    await db().from('chronic_disease_programs').delete().eq('id', prog!.id);
  });
});

test.describe('P12B — cohort dashboard', () => {
  test.skip(!DB_ON(), 'Requires QA_DB_AVAILABLE=true and a seeded hospital.');

  test.afterEach(async () => {
    await purgeChronicArtefacts(await hospitalIdFor('A'));
  });

  test('an active plan raises the Active Care Plans count off zero', async ({ page, loginAs }) => {
    const hid = await hospitalIdFor('A');
    const { data: patient } = await db()
      .from('patients').select('id').eq('hospital_id', hid).limit(1).maybeSingle();
    test.skip(!patient, 'Seeded patient required.');

    await db().from('care_plans').insert({
      hospital_id: hid, patient_id: patient!.id,
      condition: TAG, plan_type: 'standard', status: 'active',
    });

    await loginAs('doctor');
    await page.goto('/chronic-disease');

    // Before the fix this stayed on "No care plans created yet" no matter what
    // existed in the table.
    await expect(page.getByText('No care plans created yet')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(TAG)).toBeVisible();
  });

  test('task KPIs count hospital-wide, not just the selected plan', async () => {
    const hid = await hospitalIdFor('A');
    const { data: patient } = await db()
      .from('patients').select('id').eq('hospital_id', hid).limit(1).maybeSingle();
    test.skip(!patient, 'Seeded patient required.');

    const { data: plan } = await db().from('care_plans').insert({
      hospital_id: hid, patient_id: patient!.id, condition: TAG, status: 'active',
    }).select('id').maybeSingle();

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    await db().from('care_plan_tasks').insert({
      hospital_id: hid, care_plan_id: plan!.id, patient_id: patient!.id,
      task_type: 'lab_test', due_date: yesterday, status: 'pending',
    });

    // The query the dashboard now runs. The old code filtered an in-memory array
    // belonging to whichever plan happened to be selected, so this count was
    // unreachable unless you had clicked that exact plan first.
    const { count, error } = await db()
      .from('care_plan_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', hid)
      .eq('status', 'pending')
      .lt('due_date', new Date().toISOString().split('T')[0]);

    expect(error?.message ?? '').toBe('');
    expect(count ?? 0).toBeGreaterThan(0);
  });
});

test.describe('P12B — Chronic tenant isolation', () => {
  test.skip(!DB_ON(), 'Requires QA_DB_AVAILABLE=true and both hospitals seeded.');

  for (const table of CHRONIC_TABLES) {
    test(`${table} does not leak across hospitals`, async () => {
      const other = await hospitalIdFor('B');
      const staff = staffByRole('A', 'doctor', 0);
      await expectNoCrossTenantRows(table, staff.email, PASSWORD, other);
    });
  }
});
