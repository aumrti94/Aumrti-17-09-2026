/**
 * Phase 1 · Section B — Onboarding wizard
 * Locks tracker cases TC-P1B-001 … TC-P1B-027
 *
 * The two cases that matter most here are TC-P1B-009 and TC-P1B-017: a ward
 * saved without rate_per_day, and a hospital with no consultation fee. Both
 * cause the application to silently bill a hardcoded amount forever.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';

const DB = () => process.env.QA_DB_AVAILABLE === 'true';

/** The 14 wizard steps in 6 sections — src/pages/setup/OnboardingWizard.tsx */
const EXPECTED_STEPS = [
  'Branding', 'Departments', 'Wards & Beds', 'Shifts', 'Doctors', 'Other Staff',
  'OPD Schedules', 'Fees', 'Payers', 'Lab & Radiology', 'Payments',
  'WhatsApp', 'Modules', 'Go Live',
];

test.describe('P1B — Onboarding wizard', () => {

  test('TC-P1B-002 the wizard offers all 14 steps', async ({ page, loginAs }) => {
    await loginAs('hospital_admin');
    await page.goto('/setup/onboarding', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const body = await page.locator('body').innerText();
    const missing = EXPECTED_STEPS.filter(s => !body.includes(s));
    expect(
      missing,
      `Onboarding is missing step(s): ${missing.join(', ')}. The wizard order IS the ` +
      `dependency order — a missing step means something configures nothing.`,
    ).toHaveLength(0);
  });

  test('TC-P1B-008/009 every seeded ward has rate_per_day set', async () => {
    test.skip(!DB(), 'Database access not enabled — see .env.example');
    const hid = await hospitalIdFor('A');

    const { data, error } = await db()
      .from('wards').select('name, rate_per_day').eq('hospital_id', hid);
    expect(error?.message ?? null).toBeNull();
    test.skip(!data?.length, 'No wards seeded yet — run scripts/qa-seed.mjs');

    const missing = data!.filter(w => w.rate_per_day == null || Number(w.rate_per_day) <= 0);
    expect(
      missing.map(w => w.name),
      `Ward(s) with no rate_per_day. Room charge will silently fall back to Rs 500/day ` +
      `and the hospital will under-bill every admission without noticing.`,
    ).toHaveLength(0);
  });

  test('TC-P1B-008 ward rates match the Mock Data Book exactly', async () => {
    test.skip(!DB(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db()
      .from('wards').select('name, rate_per_day').eq('hospital_id', hid);
    test.skip(!data?.length, 'No wards seeded yet — run scripts/qa-seed.mjs');

    const actual = new Map(data!.map(w => [w.name, Number(w.rate_per_day)]));
    const wrong = MOCK.wards
      .filter(w => actual.has(w.name) && actual.get(w.name) !== w.ratePerDay)
      .map(w => `${w.name}: expected ${w.ratePerDay}, got ${actual.get(w.name)}`);

    expect(wrong, `Ward rates drifted from mock-data.json:\n  ${wrong.join('\n  ')}`).toHaveLength(0);
  });

  test('TC-P1B-010 all 32 beds exist and are linked to a ward', async () => {
    test.skip(!DB(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const expected = MOCK.wards.reduce((n, w) => n + w.bedCount, 0);

    const { data } = await db()
      .from('beds').select('bed_number, ward_id').eq('hospital_id', hid);
    test.skip(!data?.length, 'No beds seeded yet — run scripts/qa-seed.mjs');

    expect(data!.length, `Expected ${expected} beds, found ${data!.length}`).toBe(expected);

    const orphans = data!.filter(b => !b.ward_id).map(b => b.bed_number);
    expect(orphans, `Bed(s) with no ward — they cannot be allocated: ${orphans.join(', ')}`).toHaveLength(0);
  });

  test('TC-P1B-017 every service carries an HSN code', async () => {
    test.skip(!DB(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db()
      .from('service_master').select('name, hsn_code, gst_applicable').eq('hospital_id', hid);
    test.skip(!data?.length, 'No services seeded yet — run scripts/qa-seed.mjs');

    const missing = data!.filter(s => !s.hsn_code).map(s => s.name);
    expect(
      missing,
      `Service(s) with no HSN code. Once the hospital GSTIN is set, bill finalisation is ` +
      `HARD-BLOCKED for any bill containing these:\n  ${missing.join('\n  ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1B-020 lab tests have fees and normal ranges', async () => {
    test.skip(!DB(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db()
      .from('lab_test_master')
      .select('test_name, test_code, fee, normal_min, normal_max')
      .eq('hospital_id', hid);
    test.skip(!data?.length, 'No lab tests seeded yet — run scripts/qa-seed.mjs');

    const noFee = data!.filter(t => t.fee == null || Number(t.fee) <= 0).map(t => t.test_name);
    expect(noFee, `Lab test(s) with no fee — orders will bill Rs 0:\n  ${noFee.join('\n  ')}`).toHaveLength(0);

    // A test with no normal range cannot flag an abnormal result, which means
    // no critical-value alert either.
    const rangedInMock = MOCK.labTests.filter(t => t.normalMin != null).map(t => t.code);
    const byCode = new Map(data!.map(t => [t.test_code, t]));
    const lostRange = rangedInMock
      .filter(code => byCode.has(code) && byCode.get(code)!.normal_min == null);
    expect(
      lostRange,
      `Lab test(s) lost their normal range — no abnormal flag and NO critical alert: ${lostRange.join(', ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1B-021 radiology studies are linked to a modality', async () => {
    test.skip(!DB(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db()
      .from('radiology_study_master').select('name, modality_id, fee').eq('hospital_id', hid);
    test.skip(!data?.length, 'No radiology studies seeded yet — run scripts/qa-seed.mjs');

    const orphans = data!.filter(s => !s.modality_id).map(s => s.name);
    expect(
      orphans,
      `Study(ies) with no modality — the order modal will show "No studies configured": ${orphans.join(', ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1B-027 Hospital B has enough data to make isolation tests meaningful', async () => {
    test.skip(!DB(), 'Database access not enabled');
    const hid = await hospitalIdFor('B');
    const { count } = await db()
      .from('patients').select('*', { count: 'exact', head: true }).eq('hospital_id', hid);

    expect(
      count ?? 0,
      'Hospital B has no patients. An empty result is NOT the same as a blocked one — ' +
      'without real data there, the isolation tests prove nothing.',
    ).toBeGreaterThan(0);
  });
});
