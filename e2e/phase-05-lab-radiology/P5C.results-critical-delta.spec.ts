/**
 * Phase 5 · Section C — Result entry, critical values & the delta check (P5-S07 🔴, P5-S08)
 * Locks tracker cases TC-P5C-001 … TC-P5C-014
 *
 * HOW A FLAG IS DECIDED (LabResultWorkspace.tsx:103-110), because every case here turns on it:
 *
 *     value < critical_low   → "CL"
 *     value > critical_high  → "CH"
 *     value < normal_min     → "L"
 *     value > normal_max     → "H"
 *     otherwise              → "N"
 *
 * Note the comparisons are STRICT. A value exactly equal to `critical_high` is NOT critical —
 * TC-P5C-005 and TC-P5C-006 pin that boundary, because "is 6.0 critical when the threshold is
 * 6.0?" is exactly the question a clinician will ask the first time it matters.
 *
 * ONLY A `CH`/`CL` FLAG RAISES AN ALERT OR BLOCKS RELEASE. That is why the seeded catalogue must
 * carry `critical_low`/`critical_high` at all (finding L3): with a normal range but no critical
 * range, potassium 7.2 flags a plain "H", no `clinical_alerts` row is written, release is not
 * blocked, and every assertion in P5-S07 passes vacuously while the hospital has no critical
 * value alerting whatsoever. TC-P5C-001 checks the configuration FIRST, so a red result here is
 * read as "the tenant is not configured" rather than as nine unrelated product defects.
 *
 * 🔴 TC-P5C-010 … 012 ARE THE DELTA DEFECT (finding L1) AND ARE EXPECTED TO FAIL.
 * `lab_order_items.delta_flag` is `boolean DEFAULT false` in every migration, and the generated
 * types agree — but the save writes the STRING `"delta"` (`:501`). PostgREST rejects it with
 * `22P02 invalid input syntax for type boolean`, and `:508` swallows the error with a bare
 * `console.error(...); return`. The consequence is not a missing flag: THE ENTIRE RESULT SAVE IS
 * DISCARDED. No value, no flag, no critical alert, no toast — for precisely the results that
 * moved most, which are the ones that matter most. The Vitest suite passes because it never
 * touches a database. Do not make these green by relaxing them.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedLabOrder, seedPriorResult, advanceSamples, labItemForTest, labOrderById,
  clinicalAlertsFor, purgeLabRadArtefacts,
} from './lab-rad-helpers';
import {
  openLab, criticalBanner, criticalAcknowledgedMarker, validateAndReleaseButton,
  submitForValidationButton, deltaBadge,
} from './lab-locators';
import { openOrderInWorklist, enterResult, acknowledgeCritical } from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const R = P5.results;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const CKD_UHID = 'PT-QA-0022';
const CKD_NAME = 'Gopal Krishna';
const DOCTOR = MOCK.doctorFees[0].doctor;

const K_TEST = String(P5.labOrder.primaryTest);        // Serum Potassium
const CREAT_TEST = String(P5.labOrder.secondaryTest);  // Serum Creatinine
const NORMAL_TEST = String(P5.labOrder.normalTest);    // Haemoglobin

/** Seed an order and drive it to the state where a result can be typed. */
async function readyForResult(testNames: string[], uhid = UHID): Promise<{
  hid: string; pid: string; doctorId: string; orderId: string;
}> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  const doctorId = await userIdByName(hid, DOCTOR);
  await purgeLabRadArtefacts(hid, [pid]);
  const seeded = await seedLabOrder({
    hospitalId: hid, patientId: pid, orderedBy: doctorId,
    testNames, billingStatus: 'billed',
  });
  await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });
  return { hid, pid, doctorId, orderId: seeded.orderId };
}

test.describe('P5C — Results, critical values & the delta check', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
  });

  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    for (const uhid of [UHID, CKD_UHID]) {
      await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, uhid)]);
    }
  });

  /* ── The configuration this whole section depends on ────────────────── */

  test('TC-P5C-001 The lab catalogue carries critical ranges, without which no critical value can ever be detected', async () => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');

    const { data } = await db().from('lab_test_master')
      .select('test_name, normal_min, normal_max, critical_low, critical_high')
      .eq('hospital_id', hid).eq('test_name', K_TEST).maybeSingle();

    expect(data, `"${K_TEST}" is not in the catalogue. Run: npm run qa:seed`).toBeTruthy();
    const row = data as { critical_low: number | null; critical_high: number | null };

    expect(
      row.critical_high,
      `FINDING L3 / PREREQUISITE. "${K_TEST}" has a normal range but critical_high is null. ` +
      'calcFlag derives CH/CL from critical_low/critical_high ALONE, and only a CH/CL flag ' +
      'writes a clinical_alerts row or blocks release — so with these null, a potassium of 7.2 ' +
      'flags a harmless "H", no alert is raised, the result is released unchallenged, and the ' +
      'hospital has NO critical-value alerting at all while every screen looks normal. Run ' +
      'npm run qa:seed with the updated seeder.',
    ).not.toBeNull();
    expect(Number(row.critical_high)).toBeLessThan(Number(R.criticalPotassium));
  });

  /* ── P5-S07 · Critical value 🔴 ─────────────────────────────────────── */

  test('TC-P5C-002 Critical potassium journey: 7.2 is entered, flags CH, and raises a critical clinical alert', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid, orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.criticalPotassium));

    const item = await labItemForTest(orderId, K_TEST);
    expect(
      item?.result_value,
      'The result did not save at all. Nothing reached lab_order_items, so the doctor waiting on ' +
      'a potassium sees an order still in progress.',
    ).toBeTruthy();
    expect(
      item?.result_flag,
      `A potassium of ${R.criticalPotassium} mEq/L must flag "CH". A value this high is a cardiac ` +
      'arrest risk within hours; flagged as anything softer it queues behind routine work.',
    ).toBe('CH');

    const alerts = await clinicalAlertsFor({
      hospitalId: hid, patientId: pid, alertType: 'critical_lab_value',
    });
    expect(
      alerts.length,
      'No critical_lab_value alert was raised. The flag on a screen nobody is watching is not a ' +
      'notification — the alert row is the only thing that reaches the treating doctor.',
    ).toBeGreaterThan(0);
    expect(
      alerts[0].severity,
      'The critical alert was raised at a severity below "critical", so it sorts in with routine ' +
      'notifications and is read whenever someone gets to it.',
    ).toBe('critical');
  });

  test('TC-P5C-003 The critical alert names the patient and the value, so the doctor can act without opening the chart', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid, orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.criticalPotassium));

    const alerts = await clinicalAlertsFor({
      hospitalId: hid, patientId: pid, alertType: 'critical_lab_value',
    });
    expect(alerts.length, 'No critical alert to inspect.').toBeGreaterThan(0);
    const message = String(alerts[0].alert_message ?? '');

    expect(
      message,
      'The alert message does not name the test. "A critical value" with no test named makes a ' +
      'doctor open the chart to find out what is wrong, which is the delay the alert exists to ' +
      'remove.',
    ).toContain(K_TEST);
    expect(message, 'The alert message does not carry the value itself.').toContain(String(R.criticalPotassium));

    const item = await labItemForTest(orderId, K_TEST);
    expect(
      alerts[0].lab_order_item_id,
      'The alert is not linked to the result that raised it, so acknowledging it cannot close ' +
      'the loop back to the item.',
    ).toBe(item?.id);
  });

  test('TC-P5C-004 A critical result cannot be released until someone confirms the treating doctor was told', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.criticalPotassium));

    await expect(
      criticalBanner(page),
      'No critical banner appeared for a potassium of 7.2, so nothing prompts the technician to ' +
      'pick up the phone.',
    ).toBeVisible();

    const release = validateAndReleaseButton(page);
    const submit = submitForValidationButton(page);
    const releaseEnabled = await release.isEnabled().catch(() => false);
    const submitEnabled = await submit.isEnabled().catch(() => false);

    expect(
      releaseEnabled || submitEnabled,
      'An unacknowledged critical value can be released straight through. The acknowledgement ' +
      'is where the technician confirms the treating doctor was actually told — releasing ' +
      'without it means a life-threatening result reaches a report nobody is waiting to read.',
    ).toBe(false);

    const acknowledged = await labItemForTest(orderId, K_TEST);
    expect(acknowledged?.critical_acknowledged, 'Nothing has been acknowledged yet.').toBeFalsy();
  });

  test('TC-P5C-005 A potassium exactly at the critical threshold is NOT critical — the comparison is strict', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await readyForResult([K_TEST]);
    const threshold = MOCK.labTests.find(t => t.name === K_TEST)?.criticalHigh;

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.atCriticalThresholdPotassium));

    const item = await labItemForTest(orderId, K_TEST);
    expect(
      item?.result_flag,
      `A value exactly equal to critical_high (${threshold}) must not flag CH — calcFlag uses ` +
      '`value > critical_high`, strictly. This is the boundary a clinician asks about the first ' +
      'time it matters, and the answer has to be the same every time.',
    ).not.toBe('CH');
    expect(item?.result_flag, 'A value above the normal range must still flag "H".').toBe('H');
  });

  test('TC-P5C-006 A potassium one step over the critical threshold IS critical', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.justOverCriticalPotassium));

    const item = await labItemForTest(orderId, K_TEST);
    expect(
      item?.result_flag,
      `${R.justOverCriticalPotassium} is above critical_high and must flag CH. Together with the ` +
      'case above this pins the boundary from both sides — an off-by-one here means either every ' +
      'borderline result screams or none of them do.',
    ).toBe('CH');
  });

  test('TC-P5C-007 A potassium at the top of the normal range flags N, not H — no false alarm', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.highNormalPotassium));

    const item = await labItemForTest(orderId, K_TEST);
    expect(
      item?.result_flag,
      `${R.highNormalPotassium} is exactly normal_max and must flag "N". A range that flags its ` +
      'own upper bound as abnormal produces a flagged result on every healthy patient, and alert ' +
      'fatigue is how a real critical value gets scrolled past.',
    ).toBe('N');
  });

  test('TC-P5C-008 A potassium just above the normal range flags H — abnormal but not critical', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid, orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.justAboveNormalPotassium));

    const item = await labItemForTest(orderId, K_TEST);
    expect(item?.result_flag, `${R.justAboveNormalPotassium} is above normal_max and must flag "H".`).toBe('H');

    const alerts = await clinicalAlertsFor({
      hospitalId: hid, patientId: pid, alertType: 'critical_lab_value',
    });
    expect(
      alerts.length,
      'A merely abnormal result raised a CRITICAL alert. Escalating every high potassium to a ' +
      'critical page is how a ward learns to ignore the pager.',
    ).toBe(0);
  });

  test('TC-P5C-009 Acknowledging a critical value records who did it and unblocks release', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid, orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.criticalPotassium));
    await acknowledgeCritical(page);

    const item = await labItemForTest(orderId, K_TEST);
    expect(
      item?.critical_acknowledged,
      'The acknowledgement did not persist, so the release stays blocked and the report never ' +
      'reaches the doctor who is waiting for it.',
    ).toBe(true);
    expect(
      item?.critical_acknowledged_by,
      'Nobody is recorded as having acknowledged it. When the question later is "who told the ' +
      'doctor, and when", an anonymous tick answers neither.',
    ).toBeTruthy();

    await expect(criticalAcknowledgedMarker(page)).toBeVisible();

    const alerts = await clinicalAlertsFor({
      hospitalId: hid, patientId: pid, alertType: 'critical_lab_value',
    });
    expect(
      alerts[0].is_acknowledged,
      'The clinical_alerts row was not closed when the item was acknowledged, so the alert ' +
      'stays open on every dashboard that reads it long after it was actioned.',
    ).toBe(true);
  });

  /* ── P5-S08 · Delta check 🔴 (finding L1) ───────────────────────────── */

  test('TC-P5C-010 Delta journey: creatinine 0.9 then 4.5 on the same patient saves the result at all', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, CKD_UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    await seedPriorResult({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testName: CREAT_TEST, value: String(R.creatinineBaseline), daysAgo: 30,
    });
    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [CREAT_TEST], billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });

    await openOrderInWorklist(page, CKD_NAME);
    await enterResult(page, CREAT_TEST, String(R.creatinineDelta));

    const item = await labItemForTest(seeded.orderId, CREAT_TEST);
    expect(
      item?.result_value,
      'EXPECTED FAIL until finding L1 is fixed. THE WHOLE RESULT WAS DISCARDED. ' +
      'lab_order_items.delta_flag is a boolean column, but a >50% swing makes the save write the ' +
      'string "delta" into it (LabResultWorkspace.tsx:501). PostgREST returns 22P02 and :508 ' +
      'swallows it with a bare console.error and return — so no value, no flag, no alert and no ' +
      'toast. A creatinine that jumps 0.9 → 4.5 is acute kidney injury; it is the single most ' +
      'important result of that patient\'s day, and it is the one class of result this app ' +
      'cannot save. Fix the column type or write a boolean; do not relax this test.',
    ).toBeTruthy();
    expect(String(item?.result_value ?? ''), 'The saved value is not the one that was typed.')
      .toBe(String(R.creatinineDelta));
  });

  test('TC-P5C-011 A >50% swing from the previous result is flagged for review', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, CKD_UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    await seedPriorResult({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testName: CREAT_TEST, value: String(R.creatinineBaseline), daysAgo: 30,
    });
    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [CREAT_TEST], billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });

    await openOrderInWorklist(page, CKD_NAME);
    await enterResult(page, CREAT_TEST, String(R.creatinineDelta));

    const item = await labItemForTest(seeded.orderId, CREAT_TEST);
    expect(
      item?.delta_flag,
      'EXPECTED FAIL until finding L1 is fixed. The delta check exists to catch exactly this: a ' +
      'result that is individually plausible but impossible for THIS patient in this interval. ' +
      'Unflagged, a creatinine of 4.5 in a patient last seen at 0.9 is auto-released as a ' +
      'routine abnormal, and the acute kidney injury is found when the patient deteriorates.',
    ).toBeTruthy();
    expect(
      String(item?.previous_value ?? ''),
      'The previous value was not carried onto the result, so the reviewer sees a flag with ' +
      'nothing to compare it against.',
    ).toBe(String(R.creatinineBaseline));
  });

  test('TC-P5C-012 A delta-flagged result raises a lab_trend alert and shows the previous value on screen', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, CKD_UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    await seedPriorResult({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testName: CREAT_TEST, value: String(R.creatinineBaseline), daysAgo: 30,
    });
    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [CREAT_TEST], billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });

    await openOrderInWorklist(page, CKD_NAME);
    await enterResult(page, CREAT_TEST, String(R.creatinineDelta));

    await expect(
      deltaBadge(page),
      'EXPECTED FAIL until finding L1 is fixed. No Δ badge is shown beside the result, so the ' +
      'reviewer has no on-screen signal that this value contradicts the patient\'s history.',
    ).toBeVisible();

    const alerts = await clinicalAlertsFor({ hospitalId: hid, patientId: pid, alertType: 'lab_trend' });
    expect(
      alerts.length,
      'No lab_trend alert was raised for a >50% swing, so nothing reaches the treating team ' +
      'outside the lab screen.',
    ).toBeGreaterThan(0);
  });

  test('TC-P5C-013 A result within 50% of the previous one is NOT delta-flagged', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, CKD_UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    await purgeLabRadArtefacts(hid, [pid]);

    await seedPriorResult({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testName: CREAT_TEST, value: String(R.creatinineBaseline), daysAgo: 30,
    });
    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [CREAT_TEST], billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });

    await openOrderInWorklist(page, CKD_NAME);
    await enterResult(page, CREAT_TEST, String(R.creatinineNoDelta));

    const item = await labItemForTest(seeded.orderId, CREAT_TEST);
    expect(item?.result_value, 'The in-range result did not save.').toBeTruthy();
    expect(
      item?.delta_flag,
      `${R.creatinineBaseline} → ${R.creatinineNoDelta} is a swing well under the 50% threshold ` +
      'and must not be flagged. A delta check that fires on ordinary biological variation flags ' +
      'most of the day\'s work, and a reviewer facing that queue stops reading the flags.',
    ).toBeFalsy();
  });

  test('TC-P5C-014 The first ever result for a patient has nothing to compare against and is not delta-flagged', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await readyForResult([NORMAL_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.normalHaemoglobin));

    const item = await labItemForTest(orderId, NORMAL_TEST);
    expect(item?.result_value, 'The first result did not save.').toBeTruthy();
    expect(
      item?.delta_flag,
      'A patient\'s FIRST result was delta-flagged. There is no previous value to differ from, ' +
      'so a flag here means the lookup fell back to another patient\'s history or to a default — ' +
      'either of which would put one patient\'s trend on another\'s report.',
    ).toBeFalsy();
    expect(item?.previous_value, 'A first result must carry no previous value.').toBeFalsy();
  });
});
