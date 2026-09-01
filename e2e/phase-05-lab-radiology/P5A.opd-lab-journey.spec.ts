/**
 * Phase 5 · Section A — OPD cash lab journeys (P5-S01)
 * Locks tracker cases TC-P5A-001 … TC-P5A-004
 *
 * ONE CASE = ONE COMPLETE JOURNEY, DRIVEN ENTIRELY THROUGH THE UI:
 *
 *   register the patient → consult → prescribe the test → complete
 *     → Pending from OPD → collect payment → the order now exists
 *     → draw the sample with two-identifier verification → receive → process
 *     → type the result → release
 *     → the treating doctor sees it on the chart, and the charge is on the bill
 *
 * Nothing in this file seeds a lab order, a sample or a result. That is the whole point: the
 * previous version of this phase split the chain across five sections and re-created the
 * starting state at each boundary with a service-role insert, so it never once proved that the
 * stages hand off to each other — which is the only thing a hospital actually cares about.
 *
 * The database assertions remain (a green toast is not a pass, per docs/qa/README.md), but they
 * now confirm what the UI journey produced rather than what a fixture inserted.
 *
 * WHY THERE IS A CONSULTATION IN A LAB TEST. Completing an OPD consultation deliberately creates
 * NO lab order — `ConsultationWorkspace.tsx:1361` documents the payment-first design. The
 * prescription is the hand-off, and the desk's payment wizard is what creates the order. Starting
 * the journey at the Lab module would skip the transition most likely to be broken.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid } from '../phase-04-opd-journey/opd-helpers';
import {
  labOrdersFor, labOrderItems, labSamples, billsFor, billLineItemsByDedupeKey,
  purgeLabRadArtefacts,
} from './lab-rad-helpers';
import {
  consultAndPrescribe, collectPaymentForPendingLab, collectSampleThroughWorkstation,
  receiveAndProcess, openOrderInWorklist, enterResult, releaseResults, expectResultOnChart,
  recordApiFailures,
} from './lab-rad-journeys';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const DEPARTMENT = MOCK.doctorFees[0].department;
const DOCTOR = MOCK.doctorFees[0].doctor;

/** Haemoglobin — a verbatim `lab_test_master.test_name`, so the modal pre-fill matches it. */
const TEST = String(P5.labOrder.normalTest);
const NORMAL_VALUE = String(P5.results.normalHaemoglobin);

async function ctx(): Promise<{ hid: string; pid: string }> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, UHID);
  return { hid, pid };
}

test.describe('P5A — OPD cash lab journeys', () => {
  // A journey is a dozen real round trips through four modules; the default 90s budget is for
  // single-stage tests.
  test.setTimeout(300_000);


  test.afterEach(async () => {
    if (!DB_ON()) return;
    const { hid, pid } = await ctx();
    await purgeLabRadArtefacts(hid, [pid]);
    const { purgeByUhid } = await import('../phase-04-opd-journey/opd-helpers');
    await purgeByUhid('A', [UHID]).catch(() => { /* nothing from this run to clear */ });
  });

  test('TC-P5A-001 Cash OPD journey: consultation to released report, with the charge on the bill', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { hid, pid } = await ctx();
    await purgeLabRadArtefacts(hid, [pid]);
    const { purgeByUhid } = await import('../phase-04-opd-journey/opd-helpers');
    await purgeByUhid('A', [UHID]).catch(() => { /* first run */ });

    // Surface any 4xx from the API in the failure message — a stalled wizard never says why.
    const apiFailures = recordApiFailures(page);

    /* ── The doctor's half ─────────────────────────────────────────── */
    await loginAs('doctor', { hospital: 'A' });
    await consultAndPrescribe(page, {
      uhid: UHID, patientName: NAME, department: DEPARTMENT, doctor: DOCTOR,
      orders: { labTests: [TEST] },
    });

    await test.step('The consultation itself raises no lab order — the prescription is the hand-off', async () => {
      const orders = await labOrdersFor(hid, pid);
      expect(
        orders.length,
        'CURRENT DESIGN, asserted so a change is visible: completing a consultation must create ' +
        'NO lab_orders row and post NO charge. The order is created by the desk when it takes ' +
        'the money. If this starts returning a row, the product has moved to order-first and ' +
        'every "Pending from OPD" case below is testing a path that no longer exists.',
      ).toBe(0);
    });

    /* ── The desk's half ───────────────────────────────────────────── */
    // A journey crosses PEOPLE, not just screens, and each hand-off is a real change of user.
    // `loginAs` alone is not enough: /login redirects an already-authenticated session straight
    // back to the dashboard, so the sign-in form is never filled and the previous user silently
    // stays logged in. The first run of this journey reached the payment wizard still logged in
    // as the doctor and failed there — with a screenshot showing "Dr. Suresh … Doctor" in the
    // sidebar. Clear the session first, every time.
    await logout();
    await loginAs('lab_technician', { hospital: 'A' });
    const { billNumber } = await collectPaymentForPendingLab(page, {
      patientName: NAME, expectTests: [TEST], apiFailures,
    });

    const orderId = await test.step('Taking the payment created a real, billed order', async () => {
      const orders = await labOrdersFor(hid, pid);
      expect(
        orders.length,
        'The desk took the cash and no lab_orders row exists. The patient has paid and the ' +
        'laboratory has no idea they are coming.',
      ).toBeGreaterThan(0);

      const order = orders[0];
      expect(order.status, 'A newly created order must start at "ordered".').toBe('ordered');
      expect(
        order.billing_status,
        'The order was left "unbilled". LabPage filters those out entirely, so it would be ' +
        'invisible in the worklist forever with no screen anywhere that would show it.',
      ).not.toBe('unbilled');
      expect(
        String(order.accession_number ?? ''),
        'No accession number was assigned, so the request cannot be matched to a tube on the bench.',
      ).toMatch(/^ACC-\d{8}-\d{4}$/);

      const items = await labOrderItems(order.id as string);
      expect(
        items.length,
        'An order header with no items — a ghost order the lab can see but not act on.',
      ).toBeGreaterThan(0);

      const samples = await labSamples(order.id as string);
      expect(
        samples.length,
        'No sample row was created, so the patient never reaches the phlebotomy worklist.',
      ).toBeGreaterThan(0);
      expect(samples[0].status, 'A new sample must start "pending".').toBe('pending');

      return order.id as string;
    });

    await test.step('The money is recorded: a finalised, paid bill carrying the dedupe key', async () => {
      const bills = await billsFor(hid, pid, 'lab');
      expect(bills.length, 'Cash was collected against no bill; the day will not reconcile.').toBeGreaterThan(0);
      expect(bills[0].bill_status, 'A paid bill was left in draft and never reaches day closure.').toBe('final');
      expect(bills[0].payment_status, 'The bill still reads unpaid after cash was taken.').toBe('paid');
      expect(
        Number(bills[0].total_amount),
        'The bill totals ₹0 — the test was given away.',
      ).toBeGreaterThan(0);

      const items = await labOrderItems(orderId);
      const lines = await billLineItemsByDedupeKey(hid, `lab:${items[0].id as string}`);
      expect(
        lines.length,
        'The charge line carries no "lab:<item id>" dedupe key. That key is the only thing ' +
        'stopping the discharge sweep posting this investigation a second time.',
      ).toBe(1);
      void billNumber;
    });

    /* ── The phlebotomist's half ───────────────────────────────────── */
    await collectSampleThroughWorkstation(page, NAME);

    await test.step('The draw moved the sample AND the order', async () => {
      const samples = await labSamples(orderId);
      expect(
        samples[0].status,
        'The phlebotomist drew blood the system still believes is waiting, so the next shift ' +
        'draws the patient again.',
      ).toBe('collected');
      expect(samples[0].collected_at, 'collected_at was not stamped, so the TAT clock never starts.').toBeTruthy();
      expect(
        samples[0].collected_by,
        'No collector recorded. NABH traceability needs the draw attributable when a mix-up is suspected.',
      ).toBeTruthy();

      const { data: order } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect(
        (order as { status: string } | null)?.status,
        'The sample is collected but the ORDER did not move. The result workspace refuses a ' +
        'value until it does, so the bench cannot report a specimen it physically holds.',
      ).toBe('sample_collected');
    });

    await receiveAndProcess(page, NAME);

    /* ── The bench's half ──────────────────────────────────────────── */
    await openOrderInWorklist(page, NAME);
    await enterResult(page, TEST, NORMAL_VALUE);

    await test.step('The typed result persisted and was flagged against the reference range', async () => {
      const items = await labOrderItems(orderId);
      const item = items.find(i => (i.lab_test_master as { test_name?: string } | null)?.test_name === TEST);
      expect(
        item?.result_value,
        'The value was typed and nothing reached the database. NOTE: the input commits on BLUR, ' +
        'not on change — if the journey stopped blurring, this is where it shows up.',
      ).toBeTruthy();
      expect(String(item?.result_value), 'The saved value is not the one that was typed.').toBe(NORMAL_VALUE);
      expect(
        item?.result_flag,
        `${NORMAL_VALUE} g/dL is inside the reference range and must flag "N". A result with no ` +
        'flag at all means the reference range never reached the bench.',
      ).toBe('N');
    });

    await releaseResults(page);

    await test.step('The order is released', async () => {
      const { data: order } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect(
        ['completed', 'pending_validation'],
        'The order did not advance on release, so the patient is never told the report is ready.',
      ).toContain(String((order as { status: string } | null)?.status));
    });

    /* ── Back to the doctor — the point of the whole chain ─────────── */
    await logout();
    await loginAs('doctor', { hospital: 'A' });
    await expectResultOnChart(page, { patientName: NAME, testName: TEST, value: NORMAL_VALUE });
  });
});
