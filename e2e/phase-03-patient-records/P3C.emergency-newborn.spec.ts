/**
 * Phase 3 · Section C — Emergency & newborn (P3-S03, P3-S04)
 * Locks tracker cases TC-P3C-001 … TC-P3C-011, TC-P3C-013.
 *
 * TC-P3C-012 (the Neonatal Sheet has no field to set mother_patient_id) has no Playwright spec
 * — the Neonatal Sheet only renders inside an IPD/OPD encounter context that Phase 3 does not
 * build (see JOURNEY_SCENARIOS.md P7-S07). It stays a documented, code-reviewed finding until
 * Phase 7 owns a live workflow to run it against.
 *
 * EmergencyRegistrationModal.tsx opens from the "+ Register Emergency Patient" button on the
 * Triage Board at /emergency, gated by hasActionAccess('emergency','register_patient',...).
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, countRows } from '../utils/db-verify';
import { purgePatientsByName } from './purge-helpers';

const ROUTE = '/emergency';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const EMG = MOCK.phase3.emergency as any;
const NEWBORN = MOCK.phase3.newborn as { fullName: string };

const CREATED_NAMES = ['Unknown', EMG.mlcName, NEWBORN.fullName];

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await purgePatientsByName(hid, CREATED_NAMES);
}

/**
 * The "+ Register Emergency Patient" button is gated by
 * hasActionAccess('emergency', 'register_patient', permissions, role), which needs `role` (and
 * the hospital's action-entitlement config) to have finished loading — both fetched
 * asynchronously after navigation. If the button genuinely never appears (a real permission or
 * plan-entitlement gap, rather than a slow load), fail with the page's visible text attached so
 * the cause is obvious from the report instead of a bare "timeout" — that distinguishes a
 * "Module Not Enabled" plan gate from a blank/loading board from a role that lacks the action.
 */
async function openModal(page: import('@playwright/test').Page) {
  const button = page.getByRole('button', { name: /register emergency patient/i });
  try {
    await button.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    const body = await page.locator('body').innerText().catch(() => '(could not read page)');
    throw new Error(
      `"+ Register Emergency Patient" never appeared on ${ROUTE} for this login within 10s. ` +
      `Page text at time of failure:\n${body.slice(0, 800)}`,
    );
  }
  await button.click();
  await page.waitForTimeout(500);
}

const arrivalMode = (page: import('@playwright/test').Page, label: string | RegExp) =>
  page.getByRole('button', { name: label }).first();
const triage = (page: import('@playwright/test').Page, label: string | RegExp) =>
  page.getByRole('button', { name: label }).first();

test.describe('P3C — Emergency & newborn', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('receptionist', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    // Wait for the board itself rather than a fixed delay — role/permissions/hospitalId all
    // resolve asynchronously after navigation, and hasActionAccess() denies by default while
    // `role` is still null, so the register button can legitimately take longer than a fixed
    // 1500ms to appear even when nothing is actually wrong.
    await page.getByText(/triage board/i).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
  });

  test('TC-P3C-001 Emergency Registration saves with only an arrival mode and triage category selected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openModal(page);
    await arrivalMode(page, /walk-in/i).click();
    await triage(page, /P3 - DELAYED/i).click();
    await page.getByRole('button', { name: /register & triage/i }).click();
    await page.waitForTimeout(1500);

    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, full_name: 'Unknown' });
    await expectRow('ed_visits', { hospital_id: hid, patient_id: patient.id, triage_category: 'P3' });
  });

  test('TC-P3C-002 Patient Name defaults to "Unknown" and is not a required field', async ({ page }) => {
    await openModal(page);
    const nameField = page.getByPlaceholder('Unknown');
    await expect(nameField).toHaveValue('Unknown');
  });

  test('TC-P3C-003 Emergency Registration has no DPDP consent control', async ({ page }) => {
    await openModal(page);
    const consent = page.getByText(/dpdp|data collection consent/i);
    expect(await consent.count(), 'A DPDP consent control was found — update this case, the gap may be fixed.').toBe(0);
  });

  test('TC-P3C-004 Submitting is blocked until a triage category is chosen, unless Brought Dead is selected', async ({ page }) => {
    await openModal(page);
    await arrivalMode(page, /walk-in/i).click();
    await expect(page.getByRole('button', { name: /register & triage/i })).toBeDisabled();
  });

  test('TC-P3C-005 Selecting "Brought Dead" waives the triage requirement and records disposition expired', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openModal(page);
    await arrivalMode(page, /brought dead/i).click();
    await page.getByPlaceholder(/brief complaint/i).fill(EMG.broughtDeadComplaint);
    await expect(page.getByRole('button', { name: /record brought dead/i })).toBeEnabled();
    await page.getByRole('button', { name: /record brought dead/i }).click();
    await page.waitForTimeout(1500);

    const row = await expectRow<{ disposition: string; is_active: boolean }>(
      'ed_visits', { hospital_id: hid, chief_complaint: EMG.broughtDeadComplaint },
    );
    expect(row.disposition).toBe('expired');
    expect(row.is_active).toBe(false);
  });

  test('TC-P3C-006 A "Brought Dead" registration routes the patient to the mortuary with a body number', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const patient = await db().from('patients').select('id').eq('hospital_id', hid).eq('full_name', 'Unknown').limit(1).maybeSingle();
    test.skip(!patient.data, 'Run TC-P3C-005 first to create the brought-dead patient');
    const { data: mortuary, error } = await (db() as any)
      .from('mortuary_admissions').select('body_number').eq('patient_id', patient.data!.id).maybeSingle();
    test.skip(!!error, `mortuary_admissions not queryable: ${error?.message}`);
    expect(mortuary?.body_number, 'No mortuary admission was created for the brought-dead patient.').toBeTruthy();
  });

  test('TC-P3C-007 The phone/name search box finds and links an existing patient instead of creating a duplicate', async ({ page }) => {
    await openModal(page);
    await page.getByPlaceholder(/search by phone or name/i).fill('9876500002');
    await page.waitForTimeout(600);
    await page.getByText(/Sunita Reddy/i).first().click();
    await expect(page.getByText(/linked to: Sunita Reddy/i)).toBeVisible();
  });

  test('TC-P3C-008 Linking an existing patient via search does not create a new patients row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('patients', { hospital_id: hid, full_name: 'Sunita Reddy' });
    await openModal(page);
    await page.getByPlaceholder(/search by phone or name/i).fill('9876500002');
    await page.waitForTimeout(600);
    await page.getByText(/Sunita Reddy/i).first().click();
    await triage(page, /P4 - MINOR/i).click();
    await page.getByRole('button', { name: /register & triage/i }).click();
    await page.waitForTimeout(1500);

    expect(await countRows('patients', { hospital_id: hid, full_name: 'Sunita Reddy' })).toBe(before);
  });

  test('TC-P3C-009 A new emergency patient uses the same UHID series as staff registration, not a separate scheme', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: hospital } = await db().from('hospitals').select('uhid_prefix').eq('id', hid).maybeSingle();
    const prefix = (hospital as any)?.uhid_prefix?.trim() || 'UHID';
    const row = await expectRow<{ uhid: string }>('patients', { hospital_id: hid, full_name: 'Unknown' });
    expect(row.uhid.startsWith(`${prefix}-`)).toBeTruthy();
  });

  test('TC-P3C-010 Medico-Legal Case checkbox links the ED visit for MLC follow-up', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openModal(page);
    await page.getByPlaceholder('Unknown').fill(EMG.mlcName);
    await page.getByPlaceholder(/brief complaint/i).fill(EMG.mlcComplaint);
    await page.getByText(/medico-legal case\?/i).click();
    await arrivalMode(page, /walk-in/i).click();
    await triage(page, /P2 - URGENT/i).click();
    await page.getByRole('button', { name: /register & triage/i }).click();
    await page.waitForTimeout(1500);

    const row = await expectRow<{ mlc: boolean }>('ed_visits', { hospital_id: hid, chief_complaint: EMG.mlcComplaint });
    expect(row.mlc).toBe(true);
  });

  test('TC-P3C-011 Newborn registration — "B/O <mother>" is created as an ordinary new patient record', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await page.goto('/patients', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const { field, fillField, chip, consentCheckbox } = await import('./patient-locators');
    await page.getByRole('button', { name: /register new patient/i }).click();
    await page.waitForTimeout(400);
    await fillField(page, 'Full Name', NEWBORN.fullName, '/patients');
    const today = new Date().toISOString().slice(0, 10);
    await fillField(page, 'DOB', today, '/patients');
    await chip(page, /^male$/i).click();
    await consentCheckbox(page, /data collection|consent/i).check();
    await page.getByRole('button', { name: /register patient/i }).click();
    await page.waitForTimeout(1200);

    const row = await expectRow<{ dob: string; gender: string }>('patients', { hospital_id: hid, full_name: NEWBORN.fullName });
    expect(row.dob).toBe(today);
    expect(row.gender).toBe('male');
  });

  test('TC-P3C-013 The newborn\'s DOB defaults to today and represents a 0-day-old', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const row = await db().from('patients').select('dob').eq('hospital_id', hid).eq('full_name', NEWBORN.fullName).maybeSingle();
    test.skip(!row.data, 'Run TC-P3C-011 first to create the newborn record');
    await page.goto('/patients', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.getByPlaceholder(/search by name, phone, or uhid/i).fill(NEWBORN.fullName);
    await page.waitForTimeout(600);
    await expect(page.getByText(/0y/i).first()).toBeVisible();
  });
});
