/**
 * Phase 5 · Section E — External / referred-out tests (P5-S16)
 * Locks tracker cases TC-P5E-001 … TC-P5E-008
 *
 * THE SCENARIO: a test the hospital does not perform in-house is sent to a reference lab, and
 * the result still has to land in the patient's chart. Every hospital does this — ceruloplasmin,
 * specialised immunology, molecular panels — and the send-out is a real cost with a real
 * turnaround the ward has to be told about.
 *
 * WHAT THE PRODUCT ACTUALLY HAS (`ExternalReferralsTab.tsx`, `ExternalLabReferralModal.tsx`):
 * a standalone register with a four-state client-side machine
 * `pending → sample_sent → report_awaited → completed`. That much works.
 *
 * WHAT IT DOES NOT HAVE, and what TC-P5E-004 … 007 pin as finding L8:
 *   · NO PATIENT. `ExternalReferralsTab.tsx:147-152` renders the modal without passing
 *     `patientId`, and the modal has no patient picker — so every referral raised from the Lab
 *     page is written with `patient_id = null`. A referral attached to nobody cannot reach a
 *     chart, cannot be billed, and cannot be chased.
 *   · NO ORDER LINK. There is no `lab_order_id` column, so referring a test out neither cancels
 *     nor annotates the internal order it replaces. The in-house order sits in the worklist
 *     forever waiting for a sample that has left the building.
 *   · NO RESULT CAPTURE. `completed` stamps a timestamp. There is nowhere to enter or attach the
 *     external report, so the value never reaches `lab_order_items`, the chart or the trend.
 *   · NO COST. No rate, no fee, no bill — the send-out is invisible to billing entirely.
 *
 * These are written as cases rather than left as prose because P5-S16 says "result still lands
 * in the chart", and a scenario nobody has tested is a scenario nobody knows is missing.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import { seedLabOrder, labOrdersFor, billsFor, purgeLabRadArtefacts } from './lab-rad-helpers';
import { openLab, openLabTab, LAB_TABS, newReferralButton, toastText } from './lab-locators';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const EXT = P5.externalReferral;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const DOCTOR = MOCK.doctorFees[0].doctor;
const SEND_OUT_TEST = String(P5.labOrder.secondaryTest);

async function referralsFor(hospitalId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('external_lab_referrals').select('*')
    .eq('hospital_id', hospitalId).order('created_at', { ascending: false });
  if (error) throw new Error(`Reading external_lab_referrals: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function purgeReferrals(hospitalId: string, labName: string): Promise<void> {
  const { error } = await db().from('external_lab_referrals').delete()
    .eq('hospital_id', hospitalId).eq('lab_name', labName);
  if (error) throw new Error(`Purging external_lab_referrals: ${error.message}`);
}

/** Raise a referral through the UI, filling whatever fields the modal actually offers. */
async function raiseReferral(page: import('@playwright/test').Page): Promise<string> {
  await openLabTab(page, LAB_TABS.external);
  await newReferralButton(page).click();
  await page.waitForTimeout(1_200);

  const fill = async (placeholder: RegExp, value: string): Promise<void> => {
    const input = page.getByPlaceholder(placeholder).first();
    if (await input.count()) await input.fill(value);
  };
  await fill(/lab name|reference lab/i, String(EXT.labName));
  await fill(/phone|contact/i, String(EXT.labPhone));
  await fill(/address/i, String(EXT.labAddress));
  await fill(/test/i, String(EXT.testsOrdered));

  await page.getByRole('button', { name: /save|create|refer|submit/i }).first().click();
  await page.waitForTimeout(2_500);
  return toastText(page);
}

test.describe('P5E — External / referred-out tests', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
  });

  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await purgeReferrals(hid, String(EXT.labName));
    await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, UHID)]);
  });

  test('TC-P5E-001 Send-out journey: a referral to a reference lab is raised and lands in the register', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    const before = (await referralsFor(hid)).length;

    await raiseReferral(page);

    const after = await referralsFor(hid);
    expect(
      after.length,
      'The referral was not saved. A send-out that exists only as a verbal handover is how a ' +
      'specimen leaves the building and nobody can say where it went or when to chase it.',
    ).toBeGreaterThan(before);
    expect(String(after[0].lab_name ?? ''), 'The reference lab name was not stored.').toBe(EXT.labName);
    expect(after[0].status, 'A new referral must start at "pending".').toBe('pending');
  });

  test('TC-P5E-002 The referral advances through sample_sent and report_awaited to completed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await raiseReferral(page);

    for (const label of [/sample sent/i, /report awaited/i, /completed/i]) {
      const advance = page.getByRole('button', { name: label }).first();
      if (await advance.isVisible().catch(() => false)) {
        await advance.click();
        await page.waitForTimeout(1_800);
      }
    }

    const referrals = await referralsFor(hid);
    expect(referrals.length, 'No referral exists to advance.').toBeGreaterThan(0);
    expect(
      referrals[0].status,
      'The referral could not be walked to "completed" through the register. Each state is a ' +
      'real hand-off — the courier has it, the lab has it, the report is back — and a register ' +
      'that cannot record them tells the ward nothing when they ring to ask.',
    ).toBe('completed');
  });

  test('TC-P5E-003 Completing a referral stamps when the report came back', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await raiseReferral(page);

    for (const label of [/sample sent/i, /report awaited/i, /completed/i]) {
      const advance = page.getByRole('button', { name: label }).first();
      if (await advance.isVisible().catch(() => false)) {
        await advance.click();
        await page.waitForTimeout(1_800);
      }
    }

    const referrals = await referralsFor(hid);
    expect(referrals.length).toBeGreaterThan(0);
    expect(
      referrals[0].report_received_at,
      'The referral was completed with no report_received_at. Without it the send-out turnaround ' +
      'cannot be measured, and a reference lab that is quietly running two weeks late is never ' +
      'caught.',
    ).toBeTruthy();
  });

  test('TC-P5E-004 The referral is attached to the patient it was raised for', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await raiseReferral(page);

    const referrals = await referralsFor(hid);
    expect(referrals.length).toBeGreaterThan(0);
    expect(
      referrals[0].patient_id,
      'FINDING L8 — EXPECTED FAIL. ExternalReferralsTab.tsx:147-152 renders the referral modal ' +
      'WITHOUT passing patientId, and the modal has no patient picker, so every referral raised ' +
      'from the Lab page is written with patient_id = null. A send-out attached to nobody cannot ' +
      'reach a chart, cannot be billed, and cannot be chased when the reference lab is late — it ' +
      'is a note about a specimen with no owner.',
    ).toBeTruthy();
  });

  test('TC-P5E-005 A referred-out test is linked to the in-house order it replaces', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);

    const seeded = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [SEND_OUT_TEST], billingStatus: 'billed',
    });
    await raiseReferral(page);

    const referrals = await referralsFor(hid);
    expect(referrals.length).toBeGreaterThan(0);
    const columns = Object.keys(referrals[0]);

    expect(
      columns.find(c => /lab_order_id|order_id/i.test(c)),
      'FINDING L8 — EXPECTED FAIL. external_lab_referrals has no column linking a referral to ' +
      `the lab order it replaces (columns: ${columns.join(', ')}). So the in-house order for ` +
      `"${SEND_OUT_TEST}" stays open in the worklist waiting for a specimen that has left the ` +
      'building, and the bench chases a sample that was couriered away days ago.',
    ).toBeTruthy();

    const orders = await labOrdersFor(hid, pid);
    const stillOpen = orders.find(o => o.id === seeded.orderId);
    expect(
      stillOpen?.status,
      'The internal order was never cancelled or annotated when the test was referred out.',
    ).not.toBe('ordered');
  });

  test('TC-P5E-006 The external result reaches the patient chart', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await raiseReferral(page);

    for (const label of [/sample sent/i, /report awaited/i, /completed/i]) {
      const advance = page.getByRole('button', { name: label }).first();
      if (await advance.isVisible().catch(() => false)) {
        await advance.click();
        await page.waitForTimeout(1_500);
      }
    }

    const resultEntry = page
      .getByRole('button', { name: /enter result|attach report|upload/i })
      .or(page.getByPlaceholder(/result|value/i))
      .first();

    expect(
      await resultEntry.isVisible().catch(() => false),
      'FINDING L8 — EXPECTED FAIL. Marking a referral "completed" only stamps a timestamp. There ' +
      'is nowhere to enter a value or attach the reference lab\'s report, so the result never ' +
      'reaches lab_order_items, the chart, or the patient\'s trend. P5-S16 requires exactly this ' +
      '— "result still lands in the chart" — and the register currently records that a report ' +
      'came back without recording what it said. The doctor reads the paper copy and the ' +
      'electronic record stays permanently incomplete.',
    ).toBe(true);
  });

  test('TC-P5E-007 A send-out carries a cost, so the hospital can bill or absorb it deliberately', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    const billsBefore = await billsFor(hid, pid, 'lab');

    await raiseReferral(page);

    const referrals = await referralsFor(hid);
    expect(referrals.length).toBeGreaterThan(0);
    const columns = Object.keys(referrals[0]);

    expect(
      columns.find(c => /cost|rate|fee|price|amount/i.test(c)),
      'FINDING L8 — EXPECTED FAIL. external_lab_referrals stores no cost of any kind ' +
      `(columns: ${columns.join(', ')}) and raises no charge. The reference lab invoices the ` +
      'hospital monthly for work nothing in the system priced, so send-outs are pure unbilled ' +
      'margin leakage — and the hospital cannot even tell how much, because the volume is only ' +
      'in this register and the money is only on the vendor invoice.',
    ).toBeTruthy();

    const billsAfter = await billsFor(hid, pid, 'lab');
    expect(billsAfter.length, 'A referral silently created a patient bill it never priced.').toBe(billsBefore.length);
  });

  test('TC-P5E-008 A referral is visible only to the tenant that raised it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hidA = await hospitalIdFor('A');
    const hidB = await hospitalIdFor('B');

    await raiseReferral(page);

    const mine = await referralsFor(hidA);
    expect(mine.length, 'No referral was created to test isolation against.').toBeGreaterThan(0);
    expect(mine[0].hospital_id, 'The referral was stamped with the wrong tenant.').toBe(hidA);

    const { data: leaked } = await db().from('external_lab_referrals')
      .select('id').eq('hospital_id', hidB).eq('lab_name', String(EXT.labName));
    expect(
      leaked?.length ?? 0,
      'A Hospital A referral is readable inside Hospital B. A send-out names the patient, the ' +
      'tests and the reference lab — it is PHI, and a cross-tenant read of it is a DPDP Act ' +
      'breach, not a display bug.',
    ).toBe(0);
  });
});
