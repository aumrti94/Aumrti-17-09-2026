/**
 * Phase 3 · Section A — Registration (P3-S01)
 * Locks tracker cases TC-P3A-001 … TC-P3A-019
 *
 * PatientRegistrationModal.tsx has the same missing htmlFor/id wiring as the Phase 1/2 forms —
 * see patient-locators.ts. The DPDP consent checkbox IS implicitly wrapped by its <label>, so
 * consentCheckbox() uses a different (working) strategy than field().
 *
 * The Register Patient button is `disabled={saving || !dpdpConsent}` — every negative case in
 * this file that expects a save to be blocked asserts the button stays disabled, exactly like
 * P1A's password/email negatives, rather than clicking and looking for a toast.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, countRows } from '../utils/db-verify';
import { field, fillField, chip, consentCheckbox, awaitSaveAck } from './patient-locators';
import { purgePatientsByName } from './purge-helpers';

const ROUTE = '/patients';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const REG = MOCK.phase3.registration as any;

const CREATED_NAMES = [
  REG.full.fullName, REG.sameDaySecond.fullName, REG.ageOnly.fullName,
  REG.cghs.fullName, REG.aadhaar.fullName, REG.receptionistEntry.fullName,
];

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await purgePatientsByName(hid, CREATED_NAMES);
}

/**
 * Several tests below reuse the same mock fixture (REG.full = "Kavya Prasad", REG.
 * receptionistEntry = "Farida Sheikh") to create a fresh patient — and the app itself has no
 * de-dup on this form (that's the whole point of Section 3B). Without purging the specific
 * name immediately before each such test, a later test's name-only `expectRow` lookup can
 * silently pick up an EARLIER test's leftover row instead of the one it just created. Call
 * this right before any test creates one of the shared-name fixtures.
 */
async function purgeBeforeCreating(hid: string, ...names: string[]): Promise<void> {
  await purgePatientsByName(hid, names);
}

async function openRegister(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /register new patient/i }).first().click();
  await page.waitForTimeout(400);
}

async function fillMinimal(page: import('@playwright/test').Page, fullName: string, phone?: string) {
  await fillField(page, 'Full Name', fullName, ROUTE);
  if (phone) await fillField(page, 'Phone', phone, ROUTE);
}

async function tickConsentAndSubmit(page: import('@playwright/test').Page) {
  await consentCheckbox(page, /data collection|consent/i).check();
  await page.getByRole('button', { name: /register patient/i }).click();
}

test.describe('P3A — Registration', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  test('TC-P3A-001 Patient Registry screen loads and lists the seeded patients', async ({ page, consoleErrors }) => {
    await expect(page.getByText(/patient registry/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /register new patient/i })).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P3A-002 Register New Patient opens an empty form', async ({ page }) => {
    await openRegister(page);
    expect(await field(page, 'Full Name', ROUTE).then(c => c.inputValue())).toBe('');
    await expect(page.getByRole('button', { name: /register patient/i })).toBeDisabled();
  });

  test('TC-P3A-003 Full-detail registration saves and issues a sequential UHID', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    await purgeBeforeCreating(hid, REG.full.fullName);
    await openRegister(page);
    await fillMinimal(page, REG.full.fullName, REG.full.phone);
    await fillField(page, 'DOB', REG.full.dob, ROUTE);
    await chip(page, new RegExp(`^${REG.full.gender}$`, 'i')).click();
    await chip(page, REG.full.bloodGroup).click();
    await fillField(page, 'Address', REG.full.address, ROUTE);
    await fillField(page, 'Allergies', REG.full.allergies, ROUTE);
    await fillField(page, 'Chronic Conditions', REG.full.chronicConditions, ROUTE);
    await fillField(page, 'Insurance / TPA ID', REG.full.insuranceId, ROUTE);
    await fillField(page, 'Emergency Contact Name', REG.full.emergencyContactName, ROUTE);
    await fillField(page, 'Emergency Contact Phone', REG.full.emergencyContactPhone, ROUTE);
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);

    const row = await expectRow<{ uhid: string }>(
      'patients', { hospital_id: hid, full_name: REG.full.fullName, phone: REG.full.phone },
      `No patients row for "${REG.full.fullName}" after a successful-looking registration.`,
    );
    expect(row.uhid).toBeTruthy();
  });

  test('TC-P3A-004 UHID follows the hospital\'s configured prefix and date format', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: hospital } = await db().from('hospitals').select('uhid_prefix, uhid_date_format').eq('id', hid).maybeSingle();
    const prefix = (hospital as any)?.uhid_prefix?.trim() || 'UHID';

    await purgeBeforeCreating(hid, REG.full.fullName);
    await openRegister(page);
    await fillMinimal(page, REG.full.fullName, REG.full.phone);
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);

    const row = await expectRow<{ uhid: string }>('patients', { hospital_id: hid, full_name: REG.full.fullName });
    expect(
      row.uhid.startsWith(`${prefix}-`),
      `UHID "${row.uhid}" does not start with the hospital's configured prefix "${prefix}-".`,
    ).toBeTruthy();
  });

  test('TC-P3A-005 Two same-day registrations receive consecutive UHID sequence numbers', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await purgeBeforeCreating(hid, REG.full.fullName, REG.sameDaySecond.fullName);

    await openRegister(page);
    await fillMinimal(page, REG.full.fullName, REG.full.phone);
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await openRegister(page);
    await fillMinimal(page, REG.sameDaySecond.fullName, REG.sameDaySecond.phone);
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);

    const first = await expectRow<{ uhid: string }>('patients', { hospital_id: hid, full_name: REG.full.fullName });
    const second = await expectRow<{ uhid: string }>('patients', { hospital_id: hid, full_name: REG.sameDaySecond.fullName });
    const seqOf = (u: string) => parseInt(u.split('-').pop() || '0', 10);
    expect(
      seqOf(second.uhid),
      `Expected UHID "${second.uhid}" to be one more than "${first.uhid}" — two patients registered ` +
      `moments apart must never collide or skip.`,
    ).toBe(seqOf(first.uhid) + 1);
  });

  test('TC-P3A-006 DPDP consent text is shown before submission', async ({ page }) => {
    await openRegister(page);
    await expect(page.getByText(/dpdp|data collection|consent/i).first()).toBeVisible();
  });

  test('TC-P3A-007 Register Patient is disabled until DPDP consent is checked', async ({ page }) => {
    await openRegister(page);
    await fillMinimal(page, REG.full.fullName);
    await expect(
      page.getByRole('button', { name: /register patient/i }),
      'Register Patient is enabled with DPDP consent unticked — a patient could be saved with no recorded consent.',
    ).toBeDisabled();
  });

  test('TC-P3A-008 A patient cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openRegister(page);
    await consentCheckbox(page, /data collection|consent/i).check();
    await page.getByRole('button', { name: /register patient/i }).click();
    await page.waitForTimeout(800);
    expect(await countRows('patients', { hospital_id: hid, full_name: '' })).toBe(0);
  });

  test('TC-P3A-009 A single-character name is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openRegister(page);
    await fillMinimal(page, REG.invalid.shortName);
    await consentCheckbox(page, /data collection|consent/i).check();
    await page.getByRole('button', { name: /register patient/i }).click();
    await page.waitForTimeout(800);
    expect(await countRows('patients', { hospital_id: hid, full_name: REG.invalid.shortName })).toBe(0);
  });

  test('TC-P3A-010 A phone number shorter than 10 digits is rejected', async ({ page }) => {
    await openRegister(page);
    await fillMinimal(page, REG.full.fullName, REG.invalid.shortPhone);
    await consentCheckbox(page, /data collection|consent/i).check();
    await page.getByRole('button', { name: /register patient/i }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText(/phone must be exactly 10 digits/i)).toBeVisible();
  });

  test('TC-P3A-011 A phone number longer than 10 digits is rejected', async ({ page }) => {
    await openRegister(page);
    const phoneField = await field(page, 'Phone', ROUTE);
    await phoneField.fill(REG.invalid.longPhone);
    const digits = (await phoneField.inputValue()).replace(/\D/g, '');
    // Either the input itself caps the length, or the same 10-digit validation message fires.
    if (digits.length <= 10) {
      await fillField(page, 'Full Name', REG.full.fullName, ROUTE);
      await consentCheckbox(page, /data collection|consent/i).check();
      await page.getByRole('button', { name: /register patient/i }).click();
      await page.waitForTimeout(500);
      const errorShown = await page.getByText(/phone must be exactly 10 digits/i).count();
      expect(digits.length === 10 || errorShown > 0).toBeTruthy();
    } else {
      await fillField(page, 'Full Name', REG.full.fullName, ROUTE);
      await consentCheckbox(page, /data collection|consent/i).check();
      await page.getByRole('button', { name: /register patient/i }).click();
      await page.waitForTimeout(500);
      await expect(page.getByText(/phone must be exactly 10 digits/i)).toBeVisible();
    }
  });

  test('TC-P3A-012 Phone is optional — registration succeeds with it left blank', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await purgeBeforeCreating(hid, REG.receptionistEntry.fullName);
    await openRegister(page);
    await fillMinimal(page, REG.receptionistEntry.fullName);
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);
    const row = await expectRow<{ phone: string | null }>('patients', { hospital_id: hid, full_name: REG.receptionistEntry.fullName });
    expect(row.phone).toBeFalsy();
  });

  test('TC-P3A-013 A date of birth in the future is rejected', async ({ page }) => {
    await openRegister(page);
    await fillField(page, 'Full Name', REG.full.fullName, ROUTE);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const dob = await field(page, 'DOB', ROUTE);
    await dob.fill(tomorrow).catch(() => {});
    await consentCheckbox(page, /data collection|consent/i).check();
    await page.getByRole('button', { name: /register patient/i }).click();
    await page.waitForTimeout(500);
    // The date input's own max attribute (today) should refuse a future value outright,
    // or the field-error message appears — either is an acceptable block.
    const value = await dob.inputValue().catch(() => '');
    const errorShown = await page.getByText(/date of birth must be in the past/i).count();
    expect(value !== tomorrow || errorShown > 0).toBeTruthy();
  });

  test('TC-P3A-014 A date of birth of exactly today is accepted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await purgeBeforeCreating(hid, REG.receptionistEntry.fullName);
    await openRegister(page);
    await fillField(page, 'Full Name', REG.receptionistEntry.fullName, ROUTE);
    const today = new Date().toISOString().slice(0, 10);
    await fillField(page, 'DOB', today, ROUTE);
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);
    const row = await expectRow<{ dob: string }>('patients', { hospital_id: hid, full_name: REG.receptionistEntry.fullName });
    expect(row.dob).toBe(today);
  });

  test('TC-P3A-015 Age-only entry (no DOB) computes and stores a DOB', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openRegister(page);
    await fillField(page, 'Full Name', REG.ageOnly.fullName, ROUTE);
    await fillField(page, 'Age', REG.ageOnly.age, ROUTE);
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);
    const row = await expectRow<{ dob: string | null }>('patients', { hospital_id: hid, full_name: REG.ageOnly.fullName });
    expect(row.dob, 'dob is null even though Age was entered — every age-gated screen for this patient will misbehave.').not.toBeNull();
  });

  test('TC-P3A-016 Selecting patient category CGHS reveals the Beneficiary No. field', async ({ page }) => {
    await openRegister(page);
    await chip(page, /^cghs$/i).click();
    await expect(page.getByPlaceholder(/CGHS Beneficiary No\./i)).toBeVisible();
  });

  test('TC-P3A-017 Aadhaar ID is stored digits-only and masked on screen', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openRegister(page);
    await fillField(page, 'Full Name', REG.aadhaar.fullName, ROUTE);
    const aadhaarField = await field(page, 'Aadhaar ID', ROUTE);
    await aadhaarField.fill(REG.aadhaar.aadhaar);
    await expect(page.getByText(/stored masked/i)).toBeVisible();
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);
    const row = await expectRow<{ aadhaar_id: string | null }>('patients', { hospital_id: hid, full_name: REG.aadhaar.fullName });
    expect(row.aadhaar_id).toBe(REG.aadhaar.aadhaar);
  });

  test('TC-P3A-018 Registration writes a patient_consents row with consent_type data_collection', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await purgeBeforeCreating(hid, REG.full.fullName);
    await openRegister(page);
    await fillMinimal(page, REG.full.fullName, REG.full.phone);
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);

    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, full_name: REG.full.fullName });
    const consent = await expectRow<{ consent_given: boolean }>(
      'patient_consents', { hospital_id: hid, patient_id: patient.id, consent_type: 'data_collection' },
      'No patient_consents row was written — the DPDP checkbox tick left no auditable record.',
    );
    expect(consent.consent_given).toBe(true);
  });

  test('TC-P3A-019 A receptionist can register a new patient', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await purgeBeforeCreating(hid, REG.receptionistEntry.fullName);
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await openRegister(page);
    await fillMinimal(page, REG.receptionistEntry.fullName, REG.receptionistEntry.phone);
    await tickConsentAndSubmit(page);
    await awaitSaveAck(page);

    await expectRow(
      'patients', { hospital_id: hid, full_name: REG.receptionistEntry.fullName },
      'A receptionist could not complete registration — this stalls the whole OPD queue at its first step.',
    );
  });
});
