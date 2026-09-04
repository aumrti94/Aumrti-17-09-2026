/**
 * Phase 5 · Section E — Validation, amendment and pathology sign-off (TC-P5E-001, 002)
 *
 * TWO JOURNEYS THAT ARE THE SAME CONTROL, IMPLEMENTED TWICE, ONE OF THEM CORRECTLY.
 *
 * A two-person control that cannot tell the two people apart is not a control. `handleSubmitForValidation`
 * (`LabResultWorkspace.tsx:622-635`) writes only `status = 'pending_validation'` — it records no
 * submitter, so there is no column that could ever be compared against the validator, and one
 * technician can sign both halves of a control that exists to stop exactly that.
 *
 * Histopathology gets it right (`PathologyCaseWorkspace.tsx:145-154`): the first sign-off locks the
 * report content and the final sign-off refuses the same pathologist. TC-P5E-002 walks that
 * journey — and it is the first test ever to open the Histopathology tab at all.
 *
 * DUAL VALIDATION IS CONFIGURED IN A TABLE WITH NO SETTINGS SCREEN. `lab_dual_validation_config`
 * has no UI anywhere in `src/`; the seeder writes one category. Note the read uses `.some(...)`, so
 * ANY dual-validation category flips the WHOLE order into two-person mode — surprising, and
 * load-bearing, so the journey pins it.
 */
import { test, expect } from './p5-journey.fixture';
import { MOCK } from '../fixtures/auth.fixture';
import { db } from '../utils/db-verify';
import { testTitle } from './p5-manifest';
import { labOrdersFor, labOrderItems, labItemForTest, clinicalAlertsFor } from './lab-rad-helpers';
import {
  orderLabThroughModal, collectThroughWorkstation, receiveSample, processSample,
  openOrderInWorklist, enterResult, registerPathologySpecimen, writePathologyReport,
  savePathologyDraft, clickIfEnabled,
} from './p5-stages';
import {
  validateAndReleaseButton, submitForValidationButton, validateAndSignButton,
  pathologistNotesInput, resultInput, openLabTab, LAB_TABS,
  pathologyRegisterButton, registerSpecimenButton, pathologyPatientSearch,
  pathologySpecimenTypeInput, pathologySpecimenSiteInput, pathologyClinicalHistoryInput,
  firstSignOffButton, finalSignOffButton, pathologyLockBanner, pathologyField,
} from './lab-locators';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const R = P5.results;

const K_TEST = String(P5.labOrder.primaryTest);     // Biochemistry — the dual-validation category
const HB = String(P5.labOrder.normalTest);
const DUAL_CATEGORY = String(P5.dualValidation.category);

test.describe('P5E — Validation & pathology sign-off', () => {
  test(testTitle('TC-P5E-001'), async ({ page, loginAs, logout, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    let orderId = '';

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_dual_validation_config').select('*')
        .eq('hospital_id', hid);
      expect.soft(
        data?.length ?? 0,
        `No dual-validation category is configured. lab_dual_validation_config has no settings ` +
        `screen anywhere in the product, so on a stock tenant the two-person control is ` +
        `unreachable — not disabled, unreachable — and every assertion below would pass vacuously.`,
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [K_TEST, HB] });
      const orders = await labOrdersFor(hid, pid);
      expect(orders.length, 'The mixed-category order was not created.' + jrn.note()).toBeGreaterThan(0);
      orderId = orders[0].id as string;
    });

    await jrn.next(async () => {
      await collectThroughWorkstation(page, patient.uhid);
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
    });

    await jrn.next(async () => {
      await openOrderInWorklist(page, patient.uhid);
      await enterResult(page, K_TEST, String(R.normalPotassium));
      await enterResult(page, HB, String(R.normalHaemoglobin));
    });

    await jrn.next(async () => {
      const submitVisible = await submitForValidationButton(page).isVisible().catch(() => false);
      expect.soft(
        submitVisible,
        `One ${DUAL_CATEGORY} test in a mixed order must flip the WHOLE order into two-person ` +
        'mode — the config read uses `.some(...)`, not `.every(...)`. If it does not, a ' +
        'technician can release a dual-validation analyte alone simply by ordering it alongside ' +
        'something ordinary.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      const releaseVisible = await validateAndReleaseButton(page).isVisible().catch(() => false);
      expect.soft(
        releaseVisible,
        'Single-step "Validate & Release" is still offered on an order that requires two people. ' +
        'The whole control is that one person cannot finish it alone.',
      ).toBe(false);
    });

    await jrn.next(async () => {
      // The control may be absent entirely when the order did not flip into dual-validation mode
      // (the stage above records that). Clicking it unconditionally burned the action timeout and
      // reported a click failure instead of the missing flip that actually caused it.
      const submitted = await clickIfEnabled(submitForValidationButton(page));
      expect.soft(
        submitted,
        'Submit for Validation could not be pressed, so the two-person control cannot even be ' +
        'started. This follows from the order not entering dual-validation mode above.',
      ).toBe('clicked');
      await page.waitForTimeout(3_000);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect.soft(
        (data as { status: string } | null)?.status,
        'Submitting did not move the order to pending_validation, so the pathologist has nothing ' +
        'in their queue.',
      ).toBe('pending_validation');
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('*').eq('id', orderId).maybeSingle();
      const row = (data ?? {}) as Record<string, unknown>;
      const submitterColumn = Object.keys(row).find(k => /submit/i.test(k) && row[k]);
      expect.soft(
        submitterColumn,
        'FINDING L5. The submit step records nobody. `handleSubmitForValidation` writes only the ' +
        'status, so there is no column that could ever be compared against the validator — which ' +
        'means the two-person control cannot tell whether it had two people. Histopathology does ' +
        'this correctly; lab orders do not.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const signVisible = await validateAndSignButton(page).isVisible().catch(() => false);
      expect.soft(
        signVisible,
        'FINDING L5. The technician who just submitted is still offered the sign-off. With no ' +
        'submitter recorded there is nothing to compare against, so one person can perform both ' +
        'halves of a control that exists precisely to require two.',
      ).toBe(false);
    });

    await jrn.next(async () => {
      await logout();
      await loginAs('doctor', { hospital: 'A' });
      await openOrderInWorklist(page, patient.uhid);
    });

    await jrn.next(async () => {
      const notes = pathologistNotesInput(page);
      if (await notes.count()) {
        await notes.fill(String(R.validationNotes));
        await page.waitForTimeout(500);
      }
    });

    await jrn.next(async () => {
      const sign = validateAndSignButton(page);
      await expect(
        sign,
        'The pathologist is not offered a sign-off on an order waiting for one.' + jrn.note(),
      ).toBeVisible({ timeout: 15_000 });
      await sign.click();
      await page.waitForTimeout(3_500);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('validated_by, validated_at, status')
        .eq('id', orderId).maybeSingle();
      const row = (data ?? {}) as { validated_by?: string; validated_at?: string };
      expect.soft(
        row.validated_by,
        'Nobody is recorded as having validated the report. A signed clinical document with no ' +
        'signatory is not a signed document.',
      ).toBeTruthy();
      expect.soft(row.validated_at, 'The sign-off carries no timestamp.').toBeTruthy();
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('*').eq('id', orderId).maybeSingle();
      const row = (data ?? {}) as Record<string, unknown>;
      const submitter = Object.keys(row).find(k => /submit/i.test(k) && row[k]);
      expect.soft(
        submitter && row[submitter] !== row.validated_by,
        'FINDING L5. Nothing proves the validator differed from the submitter, because the ' +
        'submitter was never recorded. A two-person control that cannot demonstrate two people ' +
        'provides no more assurance than a single signature, while costing a second click.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      await logout();
      await loginAs('lab_technician', { hospital: 'A' });
      await openOrderInWorklist(page, patient.uhid);
    });

    await jrn.next(async () => {
      const amend = page.getByRole('button', { name: /amend|correct|reopen|revise/i }).first();
      const offered = await amend.isVisible().catch(() => false);
      expect.soft(
        offered,
        'FINDING L6. There is no amendment path for a released lab result — no control, no column, ' +
        'no table. Results are corrected in every laboratory; without a path the correction ' +
        'happens by overwriting, and the record a clinician acted on disappears.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_order_items').select('*').eq('lab_order_id', orderId).limit(1);
      const cols = Object.keys((data?.[0] ?? {}) as Record<string, unknown>);
      const amendCol = cols.find(c => /amend|version|supersed|original|revis/i.test(c));
      expect.soft(
        amendCol,
        'FINDING L6. lab_order_items carries no amendment, version or superseded column, so even ' +
        'if a correction were made there is nowhere to keep what the original said. An amended ' +
        'result must retain the original — the clinician who acted on the first value needs to ' +
        'know what they were told.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const input = resultInput(page, K_TEST);
      const editable = await input.isEditable().catch(() => false);
      if (editable) {
        await input.fill(String(R.justAboveNormalPotassium));
        await input.press('Tab');
        await page.waitForTimeout(2_500);
      }
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, K_TEST);
      expect.soft(
        String(item?.result_value ?? ''),
        'FINDING L6. A signed-off result was silently rewritten in place. The report a clinician ' +
        'read is now a different report with no trace that it changed, which is the exact failure ' +
        'an amendment trail exists to prevent.',
      ).toBe(String(R.normalPotassium));
    });

    await jrn.next(async () => {
      const alerts = await clinicalAlertsFor({ hospitalId: hid, patientId: pid });
      const ready = alerts.filter(a => String(a.alert_type ?? '').endsWith('_ready'));
      expect.soft(
        ready.length,
        'Releasing the validated report notified nobody, so the two-person sign-off produced a ' +
        'result that still reaches the ordering doctor only by telephone.',
      ).toBeGreaterThan(0);
    });
  });

  test(testTitle('TC-P5E-002'), async ({ page, loginAs, logout, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await openLabTab(page, LAB_TABS.histopathology);
      await expect(
        page.getByText(/Pathology Cases|Register/i).first(),
        'The Histopathology tab did not open. It has never been opened by any test before this ' +
        'journey, so a failure here is as likely to be a locator as a product defect.' + jrn.note(),
      ).toBeVisible({ timeout: 20_000 });
    });

    await jrn.next(async () => {
      await pathologyRegisterButton(page).click();
      await page.waitForTimeout(1_500);
      await pathologyPatientSearch(page).fill(patient.uhid);
      await page.waitForTimeout(1_800);
    });

    await jrn.next(async () => {
      await expect.soft(
        registerSpecimenButton(page),
        'A specimen can be registered with no patient selected. A histopathology block that is not ' +
        'attached to a person is a specimen nobody can report and nobody can return.',
      ).toBeDisabled();
    });

    await jrn.next(async () => {
      const hit = page.getByRole('button').filter({ hasText: patient.uhid }).first();
      if (await hit.count()) await hit.click().catch(() => { /* auto-selected */ });
      await page.waitForTimeout(1_000);
      const typeSelect = page.locator('select').first();
      if (await typeSelect.count()) {
        await typeSelect.selectOption({ label: 'Histopathology' }).catch(() => { /* default */ });
      }
    });

    await jrn.next(async () => {
      await pathologySpecimenTypeInput(page).fill('Biopsy');
      await pathologySpecimenSiteInput(page).fill('Left breast');
      await pathologyClinicalHistoryInput(page).fill(String(P5.labOrder.clinicalNotes));
      await page.waitForTimeout(500);
    });

    await jrn.next(async () => {
      await registerSpecimenButton(page).click();
      await page.waitForTimeout(3_000);
    });

    await jrn.next(async () => {
      const { data } = await db().from('pathology_cases').select('id, case_number, status')
        .eq('hospital_id', hid).eq('patient_id', pid);
      expect(
        data?.length ?? 0,
        'The specimen was not registered. A block in a pot with no case number cannot be tracked, ' +
        'and a lost histopathology specimen is a diagnosis that never happens.' + jrn.note(),
      ).toBeGreaterThan(0);
      expect.soft(
        String((data?.[0] as { case_number?: string })?.case_number ?? ''),
        'The case carries no case number, so the block and the report cannot be matched.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const row = page.getByRole('button').filter({ hasText: /registered|biopsy|left breast/i }).first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(2_000);
      }
    });

    await jrn.next(async () => {
      await writePathologyReport(page, { gross: 'Grey-white firm tissue, 2.1 x 1.4 x 0.9 cm.' });
    });

    await jrn.next(async () => {
      await writePathologyReport(page, {
        microscopic: 'Sections show infiltrating ductal carcinoma, grade 2, with lymphovascular invasion.',
      });
    });

    await jrn.next(async () => {
      await savePathologyDraft(page);
    });

    await jrn.next(async () => {
      const { data } = await db().from('pathology_cases')
        .select('status, first_signed_at, microscopic_description')
        .eq('hospital_id', hid).eq('patient_id', pid).limit(1);
      const row = (data?.[0] ?? {}) as { first_signed_at?: string };
      expect.soft(
        row.first_signed_at,
        'A saved draft was recorded as signed. A draft is explicitly not a signed report — a ' +
        'pathologist saving work in progress must not have committed a diagnosis.',
      ).toBeFalsy();
    });

    await jrn.next(async () => {
      const canSign = await firstSignOffButton(page).isVisible().catch(() => false);
      expect.soft(
        canSign,
        'A laboratory technician is offered the pathology sign-off. A cancer diagnosis is signed ' +
        'by a pathologist; offering the control to anyone else makes the role gate decorative.',
      ).toBe(false);
      await expect.soft(
        page.getByText(/requires a pathologist/i).first(),
        'The technician is not told why they cannot sign, so they will assume the button is broken.',
      ).toBeVisible({ timeout: 8_000 });
    });

    await jrn.next(async () => {
      await logout();
      await loginAs('doctor', { hospital: 'A' });
      await openLabTab(page, LAB_TABS.histopathology);
      const row = page.getByRole('button').filter({ hasText: /biopsy|left breast|registered|reporting/i }).first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(2_000);
      }
    });

    await jrn.next(async () => {
      const impression = pathologyField(page, 'impression');
      if (await impression.count()) await impression.fill('');
      await page.waitForTimeout(400);
      const sign = firstSignOffButton(page);
      if (await sign.isVisible().catch(() => false)) {
        await sign.click().catch(() => { /* correctly refused */ });
        await page.waitForTimeout(2_000);
      }
      const { data } = await db().from('pathology_cases').select('first_signed_at')
        .eq('hospital_id', hid).eq('patient_id', pid).limit(1);
      expect.soft(
        (data?.[0] as { first_signed_at?: string })?.first_signed_at,
        'A pathology report was signed with an empty impression. The impression IS the diagnosis — ' +
        'findings without one leave the treating team to interpret raw morphology themselves, ' +
        'which is exactly what they asked a pathologist to avoid.',
      ).toBeFalsy();
    });

    await jrn.next(async () => {
      await writePathologyReport(page, {
        impression: 'Infiltrating ductal carcinoma, grade 2. Margins not assessable on this sample.',
      });
      await page.waitForTimeout(500);
      const sign = firstSignOffButton(page);
      await expect(
        sign,
        'The pathologist is not offered a first sign-off.' + jrn.note(),
      ).toBeVisible({ timeout: 12_000 });
      await sign.click();
      await page.waitForTimeout(3_500);
    });

    await jrn.next(async () => {
      const { data } = await db().from('pathology_cases').select('first_signed_at, status')
        .eq('hospital_id', hid).eq('patient_id', pid).limit(1);
      expect.soft(
        (data?.[0] as { first_signed_at?: string })?.first_signed_at,
        'The first sign-off was not recorded, so the second pathologist has nothing to counter-sign.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      await expect.soft(
        pathologyLockBanner(page),
        'The report content is not locked after the first signature. If the text can still change ' +
        'between the two sign-offs, the second pathologist may be signing something different ' +
        'from what the first one read — which makes the second signature worthless.',
      ).toBeVisible({ timeout: 10_000 });
      const micro = pathologyField(page, 'microscopic description');
      if (await micro.count()) {
        expect.soft(
          await micro.isEditable().catch(() => false),
          'The microscopic description is still editable after the first sign-off.',
        ).toBe(false);
      }
    });

    await jrn.next(async () => {
      const finalBtn = finalSignOffButton(page);
      if (await finalBtn.isVisible().catch(() => false)) {
        await finalBtn.click();
        await page.waitForTimeout(3_000);
        const toastText = await page.locator('[role="status"], [data-sonner-toast]').first()
          .innerText().catch(() => '');
        expect.soft(
          /different pathologist|must be a different/i.test(toastText),
          'The SAME pathologist recorded both sign-offs. The second signature exists so that a ' +
          'second person has read the slides; letting one person provide both turns a double ' +
          `check into two clicks. Toast was: "${toastText}"`,
        ).toBe(true);
      }
    });

    await jrn.next(async () => {
      await logout();

      // A SECOND, DIFFERENT pathologist — and not every doctor in mock-data.json exists in the
      // tenant. `Dr. Kavitha Rao` (index 1) is declared in the fixture but was never created by the
      // seeder, so `loginAs('doctor', { index: 1 })` sat on /login until `waitForURL` timed out and
      // the journey reported a sign-off failure for a login that never happened. Try each declared
      // doctor until one actually signs in.
      let signedIn = false;
      for (const index of [1, 2]) {
        try {
          await loginAs('doctor', { hospital: 'A', index });
          signedIn = true;
          break;
        } catch {
          await logout().catch(() => { /* never got a session */ });
        }
      }
      expect(
        signedIn,
        'No second doctor account could sign in, so the two-pathologist control cannot be ' +
        'exercised at all. PREREQUISITE: mock-data.json declares three doctors for Hospital A but ' +
        'the tenant only has Dr. Suresh Menon and Dr. Arjun Nair — re-run npm run qa:seed.',
      ).toBe(true);

      await openLabTab(page, LAB_TABS.histopathology);
      const row = page.getByRole('button').filter({ hasText: /biopsy|left breast|pending signoff/i }).first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(2_000);
      }
      const finalBtn = finalSignOffButton(page);
      if (await finalBtn.isVisible().catch(() => false)) {
        await finalBtn.click();
        await page.waitForTimeout(3_500);
      }
    });

    await jrn.next(async () => {
      const { data } = await db().from('pathology_cases')
        .select('first_signed_at, final_signed_at, first_signed_by, final_signed_by, status')
        .eq('hospital_id', hid).eq('patient_id', pid).limit(1);
      const row = (data?.[0] ?? {}) as Record<string, unknown>;
      expect.soft(
        row.final_signed_at,
        'The second pathologist could not complete the sign-off, so a diagnosed case never reaches ' +
        'the clinician who is waiting to plan treatment.',
      ).toBeTruthy();
      if (row.first_signed_by && row.final_signed_by) {
        expect.soft(
          row.final_signed_by,
          'Both signatures belong to the same pathologist — the control this journey exists to ' +
          'prove was bypassed.',
        ).not.toBe(row.first_signed_by);
      }
    });
  });
});
