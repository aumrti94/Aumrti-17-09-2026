/**
 * Phase 3 · Section I — Documents (P3-S11)
 * Locks tracker cases TC-P3I-001 … TC-P3I-006, TC-P3I-008.
 *
 * TC-P3I-007 (a failed patient_documents insert cleans up its already-uploaded storage object)
 * has no Playwright spec — it requires deliberately breaking the insert (a schema/permission
 * change), which is not reproducible through ordinary UI actions. It stays MANUAL-ONLY.
 *
 * PatientDocuments.tsx stores at `${hospitalId}/${patientId}/${Date.now()}_${filename}` in the
 * private `patient-documents` bucket (flipped from public in migration 20261010000010, after a
 * real cross-tenant document-leak defect — TC-P3I-005 locks that fix as a regression guard).
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow } from '../utils/db-verify';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const DOC_NAME = (MOCK.phase3.documents as { sampleFileName: string }).sampleFileName;

// A minimal valid 1x1 PNG, generated in-spec rather than checked into the repo as a binary.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function openDrawerFor(page: import('@playwright/test').Page, uhid: string) {
  await page.goto('/patients', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.getByPlaceholder(/search by name, phone, or uhid/i).fill(uhid);
  await page.waitForTimeout(600);
  await page.locator('tr').filter({ hasText: uhid }).first().click();
  await page.waitForTimeout(500);
}

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  const patient = await db().from('patients').select('id').eq('hospital_id', hid).eq('uhid', 'PT-QA-0002').maybeSingle();
  if (!patient.data) return;
  const { data: docs } = await (db() as any).from('patient_documents').select('id, file_url')
    .eq('patient_id', patient.data.id).like('document_name', `%${DOC_NAME}%`);
  for (const d of docs ?? []) {
    await db().storage.from('patient-documents').remove([d.file_url]).catch(() => {});
    await (db() as any).from('patient_documents').delete().eq('id', d.id);
  }
}

test.describe('P3I — Documents', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
  });

  test('TC-P3I-001 Uploading a supported image document succeeds and creates a patient_documents row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openDrawerFor(page, 'PT-QA-0002');
    const fileInput = page.locator('input[type="file"]').last();
    await fileInput.setInputFiles({ name: DOC_NAME, mimeType: 'image/png', buffer: TINY_PNG });
    await page.getByRole('button', { name: /upload & analyse/i }).click();
    // Toasts render twice (visible <div> + mirrored aria-live <span>) — .first() avoids a
    // strict-mode violation.
    await expect(page.getByText(/document uploaded successfully/i).first()).toBeVisible({ timeout: 20_000 });

    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });
    await expectRow('patient_documents', { patient_id: patient.id, document_name: DOC_NAME });
  });

  test('TC-P3I-002 The uploaded file is stored under a hospital_id/patient_id-scoped path', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });
    const doc = await expectRow<{ file_url: string }>('patient_documents', { patient_id: patient.id, document_name: DOC_NAME });
    expect(doc.file_url.startsWith(`${hid}/${patient.id}/`), `file_url "${doc.file_url}" does not start with "<hospital_id>/<patient_id>/".`).toBeTruthy();
  });

  test('TC-P3I-003 A file larger than 15MB is rejected client-side before upload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });
    const before = await db().from('patient_documents').select('*', { count: 'exact', head: true }).eq('patient_id', patient.id);

    await openDrawerFor(page, 'PT-QA-0002');
    const oversize = Buffer.alloc(16 * 1024 * 1024, 1);
    const fileInput = page.locator('input[type="file"]').last();
    await fileInput.setInputFiles({ name: 'oversize-qa.png', mimeType: 'image/png', buffer: oversize });
    await expect(page.getByText(/file too large/i)).toBeVisible({ timeout: 8_000 });

    const after = await db().from('patient_documents').select('*', { count: 'exact', head: true }).eq('patient_id', patient.id);
    expect(after.count).toBe(before.count);
  });

  test('TC-P3I-004 The file picker only offers the supported document types', async ({ page }) => {
    await openDrawerFor(page, 'PT-QA-0002');
    const fileInput = page.locator('input[type="file"]').last();
    const accept = await fileInput.getAttribute('accept');
    expect(accept, 'The file input has no accept attribute — any file type could be selected.').toBeTruthy();
    for (const type of ['image/jpeg', 'image/png', 'application/pdf', '.docx', '.csv']) {
      expect(accept, `accept="${accept}" is missing "${type}"`).toContain(type);
    }
  });

  test('TC-P3I-005 A document\'s signed view URL only opens for staff of the correct hospital', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hidA = await hospitalIdFor('A');
    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hidA, uhid: 'PT-QA-0002' });
    const doc = await expectRow<{ file_url: string }>('patient_documents', { patient_id: patient.id, document_name: DOC_NAME });

    const { anonDb } = await import('../utils/db-verify');
    const client = anonDb();
    const { error: authErr } = await client.auth.signInWithPassword({
      email: MOCK.hospitals.B.adminEmail, password: MOCK.password,
    });
    test.skip(!!authErr, `Could not sign in as Hospital B admin: ${authErr?.message}`);
    try {
      const { data, error } = await client.storage.from('patient-documents').download(doc.file_url);
      expect(
        !!error || !data,
        `Hospital B was able to download a Hospital A patient's document at "${doc.file_url}" — storage RLS is not isolating this bucket.`,
      ).toBeTruthy();
    } finally {
      await client.auth.signOut();
    }
  });

  test('TC-P3I-006 Deleting a document removes both the storage object and the patient_documents row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });
    const doc = await expectRow<{ id: string; file_url: string }>('patient_documents', { patient_id: patient.id, document_name: DOC_NAME });

    await openDrawerFor(page, 'PT-QA-0002');
    page.once('dialog', d => d.accept());
    await page.getByTitle(/delete document/i).first().click();
    await expect(page.getByText(/document deleted/i)).toBeVisible({ timeout: 10_000 });

    await expectNoRow('patient_documents', { id: doc.id });
    const { data: stillThere } = await db().storage.from('patient-documents').list(doc.file_url.split('/').slice(0, -1).join('/'));
    const fileName = doc.file_url.split('/').pop();
    expect((stillThere ?? []).some(f => f.name === fileName), 'The storage object still exists after the document row was deleted.').toBeFalsy();
  });

  test('TC-P3I-008 Hospital B staff cannot open a document belonging to a Hospital A patient through the app UI', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await logout();
    await loginAs('hospital_admin', { hospital: 'B' });
    await page.goto('/patients', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.getByPlaceholder(/search by name, phone, or uhid/i).fill('Sunita Reddy');
    await page.waitForTimeout(600);
    await expect(page.getByText('Sunita Reddy')).toHaveCount(0);
  });
});
