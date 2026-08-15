/**
 * Phase 2 · Section D — Structure: Departments
 * Locks tracker cases TC-P2D-061 … TC-P2D-084
 *
 * Departments are Tier 0. With none configured, no OPD token can be created and no doctor
 * can be assigned — SETTINGS_PREREQ_MATRIX.md ranks this second only to the hospital profile.
 *
 * The interesting hop here is TC-P2D-070: the Type dropdown is populated from
 * hospital_config_values under `department_types`, so one settings screen feeds another. A
 * hardcoded list would accept a hospital's own department type on the Dropdowns screen and
 * then never offer it here.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import {
  fillField, readField, selectByValue, optionValues, save, openCreate,
  awaitSaveAck, reloadAndSettle, isSaveDisabled, heading,
} from './settings-locators';

const ROUTE = '/settings/departments';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const DEPT = MOCK.phase2.entry[ROUTE] as { name: string; code: string; type: string };
const RENAMED = MOCK.phase2.edit.departmentName as string;

/** Department names this spec creates, removed before and after so re-runs start clean. */
const CREATED = [
  DEPT.name, RENAMED, 'Nephrology Unit 2', 'QA Long Code Dept',
  'QA Type clinical Dept', 'QA Type diagnostic Dept',
  'QA Type support Dept', 'QA Type administrative Dept',
];

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('departments').delete().eq('hospital_id', hid).in('name', CREATED);
}

async function createDepartment(
  page: import('@playwright/test').Page,
  opts: { name: string; type?: string; code?: string },
): Promise<void> {
  await openCreate(page, /add department/i);
  await fillField(page, 'Department Name', opts.name, ROUTE);
  if (opts.type) await selectByValue(page, 'Type', opts.type, { route: ROUTE });
  if (opts.code !== undefined) await fillField(page, 'Department Code', opts.code, ROUTE);
  await save(page, /save department/i);
  await awaitSaveAck(page);
}

/** Shared body for the department-type cases. Titles stay literal — see P2D wards. */
async function deptTypeCase(page: import('@playwright/test').Page, type: string) {
  const hid = await hospitalIdFor('A');
  const name = `QA Type ${type} Dept`;

  const offered = await (async () => {
    await openCreate(page, /add department/i);
    const vals = await optionValues(page, 'Type', ROUTE);
    await page.keyboard.press('Escape');
    return vals;
  })();
  test.skip(
    !offered.includes(type),
    `department_types does not offer "${type}" in this tenant (offered: ${offered.join(', ')}). ` +
    `Configure it under /settings/config-values?cat=department_types first.`,
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await createDepartment(page, { name, type });

  const row = await expectRow<{ type: string }>('departments', { hospital_id: hid, name });
  expect(
    row.type,
    `Department Type "${type}" is offered by the dropdown but stored as "${row.type}".`,
  ).toBe(type);
}

test.describe('P2D — Structure: Departments', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  test('TC-P2D-061 Departments screen loads and lists the ten seeded departments', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Departments')).toBeVisible();
    const body = await page.locator('body').innerText();
    const missing = MOCK.departments.filter(d => !body.includes(d.name)).map(d => d.name);
    expect(
      missing,
      `Seeded department(s) not listed: ${missing.join(', ')}. With no departments, no OPD ` +
      `token can be created and no doctor can be assigned.`,
    ).toEqual([]);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2D-062 Indian English spellings are preserved exactly as entered', async ({ page }) => {
    const body = await page.locator('body').innerText();
    const american = ['Gynecology', 'Pediatrics', 'Orthopedics', 'Anesthesiology'];
    const found = american.filter(w => body.includes(w));
    expect(
      found,
      `US spellings rendered on screen: ${found.join(', ')}. Indian English is the house style ` +
      `and these names print on discharge summaries the patient keeps.`,
    ).toEqual([]);
    expect(body).toContain('Gynaecology');
  });

  test('TC-P2D-063 Add Department opens a drawer with an empty form', async ({ page }) => {
    await openCreate(page, /add department/i);
    expect(
      await readField(page, 'Department Name', ROUTE),
      'The create drawer opened pre-filled with the last edited department.',
    ).toBe('');
    expect(await readField(page, 'Department Code', ROUTE)).toBe('');
  });

  test('TC-P2D-064 A new department saves with the correct hospital_id', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    await createDepartment(page, { name: DEPT.name, type: 'clinical', code: DEPT.code });

    const row = await expectRow<{ dept_code: string; hospital_id: string }>(
      'departments', { hospital_id: hid, name: DEPT.name },
      `No departments row for "${DEPT.name}" after a successful-looking save. A green toast is not a save.`,
    );
    expect(row.dept_code).toBe(DEPT.code);
    expect(row.hospital_id, 'hospital_id is the RLS anchor for every row in the system').toBe(hid);
  });

  test('TC-P2D-065 The department code is upper-cased as it is typed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    await openCreate(page, /add department/i);
    await fillField(page, 'Department Name', DEPT.name, ROUTE);
    await fillField(page, 'Department Code', DEPT.code.toLowerCase(), ROUTE);
    expect(
      await readField(page, 'Department Code', ROUTE),
      'The code was not upper-cased in the field. Codes are the GL cost-centre key and the ' +
      'ledger match is case-sensitive.',
    ).toBe(DEPT.code);

    await save(page, /save department/i);
    await awaitSaveAck(page);
    const row = await expectRow<{ dept_code: string }>('departments', { hospital_id: hid, name: DEPT.name });
    expect(row.dept_code).toBe(DEPT.code);
  });

  test('TC-P2D-066 The department code is capped at ten characters', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createDepartment(page, { name: 'QA Long Code Dept', type: 'clinical', code: 'ABCDEFGHIJKLMNOP' });

    const { data } = await db().from('departments')
      .select('dept_code').eq('hospital_id', hid).eq('name', 'QA Long Code Dept').maybeSingle();
    if (data) {
      expect(
        (data.dept_code ?? '').length,
        `dept_code stored ${data.dept_code?.length} characters. Over-long codes are either ` +
        `truncated — producing two departments that collide on the truncated value — or ` +
        `rejected by Postgres with an error the administrator cannot interpret.`,
      ).toBeLessThanOrEqual(10);
    }
  });

  test('TC-P2D-067 A department cannot be saved without a name', async ({ page }) => {
    await openCreate(page, /add department/i);
    await fillField(page, 'Department Code', 'QAX', ROUTE);
    expect(
      await isSaveDisabled(page, /save department/i),
      'Save Department is enabled with no name. An unnamed department appears as a blank line ' +
      'in the OPD picker and the token is raised against nothing.',
    ).toBeTruthy();
  });

  test('TC-P2D-068 A duplicate department name is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('departments', { hospital_id: hid, name: 'General Medicine' });
    test.skip(before !== 1, 'General Medicine is not seeded — run npm run qa:seed');

    await createDepartment(page, { name: 'General Medicine', type: 'clinical' });

    expect(
      await countRows('departments', { hospital_id: hid, name: 'General Medicine' }),
      'A duplicate "General Medicine" was created. Two departments with one name split a ' +
      'doctor roster and a revenue report in half, and neither half reconciles.',
    ).toBe(1);
  });

  test('TC-P2D-069 A duplicate department code is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createDepartment(page, { name: DEPT.name, type: 'clinical', code: DEPT.code });
    await reloadAndSettle(page);
    await createDepartment(page, { name: 'Nephrology Unit 2', type: 'clinical', code: DEPT.code });

    expect(
      await countRows('departments', { hospital_id: hid, dept_code: DEPT.code }),
      `Two departments share dept_code "${DEPT.code}". The code is the GL cost-centre key — ` +
      `sharing one merges their revenue in the ledger and the month-end split becomes guesswork.`,
    ).toBe(1);
  });

  test('TC-P2D-070 The Type dropdown is fed from the department_types config values list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    const { data: configured, error } = await db().from('hospital_config_values')
      .select('value').eq('hospital_id', hid).eq('category', 'department_types');
    test.skip(!!error, `hospital_config_values not readable: ${error?.message}`);
    test.skip(
      !configured?.length,
      'No department_types configured for this tenant — configure them under ' +
      '/settings/config-values?cat=department_types first.',
    );

    await openCreate(page, /add department/i);
    const offered = await optionValues(page, 'Type', ROUTE);
    const expected = (configured ?? []).map(c => c.value).sort();

    expect(
      offered.sort(),
      `The Type dropdown offers [${offered.join(', ')}] but department_types is configured as ` +
      `[${expected.join(', ')}]. A hardcoded list means a hospital adds its own department type ` +
      `on the Dropdowns screen, sees it accepted, and never sees it offered here.`,
    ).toEqual(expected);
  });

  // department_types values — literal titles, shared body. See the note in P2D wards.
  test('TC-P2D-071 Department Type option "clinical" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await deptTypeCase(page, 'clinical');
  });
  test('TC-P2D-072 Department Type option "diagnostic" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await deptTypeCase(page, 'diagnostic');
  });
  test('TC-P2D-073 Department Type option "support" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await deptTypeCase(page, 'support');
  });
  test('TC-P2D-074 Department Type option "administrative" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await deptTypeCase(page, 'administrative');
  });

  test('TC-P2D-075 A head of department can be assigned from the doctor list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createDepartment(page, { name: DEPT.name, type: 'clinical', code: DEPT.code });
    await reloadAndSettle(page);

    await page.getByRole('button', { name: /^edit$/i }).first().click();
    await page.waitForTimeout(600);

    const heads = await optionValues(page, 'Head of Department', ROUTE);
    const realHead = heads.find(v => v !== '');
    test.skip(!realHead, 'No active doctor exists to assign — run npm run qa:seed');

    await selectByValue(page, 'Head of Department', realHead!, { route: ROUTE });
    await save(page, /save department/i);
    await awaitSaveAck(page);

    const row = await expectRow<{ head_doctor_id: string | null }>(
      'departments', { hospital_id: hid, name: DEPT.name },
    );
    expect(
      row.head_doctor_id,
      'head_doctor_id is unset. The head of department is who escalations route to — unset, ' +
      'they go nowhere and a NABH assessor finds no named clinical owner for the unit.',
    ).not.toBeNull();
  });

  test('TC-P2D-076 The Head of Department list offers only active doctors of this hospital', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    await openCreate(page, /add department/i);
    const offeredIds = (await optionValues(page, 'Head of Department', ROUTE)).filter(Boolean);

    const { data: allowed } = await db().from('users')
      .select('id').eq('hospital_id', hid).eq('role', 'doctor').eq('is_active', true);
    const allowedIds = new Set((allowed ?? []).map(u => u.id));

    const strangers = offeredIds.filter(id => !allowedIds.has(id));
    expect(
      strangers,
      `${strangers.length} option(s) in Head of Department are not active doctors of this ` +
      `hospital. A picker that is not hospital-scoped leaks Hospital B staff names into ` +
      `Hospital A — a cross-tenant disclosure through a dropdown.`,
    ).toEqual([]);
  });

  test('TC-P2D-077 Renaming a department persists the new name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createDepartment(page, { name: DEPT.name, type: 'clinical', code: DEPT.code });
    await reloadAndSettle(page);

    await page.getByRole('button', { name: /^edit$/i }).first().click();
    await page.waitForTimeout(600);
    await fillField(page, 'Department Name', RENAMED, ROUTE);
    await save(page, /save department/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    await expectRow(
      'departments', { hospital_id: hid, name: RENAMED },
      `The rename to "${RENAMED}" did not persist. The old name stays on every token, bill and ` +
      `report while the administrator believes it changed.`,
    );
  });

  test('TC-P2D-078 A department can be deactivated without being deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createDepartment(page, { name: DEPT.name, type: 'clinical', code: DEPT.code });
    await reloadAndSettle(page);

    await page.getByRole('button', { name: /deactivate/i }).first().click();
    await page.waitForTimeout(1500);

    const row = await expectRow<{ is_active: boolean }>(
      'departments', { hospital_id: hid, name: DEPT.name },
      'The department row disappeared. Deactivate must not delete — historical tokens and bills ' +
      'stay attached to it.',
    );
    expect(row.is_active).toBe(false);
  });

  test('TC-P2D-079 A deactivated department can be reactivated', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createDepartment(page, { name: DEPT.name, type: 'clinical', code: DEPT.code });
    await reloadAndSettle(page);

    await page.getByRole('button', { name: /deactivate/i }).first().click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^activate$/i }).first().click();
    await page.waitForTimeout(1500);

    const row = await expectRow<{ is_active: boolean }>('departments', { hospital_id: hid, name: DEPT.name });
    expect(
      row.is_active,
      'A one-way deactivation forces the administrator to create a duplicate when the ' +
      'department reopens, splitting its history in two.',
    ).toBe(true);
  });

  test('TC-P2D-080 Delete is offered only after a department is deactivated', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await createDepartment(page, { name: DEPT.name, type: 'clinical', code: DEPT.code });
    await reloadAndSettle(page);

    const activeRow = page.locator('tr').filter({ hasText: DEPT.name }).first();
    expect(
      await activeRow.locator('button[title="Delete department"]').count(),
      'A delete control is offered on an ACTIVE department. Deactivate-then-delete is a ' +
      'deliberate two-step — removing an in-use department detaches every token and bill ' +
      'pointing at it, with no undo.',
    ).toBe(0);

    await activeRow.getByRole('button', { name: /deactivate/i }).click();
    await page.waitForTimeout(1500);

    const inactiveRow = page.locator('tr').filter({ hasText: DEPT.name }).first();
    expect(await inactiveRow.locator('button[title="Delete department"]').count()).toBeGreaterThan(0);
  });

  test('TC-P2D-081 A department with active staff assigned cannot be deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    const { data: staffed } = await db().from('users')
      .select('department_id').eq('hospital_id', hid).eq('is_active', true)
      .not('department_id', 'is', null).limit(1);
    test.skip(!staffed?.length, 'No active staff has a department assigned — run npm run qa:seed');

    const { data: dept } = await db().from('departments')
      .select('id, name').eq('id', staffed![0].department_id).maybeSingle();
    test.skip(!dept, 'Could not resolve the staffed department');

    const row = page.locator('tr').filter({ hasText: dept!.name }).first();
    const deactivate = row.getByRole('button', { name: /deactivate/i });
    if (await deactivate.count()) { await deactivate.click(); await page.waitForTimeout(1500); }

    page.on('dialog', d => d.accept());
    const del = page.locator('tr').filter({ hasText: dept!.name }).first()
      .locator('button[title="Delete department"]');
    if (await del.count()) { await del.click(); await page.waitForTimeout(1500); }

    expect(
      await countRows('departments', { id: dept!.id }),
      `"${dept!.name}" was deleted while active staff were assigned. users.department_id now ` +
      `points at nothing, so those staff vanish from every department-filtered roster and OPD ` +
      `list while still being able to log in.`,
    ).toBe(1);
  });

  test('TC-P2D-082 Deleting a department asks for confirmation naming the department', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createDepartment(page, { name: DEPT.name, type: 'clinical', code: DEPT.code });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: DEPT.name }).first();
    await row.getByRole('button', { name: /deactivate/i }).click();
    await page.waitForTimeout(1500);

    let promptText = '';
    page.on('dialog', d => { promptText = d.message(); d.dismiss(); });

    const del = page.locator('tr').filter({ hasText: DEPT.name }).first()
      .locator('button[title="Delete department"]');
    test.skip(!(await del.count()), 'Delete control not found on the inactive row');
    await del.click();
    await page.waitForTimeout(800);

    expect(
      promptText,
      'The delete confirmation did not name the department. The control is a small trash icon ' +
      'in a row of text buttons — naming the row is what stops the wrong one being removed.',
    ).toContain(DEPT.name);
    expect(await countRows('departments', { hospital_id: hid, name: DEPT.name })).toBe(1);
  });

  test("TC-P2D-083 Hospital A's departments are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('departments', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2D-084 A receptionist cannot reach the Departments settings screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A receptionist reached /settings/departments. Reception raises tokens against ' +
      'departments but must not rename them — a rename mid-day breaks every report that ' +
      'groups by department.',
    ).toBeTruthy();
  });
});
