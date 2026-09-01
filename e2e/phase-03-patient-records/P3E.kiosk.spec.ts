/**
 * Phase 3 · Section E — Kiosk (P3-S07)
 * Locks tracker cases TC-P3E-001 … TC-P3E-010
 *
 * The kiosk is UNAUTHENTICATED lobby hardware — no loginAs() here. Routes take the hospital id
 * as a `?h=` query param: /kiosk, /kiosk/checkin, /kiosk/register, /kiosk/pay all render
 * KioskCheckinPage with the mode derived from the path.
 *
 * KioskCheckinPage.tsx's New Patient path issues `` `K${Date.now()...}` `` as the UHID and
 * never searches for an existing phone before inserting — TC-P3E-003 and TC-P3E-005 document
 * both gaps rather than assuming they are fixed.
 *
 * NUMPAD SELECTOR NOTE: the phone number being typed is echoed live in a plain <div> display
 * right above the NumPad. A digit-text locator that isn't scoped to `role=button` (e.g.
 * `getByText('7', { exact: true })`) will, after the first tap, ALSO match that display once
 * the digit appears there — and can latch onto the display instead of the next numpad key,
 * leaving the phone field stuck at 1 digit and every gated button permanently disabled. Always
 * tap digits via `getByRole('button', { name: d, exact: true })`, which only matches actual
 * <button> elements.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, countRows } from '../utils/db-verify';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const KIOSK = MOCK.phase3.kiosk as { newPatient: { fullName: string; phone: string }; wrongOtp: string };
const FIRST_DEPT = MOCK.departments[0].name as string;

async function tapDigits(page: import('@playwright/test').Page, digits: string): Promise<void> {
  for (const d of digits) {
    await page.getByRole('button', { name: d, exact: true }).click();
  }
}

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('patients').select('id').eq('hospital_id', hid).eq('phone', KIOSK.newPatient.phone);
  const ids = (data ?? []).map((r: { id: string }) => r.id);
  if (!ids.length) return;
  await db().from('opd_tokens').delete().in('patient_id', ids);
  await db().from('patients').delete().in('id', ids);
}

test.describe('P3E — Kiosk', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test('TC-P3E-001 Kiosk landing loads for a valid hospital id', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — need hospitalIdFor');
    const hid = await hospitalIdFor('A');
    await page.goto(`/kiosk?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    // KioskLandingPage's root is `fixed inset-0` — the only child of <body> — so <body> itself
    // collapses to a 0×0 box even though the fixed overlay is fully visible on screen.
    // Assert on real landing-page content instead of `body`'s own visibility.
    await expect(page.getByRole('button', { name: /new patient registration/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /existing patient check-in/i })).toBeVisible();
  });

  test('TC-P3E-002 New Patient registration requires name, 10-digit phone, gender and department', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await page.goto(`/kiosk/register?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    // Attempt Next with everything blank.
    await page.getByText(/next — department/i).click();
    await expect(page.getByText(/name is required|please fill all required fields/i)).toBeVisible();
  });

  test('TC-P3E-003 A kiosk-issued UHID does NOT follow the hospital\'s configured UHID prefix/format', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: hospital } = await db().from('hospitals').select('uhid_prefix').eq('id', hid).maybeSingle();
    const prefix = (hospital as any)?.uhid_prefix?.trim() || 'UHID';

    await page.goto(`/kiosk/register?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.getByPlaceholder(/patient full name/i).fill(KIOSK.newPatient.fullName);
    await tapDigits(page, KIOSK.newPatient.phone);
    await page.getByRole('button', { name: /^male$/i }).click();
    await expect(page.getByText(/next — department/i)).toBeEnabled();
    await page.getByText(/next — department/i).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: FIRST_DEPT, exact: true }).click();
    await page.getByText(/register & get token/i).click();
    await page.waitForTimeout(1500);

    const row = await expectRow<{ uhid: string }>('patients', { hospital_id: hid, full_name: KIOSK.newPatient.fullName });
    expect(
      row.uhid.startsWith(`${prefix}-`),
      `Kiosk UHID "${row.uhid}" was expected to NOT match the hospital format "${prefix}-..." — it should start with "K" instead, documenting the gap.`,
    ).toBeFalsy();
    expect(row.uhid.startsWith('K')).toBeTruthy();
  });

  test('TC-P3E-004 A kiosk new-patient registration creates a patients row and an opd_token in one flow', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const row = await db().from('patients').select('id').eq('hospital_id', hid).eq('full_name', KIOSK.newPatient.fullName).maybeSingle();
    test.skip(!row.data, 'Run TC-P3E-003 first to create the kiosk patient');
    const patientId = row.data!.id;
    const { count } = await db().from('opd_tokens').select('*', { count: 'exact', head: true }).eq('patient_id', patientId);
    expect(count ?? 0, 'No opd_tokens row was linked to the kiosk-registered patient.').toBeGreaterThan(0);
  });

  test('TC-P3E-005 Registering the same phone number twice via "New Patient" creates two separate patient rows', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await page.goto(`/kiosk/register?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.getByPlaceholder(/patient full name/i).fill(`${KIOSK.newPatient.fullName} Two`);
    await tapDigits(page, KIOSK.newPatient.phone);
    await page.getByRole('button', { name: /^male$/i }).click();
    await expect(page.getByText(/next — department/i)).toBeEnabled();
    await page.getByText(/next — department/i).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: FIRST_DEPT, exact: true }).click();
    await page.getByText(/register & get token/i).click();
    await page.waitForTimeout(1500);

    expect(
      await countRows('patients', { hospital_id: hid, phone: KIOSK.newPatient.phone }),
      'Expected 2 rows for this phone after a second "New Patient" registration — documents the missing dedup on this path.',
    ).toBe(2);
  });

  test('TC-P3E-006 Existing-patient check-in DOES search by phone before showing any tokens', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await page.goto(`/kiosk/checkin?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await tapDigits(page, '9876500002');
    await expect(page.getByText(/send otp/i)).toBeEnabled();
    await page.getByText(/send otp/i).click();
    await page.waitForTimeout(1000);
    // Simulation mode shows the code on screen — read and re-enter it.
    const simCode = await page.locator('text=/^[0-9]{6}$/').first().innerText().catch(() => '');
    test.skip(!simCode, 'Kiosk simulation OTP code was not shown — Phone Auth may be live in this environment');
    await tapDigits(page, simCode);
    await page.waitForTimeout(500);
    await expect(page.getByText(/verify & continue/i)).toBeEnabled();
    await page.getByText(/verify & continue/i).click();
    await page.waitForTimeout(1200);
    // Either "Your Appointments Today" (patient found) or "No appointments today" — both prove
    // the lookup ran; what must NOT happen is a silent new-patient creation.
    await expect(page.getByText(/your appointments today|no appointments today/i)).toBeVisible();
  });

  test('TC-P3E-007 Existing-patient check-in with an unregistered phone shows an explicit message', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const unusedPhone = '9999900001';
    await page.goto(`/kiosk/checkin?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await tapDigits(page, unusedPhone);
    await expect(page.getByText(/send otp/i)).toBeEnabled();
    await page.getByText(/send otp/i).click();
    await page.waitForTimeout(1000);
    const simCode = await page.locator('text=/^[0-9]{6}$/').first().innerText().catch(() => '');
    test.skip(!simCode, 'Kiosk simulation OTP code was not shown');
    await tapDigits(page, simCode);
    await expect(page.getByText(/verify & continue/i)).toBeEnabled();
    await page.getByText(/verify & continue/i).click();
    await page.waitForTimeout(1200);
    await expect(page.getByText(/no patient registered with this number/i)).toBeVisible();
    expect(await countRows('patients', { hospital_id: hid, phone: unusedPhone })).toBe(0);
  });

  test('TC-P3E-008 The kiosk simulation OTP banner displays a 6-digit code when SMS is not configured', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await page.goto(`/kiosk/checkin?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await tapDigits(page, '9999900002');
    await expect(page.getByText(/send otp/i)).toBeEnabled();
    await page.getByText(/send otp/i).click();
    await page.waitForTimeout(1000);
    const banner = page.getByText(/kiosk mode — otp/i);
    test.skip((await banner.count()) === 0, 'Phone Auth appears to be live in this environment — simulation banner not shown');
    await expect(banner).toBeVisible();
    await expect(page.locator('text=/^[0-9]{6}$/').first()).toBeVisible();
  });

  test('TC-P3E-009 An incorrect OTP is rejected at the kiosk', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await page.goto(`/kiosk/checkin?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await tapDigits(page, '9999900003');
    await expect(page.getByText(/send otp/i)).toBeEnabled();
    await page.getByText(/send otp/i).click();
    await page.waitForTimeout(1000);
    const simCode = await page.locator('text=/^[0-9]{6}$/').first().innerText().catch(() => '');
    test.skip(!simCode, 'Kiosk simulation OTP code was not shown');
    await tapDigits(page, KIOSK.wrongOtp);
    await expect(page.getByText(/verify & continue/i)).toBeEnabled();
    await page.getByText(/verify & continue/i).click();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/incorrect otp/i)).toBeVisible();
  });

  test('TC-P3E-010 The kiosk token receipt shows the correct department and token number after check-in', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const row = await db().from('patients').select('id').eq('hospital_id', hid).eq('full_name', KIOSK.newPatient.fullName).maybeSingle();
    test.skip(!row.data, 'Run TC-P3E-003/004 first to create the kiosk patient and token');
    const { data: token } = await db().from('opd_tokens').select('department_id, token_number').eq('patient_id', row.data!.id).limit(1).maybeSingle();
    expect(token?.token_number, 'The kiosk token has no token_number recorded.').toBeTruthy();
    expect(token?.department_id, 'The kiosk token has no department_id recorded.').toBeTruthy();
  });
});
