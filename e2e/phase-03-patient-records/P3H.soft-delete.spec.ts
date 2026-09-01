/**
 * Phase 3 · Section H — Soft-delete / erasure (P3-S10) 🔴
 * Locks tracker cases TC-P3H-001 … TC-P3H-011
 *
 * PatientDetailDrawer.tsx's handleDelete() sets `patients.is_active = false` — it is guarded
 * by an active-admission check and an unpaid-bill check, and it is genuinely one-way: there is
 * no Reactivate control anywhere on the Patients screens (TC-P3H-010 documents this).
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, countRows } from '../utils/db-verify';
import { consentCheckbox, fillField } from './patient-locators';
import { purgePatientsByName } from './purge-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const REG = MOCK.phase3.registration as any;
const DISPOSABLE = REG.receptionistEntry.fullName as string; // reused as the throwaway delete-test patient

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await purgePatientsByName(hid, [DISPOSABLE]);
}

async function registerDisposablePatient(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/patients', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /register new patient/i }).click();
  await page.waitForTimeout(400);
  await fillField(page, 'Full Name', DISPOSABLE, '/patients');
  await fillField(page, 'Phone', REG.receptionistEntry.phone, '/patients');
  await consentCheckbox(page, /data collection|consent/i).check();
  await page.getByRole('button', { name: /register patient/i }).click();
  await page.waitForTimeout(1200);
}

async function openDrawerFor(page: import('@playwright/test').Page, name: string) {
  await page.goto('/patients', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.getByPlaceholder(/search by name, phone, or uhid/i).fill(name);
  await page.waitForTimeout(600);
  await page.locator('tr').filter({ hasText: name }).first().click();
  await page.waitForTimeout(500);
}

test.describe('P3H — Soft-delete / erasure', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
  });

  test('TC-P3H-001 Deleting a patient sets is_active=false rather than removing the row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await registerDisposablePatient(page);
    await openDrawerFor(page, DISPOSABLE);
    await page.getByTitle(/delete patient/i).click();
    await page.getByRole('button', { name: /delete patient/i }).click();
    await page.waitForTimeout(1200);

    const row = await expectRow<{ is_active: boolean }>('patients', { hospital_id: hid, full_name: DISPOSABLE });
    expect(row.is_active).toBe(false);
  });

  test('TC-P3H-002 A soft-deleted patient is excluded from the default patient list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await page.goto('/patients', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    // Scoped to table rows, not a bare text search — a single row's name+badge can otherwise
    // resolve as multiple "elements" (the <tr>, the <td>, and the cell's combined text with the
    // "Inactive" badge all separately contain the substring "Farida Sheikh").
    await expect(page.locator('tr').filter({ hasText: DISPOSABLE })).toHaveCount(0);
  });

  test('TC-P3H-003 A soft-deleted patient reappears when "Show Inactive" is toggled on', async ({ page }) => {
    await page.goto('/patients', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.getByText(/show inactive/i).click();
    await page.waitForTimeout(1000);
    const row = page.locator('tr').filter({ hasText: DISPOSABLE });
    await expect(row).toHaveCount(1);
    await expect(row.getByText(/inactive/i).first()).toBeVisible();
  });

  test('TC-P3H-004 A soft-deleted patient is excluded from search by default', async ({ page }) => {
    await page.goto('/patients', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.getByPlaceholder(/search by name, phone, or uhid/i).fill(DISPOSABLE);
    await page.waitForTimeout(600);
    await expect(page.locator('tr').filter({ hasText: DISPOSABLE })).toHaveCount(0);
  });

  test('TC-P3H-005 Delete is blocked for a patient with an active (non-discharged) admission', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: admitted } = await db().from('admissions').select('patient_id')
      .eq('hospital_id', hid).neq('status', 'discharged').limit(1);
    test.skip(!admitted?.length, 'No Hospital A patient has an active admission yet — this is a Phase 7 (IPD) fixture.');
    const { data: patient } = await db().from('patients').select('full_name').eq('id', admitted![0].patient_id).maybeSingle();
    test.skip(!patient, 'Could not resolve the admitted patient');

    await openDrawerFor(page, patient!.full_name);
    await page.getByTitle(/delete patient/i).click();
    await expect(page.getByText(/cannot delete patient with active admissions/i)).toBeVisible({ timeout: 8_000 });

    const row = await expectRow<{ is_active: boolean }>('patients', { id: admitted![0].patient_id });
    expect(row.is_active).toBe(true);
  });

  test('TC-P3H-006 Delete is blocked for a patient with an unpaid bill', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: unpaid } = await db().from('bills').select('patient_id')
      .eq('hospital_id', hid).not('payment_status', 'in', '(paid,cancelled)').limit(1);
    test.skip(!unpaid?.length, 'No Hospital A patient has an unpaid bill yet — this is a Phase 8 (Billing) fixture.');
    const { data: patient } = await db().from('patients').select('full_name').eq('id', unpaid![0].patient_id).maybeSingle();
    test.skip(!patient, 'Could not resolve the patient with the unpaid bill');

    await openDrawerFor(page, patient!.full_name);
    await page.getByTitle(/delete patient/i).click();
    await expect(page.getByText(/cannot delete patient with unpaid bills/i)).toBeVisible({ timeout: 8_000 });

    const row = await expectRow<{ is_active: boolean }>('patients', { id: unpaid![0].patient_id });
    expect(row.is_active).toBe(true);
  });

  test('TC-P3H-007 Delete is allowed for a patient whose only bills are paid or cancelled', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const row = await expectRow<{ is_active: boolean }>('patients', { hospital_id: hid, full_name: DISPOSABLE });
    // TC-P3H-001 already deleted this zero-bill patient successfully — confirm no unpaid-bills
    // block fired for it, as the positive contrast to TC-P3H-006.
    expect(row.is_active, 'The disposable test patient (no bills at all) was expected to have deleted cleanly in TC-P3H-001.').toBe(false);
  });

  test('TC-P3H-008 The delete confirmation dialog names the specific patient before proceeding', async ({ page }) => {
    // PT-QA-0006 — R. Subramanian
    await openDrawerFor(page, 'R. Subramanian');
    await page.getByTitle(/delete patient/i).click();
    await expect(page.getByText(/delete r\. subramanian\?/i)).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
  });

  test('TC-P3H-009 A soft-deleted patient cannot log into the patient portal', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // Same caveat as TC-P3F-009: while the portal RLS gap documented in P3F.portal.spec.ts
    // stands, EVERY login shows "Create Your Profile" regardless of is_active, so this passing
    // does not yet prove the exclusion is because of is_active specifically.
    const hid = await hospitalIdFor('A');
    const email = 'yeswanthvarma94+qa.portal.erasure@gmail.com';
    await db().from('patients').update({ email }).eq('hospital_id', hid).eq('full_name', DISPOSABLE);

    const { TEST_ENV } = await import('../utils/env');
    const { data, error } = await db().auth.admin.generateLink({
      type: 'magiclink', email, options: { redirectTo: `${TEST_ENV.baseURL}/portal?h=${hid}` },
    });
    test.skip(!!error, `generateLink failed: ${error?.message}`);
    const link = (data as any)?.properties?.action_link ?? (data as any)?.action_link;
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText(/create your profile/i)).toBeVisible({ timeout: 15_000 });
  });

  test('TC-P3H-010 Reactivating a soft-deleted patient is not offered anywhere in the Patients UI', async ({ page }) => {
    await page.goto('/patients', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.getByText(/show inactive/i).click();
    await page.waitForTimeout(1000);
    const row = page.locator('tr').filter({ hasText: DISPOSABLE }).first();
    await row.click();
    await page.waitForTimeout(500);
    const reactivate = page.getByRole('button', { name: /reactivate|activate|undo/i });
    expect(await reactivate.count(), 'A Reactivate control was found — update this case, the gap may be fixed.').toBe(0);
  });

  test('TC-P3H-011 No true per-patient DPDP erasure exists — the erasure-request table has no patient_id column', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { data, error } = await (db() as any)
      .from('data_erasure_requests').select('*').limit(1);
    test.skip(!!error, `data_erasure_requests not queryable: ${error?.message}`);
    const columns = data && data.length ? Object.keys(data[0]) : [];
    if (columns.length === 0) {
      // No rows to introspect — fall back to information_schema via a raw RPC is not
      // available through supabase-js, so this assertion needs at least one seeded row.
      test.skip(true, 'data_erasure_requests has no rows to introspect columns from — seed one row to run this case live.');
    }
    expect(
      columns,
      'data_erasure_requests now has a patient_id column — update this case, per-patient erasure may now exist.',
    ).not.toContain('patient_id');
  });
});
