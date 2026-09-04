/**
 * Phase 5 · Section B — Inpatient lab and the ancillary money (TC-P5B-001, 002)
 *
 * These two journeys are the same ward round under opposite hospital policies, and they are the
 * only cases in the phase that deliberately reuse a patient: `PT-QA-0018` is admitted, and the
 * ancillary charge has to accrue against a LIVE admission. Creating a fresh patient would remove
 * the very thing the gate engages on, and the journey would prove something else while looking
 * identical.
 *
 * TENANT-WIDE STATE, AND WHY BOTH CASES END IN A `finally`.
 * `hospital_settings.ipd_ancillary_payment` applies to the whole hospital, not to this patient. If
 * a journey flips it to pre_paid and dies before putting it back, every later case in the run
 * executes under a policy nobody chose, and their failures look like product defects. The restore
 * goes through the service role rather than the browser precisely because a `finally` that needs
 * the UI to still be working is not a `finally`.
 */
import { test, expect } from './p5-journey.fixture';
import { MOCK } from '../fixtures/auth.fixture';
import { db, anonDb } from '../utils/db-verify';
import { userIdByName } from '../phase-04-opd-journey/opd-helpers';
import { testTitle } from './p5-manifest';
import {
  labOrdersFor, labOrderItems, labSamples, billsFor, billLineItemsByDedupeKey,
  clinicalAlertsFor, ancillaryPolicy,
} from './lab-rad-helpers';
import { readAncillaryPolicy, restoreAncillaryPolicy, ensureActiveAdmission } from './p5-seed-of-last-resort';
import {
  orderLabThroughModal, openNewLabOrder, selectPatientInModal, addTestInModal,
  collectThroughWorkstation, receiveSample, processSample, openOrderInWorklist,
  enterResult, releaseResults, overridePaymentGate, setAncillaryModeThroughSettings,
} from './p5-stages';
import {
  openLab, openLabTab, LAB_TABS, collectionTab, COLLECTION_TABS, collectButton,
  paymentPendingDialog, overrideConfirmButton, createOrdersIpdButton, markCollectedButton,
} from './lab-locators';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const IPD = P5.ipdAncillary;

const DOCTOR = MOCK.doctorFees[0].doctor;
const TEST = String(P5.labOrder.primaryTest);
const SECOND_TEST = String(P5.labOrder.normalTest);
const THIRD_TEST = String(P5.labOrder.secondaryTest);

test.describe('P5B — Inpatient lab & the ancillary money', () => {
  test(testTitle('TC-P5B-001'), async ({ page, loginAs, logout, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    const original = await readAncillaryPolicy(hid);

    try {
      await jrn.next(async () => {
        expect(
          patient.uhid,
          'This journey reuses the admitted patient rather than creating one — the charge must ' +
          'accrue against a live admission, and a fresh patient has none.',
        ).toBe(String(IPD.admittedPatientUhid));

        // The seeder creates the PATIENT but no admission — this tenant had zero `admissions` rows
        // — so without this the AdmissionLinker renders nothing and the charge has nothing to
        // accrue to. Phase 7 owns admitting a patient; here it is a prerequisite, provisioned
        // rather than reported as a defect.
        const admittingDoctorId = await userIdByName(hid, DOCTOR);
        const admissionId = await ensureActiveAdmission({
          hospitalId: hid, patientId: pid, admittingDoctorId,
        });
        expect(admissionId, 'The ancillary-journey patient could not be admitted.').toBeTruthy();
      });

      await jrn.next(async () => {
        await loginAs('hospital_admin', { hospital: 'A' });
        const before = await ancillaryPolicy(hid);
        expect.soft(
          before,
          'The ancillary policy is unreadable. DEFAULT_IPD_ANCILLARY_POLICY falls back to ' +
          'post_paid for every service when the key is absent, so a tenant that has never opened ' +
          'the setting still behaves predictably — but a journey that assumed a mode without ' +
          'reading it would pass for entirely the wrong reason.',
        ).toBeTruthy();
      });

      await jrn.next(async () => {
        const ok = await setAncillaryModeThroughSettings(page, 'lab', 'post_paid');
        if (!ok) {
          // The screen may not expose the control; fall back so the rest of the journey still runs,
          // and say so rather than silently testing the wrong policy.
          await restoreAncillaryPolicy(hid, {
            ...original,
            lab: { mode: 'post_paid', receipt: 'consolidated' },
          });
        }
      });

      await jrn.next(async () => {
        const policy = await ancillaryPolicy(hid);
        const lab = policy.lab as { mode?: string } | undefined;
        expect(
          lab?.mode,
          'The tenant is not in post-paid mode, so the rest of this journey would be testing the ' +
          'pre-paid gate instead.' + jrn.note(),
        ).toBe('post_paid');
      });

      await jrn.next(async () => {
        await logout();
        await loginAs('lab_technician', { hospital: 'A' });
        await openLab(page);
      });

      await jrn.next(async () => {
        await openNewLabOrder(page);
        await selectPatientInModal(page, patient.uhid);
      });

      await jrn.next(async () => {
        await expect.soft(
          page.getByText(/admission|ward|IPD|bed/i).first(),
          'The order modal does not show that this patient is admitted. Without the admission ' +
          'linked the charge has nothing to accrue to and falls back to a cash bill at a counter ' +
          'the patient cannot walk to.',
        ).toBeVisible({ timeout: 10_000 });
      });

      await jrn.next(async () => {
        const added = await addTestInModal(page, TEST);
        expect(added, `"${TEST}" could not be added to the ward order.` + jrn.note()).toBe(true);
      });

      await jrn.next(async () => {
        await expect.soft(
          createOrdersIpdButton(page),
          'Under post-paid the primary button must offer to charge the admission, not to collect ' +
          'cash. Offering a payment step on a ward round sends a relative to a counter for a test ' +
          'the hospital has already decided to bill at discharge.',
        ).toBeVisible({ timeout: 10_000 });
      });

      await jrn.next(async () => {
        const ipd = createOrdersIpdButton(page);
        if (await ipd.isVisible().catch(() => false)) {
          await ipd.click();
        } else {
          await orderLabThroughModal(page, { uhid: patient.uhid, tests: [TEST], expectChargeToAdvance: true });
        }
        await page.waitForTimeout(4_500);
      });

      let orderId = '';
      await jrn.next(async () => {
        const orders = await labOrdersFor(hid, pid);
        expect(orders.length, 'The ward order created no lab_orders row.' + jrn.note()).toBeGreaterThan(0);
        orderId = orders[0].id as string;
        expect.soft(
          orders[0].admission_id,
          'The order is not linked to the admission, so the charge cannot reach the running IPD ' +
          'bill and the investigation is performed for free.',
        ).toBeTruthy();
        expect.soft(
          orders[0].billing_status,
          'The order was left unbilled, which makes it invisible in the lab worklist.',
        ).not.toBe('unbilled');
      });

      await jrn.next(async () => {
        const bills = await billsFor(hid, pid, 'lab');
        expect.soft(
          bills.length,
          'A post-paid ward investigation raised its own separate lab bill. The charge must accrue ' +
          'to the admission and settle once at discharge — a second bill sends a family to pay ' +
          'twice for one stay.',
        ).toBe(0);
      });

      await jrn.next(async () => {
        const items = await labOrderItems(orderId);
        const lines = await billLineItemsByDedupeKey(hid, `lab:${items[0].id as string}`);
        expect.soft(
          lines.length,
          'No charge accrued under the lab dedupe key. The discharge sweep reads that key to know ' +
          'the investigation is already on the bill; with nothing there the test is either never ' +
          'charged or charged twice.',
        ).toBeGreaterThan(0);
      });

      await jrn.next(async () => {
        await openLabTab(page, LAB_TABS.collection);
        await collectionTab(page, COLLECTION_TABS.toCollect).click();
        await page.waitForTimeout(1_500);
        await expect(
          page.locator('tr').filter({ hasText: patient.uhid }).first(),
          'The ward order did not reach the phlebotomy list.' + jrn.note(),
        ).toBeVisible({ timeout: 20_000 });
      });

      await jrn.next(async () => {
        await collectButton(page, patient.uhid).click();
        await page.waitForTimeout(1_500);
        const blocked = await paymentPendingDialog(page).isVisible().catch(() => false);
        expect.soft(
          blocked,
          'The pre-payment gate fired on a POST-PAID tenant. Rule 2 of evaluateAncillaryGate ' +
          'clears immediately when the mode is not pre_paid; a gate firing here stops every ward ' +
          'round in a hospital that deliberately chose to bill at discharge.',
        ).toBe(false);
      });

      await jrn.next(async () => {
        const { identityVerifiedCheckbox, confirmAndCollectButton } = await import('./lab-locators');
        await identityVerifiedCheckbox(page).check().catch(() => { /* already ticked */ });
        await page.waitForTimeout(300);
        await confirmAndCollectButton(page).click().catch(() => { /* auto-confirmed */ });
        await page.waitForTimeout(2_500);
      });

      await jrn.next(async () => {
        const samples = await labSamples(orderId);
        expect(
          samples[0].status,
          'The ward sample was not collected, so a post-paid hospital cannot draw blood on a ' +
          'round.' + jrn.note(),
        ).toBe('collected');
      });

      await jrn.next(async () => {
        await receiveSample(page, patient.uhid);
        await processSample(page, patient.uhid);
      });

      await jrn.next(async () => {
        await openOrderInWorklist(page, patient.uhid);
        await enterResult(page, TEST, String(P5.results.normalPotassium));
        await releaseResults(page);
      });

      await jrn.next(async () => {
        const bills = await billsFor(hid, pid, 'lab');
        expect.soft(
          bills.length,
          'Releasing the result raised a separate lab bill on an admitted patient. The whole ' +
          'point of post-paid is that the admission carries the charge to discharge.',
        ).toBe(0);
      });

      await jrn.next(async () => {
        const items = await labOrderItems(orderId);
        const lines = await billLineItemsByDedupeKey(hid, `lab:${items[0].id as string}`);
        expect.soft(
          lines.length,
          'Releasing the result added a SECOND charge line for an investigation already accrued ' +
          'to the admission. At discharge the family pays for one test twice.',
        ).toBeLessThanOrEqual(1);
      });

      await jrn.next(async () => {
        await restoreAncillaryPolicy(hid, original);
        const policy = await ancillaryPolicy(hid);
        expect.soft(policy, 'The ancillary policy was not restored for the rest of the run.').toBeTruthy();
      });
    } finally {
      // Tenant-wide state. If this journey died halfway, every later case would run under a policy
      // nobody chose and its failures would read as product defects.
      await restoreAncillaryPolicy(hid, original).catch(() => { /* nothing to restore */ });
    }
  });

  test(testTitle('TC-P5B-002'), async ({ page, loginAs, logout, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    const original = await readAncillaryPolicy(hid);

    try {
      await jrn.next(async () => {
        expect(patient.uhid, 'This journey needs the admitted patient.').toBe(String(IPD.admittedPatientUhid));

        const admittingDoctorId = await userIdByName(hid, DOCTOR);
        const admissionId = await ensureActiveAdmission({
          hospitalId: hid, patientId: pid, admittingDoctorId,
        });
        expect(admissionId, 'The ancillary-journey patient could not be admitted.').toBeTruthy();
      });

      await jrn.next(async () => {
        await loginAs('hospital_admin', { hospital: 'A' });
        const ok = await setAncillaryModeThroughSettings(page, 'lab', 'pre_paid');
        if (!ok) {
          await restoreAncillaryPolicy(hid, {
            ...original,
            lab: { mode: 'pre_paid', receipt: 'consolidated' },
          });
        }
      });

      await jrn.next(async () => {
        const policy = await ancillaryPolicy(hid);
        const lab = policy.lab as { mode?: string } | undefined;
        expect(
          lab?.mode,
          'The tenant is not in pre-paid mode, so the gate under test would never engage and ' +
          'every negative below would pass vacuously.' + jrn.note(),
        ).toBe('pre_paid');
      });

      await jrn.next(async () => {
        await logout();
        await loginAs('lab_technician', { hospital: 'A' });
        await orderLabThroughModal(page, {
          uhid: patient.uhid, tests: [TEST], priority: 'Routine', expectChargeToAdvance: true,
        });
      });

      let blockedOrderId = '';
      await jrn.next(async () => {
        const orders = await labOrdersFor(hid, pid);
        expect(orders.length, 'The pre-paid ward order was not created.' + jrn.note()).toBeGreaterThan(0);
        blockedOrderId = orders[0].id as string;
        await openLabTab(page, LAB_TABS.collection);
        await collectionTab(page, COLLECTION_TABS.toCollect).click();
        await page.waitForTimeout(1_500);
        await collectButton(page, patient.uhid).click();
        await page.waitForTimeout(1_800);
      });

      await jrn.next(async () => {
        await expect.soft(
          paymentPendingDialog(page),
          'A pre-paid tenant let the sample be drawn before the amount was paid. The hospital ' +
          'chose pay-before-service for its cash flow; a gate that does not fire means every ' +
          'ward investigation is performed on credit the hospital never agreed to extend.',
        ).toBeVisible({ timeout: 10_000 });
      });

      await jrn.next(async () => {
        await expect.soft(
          page.getByText(/amount due/i).first(),
          'The block does not tell the technician what is owed, so nobody can tell the family ' +
          'what to pay or where.',
        ).toBeVisible();
      });

      await jrn.next(async () => {
        const samples = await labSamples(blockedOrderId);
        expect.soft(
          samples[0]?.status,
          'The gate showed a dialog but the sample was collected anyway — the block is cosmetic.',
        ).toBe('pending');
      });

      await jrn.next(async () => {
        await expect.soft(
          overrideConfirmButton(page),
          'The override confirms with no reason typed. An override with no recorded reason is an ' +
          'audit trail that says somebody bypassed the gate and nothing about why.',
        ).toBeDisabled();
      });

      await jrn.next(async () => {
        await overridePaymentGate(page, String(IPD.overrideReason));
      });

      await jrn.next(async () => {
        const samples = await labSamples(blockedOrderId);
        expect.soft(
          samples[0]?.status,
          'The override did not release the draw, so a clinically urgent sample stays blocked ' +
          'behind a billing counter.',
        ).toBe('collected');
      });

      await jrn.next(async () => {
        const alerts = await clinicalAlertsFor({
          hospitalId: hid, patientId: pid, alertType: 'ipd_ancillary_payment_override',
        });
        expect.soft(
          alerts.length,
          'The override was not recorded. Releasing a service before payment is a decision ' +
          'somebody has to own — an unrecorded override is indistinguishable from the gate ' +
          'simply not working.',
        ).toBeGreaterThan(0);
      });

      await jrn.next(async () => {
        await orderLabThroughModal(page, {
          uhid: patient.uhid, tests: [SECOND_TEST], priority: 'STAT', expectChargeToAdvance: true,
        });
      });

      await jrn.next(async () => {
        await openLabTab(page, LAB_TABS.collection);
        await collectionTab(page, COLLECTION_TABS.toCollect).click();
        await page.waitForTimeout(1_500);
        await collectButton(page, patient.uhid).click();
        await page.waitForTimeout(1_800);
        const blocked = await paymentPendingDialog(page).isVisible().catch(() => false);
        expect.soft(
          blocked,
          'A STAT order was held at the payment gate. Rule 3 clears STAT before the payment check ' +
          'is ever reached — a critical potassium on a ventilated patient must never wait for a ' +
          'relative to find a billing counter.',
        ).toBe(false);
      });

      await jrn.next(async () => {
        const { identityVerifiedCheckbox, confirmAndCollectButton } = await import('./lab-locators');
        await identityVerifiedCheckbox(page).check().catch(() => { /* not shown */ });
        await confirmAndCollectButton(page).click().catch(() => { /* auto-confirmed */ });
        await page.waitForTimeout(2_500);
        const orders = await labOrdersFor(hid, pid);
        const stat = orders.find(o => o.priority === 'stat');
        if (stat) {
          const samples = await labSamples(stat.id as string);
          expect.soft(
            samples[0]?.status,
            'The STAT sample was not collected despite bypassing the gate.',
          ).toBe('collected');
        }
      });

      await jrn.next(async () => {
        await orderLabThroughModal(page, {
          uhid: patient.uhid, tests: [THIRD_TEST], priority: 'Routine', expectChargeToAdvance: true,
        });
      });

      await jrn.next(async () => {
        // Rule 5: with no charge row posted at all the gate has nothing to check and must clear,
        // rather than stranding a patient because a charge failed to post.
        await openLabTab(page, LAB_TABS.collection);
        await collectionTab(page, COLLECTION_TABS.toCollect).click();
        await page.waitForTimeout(1_500);
        const stillListed = await page.locator('tr').filter({ hasText: patient.uhid }).first()
          .isVisible().catch(() => false);
        expect.soft(
          stillListed,
          'An order whose charge never posted is not on the collection list at all, so it can be ' +
          'neither collected nor cancelled — it is simply lost.',
        ).toBe(true);
      });

      await jrn.next(async () => {
        await openOrderInWorklist(page, patient.uhid);
      });

      await jrn.next(async () => {
        const mark = markCollectedButton(page);
        if (await mark.isVisible().catch(() => false)) {
          await mark.click();
          await page.waitForTimeout(2_500);
          const dialogShown = await paymentPendingDialog(page).isVisible().catch(() => false);
          const toastShown = await page.locator('[role="status"], [data-sonner-toast]').first()
            .isVisible().catch(() => false);
          expect.soft(
            dialogShown || toastShown,
            'FINDING L10. "Mark Collected" in the result workspace is not payment-gate aware: on a ' +
            'pre-paid tenant it neither collects nor explains itself. The technician clicks, ' +
            'nothing happens, and there is no message to act on — so they click again.',
          ).toBe(true);
        }
      });

      await jrn.next(async () => {
        // The attack under test: an AUTHENTICATED technician session, not the service role. Using
        // service-role here would prove nothing, because it bypasses RLS by design.
        const client = anonDb();
        const { staffByRole, PASSWORD } = await import('../fixtures/auth.fixture');
        const staff = staffByRole('A', 'lab_technician');
        await client.auth.signInWithPassword({ email: staff.email, password: PASSWORD });

        const orders = await labOrdersFor(hid, pid);
        const target = orders.find(o => o.id === blockedOrderId) ?? orders[0];
        const samples = await labSamples(target.id as string);
        if (samples[0]) {
          await client.from('lab_samples')
            .update({ status: 'collected' } as never).eq('id', samples[0].id as string);
        }
        await page.waitForTimeout(1_000);
      });

      await jrn.next(async () => {
        const orders = await labOrdersFor(hid, pid);
        const target = orders.find(o => o.id === blockedOrderId) ?? orders[0];
        const samples = await labSamples(target.id as string);
        expect.soft(
          samples[0]?.status,
          'The payment gate is enforced only in the browser — a direct API write from an ordinary ' +
          'authenticated session sets the sample to collected with no charge and no override. ' +
          'Anything that matters for money needs a database constraint or a trigger, not a ' +
          'disabled button.',
        ).not.toBe('collected');
      });

      await jrn.next(async () => {
        await restoreAncillaryPolicy(hid, original);
        const policy = await ancillaryPolicy(hid);
        const lab = policy.lab as { mode?: string } | undefined;
        expect.soft(lab?.mode, 'The ancillary policy was not restored for the rest of the run.')
          .toBe((original.lab as { mode?: string } | undefined)?.mode ?? 'post_paid');
      });
    } finally {
      await restoreAncillaryPolicy(hid, original).catch(() => { /* nothing to restore */ });
    }
  });
});
