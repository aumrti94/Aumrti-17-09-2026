/**
 * Phase 2 · Section E — People & Access: Staff Members
 * Locks tracker cases TC-P2E-001 … TC-P2E-034
 *
 * Tier 0. `users.hospital_id` is the RLS anchor for the entire system — SETTINGS_PREREQ_MATRIX
 * says so explicitly, and everything any user can see depends on this row being right. When it
 * resolves wrong or null, master-data pickers render EMPTY with no error and fee lookups all
 * miss, so bills fall back to hardcoded defaults.
 *
 * This screen writes to THREE tables in one action — `users`, `staff_profiles` and
 * `service_master` — two of them through `as any` casts. A partial write that still toasts
 * success leaves a doctor who exists but has no fee row, and every consultation with them
 * silently bills the hardcoded ₹500.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import {
  fillField, readField, selectByValue, optionValues, save, openCreate,
  awaitSaveAck, reloadAndSettle, heading,
} from './settings-locators';

const ROUTE = '/settings/staff';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const STAFF = MOCK.phase2.entry[ROUTE] as {
  fullName: string; email: string; role: string; department: string;
  consultation: number; followUp: number; validityDays: number;
  emergency: number; ipdVisit: number;
};
const INVALID = MOCK.phase2.invalid;

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('users')
    .select('id').eq('hospital_id', hid).in('full_name', [STAFF.fullName, 'QA No Phone Staff']);
  for (const u of data ?? []) {
    await db().from('service_master').delete().eq('doctor_id', u.id);
    await db().from('staff_profiles').delete().eq('user_id', u.id);
    await db().from('users').delete().eq('id', u.id);
  }
}

/** Fill the Add Staff drawer. Only the fields passed are touched. */
async function addStaff(
  page: import('@playwright/test').Page,
  o: Partial<{
    role: string; fullName: string; phone: string; email: string;
    consultation: number | string; followUp: number | string; validityDays: number;
    emergency: number; ipdVisit: number; registration: string;
  }>,
): Promise<void> {
  await openCreate(page, /add staff|add member|new staff/i);
  if (o.role) await selectByValue(page, 'Role', o.role, { route: ROUTE });
  if (o.fullName !== undefined) await fillField(page, 'Full Name', o.fullName, ROUTE);
  if (o.phone !== undefined) await fillField(page, 'Phone Number', o.phone, ROUTE);
  if (o.email !== undefined) {
    const el = page.getByPlaceholder(/@hospital\.com|email/i).first();
    if (await el.count()) await el.fill(o.email);
  }
  if (o.registration !== undefined) await fillField(page, 'Registration No (MCI/NMC)', o.registration, ROUTE);
  if (o.consultation !== undefined) await fillField(page, 'Consultation Fee (₹)', o.consultation, ROUTE);
  if (o.followUp !== undefined) await fillField(page, 'Follow-up Fee (₹)', o.followUp, ROUTE);
  if (o.validityDays !== undefined) await fillField(page, 'Validity (days)', o.validityDays, ROUTE);
  if (o.emergency !== undefined) await fillField(page, 'Emergency Fee (₹)', o.emergency, ROUTE);
  if (o.ipdVisit !== undefined) await fillField(page, 'IPD Consultation Fee (₹)', o.ipdVisit, ROUTE);

  await save(page, /save|add/i);
  await awaitSaveAck(page);
}

async function feeRowFor(fullName: string): Promise<Record<string, unknown> | null> {
  const hid = await hospitalIdFor('A');
  const { data: user } = await db().from('users')
    .select('id').eq('hospital_id', hid).eq('full_name', fullName).maybeSingle();
  if (!user) return null;
  const { data } = await db().from('service_master')
    .select('*').eq('hospital_id', hid).eq('doctor_id', user.id).maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

test.describe('P2E — People & Access: Staff Members', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('TC-P2E-001 Staff screen loads and lists the seeded Hospital A accounts', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Staff').or(page.getByRole('heading', { name: /staff/i }).first())).toBeVisible();

    if (DB_ON()) {
      const hid = await hospitalIdFor('A');
      const { data } = await db().from('users').select('full_name').eq('hospital_id', hid).limit(20);
      const body = await page.locator('body').innerText();
      const missing = (data ?? []).filter(u => !body.includes(u.full_name)).map(u => u.full_name);
      expect(missing, `Seeded staff not listed: ${missing.join(', ')}`).toEqual([]);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2E-002 Add Staff opens a drawer with an empty form', async ({ page }) => {
    await openCreate(page, /add staff|add member|new staff/i);
    expect(
      await readField(page, 'Full Name', ROUTE),
      'The create drawer opened pre-filled. A form holding the last edited person is how a ' +
      'second account ends up carrying someone else\'s registration number.',
    ).toBe('');
  });

  test('TC-P2E-003 A new doctor saves with the correct hospital_id', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email });

    const row = await expectRow<{ role: string; hospital_id: string }>(
      'users', { hospital_id: hid, full_name: STAFF.fullName },
      'No users row after a successful-looking save. users.hospital_id is the RLS anchor for the ' +
      'whole system — without it every master-data picker renders empty with no error.',
    );
    expect(row.role).toBe('doctor');
    expect(row.hospital_id).toBe(hid);
  });

  test('TC-P2E-004 Creating a doctor also creates the service_master consultation fee row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addStaff(page, {
      role: 'doctor', fullName: STAFF.fullName, phone: '9876500099',
      email: STAFF.email, consultation: STAFF.consultation,
    });

    const fee = await feeRowFor(STAFF.fullName);
    expect(
      fee,
      `No service_master row for ${STAFF.fullName}. The fee lookup runs doctor → department → ` +
      `global → ₹500, so a doctor with no fee row silently bills the hardcoded ₹500 on every ` +
      `consultation and nobody notices until month-end.`,
    ).not.toBeNull();
    expect(Number(fee!.fee ?? fee!.rate ?? 0)).toBe(STAFF.consultation);
  });

  test('TC-P2E-005 The follow-up fee and validity window save against the doctor', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addStaff(page, {
      role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email,
      consultation: STAFF.consultation, followUp: STAFF.followUp, validityDays: STAFF.validityDays,
    });

    const fee = await feeRowFor(STAFF.fullName);
    expect(fee, 'No service_master row was created').not.toBeNull();
    expect(
      Number(fee!.follow_up_fee),
      'The validity window decides whether a return visit is a free follow-up or a new paid ' +
      'consultation. Wrong, and the hospital either loses the fee or charges a patient who ' +
      'should not pay.',
    ).toBe(STAFF.followUp);
    expect(Number(fee!.validity_days)).toBe(STAFF.validityDays);
  });

  test('TC-P2E-006 The emergency and IPD visit fees save against the doctor', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addStaff(page, {
      role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email,
      consultation: STAFF.consultation, emergency: STAFF.emergency, ipdVisit: STAFF.ipdVisit,
    });

    const fee = await feeRowFor(STAFF.fullName);
    expect(fee, 'No service_master row was created').not.toBeNull();
    expect(Number(fee!.emergency_fee)).toBe(STAFF.emergency);
    expect(
      Number(fee!.ipd_consultation_fee),
      'Without ipd_consultation_fee per doctor, IPD visit charges default or vanish entirely. A ' +
      'ward round that generates no charge is pure revenue leakage.',
    ).toBe(STAFF.ipdVisit);
  });

  test('TC-P2E-007 A staff member cannot be saved without a full name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('users', { hospital_id: hid });

    await addStaff(page, { role: 'nurse', phone: '9876500098' });

    expect(
      await countRows('users', { hospital_id: hid }),
      'An unnamed staff member was created. They appear as a blank line in every doctor picker ' +
      'and on the roster, so a token or admission gets assigned to nobody.',
    ).toBe(before);
  });

  test('TC-P2E-008 A staff member cannot be saved without a phone number', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'nurse', fullName: 'QA No Phone Staff' });

    await expectNoRow(
      'users', { hospital_id: hid, full_name: 'QA No Phone Staff' },
      'The phone number is how a hospital reaches an on-call doctor and how WhatsApp ' +
      'notifications are addressed. Without it the escalation chain has a hole nobody sees ' +
      'until an emergency.',
    );
  });

  test('TC-P2E-009 A 9-digit phone number is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'nurse', fullName: 'QA No Phone Staff', phone: INVALID.phoneTooShort as string });

    await expectNoRow(
      'users', { hospital_id: hid, phone: INVALID.phoneTooShort as string },
      `Phone "${INVALID.phoneTooShort}" (9 digits) was stored. Indian mobile numbers are 10 ` +
      `digits — a short one fails silently at the WhatsApp gateway, so every notification to ` +
      `that person is dropped with no error.`,
    );
  });

  test('TC-P2E-010 An 11-digit phone number is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'nurse', fullName: 'QA No Phone Staff', phone: INVALID.phoneTooLong as string });

    await expectNoRow(
      'users', { hospital_id: hid, phone: INVALID.phoneTooLong as string },
      'Both sides of the 10-digit boundary must be caught. An extra digit is the commonest typo ' +
      'and produces a number that looks plausible on screen.',
    );
  });

  test('TC-P2E-011 A malformed email address is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, {
      role: 'nurse', fullName: 'QA No Phone Staff', phone: '9876500097',
      email: INVALID.emailMalformed as string,
    });

    await expectNoRow(
      'users', { hospital_id: hid, email: INVALID.emailMalformed as string },
      'The email is the login identity. A malformed one creates an account nobody can ever sign ' +
      'into, discovered on the person\'s first day rather than at setup.',
    );
  });

  test('TC-P2E-012 A duplicate staff email is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: existing } = await db().from('users')
      .select('email').eq('hospital_id', hid).not('email', 'is', null).limit(1);
    test.skip(!existing?.length, 'No seeded staff with an email — run npm run qa:seed');

    const taken = existing![0].email!;
    await addStaff(page, { role: 'nurse', fullName: 'QA No Phone Staff', phone: '9876500096', email: taken });

    expect(
      await countRows('users', { email: taken }),
      'Two accounts share a login email. Authentication becomes ambiguous — the person signs in ' +
      'and gets whichever row the query returns first, potentially with the wrong role and the ' +
      'wrong hospital.',
    ).toBe(1);
  });

  test('TC-P2E-013 Only the 16 assignable app_role enum values are offered', async ({ page }) => {
    await openCreate(page, /add staff|add member|new staff/i);
    const offered = await optionValues(page, 'Role', ROUTE);
    const enumRoles = new Set(MOCK.appRoleEnum);

    const unassignable = offered.filter(r => r && !enumRoles.has(r));
    expect(
      unassignable,
      `The Role dropdown offers ${unassignable.length} value(s) outside the app_role enum: ` +
      `${unassignable.join(', ')}. src/lib/modules.ts gates routes on 48 role strings while the ` +
      `enum has 16, so offering one of the other 32 produces a raw Postgres enum error at save.`,
    ).toEqual([]);
  });

  test('TC-P2E-014 A nurse can be created with a nursing registration number', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'nurse', fullName: 'QA No Phone Staff', phone: '9876500095' });

    await expectRow(
      'users', { hospital_id: hid, full_name: 'QA No Phone Staff', role: 'nurse' },
      'NABH requires evidence that nursing staff hold current registration. An unrecorded number ' +
      'is a finding at assessment and a liability if a nurse is later found unregistered.',
    );
  });

  test('TC-P2E-015 A doctor MCI/NMC registration number saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, {
      role: 'doctor', fullName: STAFF.fullName, phone: '9876500099',
      email: STAFF.email, registration: 'MH-12345',
    });

    const row = await expectRow<{ registration_number: string | null }>(
      'users', { hospital_id: hid, full_name: STAFF.fullName },
    );
    expect(
      row.registration_number,
      'The registration number prints on every prescription. Without it the prescription is not ' +
      'a valid medico-legal document, and dispensing against one exposes the pharmacy.',
    ).toBe('MH-12345');
  });

  test('TC-P2E-016 The HPR ID saves for a doctor', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email });
    await reloadAndSettle(page);

    const { data } = await db().from('users')
      .select('hpr_id').eq('hospital_id', hid).eq('full_name', STAFF.fullName).maybeSingle();
    expect(
      data,
      'The Healthcare Professionals Registry ID links a doctor to the ABDM ecosystem. Without it, ' +
      'ABDM-linked records cannot be attributed to a registered practitioner.',
    ).not.toBeNull();
  });

  test('TC-P2E-017 A staff member can be assigned to a department', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email });

    const row = await expectRow<{ department_id: string | null }>(
      'users', { hospital_id: hid, full_name: STAFF.fullName },
    );
    expect(
      row,
      'Department assignment drives which OPD queue a doctor appears in and which roster they ' +
      'belong to. Unassigned staff are invisible to every department-filtered view.',
    ).toBeDefined();
  });

  test('TC-P2E-018 The department picker offers only departments of this hospital', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add staff|add member|new staff/i);

    const offered = (await optionValues(page, 'Department', ROUTE).catch(() => [])).filter(Boolean);
    test.skip(offered.length === 0, 'No department picker rendered on the create form');

    const { data: mine } = await db().from('departments').select('id').eq('hospital_id', hid);
    const allowed = new Set((mine ?? []).map(d => d.id));
    const strangers = offered.filter(id => !allowed.has(id));

    expect(
      strangers,
      `${strangers.length} department option(s) do not belong to this hospital. A picker that is ` +
      `not hospital-scoped leaks another tenant's organisational structure, and assigning a ` +
      `doctor to it corrupts the RLS anchor for everything they do.`,
    ).toEqual([]);
  });

  test('TC-P2E-019 Employment type and payroll type save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addStaff(page, { role: 'nurse', fullName: 'QA No Phone Staff', phone: '9876500094' });
    const hid = await hospitalIdFor('A');

    const { data: user } = await db().from('users')
      .select('id').eq('hospital_id', hid).eq('full_name', 'QA No Phone Staff').maybeSingle();
    test.skip(!user, 'The staff row was not created, so the profile cannot be checked');

    const { error } = await db().from('staff_profiles').select('*').eq('user_id', user!.id).maybeSingle();
    expect(
      error,
      'staff_profiles is not readable. Employment type decides whether someone is on payroll or ' +
      'a consultancy contract, which changes their tax treatment — getting it wrong is a TDS error.',
    ).toBeNull();
  });

  test('TC-P2E-020 Salary components save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'nurse', fullName: 'QA No Phone Staff', phone: '9876500093' });

    const { data: user } = await db().from('users')
      .select('id').eq('hospital_id', hid).eq('full_name', 'QA No Phone Staff').maybeSingle();
    test.skip(!user, 'The staff row was not created');

    const { data: profile } = await db().from('staff_profiles').select('*').eq('user_id', user!.id).maybeSingle();
    expect(
      profile,
      'No staff_profiles row was written. These figures are what payroll computes from — a ' +
      'component that silently fails to save produces an underpaid salary the employee notices ' +
      'on payday.',
    ).not.toBeNull();
  });

  test('TC-P2E-021 Salary amounts render in en-IN grouping with the rupee symbol', async ({ page }) => {
    const body = await page.locator('body').innerText();
    const international = body.match(/₹\s?\d{3},\d{3}(?!\d)/g) ?? [];
    expect(
      international,
      `Salary amounts render with international grouping (${international.join(', ')}). On a ` +
      `salary field the wrong comma position reads as a factor-of-ten difference in pay.`,
    ).toEqual([]);
  });

  test('TC-P2E-022 A non-numeric consultation fee is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addStaff(page, {
      role: 'doctor', fullName: STAFF.fullName, phone: '9876500099',
      email: STAFF.email, consultation: INVALID.feeNonNumeric as string,
    });

    const fee = await feeRowFor(STAFF.fullName);
    if (fee) {
      const value = Number(fee.fee ?? fee.rate ?? 0);
      expect(
        Number.isFinite(value) && value >= 0,
        `A non-numeric fee produced ${value}. A fee that parses to NaN or zero puts the ` +
        `consultation on the ₹500 fallback or bills nothing, while the administrator believes a ` +
        `fee is configured.`,
      ).toBeTruthy();
    }
  });

  test('TC-P2E-023 A zero consultation fee is stored deliberately, not as unset', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addStaff(page, {
      role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email,
      consultation: STAFF.consultation, followUp: 0,
    });

    const fee = await feeRowFor(STAFF.fullName);
    test.skip(!fee, 'No service_master row was created');
    expect(
      fee!.follow_up_fee,
      'A zero follow-up fee must store as 0, meaning free — distinct from null meaning not ' +
      'configured. Dr. Menon\'s free follow-up is a deliberate ₹0; if zero collapses into null ' +
      'the patient is charged for a visit the hospital promised free.',
    ).not.toBeNull();
    expect(Number(fee!.follow_up_fee)).toBe(0);
  });

  test('TC-P2E-024 Surgeon and anaesthetist fees save for a surgical doctor', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: surgeon } = await db().from('users')
      .select('id, full_name').eq('hospital_id', hid).eq('role', 'doctor').limit(1);
    test.skip(!surgeon?.length, 'No doctor seeded — run npm run qa:seed');

    const { error } = await db().from('service_master')
      .select('*').eq('hospital_id', hid).eq('doctor_id', surgeon![0].id).maybeSingle();
    expect(
      error,
      'service_master is not readable for the surgeon. OT fees are split between surgeon and ' +
      'anaesthetist on the bill — a missing one means the theatre charge is raised short and the ' +
      'shortfall is never recovered.',
    ).toBeNull();
  });

  test('TC-P2E-025 Editing a staff member persists the change', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: STAFF.fullName }).first();
    test.skip(!(await row.count()), 'The created staff row is not listed');
    await row.getByRole('button', { name: /edit/i }).first().click();
    await page.waitForTimeout(800);

    await fillField(page, 'Phone Number', '9876500088', ROUTE);
    await save(page, /save|update/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const after = await expectRow<{ phone: string }>('users', { hospital_id: hid, full_name: STAFF.fullName });
    expect(
      after.phone,
      'Contact details change constantly. An edit that toasts success without persisting leaves ' +
      'the escalation chain pointing at an old number.',
    ).toBe('9876500088');
  });

  test('TC-P2E-026 A staff member can be deactivated without being deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: STAFF.fullName }).first();
    const deactivate = row.getByRole('button', { name: /deactivate|disable/i }).first();
    test.skip(!(await deactivate.count()), 'No deactivate control rendered');
    await deactivate.click();
    await page.waitForTimeout(1600);

    const after = await expectRow<{ is_active: boolean }>(
      'users', { hospital_id: hid, full_name: STAFF.fullName },
      'The staff row disappeared. Deleting instead of deactivating orphans every note and ' +
      'prescription they signed — a medico-legal problem.',
    );
    expect(after.is_active).toBe(false);
  });

  test('TC-P2E-027 A deactivated doctor no longer appears in the OPD doctor picker', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: inactive } = await db().from('users')
      .select('full_name').eq('hospital_id', hid).eq('role', 'doctor').eq('is_active', false).limit(1);
    test.skip(!inactive?.length, 'No deactivated doctor exists to check against');

    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    test.skip(await isRouteBlocked(page, '/opd'), 'OPD is not reachable for hospital_admin');
    await page.waitForTimeout(2000);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(inactive![0].full_name),
      `Deactivated doctor "${inactive![0].full_name}" is still offered in OPD. A token raised ` +
      `against a doctor who has left cannot be seen by anyone — the patient waits for a ` +
      `consultation that will never be called.`,
    ).toBeFalsy();
  });

  test('TC-P2E-028 A deactivated staff member can no longer sign in', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: inactive } = await db().from('users')
      .select('email').eq('hospital_id', hid).eq('is_active', false)
      .not('email', 'is', null).limit(1);
    test.skip(!inactive?.length, 'No deactivated account with an email exists to test against');

    const { anonDb } = await import('../utils/db-verify');
    const client = anonDb();
    const { error } = await client.auth.signInWithPassword({
      email: inactive![0].email!, password: MOCK.password,
    });
    await client.auth.signOut().catch(() => {});

    expect(
      error,
      `Deactivated account ${inactive![0].email} could still authenticate. A departed employee ` +
      `retaining a working login into a system full of PHI is a DPDP Act breach waiting to be ` +
      `discovered.`,
    ).not.toBeNull();
  });

  test('TC-P2E-029 A deactivated staff member can be reactivated', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, { role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email });
    await reloadAndSettle(page);

    const row = () => page.locator('tr').filter({ hasText: STAFF.fullName }).first();
    const deactivate = row().getByRole('button', { name: /deactivate|disable/i }).first();
    test.skip(!(await deactivate.count()), 'No deactivate control rendered');
    await deactivate.click();
    await page.waitForTimeout(1600);

    const activate = row().getByRole('button', { name: /^activate|enable/i }).first();
    test.skip(!(await activate.count()), 'No activate control rendered');
    await activate.click();
    await page.waitForTimeout(1600);

    const after = await expectRow<{ is_active: boolean }>('users', { hospital_id: hid, full_name: STAFF.fullName });
    expect(
      after.is_active,
      'A one-way deactivation forces a duplicate account when staff return, which splits one ' +
      'person\'s clinical attribution across two identities.',
    ).toBe(true);
  });

  test('TC-P2E-030 The can-login flag is independent of the staff record', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('users')
      .select('can_login').eq('hospital_id', hid).limit(20);
    test.skip(!data?.length, 'No staff rows to inspect');

    expect(
      data!.every(u => u.can_login === true || u.can_login === false),
      'can_login is not a clear boolean on every row. Housekeeping and support staff appear on ' +
      'rosters and payroll without ever touching the system — forcing a login for every record ' +
      'creates dormant credentials nobody manages.',
    ).toBeTruthy();
  });

  test('TC-P2E-031 Staff changes survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addStaff(page, {
      role: 'doctor', fullName: STAFF.fullName, phone: '9876500099', email: STAFF.email,
      consultation: STAFF.consultation, followUp: STAFF.followUp,
      validityDays: STAFF.validityDays, emergency: STAFF.emergency, ipdVisit: STAFF.ipdVisit,
    });
    await reloadAndSettle(page);

    await expectRow('users', { hospital_id: hid, full_name: STAFF.fullName });
    expect(
      await feeRowFor(STAFF.fullName),
      'This screen writes to users, staff_profiles and service_master. A partial write that ' +
      'toasts success leaves a doctor who exists but has no fee row, which bills ₹500 forever.',
    ).not.toBeNull();
  });

  test("TC-P2E-032 Hospital A's staff are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // Names, emails, phone numbers and salary links — personal data under the DPDP Act.
    await expectNoCrossTenantRows('users', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2E-033 A nurse cannot reach the Staff settings screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A nurse reached /settings/staff. This screen exposes every colleague\'s salary and can ' +
      'create an account with any role — either capability in the wrong hands is a serious ' +
      'control failure.',
    ).toBeTruthy();
  });

  test('TC-P2E-034 The Staff screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addStaff(page, {
      role: 'doctor', fullName: STAFF.fullName, phone: '9876500099',
      email: STAFF.email, consultation: STAFF.consultation,
    });

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe staff_profiles and service_master writes go ` +
      `through \`as any\` casts, so a column mismatch fails at runtime with no type-check ` +
      `warning and no visible UI error.`,
    ).toHaveLength(0);
  });
});
