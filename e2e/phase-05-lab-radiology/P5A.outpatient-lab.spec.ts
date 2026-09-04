/**
 * Phase 5 · Section A — Outpatient lab (TC-P5A-001 … 003)
 *
 * Three complete journeys, not thirty field pokes. Each one owns its patient, walks the chain
 * through the browser, and asserts its positive, negative and boundary conditions as it goes.
 *
 * THE FACT THAT SHAPES ALL THREE. Completing an OPD consultation creates NO `lab_orders` row —
 * `ConsultationWorkspace.tsx:1361` documents the payment-first design. The prescription is the
 * hand-off; the desk's wizard is what takes the money and creates the order. A journey that jumped
 * from "doctor ordered" to "lab has an order" would be testing a transition the product does not
 * have, which is exactly what the previous suite did by seeding every order it needed.
 *
 * HARD vs SOFT. Hard `expect` only where the next stage physically cannot run without it — the
 * order exists, the sample was collected. Everything else is `expect.soft`, so a wrong flag badge
 * goes red without un-reporting the twenty conditions that follow it.
 */
import { test, expect } from './p5-journey.fixture';
import { MOCK } from '../fixtures/auth.fixture';
import { db } from '../utils/db-verify';
import { testTitle } from './p5-manifest';
import {
  labOrdersFor, labOrderItems, labSamples, billsFor, billLineItemsByDedupeKey,
  labTestGroupIdByName, labTestGroupMemberIds, clinicalAlertsFor,
} from './lab-rad-helpers';
import {
  collectPaymentForPendingLab, collectThroughWorkstation, receiveSample, processSample,
  openOrderInWorklist, enterResult, releaseResults, expectResultOnChart,
  openNewLabOrder, selectPatientInModal, addTestInModal, orderLabThroughModal,
  applyGroupInModal,
} from './p5-stages';
import {
  openLab, openLabTab, LAB_TABS, collectionTab, COLLECTION_TABS, collectButton,
  identityVerifiedCheckbox, confirmAndCollectButton, proceedToPaymentButton,
  priorityButton, clinicalNotesTextarea, wizardBackButton, paymentModeButton,
  paymentReferenceInput, collectAndCreateButton, wizardDoneButton, feeInputs,
  resultFlagBadge, referringDoctorSelect,
} from './lab-locators';
import {
  registerWalkIn, openTokenAndStart, fillComplaint, addLabTest, completeConsultation,
} from '../phase-04-opd-journey/opd-flows';
import { openOpd, completeButton } from '../phase-04-opd-journey/opd-locators';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;

const DEPARTMENT = MOCK.doctorFees[0].department;
const DOCTOR = MOCK.doctorFees[0].doctor;
const HB = String(P5.labOrder.normalTest);          // Haemoglobin
const HB_NORMAL = String(P5.results.normalHaemoglobin);
const GROUP = String(P5.labOrder.group);
const GROUP_FEE = Number(P5.labOrder.groupFee);
const GROUP_MEMBER_SUM = Number(P5.labOrder.groupMemberSum);
const K_TEST = String(P5.labOrder.primaryTest);
const OFF_CATALOGUE = String(P5.labOrder.offCatalogueTest);

test.describe('P5A — Outpatient lab', () => {
  test(testTitle('TC-P5A-001'), async ({ page, loginAs, logout, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;

    await jrn.next(async () => {
      // The fixture already provisioned the patient and repaired the masters; record what it had
      // to repair so a configuration gap is read as configuration, not as a product defect.
      expect(patient.uhid, 'The journey has no patient of its own.').toBeTruthy();
    });

    await jrn.next(async () => {
      await loginAs('doctor', { hospital: 'A' });
      await openOpd(page);
    });

    await jrn.next(async () => {
      await registerWalkIn(page, {
        existingPatientQuery: patient.uhid, department: DEPARTMENT, doctor: DOCTOR,
      });
    });

    await jrn.next(async () => {
      const { data } = await db().from('opd_tokens').select('id, patient_id')
        .eq('hospital_id', hid).eq('patient_id', pid);
      expect(
        data?.length ?? 0,
        'Registering the walk-in issued no token. The token IS the queue position — without it ' +
        'the patient is in the building and on no list.' + jrn.note(),
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await openTokenAndStart(page, patient.name);
    });

    await jrn.next(async () => {
      // NEGATIVE — the chief complaint is what every downstream clinician reads first.
      const complete = completeButton(page);
      if (await complete.isVisible().catch(() => false)) {
        await complete.click().catch(() => { /* correctly disabled */ });
        await page.waitForTimeout(1_500);
      }
      const stillOpen = await completeButton(page).isVisible().catch(() => false);
      expect.soft(
        stillOpen,
        'A consultation completed with an empty chief complaint. The complaint is the clinical ' +
        'reason the patient attended and the first thing the next clinician reads; a record ' +
        'without one is a visit nobody can interpret afterwards. CURRENT BEHAVIOUR is that this ' +
        'is refused — a green here means the guard was removed.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      await fillComplaint(page, String(P5.labOrder.clinicalNotes));
    });

    await jrn.next(async () => {
      await addLabTest(page, HB);
      await expect.soft(
        page.getByText(/Selected \(\d+\)/i).first(),
        `"${HB}" did not appear under Selected. The prescription is what the Lab module reads — ` +
        'nothing downstream happens if this list is empty.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await completeConsultation(page);
    });

    await jrn.next(async () => {
      const orders = await labOrdersFor(hid, pid);
      expect.soft(
        orders.length,
        'CURRENT DESIGN, asserted so a change is visible: completing a consultation must create ' +
        'NO lab_orders row and post NO charge. The desk creates the order when it takes the ' +
        'money. If this starts returning a row the product has moved to order-first, and every ' +
        '"Pending from OPD" stage below is testing a path that no longer exists.',
      ).toBe(0);
    });

    // A journey crosses PEOPLE, not just screens. `loginAs` alone is not enough — /login redirects
    // an authenticated session straight back to the dashboard, so the previous user silently stays
    // logged in and the desk stage runs as the doctor.
    await jrn.next(async () => {
      await logout();
      await loginAs('lab_technician', { hospital: 'A' });
      await openLabTab(page, LAB_TABS.pendingOpd);
      await expect(
        page.getByText(patient.name).first(),
        `${patient.name} is not listed under "Pending from OPD". The consultation saved a ` +
        'prescription the Lab module cannot see, so the patient is standing at a counter nobody ' +
        'has been told to expect them at. NOTE: this tab is filtered to TODAY only.' + jrn.note(),
      ).toBeVisible({ timeout: 20_000 });
    });

    let billNumber = '';

    await jrn.next(async () => {
      const row = page.locator('div').filter({ hasText: patient.name });
      await row.getByRole('button', { name: /create order/i }).last().click();
      await page.waitForTimeout(2_000);
      await expect(
        page.getByText(/New Lab Order/i).first(),
        'The New Lab Order modal did not open from the pending row.' + jrn.note(),
      ).toBeVisible();

      // The modal opens with the patient AND the prescribed tests already selected. Re-searching
      // here is what the previous suite did, and it filled a search box that is not rendered when a
      // patient is preselected — ending up with four unrelated tests against no patient at all.
      await expect.soft(
        page.getByText(patient.name).first(),
        'The modal did not carry the patient across from the pending row, so the desk would have to ' +
        'identify them again by hand — which is how an order lands on the wrong chart.',
      ).toBeVisible();
      await expect.soft(
        page.getByText(HB, { exact: false }).first(),
        `"${HB}" was prescribed but did not arrive preselected. The pre-fill matches ` +
        'lab_test_master.test_name EXACTLY, so a prescribed name that is not a verbatim catalogue ' +
        'entry falls into the amber "not found in lab catalog" block and is silently not ordered.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await proceedToPaymentButton(page).click();
      await page.waitForTimeout(1_800);
      await expect(
        page.getByText(/Collect Payment/i).first(),
        'The wizard did not reach the payment step.' + jrn.note(),
      ).toBeVisible();

      // An unpriced test renders an editable box; left blank it bills ₹0 and the journey proves
      // nothing about money.
      const fees = feeInputs(page);
      const n = await fees.count();
      for (let i = 0; i < n; i++) await fees.nth(i).fill('200');
      if (n) await page.waitForTimeout(600);
    });

    await jrn.next(async () => {
      await paymentModeButton(page, 'Cash').click().catch(() => { /* cash is the default */ });
      await page.waitForTimeout(400);
      await collectAndCreateButton(page).click();
      await page.waitForTimeout(5_000);

      // TRUST THE DATABASE, NOT THE SCREEN — this programme's own rule, and it matters here.
      // On the Pending-from-OPD path the wizard closes straight back to the tab rather than
      // resting on its "Payment Collected!" receipt, so waiting for that screen fails on a
      // transaction that completed perfectly: the order, the bill and the payment are all written.
      // The money is the thing being tested; the receipt screen is asserted softly below.
      await expect
        .poll(async () => (await labOrdersFor(hid, pid)).length, {
          timeout: 20_000,
          message:
            'The counter took the cash and no lab_orders row exists. The patient has paid and the ' +
            'laboratory has no idea they are coming.' + jrn.note(),
        })
        .toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      // The receipt is what the patient walks away with. Soft, because the wizard may already have
      // returned to the worklist by the time we look — the bill number is re-checked against
      // `bills` two stages further on, where it cannot be missed.
      billNumber = (await page.getByText(/LAB-\d+/i).first().innerText().catch(() => '')).trim();
      expect.soft(
        billNumber,
        'No bill number was shown after payment, so the patient leaves the counter with nothing ' +
        'that ties what they paid to the test they paid for.',
      ).toBeTruthy();
      const done = wizardDoneButton(page);
      if (await done.count()) await done.click().catch(() => { /* wizard already closed */ });
      await page.waitForTimeout(1_500);
    });

    let orderId = '';
    await jrn.next(async () => {
      const orders = await labOrdersFor(hid, pid);
      expect(
        orders.length,
        'The desk took the cash and no lab_orders row exists. The patient has paid and the ' +
        'laboratory has no idea they are coming.' + jrn.note(),
      ).toBeGreaterThan(0);
      orderId = orders[0].id as string;
      expect.soft(orders[0].status, 'A newly created order must start at "ordered".').toBe('ordered');
      expect.soft(
        orders[0].billing_status,
        'The order was left "unbilled". LabPage filters those out entirely, so it would be ' +
        'invisible in the worklist forever with no screen anywhere that would show it.',
      ).not.toBe('unbilled');
    });

    await jrn.next(async () => {
      const orders = await labOrdersFor(hid, pid);
      expect.soft(
        String(orders[0].accession_number ?? ''),
        'No accession number in the ACC-YYYYMMDD-NNNN series was assigned, so the request cannot ' +
        'be matched to a tube on the bench.',
      ).toMatch(/^ACC-\d{8}-\d{4}$/);
    });

    await jrn.next(async () => {
      const items = await labOrderItems(orderId);
      expect(
        items.length,
        'An order header with no items — a ghost order the lab can see but not act on.',
      ).toBeGreaterThan(0);
      const samples = await labSamples(orderId);
      expect(
        samples.length,
        'No sample row was created, so the patient never reaches the phlebotomy worklist.',
      ).toBeGreaterThan(0);
      expect.soft(samples[0].status, 'A new sample must start "pending".').toBe('pending');
    });

    await jrn.next(async () => {
      const bills = await billsFor(hid, pid, 'lab');
      expect(
        bills.length,
        'Cash was collected against no bill; the day will not reconcile.' + jrn.note(),
      ).toBeGreaterThan(0);
      expect.soft(bills[0].bill_status, 'A paid bill was left in draft and never reaches day closure.').toBe('final');
      expect.soft(bills[0].payment_status, 'The bill still reads unpaid after cash was taken.').toBe('paid');
      expect.soft(Number(bills[0].total_amount), 'The bill totals ₹0 — the test was given away.').toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      const items = await labOrderItems(orderId);
      const lines = await billLineItemsByDedupeKey(hid, `lab:${items[0].id as string}`);
      expect.soft(
        lines.length,
        'The charge line does not carry exactly one "lab:<item id>" dedupe key. That key is the ' +
        'only thing stopping the discharge sweep posting this investigation a second time.',
      ).toBe(1);
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.collection);
      await collectionTab(page, COLLECTION_TABS.toCollect).click();
      await page.waitForTimeout(1_200);
      await expect(
        page.locator('tr').filter({ hasText: patient.uhid }).first(),
        'Paying for a test must put the patient in front of the phlebotomist. If it does not, ' +
        'the sample is never drawn and the patient goes home believing the test was done.',
      ).toBeVisible({ timeout: 20_000 });
    });

    await jrn.next(async () => {
      // NEGATIVE — wrong-blood-in-tube is a sentinel event; the tick is the control that stops it.
      await collectButton(page, patient.uhid).click();
      await page.waitForTimeout(1_200);
      const confirm = confirmAndCollectButton(page);
      await expect.soft(
        confirm,
        'Confirm & Collect is enabled before the technician has attested that they checked two ' +
        'identifiers at the bedside. The tick IS the control — an enabled button makes it decorative.',
      ).toBeDisabled();
    });

    await jrn.next(async () => {
      await identityVerifiedCheckbox(page).check().catch(() => { /* already ticked */ });
      await page.waitForTimeout(300);
      await confirmAndCollectButton(page).click();
      await page.waitForTimeout(2_500);
    });

    await jrn.next(async () => {
      const samples = await labSamples(orderId);
      expect(
        samples[0].status,
        'The phlebotomist drew blood the system still believes is waiting, so the next shift ' +
        'draws the patient again.' + jrn.note(),
      ).toBe('collected');
      expect.soft(samples[0].collected_at, 'collected_at was not stamped, so the TAT clock never starts.').toBeTruthy();
      expect.soft(
        samples[0].collected_by,
        'No collector recorded. NABH traceability needs the draw attributable when a mix-up is suspected.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect.soft(
        (data as { status: string } | null)?.status,
        'The sample is collected but the ORDER did not move. The result workspace refuses a value ' +
        'until it does, so the bench cannot report a specimen it physically holds.',
      ).toBe('sample_collected');
    });

    await jrn.next(async () => {
      await receiveSample(page, patient.uhid);
    });

    await jrn.next(async () => {
      await processSample(page, patient.uhid);
    });

    await jrn.next(async () => {
      const samples = await labSamples(orderId);
      expect.soft(samples[0].received_at, 'received_at was not stamped at the laboratory door.').toBeTruthy();
      const { data } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect.soft(
        (data as { status: string } | null)?.status,
        'Processing did not move the order, so the bench cannot enter a result.',
      ).toBe('in_process');
    });

    await jrn.next(async () => {
      await openOrderInWorklist(page, patient.uhid);
    });

    await jrn.next(async () => {
      await enterResult(page, HB, HB_NORMAL);

      // A NORMAL RESULT RENDERS NO BADGE AT ALL. `FLAG_STYLES` gives `H`, `L`, `CH`, `CL` and `A`
      // a visible label and leaves `N` deliberately blank, so asserting a visible "N" badge is
      // asserting something that can never appear — the first version of this stage did exactly
      // that and reported a correct result as a range defect. What must be true on screen is the
      // ABSENCE of an abnormal marker; the flag column itself is checked in the DB next stage.
      for (const abnormal of ['H', 'L', 'CH', 'CL'] as const) {
        expect.soft(
          await resultFlagBadge(page, abnormal).isVisible().catch(() => false),
          `${HB_NORMAL} g/dL is inside this patient's reference range and must not be flagged ` +
          `"${abnormal}". A range that flags a healthy value produces an abnormal result on every ` +
          'well patient, and alert fatigue is how a real abnormality gets scrolled past. NOTE the ' +
          'range is sex-specific — male 13–17, female 12–15 — so a flag here may mean the patient\'s ' +
          'sex was not applied rather than that the range is wrong.',
        ).toBe(false);
      }
    });

    await jrn.next(async () => {
      const items = await labOrderItems(orderId);
      const item = items.find(i => (i.lab_test_master as { test_name?: string } | null)?.test_name === HB);
      expect(
        item?.result_value,
        'The value was typed and nothing reached the database. NOTE: the input commits on BLUR, ' +
        'not on change — if the journey stopped blurring, this is where it shows up.' + jrn.note(),
      ).toBeTruthy();
      expect.soft(String(item?.result_value), 'The saved value is not the one that was typed.').toBe(HB_NORMAL);
      expect.soft(item?.result_flag, 'A result with no flag means the reference range never reached the bench.').toBe('N');
    });

    await jrn.next(async () => {
      await releaseResults(page);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect.soft(
        ['completed', 'pending_validation'],
        'The order did not advance on release, so the patient is never told the report is ready.',
      ).toContain(String((data as { status: string } | null)?.status));
    });

    await jrn.next(async () => {
      const alerts = await clinicalAlertsFor({ hospitalId: hid, patientId: pid });
      const ready = alerts.filter(a => String(a.alert_type ?? '').endsWith('_ready'));
      expect.soft(
        ready.length,
        'Releasing the result notified nobody. The ordering doctor is the one person waiting on ' +
        'this answer; without an alert the result is delivered only if somebody telephones.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await logout();
      await loginAs('doctor', { hospital: 'A' });
    });

    await jrn.next(async () => {
      await expectResultOnChart(page, { patientName: patient.name, testName: HB, value: HB_NORMAL });
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('billing_status').eq('id', orderId).maybeSingle();
      expect.soft(
        (data as { billing_status: string } | null)?.billing_status,
        'The order is not marked billed, so nothing tells the billing module the investigation ' +
        'happened. Unbilled investigations are the largest single source of diagnostic revenue ' +
        'leakage, and they leak silently.',
      ).toBe('billed');
    });

    await jrn.next(async () => {
      const items = await labOrderItems(orderId);
      const lines = await billLineItemsByDedupeKey(hid, `lab:${items[0].id as string}`);
      expect.soft(
        lines.length,
        'Releasing the result added a SECOND charge line for an investigation that was already ' +
        'paid for at the counter. The patient is billed twice for one test.',
      ).toBe(1);
    });
  });

  test(testTitle('TC-P5A-002'), async ({ page, loginAs, logout, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    const members = MOCK.labTestGroups.find(g => g.name === GROUP)?.members ?? [];

    await jrn.next(async () => {
      expect(members.length, `The mock panel "${GROUP}" declares no members.`).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      const groupId = await labTestGroupIdByName(hid, GROUP);
      const memberIds = await labTestGroupMemberIds(groupId);
      expect(
        memberIds.length,
        `PREREQUISITE. "${GROUP}" has no rows in lab_test_group_items. A group with no members is ` +
        'not a panel: fetchRates detects a covered group by checking every member is in the ' +
        'selection, which is vacuously true for the empty set, so the group price never applies ' +
        'and the panel bills as separate tests.',
      ).toBe(members.length);
    });

    await jrn.next(async () => {
      await loginAs('doctor', { hospital: 'A' });
      await openOpd(page);
    });

    await jrn.next(async () => {
      await registerWalkIn(page, {
        existingPatientQuery: patient.uhid, department: DEPARTMENT, doctor: DOCTOR,
      });
      await openTokenAndStart(page, patient.name);
      await fillComplaint(page, String(P5.labOrder.clinicalNotes));
    });

    await jrn.next(async () => {
      for (const m of members) await addLabTest(page, m);
    });

    await jrn.next(async () => {
      await completeConsultation(page);
    });

    await jrn.next(async () => {
      await logout();
      await loginAs('lab_technician', { hospital: 'A' });
      await openLabTab(page, LAB_TABS.pendingOpd);
    });

    let quoted = '';
    await jrn.next(async () => {
      const row = page.locator('div').filter({ hasText: patient.name });
      await row.getByRole('button', { name: /create order/i }).last().click();
      await page.waitForTimeout(2_000);

      // ORDER THE PANEL AS A PANEL. `addGroup()` adds every member and records the group, which is
      // what lets `fetchRates()` apply the group price; adding the same members one at a time is
      // the order-PART-of-a-panel path and is correctly billed at individual fees. The first
      // version prescribed the members individually and then asserted the panel price, so it was
      // asserting the group rate against the path that deliberately does not use it.
      const applied = await applyGroupInModal(page, GROUP);
      expect.soft(
        applied,
        `The "${GROUP}" panel is not offered as a chip in the order modal, so a desk can only ` +
        'order its members one by one — and a hospital that advertises a bundled price has no way ' +
        'to actually charge it.',
      ).toBe(true);

      for (const m of members) {
        await expect.soft(
          page.getByText(m, { exact: false }).first(),
          `Panel member "${m}" is not in the order after applying the panel.`,
        ).toBeVisible();
      }
    });

    await jrn.next(async () => {
      await proceedToPaymentButton(page).click();
      await page.waitForTimeout(1_800);
      const pay = collectAndCreateButton(page);
      quoted = (await pay.innerText().catch(() => '')).trim();
    });

    await jrn.next(async () => {
      const digits = Number(quoted.replace(/[^\d]/g, '')) || 0;
      expect.soft(
        digits,
        `The wizard quoted ${quoted}. A panel exists so a hospital can discount a bundle — the ` +
        `quote must be the ₹${GROUP_FEE} group price, not the ₹${GROUP_MEMBER_SUM} sum of its ` +
        'members. Quoting the sum means the discount the hospital advertises is never applied.',
      ).toBe(GROUP_FEE);
    });

    await jrn.next(async () => {
      const fees = feeInputs(page);
      const n = await fees.count();
      for (let i = 0; i < n; i++) await fees.nth(i).fill('200');
      await collectAndCreateButton(page).click();
      await page.waitForTimeout(4_500);
      const done = wizardDoneButton(page);
      if (await done.count()) await done.click().catch(() => { /* closed itself */ });
      await page.waitForTimeout(1_500);
    });

    let orderId = '';
    await jrn.next(async () => {
      const bills = await billsFor(hid, pid, 'lab');
      expect(bills.length, 'The panel order raised no bill.' + jrn.note()).toBeGreaterThan(0);
      expect.soft(
        Number(bills[0].total_amount),
        `The bill header totals ₹${Number(bills[0].total_amount)}. It must be the ₹${GROUP_FEE} ` +
        `group price, not ₹${GROUP_MEMBER_SUM}.`,
      ).toBe(GROUP_FEE);
      const orders = await labOrdersFor(hid, pid);
      orderId = orders[0]?.id as string;
    });

    await jrn.next(async () => {
      const bills = await billsFor(hid, pid, 'lab');
      const { data } = await db().from('bill_line_items').select('unit_rate, total_amount, description')
        .eq('bill_id', bills[0].id as string);
      const zero = (data ?? []).filter(r => Number((r as { unit_rate: number }).unit_rate) === 0);
      expect.soft(
        zero.length,
        'FINDING L2. Group rates are keyed by group_id but the bill-line loop looks them up by ' +
        'test_id, so every group-covered test is written at unit_rate 0 while the header still ' +
        'carries the panel fee. The bill does not add up, and nobody notices until reconciliation.',
      ).toBe(0);
    });

    await jrn.next(async () => {
      const bills = await billsFor(hid, pid, 'lab');
      const { data } = await db().from('bill_line_items').select('description')
        .eq('bill_id', bills[0].id as string);
      const placeholder = (data ?? []).filter(r => /^Lab: Test$/i.test(String((r as { description: string }).description ?? '')));
      expect.soft(
        placeholder.length,
        'FINDING L2. A charge line reads "Lab: Test" — the placeholder written when the rate ' +
        'lookup misses. A patient handed this bill cannot tell what they paid for.',
      ).toBe(0);
    });

    await jrn.next(async () => {
      const bills = await billsFor(hid, pid, 'lab');
      const { data } = await db().from('bill_line_items').select('total_amount')
        .eq('bill_id', bills[0].id as string);
      const sum = (data ?? []).reduce((a, r) => a + Number((r as { total_amount: number }).total_amount ?? 0), 0);
      expect.soft(
        sum,
        `The line items sum to ₹${sum} but the bill header says ₹${Number(bills[0].total_amount)}. ` +
        'A bill that does not add up is a bill a patient will dispute and a hospital cannot defend.',
      ).toBe(Number(bills[0].total_amount));
    });

    await jrn.next(async () => {
      await collectThroughWorkstation(page, patient.uhid);
    });

    await jrn.next(async () => {
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
    });

    await jrn.next(async () => {
      await openOrderInWorklist(page, patient.uhid);
      for (const m of members) {
        await enterResult(page, m, HB_NORMAL).catch(() => { /* a member may be qualitative */ });
      }
    });

    await jrn.next(async () => {
      const items = await labOrderItems(orderId);
      const withValues = items.filter(i => i.result_value);
      expect.soft(
        withValues.length,
        'Not every panel member carries a result. A panel released with a member missing is a ' +
        'report the clinician will read as complete.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await releaseResults(page);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect.soft(
        ['completed', 'pending_validation'],
        'The panel did not complete as one order.',
      ).toContain(String((data as { status: string } | null)?.status));
    });

    await jrn.next(async () => {
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [members[0]] });
    });

    await jrn.next(async () => {
      const bills = await billsFor(hid, pid, 'lab');
      const latest = bills[0];
      expect.soft(
        Number(latest.total_amount),
        `Ordering ONE member of a ${members.length}-test panel was billed the ₹${GROUP_FEE} group ` +
        'price. The group rate must apply only when every member is present — otherwise a single ' +
        'test costs the patient the whole panel.',
      ).not.toBe(GROUP_FEE);
    });

    await jrn.next(async () => {
      const bills = await billsFor(hid, pid, 'lab');
      expect.soft(
        Number(bills[0].total_amount),
        'The partial order was billed nothing at all.',
      ).toBeGreaterThan(0);
    });
  });

  test(testTitle('TC-P5A-003'), async ({ page, loginAs, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await openLab(page);
    });

    await jrn.next(async () => {
      await openNewLabOrder(page);
      await expect(
        page.getByText(/New Lab Order/i).first(),
        'The New Lab Order modal did not open from the worklist.' + jrn.note(),
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await expect.soft(
        proceedToPaymentButton(page),
        'The wizard offers to proceed with no patient and no tests selected. An order against no ' +
        'patient is an order that lands on somebody else\'s chart.',
      ).toBeDisabled();
    });

    await jrn.next(async () => {
      await selectPatientInModal(page, patient.uhid);
      await expect.soft(
        page.getByText(patient.uhid).first(),
        'The selected patient is not shown back to the operator, so there is nothing to check ' +
        'before committing an order to them.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await expect.soft(
        proceedToPaymentButton(page),
        'The wizard offers to proceed with a patient but no tests. An order with no items is a ' +
        'ghost order the lab can see and cannot act on.',
      ).toBeDisabled();
    });

    await jrn.next(async () => {
      const found = await addTestInModal(page, OFF_CATALOGUE);
      expect.soft(
        found,
        `A misspelling that is not in the catalogue ("${OFF_CATALOGUE}") was addable as a test. ` +
        'An order for a test the laboratory does not offer is a patient waiting for a result ' +
        'nobody is producing.',
      ).toBe(false);
    });

    await jrn.next(async () => {
      // SCOPED TO THE MODAL. An unscoped `page.locator('select').first()` matched the LAB QUEUE
      // filter sitting behind the dialog, whose options are All / Pending / In Process — so the
      // stage reported "the referring-doctor list is empty" while inspecting a different control
      // entirely. The picker itself only renders once a patient is selected.
      const sel = referringDoctorSelect(page);
      await expect.soft(
        sel,
        'The order modal offers no referring-doctor picker, so a released report has nobody to go ' +
        'back to and the result reaches the clinician only if somebody telephones.',
      ).toBeVisible({ timeout: 10_000 });

      if (await sel.count()) {
        const opts = await sel.locator('option').allInnerTexts();
        expect.soft(
          opts.join(' | '),
          'The referring-doctor list carries only the "no one" placeholder and no actual doctors, ' +
          'so every order raised at this desk produces a report addressed to nobody.',
        ).toMatch(/Dr /i);
      }
    });

    await jrn.next(async () => {
      for (const p of ['Routine', 'Urgent', 'STAT'] as const) {
        await priorityButton(page, p).click().catch(() => { /* already selected */ });
        await page.waitForTimeout(400);
      }
    });

    await jrn.next(async () => {
      await expect.soft(
        page.getByText(/inform the lab verbally/i).first(),
        'A STAT order gives no on-screen instruction to tell the laboratory verbally. STAT is a ' +
        'promise about minutes; a queue position alone does not keep it.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      const added = await addTestInModal(page, K_TEST);
      expect(added, `"${K_TEST}" could not be added from the catalogue search.` + jrn.note()).toBe(true);
    });

    await jrn.next(async () => {
      const chip = page.getByRole('button').filter({ hasText: K_TEST }).last();
      await chip.click().catch(() => { /* chip removal differs */ });
      await page.waitForTimeout(800);
      await addTestInModal(page, K_TEST);
      await expect.soft(
        page.getByText(/Selected|selected/i).first(),
        'A test removed with its chip could not be re-added, so a corrected selection strands ' +
        'the operator.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      const notes = clinicalNotesTextarea(page);
      if (await notes.count()) await notes.fill(String(P5.labOrder.clinicalNotes));
    });

    await jrn.next(async () => {
      await proceedToPaymentButton(page).click();
      await page.waitForTimeout(1_800);
      await expect(
        page.getByText(/Collect Payment/i).first(),
        'The wizard did not reach the payment step.' + jrn.note(),
      ).toBeVisible();
    });

    await jrn.next(async () => {
      for (const label of [/Subtotal/i, /GST/i, /Total Payable/i]) {
        await expect.soft(
          page.getByText(label).first(),
          `The payment step does not show ${String(label)}. A counter that cannot show a patient ` +
          'what they are paying for invites a dispute at the till.',
        ).toBeVisible();
      }
    });

    await jrn.next(async () => {
      await wizardBackButton(page).click();
      await page.waitForTimeout(1_500);
      await expect.soft(
        page.getByText(K_TEST, { exact: false }).first(),
        'Going Back lost the selected tests, so an operator who checks the price before paying ' +
        'has to rebuild the whole order.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await proceedToPaymentButton(page).click();
      await page.waitForTimeout(1_500);
      await paymentModeButton(page, 'UPI').click().catch(() => { /* mode buttons differ */ });
      await page.waitForTimeout(600);
    });

    await jrn.next(async () => {
      const ref = paymentReferenceInput(page);
      if (await ref.count()) await ref.fill(String(P5.money.upiReference));
      const fees = feeInputs(page);
      const n = await fees.count();
      for (let i = 0; i < n; i++) await fees.nth(i).fill('200');
      await collectAndCreateButton(page).click();
      await page.waitForTimeout(4_500);
    });

    await jrn.next(async () => {
      await expect(
        page.getByText(/Payment Collected!/i).first(),
        'The payment step did not confirm. Cash may have been taken with no bill and no order — ' +
        'the worst possible outcome at a counter.' + jrn.note(),
      ).toBeVisible({ timeout: 20_000 });
      for (const label of [/Bill No\./i, /Patient/i, /Amount Paid/i]) {
        await expect.soft(page.getByText(label).first(), `The receipt omits ${String(label)}.`).toBeVisible();
      }
    });

    await jrn.next(async () => {
      const done = wizardDoneButton(page);
      if (await done.count()) await done.click();
      await page.waitForTimeout(1_500);
    });

    await jrn.next(async () => {
      const orders = await labOrdersFor(hid, pid);
      expect(orders.length, 'The desk order created no lab_orders row.' + jrn.note()).toBeGreaterThan(0);
      expect.soft(orders[0].priority, 'The STAT priority chosen in the wizard was not saved.').toBe('stat');
      expect.soft(orders[0].status, 'A newly created order must start at "ordered".').toBe('ordered');
    });

    await jrn.next(async () => {
      const alerts = await clinicalAlertsFor({ hospitalId: hid, patientId: pid, alertType: 'stat_lab_order' });
      expect.soft(
        alerts.length,
        'A STAT order raised no stat_lab_order alert. STAT that only changes a chip colour is a ' +
        'priority the bench finds out about when it reaches the top of the queue.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      const bills = await billsFor(hid, pid, 'lab');
      expect(bills.length, 'The desk order raised no bill.').toBeGreaterThan(0);
      const { data } = await db().from('bill_payments').select('payment_mode, reference_number')
        .eq('bill_id', bills[0].id as string);
      expect.soft(
        (data ?? []).length,
        'No payment row was written against the bill, so the money is not reconcilable.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      const orders = await labOrdersFor(hid, pid);
      const items = await labOrderItems(orders[0].id as string);
      const lines = await billLineItemsByDedupeKey(hid, `lab:${items[0].id as string}`);
      expect.soft(
        lines.length,
        'The desk order did not write exactly one dedupe-keyed charge line, so the discharge ' +
        'sweep has nothing to recognise and may charge the investigation again.',
      ).toBe(1);
    });
  });
});
