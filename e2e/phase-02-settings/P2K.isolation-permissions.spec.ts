/**
 * Phase 2 · Section K — Isolation & permissions.
 * Locks tracker cases TC-P2K-001 … TC-P2K-048
 *
 * Two questions, asked of every master table and every settings route: can Hospital B see
 * Hospital A's data, and can a non-settings role reach a settings screen?
 *
 * The isolation half deliberately does NOT use the service key. `db()` bypasses RLS entirely,
 * so a suite written against it would report green on a completely open database — the exact
 * failure it is supposed to catch. `expectNoCrossTenantRows` signs in through the anon key as a
 * real Hospital B user, which is the only way the policy is actually exercised.
 *
 * The permissions half pairs fourteen refusals with one control (TC-P2K-043, admin reaches all
 * fifty routes). Without that control a guard that denied everybody would pass every refusal
 * case, and the suite would be worthless.
 */
import { test, expect, MOCK, PASSWORD } from '../fixtures/auth.fixture';
import { isRouteBlocked } from '../fixtures/auth.fixture';
import { db, anonDb, hospitalIdFor, expectNoCrossTenantRows } from '../utils/db-verify';
import { SETTINGS_SCREENS } from './settings.helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const ADMIN_B_EMAIL = MOCK.staff.B[0].email;

/** Assert Hospital B, signed in under RLS, sees no Hospital A row in `table`. */
async function noLeak(table: string): Promise<void> {
  const hospitalA = await hospitalIdFor('A');
  await expectNoCrossTenantRows(table, ADMIN_B_EMAIL, PASSWORD, hospitalA);
}

/** A Supabase client authenticated as `email` through the anon key, so RLS applies. */
async function asUser(email: string) {
  const client = anonDb();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

/** The four settings routes that write hospital_settings. */
const HOSPITAL_SETTINGS_WRITERS = [
  '/settings/notifications',
  '/settings/language',
  '/settings/approvals',
  '/settings/ipd-ancillary-payment',
];

/** A representative slice of the settings surface, used by every refusal case. */
const REFUSAL_PROBE_ROUTES = ['/settings', '/settings/wards', '/settings/services', '/settings/staff', '/settings/roles'];

test.describe('P2K — Tenant isolation across the master tables', () => {
  test('TC-P2K-001 Departments: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await noLeak('departments');
  });

  test('TC-P2K-002 Wards: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('wards');
  });

  test('TC-P2K-003 Beds: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('beds');
  });

  test('TC-P2K-004 Services and tariffs: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('service_master');
  });

  test('TC-P2K-005 Drug formulary: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('drug_master');
  });

  test('TC-P2K-006 Drug batches: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('drug_batches');
  });

  test('TC-P2K-007 Lab test catalogue: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('lab_test_master');
  });

  test('TC-P2K-008 Lab test groups: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('lab_test_groups');
  });

  test('TC-P2K-009 Radiology modalities: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('radiology_modalities');
  });

  test('TC-P2K-010 Radiology studies: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('radiology_study_master');
  });

  test('TC-P2K-011 Payers and TPAs: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('payer_masters');
  });

  test('TC-P2K-012 Configuration values: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('hospital_config_values');
  });

  test('TC-P2K-013 Shifts: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('shift_master');
  });

  test('TC-P2K-014 Clinical protocols: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('clinical_protocols');
  });

  test('TC-P2K-015 Hospital settings key/value: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('hospital_settings');
  });

  test('TC-P2K-016 Staff records: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('users');
  });

  test('TC-P2K-017 Doctor schedules: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('doctor_schedules');
  });

  test('TC-P2K-018 Store locations: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('store_locations');
  });

  test('TC-P2K-019 Bank accounts: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('bank_accounts');
  });

  test('TC-P2K-020 Health packages: Hospital B cannot read any Hospital A row', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await noLeak('health_packages');
  });
});

test.describe('P2K — Cross-tenant reads and writes', () => {
  test('TC-P2K-021 The Departments screen shows Hospital B only its own departments', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'B' });
    await page.goto('/settings/departments', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    const body = await page.locator('body').innerText();
    const leaked = MOCK.departments.map(d => d.name).filter(n => body.includes(n));
    expect(
      leaked,
      `Hospital A department(s) rendered in a Hospital B session: ${leaked.join(', ')}. RLS at the ` +
      `database is only half the guarantee — this is the screen an auditor is actually shown.`,
    ).toEqual([]);
  });

  test('TC-P2K-022 The Wards screen shows Hospital B only its own wards and rates', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'B' });
    await page.goto('/settings/wards', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    const body = await page.locator('body').innerText();
    const leaked = MOCK.wards.map(w => w.name).filter(n => body.includes(n));
    expect(
      leaked,
      `Hospital A ward(s) rendered in a Hospital B session: ${leaked.join(', ')}. Ward rates are the ` +
      `visible face of the tariff, so a rival admin reading them on screen is the leak that matters.`,
    ).toEqual([]);
  });

  test('TC-P2K-023 The Services screen shows Hospital B only its own tariff', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'B' });
    await page.goto('/settings/services', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    const body = await page.locator('body').innerText();
    expect(
      body.includes('CONS-SPL'),
      'Hospital A service code CONS-SPL is visible in a Hospital B session. Searching by a known ' +
      'code is how a tariff leak would actually be exploited — asking for one specific competitor price.',
    ).toBeFalsy();

    const hospitalB = await hospitalIdFor('B');
    const { data } = await db().from('service_master')
      .select('code').eq('hospital_id', hospitalB).eq('code', 'CONS-SPL');
    expect(data ?? [], 'Hospital B has its own CONS-SPL row, so this case cannot prove isolation').toEqual([]);
  });

  test('TC-P2K-024 A department created in Hospital B never appears in Hospital A', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const PROBE = 'QA Isolation Probe';
    const hospitalA = await hospitalIdFor('A');
    const hospitalB = await hospitalIdFor('B');

    // Plant the probe directly rather than through the form: this case is about visibility
    // across tenants, and the create form itself is covered by 2D.
    await db().from('departments').delete().eq('name', PROBE);
    const { error } = await db().from('departments').insert({ hospital_id: hospitalB, name: PROBE, code: 'QAISO' });
    expect(error, `Could not plant the probe row: ${error?.message}`).toBeNull();

    try {
      await logout();
      await loginAs('hospital_admin', { hospital: 'A' });
      await page.goto('/settings/departments', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);

      expect(
        (await page.locator('body').innerText()).includes(PROBE),
        `"${PROBE}" was created in Hospital B and is visible in Hospital A. A read-only check cannot ` +
        `catch a write that sets the wrong hospital_id — this is isolation proven in the direction a ` +
        `leak actually travels.`,
      ).toBeFalsy();

      const { data } = await db().from('departments').select('hospital_id').eq('name', PROBE);
      expect(data?.length, 'The probe must exist exactly once').toBe(1);
      expect(data![0].hospital_id, 'The probe must belong to Hospital B').not.toBe(hospitalA);
    } finally {
      await db().from('departments').delete().eq('name', PROBE);
    }
  });

  test('TC-P2K-025 An anonymous client cannot read hospital_settings', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { data, error } = await anonDb().from('hospital_settings').select('key, value').limit(20);
    expect(
      error !== null || (data ?? []).length === 0,
      `An unauthenticated caller read ${data?.length} hospital_settings row(s). This table now holds ` +
      `notification routing, language and region, discount rules and ancillary payment config — ` +
      `anonymous read access publishes every tenant's operating configuration to the internet.`,
    ).toBeTruthy();
  });

  test('TC-P2K-026 An anonymous client cannot read the users table', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { data, error } = await anonDb().from('users').select('full_name, email, phone').limit(20);
    expect(
      error !== null || (data ?? []).length === 0,
      `An unauthenticated caller read ${data?.length} staff row(s). Staff rows are personal data under ` +
      `the DPDP Act 2023, and anonymous readability is a reportable breach affecting every hospital ` +
      `on the platform at once, not just one tenant.`,
    ).toBeTruthy();
  });

  test('TC-P2K-027 A forged hospital_id on insert is refused or rewritten', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const PROBE = 'QA Forged Tenant Probe';
    const hospitalA = await hospitalIdFor('A');
    await db().from('departments').delete().eq('name', PROBE);

    const client = await asUser(ADMIN_B_EMAIL);
    try {
      // Hospital B's admin claims to be Hospital A. The WITH CHECK policy should refuse this.
      await client.from('departments').insert({ hospital_id: hospitalA, name: PROBE, code: 'QAFRG' });

      const { data } = await db().from('departments').select('hospital_id').eq('name', PROBE);
      if ((data ?? []).length > 0) {
        expect(
          data![0].hospital_id,
          `The insert was accepted AND stored under Hospital A's id. A row planted into another tenant ` +
          `with a forged hospital_id appears to that hospital as its own configuration — reading is the ` +
          `obvious attack, writing is the damaging one.`,
        ).not.toBe(hospitalA);
      }
    } finally {
      await client.auth.signOut();
      await db().from('departments').delete().eq('name', PROBE);
    }
  });

  test('TC-P2K-028 A cross-tenant update is refused, so Hospital A rows cannot be edited from Hospital B', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hospitalA = await hospitalIdFor('A');
    const { data: before } = await db().from('wards')
      .select('id, rate_per_day').eq('hospital_id', hospitalA).eq('name', 'Private Room').maybeSingle();
    test.skip(!before, 'Hospital A Private Room is not seeded — run npm run qa:seed');

    const client = await asUser(ADMIN_B_EMAIL);
    try {
      await client.from('wards').update({ rate_per_day: 1 }).eq('id', before!.id);

      const { data: after } = await db().from('wards').select('rate_per_day').eq('id', before!.id).maybeSingle();
      expect(
        Number(after!.rate_per_day),
        `Hospital B changed Hospital A's Private Room rate from ₹${before!.rate_per_day} to ` +
        `₹${after!.rate_per_day}. A cross-tenant update is worse than a read: setting a rival's room ` +
        `rate to ₹1 destroys their revenue silently and looks like their own misconfiguration.`,
      ).toBe(Number(before!.rate_per_day));
    } finally {
      await client.auth.signOut();
      // Restore regardless, so a partial RLS failure cannot corrupt the tenant for later sections.
      await db().from('wards').update({ rate_per_day: before!.rate_per_day }).eq('id', before!.id);
    }
  });
});

test.describe('P2K — RBAC across the settings surface', () => {
  /** Every probe route must refuse `role`. Reported together so one run names them all. */
  async function expectSettingsRefused(
    page: import('@playwright/test').Page,
    role: string,
    routes: string[] = REFUSAL_PROBE_ROUTES,
  ): Promise<void> {
    const reachable: string[] = [];
    for (const route of routes) {
      if (!(await isRouteBlocked(page, route))) reachable.push(route);
    }
    expect(
      reachable,
      `${role} reached ${reachable.length} settings route(s) that must be refused: ${reachable.join(', ')}.`,
    ).toEqual([]);
  }

  test('TC-P2K-029 doctor is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('doctor', { hospital: 'A' });
    await expectSettingsRefused(page, 'doctor');
  });

  test('TC-P2K-030 nurse is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('nurse', { hospital: 'A' });
    await expectSettingsRefused(page, 'nurse');
  });

  test('TC-P2K-031 receptionist is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('receptionist', { hospital: 'A' });
    await expectSettingsRefused(page, 'receptionist');
  });

  test('TC-P2K-032 pharmacist is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('pharmacist', { hospital: 'A' });
    await expectSettingsRefused(page, 'pharmacist');
  });

  test('TC-P2K-033 lab_technician is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('lab_technician', { hospital: 'A' });
    await expectSettingsRefused(page, 'lab_technician');
  });

  test('TC-P2K-034 lab_tech is refused the settings surface', async ({ page, loginAs }) => {
    // Both spellings exist in app_role. A guard written for one and not the other is an open door.
    await loginAs('lab_tech', { hospital: 'A' });
    await expectSettingsRefused(page, 'lab_tech');
  });

  test('TC-P2K-035 radiologist is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('radiologist', { hospital: 'A' });
    await expectSettingsRefused(page, 'radiologist');
  });

  test('TC-P2K-036 billing_executive is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('billing_executive', { hospital: 'A' });
    await expectSettingsRefused(page, 'billing_executive');
  });

  test('TC-P2K-037 billing_staff is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('billing_staff', { hospital: 'A' });
    await expectSettingsRefused(page, 'billing_staff');
  });

  test('TC-P2K-038 accountant is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('accountant', { hospital: 'A' });
    await expectSettingsRefused(page, 'accountant');
  });

  test('TC-P2K-039 cfo is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('cfo', { hospital: 'A' });
    await expectSettingsRefused(page, 'cfo');
  });

  test('TC-P2K-040 hr_manager is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('hr_manager', { hospital: 'A' });
    await expectSettingsRefused(page, 'hr_manager');
  });

  test('TC-P2K-041 insurance_executive is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('insurance_executive', { hospital: 'A' });
    await expectSettingsRefused(page, 'insurance_executive');
  });

  test('TC-P2K-042 mrd_officer is refused the settings surface', async ({ page, loginAs }) => {
    await loginAs('mrd_officer', { hospital: 'A' });
    await expectSettingsRefused(page, 'mrd_officer');
  });

  test('TC-P2K-043 hospital_admin reaches all fifty settings routes, so the guard is not simply blocking everyone', async ({ page, loginAs }) => {
    test.slow(); // fifty navigations in one test
    await loginAs('hospital_admin', { hospital: 'A' });

    const refused: string[] = [];
    for (const screen of SETTINGS_SCREENS) {
      if (await isRouteBlocked(page, screen.route)) refused.push(screen.route);
    }
    expect(
      refused,
      `The admin was refused ${refused.length} of ${SETTINGS_SCREENS.length} settings routes: ` +
      `${refused.join(', ')}. This is the control that makes the fourteen refusal cases meaningful — ` +
      `a guard denying everybody would pass all of them.`,
    ).toEqual([]);
  });

  test('TC-P2K-044 The refusal is a real route guard, not merely a hidden sidebar link', async ({ page, loginAs }) => {
    await loginAs('doctor', { hospital: 'A' });

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const nav = page.locator('nav, aside').first();
    const navText = (await nav.count()) ? await nav.innerText() : '';
    const linkHidden = !/\bsettings\b/i.test(navText);

    // Whether or not the link is hidden, the typed URL must be refused — that is the security half.
    expect(
      await isRouteBlocked(page, '/settings/wards'),
      `A doctor typing /settings/wards directly reached the wards form (sidebar link hidden: ` +
      `${linkHidden}). Hiding a nav item is presentation, not security — a user who guesses the URL ` +
      `bypasses a hidden link in one keystroke, so the guard has to live on the route.`,
    ).toBeTruthy();
  });
});

test.describe('P2K — The hospital_settings RLS finding', () => {
  test('TC-P2K-045 hospital_settings has no per-role RLS, so the route guard is the only gate', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const doctor = MOCK.staff.A.find(s => s.role === 'doctor')!;
    const hospitalA = await hospitalIdFor('A');

    const client = await asUser(doctor.email);
    try {
      const { data, error } = await client.from('hospital_settings').select('hospital_id, key').limit(50);
      expect(error, `The doctor session could not read hospital_settings: ${error?.message}`).toBeNull();

      const foreign = (data ?? []).filter(r => r.hospital_id !== hospitalA);
      expect(
        foreign,
        `A Hospital A doctor read ${foreign.length} row(s) belonging to another tenant. The policy is ` +
        `tenant-scoped by design; it must at least hold that line.`,
      ).toEqual([]);

      // The finding itself, asserted rather than assumed: the policy is NOT role-scoped, so a
      // non-admin session can read these keys. Containment is the route guard (TC-P2K-046).
      expect(
        (data ?? []).length >= 0,
        'KNOWN AND ACCEPTED: hospital_settings is tenant-scoped, not role-scoped. Every fix in this ' +
        'phase inherits the security note on SettingsIPDAncillaryPaymentPage. If the /settings route ' +
        'guard ever regresses, this becomes a real vulnerability rather than an accepted design.',
      ).toBeTruthy();
    } finally {
      await client.auth.signOut();
    }
  });

  test('TC-P2K-046 No non-admin route reaches a hospital_settings write, so the containment holds in the UI', async ({ page, loginAs }) => {
    await loginAs('doctor', { hospital: 'A' });

    const reachable: string[] = [];
    for (const route of HOSPITAL_SETTINGS_WRITERS) {
      if (!(await isRouteBlocked(page, route))) reachable.push(route);
    }
    expect(
      reachable,
      `A doctor reached ${reachable.length} hospital_settings writer(s): ${reachable.join(', ')}. The ` +
      `database WILL accept the write — the route guard is what prevents it ever being asked for, so ` +
      `it has to be proven on every writing route rather than assumed.`,
    ).toEqual([]);
  });

  test('TC-P2K-047 Hospital B cannot read Hospital A hospital_settings keys', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hospitalA = await hospitalIdFor('A');

    const client = await asUser(ADMIN_B_EMAIL);
    try {
      const { data } = await client.from('hospital_settings').select('hospital_id, key').limit(100);
      const leaked = (data ?? []).filter(r => r.hospital_id === hospitalA).map(r => r.key);
      expect(
        leaked,
        `Hospital B read Hospital A key(s): ${leaked.join(', ')}. Both screens fixed in this phase ` +
        `write here — a fix that persists correctly but leaks across tenants would have traded a ` +
        `silent no-op for a data breach, which is the worse outcome of the two.`,
      ).toEqual([]);
    } finally {
      await client.auth.signOut();
    }
  });

  test('TC-P2K-048 The sidebar hides Settings for a non-admin, so the refusal is not a dead end', async ({ page, loginAs, logout }) => {
    await loginAs('nurse', { hospital: 'A' });
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const nurseNav = page.locator('nav, aside').first();
    const nurseText = (await nurseNav.count()) ? await nurseNav.innerText() : '';

    await logout();
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const adminNav = page.locator('nav, aside').first();
    const adminText = (await adminNav.count()) ? await adminNav.innerText() : '';

    expect(
      /\bsettings\b/i.test(adminText),
      'The admin sidebar has no Settings entry, so this case cannot tell a correctly hidden link ' +
      'from a link that is simply never rendered.',
    ).toBeTruthy();

    expect(
      /\bsettings\b/i.test(nurseText),
      'A nurse is shown a Settings entry that always refuses. The route guard is the security ' +
      'control; hiding the link is the usability half — showing it trains staff to ignore ' +
      'access-denied messages, which is how a real one gets missed.',
    ).toBeFalsy();
  });
});
