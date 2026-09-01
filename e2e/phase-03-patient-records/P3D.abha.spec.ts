/**
 * Phase 3 · Section D — ABHA / ABDM (P3-S05, P3-S06)
 * Locks tracker cases TC-P3D-001 … TC-P3D-004, TC-P3D-007, TC-P3D-008.
 *
 * FINDING #6 (see PHASE_MAP.md): ABHASearchPanel.tsx's own "type an ABHA number → Verify →
 * tick verbal consent → Link" UI (the thing TC-P3D-005/006 originally tried to drive) has NO
 * live entry point anywhere in the running app:
 *   - PatientRegistrationModal.tsx only renders that panel when its `editPatient` prop is set
 *     — `grep -r "editPatient=" src/` returns zero matches, so nothing ever opens the modal in
 *     edit mode.
 *   - PatientSummaryPage.tsx (/patients/:id/summary, the ABHA tab) is the OTHER place
 *     ABHASearchPanel is used, but it only mounts the panel when `patient.abha_id` is ALREADY
 *     set — showing just the "ABHA ID Linked / Unlink" state. When `abha_id` is null, that tab
 *     renders a completely different component, `ABHARegistrationPanel` (the Aadhaar/mobile-OTP
 *     creation wizard), not ABHASearchPanel.
 * So the initial "verify + consent + link" flow is dead code from a live-UI perspective.
 * TC-P3D-005 and TC-P3D-006 are therefore MANUAL-ONLY / code-inspection cases — no Playwright
 * spec here (see docs/qa/cases/phase-03-patient-records.csv, Playwright Spec column blank).
 * TC-P3D-007 (Unlink) stays automated by seeding `abha_id` directly via the service-role
 * client first — Unlink doesn't care how the patient got linked, so that half IS reachable.
 * TC-P3D-008 is rewritten below to assert the finding live: neither the first-registration
 * form nor the patient-drawer edit form exposes the panel at all.
 *
 * TC-P3D-009 and TC-P3D-010 (new-ABHA creation via live Aadhaar/mobile OTP) have no Playwright
 * spec — they need a real Aadhaar-linked mobile receiving a live NHA OTP, which cannot be
 * scripted without testing a mock rather than the production path. Same precedent as P1A's
 * hospital-registration OTP cases.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow } from '../utils/db-verify';
import { field, fillField, consentCheckbox } from './patient-locators';

const ROUTE = '/patients';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const ABHA = MOCK.phase3.abha as { sandboxValid: string; tooShort: string };

async function openRegister(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /register new patient/i }).click();
  await page.waitForTimeout(400);
}

test.describe('P3D — ABHA / ABDM', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  test('TC-P3D-001 The ABHA Verify button returns a sandbox format-valid result for a syntactically valid ABHA number', async ({ page }) => {
    await openRegister(page);
    const abhaField = await field(page, 'ABHA ID', ROUTE);
    await abhaField.fill(ABHA.sandboxValid);
    await page.getByRole('button', { name: /^verify$/i }).click();
    await expect(page.getByText(/format valid \(sandbox\)/i)).toBeVisible({ timeout: 10_000 });
  });

  test('TC-P3D-002 An ABHA number of the wrong length is rejected as invalid', async ({ page }) => {
    await openRegister(page);
    const abhaField = await field(page, 'ABHA ID', ROUTE);
    await abhaField.fill(ABHA.tooShort);
    await page.getByRole('button', { name: /^verify$/i }).click();
    await expect(page.getByText(/invalid abha/i)).toBeVisible({ timeout: 10_000 });
  });

  test('TC-P3D-003 A sandbox-verified ABHA number is stored with abha_verified true and a timestamp', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const name = 'ABHA Sandbox Test Patient';
    await db().from('patients').delete().eq('hospital_id', hid).eq('full_name', name);

    await openRegister(page);
    await fillField(page, 'Full Name', name, ROUTE);
    const abhaField = await field(page, 'ABHA ID', ROUTE);
    await abhaField.fill(ABHA.sandboxValid);
    await page.getByRole('button', { name: /^verify$/i }).click();
    await expect(page.getByText(/format valid \(sandbox\)/i)).toBeVisible({ timeout: 10_000 });
    await consentCheckbox(page, /data collection|consent/i).check();
    await page.getByRole('button', { name: /register patient/i }).click();
    await page.waitForTimeout(1500);

    const row = await expectRow<{ abha_verified: boolean; abha_verified_at: string | null }>(
      'patients', { hospital_id: hid, full_name: name },
    );
    expect(row.abha_verified).toBe(true);
    expect(row.abha_verified_at).not.toBeNull();

    await db().from('patients').delete().eq('hospital_id', hid).eq('full_name', name);
  });

  test('TC-P3D-004 abdm-abha-verify supports a connectivity ping without needing a patient', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { anonDb } = await import('../utils/db-verify');
    const client = anonDb();
    const { error: authErr } = await client.auth.signInWithPassword({
      email: MOCK.hospitals.A.adminEmail, password: MOCK.password,
    });
    test.skip(!!authErr, `Could not sign in as ${MOCK.hospitals.A.adminEmail}: ${authErr?.message}`);
    try {
      const { data, error } = await client.functions.invoke('abdm-abha-verify', { body: { mode: 'ping' } });
      expect(error, `abdm-abha-verify ping failed: ${error?.message}`).toBeFalsy();
      expect(data).toBeTruthy();
    } finally {
      await client.auth.signOut();
    }
  });

  // TC-P3D-005 and TC-P3D-006 have no Playwright spec — see Finding #6 in the file header and
  // docs/qa/PHASE_MAP.md. ABHASearchPanel's "not yet linked" verify+consent+link UI has no live
  // entry point in the running app, so there is nothing to drive with the browser.

  test('TC-P3D-007 Unlinking a linked ABHA clears patients.abha_id and logs a consent_given=false row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const patient = await expectRow<{ id: string }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });

    // Seed the link directly — bypassing ABHASearchPanel's unreachable "Link" UI is fine here,
    // because Unlink doesn't care how the patient got linked in the first place.
    await db().from('patients').update({ abha_id: ABHA.sandboxValid, abha_verified: true } as any).eq('id', patient.id);

    await page.goto(`/patients/${patient.id}/summary`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.getByRole('tab', { name: /abha/i }).click();
    await page.waitForTimeout(800);

    await expect(page.getByText(/abha id linked/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /unlink/i }).click();
    await page.getByRole('button', { name: /yes, unlink/i }).click();
    await page.waitForTimeout(1200);

    const row = await expectRow<{ abha_id: string | null }>('patients', { hospital_id: hid, uhid: 'PT-QA-0002' });
    expect(row.abha_id).toBeNull();
    await expectRow('abdm_consent_logs', {
      hospital_id: hid, patient_id: patient.id, consent_type: 'linking', consent_given: false,
    });
  });

  test('TC-P3D-008 The ABHA verify+consent+link panel is reachable from neither the registration form nor the patient edit drawer', async ({ page }) => {
    // First registration — the inline Verify button exists (TC-P3D-001/002) but not the fuller
    // "ABHA Linking & Consent" panel with a verbal-consent checkbox and a Link button.
    await openRegister(page);
    await expect(page.getByText(/abha linking & consent/i)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // The patient detail drawer's own "Edit Patient" is a different, simpler inline form
    // (PatientDetailDrawer.tsx) — it never renders ABHASearchPanel either.
    await page.getByPlaceholder(/search by name, phone, or uhid/i).fill('PT-QA-0002');
    await page.waitForTimeout(600);
    await page.getByText(/Sunita Reddy/i).first().click();
    await page.waitForTimeout(500);
    await page.getByTitle(/edit patient/i).click();
    await page.waitForTimeout(500);
    await expect(
      page.getByText(/abha linking & consent/i),
      'The drawer\'s inline edit form rendered the ABHA linking panel — update TC-P3D-005/006 ' +
      'to automate against this surface, since it would no longer be unreachable.',
    ).toHaveCount(0);
  });
});
