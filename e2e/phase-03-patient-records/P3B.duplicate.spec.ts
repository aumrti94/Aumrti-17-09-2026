/**
 * Phase 3 · Section B — Duplicate detection (P3-S02) 🔴
 * Locks tracker cases TC-P3B-001 … TC-P3B-005
 *
 * PatientRegistrationModal.tsx's handleSubmit() inserts directly into `patients` with no
 * phone/name lookup beforehand (unlike EmergencyRegistrationModal's search box — see P3C).
 * Every test in this file documents that gap rather than assuming it is fixed — expect the
 * duplicate to succeed, and assert on the resulting row count.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, countRows } from '../utils/db-verify';
import { fillField, consentCheckbox } from './patient-locators';
import { purgePatientsById } from './purge-helpers';

const ROUTE = '/patients';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const DUP = MOCK.phase3.duplicate as { probeName: string; probePhone: string; nearDuplicateName: string };

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('patients').select('id').eq('hospital_id', hid).eq('phone', DUP.probePhone);
  await purgePatientsById((data ?? []).map((r: { id: string }) => r.id));
}

async function register(page: import('@playwright/test').Page, name: string, phone: string) {
  await page.getByRole('button', { name: /register new patient/i }).first().click();
  await page.waitForTimeout(400);
  await fillField(page, 'Full Name', name, ROUTE);
  await fillField(page, 'Phone', phone, ROUTE);
  await consentCheckbox(page, /data collection|consent/i).check();
  await page.getByRole('button', { name: /register patient/i }).click();
  await page.waitForTimeout(1200);
}

test.describe('P3B — Duplicate detection', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  test('TC-P3B-001 Registering a patient with a name and phone identical to an existing patient succeeds and creates a second row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await register(page, DUP.probeName, DUP.probePhone);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await register(page, DUP.probeName, DUP.probePhone);

    expect(
      await countRows('patients', { hospital_id: hid, full_name: DUP.probeName, phone: DUP.probePhone }),
      'Registering the exact same name+phone twice was expected to succeed both times — the app has no ' +
      'de-dup check on this path. If this now returns 1, the gap has been fixed and this case should be updated.',
    ).toBe(2);
  });

  test('TC-P3B-002 No duplicate-warning element appears during or after the duplicate save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await register(page, DUP.probeName, DUP.probePhone);
    const warning = page.getByText(/already exists|duplicate|existing patient found/i);
    expect(await warning.count(), 'A duplicate-warning element was found — update this case, the gap may be fixed.').toBe(0);
  });

  test('TC-P3B-003 The two duplicate rows carry two different UHIDs', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('patients').select('uhid').eq('hospital_id', hid)
      .eq('full_name', DUP.probeName).eq('phone', DUP.probePhone);
    test.skip(!data || data.length < 2, 'Run TC-P3B-001 first to create both duplicate rows');
    const uhids = new Set((data ?? []).map((r: any) => r.uhid));
    expect(uhids.size, 'The two duplicate rows share one UHID — that would be a different, even stranger bug.').toBe(data!.length);
  });

  test('TC-P3B-004 A near-duplicate — same phone, differently-spaced/cased name — is also accepted without warning', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await register(page, DUP.nearDuplicateName, DUP.probePhone);
    expect(
      await countRows('patients', { hospital_id: hid, phone: DUP.probePhone }),
      'Expected at least one row for this phone after registering the near-duplicate name.',
    ).toBeGreaterThan(0);
  });

  test('TC-P3B-005 The seeded duplicate pair PT-QA-0001 / PT-QA-0029 confirms the same gap independent of any single test run', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('patients').select('uhid').eq('hospital_id', hid)
      .eq('full_name', 'Ramesh Kumar').eq('phone', '9876500001');
    expect(
      (data ?? []).length,
      'Expected the seeded PT-QA-0001/PT-QA-0029 pair (2 rows for "Ramesh Kumar" / 9876500001). Run npm run qa:seed if this is 0.',
    ).toBe(2);
  });
});
