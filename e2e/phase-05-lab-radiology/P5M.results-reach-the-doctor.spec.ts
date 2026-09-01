/**
 * Phase 5 · Section M — Results reach the ordering doctor
 * Locks tracker cases TC-P5M-001 … TC-P5M-008
 *
 * P5J asks whether a released result reaches the patient CHART. This section asks the harder
 * question the chart does not answer: does it reach the DOCTOR, in the screen they are already
 * looking at, without them having to go to the Lab module and look for it?
 *
 * THE THREE FAILURES THIS SECTION EXISTS TO CATCH.
 *
 * 1. OPD had no results view at all. The consultation workspace could order investigations and
 *    could not display a single one — `RxOrdersTab` reads test names to render "ordered" chips
 *    and never selects `result_value`. A doctor mid-consultation had no way to see the CRP they
 *    had asked for ten minutes earlier.
 *
 * 2. Radiology ordered FROM a consultation could never be reported. `syncRadiologyOrders`
 *    inserted the order but not the `radiology_reports` stub that `RadiologyReportingWorkspace`
 *    requires (it returns early from saveDraft and validateAndSign when the report row is
 *    missing). Orders raised at the radiology desk got their stub from
 *    NewRadiologyOrderModal, so the failure was invisible from inside the radiology module and
 *    looked like "radiology is not linked to OPD/IPD".
 *
 * 3. Desk-created orders were orphaned. Raising an order from the worklist saved encounter_id
 *    AND admission_id NULL, and set ordered_by to the logged-in technician — so the result
 *    belonged to no visit and had no clinician to go back to.
 *
 * TC-P5M-004 is the one that would have caught (2) at any point in the last several releases,
 * and it asserts on the database rather than the UI precisely because the symptom only appears
 * one module away from the cause.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedLabOrder, seedRadiologyOrder, advanceSamples, labItemForTest, labOrderById,
  radiologyReportFor, clinicalAlertsFor, purgeLabRadArtefacts,
} from './lab-rad-helpers';
import { openLab } from './lab-locators';
import { openRadiology } from './radiology-locators';
import {
  openOrderInWorklist, enterResult, validateAndRelease, submitForValidation,
  driveStudyToImagesAcquired, fillReport, signReport,
} from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const R = P5.results;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const DOCTOR = MOCK.doctorFees[0].doctor;
const NORMAL_TEST = String(P5.labOrder.normalTest);
const STUDY = String(P5.radiology.plainStudy);

/** The most recent OPD encounter for this patient, or null when none exists. */
async function latestEncounterId(hospitalId: string, patientId: string): Promise<string | null> {
  const { data } = await db().from('opd_encounters').select('id')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId)
    .order('created_at', { ascending: false }).limit(1);
  return (data?.[0]?.id as string) ?? null;
}

async function releaseLabResult(page: any, testName: string, value: string): Promise<void> {
  await openLab(page);
  await openOrderInWorklist(page, NAME);
  await enterResult(page, testName, value);
  const locators = await import('./lab-locators');
  if (await locators.validateAndReleaseButton(page).isVisible().catch(() => false)) {
    await validateAndRelease(page);
  } else {
    await submitForValidation(page);
  }
}

test.describe('P5M — Results reach the ordering doctor', () => {
  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    await purgeLabRadArtefacts(hid, [pid]);
  });

  test('TC-P5M-001 A released lab result appears in the OPD consultation the doctor is already in', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    const encounterId = await latestEncounterId(hid, pid);
    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [NORMAL_TEST], encounterId, billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });

    await loginAs('lab_technician', { hospital: 'A' });
    await releaseLabResult(page, NORMAL_TEST, String(R.normalHaemoglobin));

    const item = await labItemForTest(seeded.orderId, NORMAL_TEST);
    expect(item?.result_value, 'The result never saved, so there is nothing to surface.').toBeTruthy();

    await loginAs('doctor', { hospital: 'A' });
    await page.goto('/opd', { waitUntil: 'domcontentloaded' });
    await page.getByText(NAME, { exact: false }).first().click().catch(() => {});
    await page.waitForTimeout(2_000);

    const reportsTab = page.getByRole('button', { name: /reports/i }).first();
    await expect(
      reportsTab,
      'The consultation workspace has no Reports tab. Ordering and reading a result are the same ' +
      'clinical loop; when the second half lives in another module the doctor closes the loop by ' +
      'walking to the laboratory, or not at all.',
    ).toBeVisible({ timeout: 15_000 });

    await reportsTab.click();
    await expect(
      page.getByText(new RegExp(NORMAL_TEST.replace(/[()]/g, '.'), 'i')).first(),
      'The released result is not shown in the doctor\'s own screen.',
    ).toBeVisible({ timeout: 15_000 });

    // The VALUE, not just the test name — the point is that no click is needed to read it.
    await expect(
      page.getByText(String(R.normalHaemoglobin), { exact: false }).first(),
      'The test is listed but its value is not on screen. A list of orders the doctor has to ' +
      'open one by one is a filing cabinet, not a report.',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('TC-P5M-002 Releasing a lab result notifies the doctor who ordered it — and nobody else', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [NORMAL_TEST], billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });

    await loginAs('lab_technician', { hospital: 'A' });
    await releaseLabResult(page, NORMAL_TEST, String(R.normalHaemoglobin));
    await page.waitForTimeout(3_000);

    const alerts = await clinicalAlertsFor({
      hospitalId: hid, patientId: pid, alertType: 'lab_result_ready',
    });
    expect(
      alerts.length,
      'Releasing the result raised no result-ready alert. Before this existed the release ' +
      'notified the PATIENT over WhatsApp and told the ordering clinician nothing at all.',
    ).toBeGreaterThan(0);

    expect(
      alerts[0].recipient_user_id,
      'The alert is not addressed to the ordering doctor. An unaddressed alert goes to the whole ' +
      'hospital, which is the same as going to nobody.',
    ).toBe(doctorId);

    // One alert per ORDER, never one per test — the alert-fatigue rule.
    const forThisOrder = alerts.filter(a => a.lab_order_id === seeded.orderId);
    expect(
      forThisOrder.length,
      'More than one alert was raised for a single order. A twelve-test profile must notify once.',
    ).toBe(1);
  });

  test('TC-P5M-003 Reading a report stamps the review and clears the alert', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    const encounterId = await latestEncounterId(hid, pid);
    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [NORMAL_TEST], encounterId, billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });

    await loginAs('lab_technician', { hospital: 'A' });
    await releaseLabResult(page, NORMAL_TEST, String(R.normalHaemoglobin));
    await page.waitForTimeout(2_000);

    const before = await labOrderById(seeded.orderId);
    expect(
      before?.results_reviewed_at,
      'A freshly released order must start unreviewed, or the doctor\'s queue is meaningless.',
    ).toBeNull();

    // There is no "Mark as seen" button: the values are rendered open, so having them on
    // screen IS the doctor reading them. Review is stamped after a short dwell, which is what
    // clears the tab badge and the Results Ready queue.
    await loginAs('doctor', { hospital: 'A' });
    await page.goto('/opd', { waitUntil: 'domcontentloaded' });
    await page.getByText(NAME, { exact: false }).first().click().catch(() => {});
    await page.getByRole('button', { name: /reports/i }).first().click();
    await expect(
      page.getByText(new RegExp(NORMAL_TEST.replace(/[()]/g, '.'), 'i')).first(),
      'The result is not on screen, so nothing has been read and the review stamp would be a lie.',
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(6_000);

    const after = await labOrderById(seeded.orderId);
    expect(
      after?.results_reviewed_at,
      'Displaying the report did not stamp results_reviewed_at. Without it there is no auditable ' +
      'record that the report was ever read — which is the question a NABH assessor asks — and ' +
      'the doctor\'s Results Ready queue never empties.',
    ).toBeTruthy();
    expect(after?.results_reviewed_by).toBe(doctorId);

    const open = (await clinicalAlertsFor({
      hospitalId: hid, patientId: pid, alertType: 'lab_result_ready',
    })).filter(a => a.is_acknowledged === false);
    expect(
      open.length,
      'The alert stayed open after the doctor read the report, so the queue never empties.',
    ).toBe(0);
  });

  // Finding R1 — "a study ordered from a consultation has no report row and can never be
  // reported" — is covered by TC-P5F-013…015, which drive the shell-less state directly.
  // Not duplicated here.

  test('TC-P5M-005 A signed imaging report notifies the referring doctor', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    const seeded = await seedRadiologyOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      studyName: STUDY, billingStatus: 'billed',
    });

    await loginAs('radiologist', { hospital: 'A' });
    await openRadiology(page);
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, {
      findings: String(P5.radiology.findings), impression: String(P5.radiology.impression),
    });
    await signReport(page);
    await page.waitForTimeout(3_000);

    const report = await radiologyReportFor(seeded.orderId);
    expect(report?.is_signed, 'The report was not signed, so there is nothing to notify about.').toBe(true);

    const alerts = (await clinicalAlertsFor({
      hospitalId: hid, patientId: pid, alertType: 'radiology_report_ready',
    })).filter(a => a.radiology_order_id === seeded.orderId);

    expect(
      alerts.length,
      'Signing the report told the referring clinician nothing. Sign-off used to update the order ' +
      'status and stop there, leaving the report to sit in the radiology module until somebody ' +
      'thought to look for it.',
    ).toBeGreaterThan(0);
    expect(alerts[0].recipient_user_id).toBe(doctorId);
  });

  test('TC-P5M-006 An admitted patient\'s results stay on the admission, not on a stale OPD visit', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('doctor', { hospital: 'A' });
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    const { data: adm } = await db().from('admissions').select('id')
      .eq('hospital_id', hid).eq('patient_id', pid).is('discharged_at', null).limit(1);
    const admissionId = (adm?.[0]?.id as string) ?? null;
    test.skip(!admissionId, 'Seed data has no open admission for this patient.');

    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [NORMAL_TEST], admissionId, billingStatus: 'unbilled',
    });

    const order = await labOrderById(seeded.orderId);
    expect(
      order?.admission_id,
      'The order lost its admission link, so it can never appear in the ward doctor\'s tab.',
    ).toBe(admissionId);
    expect(
      order?.encounter_id,
      'An inpatient order must not also carry an OPD encounter — an investigation belongs to ' +
      'exactly one episode of care, and two links put the result in front of the wrong doctor.',
    ).toBeNull();
  });

  test('TC-P5M-007 A released result starts unreviewed so it surfaces as new', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [NORMAL_TEST], billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });

    await loginAs('lab_technician', { hospital: 'A' });
    await releaseLabResult(page, NORMAL_TEST, String(R.normalHaemoglobin));
    await page.waitForTimeout(2_500);

    const order = await labOrderById(seeded.orderId);
    expect(order?.status, 'The order was not released.').toBe('completed');
    expect(
      order?.results_reviewed_at,
      'Release must not mark the result as reviewed — release is the lab signing off, review is ' +
      'the clinician reading it, and conflating the two erases the only evidence that anyone read it.',
    ).toBeNull();
  });

  test('TC-P5M-008 A doctor sees only the result-ready alerts addressed to them', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('doctor', { hospital: 'A' });
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);

    const alerts = await clinicalAlertsFor({ hospitalId: hid, patientId: pid });
    const resultAlerts = alerts.filter(a =>
      String(a.alert_type ?? '').endsWith('_ready'));

    for (const a of resultAlerts) {
      expect(
        a.recipient_user_id,
        'A result-ready alert with no recipient is broadcast to every clinician in the hospital. ' +
        'Only critical values are meant to reach everyone; a routine CRP reaching all of them is ' +
        'how staff learn to ignore the bell.',
      ).toBeTruthy();
    }

    // Every other alert type stays hospital-wide, which this must not have changed.
    const nonResult = alerts.filter(a => !String(a.alert_type ?? '').endsWith('_ready'));
    for (const a of nonResult) {
      expect(
        a.recipient_user_id ?? null,
        `Alert type ${a.alert_type} was unexpectedly addressed to one user; only result-ready ` +
        'alerts carry a recipient.',
      ).toBeNull();
    }
    void doctorId;
  });
});
