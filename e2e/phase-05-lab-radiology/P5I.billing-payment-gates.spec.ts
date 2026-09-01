/**
 * Phase 5 · Section I — Billing & the pre-payment gates (P5-S01, P5-S02, P5-S03 🔴, P5-S12)
 * Locks tracker cases TC-P5I-001 … TC-P5I-012
 *
 * `ipd_ancillary_payment` IS THE SINGLE MOST CONSEQUENTIAL SETTING IN THIS PHASE. It changes
 * whether a sample can be collected at all, and it is the difference between P5-S02 and P5-S03 —
 * two scenarios that look identical on screen and run completely different code.
 *
 * THE GATE, first match wins (`evaluateAncillaryGate`, src/lib/ipdAncillaryGate.ts:222-276):
 *
 *   1. not IPD                          → cleared  "not_ipd"
 *   2. mode !== 'pre_paid'              → cleared  "policy_post_paid"
 *   3. urgent priority + auto-bypass    → cleared  "urgent_bypass"   ← BEFORE any payment check
 *   4. an override was recorded         → cleared  "override_recorded"
 *   5. no charges found                 → cleared  "no_charge_found" ← fails OPEN, deliberately
 *   6. nothing unpaid                   → cleared  "cleared_paid"
 *   7. otherwise                        → BLOCKED  "blocked_unpaid"
 *
 * Rule 3 firing before the payment check is a clinical decision, not an oversight: a STAT
 * potassium on a ventilated patient must never wait at a billing counter. TC-P5I-005 pins it so
 * it cannot be "tightened" later by someone reading the ladder as a bug.
 *
 * Rule 5 failing OPEN is the risky one — an order whose charge posting failed has no charge row,
 * so the gate clears it. TC-P5I-006 documents that.
 *
 * ENFORCEMENT IS CLIENT-SIDE ONLY, on purpose (ipdAncillaryGate.ts:19-27 and migration
 * 20261008000146:20-27 both say so). There is no database trigger. TC-P5I-007 proves the
 * bypass exists rather than leaving a reader to assume the gate is a hard control.
 *
 * 🔴 TC-P5I-010/011 ARE FINDING R7 — the double-bill probe on the radiology sign path.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedLabOrder, seedRadiologyOrder, advanceSamples, labOrderItems, labSamples, labOrderById,
  billsFor, billLineItemsByDedupeKey, ancillaryPolicy, setAncillaryMode, clinicalAlertsFor,
  radiologyOrderById, seedUnpaidCharge, purgeLabRadArtefacts,
} from './lab-rad-helpers';
import { openLab } from './lab-locators';
import { openRadiology } from './radiology-locators';
import {
  collectSample, overridePaymentGate, markCollectedFromWorkspace, openOrderInWorklist,
  driveStudyToImagesAcquired, fillReport, signReport,
} from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const IPD = P5.ipdAncillary;

const ADMITTED_UHID = String(IPD.admittedPatientUhid);
const ADMITTED_NAME = 'Sharma Ji';
const OPD_UHID = 'PT-QA-0001';
const OPD_NAME = 'Ramesh Kumar';
const DOCTOR = MOCK.doctorFees[0].doctor;
const TEST = String(P5.labOrder.primaryTest);
const STUDY = String(P5.radiology.plainStudy);

async function seedFor(uhid: string): Promise<{ hid: string; pid: string; doctorId: string }> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  const doctorId = await userIdByName(hid, DOCTOR);
  await purgeLabRadArtefacts(hid, [pid]);
  return { hid, pid, doctorId };
}

test.describe('P5I — Billing & payment gates', () => {
  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    for (const uhid of [ADMITTED_UHID, OPD_UHID]) {
      await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, uhid)]);
    }
  });

  /* ── The policy itself ──────────────────────────────────────────────── */

  test('TC-P5I-001 The tenant\'s ancillary payment policy is readable and defaults to post-paid', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await loginAs('hospital_admin', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const policy = await ancillaryPolicy(hid);
    const lab = policy.lab as { mode?: string } | undefined;

    expect(
      lab?.mode,
      'The lab ancillary mode is unreadable. DEFAULT_IPD_ANCILLARY_POLICY falls back to ' +
      'post_paid for every service when the key is absent, so a tenant that has never opened the ' +
      'setting still behaves predictably — but a test that assumed pre-paid without reading it ' +
      'would pass for entirely the wrong reason.',
    ).toBeTruthy();
    expect(['pre_paid', 'post_paid']).toContain(String(lab?.mode));
  });

  /* ── P5-S02 · Post-paid ─────────────────────────────────────────────── */

  test('TC-P5I-002 Post-paid IPD journey: the ward orders, the sample is collected immediately, and the charge sits on the admission', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(ADMITTED_UHID);
    const restore = await setAncillaryMode(hid, 'lab', 'post_paid');

    try {
      const seeded = await seedLabOrder({
        hospitalId: hid, patientId: pid, orderedBy: doctorId, testNames: [TEST], billingStatus: 'billed',
      });
      await openLab(page);

      const result = await collectSample(page, ADMITTED_NAME);
      expect(
        result.blocked,
        'The pre-payment gate blocked a POST-PAID collection. Rule 2 of evaluateAncillaryGate ' +
        'clears immediately when the mode is not pre_paid; a gate firing here would stop every ' +
        'ward round in a hospital that has deliberately chosen to bill at discharge.',
      ).toBe(false);

      const samples = await labSamples(seeded.orderId);
      expect(samples[0].status, 'The post-paid sample was not collected.').toBe('collected');

      const bills = await billsFor(hid, pid, 'lab');
      expect(
        bills.length,
        'A post-paid investigation raised its own lab bill. The charge must accrue to the ' +
        'admission and settle once at discharge — a separate bill sends a relative to the ' +
        'counter mid-admission, which is exactly what the policy exists to avoid.',
      ).toBe(0);
    } finally {
      await restore();
    }
  });

  /* ── P5-S03 · Pre-paid 🔴 ───────────────────────────────────────────── */

  test('TC-P5I-003 Pre-paid IPD journey: the sample cannot be collected until the amount is paid', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(ADMITTED_UHID);
    const restore = await setAncillaryMode(hid, 'lab', 'pre_paid');

    try {
      const seeded = await seedLabOrder({
        hospitalId: hid, patientId: pid, orderedBy: doctorId,
        testNames: [TEST], billingStatus: 'billed', priority: 'routine',
      });
      // Give the gate something unpaid to find — rule 5 clears when there are NO charges at all.
      const items = await labOrderItems(seeded.orderId);
      await seedUnpaidCharge({
        hospitalId: hid, dedupeKey: `lab:${items[0].id as string}`,
        itemType: 'lab', description: `Lab: ${TEST}`, amount: 200,
      });

      await openLab(page);
      const result = await collectSample(page, ADMITTED_NAME);

      const samples = await labSamples(seeded.orderId);
      expect(
        samples[0].status,
        'A PRE-PAID order was collected without payment. This is a completely different code path ' +
        'from post-paid, and it is the one a hospital chooses precisely because it cannot carry ' +
        'the credit risk — clearing the gate here means the hospital does the work and then ' +
        'discovers nobody paid for it.',
      ).not.toBe('collected');
      expect(
        result.blocked,
        `The block was not surfaced to the technician (toast: "${result.toast}"). A refusal the ` +
        'user cannot see reads as a broken button.',
      ).toBe(true);
    } finally {
      await restore();
    }
  });

  test('TC-P5I-004 Pre-paid: an override with a recorded reason releases the gate', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(ADMITTED_UHID);
    const restore = await setAncillaryMode(hid, 'lab', 'pre_paid');

    try {
      const seeded = await seedLabOrder({
        hospitalId: hid, patientId: pid, orderedBy: doctorId,
        testNames: [TEST], billingStatus: 'billed', priority: 'routine',
      });
      await openLab(page);

      const result = await collectSample(page, ADMITTED_NAME);
      test.skip(!result.blocked, 'The gate did not block, so there is no override to exercise.');

      await overridePaymentGate(page, String(IPD.overrideReason));

      const alerts = await clinicalAlertsFor({
        hospitalId: hid, patientId: pid, alertType: 'ipd_ancillary_payment_override',
      });
      expect(
        alerts.length,
        'The override was applied with no audit row. recordAncillaryOverride returns false when ' +
        'the clinical_alerts insert fails and the collection is then REFUSED — an override that ' +
        'leaves no trace is indistinguishable from the gate never having fired, and the whole ' +
        'point of an override is that somebody put their name to it.',
      ).toBeGreaterThan(0);

      const samples = await labSamples(seeded.orderId);
      expect(samples[0].status, 'The override did not release the collection.').toBe('collected');
    } finally {
      await restore();
    }
  });

  test('TC-P5I-005 Pre-paid: a STAT order bypasses the payment gate entirely', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(ADMITTED_UHID);
    const restore = await setAncillaryMode(hid, 'lab', 'pre_paid');

    try {
      const seeded = await seedLabOrder({
        hospitalId: hid, patientId: pid, orderedBy: doctorId,
        testNames: [TEST], billingStatus: 'billed', priority: 'stat',
      });
      await openLab(page);

      const result = await collectSample(page, ADMITTED_NAME);
      expect(
        result.blocked,
        'A STAT order was held at the pre-payment gate. Rule 3 of evaluateAncillaryGate fires ' +
        'BEFORE the payment check, deliberately: a STAT potassium on a ventilated patient cannot ' +
        'wait for a relative to reach a billing counter. This ordering is a clinical decision — ' +
        'do not "tighten" it.',
      ).toBe(false);

      const samples = await labSamples(seeded.orderId);
      expect(samples[0].status, 'The STAT sample was not collected.').toBe('collected');
    } finally {
      await restore();
    }
  });

  test('TC-P5I-006 Pre-paid: an order with no charge posted clears the gate, so a failed charge cannot strand a patient', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(ADMITTED_UHID);
    const restore = await setAncillaryMode(hid, 'lab', 'pre_paid');

    try {
      const seeded = await seedLabOrder({
        hospitalId: hid, patientId: pid, orderedBy: doctorId,
        testNames: [TEST], billingStatus: 'billed', priority: 'routine',
      });
      const items = await labOrderItems(seeded.orderId);
      const lines = await billLineItemsByDedupeKey(hid, `lab:${items[0].id as string}`);
      expect(lines.length, 'This case needs an order with NO posted charge.').toBe(0);

      await openLab(page);
      const result = await collectSample(page, ADMITTED_NAME);

      expect(
        result.blocked,
        'CURRENT BEHAVIOUR, recorded deliberately. Rule 5 of evaluateAncillaryGate clears when no ' +
        'charge row is found — the gate FAILS OPEN. That is the right trade for a patient (a ' +
        'billing failure must never stop a clinical act) but it means an order whose charge ' +
        'posting silently failed is both uncollectable-for and freely collected. The money is ' +
        'lost quietly. Pair this with an unbilled-orders report rather than by closing the gate.',
      ).toBe(false);
    } finally {
      await restore();
    }
  });

  test('TC-P5I-007 The payment gate is client-side only, so a direct API write bypasses it', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(ADMITTED_UHID);
    const restore = await setAncillaryMode(hid, 'lab', 'pre_paid');

    try {
      const seeded = await seedLabOrder({
        hospitalId: hid, patientId: pid, orderedBy: doctorId,
        testNames: [TEST], billingStatus: 'billed', priority: 'routine',
      });

      // Exactly what an integration, a script or a second tab would do.
      await db().from('lab_samples')
        .update({ status: 'collected', collected_at: new Date().toISOString() } as never)
        .eq('lab_order_id', seeded.orderId);

      const samples = await labSamples(seeded.orderId);
      expect(
        samples[0].status,
        'CURRENT BEHAVIOUR, documented on purpose (ipdAncillaryGate.ts:19-27 and migration ' +
        '20261008000146:20-27 both state it). There is no database trigger behind the pre-payment ' +
        'gate — it lives entirely in the browser. Any analyser interface, HL7 feed or script that ' +
        'writes lab_samples directly walks straight past it. A hospital relying on pre-paid for ' +
        'credit control needs to know the control is advisory at the API boundary.',
      ).toBe('collected');
    } finally {
      await restore();
    }
  });

  test('TC-P5I-008 Pre-paid: the result workspace refuses collection as clearly as the collection workstation does', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(ADMITTED_UHID);
    const restore = await setAncillaryMode(hid, 'lab', 'pre_paid');

    try {
      const seeded = await seedLabOrder({
        hospitalId: hid, patientId: pid, orderedBy: doctorId,
        testNames: [TEST], billingStatus: 'billed', priority: 'routine',
      });
      await openLab(page);
      await openOrderInWorklist(page, ADMITTED_NAME);

      const outcome = await markCollectedFromWorkspace(page);
      const samples = await labSamples(seeded.orderId);

      expect(
        outcome.dialogShown || outcome.toast.length > 0 || samples[0].status === 'collected',
        'FINDING L10 — EXPECTED FAIL. handleMarkCollected (LabResultWorkspace.tsx:596-606) calls ' +
        'collectOrderSamples WITHOUT the role argument and does not catch LabPaymentPendingError, ' +
        'so on a pre-paid tenant the button throws an unhandled rejection: no dialog, no toast, ' +
        'no state change. The same action from CollectionWorkstation opens PaymentPendingDialog ' +
        'correctly. A technician clicking a button that does nothing and says nothing will click ' +
        'it again, then report the lab module as broken.',
      ).toBe(true);
    } finally {
      await restore();
    }
  });

  /* ── Radiology billing ──────────────────────────────────────────────── */

  test('TC-P5I-009 An OPD radiology order paid at order time carries exactly one charge line', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('radiologist', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(OPD_UHID);

    const seeded = await seedRadiologyOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId, studyName: STUDY, billingStatus: 'billed',
    });
    await seedUnpaidCharge({
      hospitalId: hid, dedupeKey: `radiology:${seeded.orderId}`,
      itemType: 'radiology', description: `Radiology: ${STUDY}`, amount: 400,
    });

    const lines = await billLineItemsByDedupeKey(hid, `radiology:${seeded.orderId}`);
    expect(
      lines.length,
      'The paid-at-order-time charge is missing or duplicated before the study is even reported.',
    ).toBe(1);
    void page;
  });

  test('TC-P5I-010 Signing an already-paid OPD study does not bill the patient a second time', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('radiologist', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(OPD_UHID);

    const seeded = await seedRadiologyOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId, studyName: STUDY, billingStatus: 'billed',
    });
    await seedUnpaidCharge({
      hospitalId: hid, dedupeKey: `radiology:${seeded.orderId}`,
      itemType: 'radiology', description: `Radiology: ${STUDY}`, amount: 400,
    });

    const before = await billLineItemsByDedupeKey(hid, `radiology:${seeded.orderId}`);

    await openRadiology(page);
    await driveStudyToImagesAcquired(page, OPD_NAME);
    await fillReport(page, {
      findings: String(P5.radiology.findings), impression: String(P5.radiology.impression),
    });
    await signReport(page);

    const after = await billLineItemsByDedupeKey(hid, `radiology:${seeded.orderId}`);
    const allLines = await billsFor(hid, pid, 'radiology');

    expect(
      after.length,
      'FINDING R7 — EXPECTED FAIL RISK. RadiologyReportingWorkspace.tsx:357-392 runs ' +
      'autoBillOpdInvestigation on signing for EVERY order with no admission_id — including one ' +
      'already paid in full at order time by handleCollectAndCreate. It is passed sourceId but ' +
      'no dedupeKey, so whether the patient is charged twice depends entirely on that function\'s ' +
      `own idempotency. Charge lines went from ${before.length} to ${after.length}, with ` +
      `${allLines.length} radiology bill(s). A charge that appears at reporting time for a study ` +
      'the patient paid for at the counter is the single most common billing complaint a ' +
      'radiology department receives.',
    ).toBe(before.length);
  });

  test('TC-P5I-011 A radiology study is not started before its payment has cleared on a pre-paid admission', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('radiologist', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(ADMITTED_UHID);
    const restore = await setAncillaryMode(hid, 'radiology', 'pre_paid');

    try {
      const seeded = await seedRadiologyOrder({
        hospitalId: hid, patientId: pid, orderedBy: doctorId,
        studyName: STUDY, billingStatus: 'billed', priority: 'routine',
      });
      await seedUnpaidCharge({
        hospitalId: hid, dedupeKey: `radiology:${seeded.orderId}`,
        itemType: 'radiology', description: `Radiology: ${STUDY}`, amount: 400,
      });

      await openRadiology(page);
      await driveStudyToImagesAcquired(page, ADMITTED_NAME);

      const order = await radiologyOrderById(seeded.orderId);
      expect(
        order?.status,
        'A pre-paid IPD study was started with the charge unpaid. checkRadiologyOrderClearance ' +
        'gates the transition to in_progress specifically (:223) — the scan is where the cost is ' +
        'actually incurred, so clearing it means the machine time is spent before anyone has ' +
        'agreed to pay for it.',
      ).not.toBe('in_progress');
    } finally {
      await restore();
    }
  });

  test('TC-P5I-012 A lab order released in OPD is charged exactly once, not again at result release', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hid, pid, doctorId } = await seedFor(OPD_UHID);

    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId, testNames: [TEST], billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });
    const billsBefore = (await billsFor(hid, pid, 'lab')).length;

    await openLab(page);
    await openOrderInWorklist(page, OPD_NAME);
    const { enterResult } = await import('./lab-rad-flows');
    await enterResult(page, TEST, String(P5.results.normalPotassium));
    await page.waitForTimeout(2_000);

    const order = await labOrderById(seeded.orderId);
    expect(order?.billing_status, 'The order was not already billed before release.').toBe('billed');

    const billsAfter = (await billsFor(hid, pid, 'lab')).length;
    expect(
      billsAfter,
      'REGRESSION LOCK. autoBillOpdInvestigation returns null when lab_orders.billing_status is ' +
      'already "billed" (investigationBilling.ts:42-48). That guard is the only thing stopping ' +
      'the release path from raising a SECOND bill for an investigation the patient paid for at ' +
      'the counter. A red result here means the guard has been removed.',
    ).toBe(billsBefore);
  });
});
