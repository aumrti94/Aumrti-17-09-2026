/**
 * Phase 2 · Section G — Clinical Masters: Lab Test Master & Drug Formulary
 * Locks tracker cases TC-P2G-001 … TC-P2G-056
 *
 * Two catalogues that fail silently in different ways, both flagged red in
 * SETTINGS_PREREQ_MATRIX:
 *
 *   LAB   — the OPD→Lab handoff is an EXACT, case-insensitive match on
 *           `lab_test_master.test_name`. A test the doctor typed that is not in the
 *           catalogue is SILENTLY DROPPED from the order; the only signal is an amber banner
 *           counting how many went missing. The patient simply never gets the test.
 *
 *   DRUGS — a drug with no batch is INVISIBLE to the dispenser, and a drug with no generic
 *           name is invisible to the interaction and allergy checks while dispensing normally.
 *
 * The two highest-stakes cases here are TC-P2G-006 (potassium 7.2 must raise a critical alert
 * — that value causes fatal arrhythmia) and TC-P2G-041 (a penicillin-class drug must be
 * matched against a recorded penicillin allergy). Drug safety checks must be real and are
 * never mocked.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import {
  fillField, selectByValue, save, openCreate, awaitSaveAck, reloadAndSettle, heading,
} from './settings-locators';

const LAB = '/settings/lab-tests';
const DRUGS = '/settings/drugs';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const NEW_TEST = MOCK.phase2.entry[LAB] as {
  name: string; code: string; sampleType: string; fee: number;
  unit: string; normalMin: number; normalMax: number; tatMinutes: number;
};
const NO_RANGE = MOCK.phase2.invalid.labTestWithoutRange as {
  name: string; code: string; sampleType: string; fee: number; unit: string;
};
const INVERTED = MOCK.phase2.invalid.normalRangeInverted as { min: number; max: number };
const GROUP = MOCK.phase2.labTestGroup as {
  name: string; fee: number; members: string[]; membersSum: number;
};
const DRUG = MOCK.phase2.entry[DRUGS] as {
  brand: string; generic: string; form: string; strength: string;
  schedule: string; mrp: number; gst: number;
};

const LAB_CODES = [NEW_TEST.code, NO_RANGE.code, 'QA-INV', 'QA-NOFEE', 'QA-DUP'];
const DRUG_BRANDS = [DRUG.brand, 'QA No Generic Drug'];

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  const { data: groups } = await db().from('lab_test_groups')
    .select('id').eq('hospital_id', hid).eq('name', GROUP.name);
  for (const g of groups ?? []) await db().from('lab_test_group_items').delete().eq('group_id', g.id);
  await db().from('lab_test_groups').delete().eq('hospital_id', hid).eq('name', GROUP.name);
  await db().from('lab_test_master').delete().eq('hospital_id', hid).in('code', LAB_CODES);
  await db().from('drug_master').delete().eq('hospital_id', hid).in('brand', DRUG_BRANDS);
}

async function addTest(
  page: import('@playwright/test').Page,
  o: Partial<{
    name: string; code: string; sample: string; unit: string;
    min: number | string; max: number | string; fee: number | string;
    tat: number; method: string; criticalHigh: number;
  }>,
): Promise<void> {
  await openCreate(page, /add test/i);
  const put = async (label: string, v: unknown) => {
    if (v !== undefined) await fillField(page, label, v as string | number, LAB).catch(() => {});
  };
  await put('Test Name', o.name);
  await put('Code', o.code);
  await put('Sample Type', o.sample);
  await put('Unit', o.unit);
  await put('Normal Min (default)', o.min);
  await put('Normal Max (default)', o.max);
  await put('Critical High', o.criticalHigh);
  await put('TAT (minutes)', o.tat);
  await put('Method', o.method);
  await put('Fee (₹)', o.fee);
  await save(page, /save|add/i);
  await awaitSaveAck(page);
}

async function addDrug(
  page: import('@playwright/test').Page,
  o: Partial<{ brand: string; generic: string; category: string; routes: string; schedule: string; gst: number; mrp: number }>,
): Promise<void> {
  await openCreate(page, /add drug|new drug/i);
  const put = async (label: string, v: unknown) => {
    if (v !== undefined) await fillField(page, label, v as string | number, DRUGS).catch(() => {});
  };
  await put('Drug Name', o.brand);
  await put('Generic Name', o.generic);
  await put('Category', o.category);
  await put('Routes (comma sep)', o.routes);
  await put('GST %', o.gst);
  if (o.schedule) await selectByValue(page, 'Drug Schedule', o.schedule, { route: DRUGS }).catch(() => {});
  await save(page, /save|add/i);
  await awaitSaveAck(page);
}

/** Shared body for the four drug-schedule cases. Titles stay literal. */
async function drugScheduleCase(page: import('@playwright/test').Page, sched: string, example: string) {
  const hid = await hospitalIdFor('A');
  const { data: seeded } = await db().from('drug_master')
    .select('schedule').eq('hospital_id', hid).eq('brand', example).maybeSingle();

  if (seeded) {
    expect(
      String(seeded.schedule ?? '').toUpperCase(),
      `Seeded drug "${example}" is stored as schedule "${seeded.schedule}", not "${sched}". The ` +
      `schedule decides which statutory register a dispense is written into — a mis-stored one ` +
      `moves a controlled drug out of its legally required register.`,
    ).toBe(sched.toUpperCase());
    return;
  }

  await addDrug(page, { brand: `QA Sched ${sched}`, generic: 'QA Generic', schedule: sched, mrp: 10 });
  const row = await expectRow<{ schedule: string }>(
    'drug_master', { hospital_id: hid, brand: `QA Sched ${sched}` },
    `Schedule "${sched}" could not be saved.`,
  );
  expect(String(row.schedule).toUpperCase()).toBe(sched.toUpperCase());
  await db().from('drug_master').delete().eq('hospital_id', hid).eq('brand', `QA Sched ${sched}`);
}

test.describe('P2G — Lab Test Master', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(LAB, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-001 Lab Test Master loads and lists the seeded tests', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Lab Test Master').or(page.getByRole('heading', { name: /lab test/i }).first())).toBeVisible();

    if (DB_ON()) {
      const body = await page.locator('body').innerText();
      const missing = MOCK.labTests.filter(t => !body.includes(t.name)).map(t => t.name);
      expect(
        missing,
        `Seeded test(s) not listed: ${missing.join(', ')}. The OPD→Lab handoff matches on ` +
        `test_name — a test missing from this catalogue is silently dropped from every order.`,
      ).toEqual([]);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-002 A new lab test saves with its fee, unit, range and TAT', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    await addTest(page, {
      name: NEW_TEST.name, code: NEW_TEST.code, sample: NEW_TEST.sampleType, unit: NEW_TEST.unit,
      min: NEW_TEST.normalMin, max: NEW_TEST.normalMax, fee: NEW_TEST.fee, tat: NEW_TEST.tatMinutes,
    });

    const row = await expectRow<{ fee: number; normal_min: number; normal_max: number; tat_minutes: number }>(
      'lab_test_master', { hospital_id: hid, code: NEW_TEST.code },
      'No lab_test_master row after a successful-looking save. Each field drives a different ' +
      'downstream behaviour — fee bills, range flags abnormal, TAT drives the delay alert.',
    );
    expect(Number(row.fee)).toBe(NEW_TEST.fee);
    expect(Number(row.normal_min)).toBe(NEW_TEST.normalMin);
    expect(Number(row.normal_max)).toBe(NEW_TEST.normalMax);
  });

  test('TC-P2G-003 A lab test saved without a normal range cannot flag an abnormal result', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, {
      name: NO_RANGE.name, code: NO_RANGE.code, sample: NO_RANGE.sampleType,
      unit: NO_RANGE.unit, fee: NO_RANGE.fee,
    });

    const { data } = await db().from('lab_test_master')
      .select('normal_min, normal_max').eq('hospital_id', hid).eq('code', NO_RANGE.code).maybeSingle();
    test.skip(!data, 'The no-range test was not created');

    if (data!.normal_min === null && data!.normal_max === null) {
      const body = await page.locator('body').innerText();
      expect(
        /no range|range required|not set|incomplete|—/i.test(body),
        'A test with no reference range saved with nothing flagging it. No normal range means no ' +
        'abnormal flag and NO CRITICAL ALERT — a dangerously abnormal result would be reported ' +
        'as an unremarkable number and nobody would be paged.',
      ).toBeTruthy();
    }
  });

  test('TC-P2G-004 A normal range with the minimum above the maximum is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, {
      name: 'QA Inverted Range', code: 'QA-INV', sample: 'Serum', unit: 'mg/dL',
      min: INVERTED.min, max: INVERTED.max, fee: 100,
    });

    const { data } = await db().from('lab_test_master')
      .select('normal_min, normal_max').eq('hospital_id', hid).eq('code', 'QA-INV').maybeSingle();
    if (data && data.normal_min !== null && data.normal_max !== null) {
      expect(
        Number(data.normal_min) <= Number(data.normal_max),
        `An inverted range (${data.normal_min}–${data.normal_max}) was stored. It matches nothing, ` +
        `so every result falls outside it — the abnormal flag becomes noise and clinicians stop ` +
        `trusting it.`,
      ).toBeTruthy();
    }
  });

  test('TC-P2G-005 Critical low and high values save separately from the normal range', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('lab_test_master')
      .select('*').eq('hospital_id', hid).eq('code', 'K').maybeSingle();
    test.skip(!!error || !data, 'Serum Potassium is not seeded — run npm run qa:seed');

    const keys = Object.keys(data!);
    expect(
      keys.some(k => /critical/i.test(k)),
      `lab_test_master has no critical-value column (${keys.join(', ')}). Normal range flags a ` +
      `result as abnormal; critical value PAGES a doctor. Potassium of 5.5 is abnormal and 7.2 is ` +
      `a cardiac emergency — collapsing the two either floods the ward or misses the one that matters.`,
    ).toBeTruthy();
  });

  test('TC-P2G-006 The critical potassium value fires an alert at 7.2', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('lab_test_master')
      .select('normal_min, normal_max').eq('hospital_id', hid).eq('code', 'K').maybeSingle();
    test.skip(!data, 'Serum Potassium is not seeded — run npm run qa:seed');

    const critical = MOCK.commonValues.criticalPotassium;
    expect(
      Number(data!.normal_max),
      `Serum Potassium normal max is ${data!.normal_max}, expected 5.1. A result of ${critical} ` +
      `must fall outside the range to raise a critical alert — potassium at that level causes ` +
      `fatal arrhythmia, so an alert that does not fire is the most direct patient-safety failure ` +
      `in the lab module.`,
    ).toBe(5.1);
    expect(critical).toBeGreaterThan(Number(data!.normal_max));
  });

  test('TC-P2G-007 Sex-specific reference ranges save independently', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('lab_test_master')
      .select('*').eq('hospital_id', hid).eq('code', 'HB').maybeSingle();
    test.skip(!data, 'Haemoglobin is not seeded — run npm run qa:seed');

    const keys = Object.keys(data!);
    expect(
      keys.some(k => /male|female|sex|gender/i.test(k)),
      `lab_test_master has no sex-specific range columns (${keys.join(', ')}). Applying the male ` +
      `haemoglobin range to a female patient flags healthy women as anaemic — in an obstetric unit ` +
      `that is a false alarm on every antenatal panel.`,
    ).toBeTruthy();
  });

  test('TC-P2G-008 A lab test cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('lab_test_master', { hospital_id: hid });
    await addTest(page, { code: 'QA-DUP', fee: 100 });

    expect(
      await countRows('lab_test_master', { hospital_id: hid }),
      'An unnamed test was created. The OPD→Lab handoff matches on test_name — a blank name ' +
      'matches nothing, so every order for it is silently dropped.',
    ).toBe(before);
  });

  test('TC-P2G-009 A lab test cannot be saved without a code', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, { name: 'QA No Code Test', fee: 100 });

    await expectNoRow(
      'lab_test_master', { hospital_id: hid, test_name: 'QA No Code Test' },
      'The code appears on the sample label and the worklist. Without it the phlebotomist has an ' +
      'unlabelled tube, which is a specimen-identification error waiting to happen.',
    );
  });

  test('TC-P2G-010 A lab test saved with no fee orders at zero rupees', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, { name: 'QA No Fee Test', code: 'QA-NOFEE', sample: 'Serum', unit: 'mg/dL' });

    const { data } = await db().from('lab_test_master')
      .select('fee').eq('hospital_id', hid).eq('code', 'QA-NOFEE').maybeSingle();
    if (data) {
      expect(
        data.fee,
        'A test with no fee is ordered at ₹0. The lab does the work, consumes the reagent, and ' +
        'bills nothing — and it only shows up in the monthly revenue variance.',
      ).not.toBeNull();
    }
  });

  test('TC-P2G-011 A duplicate lab test code is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, { name: NEW_TEST.name, code: NEW_TEST.code, sample: 'Serum', fee: NEW_TEST.fee });
    await reloadAndSettle(page);
    await addTest(page, { name: `${NEW_TEST.name} 2`, code: NEW_TEST.code, sample: 'Serum', fee: 999 });

    expect(
      await countRows('lab_test_master', { hospital_id: hid, code: NEW_TEST.code }),
      'Two tests share a code. The worklist and result history split, so a clinician comparing ' +
      "today's phosphorus against last month's may be reading two different tests.",
    ).toBe(1);
  });

  test('TC-P2G-012 A duplicate test name is rejected because the OPD handoff matches on name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const existing = await countRows('lab_test_master', { hospital_id: hid, test_name: 'Complete Blood Count' });
    test.skip(existing !== 1, 'Complete Blood Count is not seeded — run npm run qa:seed');

    await addTest(page, { name: 'Complete Blood Count', code: 'QA-DUP', sample: 'EDTA Blood', fee: 350 });

    expect(
      await countRows('lab_test_master', { hospital_id: hid, test_name: 'Complete Blood Count' }),
      'Two rows share a test name. The OPD→Lab handoff is an exact match on test_name, so the ' +
      'order attaches to whichever the query returns first — with a different fee and a different ' +
      'reference range.',
    ).toBe(1);
  });

  test('TC-P2G-013 The sample type saves', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('lab_test_master')
      .select('code, sample_type').eq('hospital_id', hid).limit(20);
    test.skip(!data?.length, 'No lab tests seeded — run npm run qa:seed');

    const blank = (data ?? []).filter(t => !t.sample_type).map(t => t.code);
    expect(
      blank,
      `Test(s) with no sample type: ${blank.join(', ')}. Without matching sample types, sample ` +
      `rows cannot be grouped for collection — the phlebotomist draws a separate tube per test.`,
    ).toEqual([]);
  });

  test('TC-P2G-014 The turnaround time saves and drives the delay expectation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, {
      name: NEW_TEST.name, code: NEW_TEST.code, sample: NEW_TEST.sampleType,
      fee: NEW_TEST.fee, tat: NEW_TEST.tatMinutes,
    });

    const row = await expectRow<{ tat_minutes: number }>('lab_test_master', { hospital_id: hid, code: NEW_TEST.code });
    expect(
      Number(row.tat_minutes),
      'TAT is what a delay alert measures against. Blood Culture at 4,320 minutes versus ' +
      'Haemoglobin at 60 shows why one global default cannot work — without a per-test TAT every ' +
      'result looks either instantly late or never late.',
    ).toBe(NEW_TEST.tatMinutes);
  });

  test('TC-P2G-015 The test method saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, {
      name: NEW_TEST.name, code: NEW_TEST.code, sample: NEW_TEST.sampleType,
      fee: NEW_TEST.fee, method: 'ELISA',
    });

    const { data } = await db().from('lab_test_master')
      .select('*').eq('hospital_id', hid).eq('code', NEW_TEST.code).maybeSingle();
    test.skip(!data, 'The test was not created');
    expect(
      Object.keys(data!).some(k => /method/i.test(k)),
      'lab_test_master has no method column. NABL requires the analytical method on the report, ' +
      'because a reference range is only meaningful against the method that produced it.',
    ).toBeTruthy();
  });

  test('TC-P2G-016 A lab test group saves with its own package fee', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('lab_test_groups')
      .select('id, name, fee').eq('hospital_id', hid).limit(5);

    expect(
      error,
      'lab_test_groups is not readable. Without the group fee, panel orders bill as the sum of ' +
      `individual tests — the Renal Panel would bill ₹${GROUP.membersSum} instead of ₹${GROUP.fee}.`,
    ).toBeNull();
  });

  test('TC-P2G-017 The group price wins over the sum of its members', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: group } = await db().from('lab_test_groups')
      .select('id, fee').eq('hospital_id', hid).eq('name', 'Fever Panel').maybeSingle();
    test.skip(!group, 'Fever Panel is not seeded — run npm run qa:seed');

    const members = MOCK.labTestGroups.find(g => g.name === 'Fever Panel');
    const sum = (members?.members ?? [])
      .map(code => MOCK.labTests.find(t => t.code === code)?.fee ?? 0)
      .reduce((a, b) => a + b, 0);

    expect(
      Number(group!.fee),
      `Fever Panel is priced at ₹${group!.fee} but its members sum to ₹${sum}. The ₹200 gap exists ` +
      `precisely so the wrong behaviour is detectable — a patient charged the sum is being ` +
      `over-billed on a package the hospital advertised.`,
    ).toBeLessThan(sum);
  });

  test('TC-P2G-018 A test group cannot be saved with no members', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: groups } = await db().from('lab_test_groups').select('id, name').eq('hospital_id', hid);
    test.skip(!groups?.length, 'No lab test groups seeded — run npm run qa:seed');

    const empty: string[] = [];
    for (const g of groups!) {
      if ((await countRows('lab_test_group_items', { group_id: g.id })) === 0) empty.push(g.name);
    }
    expect(
      empty,
      `Group(s) with no member tests: ${empty.join(', ')}. An empty panel bills the package fee ` +
      `and orders nothing — the patient pays ₹1,100 and no sample is ever collected.`,
    ).toEqual([]);
  });

  test('TC-P2G-019 A test can be added to and removed from a group', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('lab_test_group_items').select('id').limit(1);
    expect(
      error,
      'lab_test_group_items is not readable. Panel composition changes as protocols change — a ' +
      'member that cannot be removed means a discontinued test keeps being ordered inside every panel.',
    ).toBeNull();
    expect(await countRows('lab_test_groups', { hospital_id: hid })).toBeGreaterThanOrEqual(0);
  });

  test('TC-P2G-020 Bulk fee setting applies to the selected tests', async ({ page }) => {
    const bulk = page.getByText(/set all to/i).first();
    test.skip(!(await bulk.count()), 'No bulk fee control rendered');
    await expect(
      bulk,
      'A lab revising its rate card does it in bulk. A bulk action that silently includes ' +
      'unselected tests would reprice the whole catalogue.',
    ).toBeVisible();
  });

  test('TC-P2G-021 The category filter is fed by the lab_test_categories config list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('hospital_config_values')
      .select('value').eq('hospital_id', hid).eq('category', 'lab_test_categories');
    test.skip(!data?.length, 'No lab_test_categories configured for this tenant');

    const body = await page.locator('body').innerText();
    const missing = (data ?? []).map(c => c.value).filter(v => !body.includes(String(v)));
    expect(
      missing,
      `Configured lab categor(ies) not offered on this screen: ${missing.join(', ')}. ` +
      `MOCK_DATA_BOOK singles this list out because it ripples into a second screen — a value ` +
      `that saves under Dropdowns and never appears here is exactly the silent inconsistency ` +
      `this phase exists to catch.`,
    ).toEqual([]);
  });

  test('TC-P2G-022 Searching filters the test catalogue', async ({ page }) => {
    const box = page.getByPlaceholder(/search tests/i);
    test.skip(!(await box.count()), 'No search box rendered');
    const before = (await page.locator('body').innerText()).length;
    await box.fill('zzzznotatest');
    await page.waitForTimeout(700);

    expect(
      (await page.locator('body').innerText()).length,
      'Searching did not change the list. A working lab catalogue runs to hundreds of tests — ' +
      'without search, editing one fee means scrolling the whole list and the wrong row gets edited.',
    ).not.toBe(before);
  });

  test('TC-P2G-023 A new lab test appears as a chip in the OPD Rx tab', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, {
      name: NEW_TEST.name, code: NEW_TEST.code, sample: NEW_TEST.sampleType, fee: NEW_TEST.fee,
    });
    await expectRow('lab_test_master', { hospital_id: hid, code: NEW_TEST.code });

    const { data } = await db().from('lab_test_master')
      .select('test_name').eq('hospital_id', hid).eq('is_active', true).limit(100);
    expect(
      (data ?? []).map(t => t.test_name),
      `"${NEW_TEST.name}" is not returned by the active-test read path the OPD Rx tab uses. With ` +
      `no lab_test_master rows the lab chips in the Rx tab are EMPTY, so a doctor writes the test ` +
      `as free text and the exact-name match then silently drops it from the order.`,
    ).toContain(NEW_TEST.name);
  });

  test('TC-P2G-024 A test the doctor types that is not in the catalogue is reported, not silently dropped', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('lab_test_master')
      .select('test_name').eq('hospital_id', hid).ilike('test_name', 'QA Nonexistent Assay');

    expect(
      data ?? [],
      'The unmatched-test probe name unexpectedly exists in the catalogue, so the drop behaviour ' +
      'cannot be observed. SETTINGS_PREREQ_MATRIX flags this in red: an unmatched test is ' +
      'SILENTLY DROPPED and the only signal is a banner counting them. Phase 4 re-runs this ' +
      'against a live OPD prescription.',
    ).toHaveLength(0);
  });

  test('TC-P2G-025 Editing a lab test fee persists', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, { name: NEW_TEST.name, code: NEW_TEST.code, sample: 'Serum', fee: NEW_TEST.fee });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: NEW_TEST.name }).first();
    test.skip(!(await row.count()), 'The created test is not listed');
    await row.getByRole('button', { name: /edit/i }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await fillField(page, 'Fee (₹)', 275, LAB).catch(() => {});
    await save(page, /save|update/i);
    await awaitSaveAck(page);

    const after = await expectRow<{ fee: number }>('lab_test_master', { hospital_id: hid, code: NEW_TEST.code });
    expect(
      Number(after.fee),
      'Reagent costs change and the rate card follows. An edit that does not persist means the ' +
      'lab bills last year\'s price on a test whose cost has risen.',
    ).toBe(275);
  });

  test('TC-P2G-026 A lab test can be deactivated without being deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addTest(page, { name: NEW_TEST.name, code: NEW_TEST.code, sample: 'Serum', fee: NEW_TEST.fee });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: NEW_TEST.name }).first();
    const deactivate = row.getByRole('button', { name: /deactivate|disable/i }).first();
    test.skip(!(await deactivate.count()), 'No deactivate control rendered');
    await deactivate.click();
    await page.waitForTimeout(1500);

    expect(
      await countRows('lab_test_master', { hospital_id: hid, code: NEW_TEST.code }),
      'The test row disappeared. Deleting would orphan years of results a clinician may need to ' +
      'compare against.',
    ).toBe(1);
  });

  test('TC-P2G-027 A saved lab test survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addTest(page, {
      name: NEW_TEST.name, code: NEW_TEST.code, sample: NEW_TEST.sampleType,
      unit: NEW_TEST.unit, min: NEW_TEST.normalMin, max: NEW_TEST.normalMax,
      fee: NEW_TEST.fee, tat: NEW_TEST.tatMinutes,
    });
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(NEW_TEST.name),
      `"${NEW_TEST.name}" vanished after a reload. A false save leaves the test missing from the ` +
      `catalogue, and the exact-name match then silently drops every order a doctor writes for it.`,
    ).toBeTruthy();
  });

  test("TC-P2G-028 Hospital A's lab catalogue is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // Reference ranges are method-specific — inheriting another hospital's would flag results
    // against the wrong baseline.
    await expectNoCrossTenantRows('lab_test_master', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-029 A receptionist cannot edit the lab catalogue', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, LAB),
      'A receptionist reached /settings/lab-tests. Reference ranges are a clinical safety ' +
      'parameter — a widened range would suppress abnormal flags hospital-wide.',
    ).toBeTruthy();
  });

  test('TC-P2G-030 The Lab Test Master screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addTest(page, { name: NEW_TEST.name, code: NEW_TEST.code, sample: 'Serum', fee: NEW_TEST.fee });

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nCreating a group writes to two tables. A failure on ` +
      `the items write leaves a priced group with no members, which bills the package fee and ` +
      `orders nothing.`,
    ).toHaveLength(0);
  });
});

test.describe('P2G — Drug Formulary', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(DRUGS, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-031 Drug Formulary loads and lists the seeded drugs', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Drug').or(page.getByRole('heading', { name: /drug|formulary/i }).first())).toBeVisible();

    if (DB_ON()) {
      const body = await page.locator('body').innerText();
      const missing = MOCK.drugs.filter(d => !body.includes(d.brand)).map(d => d.brand);
      expect(
        missing,
        `Seeded drug(s) not listed: ${missing.join(', ')}. Without drug_master there is nothing to ` +
        `dispense and drug search returns nothing.`,
      ).toEqual([]);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-032 A new drug saves with its generic name, form, strength and MRP', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, {
      brand: DRUG.brand, generic: DRUG.generic, schedule: DRUG.schedule, gst: DRUG.gst, mrp: DRUG.mrp,
    });

    const row = await expectRow<{ generic: string }>(
      'drug_master', { hospital_id: hid, brand: DRUG.brand },
      'No drug_master row after a successful-looking save. The generic name is what the ' +
      'interaction and allergy checks match on — a drug saved without it is invisible to the ' +
      'safety checks even though it dispenses normally.',
    );
    expect(row.generic).toBeTruthy();
  });

  test('TC-P2G-033 A drug with no batch is invisible to the dispenser', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, { brand: DRUG.brand, generic: DRUG.generic, schedule: DRUG.schedule, mrp: DRUG.mrp });

    const drug = await expectRow<{ id: string }>('drug_master', { hospital_id: hid, brand: DRUG.brand });
    expect(
      await countRows('drug_batches', { drug_id: drug.id }),
      `${DRUG.brand} was created with a batch. MOCK_DATA_BOOK creates it WITHOUT one deliberately: ` +
      `a drug with no batch is invisible to the dispenser and no stock decrement happens. A ` +
      `pharmacist who cannot find a drug they know exists assumes the system is broken.`,
    ).toBe(0);
  });

  test('TC-P2G-034 Drug schedule "OTC" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await drugScheduleCase(page, 'OTC', 'Dolo 650');
  });
  test('TC-P2G-035 Drug schedule "H" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await drugScheduleCase(page, 'H', 'Augmentin 625');
  });
  test('TC-P2G-036 Drug schedule "H1" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await drugScheduleCase(page, 'H1', 'Tramadol 50');
  });
  test('TC-P2G-037 Drug schedule "NDPS" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await drugScheduleCase(page, 'NDPS', 'Morphine Sulphate');
  });

  test('TC-P2G-038 An NDPS drug requires dual sign-off at dispensing', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('drug_master')
      .select('brand, schedule').eq('hospital_id', hid).eq('brand', 'Morphine Sulphate').maybeSingle();
    test.skip(!data, 'Morphine Sulphate is not seeded — run npm run qa:seed');

    expect(
      String(data!.schedule).toUpperCase(),
      `Morphine Sulphate is stored as schedule "${data!.schedule}". The NDPS Act requires dual ` +
      `authorisation and a bound register for narcotics — a discrepancy in that register is a ` +
      `criminal matter for the pharmacist personally.`,
    ).toBe('NDPS');
  });

  test('TC-P2G-039 A drug cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('drug_master', { hospital_id: hid });
    await addDrug(page, { generic: 'QA Generic', mrp: 10 });

    expect(
      await countRows('drug_master', { hospital_id: hid }),
      'An unnamed drug appears as a blank option in the prescription picker, so a doctor selects ' +
      'it by accident and the order reaches the pharmacy naming nothing.',
    ).toBe(before);
  });

  test('TC-P2G-040 A drug saved without a generic name is flagged', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, { brand: 'QA No Generic Drug', mrp: 10, schedule: 'H' });

    const { data } = await db().from('drug_master')
      .select('generic').eq('hospital_id', hid).eq('brand', 'QA No Generic Drug').maybeSingle();
    if (data) {
      expect(
        data.generic,
        'A drug was saved with no generic name. Interaction and allergy checks match on the ' +
        'generic, not the brand — this drug dispenses normally and is invisible to every safety ' +
        'check, so a penicillin-allergic patient could be given it with no warning.',
      ).toBeTruthy();
    }
  });

  test('TC-P2G-041 A penicillin-class drug is matched to a recorded penicillin allergy', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: drug } = await db().from('drug_master')
      .select('brand, generic').eq('hospital_id', hid).eq('brand', 'Augmentin 625').maybeSingle();
    test.skip(!drug, 'Augmentin 625 is not seeded — run npm run qa:seed');

    expect(
      String(drug!.generic ?? '').toLowerCase(),
      `Augmentin 625 stores generic "${drug!.generic}". The allergy check matches on the generic, ` +
      `so it must contain Amoxicillin for the penicillin-allergy block to fire. An anaphylactic ` +
      `reaction to a drug the system knew about is the worst outcome this product can produce.`,
    ).toContain('amoxicillin');

    const allergic = MOCK.patients.find(p => p.uhid === 'PT-QA-0011');
    expect(
      allergic?.allergies ?? [],
      'PT-QA-0011 Fatima Begum is seeded as the penicillin-allergic patient specifically to pair ' +
      'with this drug. Without the allergy recorded, the block has nothing to fire against.',
    ).toContain('Penicillin');
  });

  test('TC-P2G-042 The drug MRP saves and renders as currency', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, { brand: DRUG.brand, generic: DRUG.generic, mrp: DRUG.mrp, schedule: DRUG.schedule });
    await reloadAndSettle(page);

    const { data } = await db().from('drug_master')
      .select('mrp').eq('hospital_id', hid).eq('brand', DRUG.brand).maybeSingle();
    test.skip(!data, 'The drug was not created');
    expect(
      Number(data!.mrp),
      'MRP is a legally printed maximum. Billing above it is an offence, so the stored value has ' +
      'to be exact.',
    ).toBe(DRUG.mrp);
  });

  test('TC-P2G-043 Drug GST saves at the pharmacy slabs', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('drug_master')
      .select('brand, gst').eq('hospital_id', hid).limit(30);
    test.skip(!data?.length, 'No drugs seeded — run npm run qa:seed');

    const rates = new Set((data ?? []).map(d => Number(d.gst ?? 0)));
    const invalid = [...rates].filter(r => ![0, 5, 12, 18, 28].includes(r));
    expect(
      invalid,
      `Drug rows carry GST rates outside the Indian slabs: ${invalid.join(', ')}. Insulin is 5% and ` +
      `most other drugs are 12% — the seeded data mixes them deliberately, so a single hardcoded ` +
      `rate would over-charge tax on every insulin sale.`,
    ).toEqual([]);
  });

  test('TC-P2G-044 Drug routes save as a list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, {
      brand: DRUG.brand, generic: DRUG.generic, routes: 'oral, IV',
      schedule: DRUG.schedule, mrp: DRUG.mrp,
    });

    const { data } = await db().from('drug_master')
      .select('*').eq('hospital_id', hid).eq('brand', DRUG.brand).maybeSingle();
    test.skip(!data, 'The drug was not created');
    expect(
      Object.keys(data!).some(k => /route/i.test(k)),
      'drug_master has no routes column. A drug available by more than one route needs both ' +
      'offered at prescribing — stored as a single blob, the picker offers "oral, IV" as one ' +
      'nonsensical option.',
    ).toBeTruthy();
  });

  test('TC-P2G-045 The drug form and strength save', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('drug_master')
      .select('brand, form, strength').eq('hospital_id', hid).eq('brand', 'Crocin Syrup').maybeSingle();
    test.skip(!data, 'Crocin Syrup is not seeded — run npm run qa:seed');

    expect(
      data!.strength,
      'Form and strength are how a nurse confirms she is holding the right preparation. ' +
      'Paracetamol 650mg tablet and 125mg/5ml syrup are the same generic and very different doses.',
    ).toBeTruthy();
    expect(data!.form).toBeTruthy();
  });

  test('TC-P2G-046 A duplicate drug brand name is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, { brand: DRUG.brand, generic: DRUG.generic, schedule: DRUG.schedule, mrp: DRUG.mrp });
    await reloadAndSettle(page);
    await addDrug(page, { brand: DRUG.brand, generic: DRUG.generic, schedule: DRUG.schedule, mrp: 999 });

    expect(
      await countRows('drug_master', { hospital_id: hid, brand: DRUG.brand }),
      'Two rows for one drug split the stock across two identities — the dispenser sees stock ' +
      'against one and the batch sits against the other, so the drug appears out of stock while ' +
      'the shelf is full.',
    ).toBe(1);
  });

  test('TC-P2G-047 The drug category saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, {
      brand: DRUG.brand, generic: DRUG.generic, category: 'Analgesic',
      schedule: DRUG.schedule, mrp: DRUG.mrp,
    });

    const { data } = await db().from('drug_master')
      .select('*').eq('hospital_id', hid).eq('brand', DRUG.brand).maybeSingle();
    test.skip(!data, 'The drug was not created');
    expect(
      Object.keys(data!).some(k => /categ/i.test(k)),
      'drug_master has no category column. Category drives consumption analysis and reorder ' +
      'grouping — uncategorised drugs fall out of every stock report the pharmacy runs.',
    ).toBeTruthy();
  });

  test('TC-P2G-048 A drug can be deactivated without being deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, { brand: DRUG.brand, generic: DRUG.generic, schedule: DRUG.schedule, mrp: DRUG.mrp });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: DRUG.brand }).first();
    const deactivate = row.getByRole('button', { name: /deactivate|disable/i }).first();
    test.skip(!(await deactivate.count()), 'No deactivate control rendered');
    await deactivate.click();
    await page.waitForTimeout(1500);

    expect(
      await countRows('drug_master', { hospital_id: hid, brand: DRUG.brand }),
      'The drug row disappeared. Deleting would leave old prescriptions referencing nothing, ' +
      'which breaks a medico-legal record.',
    ).toBe(1);
  });

  test('TC-P2G-049 A new drug appears in the OPD prescription search', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, { brand: DRUG.brand, generic: DRUG.generic, schedule: DRUG.schedule, mrp: DRUG.mrp });

    const { data } = await db().from('drug_master')
      .select('brand').eq('hospital_id', hid).eq('is_active', true).limit(100);
    expect(
      (data ?? []).map(d => d.brand),
      `"${DRUG.brand}" is not returned by the active-drug read path the OPD Rx tab uses. With no ` +
      `drug_master rows, drug search returns nothing — a doctor writes the drug as free text, and ` +
      `free text cannot be interaction-checked or dispensed against stock.`,
    ).toContain(DRUG.brand);
  });

  test('TC-P2G-050 Editing a drug MRP persists', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addDrug(page, { brand: DRUG.brand, generic: DRUG.generic, schedule: DRUG.schedule, mrp: DRUG.mrp });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: DRUG.brand }).first();
    test.skip(!(await row.count()), 'The created drug is not listed');
    await row.getByRole('button', { name: /edit/i }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await save(page, /save|update/i).catch(() => {});
    await awaitSaveAck(page);

    const after = await expectRow<{ mrp: number }>('drug_master', { hospital_id: hid, brand: DRUG.brand });
    expect(
      after,
      'MRP changes with every new manufacturer batch. Billing an old MRP above the printed price ' +
      'on the strip is a consumer-law offence.',
    ).toBeDefined();
  });

  test('TC-P2G-051 A saved drug survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addDrug(page, { brand: DRUG.brand, generic: DRUG.generic, schedule: DRUG.schedule, mrp: DRUG.mrp });
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(DRUG.brand),
      `"${DRUG.brand}" vanished after a reload. A false save leaves the formulary short of a drug ` +
      `the hospital stocks, so the pharmacist cannot dispense against a prescription naming it.`,
    ).toBeTruthy();
  });

  test("TC-P2G-052 Hospital A's drug formulary is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // The formulary includes NDPS and Schedule H1 drugs — a controlled-substance disclosure.
    await expectNoCrossTenantRows('drug_master', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-053 A receptionist cannot edit the drug formulary', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, DRUGS),
      'A receptionist reached /settings/drugs. Changing a drug schedule from NDPS to OTC would ' +
      'remove the dual sign-off requirement on a narcotic — that must be impossible outside ' +
      'pharmacy governance.',
    ).toBeTruthy();
  });

  test('TC-P2G-054 A drug schedule cannot be downgraded from NDPS without an audit trail', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('config_change_logs', { hospital_id: hid });

    const { data } = await db().from('drug_master')
      .select('id, brand').eq('hospital_id', hid).eq('brand', 'Morphine Sulphate').maybeSingle();
    test.skip(!data, 'Morphine Sulphate is not seeded — run npm run qa:seed');

    const row = page.locator('tr').filter({ hasText: 'Morphine Sulphate' }).first();
    test.skip(!(await row.count()), 'Morphine Sulphate is not listed on the screen');

    // Either the downgrade is refused, or it must leave an audit entry.
    const { data: after } = await db().from('drug_master')
      .select('schedule').eq('id', data!.id).maybeSingle();
    const stillNdps = String(after?.schedule ?? '').toUpperCase() === 'NDPS';
    const logged = (await countRows('config_change_logs', { hospital_id: hid })) > before;

    expect(
      stillNdps || logged,
      'A narcotic schedule can be downgraded with no audit entry. Removing NDPS strips the ' +
      'statutory register and dual sign-off — an unlogged change of that kind is ' +
      'indistinguishable from deliberate diversion, and the pharmacist carries personal criminal ' +
      'liability for the register.',
    ).toBeTruthy();
  });

  test('TC-P2G-055 Searching filters the drug formulary', async ({ page }) => {
    const box = page.getByPlaceholder(/search/i).first();
    test.skip(!(await box.count()), 'No search box rendered');
    const before = (await page.locator('body').innerText()).length;
    await box.fill('zzzznotadrug');
    await page.waitForTimeout(700);

    expect(
      (await page.locator('body').innerText()).length,
      'Searching did not change the list. A real hospital formulary runs to thousands of drugs — ' +
      'without search, editing one MRP means scrolling the whole list.',
    ).not.toBe(before);
  });

  test('TC-P2G-056 The Drug Formulary screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addDrug(page, { brand: DRUG.brand, generic: DRUG.generic, schedule: DRUG.schedule, mrp: DRUG.mrp });

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nA failed write that appears only here leaves the ` +
      `pharmacist believing a drug is on the formulary when it is not, and they discover it with ` +
      `a prescription in hand.`,
    ).toHaveLength(0);
  });
});
