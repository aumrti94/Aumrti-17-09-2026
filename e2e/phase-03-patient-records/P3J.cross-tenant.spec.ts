/**
 * Phase 3 · Section J — Cross-tenant isolation (P3-S12) 🔴
 * Locks tracker cases TC-P3J-001 … TC-P3J-005
 *
 * PatientSummaryPage.tsx's primary fetch (`/patients/:id/summary`) has NO hospital_id filter —
 * `supabase.from('patients').select('*').eq('id', patientId).maybeSingle()`. Its cross-tenant
 * protection depends entirely on RLS ("Users can view own hospital patients" — hospital_id =
 * get_user_hospital_id()). This is the one screen in the module where a weakened RLS policy
 * would leak a full clinical summary, not just a list row, so it gets the most direct tests.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectNoCrossTenantRows } from '../utils/db-verify';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

test.describe('P3J — Cross-tenant isolation', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
  });

  test('TC-P3J-001 Pasting a Hospital B patient\'s UUID into /patients/:id/summary as Hospital A staff returns no data', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hidB = await hospitalIdFor('B');
    const { data: patientB } = await db().from('patients').select('id, full_name').eq('hospital_id', hidB).eq('uhid', 'PT-QA-0030').maybeSingle();
    test.skip(!patientB, 'PT-QA-0030 (Hospital B) not found — run npm run qa:seed');

    await page.goto(`/patients/${patientB!.id}/summary`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(
      page.getByText(patientB!.full_name),
      `Hospital A staff could see Hospital B patient "${patientB!.full_name}"'s summary page — RLS did not block this.`,
    ).toHaveCount(0);
  });

  test('TC-P3J-002 A raw REST/RLS query for the patients table as a Hospital A session returns zero Hospital B rows', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hidB = await hospitalIdFor('B');
    await expectNoCrossTenantRows('patients', MOCK.hospitals.A.adminEmail, MOCK.password, hidB);
  });

  test('TC-P3J-003 The /patients?id=<uuid> deep link ignores a foreign hospital\'s patient id', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hidB = await hospitalIdFor('B');
    const { data: patientB } = await db().from('patients').select('id, full_name').eq('hospital_id', hidB).eq('uhid', 'PT-QA-0030').maybeSingle();
    test.skip(!patientB, 'PT-QA-0030 (Hospital B) not found — run npm run qa:seed');

    await page.goto(`/patients?id=${patientB!.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(
      page.getByText(patientB!.full_name),
      'The ?id= deep link opened a drawer for a Hospital B patient while logged in as Hospital A.',
    ).toHaveCount(0);
  });

  test('TC-P3J-004 Hospital A\'s patient list search never surfaces a Hospital B patient by name or phone', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await page.goto('/patients', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    await page.getByPlaceholder(/search by name, phone, or uhid/i).fill('Rohan Kulkarni');
    await page.waitForTimeout(600);
    await expect(page.getByText('Rohan Kulkarni')).toHaveCount(0);

    await page.getByPlaceholder(/search by name, phone, or uhid/i).fill('9876500030');
    await page.waitForTimeout(600);
    await expect(page.getByText('Rohan Kulkarni')).toHaveCount(0);
  });

  test('TC-P3J-005 A Hospital A doctor cannot open Hospital B\'s PatientSummaryPage via direct navigation', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hidB = await hospitalIdFor('B');
    const { data: patientB } = await db().from('patients').select('id, full_name').eq('hospital_id', hidB).eq('uhid', 'PT-QA-0030').maybeSingle();
    test.skip(!patientB, 'PT-QA-0030 (Hospital B) not found — run npm run qa:seed');

    await logout();
    await loginAs('doctor', { hospital: 'A' });
    await page.goto(`/patients/${patientB!.id}/summary`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText(patientB!.full_name)).toHaveCount(0);
  });
});
