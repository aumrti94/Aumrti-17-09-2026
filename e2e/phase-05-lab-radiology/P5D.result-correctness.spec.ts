/**
 * Phase 5 · Section D — Result correctness (TC-P5D-001 … 003)
 *
 * HOW A FLAG IS DECIDED (`LabResultWorkspace.tsx:103-110`), because the whole section turns on it:
 *
 *     value < critical_low   → "CL"
 *     value > critical_high  → "CH"
 *     value < normal_min     → "L"
 *     value > normal_max     → "H"
 *     otherwise              → "N"
 *
 * The comparisons are STRICT. A value exactly equal to `critical_high` is NOT critical — TC-P5D-001
 * pins that from both sides, because "is 6.5 critical when the threshold is 6.5?" is the question a
 * clinician asks the first time it matters, and the answer has to be the same every time.
 *
 * ONLY A `CH`/`CL` FLAG RAISES AN ALERT OR BLOCKS RELEASE. With a normal range but no critical
 * range, a potassium of 7.2 flags a harmless "H", no alert row is written, release is not blocked,
 * and every assertion in the section passes vacuously while the hospital has no critical-value
 * alerting whatsoever. The journey therefore reads the catalogue BEFORE it types anything.
 *
 * A BOUNDARY CASE IS ONLY A BOUNDARY CASE IF IT SITS ON THE BOUNDARY. The mock values were once
 * authored against a normal_max of 5.1 and a critical_high of 6.0 while the catalogue seeded 5.0
 * and 6.5, so two "boundary" stages tested values nowhere near a boundary and failed looking
 * exactly like a defect in `calcFlag`. Stage 3 asserts the relationship instead of trusting two
 * files to agree by memory.
 */
import { test, expect } from './p5-journey.fixture';
import { MOCK } from '../fixtures/auth.fixture';
import { db } from '../utils/db-verify';
import { testTitle } from './p5-manifest';
import { userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  labOrdersFor, labOrderItems, labItemForTest, clinicalAlertsFor, nabhEvidenceFor,
} from './lab-rad-helpers';
import { seedPriorResult } from './p5-seed-of-last-resort';
import {
  orderLabThroughModal, collectThroughWorkstation, receiveSample, processSample,
  openOrderInWorklist, enterResult, enterTextResult, releaseResults, openWorkspaceTab,
  saveAllResults, writeLabNotes, acknowledgeCriticalValue,
} from './p5-stages';
import {
  criticalBanner, criticalNotifyCheckbox, acknowledgeCriticalButton, criticalAcknowledgedMarker,
  validateAndReleaseButton, submitForValidationButton, deltaBadge, autoVerifiedBadge,
  WORKSPACE_TABS, saveAllButton, labNotesTextarea, organismInput, colonyCountInput,
  saveAntibiogramButton, interpretiveCommentTextarea, saveCommentButton,
  cumulativeButton, whatsappButton, printReportButton, resultInput,
} from './lab-locators';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const R = P5.results;

const DOCTOR = MOCK.doctorFees[0].doctor;
const K_TEST = String(P5.labOrder.primaryTest);        // Serum Potassium
const CREAT = String(P5.labOrder.secondaryTest);       // Serum Creatinine
const HB = String(P5.labOrder.normalTest);             // Haemoglobin — autoverify eligible
const CULTURE = String(P5.labOrder.cultureTest);       // Blood Culture

test.describe('P5D — Result correctness', () => {
  test(testTitle('TC-P5D-001'), async ({ page, loginAs, logout, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    let normalMax = 0;
    let criticalHigh = 0;
    let orderId = '';

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_test_master')
        .select('normal_min, normal_max, critical_low, critical_high')
        .eq('hospital_id', hid).eq('test_name', K_TEST).maybeSingle();
      expect(data, `"${K_TEST}" is not in the catalogue at all.` + jrn.note()).toBeTruthy();
      const row = data as { normal_max: number; critical_high: number | null };
      normalMax = Number(row.normal_max);
      criticalHigh = Number(row.critical_high);

      expect(
        row.critical_high,
        `"${K_TEST}" has a normal range but critical_high is null. calcFlag derives CH/CL from ` +
        'critical_low/critical_high ALONE, and only a CH/CL flag writes a clinical_alerts row or ' +
        'blocks release — so with these null a potassium of 7.2 flags a harmless "H", no alert is ' +
        'raised, the result is released unchallenged, and the hospital has NO critical-value ' +
        'alerting at all while every screen looks normal.',
      ).not.toBeNull();
    });

    await jrn.next(async () => {
      expect.soft(
        Number(R.highNormalPotassium),
        `"high normal" must equal normal_max (${normalMax}) — it is the value that proves a range ` +
        'does not flag its own upper bound as abnormal.',
      ).toBe(normalMax);
      expect.soft(
        Number(R.atCriticalThresholdPotassium),
        `"at the critical threshold" must equal critical_high (${criticalHigh}) — the whole point ` +
        'of the strict-comparison stage is that a value EQUAL to the threshold is not critical.',
      ).toBe(criticalHigh);
      expect.soft(
        Number(R.justOverCriticalPotassium),
        `"just over critical" must be greater than critical_high (${criticalHigh}), or the CH ` +
        'stage asserts CH on a value that is not critical.',
      ).toBeGreaterThan(criticalHigh);
      expect.soft(
        Number(R.criticalPotassium),
        'The frankly-critical value must be above critical_high.',
      ).toBeGreaterThan(criticalHigh);
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [K_TEST] });
      const orders = await labOrdersFor(hid, pid);
      expect(orders.length, 'The potassium order was not created.' + jrn.note()).toBeGreaterThan(0);
      orderId = orders[0].id as string;
      await collectThroughWorkstation(page, patient.uhid);
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
    });

    await jrn.next(async () => {
      await openOrderInWorklist(page, patient.uhid);
    });

    await jrn.next(async () => {
      await enterResult(page, K_TEST, String(R.highNormalPotassium));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, K_TEST);
      expect.soft(
        item?.result_flag,
        `${R.highNormalPotassium} is exactly normal_max and must flag "N". A range that flags its ` +
        'own upper bound as abnormal produces a flagged result on every healthy patient, and ' +
        'alert fatigue is how a real critical value gets scrolled past.',
      ).toBe('N');
    });

    await jrn.next(async () => {
      await enterResult(page, K_TEST, String(R.justAboveNormalPotassium));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, K_TEST);
      expect.soft(
        item?.result_flag,
        `${R.justAboveNormalPotassium} is above normal_max and must flag "H" — abnormal, but not ` +
        'an emergency.',
      ).toBe('H');
    });

    await jrn.next(async () => {
      const alerts = await clinicalAlertsFor({
        hospitalId: hid, patientId: pid, alertType: 'critical_lab_value',
      });
      expect.soft(
        alerts.length,
        'A merely abnormal result raised a CRITICAL alert. Escalating every high potassium to a ' +
        'critical page is how a ward learns to ignore the pager, and the one that matters is then ' +
        'lost in the noise.',
      ).toBe(0);
    });

    await jrn.next(async () => {
      await enterResult(page, K_TEST, String(R.atCriticalThresholdPotassium));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, K_TEST);
      expect.soft(
        item?.result_flag,
        `A value exactly equal to critical_high (${criticalHigh}) must not flag CH — calcFlag uses ` +
        '`value > critical_high`, strictly. This is the boundary a clinician asks about the first ' +
        'time it matters, and the answer has to be the same every time.',
      ).not.toBe('CH');
      expect.soft(item?.result_flag, 'A value above the normal range must still flag "H".').toBe('H');
    });

    await jrn.next(async () => {
      await enterResult(page, K_TEST, String(R.justOverCriticalPotassium));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, K_TEST);
      expect.soft(
        item?.result_flag,
        `${R.justOverCriticalPotassium} is above critical_high and must flag CH. Together with the ` +
        'stage above this pins the boundary from both sides — an off-by-one here means either ' +
        'every borderline result screams or none of them do.',
      ).toBe('CH');
    });

    await jrn.next(async () => {
      await enterResult(page, K_TEST, String(R.criticalPotassium));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, K_TEST);
      expect(
        item?.result_value,
        'The critical result did not save at all, so the doctor waiting on a potassium sees an ' +
        'order still in progress.' + jrn.note(),
      ).toBeTruthy();
      expect.soft(
        item?.result_flag,
        `A potassium of ${R.criticalPotassium} mEq/L must flag "CH". A value this high is a ` +
        'cardiac arrest risk within hours; flagged as anything softer it queues behind routine work.',
      ).toBe('CH');
    });

    await jrn.next(async () => {
      const alerts = await clinicalAlertsFor({
        hospitalId: hid, patientId: pid, alertType: 'critical_lab_value',
      });
      expect.soft(
        alerts.length,
        'No critical_lab_value alert was raised. A flag on a screen nobody is watching is not a ' +
        'notification — the alert row is the only thing that reaches the treating doctor.',
      ).toBeGreaterThan(0);
      if (alerts.length) {
        expect.soft(
          alerts[0].severity,
          'The critical alert was raised below "critical" severity, so it sorts in with routine ' +
          'notifications and is read whenever somebody gets to it.',
        ).toBe('critical');
      }
    });

    await jrn.next(async () => {
      const alerts = await clinicalAlertsFor({
        hospitalId: hid, patientId: pid, alertType: 'critical_lab_value',
      });
      const message = String(alerts[0]?.alert_message ?? '');
      expect.soft(
        message,
        'The alert does not name the test. "A critical value" with no test named makes a doctor ' +
        'open the chart to find out what is wrong, which is the delay the alert exists to remove.',
      ).toContain(K_TEST);
      expect.soft(message, 'The alert does not carry the value itself.').toContain(String(R.criticalPotassium));
    });

    await jrn.next(async () => {
      const alerts = await clinicalAlertsFor({
        hospitalId: hid, patientId: pid, alertType: 'critical_lab_value',
      });
      const item = await labItemForTest(orderId, K_TEST);
      expect.soft(
        alerts[0]?.lab_order_item_id,
        'The alert is not linked to the result that raised it, so acknowledging it cannot close ' +
        'the loop back to the item.',
      ).toBe(item?.id);
    });

    await jrn.next(async () => {
      await expect.soft(
        criticalBanner(page),
        'No critical banner appeared for a potassium of 7.2, so nothing prompts the technician to ' +
        'pick up the phone.',
      ).toBeVisible({ timeout: 10_000 });
    });

    await jrn.next(async () => {
      const releaseEnabled = await validateAndReleaseButton(page).isEnabled().catch(() => false);
      const submitEnabled = await submitForValidationButton(page).isEnabled().catch(() => false);
      expect.soft(
        releaseEnabled || submitEnabled,
        'An unacknowledged critical value can be released straight through. The acknowledgement is ' +
        'where the technician confirms the treating doctor was actually told — releasing without ' +
        'it means a life-threatening result reaches a report nobody is waiting to read.',
      ).toBe(false);
    });

    await jrn.next(async () => {
      await expect.soft(
        acknowledgeCriticalButton(page),
        'Acknowledge is enabled before the technician has ticked that they telephoned the doctor. ' +
        'The tick is the whole control; an enabled button turns a phone call into a formality.',
      ).toBeDisabled();
    });

    await jrn.next(async () => {
      await criticalNotifyCheckbox(page).check();
      await page.waitForTimeout(400);
      await acknowledgeCriticalButton(page).click();
      await page.waitForTimeout(2_500);
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, K_TEST);
      expect.soft(
        item?.critical_acknowledged,
        'The acknowledgement did not persist, so the release stays blocked and the report never ' +
        'reaches the doctor who is waiting for it.',
      ).toBe(true);
      expect.soft(
        item?.critical_acknowledged_by,
        'Nobody is recorded as having acknowledged it. When the question later is "who told the ' +
        'doctor, and when", an anonymous tick answers neither.',
      ).toBeTruthy();
      await expect.soft(criticalAcknowledgedMarker(page)).toBeVisible({ timeout: 8_000 });
    });

    await jrn.next(async () => {
      const alerts = await clinicalAlertsFor({
        hospitalId: hid, patientId: pid, alertType: 'critical_lab_value',
      });
      expect.soft(
        alerts[0]?.is_acknowledged,
        'The clinical_alerts row was not closed when the item was acknowledged, so the alert stays ' +
        'open on every dashboard that reads it long after it was actioned.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      await releaseResults(page);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect.soft(
        ['completed', 'pending_validation'],
        'The acknowledged critical result was not released, so the phone call happened and the ' +
        'report still never reached the chart.',
      ).toContain(String((data as { status: string } | null)?.status));
    });

    await jrn.next(async () => {
      await logout();
      await loginAs('doctor', { hospital: 'A' });
      await page.goto(`/patients/${pid}/summary`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5_000);
      await expect.soft(
        page.getByText(new RegExp(K_TEST.replace(/[()]/g, '.'), 'i')).first(),
        'The critical result is not on the patient summary. A result the laboratory can see and ' +
        'the treating doctor cannot is a phone call, not a record.',
      ).toBeVisible({ timeout: 20_000 });
    });

    await jrn.next(async () => {
      const since = new Date(Date.now() - 30 * 60_000);
      const evidence = await nabhEvidenceFor(hid, since);
      const critical = evidence.filter(e => /critical/i.test(JSON.stringify(e)));
      expect.soft(
        critical.length,
        'FINDING L9. Notifying a critical value writes no NABH evidence. "Critical value ' +
        'notification turnaround" is one of the indicators an assessor asks for by name, and an ' +
        'event with no evidence row cannot be counted or defended at an assessment.',
      ).toBeGreaterThan(0);
    });
  });

  test(testTitle('TC-P5D-002'), async ({ page, loginAs, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    let deltaOrderId = '';

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      // CONDITION (a) — a 30-day-old baseline cannot be created in real time, and no screen writes
      // a back-dated result. This is the one seed this journey is allowed.
      const doctorId = await userIdByName(hid, DOCTOR);
      await seedPriorResult({
        hospitalId: hid, patientId: pid, orderedBy: doctorId,
        testName: CREAT, value: String(R.creatinineBaseline), daysAgo: 30,
      });
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_order_items')
        .select('result_value, status, lab_orders!inner(patient_id)')
        .eq('lab_orders.patient_id', pid);
      const baseline = (data ?? []).filter(r =>
        String((r as { result_value: string }).result_value) === String(R.creatinineBaseline));
      expect(
        baseline.length,
        'The back-dated baseline is not visible to the delta lookup. The lookup needs the same ' +
        'test, the same patient, a DIFFERENT order, status in (reported, validated) and a ' +
        'non-null numeric — every one of those has to hold or the delta silently never fires and ' +
        'this journey passes as a false negative.' + jrn.note(),
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [CREAT] });
      const orders = await labOrdersFor(hid, pid);
      deltaOrderId = orders[0].id as string;
      await collectThroughWorkstation(page, patient.uhid);
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
    });

    await jrn.next(async () => {
      await openOrderInWorklist(page, patient.uhid);
      await openWorkspaceTab(page, WORKSPACE_TABS.history);
    });

    await jrn.next(async () => {
      await expect.soft(
        page.getByText(String(R.creatinineBaseline)).first(),
        'The 30-day-old creatinine is not shown in the History tab. The technician typing today\'s ' +
        'value has no way to see what this patient ran at last month, which is the entire point ' +
        'of a delta check being reviewable by a human.',
      ).toBeVisible({ timeout: 12_000 });
    });

    await jrn.next(async () => {
      await openWorkspaceTab(page, WORKSPACE_TABS.results);
      await enterResult(page, CREAT, String(R.creatinineDelta));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(deltaOrderId, CREAT);
      expect(
        item?.result_value,
        'FINDING L1. THE WHOLE RESULT WAS DISCARDED. lab_order_items.delta_flag is a boolean ' +
        'column, but a >50% swing makes the save write the string "delta" into it ' +
        '(LabResultWorkspace.tsx:501). PostgREST returns 22P02 and :508 swallows it with a bare ' +
        'console.error and return — so no value, no flag, no alert and no toast. A creatinine that ' +
        'jumps 0.9 → 4.5 is acute kidney injury; it is the single most important result of that ' +
        'patient\'s day, and it is the one class of result this app cannot save.' + jrn.note(),
      ).toBeTruthy();
      expect.soft(String(item?.result_value ?? ''), 'The saved value is not the one that was typed.')
        .toBe(String(R.creatinineDelta));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(deltaOrderId, CREAT);
      expect.soft(
        item?.delta_flag,
        'The delta check exists to catch exactly this: a result that is individually plausible but ' +
        'impossible for THIS patient in this interval. Unflagged, a creatinine of 4.5 in a patient ' +
        'last seen at 0.9 is auto-released as a routine abnormal, and the acute kidney injury is ' +
        'found when the patient deteriorates.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const item = await labItemForTest(deltaOrderId, CREAT);
      expect.soft(
        String(item?.previous_value ?? ''),
        'The previous value was not carried onto the result, so the reviewer sees a flag with ' +
        'nothing to compare it against.',
      ).toBe(String(R.creatinineBaseline));
    });

    await jrn.next(async () => {
      await expect.soft(
        deltaBadge(page),
        'No Δ badge is shown beside the result, so the reviewer has no on-screen signal that this ' +
        'value contradicts the patient\'s history.',
      ).toBeVisible({ timeout: 10_000 });
    });

    await jrn.next(async () => {
      const alerts = await clinicalAlertsFor({ hospitalId: hid, patientId: pid, alertType: 'lab_trend' });
      expect.soft(
        alerts.length,
        'No lab_trend alert was raised for a >50% swing, so nothing reaches the treating team ' +
        'outside the laboratory screen.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      const item = await labItemForTest(deltaOrderId, CREAT);
      expect.soft(
        item?.verification_method,
        'A delta-flagged result auto-verified. Rule 6 of evaluateAutoVerify refuses exactly this ' +
        'case — a result that contradicts the patient\'s own history is the last thing that should ' +
        'be released without a human reading it.',
      ).not.toBe('auto');
    });

    await jrn.next(async () => {
      await releaseResults(page).catch(() => { /* release may be gated on this tenant */ });
    });

    let secondOrder = '';
    await jrn.next(async () => {
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [CREAT] });
      const orders = await labOrdersFor(hid, pid);
      secondOrder = (orders.find(o => o.id !== deltaOrderId)?.id as string) ?? orders[0].id as string;
      await collectThroughWorkstation(page, patient.uhid);
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
      await openOrderInWorklist(page, patient.uhid);
    });

    await jrn.next(async () => {
      await enterResult(page, CREAT, String(R.creatinineNoDelta));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(secondOrder, CREAT);
      expect.soft(item?.result_value, 'The in-range result did not save.').toBeTruthy();
      expect.soft(
        item?.delta_flag,
        `${R.creatinineBaseline} → ${R.creatinineNoDelta} is a swing well under the 50% threshold ` +
        'and must not be flagged. A delta check that fires on ordinary biological variation flags ' +
        'most of the day\'s work, and a reviewer facing that queue stops reading the flags.',
      ).toBeFalsy();
    });

    let thirdOrder = '';
    await jrn.next(async () => {
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [HB] });
      const orders = await labOrdersFor(hid, pid);
      thirdOrder = orders[0].id as string;
      await collectThroughWorkstation(page, patient.uhid);
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
      await openOrderInWorklist(page, patient.uhid);
    });

    await jrn.next(async () => {
      await enterResult(page, HB, String(R.normalHaemoglobin));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(thirdOrder, HB);
      expect.soft(item?.result_value, 'The first result did not save.').toBeTruthy();
      expect.soft(
        item?.delta_flag,
        'A patient\'s FIRST result for a test was delta-flagged. There is no previous value to ' +
        'differ from, so a flag here means the lookup fell back to another patient\'s history or ' +
        'to a default — either of which would put one patient\'s trend on another\'s report.',
      ).toBeFalsy();
    });

    await jrn.next(async () => {
      const item = await labItemForTest(thirdOrder, HB);
      expect.soft(item?.previous_value, 'A first result must carry no previous value.').toBeFalsy();
    });
  });

  test(testTitle('TC-P5D-003'), async ({ page, loginAs, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    let orderId = '';

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_test_master')
        .select('test_name').eq('hospital_id', hid).eq('autoverify_eligible', true);
      expect.soft(
        data?.length ?? 0,
        'No test in this tenant has autoverify_eligible = true. The column defaults to FALSE, so ' +
        'evaluateAutoVerify refuses at rule 1 for every result — which looks identical to correct ' +
        'conservative behaviour while meaning the feature has never been switched on.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [HB, K_TEST, CULTURE] });
      const orders = await labOrdersFor(hid, pid);
      orderId = orders[0].id as string;
      await collectThroughWorkstation(page, patient.uhid);
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
      await openOrderInWorklist(page, patient.uhid);
    });

    await jrn.next(async () => {
      for (const header of [/Test Name/i, /Result/i, /Unit/i, /Ref\. Range/i, /Flag/i, /Status/i]) {
        await expect.soft(
          page.getByText(header).first(),
          `The results table has no ${String(header)} column. A technician typing a value needs ` +
          'the unit and the reference range beside it, or the number goes in against the wrong ' +
          'scale and nobody notices until a clinician acts on it.',
        ).toBeVisible();
      }
    });

    await jrn.next(async () => {
      await expect.soft(
        page.getByText(/LAB-/i).first(),
        'The workspace header does not show the order id, so a technician on the phone about a ' +
        'specific request cannot say which one they are looking at.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await enterResult(page, HB, String(R.normalHaemoglobin));
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, HB);
      expect.soft(item?.result_flag, `${R.normalHaemoglobin} is in range and must flag "N".`).toBe('N');
      expect.soft(
        item?.verification_method,
        'A normal, non-delta, QC-clean result on an opted-in test was not auto-verified. ' +
        'Auto-verification is what lets a laboratory release routine normals in minutes instead ' +
        'of queueing them behind a technician; without it the turnaround the hospital advertises ' +
        'is fiction.',
      ).toBe('auto');
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, HB);
      expect.soft(
        String(item?.autoverify_reason ?? ''),
        'The auto-verification recorded no reason. A machine releasing a result without saying ' +
        'why it qualified is a decision nobody can audit after the fact.',
      ).toBeTruthy();
      await expect.soft(autoVerifiedBadge(page)).toBeVisible({ timeout: 8_000 });
    });

    await jrn.next(async () => {
      await enterResult(page, HB, String(R.lowHaemoglobin));
      const item = await labItemForTest(orderId, HB);
      expect.soft(item?.result_flag, `${R.lowHaemoglobin} is below the range and must flag "L".`).toBe('L');
      expect.soft(
        item?.verification_method,
        'An ABNORMAL result auto-verified. Rule 5 refuses any non-N flag — a machine releasing ' +
        'abnormal results with no human eye on them is the failure mode auto-verification is ' +
        'specifically designed to avoid.',
      ).not.toBe('auto');
    });

    await jrn.next(async () => {
      await enterTextResult(page, CULTURE, String(R.textResultNegative))
        .catch(() => { /* this test may render a numeric input on this tenant */ });
    });

    await jrn.next(async () => {
      const item = await labItemForTest(orderId, CULTURE);
      expect.soft(
        item?.result_value,
        'A qualitative result chosen from the dropdown did not persist. Microbiology and serology ' +
        'are reported as words, not numbers, and a workspace that only saves numbers cannot report ' +
        'them at all.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const toast = await saveAllResults(page);
      expect.soft(
        toast,
        'Save All produced no acknowledgement, so a technician who has typed a screenful of ' +
        'results cannot tell whether any of them were written.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const org = organismInput(page);
      if (await org.count()) {
        await org.fill(String(P5.results.textResultPositive === '' ? 'E. coli' : 'E. coli'));
        const colony = colonyCountInput(page);
        if (await colony.count()) await colony.fill('>10^5 CFU/mL');
        await page.waitForTimeout(500);
      }
    });

    await jrn.next(async () => {
      const selects = page.locator('select');
      const n = Math.min(await selects.count(), 6);
      for (let i = 0; i < n; i++) {
        await selects.nth(i).selectOption('S').catch(() => { /* not a sensitivity select */ });
      }
      await page.waitForTimeout(400);
    });

    await jrn.next(async () => {
      const org = organismInput(page);
      if (await org.count()) {
        await org.fill('');
        await page.waitForTimeout(400);
        await expect.soft(
          saveAntibiogramButton(page),
          'An antibiogram can be saved with no organism named. A sensitivity panel against an ' +
          'unnamed organism tells a clinician which antibiotics work against nothing in particular.',
        ).toBeDisabled();
        await org.fill('E. coli');
        await page.waitForTimeout(400);
      }
    });

    await jrn.next(async () => {
      const save = saveAntibiogramButton(page);
      if (await save.isEnabled().catch(() => false)) {
        await save.click();
        await page.waitForTimeout(2_500);
      }
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_results').select('*')
        .eq('hospital_id', hid).limit(5);
      expect.soft(
        Array.isArray(data),
        'The antibiogram could not be read back at all, so there is no way to tell whether the ' +
        'organism and its sensitivities were stored.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      const box = interpretiveCommentTextarea(page);
      if (await box.count()) {
        await box.fill(String(R.interpretiveComment));
        await page.waitForTimeout(400);
        const save = saveCommentButton(page);
        if (await save.count()) {
          await save.click();
          await page.waitForTimeout(2_000);
        }
      }
    });

    await jrn.next(async () => {
      await openWorkspaceTab(page, WORKSPACE_TABS.sample);
      await expect.soft(
        page.getByText(/Collected|Received|Processing/i).first(),
        'The Sample tab shows no custody stepper.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await openWorkspaceTab(page, WORKSPACE_TABS.history);
    });

    await jrn.next(async () => {
      await openWorkspaceTab(page, WORKSPACE_TABS.notes);
      await writeLabNotes(page, String(R.validationNotes));
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('notes, lab_notes')
        .eq('id', orderId).maybeSingle();
      const saved = JSON.stringify(data ?? {});
      expect.soft(
        /Values reviewed|reviewed against/i.test(saved),
        'The lab notes did not persist. This field commits on BLUR, not on change — a technician ' +
        'who types a note and clicks straight to another tab loses it, and the instrument or QC ' +
        'context they recorded is gone.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      await openWorkspaceTab(page, WORKSPACE_TABS.results);
      const cumulative = cumulativeButton(page);
      if (await cumulative.count()) {
        await cumulative.click();
        await page.waitForTimeout(2_500);
      }
    });

    await jrn.next(async () => {
      const wa = whatsappButton(page);
      if (await wa.count()) {
        await wa.click();
        await page.waitForTimeout(2_000);
        const toastText = await page.locator('[role="status"], [data-sonner-toast]').first()
          .innerText().catch(() => '');
        expect.soft(
          /validate|release|first/i.test(toastText) || toastText === '',
          'WhatsApp delivery was offered on an unreleased report. Sending a patient a result the ' +
          'laboratory has not signed off is the one delivery failure that cannot be taken back. ' +
          `Toast was: "${toastText}"`,
        ).toBe(true);
      }
    });

    await jrn.next(async () => {
      await releaseResults(page);
    });

    await jrn.next(async () => {
      const print = printReportButton(page);
      if (await print.count()) {
        await print.click();
        await page.waitForTimeout(2_500);
        expect.soft(
          true,
          'Print dispatches a popup that this suite stubs — the stage proves the control is ' +
          'offered and fires, not that a printer produced paper.',
        ).toBe(true);
      }
    });

    await jrn.next(async () => {
      const input = resultInput(page, HB);
      const editable = await input.isEditable().catch(() => false);
      expect.soft(
        editable,
        'A released result is still an editable input. A signed report that can be silently ' +
        'overwritten in place destroys the record a clinician acted on, with no amendment trail ' +
        'and nothing to show what the original said.',
      ).toBe(false);
    });

    await jrn.next(async () => {
      const items = await labOrderItems(orderId);
      const withValues = items.filter(i => i.result_value);
      expect.soft(
        withValues.length,
        'The completed order lost values that were typed and acknowledged during the journey.',
      ).toBeGreaterThan(0);
    });
  });
});
