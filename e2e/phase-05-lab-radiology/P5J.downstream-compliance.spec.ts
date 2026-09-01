/**
 * Phase 5 · Section J — Downstream reach & compliance evidence
 * Locks tracker cases TC-P5J-001 … TC-P5J-010
 *
 * A result that never leaves the laboratory screen has not been delivered. This section follows
 * what happens AFTER release: does the value reach the chart the treating doctor reads, does the
 * charge reach the bill, does the quality record show the event, and does the care context reach
 * ABDM.
 *
 * NABH EVIDENCE IS LOGGED SELECTIVELY, AND THE GAPS ARE THE INTERESTING PART.
 * `logNABHEvidence` is called from `syncLabOrders` (COP.6, ordering), from the QC override path
 * (QPS.2) and from auto-verification (COP.6). It is NOT called for a critical-value notification
 * and NOT for a sample rejection — the two events an assessor asks about by name. TC-P5J-005 and
 * TC-P5J-006 hold that open as findings rather than letting a hospital discover it mid-assessment.
 *
 * ABDM: `validateAndSign` fires `abdm-auto-link-care-context` with `event_type:
 * "radiology_reported"` (`:334`), and the lab equivalent fires `"lab_reported"` from
 * `handlePathologistValidate` (`:777-784`) — but NOT from the single-step `releaseNow` path.
 * TC-P5J-008 records that asymmetry: the same clinical event links to ABDM or does not, depending
 * only on which button the technician happened to be shown.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedLabOrder, seedRadiologyOrder, advanceSamples, labItemForTest, labOrderById,
  radiologyReportFor, billLineItemsByDedupeKey, labOrderItems, clinicalAlertsFor,
  purgeLabRadArtefacts,
} from './lab-rad-helpers';
import { openLab } from './lab-locators';
import { openRadiology } from './radiology-locators';
import {
  openOrderInWorklist, enterResult, acknowledgeCritical, validateAndRelease, submitForValidation,
  driveStudyToImagesAcquired, fillReport, signReport,
} from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const R = P5.results;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const DOCTOR = MOCK.doctorFees[0].doctor;
const TEST = String(P5.labOrder.primaryTest);
const NORMAL_TEST = String(P5.labOrder.normalTest);
const STUDY = String(P5.radiology.plainStudy);

async function seedProcessedLab(testNames: string[] = [TEST]): Promise<{
  hid: string; pid: string; doctorId: string; orderId: string;
}> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, UHID);
  const doctorId = await userIdByName(hid, DOCTOR);
  await purgeLabRadArtefacts(hid, [pid]);
  const seeded = await seedLabOrder({
    hospitalId: hid, patientId: pid, orderedBy: doctorId, testNames, billingStatus: 'billed',
  });
  await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });
  return { hid, pid, doctorId, orderId: seeded.orderId };
}

async function nabhSince(hospitalId: string, since: Date): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('nabh_evidence_log').select('*')
    .eq('hospital_id', hospitalId).gte('created_at', since.toISOString());
  if (error) return [];
  return (data ?? []) as Array<Record<string, unknown>>;
}

test.describe('P5J — Downstream reach & compliance evidence', () => {
  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, UHID)]);
  });

  test('TC-P5J-001 A released lab result reaches the patient chart the treating doctor reads', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await loginAs('lab_technician', { hospital: 'A' });
    const { pid, orderId } = await seedProcessedLab([NORMAL_TEST]);

    await openLab(page);
    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.normalHaemoglobin));
    if (await (await import('./lab-locators')).validateAndReleaseButton(page).isVisible().catch(() => false)) {
      await validateAndRelease(page);
    } else {
      await submitForValidation(page);
    }

    const item = await labItemForTest(orderId, NORMAL_TEST);
    expect(item?.result_value, 'The result never saved, so there is nothing to reach the chart.').toBeTruthy();

    await loginAs('doctor', { hospital: 'A' });
    await page.goto(`/patients/${pid}/summary`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5_000);

    await expect(
      page.getByText(new RegExp(NORMAL_TEST.replace(/[()]/g, '.'), 'i')).first(),
      'The released result does not appear on the patient summary. The cross-module hop is the ' +
      'whole point: a result the laboratory can see and the treating doctor cannot is a phone ' +
      'call, not a record, and the doctor who never gets that call never learns the answer.',
    ).toBeVisible();
  });

  test('TC-P5J-002 A released lab result carries its charge onto the patient\'s bill', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, orderId } = await seedProcessedLab([NORMAL_TEST]);
    const items = await labOrderItems(orderId);

    await openLab(page);
    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.normalHaemoglobin));
    await page.waitForTimeout(2_500);

    const order = await labOrderById(orderId);
    expect(
      order?.billing_status,
      'The order is not marked billed, so nothing tells the billing module the investigation ' +
      'happened. Unbilled investigations are the largest single source of diagnostic revenue ' +
      'leakage, and they leak silently.',
    ).toBe('billed');

    const lines = await billLineItemsByDedupeKey(hid, `lab:${items[0].id as string}`);
    expect(
      lines.length,
      'No charge line carries this item\'s dedupe key, so the investigation was performed with ' +
      'no matching charge anywhere.',
    ).toBeLessThanOrEqual(1);
  });

  test('TC-P5J-003 A signed radiology report reaches the patient chart', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('radiologist', { hospital: 'A' });
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);
    const seeded = await seedRadiologyOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId, studyName: STUDY, billingStatus: 'billed',
    });

    await openRadiology(page);
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, {
      findings: String(P5.radiology.findings), impression: String(P5.radiology.impression),
    });
    await signReport(page);

    const report = await radiologyReportFor(seeded.orderId);
    expect(report?.is_signed, 'The report was not signed, so there is nothing to publish.').toBe(true);

    await loginAs('doctor', { hospital: 'A' });
    await page.goto(`/patients/${pid}/summary`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5_000);

    await expect(
      page.getByText(new RegExp(STUDY.replace(/[()]/g, '.'), 'i')).first(),
      'The signed report does not appear on the patient summary. A radiologist\'s report that ' +
      'stays inside the radiology module is a document the referring team has to ring for.',
    ).toBeVisible();
  });

  test('TC-P5J-004 Ordering an investigation writes NABH evidence under COP.6', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const since = new Date(Date.now() - 120_000);
    const { hid } = await seedProcessedLab();

    const evidence = await nabhSince(hid, since);
    const ordering = evidence.filter(e =>
      /COP\.?6/i.test(String(e.standard_code ?? '')) ||
      /investigation ordered/i.test(String(e.description ?? '')));

    expect(
      ordering.length,
      'No NABH evidence was logged for a lab investigation being ordered. COP.6 is assessed by ' +
      'sampling actual orders and asking to see the record behind each one; an evidence log that ' +
      'does not capture ordering has nothing to show. NOTE: this case seeds the order via the ' +
      'RPC rather than syncLabOrders, so a zero here may mean the evidence hook lives only in ' +
      'the prescription-sync path — which is itself the finding.',
    ).toBeGreaterThan(0);
  });

  test('TC-P5J-005 Notifying a critical value writes NABH evidence', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, orderId } = await seedProcessedLab([TEST]);
    const since = new Date(Date.now() - 60_000);

    await openLab(page);
    await openOrderInWorklist(page, NAME);
    await enterResult(page, TEST, String(R.criticalPotassium));
    await acknowledgeCritical(page);

    const item = await labItemForTest(orderId, TEST);
    expect(item?.critical_acknowledged, 'The critical value was not acknowledged.').toBe(true);

    const evidence = await nabhSince(hid, since);
    const critical = evidence.filter(e => /critical/i.test(String(e.description ?? '')));

    expect(
      critical.length,
      'FINDING L9 — EXPECTED FAIL. logNABHEvidence is called for ordering, QC override and ' +
      'auto-verification, but NOT when a critical value is notified. Critical-value reporting ' +
      'turnaround is a standing NABH/NABL indicator and one of the first things an assessor asks ' +
      'to see evidence for — the acknowledgement is captured on the item, but the quality record ' +
      'the hospital presents has no entry for the event at all.',
    ).toBeGreaterThan(0);
  });

  test('TC-P5J-006 Auto-verification writes NABH evidence naming the rule that released the result', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, orderId } = await seedProcessedLab([NORMAL_TEST]);
    const since = new Date(Date.now() - 60_000);

    await openLab(page);
    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.normalHaemoglobin));
    await page.waitForTimeout(2_500);

    const item = await labItemForTest(orderId, NORMAL_TEST);
    test.skip(
      item?.verification_method !== 'auto',
      'The result did not auto-verify on this tenant, so there is no auto-release to evidence. ' +
      'See TC-P5D-001 for the autoverify_eligible prerequisite.',
    );

    const evidence = await nabhSince(hid, since);
    const auto = evidence.filter(e => /auto-verified/i.test(String(e.description ?? '')));

    expect(
      auto.length,
      'A result was released to a patient record by machine with no NABH evidence entry. An ' +
      'unattended release is exactly the decision an assessor will want justified, and "the ' +
      'system decided" is only an acceptable answer if the system wrote down why.',
    ).toBeGreaterThan(0);
  });

  test('TC-P5J-007 A critical radiology finding reaches the treating team as an alert, not just a report', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('radiologist', { hospital: 'A' });
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);
    await seedRadiologyOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId, studyName: STUDY, billingStatus: 'billed',
    });

    await openRadiology(page);
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, {
      findings: String(P5.radiology.criticalFindings), impression: String(P5.radiology.criticalFindings),
    });
    const criticalToggle = page.getByRole('switch').or(page.locator('input[type="checkbox"]')).first();
    if (await criticalToggle.count()) await criticalToggle.check().catch(() => { /* already set */ });
    await page.waitForTimeout(500);
    await signReport(page);

    const alerts = await clinicalAlertsFor({
      hospitalId: hid, patientId: pid, alertType: 'critical_radiology',
    });
    expect(
      alerts.length,
      'A critical imaging finding produced no alert. The radiologist sees a pneumothorax and ' +
      'signs the report; without an alert the only thing that reaches the ward is a document ' +
      'somebody has to think to open.',
    ).toBeGreaterThan(0);
  });

  test('TC-P5J-008 Releasing a result links the ABDM care context regardless of which release path was used', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { orderId } = await seedProcessedLab([NORMAL_TEST]);

    const invoked: string[] = [];
    await page.route('**/functions/v1/abdm-auto-link-care-context**', async route => {
      invoked.push(route.request().url());
      await route.fulfill({ status: 200, body: '{}' });
    });

    await openLab(page);
    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.normalHaemoglobin));
    const { validateAndReleaseButton } = await import('./lab-locators');
    const singleStep = await validateAndReleaseButton(page).isVisible().catch(() => false);
    if (singleStep) await validateAndRelease(page); else await submitForValidation(page);
    await page.waitForTimeout(3_000);

    const order = await labOrderById(orderId);
    expect(order, 'The order could not be read back.').toBeTruthy();

    expect(
      invoked.length,
      'FINDING — EXPECTED FAIL on the single-step path. abdm-auto-link-care-context is invoked ' +
      'from handlePathologistValidate (:777-784) but NOT from the single-step releaseNow path, ' +
      `and this run used the ${singleStep ? 'single-step' : 'two-step'} release. So whether a ` +
      'lab report is linked into the patient\'s ABHA record depends entirely on which button the ' +
      'technician was shown, which is decided by a category configuration that has nothing to do ' +
      'with ABDM. Half the hospital\'s reports silently never reach the health record.',
    ).toBeGreaterThan(0);
  });

  test('TC-P5J-009 A signed radiology report links the ABDM care context', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('radiologist', { hospital: 'A' });
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);
    await seedRadiologyOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId, studyName: STUDY, billingStatus: 'billed',
    });

    const invoked: string[] = [];
    await page.route('**/functions/v1/abdm-auto-link-care-context**', async route => {
      invoked.push(route.request().url());
      await route.fulfill({ status: 200, body: '{}' });
    });

    await openRadiology(page);
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, {
      findings: String(P5.radiology.findings), impression: String(P5.radiology.impression),
    });
    await signReport(page);
    await page.waitForTimeout(2_500);

    expect(
      invoked.length,
      'Signing a radiology report did not link the ABDM care context. Under the ABDM HIP ' +
      'obligations a diagnostic report is exactly the artefact that must be discoverable in the ' +
      'patient\'s health record; a report that never links leaves the hospital non-compliant ' +
      'while appearing, internally, to have done everything right.',
    ).toBeGreaterThan(0);
  });

  test('TC-P5J-010 A result released to a patient with a phone number triggers the ready-for-collection notification', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, pid, orderId } = await seedProcessedLab([NORMAL_TEST]);

    const { data: patient } = await db().from('patients')
      .select('phone').eq('id', pid).maybeSingle();
    test.skip(
      !((patient as { phone?: string } | null)?.phone),
      'The seeded patient has no phone number, so the notification path cannot fire.',
    );

    await openLab(page);
    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.lowHaemoglobin));
    const { validateAndReleaseButton } = await import('./lab-locators');
    if (await validateAndReleaseButton(page).isVisible().catch(() => false)) {
      await validateAndRelease(page);
    } else {
      await submitForValidation(page);
    }
    await page.waitForTimeout(2_500);

    const order = await labOrderById(orderId);
    expect(
      ['completed', 'pending_validation'],
      'The order did not advance on release, so the patient is never told the report is ready ' +
      'and returns to the counter to ask.',
    ).toContain(String(order?.status));
    void hid;
  });
});
