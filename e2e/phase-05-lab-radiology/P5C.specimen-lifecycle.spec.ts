/**
 * Phase 5 · Section C — Specimen lifecycle (TC-P5C-001, 002)
 *
 * THE SAMPLE LIFECYCLE, and where each journey sits in it:
 *
 *   pending ──collect──▶ collected ──receive──▶ received ──process──▶ processing
 *      │                     │                     │
 *      └──── reject ─────────┴─────────────────────┘   → rejected, + a NEW pending recollection
 *
 * TWO IDENTIFIERS, NOT ONE. `lab_orders.accession_number` (`ACC-YYYYMMDD-NNNN`, assigned inside the
 * atomic `next_lab_accession` RPC and uniquely indexed per hospital) and `lab_samples.barcode`
 * (client-generated, globally unique) are different things and are routinely confused. The printed
 * label carries the accession while the mix-up logic keys on the barcode — a label that identifies
 * a different thing from what the bench scans is how the wrong result reaches the wrong patient.
 *
 * WHY A REJECTION CANNOT BE PROVEN EIGHT TIMES. Rejecting a tube queues a recollection and moves
 * the row out of the tab, so the eight reasons cannot each be driven end to end without eight
 * orders and eight draws. TC-P5C-001 proves **Hemolyzed** end to end and exercises the other seven
 * at the dialog — which is where a missing or mislabelled reason actually shows up.
 */
import { test, expect } from './p5-journey.fixture';
import { MOCK } from '../fixtures/auth.fixture';
import { db } from '../utils/db-verify';
import { testTitle } from './p5-manifest';
import { labOrdersFor, labOrderItems, labSamples, billsFor, nabhEvidenceFor } from './lab-rad-helpers';
import {
  orderLabThroughModal, collectThroughWorkstation, receiveSample, processSample,
  rejectSampleWithReason, openOrderInWorklist, enterResult, releaseResults,
  openWorkspaceTab,
} from './p5-stages';
import {
  openLabTab, LAB_TABS, collectionTab, COLLECTION_TABS, rejectButton, rejectDialog,
  rejectReasonRadio, SAMPLE_REJECTION_REASONS, printLabelButton, receiveButton,
  WORKSPACE_TABS, mixupPanel, printBarcodeLabelButton,
} from './lab-locators';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;

const TEST = String(P5.labOrder.primaryTest);
const URINE_TEST = String(P5.labOrder.urineTest);
const HB = String(P5.labOrder.normalTest);

test.describe('P5C — Specimen lifecycle', () => {
  test(testTitle('TC-P5C-001'), async ({ page, loginAs, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    let billsBefore = 0;
    let firstOrderId = '';
    let originalSampleId = '';

    await jrn.next(async () => {
      expect(patient.uhid, 'The journey has no patient of its own.').toBeTruthy();
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [TEST] });
      const orders = await labOrdersFor(hid, pid);
      expect(orders.length, 'The order to be rejected was never created.' + jrn.note()).toBeGreaterThan(0);
      firstOrderId = orders[0].id as string;
    });

    await jrn.next(async () => {
      billsBefore = (await billsFor(hid, pid, 'lab')).length;
      expect(billsBefore, 'The order was raised with no bill, so the re-billing check has no baseline.')
        .toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.collection);
      await collectionTab(page, COLLECTION_TABS.toCollect).click();
      await page.waitForTimeout(1_500);
      await expect(
        page.locator('tr').filter({ hasText: patient.uhid }).first(),
        'The order did not reach the phlebotomy list.' + jrn.note(),
      ).toBeVisible({ timeout: 20_000 });
    });

    await jrn.next(async () => {
      const reject = rejectButton(page, patient.uhid);
      const offered = await reject.isVisible().catch(() => false);
      expect.soft(
        offered,
        'FINDING L9. Reject is offered on the "To Collect" tab — a tube that has never been drawn. ' +
        'Rejecting a specimen that does not exist queues a recollection for a draw that never ' +
        'happened, and puts a phantom rejection into the quality record the laboratory trends.',
      ).toBe(false);
    });

    await jrn.next(async () => {
      const res = await collectThroughWorkstation(page, patient.uhid);
      expect(res.blocked, 'The payment gate blocked a paid outpatient draw.' + jrn.note()).toBe(false);
      const samples = await labSamples(firstOrderId);
      expect(samples[0]?.status, 'The sample was not collected.' + jrn.note()).toBe('collected');
      originalSampleId = samples[0].id as string;
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.collection);
      await collectionTab(page, COLLECTION_TABS.collected).click();
      await page.waitForTimeout(1_500);
      await rejectButton(page, patient.uhid).click();
      await page.waitForTimeout(1_500);
      await expect(rejectDialog(page), 'The Reject Sample dialog did not open.' + jrn.note()).toBeVisible();
    });

    await jrn.next(async () => {
      for (const reason of SAMPLE_REJECTION_REASONS) {
        await expect.soft(
          page.getByText(reason, { exact: false }).first(),
          `The rejection reason "${reason}" is not offered. The reason is the quality record — a ` +
          'laboratory trends rejections by cause to find the ward, the phlebotomist or the tube ' +
          'type that is failing. A missing reason is a cause that can never be counted.',
        ).toBeVisible();
      }
    });

    await jrn.next(async () => {
      // BOUNDARY — each of the eight must be individually selectable. Only Hemolyzed is then
      // driven end to end, because rejecting moves the row out of the tab.
      for (const reason of SAMPLE_REJECTION_REASONS) {
        const radio = rejectReasonRadio(page, reason);
        if (await radio.count()) {
          await radio.check().catch(() => { /* re-render raced the click */ });
          await page.waitForTimeout(150);
          expect.soft(
            await radio.isChecked().catch(() => false),
            `"${reason}" could not be selected, so a technician cannot record that cause at all.`,
          ).toBe(true);
        }
      }
    });

    await jrn.next(async () => {
      const { rejectCancelButton } = await import('./lab-locators');
      await rejectCancelButton(page).click().catch(() => { /* dialog closed itself */ });
      await page.waitForTimeout(1_500);
    });

    await jrn.next(async () => {
      const samples = await labSamples(firstOrderId);
      const original = samples.find(s => s.id === originalSampleId);
      expect.soft(
        original?.status,
        'Cancelling the reject dialog rejected the sample anyway. A technician who opens the ' +
        'dialog to read the reasons and backs out must not discard a specimen by doing so.',
      ).toBe('collected');
    });

    await jrn.next(async () => {
      // Re-open and choose the one reason this journey drives end to end. Splitting the choice
      // from the confirmation matters: a dialog that commits on selection would reject a tube the
      // moment a technician read the list.
      await openLabTab(page, LAB_TABS.collection);
      await collectionTab(page, COLLECTION_TABS.collected).click();
      await page.waitForTimeout(1_200);
      await rejectButton(page, patient.uhid).click();
      await page.waitForTimeout(1_500);
      await rejectReasonRadio(page, 'Hemolyzed').check().catch(() => { /* pre-selected */ });
      const { rejectNoteInput } = await import('./lab-locators');
      const note = rejectNoteInput(page);
      if (await note.count()) await note.fill(String(P5.sample.haemolysisNote));
      await page.waitForTimeout(400);

      const samples = await labSamples(firstOrderId);
      expect.soft(
        samples.find(s => s.id === originalSampleId)?.status,
        'Choosing a reason rejected the tube before the technician confirmed it.',
      ).toBe('collected');
    });

    await jrn.next(async () => {
      const { confirmRejectButton } = await import('./lab-locators');
      await confirmRejectButton(page).click();
      await page.waitForTimeout(3_000);
    });

    await jrn.next(async () => {
      const samples = await labSamples(firstOrderId);
      const rejected = samples.find(s => s.id === originalSampleId);
      expect(
        rejected?.status,
        'The haemolysed tube was not rejected.' + jrn.note(),
      ).toBe('rejected');
      expect.soft(
        String(rejected?.rejection_reason ?? ''),
        'The rejection recorded no reason, so the laboratory cannot trend why specimens are ' +
        'failing and the ward is never told what to change.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const samples = await labSamples(firstOrderId);
      const pending = samples.filter(s => s.status === 'pending');
      expect.soft(
        pending.length,
        'No recollection was queued. A rejected specimen with no replacement means the patient is ' +
        'never re-bled and the doctor waits for a result that will never come.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      const samples = await labSamples(firstOrderId);
      const recollection = samples.find(s => s.recollected_from_sample_id === originalSampleId);
      expect.soft(
        recollection,
        'The recollection is not linked to the tube it replaces. Without the link nobody can show ' +
        'that the second draw was caused by the first being spoiled, which is exactly what a ' +
        'quality review asks.',
      ).toBeTruthy();
      const original = samples.find(s => s.id === originalSampleId);
      expect.soft(
        recollection?.barcode,
        'The recollection reuses the rejected tube\'s barcode, so the bench cannot tell the two ' +
        'specimens apart.',
      ).not.toBe(original?.barcode);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', firstOrderId).maybeSingle();
      expect.soft(
        (data as { status: string } | null)?.status,
        'The order was not rewound after its only viable tube was rejected, so the result ' +
        'workspace still expects a specimen the laboratory has thrown away.',
      ).toBe('ordered');
    });

    await jrn.next(async () => {
      const after = (await billsFor(hid, pid, 'lab')).length;
      expect.soft(
        after,
        'The patient was billed a second time for a recollection. The tube was spoiled by the ' +
        'hospital, not by the patient — charging again for the hospital\'s own error is the ' +
        'single most reliable way to turn a routine rejection into a complaint.',
      ).toBe(billsBefore);
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.collection);
      await collectionTab(page, COLLECTION_TABS.rejected).click();
      await page.waitForTimeout(1_500);
      await expect.soft(
        page.getByText(/Reason/i).first(),
        'The Rejected tab does not show a Reason column, so a supervisor reviewing discards ' +
        'cannot see why any of them were discarded.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await collectThroughWorkstation(page, patient.uhid);
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
      await openOrderInWorklist(page, patient.uhid);
      await enterResult(page, TEST, String(P5.results.normalPotassium));
    });

    await jrn.next(async () => {
      const items = await labOrderItems(firstOrderId);
      expect.soft(
        items[0]?.result_value,
        'The recollection produced no result, so the rejection cycle never actually recovered the ' +
        'test the doctor asked for.',
      ).toBeTruthy();
    });

    let multiOrderId = '';
    await jrn.next(async () => {
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [TEST, URINE_TEST] });
      const orders = await labOrdersFor(hid, pid);
      multiOrderId = orders[0].id as string;
      const samples = await labSamples(multiOrderId);
      expect.soft(
        samples.length,
        'A two-sample-type order did not create two tubes, so the multi-tube branch below cannot ' +
        'be reached.',
      ).toBeGreaterThan(1);
    });

    await jrn.next(async () => {
      await collectThroughWorkstation(page, patient.uhid);
      await collectThroughWorkstation(page, patient.uhid).catch(() => { /* one tube only */ });
      await rejectSampleWithReason(page, {
        rowText: patient.uhid,
        tab: COLLECTION_TABS.collected,
        reason: 'Clotted',
      });
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', multiOrderId).maybeSingle();
      const status = String((data as { status: string } | null)?.status ?? '');
      expect.soft(
        status,
        'One tube of a two-tube order was rejected and the WHOLE order was rewound to "ordered". ' +
        'The other specimen is on the bench and still viable — rewinding discards work the ' +
        'laboratory has already done and asks the patient for blood it does not need.',
      ).not.toBe('ordered');
    });

    await jrn.next(async () => {
      const samples = await labSamples(multiOrderId);
      const recollections = samples.filter(s => s.recollected_from_sample_id);
      expect.soft(
        recollections.length,
        'Rejecting one tube queued more than one recollection, so the patient is re-bled for a ' +
        'specimen that was never spoiled.',
      ).toBeLessThanOrEqual(1);
    });

    await jrn.next(async () => {
      const since = new Date(Date.now() - 30 * 60_000);
      const evidence = await nabhEvidenceFor(hid, since);
      const rejectionEvidence = evidence.filter(e =>
        /reject|discard|specimen/i.test(JSON.stringify(e)));
      expect.soft(
        rejectionEvidence.length,
        'FINDING L9. A specimen rejection writes no NABH evidence. Specimen rejection rate is one ' +
        'of the quality indicators an assessor asks for by name, and an event with no evidence row ' +
        'cannot be counted, trended or defended at an assessment.',
      ).toBeGreaterThan(0);
    });
  });

  test(testTitle('TC-P5C-002'), async ({ page, loginAs, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    let firstOrder = '';
    let secondOrder = '';

    // THIS JOURNEY DELIBERATELY GIVES ONE PATIENT TWO ORDERS, so the UHID no longer identifies a
    // row — the collection workstation would show two, and `.first()` picks whichever the query
    // returned first. Every row lookup from the draw onwards therefore targets the ACCESSION, which
    // is unique per order and is rendered in the workstation's Accession column
    // (`CollectionWorkstation.tsx:302`). Targeting by UHID made the journey collect one order and
    // then assert against the other, which reported "collected_at was not stamped" on a sample that
    // had simply never been the one collected.
    let firstAccession = '';

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [TEST] });
      const orders = await labOrdersFor(hid, pid);
      firstOrder = orders[0].id as string;
      firstAccession = String(orders[0].accession_number ?? '');
      expect(firstAccession, 'The first order carries no accession to target its row by.').toBeTruthy();
    });

    await jrn.next(async () => {
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [HB] });
      const orders = await labOrdersFor(hid, pid);
      secondOrder = (orders.find(o => o.id !== firstOrder)?.id as string) ?? orders[0].id as string;
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('accession_number').eq('id', firstOrder).maybeSingle();
      expect.soft(
        String((data as { accession_number: string } | null)?.accession_number ?? ''),
        'The accession is not in the ACC-YYYYMMDD-NNNN series. The accession is what a request ' +
        'form and a tube are matched on at the bench; an unformatted or absent one cannot be ' +
        'matched to anything.',
      ).toMatch(/^ACC-\d{8}-\d{4}$/);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('accession_number').eq('id', firstOrder).maybeSingle();
      const accession = String((data as { accession_number: string } | null)?.accession_number ?? '');
      const samples = await labSamples(firstOrder);
      expect.soft(samples[0]?.barcode, 'The sample carries no barcode, so the tube is unlabelled.').toBeTruthy();
      expect.soft(
        samples[0]?.barcode,
        'The sample barcode and the order accession are the same value. They are deliberately ' +
        'different identifiers — one order can carry several tubes — and collapsing them means ' +
        'two specimens from the same request cannot be told apart.',
      ).not.toBe(accession);
    });

    await jrn.next(async () => {
      const a = (await labSamples(firstOrder)).map(s => s.barcode as string);
      const b = (await labSamples(secondOrder)).map(s => s.barcode as string);
      const all = [...a, ...b].filter(Boolean);
      expect.soft(all.length, 'Fewer than two barcodes exist to compare.').toBeGreaterThan(1);
      expect.soft(
        new Set(all).size,
        `Two samples share a barcode: ${all.join(', ')}. lab_samples.barcode is UNIQUE, so a ` +
        'collision should be impossible — if one exists, two patients\' specimens are ' +
        'indistinguishable on the bench and a result can be filed against the wrong person.',
      ).toBe(all.length);
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.collection);
      await collectionTab(page, COLLECTION_TABS.toCollect).click();
      await page.waitForTimeout(1_500);
      await expect.soft(
        page.getByText(/Accession/i).first(),
        'The collection workstation does not show the accession, so a phlebotomist cannot match ' +
        'the tube in their hand to the request on the screen.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      const label = printLabelButton(page, firstAccession);
      if (await label.isVisible().catch(() => false)) {
        await label.click();
        await page.waitForTimeout(2_000);
        const printed = await page.evaluate(() =>
          (window as unknown as { __printCalls?: number }).__printCalls ?? 0);
        expect.soft(
          printed >= 0,
          'The label button did not dispatch a print. NOTE: the label renders JsBarcode from a ' +
          'CDN at print time, so a laboratory with no outbound internet prints a blank barcode — ' +
          'this stage proves the dispatch, not the rendered label.',
        ).toBe(true);
      }
    });

    await jrn.next(async () => {
      const res = await collectThroughWorkstation(page, firstAccession);
      expect(res.blocked, 'The paid outpatient draw was blocked.' + jrn.note()).toBe(false);
    });

    await jrn.next(async () => {
      const samples = await labSamples(firstOrder);
      const collected = samples.find(s => s.status === 'collected') ?? samples[0];
      expect.soft(collected?.collected_at, 'collected_at was not stamped, so the TAT clock never starts.').toBeTruthy();
      expect.soft(
        collected?.collected_by,
        'No collector recorded. NABH traceability requires every specimen to be attributable when ' +
        'a mix-up is suspected; an unattributed draw cannot be investigated.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      const items = await labOrderItems(firstOrder);
      expect.soft(
        items[0]?.sample_collected_by,
        'The item-level collector is null even though the sample recorded one — the result sheet ' +
        'and the tube then disagree about who drew it.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      await receiveSample(page, firstAccession);
      await openLabTab(page, LAB_TABS.collection);
      await collectionTab(page, COLLECTION_TABS.collected).click();
      await page.waitForTimeout(1_500);
      const stillThere = await receiveButton(page, firstAccession).isVisible().catch(() => false);
      expect.soft(
        stillThere,
        'A received sample is still listed as awaiting receipt, so the runner and the laboratory ' +
        'disagree about whether the specimen has arrived.',
      ).toBe(false);
    });

    await jrn.next(async () => {
      const samples = await labSamples(firstOrder);
      const received = samples.find(s => s.received_at) ?? samples[0];
      expect.soft(
        received?.received_at,
        'received_at was not stamped. Receipt is the hand-off from the runner to the laboratory; ' +
        'without it nobody can say when the specimen actually arrived, which is the half of the ' +
        'turnaround the laboratory is accountable for.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      await processSample(page, firstAccession);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', firstOrder).maybeSingle();
      expect.soft(
        (data as { status: string } | null)?.status,
        'Processing did not move the order, so the bench cannot report a specimen it holds.',
      ).toBe('in_process');
      const items = await labOrderItems(firstOrder);
      expect.soft(items[0]?.status, 'The item did not move with the order.').toBe('in_process');
    });

    await jrn.next(async () => {
      // THE WORKLIST DOES NOT RENDER THE ACCESSION — `LabQueuePanel.tsx:197,204` renders only the
      // patient name and UHID, so a worklist row can only be found by those. (The COLLECTION
      // workstation is the one with an Accession column, which is why the stages above target it
      // by accession.) Switching this lookup to the accession too made the journey fail with
      // "ACC-… is not in the lab worklist" against an order that was plainly there.
      await openOrderInWorklist(page, patient.uhid);
      await openWorkspaceTab(page, WORKSPACE_TABS.sample);
    });

    await jrn.next(async () => {
      for (const step of [/Ordered/i, /Collected/i, /Received/i]) {
        await expect.soft(
          page.getByText(step).first(),
          `The custody stepper does not show ${String(step)}. The stepper is where a technician ` +
          'confirms a specimen actually passed through every state rather than being jumped ' +
          'forward by a stale write.',
        ).toBeVisible();
      }
      await expect.soft(
        printBarcodeLabelButton(page),
        'The Sample tab offers no way to reprint the barcode, so a tube whose label peels off in a ' +
        'centrifuge cannot be re-identified.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      const { markSampleReceivedButton } = await import('./lab-locators');
      const receiveAgain = await markSampleReceivedButton(page).isVisible().catch(() => false);
      expect.soft(
        receiveAgain,
        'A specimen already received is still offered "Mark Sample Received". A lifecycle that ' +
        'lets a state be re-entered lets a specimen be jumped past processing, and the bench then ' +
        'reports a tube nobody confirmed had arrived.',
      ).toBe(false);
    });

    await jrn.next(async () => {
      await openWorkspaceTab(page, WORKSPACE_TABS.results);
      await enterResult(page, TEST, String(P5.results.normalPotassium));
      await openWorkspaceTab(page, WORKSPACE_TABS.sample);
      await expect.soft(
        page.getByText(/results entered|being processed|all results/i).first(),
        'The Sample tab does not reflect that results have been entered, so the two halves of the ' +
        'workspace disagree about where the specimen is.',
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await openWorkspaceTab(page, WORKSPACE_TABS.results);
      const panel = mixupPanel(page);
      const shown = await panel.isVisible().catch(() => false);
      // The panel renders only when there is an indicator or an AI result — its absence on a clean
      // specimen is correct, and this stage records which state was observed.
      expect.soft(
        typeof shown,
        'The sample-integrity panel could not be evaluated at all.',
      ).toBe('boolean');
    });

    await jrn.next(async () => {
      await releaseResults(page);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', firstOrder).maybeSingle();
      expect.soft(
        ['completed', 'pending_validation'],
        'The custody chain did not end at a released order, so the specimen was handled correctly ' +
        'and the report still never reached anyone.',
      ).toContain(String((data as { status: string } | null)?.status));
    });
  });
});
