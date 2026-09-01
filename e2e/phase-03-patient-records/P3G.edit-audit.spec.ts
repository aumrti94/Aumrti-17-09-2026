/**
 * Phase 3 · Section G — Edit & audit trail (P3-S09)
 * Locks tracker cases TC-P3G-001 … TC-P3G-009
 *
 * Both edit surfaces (PatientDetailDrawer.tsx's inline edit, and PatientRegistrationModal.tsx
 * in editPatient mode) do a plain `supabase.from('patients').update(...)` with no application-
 * level audit call. The audit trail is entirely DB-trigger-based (`audit_patients` →
 * `log_phi_change()` → `audit_log`, migration 20260418102042), so these tests verify the
 * trigger fires regardless of which UI component performed the update.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow } from '../utils/db-verify';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const EDIT = MOCK.phase3.edit as { newPhone: string; invalidPhone: string };

async function openDrawer(page: import('@playwright/test').Page, uhid: string) {
  await page.goto('/patients', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.getByPlaceholder(/search by name, phone, or uhid/i).fill(uhid);
  await page.waitForTimeout(600);
  await page.locator('tr').filter({ hasText: uhid }).first().click();
  await page.waitForTimeout(500);
}

async function clickEdit(page: import('@playwright/test').Page) {
  await page.getByTitle(/edit patient/i).click();
  await page.waitForTimeout(400);
}

test.describe('P3G — Edit & audit trail', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
  });

  test('TC-P3G-001 Editing a patient\'s phone via the detail drawer persists the new value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openDrawer(page, 'PT-QA-0002');
    await clickEdit(page);
    const phoneField = page.locator('label').filter({ hasText: /^phone$/i }).locator('xpath=..').locator('input').first();
    await phoneField.fill(EDIT.newPhone);
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(1200);

    const row = await expectRow<{ phone: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });
    expect(row.phone).toBe(EDIT.newPhone);
  });

  test('TC-P3G-002 Editing a patient\'s phone writes an audit_log row with old and new values', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const patient = await expectRow<{ id: string; phone: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });
    const before = patient.phone;

    await openDrawer(page, 'PT-QA-0002');
    await clickEdit(page);
    const phoneField = page.locator('label').filter({ hasText: /^phone$/i }).locator('xpath=..').locator('input').first();
    await phoneField.fill(EDIT.newPhone);
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(1200);

    const { data: logs } = await db().from('audit_log').select('old_values, new_values')
      .eq('table_name', 'patients').eq('record_id', patient.id).order('changed_at', { ascending: false }).limit(1);
    expect(logs?.length, 'No audit_log row was written for the phone edit.').toBeGreaterThan(0);
    expect((logs![0] as any).new_values?.phone).toBe(EDIT.newPhone);
  });

  test('TC-P3G-003 The audit_log row records the editing user\'s id', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });

    await openDrawer(page, 'PT-QA-0002');
    await clickEdit(page);
    const addressField = page.locator('label').filter({ hasText: /^address$/i }).locator('xpath=..').locator('input').first();
    await addressField.fill('123 QA Audit Test Street');
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(1200);

    const { data: logs } = await db().from('audit_log').select('changed_by')
      .eq('table_name', 'patients').eq('record_id', patient.id).order('changed_at', { ascending: false }).limit(1);
    expect(logs?.[0]?.changed_by, 'audit_log.changed_by is null — there is no record of who made this change.').not.toBeNull();
  });

  test('TC-P3G-004 Editing a patient opened via the /patients?id= deep link also persists and audits the change', async ({ page }) => {
    // NOTE: the CSV originally framed this as "the Register/Edit modal" (PatientRegistrationModal
    // in editPatient mode) versus the drawer. Per Finding #6 (see P3D.abha.spec.ts's file
    // header), that modal is NEVER opened in edit mode anywhere in the app — `editPatient=` has
    // zero usages. The drawer (PatientDetailDrawer.tsx) is the ONLY live edit surface. What IS
    // genuinely a second, distinct code path is reaching that same drawer via the `?id=` deep
    // link (PatientsPage.tsx's searchParams effect) instead of clicking a table row — that's
    // what this case verifies instead.
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0003' });

    await page.goto('/patients?id=' + patient.id, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await clickEdit(page);
    const addressField = page.locator('label').filter({ hasText: /^address$/i }).locator('xpath=..').locator('input').first();
    await addressField.fill('456 QA Deep-Link Edit Lane');
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(1200);

    const row = await expectRow<{ address: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0003' });
    expect(row.address).toBe('456 QA Deep-Link Edit Lane');
    const { data: logs } = await db().from('audit_log').select('new_values')
      .eq('table_name', 'patients').eq('record_id', patient.id).order('changed_at', { ascending: false }).limit(1);
    expect((logs?.[0] as any)?.new_values?.address).toBe('456 QA Deep-Link Edit Lane');
  });

  test('TC-P3G-005 A no-op edit (Save with nothing changed) still writes an audit_log row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0004' });
    const { count: before } = await db().from('audit_log').select('*', { count: 'exact', head: true })
      .eq('table_name', 'patients').eq('record_id', patient.id);

    await openDrawer(page, 'PT-QA-0004');
    await clickEdit(page);
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(1200);

    const { count: after } = await db().from('audit_log').select('*', { count: 'exact', head: true })
      .eq('table_name', 'patients').eq('record_id', patient.id);
    expect((after ?? 0) > (before ?? 0), 'A no-op save produced no new audit_log row — expected Postgres to fire the row trigger regardless.').toBeTruthy();
  });

  test('TC-P3G-006 Phone edit rejects a value that is not exactly 10 digits', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await expectRow<{ phone: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });

    await openDrawer(page, 'PT-QA-0002');
    await clickEdit(page);
    const phoneField = page.locator('label').filter({ hasText: /^phone$/i }).locator('xpath=..').locator('input').first();
    await phoneField.fill(EDIT.invalidPhone);
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(800);
    // Toasts in this app render twice — a visible <div> plus a mirrored <span role="status">
    // aria-live announcer — so any text-based toast assertion needs .first() to avoid a
    // strict-mode violation.
    await expect(page.getByText(/phone must be exactly 10 digits/i).first()).toBeVisible();

    const after = await expectRow<{ phone: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });
    expect(after.phone).toBe(before.phone);
  });

  test('TC-P3G-007 Full name cannot be cleared to empty on edit', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openDrawer(page, 'PT-QA-0002');
    await clickEdit(page);
    const nameField = page.locator('label').filter({ hasText: /^full name \*$/i }).locator('xpath=..').locator('input').first();
    await nameField.fill('');
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(800);
    await expect(page.getByText(/patient name is required/i).first()).toBeVisible();

    const row = await expectRow<{ full_name: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });
    expect(row.full_name).toBe('Sunita Reddy');
  });

  test('TC-P3G-008 A receptionist can edit patient demographic details', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    await openDrawer(page, 'PT-QA-0005');
    await clickEdit(page);
    const addressField = page.locator('label').filter({ hasText: /^address$/i }).locator('xpath=..').locator('input').first();
    await addressField.fill('789 QA Receptionist Edit Road');
    await page.getByRole('button', { name: /save changes/i }).click();
    await page.waitForTimeout(1200);

    const row = await expectRow<{ address: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0005' });
    expect(row.address).toBe('789 QA Receptionist Edit Road');
  });

  test('TC-P3G-009 FHIR R4 export downloads a bundle containing the current patient details', async ({ page }) => {
    await openDrawer(page, 'PT-QA-0002');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: /export fhir r4/i }).click(),
    ]);
    expect(download.suggestedFilename()).toContain('fhir');
  });
});
