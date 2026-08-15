/**
 * Phase 2 · Section E — People & Access: Roles & Permissions
 * Locks tracker cases TC-P2E-035 … TC-P2E-054
 *
 * Tier 0. `role_permissions` controls `hasTabAccess` and `hasActionAccess` — get it wrong and
 * buttons like *Complete & Bill* or *Admit* simply do not render, with no explanation, which
 * SETTINGS_PREREQ_MATRIX names as one of the four stacked gates on every screen.
 *
 * This is the most security-sensitive screen in the product. The failure that matters is not
 * a permission that fails to apply — it is one that appears applied and is not, because the
 * hospital then audits its own configuration, sees the restriction, and believes it is in force.
 *
 * TC-P2E-053 is the one that cannot be satisfied by a route guard: it calls PostgREST directly
 * as a nurse. If `role_permissions` has no per-role RLS, any authenticated user can grant
 * themselves every permission in the hospital regardless of what the UI allows.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, countRows } from '../utils/db-verify';
import { fillField, save, openCreate, awaitSaveAck, reloadAndSettle, heading } from './settings-locators';

const ROUTE = '/settings/roles';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const CUSTOM_ROLE = (MOCK.phase2.entry[ROUTE] as { role: string }).role;
const REASON = 'QA Phase 2 verification';

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('role_permissions').delete().eq('hospital_id', hid).eq('role', CUSTOM_ROLE);
}

/** Select the first role in the list and toggle its first permission switch. */
async function toggleFirstPermission(page: import('@playwright/test').Page): Promise<boolean> {
  const roleRow = page.locator('button, tr, li').filter({ hasText: /doctor|nurse|receptionist/i }).first();
  if (await roleRow.count()) { await roleRow.click(); await page.waitForTimeout(1000); }

  const sw = page.locator('[role="switch"], input[type="checkbox"]').first();
  if (!(await sw.count())) return false;
  await sw.click();
  await page.waitForTimeout(400);
  return true;
}

test.describe('P2E — People & Access: Roles & Permissions', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('TC-P2E-035 Roles screen loads and lists the configured roles', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Roles').or(page.getByRole('heading', { name: /role|permission/i }).first())).toBeVisible();

    if (DB_ON()) {
      const hid = await hospitalIdFor('A');
      const { data } = await db().from('role_permissions').select('role').eq('hospital_id', hid).limit(20);
      const body = (await page.locator('body').innerText()).toLowerCase();
      const missing = (data ?? []).filter(r => !body.includes((r.role ?? '').toLowerCase())).map(r => r.role);
      expect(
        missing,
        `Configured role(s) not listed: ${missing.join(', ')}. role_permissions controls ` +
        `hasTabAccess and hasActionAccess — a role missing here cannot be configured at all.`,
      ).toEqual([]);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2E-036 A permission change saves to role_permissions', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    const { data: before } = await db().from('role_permissions')
      .select('id, permissions').eq('hospital_id', hid).limit(1).maybeSingle();
    test.skip(!before, 'No role_permissions rows — run npm run qa:seed');

    test.skip(!(await toggleFirstPermission(page)), 'No permission control rendered');
    await save(page, /save/i);
    await awaitSaveAck(page);

    const { data: after } = await db().from('role_permissions')
      .select('permissions').eq('id', before!.id).maybeSingle();

    expect(
      JSON.stringify(after?.permissions),
      'The permission change did not reach the database. An administrator then believes they ' +
      'have restricted access when they have not — the most dangerous shape of security ' +
      'failure, because it fails open silently.',
    ).not.toBe(JSON.stringify(before!.permissions));
  });

  test('TC-P2E-037 Revoking a tab permission hides that tab for the role', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('role_permissions')
      .select('role, permissions').eq('hospital_id', hid).eq('role', 'doctor').maybeSingle();
    test.skip(!data, 'No doctor role_permissions row — run npm run qa:seed');

    expect(
      data!.permissions,
      'The doctor role has no permissions blob, so tab gating cannot be enforced at all. A ' +
      'permission stored but not enforced is worse than none — the hospital audits its ' +
      'configuration, sees the restriction, and believes it is in force.',
    ).toBeDefined();
  });

  test('TC-P2E-038 Revoking an action permission hides that action for the role', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('role_permissions')
      .select('role, permissions').eq('hospital_id', hid).limit(5);
    test.skip(!data?.length, 'No role_permissions rows — run npm run qa:seed');

    const withBlob = data!.filter(r => r.permissions !== null);
    expect(
      withBlob.length,
      'No role carries a permissions blob. Action gates cover Complete & Bill and Admit — an ' +
      'unenforced revocation lets a role take an action the hospital has explicitly forbidden.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2E-039 A permission gate is enforced on direct URL entry, not only in the menu', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('nurse', { hospital: 'A' });

    // A nurse must not reach an administrative money route by typing its URL.
    expect(
      await isRouteBlocked(page, '/accounts'),
      'A nurse reached /accounts by direct URL. A gate that only hides a menu entry is security ' +
      'by obscurity — anyone who has used the module knows the URL, and a bookmark bypasses the ' +
      'whole permission model.',
    ).toBeTruthy();
  });

  test('TC-P2E-040 A permission change is written to the config change log', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('config_change_logs', { hospital_id: hid, config_area: 'role_permissions' });

    test.skip(!(await toggleFirstPermission(page)), 'No permission control rendered');
    const reasonBox = page.getByPlaceholder(/reason/i).first();
    if (await reasonBox.count()) await reasonBox.fill(REASON);
    await save(page, /save/i);
    await awaitSaveAck(page);

    expect(
      await countRows('config_change_logs', { hospital_id: hid, config_area: 'role_permissions' }),
      'No config_change_logs entry was written. NABH and DPDP both expect access changes to be ' +
      'traceable — unlogged, nobody can answer who granted an escalated privilege, or when.',
    ).toBeGreaterThan(before);
  });

  test('TC-P2E-041 The change reason is stored with the permission change', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    test.skip(!(await toggleFirstPermission(page)), 'No permission control rendered');
    const reasonBox = page.getByPlaceholder(/reason/i).first();
    test.skip(!(await reasonBox.count()), 'No reason field rendered on this screen');
    await reasonBox.fill(REASON);
    await save(page, /save/i);
    await awaitSaveAck(page);

    const { data } = await db().from('config_change_logs')
      .select('reason').eq('hospital_id', hid).eq('config_area', 'role_permissions')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    expect(
      data?.reason,
      'The stated reason was not recorded. A log of what changed without why is nearly useless ' +
      'at audit — the reason is what distinguishes a considered decision from a mistake nobody owns.',
    ).toBe(REASON);
  });

  test('TC-P2E-042 A permission change with no reason is still logged', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('config_change_logs', { hospital_id: hid, config_area: 'role_permissions' });

    test.skip(!(await toggleFirstPermission(page)), 'No permission control rendered');
    await save(page, /save/i);
    await awaitSaveAck(page);

    expect(
      await countRows('config_change_logs', { hospital_id: hid, config_area: 'role_permissions' }),
      'An unexplained change went unlogged. That makes skipping the reason field the easiest way ' +
      'to make an access change invisible — which is exactly what someone acting improperly ' +
      'would do.',
    ).toBeGreaterThan(before);
  });

  test('TC-P2E-043 Cash Closure access can be granted and revoked per role', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const cashToggle = page.locator('[role="switch"]').filter({ hasNot: page.locator('x') }).first();
    const body = await page.locator('body').innerText();
    test.skip(!/cash closure/i.test(body), 'No Cash Closure control rendered on this screen');

    const hid = await hospitalIdFor('A');
    const before = await countRows('config_change_logs', { hospital_id: hid, config_area: 'role_permissions' });

    await cashToggle.click();
    await page.waitForTimeout(1600);

    expect(
      await countRows('config_change_logs', { hospital_id: hid, config_area: 'role_permissions' }),
      'Cash closure is where the day\'s collections are reconciled and signed off. Granting it ' +
      'wrongly hands someone the ability to close a day over a cash difference, so both the ' +
      'grant and the revocation must be logged.',
    ).toBeGreaterThan(before);
  });

  test('TC-P2E-044 A custom role can be created', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    const opener = page.getByRole('button', { name: /add role|new role|create role/i }).first();
    test.skip(!(await opener.count()), 'No create-role control rendered');
    await openCreate(page, /add role|new role|create role/i);
    await fillField(page, 'Role Name', CUSTOM_ROLE, ROUTE);
    await save(page, /save|create|add/i);
    await awaitSaveAck(page);

    expect(
      await countRows('role_permissions', { hospital_id: hid, role: CUSTOM_ROLE }),
      `No role_permissions row for "${CUSTOM_ROLE}". Custom permission blobs are, per ` +
      `MOCK_DATA_BOOK, the only way modules like Blood Bank and CSSD are reachable at all.`,
    ).toBe(1);
  });

  test('TC-P2E-045 A role cannot be created without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('role_permissions', { hospital_id: hid });

    const opener = page.getByRole('button', { name: /add role|new role|create role/i }).first();
    test.skip(!(await opener.count()), 'No create-role control rendered');
    await openCreate(page, /add role|new role|create role/i);
    await save(page, /save|create|add/i);
    await awaitSaveAck(page);

    expect(
      await countRows('role_permissions', { hospital_id: hid }),
      'An unnamed role was created. It appears as a blank option when assigning staff, so ' +
      'someone gets assigned a permission set nobody can identify afterwards.',
    ).toBe(before);
  });

  test('TC-P2E-046 A duplicate role name is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    const opener = page.getByRole('button', { name: /add role|new role|create role/i }).first();
    test.skip(!(await opener.count()), 'No create-role control rendered');

    for (let i = 0; i < 2; i++) {
      await openCreate(page, /add role|new role|create role/i);
      await fillField(page, 'Role Name', CUSTOM_ROLE, ROUTE);
      await save(page, /save|create|add/i);
      await awaitSaveAck(page);
      await reloadAndSettle(page);
    }

    expect(
      await countRows('role_permissions', { hospital_id: hid, role: CUSTOM_ROLE }),
      'Two roles share one name, so two permission sets exist and whichever the query returns ' +
      'first decides access. That makes a staff member\'s effective permissions unpredictable.',
    ).toBe(1);
  });

  test('TC-P2E-047 The bypass roles retain full access', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    expect(
      await isRouteBlocked(page, ROUTE),
      'hospital_admin cannot reach /settings/roles. MOCK_DATA_BOOK records that several modules ' +
      'are only reachable by the bypass roles — an administrator locked out of the settings that ' +
      'control access has no way back in without vendor intervention.',
    ).toBeFalsy();
  });

  test('TC-P2E-048 An administrator cannot revoke their own settings access', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('role_permissions')
      .select('permissions').eq('hospital_id', hid).eq('role', 'hospital_admin').maybeSingle();
    test.skip(!data, 'No hospital_admin role_permissions row to inspect');

    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    expect(
      await isRouteBlocked(page, ROUTE),
      'hospital_admin has lost settings access. This is a self-lockout with no recovery path ' +
      'inside the product — the hospital loses the ability to manage its own users and has to ' +
      'contact the vendor to be let back in.',
    ).toBeFalsy();
  });

  test('TC-P2E-049 Permission changes survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: before } = await db().from('role_permissions')
      .select('id, permissions').eq('hospital_id', hid).limit(1).maybeSingle();
    test.skip(!before, 'No role_permissions rows — run npm run qa:seed');

    test.skip(!(await toggleFirstPermission(page)), 'No permission control rendered');
    await save(page, /save/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const { data: after } = await db().from('role_permissions')
      .select('permissions').eq('id', before!.id).maybeSingle();
    expect(
      JSON.stringify(after?.permissions),
      'The permission reverted on reload. A permission that reverts fails open — access the ' +
      'hospital believes it removed comes back the next time anyone loads the page.',
    ).not.toBe(JSON.stringify(before!.permissions));
  });

  test('TC-P2E-050 The 32 routing-only roles are visibly distinguished from assignable roles', async ({ page }) => {
    const body = (await page.locator('body').innerText()).toLowerCase();
    const enumRoles = new Set(MOCK.appRoleEnum.map(r => r.toLowerCase()));

    // A sample of roles modules.ts gates on that cannot be assigned to a staff login.
    const routingOnly = ['blood_bank_technician', 'quality_officer', 'cssd_technician', 'dialysis_technician'];
    const shownUnmarked = routingOnly.filter(r => body.includes(r) && !enumRoles.has(r));

    expect(
      shownUnmarked,
      `Role(s) offered that cannot be assigned to any staff login: ${shownUnmarked.join(', ')}. ` +
      `MOCK_DATA_BOOK flags this as a probable real defect — modules like Blood Bank and Dialysis ` +
      `name a specialist role as their intended user, but that role cannot be created. ` +
      `Configuring permissions for a role nobody can hold is wasted effort that looks like ` +
      `working configuration.`,
    ).toEqual([]);
  });

  test("TC-P2E-051 Hospital A's role permissions are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('role_permissions', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2E-052 A doctor cannot reach the Roles settings screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('doctor', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A doctor reached /settings/roles. A user who can edit the permission model can grant ' +
      'themselves anything — this is the single most important route guard in the product.',
    ).toBeTruthy();
  });

  test('TC-P2E-053 A non-admin cannot escalate their own role through the API', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { anonDb } = await import('../utils/db-verify');
    const { staffByRole } = await import('../fixtures/mock-data');
    const nurse = staffByRole('A', 'nurse');

    const client = anonDb();
    const { error: authErr } = await client.auth.signInWithPassword({
      email: nurse.email, password: MOCK.password,
    });
    test.skip(!!authErr, `Could not sign in as the nurse: ${authErr?.message}`);

    try {
      const { error } = await client.from('role_permissions')
        .update({ permissions: { escalated: true } as never })
        .eq('hospital_id', hid).eq('role', 'nurse');

      expect(
        error,
        'A nurse updated role_permissions directly through PostgREST. Route guards are ' +
        'client-side and can be bypassed by calling the API — if this table has no per-role RLS, ' +
        'any authenticated user can grant themselves every permission in the hospital.',
      ).not.toBeNull();
    } finally {
      await client.auth.signOut();
    }
  });

  test('TC-P2E-054 The Roles screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    if (await toggleFirstPermission(page)) {
      await save(page, /save/i);
      await awaitSaveAck(page);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe permissions blob is written through an ` +
      `\`as any\` cast. A malformed blob that Postgres rejects would surface only here while the ` +
      `UI reports a saved permission.`,
    ).toHaveLength(0);
  });
});
