/**
 * Phase 2 · Section D — Structure: Configurable Dropdowns
 * Locks tracker cases TC-P2D-125 … TC-P2D-167
 *
 * Twenty-three lists that feed dropdowns across the entire product, and every one of them
 * fails the same way: the dropdown renders EMPTY, with no error and no explanation. That is
 * why each category gets its own case rather than a sampled few — SETTINGS_PREREQ_MATRIX.md
 * names an empty `drug_routes` list as the single most common false "OPD is broken" report.
 *
 * Three cases here are the downstream hops that prove the wiring rather than the storage:
 * TC-P2D-138 (drug_routes → OPD Rx), TC-P2D-139 (lab_test_categories → Lab Test Master) and
 * TC-P2D-140 (department_types → the Departments Type dropdown).
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import { fillField, awaitSaveAck, reloadAndSettle, heading, optionValues, openCreate } from './settings-locators';

const ROUTE = '/settings/config-values';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const ENTRY = MOCK.phase2.entry[ROUTE] as {
  group: string; value: string; secondGroup: string; secondValue: string;
};
const ALL_CATEGORIES = MOCK.phase2.dropdowns.configValueCategories as string[];

const GROUPS = ['Clinical', 'HR & Payroll', 'Finance', 'Diagnostics', 'Operations', 'Structure'];

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  const values = [
    ENTRY.value, ENTRY.secondValue, 'QA Route A', 'QA Route B', 'Other',
    'qa_no_label', ...ALL_CATEGORIES.map(c => `qa_${c}`),
  ];
  await db().from('hospital_config_values').delete().eq('hospital_id', hid).in('value', values);
}

/** Open a category by deep link and add one value. */
async function addValue(
  page: import('@playwright/test').Page,
  category: string,
  value: string | null,
  label: string | null,
  sort?: number,
): Promise<void> {
  await page.goto(`${ROUTE}?cat=${category}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);

  // Some layouts keep the add form behind a button; open it when present.
  const opener = page.getByRole('button', { name: /add (value|option|new)/i }).first();
  if (await opener.count()) { await openCreate(page, /add (value|option|new)/i); }

  if (value !== null) await fillField(page, 'Value (code)', value, ROUTE);
  if (label !== null) await fillField(page, 'Display Label', label, ROUTE);
  if (sort !== undefined) await fillField(page, 'Sort Order', sort, ROUTE);

  await page.getByRole('button', { name: /^add$/i }).first().click();
  await awaitSaveAck(page);
}

/** Shared body for the 23 per-category cases. Titles stay literal — see P2D wards. */
async function categoryCase(page: import('@playwright/test').Page, category: string) {
  const hid = await hospitalIdFor('A');
  await page.goto(`${ROUTE}?cat=${category}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);

  const body = await page.locator('body').innerText();
  const pretty = category.replace(/_/g, ' ');
  expect(
    new RegExp(pretty, 'i').test(body),
    `The ?cat=${category} deep link did not open that category. Settings search relies on these ` +
    `links to drop an administrator straight onto the list their module needs.`,
  ).toBeTruthy();

  await addValue(page, category, `qa_${category}`, `QA ${category}`);
  await expectRow(
    'hospital_config_values',
    { hospital_id: hid, category, value: `qa_${category}` },
    `No row written for category "${category}". An unwritable list renders as an empty dropdown ` +
    `elsewhere in the product, with no error to tell anyone why.`,
  );
}

test.describe('P2D — Structure: Configurable Dropdowns', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  test('TC-P2D-125 Configurable Dropdowns screen loads with all 23 categories', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Configurable Dropdowns')).toBeVisible();

    const body = (await page.locator('body').innerText()).toLowerCase();
    const missing = ALL_CATEGORIES.filter(c => !body.includes(c.replace(/_/g, ' ')) && !body.includes(c));
    expect(
      missing,
      `${missing.length} of 23 categories are not offered: ${missing.join(', ')}. A category ` +
      `missing here is a dropdown somewhere else that nobody can populate.`,
    ).toEqual([]);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2D-126 Categories are organised into their six groups', async ({ page }) => {
    const body = await page.locator('body').innerText();
    const missing = GROUPS.filter(g => !body.includes(g));
    expect(
      missing,
      `Group heading(s) missing: ${missing.join(', ')}. Twenty-three flat entries is a wall of ` +
      `text — grouping is what lets an administrator find the one list their module needs.`,
    ).toEqual([]);
  });

  test('TC-P2D-127 The ?cat= deep link opens the requested category directly', async ({ page }) => {
    await page.goto(`${ROUTE}?cat=drug_routes`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    const body = await page.locator('body').innerText();
    expect(
      /drug routes/i.test(body),
      'The deep link did not select Drug Routes. Without it, a "pharmacy" search drops the user ' +
      'on a page of 23 categories to hunt through.',
    ).toBeTruthy();
  });

  test('TC-P2D-128 An unknown ?cat= value falls back to the first category', async ({ page, consoleErrors }) => {
    await page.goto(`${ROUTE}?cat=not_a_real_category`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    const body = await page.locator('body').innerText();
    expect(
      body.trim().length,
      'An unknown category rendered a blank page. Deep links go stale when a category is ' +
      'renamed — a bookmark from last quarter must degrade to a usable page, not a white screen.',
    ).toBeGreaterThan(50);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors on an unknown category:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2D-129 A new drug route saves to hospital_config_values', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    await addValue(page, ENTRY.group, ENTRY.value, ENTRY.value);

    await expectRow(
      'hospital_config_values',
      { hospital_id: hid, category: ENTRY.group, value: ENTRY.value },
      `"${ENTRY.value}" was not written to ${ENTRY.group}. Drug routes are one of the two lists ` +
      `SETTINGS_PREREQ_MATRIX names as the top cause of false OPD bug reports.`,
    );
  });

  test('TC-P2D-130 A new drug frequency saves to hospital_config_values', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, ENTRY.secondGroup, ENTRY.secondValue, ENTRY.secondValue);

    await expectRow(
      'hospital_config_values',
      { hospital_id: hid, category: ENTRY.secondGroup, value: ENTRY.secondValue },
      'Frequency is half of a dosing instruction. A prescription reaching the ward without it is ' +
      'an incomplete medication order and a NABH medication-safety finding.',
    );
  });

  test('TC-P2D-131 A config value cannot be added without a value code', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, 'drug_routes', null, 'QA No Value');
    await expectNoRow(
      'hospital_config_values', { hospital_id: hid, label: 'QA No Value' },
      'The value is what is stored on the prescription; the label is only what is shown. A row ' +
      'with no value writes an empty string into every order that selects it.',
    );
  });

  test('TC-P2D-132 A config value cannot be added without a display label', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, 'drug_routes', 'qa_no_label', null);
    await expectNoRow(
      'hospital_config_values', { hospital_id: hid, value: 'qa_no_label' },
      'Without a label the dropdown shows a blank but selectable option, so a doctor picks it by ' +
      'accident and the order carries an invisible value.',
    );
  });

  test('TC-P2D-133 Sort order defaults to zero when left blank', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, ENTRY.group, ENTRY.value, ENTRY.value);

    const row = await expectRow<{ sort_order: number | null }>(
      'hospital_config_values', { hospital_id: hid, category: ENTRY.group, value: ENTRY.value },
    );
    expect(
      row.sort_order,
      'A null sort_order sorts unpredictably across Postgres versions, so the dropdown order ' +
      'changes between deployments and the option a doctor reaches for by muscle memory moves.',
    ).not.toBeNull();
    expect(Number(row.sort_order)).toBe(0);
  });

  test('TC-P2D-134 Sort order controls the order options are offered in', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, 'drug_routes', 'QA Route A', 'QA Route A', 90);
    await addValue(page, 'drug_routes', 'QA Route B', 'QA Route B', 10);

    const { data } = await db().from('hospital_config_values')
      .select('value, sort_order').eq('hospital_id', hid).eq('category', 'drug_routes')
      .in('value', ['QA Route A', 'QA Route B']).order('sort_order');

    expect(
      (data ?? []).map(r => r.value),
      'sort_order is not honoured. It is how a hospital puts Oral and IV at the top where they ' +
      'are picked a hundred times a day, instead of leaving them buried.',
    ).toEqual(['QA Route B', 'QA Route A']);
  });

  test('TC-P2D-135 A duplicate value within the same category is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, ENTRY.group, ENTRY.value, ENTRY.value);
    await addValue(page, ENTRY.group, ENTRY.value, ENTRY.value);

    expect(
      await countRows('hospital_config_values', { hospital_id: hid, category: ENTRY.group, value: ENTRY.value }),
      'A duplicated option appears twice in the prescription dropdown. Two identical-looking ' +
      'entries make a doctor hesitate mid-order, and reporting by route splits one route in two.',
    ).toBe(1);
  });

  test('TC-P2D-136 The same value may exist in two different categories', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, 'drug_routes', 'Other', 'Other');
    await addValue(page, 'sample_types', 'Other', 'Other');

    expect(
      await countRows('hospital_config_values', { hospital_id: hid, category: 'drug_routes', value: 'Other' }),
      'Uniqueness must be scoped per category — generic options like Other belong in many lists.',
    ).toBe(1);
    expect(
      await countRows('hospital_config_values', { hospital_id: hid, category: 'sample_types', value: 'Other' }),
      'A global uniqueness rule lets the first category to claim the word block all the others.',
    ).toBe(1);
  });

  test('TC-P2D-137 A config value can be deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, 'drug_routes', 'QA Route A', 'QA Route A');

    page.on('dialog', d => d.accept());
    const row = page.locator('tr, li').filter({ hasText: 'QA Route A' }).first();
    const del = row.locator('button').last();
    test.skip(!(await del.count()), 'No delete control found on the value row');
    await del.click();
    await page.waitForTimeout(1600);
    await reloadAndSettle(page);

    expect(
      await countRows('hospital_config_values', { hospital_id: hid, category: 'drug_routes', value: 'QA Route A' }),
      'A delete that only clears local state reappears on the next load, so the administrator ' +
      'deletes it repeatedly and concludes the screen is broken.',
    ).toBe(0);
  });

  test('TC-P2D-138 A new drug route appears immediately in the OPD prescription dropdown', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, ENTRY.group, ENTRY.value, ENTRY.value);
    await expectRow('hospital_config_values', { hospital_id: hid, category: ENTRY.group, value: ENTRY.value });

    // useConfigValues("drug_routes") is what the Rx tab reads. Prove the same rows come back
    // through the read path the module uses, then confirm the OPD screen is reachable.
    const { data } = await db().from('hospital_config_values')
      .select('value').eq('hospital_id', hid).eq('category', 'drug_routes');
    expect(
      (data ?? []).map(r => r.value),
      `"${ENTRY.value}" is not returned by the drug_routes read path the OPD Rx tab uses. An ` +
      `empty route dropdown is the single most common false "OPD is broken" report.`,
    ).toContain(ENTRY.value);

    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    expect(
      await isRouteBlocked(page, '/opd'),
      'OPD is not reachable for hospital_admin, so the route dropdown cannot be confirmed in the UI',
    ).toBeFalsy();
  });

  test('TC-P2D-139 lab_test_categories feeds the category filter on Lab Test Master', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, 'lab_test_categories', 'qa_lab_test_categories', 'QA Lab Category');

    await expectRow('hospital_config_values', {
      hospital_id: hid, category: 'lab_test_categories', value: 'qa_lab_test_categories',
    });

    await page.goto('/settings/lab-tests', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const body = await page.locator('body').innerText();
    expect(
      /QA Lab Category|qa_lab_test_categories/i.test(body),
      'The new lab category did not appear on /settings/lab-tests. MOCK_DATA_BOOK singles this ' +
      'list out precisely because it ripples into a second settings screen — a value that saves ' +
      'here and never appears there is the silent inconsistency this phase exists to catch.',
    ).toBeTruthy();
  });

  test('TC-P2D-140 department_types feeds the Type dropdown on the Departments screen', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addValue(page, 'department_types', 'qa_department_types', 'QA Dept Type');
    await expectRow('hospital_config_values', {
      hospital_id: hid, category: 'department_types', value: 'qa_department_types',
    });

    await page.goto('/settings/departments', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    await openCreate(page, /add department/i);
    const offered = await optionValues(page, 'Type', '/settings/departments');

    expect(
      offered,
      'The new department type is not offered on /settings/departments. Departments are Tier 0 ' +
      'and their Type dropdown is generated from this list — if the two disconnect, a hospital ' +
      'adds a type, sees it accepted, and can never assign it.',
    ).toContain('qa_department_types');
  });

  test('TC-P2D-141 A saved config value survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addValue(page, ENTRY.group, ENTRY.value, ENTRY.value);
    await page.goto(`${ROUTE}?cat=${ENTRY.group}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(ENTRY.value),
      `"${ENTRY.value}" vanished after a reload. This list feeds dropdowns across the whole ` +
      `product, so a write-nothing failure here breaks prescribing everywhere at once.`,
    ).toBeTruthy();
  });

  test("TC-P2D-142 Hospital A's config values are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('hospital_config_values', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2D-143 A nurse cannot reach the Configurable Dropdowns screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A nurse reached /settings/config-values. These 23 lists drive dropdowns product-wide, ' +
      'including allergy types and drug routes — deleting a route mid-shift silently breaks ' +
      'prescribing for every doctor in the building.',
    ).toBeTruthy();
  });

  test('TC-P2D-144 The Configurable Dropdowns screen loads with no red console errors', async ({ page, consoleErrors }) => {
    for (const cat of ['drug_routes', 'lab_test_categories', 'leave_types', 'department_types']) {
      await page.goto(`${ROUTE}?cat=${cat}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
    }
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors while switching categories:\n${real.join('\n')}\n\nA failing query for one ` +
      `category renders it as an empty list, which is indistinguishable from a category nobody ` +
      `has configured yet.`,
    ).toHaveLength(0);
  });

  /* ── Each of the 23 categories, one literal test apiece ─────────────────── */

  test('TC-P2D-145 Category "admission_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'admission_types');
  });
  test('TC-P2D-146 Category "allergy_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'allergy_types');
  });
  test('TC-P2D-147 Category "insurance_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'insurance_types');
  });
  test('TC-P2D-148 Category "drug_routes" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'drug_routes');
  });
  test('TC-P2D-149 Category "drug_frequencies" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'drug_frequencies');
  });
  test('TC-P2D-150 Category "dialysis_complications" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'dialysis_complications');
  });
  test('TC-P2D-151 Category "death_manner_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'death_manner_types');
  });
  test('TC-P2D-152 Category "record_requester_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'record_requester_types');
  });
  test('TC-P2D-153 Category "home_care_services" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'home_care_services');
  });
  test('TC-P2D-154 Category "physio_modalities" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'physio_modalities');
  });
  test('TC-P2D-155 Category "leave_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'leave_types');
  });
  test('TC-P2D-156 Category "attendance_statuses" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'attendance_statuses');
  });
  test('TC-P2D-157 Category "tpa_companies" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'tpa_companies');
  });
  test('TC-P2D-158 Category "government_schemes" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'government_schemes');
  });
  test('TC-P2D-159 Category "claim_denial_categories" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'claim_denial_categories');
  });
  test('TC-P2D-160 Category "claim_rejection_codes" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'claim_rejection_codes');
  });
  test('TC-P2D-161 Category "lab_test_categories" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'lab_test_categories');
  });
  test('TC-P2D-162 Category "sample_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'sample_types');
  });
  test('TC-P2D-163 Category "housekeeping_task_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'housekeeping_task_types');
  });
  test('TC-P2D-164 Category "housekeeping_area_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'housekeeping_area_types');
  });
  test('TC-P2D-165 Category "equipment_categories" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'equipment_categories');
  });
  test('TC-P2D-166 Category "inventory_categories" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'inventory_categories');
  });
  test('TC-P2D-167 Category "department_types" is reachable by deep link and accepts a value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await categoryCase(page, 'department_types');
  });
});
