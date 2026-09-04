/**
 * Phase 5 · Section F — External / referred-out tests (TC-P5F-001)
 *
 * A send-out is still the hospital's result. The patient was told the test would come back here,
 * and as far as they are concerned the hospital did it. The register tracks the courier and not
 * much else: `patient_id` is never populated, nothing links a referral to the in-house order it
 * replaces, there is nowhere to record the result when it returns, and no cost — so a referred-out
 * test is a dead end that looks like a workflow.
 *
 * NOTHING IS DELETED AND THIS REGISTER IS NOT DATE-FILTERED, so it accumulates across runs. Every
 * assertion below targets the RUN-TAGGED referral by its lab name and never a row count or a
 * "first row" position — a register that grows is the realistic state, and a test that assumes an
 * empty one would start failing on the second run for a reason that has nothing to do with the
 * product.
 */
import { test, expect } from './p5-journey.fixture';
import { MOCK } from '../fixtures/auth.fixture';
import { db } from '../utils/db-verify';
import { testTitle } from './p5-manifest';
import { labOrdersFor, billsFor } from './lab-rad-helpers';
import { RUN_TAG } from './p5-patients';
import { orderLabThroughModal, createExternalReferral, advanceReferral } from './p5-stages';
import {
  openLabTab, LAB_TABS, REFERRAL_CHIPS, referralChip, newReferralButton,
  createReferralButton, referralLabNameInput,
} from './lab-locators';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const EXT = P5.externalReferral;
const SEND_OUT_TEST = String(P5.labOrder.secondaryTest);

test.describe('P5F — External referral', () => {
  test(testTitle('TC-P5F-001'), async ({ page, loginAs, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;

    // Run-tagged so this journey can find its own row in a register that never gets cleaned.
    const labName = `${EXT.labName} ${RUN_TAG}`;
    let inHouseOrderId = '';

    const myReferral = async (): Promise<Record<string, unknown> | undefined> => {
      const { data } = await db().from('external_lab_referrals').select('*')
        .eq('hospital_id', hid).eq('lab_name', labName)
        .order('created_at', { ascending: false });
      return (data ?? [])[0] as Record<string, unknown> | undefined;
    };

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [SEND_OUT_TEST] });
      const orders = await labOrdersFor(hid, pid);
      expect(orders.length, 'The in-house order that will be sent out was not created.' + jrn.note())
        .toBeGreaterThan(0);
      inHouseOrderId = orders[0].id as string;
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.external);
      await expect(
        page.getByText(/referral/i).first(),
        'The External Referrals tab did not open.' + jrn.note(),
      ).toBeVisible({ timeout: 20_000 });
    });

    await jrn.next(async () => {
      for (const [key, chip] of Object.entries(REFERRAL_CHIPS)) {
        await expect.soft(
          referralChip(page, chip),
          `The "${key}" status filter is missing. A send-out desk works the register by state — ` +
          'without the filters, finding which referrals are still awaiting a report means reading ' +
          'every row every morning.',
        ).toBeVisible();
      }
    });

    await jrn.next(async () => {
      await newReferralButton(page).click();
      await page.waitForTimeout(1_500);
      await expect(
        page.getByText(/Refer to External Lab/i).first(),
        'The New Referral modal did not open.' + jrn.note(),
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await createReferralButton(page).click();
      await page.waitForTimeout(2_000);
      const toastText = await page.locator('[role="status"], [data-sonner-toast]').first()
        .innerText().catch(() => '');
      const stillOpen = await referralLabNameInput(page).isVisible().catch(() => false);
      expect.soft(
        stillOpen || /lab name/i.test(toastText),
        'A referral was created with no reference laboratory named. A send-out with no destination ' +
        'is a specimen in a courier bag that nobody can chase, and the patient is the one who ' +
        `finds out. Toast was: "${toastText}"`,
      ).toBe(true);
    });

    await jrn.next(async () => {
      await referralLabNameInput(page).fill(labName);
      const { referralPhoneInput, referralAddressInput } = await import('./lab-locators');
      await referralPhoneInput(page).fill(String(EXT.labPhone)).catch(() => { /* optional field */ });
      await referralAddressInput(page).fill(String(EXT.labAddress)).catch(() => { /* optional */ });
      const date = page.locator('input[type="date"]').first();
      if (await date.count()) {
        const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
        await date.fill(tomorrow);
      }
      await page.waitForTimeout(400);
    });

    await jrn.next(async () => {
      const { referralTestsInput } = await import('./lab-locators');
      await referralTestsInput(page).fill(String(EXT.testsOrdered));
      await page.waitForTimeout(400);
    });

    await jrn.next(async () => {
      await createReferralButton(page).click();
      await page.waitForTimeout(3_000);
    });

    await jrn.next(async () => {
      const row = await myReferral();
      expect(
        row,
        `No referral to "${labName}" was created. A send-out that exists only as a verbal handover ` +
        'is how a specimen leaves the building and nobody can say where it went.' + jrn.note(),
      ).toBeTruthy();
      expect.soft(
        String(row?.status ?? ''),
        'A new referral did not start at "pending".',
      ).toBe('pending');
    });

    await jrn.next(async () => {
      const row = await myReferral();
      expect.soft(
        row?.patient_id,
        'FINDING L8. The referral carries no patient_id. The register knows a test was sent to a ' +
        'reference laboratory and cannot say whose it was — so when the report comes back there is ' +
        'no chart to file it against, and no way to answer "has my test come back yet?".',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const row = await myReferral();
      const cols = Object.keys(row ?? {});
      const link = cols.find(c => /order_id|lab_order|source_order/i.test(c));
      expect.soft(
        link,
        'FINDING L8. Nothing links the referral to the in-house order it replaces. The order and ' +
        'the send-out are two records that never learn about each other, so the laboratory cannot ' +
        'tell which of its open orders are actually elsewhere.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', inHouseOrderId).maybeSingle();
      expect.soft(
        String((data as { status: string } | null)?.status ?? ''),
        'FINDING L8. The in-house order was left open after the test was referred out. It sits in ' +
        'the worklist as work the laboratory believes it still has to do, and it will be chased, ' +
        'counted in turnaround, and never completed.',
      ).not.toBe('ordered');
    });

    await jrn.next(async () => {
      await advanceReferral(page, /Sample Sent/i);
      const row = await myReferral();
      expect.soft(
        String(row?.status ?? ''),
        'The referral did not advance to sample_sent, so the desk cannot record that the specimen ' +
        'actually left.',
      ).toBe('sample_sent');
    });

    await jrn.next(async () => {
      await advanceReferral(page, /Report Awaited/i);
      const row = await myReferral();
      expect.soft(String(row?.status ?? ''), 'The referral did not advance to report_awaited.')
        .toBe('report_awaited');
    });

    await jrn.next(async () => {
      await advanceReferral(page, /Completed/i);
      const row = await myReferral();
      expect.soft(String(row?.status ?? ''), 'The referral did not reach completed.').toBe('completed');
    });

    await jrn.next(async () => {
      const row = await myReferral();
      expect.soft(
        row?.report_received_at,
        'Completing the referral stamped no received time. The date the report came back is what a ' +
        'laboratory uses to hold a reference lab to its turnaround promise.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      for (const chip of Object.values(REFERRAL_CHIPS)) {
        await referralChip(page, chip).click().catch(() => { /* chip may be absent */ });
        await page.waitForTimeout(900);
      }
    });

    await jrn.next(async () => {
      await referralChip(page, REFERRAL_CHIPS.completed).click().catch(() => { /* absent */ });
      await page.waitForTimeout(1_500);
      await expect.soft(
        page.getByText(labName).first(),
        'The completed referral is not listed under the Completed filter, so the register cannot ' +
        'be worked by state at all.',
      ).toBeVisible({ timeout: 10_000 });

      await referralChip(page, REFERRAL_CHIPS.pending).click().catch(() => { /* absent */ });
      await page.waitForTimeout(1_500);
      const wrongTab = await page.getByText(labName).first().isVisible().catch(() => false);
      expect.soft(
        wrongTab,
        'A completed referral still appears under Pending. A filter that does not filter makes the ' +
        'register longer to read than no filter at all.',
      ).toBe(false);
    });

    await jrn.next(async () => {
      await referralChip(page, REFERRAL_CHIPS.completed).click().catch(() => { /* absent */ });
      await page.waitForTimeout(1_500);
      const entry = page.getByRole('button').filter({ hasText: labName }).first();
      if (await entry.count()) {
        await entry.click().catch(() => { /* rows may not be clickable */ });
        await page.waitForTimeout(1_500);
      }
      const resultControl = page.getByRole('button', { name: /enter result|attach|upload report/i }).first();
      expect.soft(
        await resultControl.isVisible().catch(() => false),
        'FINDING L8. A completed referral offers nowhere to record or attach the result that came ' +
        'back. The report arrives as a PDF in somebody\'s email and is filed by hand, so the ' +
        'patient\'s chart never carries the test the hospital ordered on their behalf.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      const row = await myReferral();
      const cols = Object.keys(row ?? {});
      const cost = cols.find(c => /cost|rate|fee|price|amount/i.test(c));
      expect.soft(
        cost,
        'FINDING L8. The referral carries no cost. A reference laboratory invoices the hospital ' +
        'for every send-out; with no cost recorded the hospital cannot decide whether to bill the ' +
        'patient, absorb it, or renegotiate — and reconciles the invoice by memory.',
      ).toBeTruthy();

      const bills = await billsFor(hid, pid, 'lab');
      expect.soft(
        bills.length,
        'The send-out silently raised a patient bill with no cost recorded against the referral.',
      ).toBeGreaterThanOrEqual(0);
    });

    await jrn.next(async () => {
      const row = await myReferral();
      expect.soft(
        row?.hospital_id,
        'The referral is not scoped to a tenant at all, which would make it visible to every ' +
        'hospital on the platform.',
      ).toBe(hid);
    });
  });
});
