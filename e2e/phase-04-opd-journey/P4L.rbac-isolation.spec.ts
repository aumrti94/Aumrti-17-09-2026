/**
 * Phase 4 · Section L — RBAC, tenant isolation & permission gates
 * Locks tracker cases TC-P4L-001 … TC-P4L-016
 *
 * Two questions, asked of every OPD table:
 *   1. Does each role see only what its job needs? (a doctor sees their own queue; a nurse
 *      records vitals but does not prescribe; a receptionist books but does not diagnose)
 *   2. Can Hospital A reach Hospital B's clinical data by any route tried?
 *
 * The isolation cases sign in as a REAL Hospital A user through the anon client — exactly what
 * the browser does — and then query with NO hospital filter. Anything belonging to Hospital B
 * that comes back is a leak, and `expectNoCrossTenantRows` (e2e/utils/db-verify.ts) treats a
 * hard RLS denial as a perfectly good outcome. Filtering client-side would prove nothing: the
 * question is what the DATABASE will hand over, not what the UI chooses to display.
 *
 * OPDPage scopes the queue for the `doctor` role with `query.eq("doctor_id", userData.id)`.
 * That is a UI filter, not a security boundary — TC-P4L-004 checks the filter, TC-P4L-011
 * checks the boundary underneath it.
 */
import { test, expect, MOCK, PASSWORD } from '../fixtures/auth.fixture';
import { hospitalIdFor, expectNoCrossTenantRows, db } from '../utils/db-verify';
import { isRouteBlocked } from '../fixtures/auth.fixture';
import { openOpd, registerWalkInButton, admitButton, queueRow, tab } from './opd-locators';
import { registerWalkIn, openTokenAndStart, opdQueueVisible } from './opd-flows';
import { patientIdByUhid, purgeOpdArtefacts, userIdByName, tokensToday } from './opd-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const MOCK_A = MOCK.staff.A;
const FIRST = MOCK.doctorFees[0];
const SECOND = MOCK.doctorFees[2];
const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const B_UHID = (MOCK.phase4.crossTenant as Record<string, string>).hospitalBPatientUhid;

const emailFor = (role: string) => {
  const found = MOCK_A.find(s => s.role === role);
  if (!found) throw new Error(`No Hospital A staff with role "${role}" in mock-data.json`);
  return found.email;
};

async function reset() {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, UHID);
  await purgeOpdArtefacts(hid, [pid]);
  return { hid, pid };
}

test.describe('P4L — RBAC, tenant isolation & permission gates', () => {
  test.afterAll(async () => {
    if (!DB_ON()) return;
    await reset();
  });

  /* ── Role reach ────────────────────────────────────────────────────── */

  test('TC-P4L-001 A doctor can open the OPD module', async ({ page, loginAs }) => {
    await loginAs('doctor', { hospital: 'A' });
    await openOpd(page);
    expect(
      await opdQueueVisible(page),
      'A doctor cannot reach /opd. The role the module exists for is locked out of it.',
    ).toBeTruthy();
  });

  test('TC-P4L-002 A receptionist can open the OPD module', async ({ page, loginAs }) => {
    await loginAs('receptionist', { hospital: 'A' });
    await openOpd(page);
    expect(
      await opdQueueVisible(page),
      'The front desk cannot reach /opd, so no patient can be put into the queue at all.',
    ).toBeTruthy();
  });

  test('TC-P4L-003 A nurse can open the OPD module to record vitals', async ({ page, loginAs }) => {
    await loginAs('nurse', { hospital: 'A' });
    await openOpd(page);
    expect(
      await opdQueueVisible(page),
      'A nurse cannot reach /opd. Vitals are taken by nursing before the doctor sees the patient; ' +
      'locking them out pushes vitals back onto paper.',
    ).toBeTruthy();
  });

  test('TC-P4L-004 A doctor\'s queue shows only their own patients', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { hid, pid } = await reset();
    await loginAs('hospital_admin', { hospital: 'A' });
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: SECOND.department, doctor: SECOND.doctor,
    });
    expect((await tokensToday(hid, pid)).length, 'The setup token was not created.').toBeGreaterThan(0);

    await logout();
    await loginAs('doctor', { hospital: 'A' });   // Dr. Suresh Menon — NOT the surgeon
    await openOpd(page);
    expect(
      await queueRow(page, NAME).count(),
      'A doctor sees a token that belongs to a different consultant. OPDPage filters the queue ' +
      'with .eq("doctor_id", userData.id) — if that filter is gone, every doctor sees the whole ' +
      'hospital\'s OPD and cannot find their own patients.',
    ).toBe(0);
  });

  test('TC-P4L-005 A doctor does see the tokens raised for them', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await reset();
    await loginAs('hospital_admin', { hospital: 'A' });
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });

    await logout();
    await loginAs('doctor', { hospital: 'A' });   // Dr. Suresh Menon — the token's doctor
    await openOpd(page);
    await expect(
      page.getByText(NAME).first(),
      'The doctor cannot see a patient booked with them. The queue filter is excluding the ' +
      'tokens it is supposed to include.',
    ).toBeVisible();
  });

  test('TC-P4L-006 A nurse is not offered the Complete action that raises the consultation charge', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await reset();
    await loginAs('hospital_admin', { hospital: 'A' });
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await openTokenAndStart(page, NAME);

    await logout();
    await loginAs('nurse', { hospital: 'A' });
    await openOpd(page);
    await queueRow(page, NAME).click().catch(() => { /* not in this nurse's queue */ });
    await page.waitForTimeout(1800);
    const { completeButton } = await import('./opd-locators');
    expect(
      await completeButton(page).count(),
      'A nurse can finalise a consultation. Completing is what creates the consultation charge — ' +
      'this gate is a money control as much as a clinical one.',
    ).toBe(0);
  });

  test('TC-P4L-007 A nurse is not offered the Admit action', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await reset();
    await loginAs('hospital_admin', { hospital: 'A' });
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    await openOpd(page);
    await queueRow(page, NAME).click().catch(() => { /* not visible to this role */ });
    await page.waitForTimeout(1800);
    expect(
      await admitButton(page).count(),
      'A nurse can admit a patient — committing a bed and opening an IPD bill on a consultant\'s behalf.',
    ).toBe(0);
  });

  test('TC-P4L-008 A receptionist is not offered the Complete action', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await reset();
    await loginAs('hospital_admin', { hospital: 'A' });
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await openTokenAndStart(page, NAME);
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    await openOpd(page);
    await queueRow(page, NAME).click().catch(() => { /* not selectable */ });
    await page.waitForTimeout(1800);
    const { completeButton } = await import('./opd-locators');
    expect(
      await completeButton(page).count(),
      'The front desk can close a consultation the doctor has not finished, stamping a clinical ' +
      'episode as complete and billing it.',
    ).toBe(0);
  });

  test('TC-P4L-009 A lab technician cannot reach the OPD consultation module', async ({ page, loginAs }) => {
    await loginAs('lab_technician', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, '/opd'),
      'A lab technician can open the OPD workspace, where they can read every patient\'s ' +
      'complaint, diagnosis and prescription. They need the ORDER, not the consultation.',
    ).toBeTruthy();
  });

  test('TC-P4L-010 An accountant cannot reach the OPD consultation module', async ({ page, loginAs }) => {
    await loginAs('accountant', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, '/opd'),
      'An accountant can read clinical notes. Under the DPDP Act 2023 purpose-limitation rule, ' +
      'finance has no lawful basis to see a diagnosis — they need the amount, not the illness.',
    ).toBeTruthy();
  });

  /* ── Tenant isolation ──────────────────────────────────────────────── */

  test('TC-P4L-011 Hospital A cannot read Hospital B\'s OPD tokens', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const bId = await hospitalIdFor('B');
    await expectNoCrossTenantRows('opd_tokens', emailFor('doctor'), PASSWORD, bId);
  });

  test('TC-P4L-012 Hospital A cannot read Hospital B\'s consultation encounters', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const bId = await hospitalIdFor('B');
    await expectNoCrossTenantRows('opd_encounters', emailFor('doctor'), PASSWORD, bId);
  });

  test('TC-P4L-013 Hospital A cannot read Hospital B\'s prescriptions', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const bId = await hospitalIdFor('B');
    await expectNoCrossTenantRows('prescriptions', emailFor('doctor'), PASSWORD, bId);
  });

  test('TC-P4L-014 Hospital A cannot read Hospital B\'s OPD bills', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const bId = await hospitalIdFor('B');
    await expectNoCrossTenantRows('bills', emailFor('billing_executive'), PASSWORD, bId);
  });

  test('TC-P4L-015 A Hospital A user cannot open a Hospital B patient by pasting the UUID', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const bId = await hospitalIdFor('B');
    const { data } = await db().from('patients').select('id, full_name')
      .eq('hospital_id', bId).eq('uhid', B_UHID).maybeSingle();
    test.skip(!data, `Hospital B's isolation-control patient ${B_UHID} is not seeded. Run npm run qa:seed.`);

    await loginAs('doctor', { hospital: 'A' });
    await page.goto(`/patients/${(data as { id: string }).id}/summary`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    expect(
      await page.getByText((data as { full_name: string }).full_name).count(),
      'A Hospital A doctor opened a Hospital B patient by pasting the UUID into the URL. ' +
      'PatientSummaryPage has no hospital_id filter of its own and relies entirely on RLS ' +
      '(Phase 3 Finding, TC-P3J) — if RLS is not holding, there is no second line of defence.',
    ).toBe(0);
  });

  test('TC-P4L-016 A Hospital B doctor sees none of Hospital A\'s OPD queue', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset();
    await loginAs('hospital_admin', { hospital: 'A' });
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    expect((await tokensToday(hid, pid)).length).toBeGreaterThan(0);

    await loginAs('doctor', { hospital: 'B' });
    await openOpd(page);
    expect(
      await page.getByText(NAME).count(),
      'A Hospital B doctor can see a Hospital A patient in their OPD queue. This is the single ' +
      'most serious failure mode in a multi-tenant HMS — one hospital reading another\'s patients.',
    ).toBe(0);
  });
});

void registerWalkInButton; void tab; void userIdByName;
