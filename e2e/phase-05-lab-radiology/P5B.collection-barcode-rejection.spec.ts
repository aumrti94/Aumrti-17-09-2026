/**
 * Phase 5 · Section B — Sample collection, barcoding & rejection (P5-S05, P5-S06 🔴)
 * Locks tracker cases TC-P5B-001 … TC-P5B-012
 *
 * THE SAMPLE LIFECYCLE, and where each case sits in it:
 *
 *   pending ──collect──▶ collected ──receive──▶ received ──process──▶ processing
 *      │                     │                     │
 *      └──── reject ─────────┴─────────────────────┘   → rejected, + a NEW pending recollection
 *
 * TWO IDENTIFIERS, NOT ONE. `lab_orders.accession_number` (ACC-YYYYMMDD-NNNN, from the atomic
 * `next_lab_accession` RPC, uniquely indexed per hospital) and `lab_samples.barcode` (client
 * generated `BC-<epoch>-<4 rand>`, globally UNIQUE, not hospital-scoped) are different things
 * and are routinely confused. The printed label carries the ACCESSION, while the mix-up logic
 * keys on the SAMPLE barcode — TC-P5B-004 pins that down, because a label that identifies a
 * different thing from what the bench scans is how the wrong result reaches the wrong patient.
 *
 * 🔴 REJECTION AND RE-BILLING (P5-S06). `rejectSample` (src/lib/labSamples.ts:124-176) rejects
 * the tube, queues a linked recollection carrying `recollected_from_sample_id`, and rewinds the
 * ORDER to `ordered` — but ONLY when no other sample of that order is still viable. It never
 * touches bills, billing_status or payment_status, so a recollection is free by construction.
 * TC-P5B-007 proves the patient is not charged twice; TC-P5B-008 proves the multi-tube branch,
 * which is the one a single-tube test would never reach.
 *
 * NOTE FOR ANYONE ADDING A LABEL-PRINTING CASE: the print button opens a `window.open` popup
 * that fetches JsBarcode from cdn.jsdelivr.net and calls `window.print()`
 * (CollectionWorkstation.tsx:130-166). It needs `context.on('page')` handling and outbound
 * internet. TC-P5B-005 asserts the barcode DATA rather than the rendered label for that reason,
 * and TC-P5B-006 records the CDN dependency itself as the finding it is.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedLabOrder, advanceSamples, labSamples, labOrderById, labOrderItems, billsFor,
  purgeLabRadArtefacts,
} from './lab-rad-helpers';
import { openLab, LAB_TABS, COLLECTION_TABS } from './lab-locators';
import { collectSample, rejectSample, receiveSample, processSample } from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const DOCTOR = MOCK.doctorFees[0].doctor;
const TEST = String(P5.labOrder.primaryTest);
const SECOND_TEST = String(P5.labOrder.urineTest);

async function seedCollectableOrder(testNames: string[] = [TEST]): Promise<{
  hid: string; pid: string; doctorId: string; orderId: string; accession: string | null;
}> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, UHID);
  const doctorId = await userIdByName(hid, DOCTOR);
  await purgeLabRadArtefacts(hid, [pid]);
  const seeded = await seedLabOrder({
    hospitalId: hid, patientId: pid, orderedBy: doctorId,
    testNames, billingStatus: 'billed',
  });
  return { hid, pid, doctorId, orderId: seeded.orderId, accession: seeded.accessionNumber };
}

test.describe('P5B — Collection, barcoding & rejection', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
  });

  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, UHID)]);
  });

  /* ── P5-S05 · Collection & barcoding ────────────────────────────────── */

  test('TC-P5B-001 Phlebotomy journey: a pending sample is collected through the workstation and the whole order moves with it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { orderId } = await seedCollectableOrder();

    const before = await labSamples(orderId);
    expect(before.length, 'The seeded order has no sample to collect.').toBeGreaterThan(0);
    expect(before[0].status, 'A newly created sample must start at "pending".').toBe('pending');

    const result = await collectSample(page, NAME);
    expect(
      result.blocked,
      'The pre-payment gate fired on a post-paid tenant. checkLabOrderClearance should clear ' +
      'immediately when the policy is post_paid; a gate that fires anyway stops every ward draw.',
    ).toBe(false);

    const after = await labSamples(orderId);
    expect(
      after[0].status,
      'The sample was not moved to "collected". The phlebotomist has drawn blood the system ' +
      'still believes is waiting, so the next shift draws it again.',
    ).toBe('collected');
    expect(after[0].collected_at, 'collected_at was not stamped, so the TAT clock never starts.').toBeTruthy();

    const order = await labOrderById(orderId);
    expect(
      order?.status,
      'The sample is collected but the ORDER is still "ordered". LabResultWorkspace will refuse ' +
      'a result until the order has moved, so the bench cannot report what it has in hand.',
    ).toBe('sample_collected');
  });

  test('TC-P5B-002 Collection stamps who drew the sample, not just when', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedCollectableOrder();

    await collectSample(page, NAME);

    const samples = await labSamples(orderId);
    expect(
      samples[0].collected_by,
      'collected_by is null. NABH traceability requires the collector to be identifiable for ' +
      'every specimen; an unattributed draw cannot be investigated when a mix-up is suspected.',
    ).toBeTruthy();

    const items = await labOrderItems(orderId);
    expect(
      items[0].sample_collected_by,
      'The item-level collector is null even though the sample recorded one — the result sheet ' +
      'and the tube then disagree about who drew it.',
    ).toBeTruthy();
  });

  test('TC-P5B-003 Receipt and processing move the sample through the bench without skipping a state', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedCollectableOrder();

    await collectSample(page, NAME);
    await receiveSample(page, NAME);
    let samples = await labSamples(orderId);
    expect(
      samples[0].status,
      'The sample was not moved to "received". Receipt is the hand-off from the runner to the ' +
      'laboratory; without it nobody can say when the specimen actually arrived.',
    ).toBe('received');
    expect(samples[0].received_at, 'received_at was not stamped.').toBeTruthy();

    await processSample(page, NAME);
    samples = await labSamples(orderId);
    expect(samples[0].status, 'The sample was not moved to "processing".').toBe('processing');

    const order = await labOrderById(orderId);
    expect(
      order?.status,
      'Processing a sample must move the order to "in_process" — the worklist counts and the TAT ' +
      'dashboard both read the order status, not the sample.',
    ).toBe('in_process');
  });

  test('TC-P5B-004 The order accession and the sample barcode are distinct identifiers, and both are present', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId, accession } = await seedCollectableOrder();
    const samples = await labSamples(orderId);

    expect(
      accession,
      'The order carries no accession number, so nothing links the request to the tube.',
    ).toMatch(/^ACC-\d{8}-\d{4}$/);

    expect(
      String(samples[0].barcode ?? ''),
      'The sample carries no barcode. lab_samples.barcode is what the bench scans and what the ' +
      'wrong-blood-in-tube logic keys on; without it a specimen is identified only by position ' +
      'in a rack.',
    ).not.toBe('');

    expect(
      samples[0].barcode,
      'The sample barcode is identical to the order accession. They are deliberately different ' +
      'identifiers — one order can carry several tubes — and collapsing them means two specimens ' +
      'from the same request cannot be told apart.',
    ).not.toBe(accession);
  });

  test('TC-P5B-005 Every sample barcode in the tenant is unique, so no two tubes can be confused', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { orderId: first } = await seedCollectableOrder();
    const pid = await patientIdByUhid(hid, UHID);
    const doctorId = await userIdByName(hid, DOCTOR);
    const second = await seedLabOrder({
      hospitalId: hid, patientId: pid, orderedBy: doctorId,
      testNames: [SECOND_TEST], billingStatus: 'billed',
    });

    const barcodes = [
      ...(await labSamples(first)).map(s => s.barcode as string),
      ...(await labSamples(second.orderId)).map(s => s.barcode as string),
    ].filter(Boolean);

    expect(barcodes.length, 'Fewer than two samples were created to compare.').toBeGreaterThan(1);
    expect(
      new Set(barcodes).size,
      `Two samples share a barcode: ${barcodes.join(', ')}. lab_samples.barcode is UNIQUE, so a ` +
      'collision should be impossible — if one exists, two patients\' specimens are ' +
      'indistinguishable on the bench and a result can be filed against the wrong person.',
    ).toBe(barcodes.length);
  });

  test('TC-P5B-006 The printed label renders from an external CDN, so a lab with no outbound internet prints a blank barcode', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await seedCollectableOrder();

    // Block the CDN and prove the label has nothing to fall back on. This is a real hospital
    // condition, not a synthetic one: phlebotomy counters and ward side-rooms are exactly where
    // outbound internet is missing or a CSP is strictest.
    let cdnRequested = false;
    await page.route('**/cdn.jsdelivr.net/**', route => {
      cdnRequested = true;
      return route.abort();
    });

    const popupPromise = page.context().waitForEvent('page', { timeout: 15_000 }).catch(() => null);
    const { openLabTab, printLabelButton } = await import('./lab-locators');
    await openLabTab(page, LAB_TABS.collection);
    const label = printLabelButton(page, NAME);
    if (await label.count()) await label.click().catch(() => { /* popup blocked is itself a result */ });
    const popup = await popupPromise;
    await page.waitForTimeout(2_500);
    await popup?.close().catch(() => { /* already gone */ });

    expect(
      cdnRequested,
      'FINDING L12. The label markup loads JsBarcode from cdn.jsdelivr.net at print time ' +
      '(CollectionWorkstation.tsx:137) with no local copy and no fallback. On a hospital network ' +
      'without outbound internet — or behind a CSP — the popup prints a label with no barcode on ' +
      'it, and the tube goes to the bench identified only by handwriting. Bundle the library ' +
      'locally. If this assertion is false the dependency has been removed and the finding is ' +
      'closed; update the case rather than deleting it.',
    ).toBe(true);
  });

  /* ── P5-S06 · Rejection & recollection 🔴 ───────────────────────────── */

  test('TC-P5B-007 Haemolysed sample journey: rejected, recollection queued, order rewound, and the patient is NOT charged again', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid, orderId } = await seedCollectableOrder();

    await collectSample(page, NAME);
    const billsBefore = await billsFor(hid, pid, 'lab');
    const samplesBefore = await labSamples(orderId);
    const rejectedId = samplesBefore[0].id as string;

    await rejectSample(page, {
      rowText: NAME,
      fromTab: COLLECTION_TABS.collected,
      reason: String(P5.sample.rejectionReasonHaemolysed),
      note: String(P5.sample.rejectionNote),
    });

    const after = await labSamples(orderId);
    const rejected = after.find(s => s.id === rejectedId);
    const recollection = after.find(s => s.recollected_from_sample_id === rejectedId);

    expect(
      rejected?.status,
      'The haemolysed tube was not marked rejected, so it stays in the collected queue and the ' +
      'bench may still run it — a haemolysed potassium reads falsely high and can trigger ' +
      'treatment for a hyperkalaemia the patient does not have.',
    ).toBe('rejected');
    expect(
      String(rejected?.rejection_reason ?? ''),
      'No rejection reason was stored. NABL requires the reason for every rejected specimen, and ' +
      'without it the lab cannot show a rejection-rate trend at assessment.',
    ).toContain(String(P5.sample.rejectionReasonHaemolysed));

    expect(
      recollection,
      'No recollection sample was queued. The order is now rejected with nothing pending, so the ' +
      'patient goes home believing the test was done and nobody ever draws it again.',
    ).toBeTruthy();
    expect(recollection?.status, 'The recollection was not queued as "pending".').toBe('pending');

    const order = await labOrderById(orderId);
    expect(
      order?.status,
      'The order was not rewound to "ordered" after its only sample was rejected, so the ' +
      'recollection has no request behind it in the worklist.',
    ).toBe('ordered');

    const billsAfter = await billsFor(hid, pid, 'lab');
    expect(
      billsAfter.length,
      'A recollection created a SECOND lab bill. The patient is being charged twice because the ' +
      'laboratory spoiled the first specimen — that is the hospital\'s cost, never the ' +
      'patient\'s, and it is the single thing this scenario exists to prevent.',
    ).toBe(billsBefore.length);
  });

  test('TC-P5B-008 A multi-tube order with one tube rejected stays in progress — only the spoiled tube is redrawn', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedCollectableOrder([TEST, SECOND_TEST]);

    const seededSamples = await labSamples(orderId);
    test.skip(
      seededSamples.length < 2,
      `This case needs two sample types on one order; the catalogue produced ${seededSamples.length}. ` +
      `Check that "${TEST}" and "${SECOND_TEST}" still have different sample_type values in lab_test_master.`,
    );

    await collectSample(page, NAME);
    // Leave the second tube viable by advancing it independently.
    await advanceSamples({ orderId, to: 'received', byUserId: seededSamples[0].collected_by as string ?? '' })
      .catch(() => { /* the UI collection above already moved them */ });

    const before = await labSamples(orderId);
    const target = before[0].id as string;

    await rejectSample(page, {
      rowText: NAME,
      fromTab: COLLECTION_TABS.received,
      reason: String(P5.sample.rejectionReasonQns),
    });

    const order = await labOrderById(orderId);
    expect(
      order?.status,
      'One tube of a two-tube order was rejected and the WHOLE order was rewound to "ordered". ' +
      'rejectSample only rewinds when no other sample is still viable (labSamples.ts:162-173) — ' +
      'rewinding regardless means the surviving specimen is redrawn for no reason, which is an ' +
      'extra needle in a patient who did not need one.',
    ).not.toBe('ordered');

    const after = await labSamples(orderId);
    const recollection = after.find(s => s.recollected_from_sample_id === target);
    expect(
      recollection,
      'The rejected tube got no recollection even though the order continued. That test is now ' +
      'silently missing from a report the doctor will read as complete.',
    ).toBeTruthy();
  });

  test('TC-P5B-009 A rejection reason is mandatory — a sample cannot be rejected with no reason recorded', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedCollectableOrder();
    await collectSample(page, NAME);

    const { openLabTab, rejectButton, confirmRejectButton } = await import('./lab-locators');
    await openLabTab(page, LAB_TABS.collection);
    await page.getByRole('button', { name: COLLECTION_TABS.collected }).first().click();
    await page.waitForTimeout(1_000);
    await rejectButton(page, NAME).click();
    await page.waitForTimeout(900);

    // Confirm without choosing a reason.
    const confirm = confirmRejectButton(page);
    if (await confirm.isEnabled().catch(() => false)) {
      await confirm.click();
      await page.waitForTimeout(1_800);
    }

    const after = await labSamples(orderId);
    const rejected = after.find(s => s.status === 'rejected');
    if (rejected) {
      expect(
        String(rejected.rejection_reason ?? '').trim(),
        'A sample was rejected with an empty reason. NABL requires a documented cause for every ' +
        'rejection; a blank one cannot be trended, cannot be fed back to the ward that drew it, ' +
        'and reads at assessment as a lab that does not know why it discards specimens.',
      ).not.toBe('');
    }
  });

  test('TC-P5B-010 A sample that has never been drawn cannot be rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedCollectableOrder();

    const before = await labSamples(orderId);
    expect(before[0].status, 'The seeded sample should still be pending.').toBe('pending');

    const { openLabTab, rejectButton } = await import('./lab-locators');
    await openLabTab(page, LAB_TABS.collection);
    await page.getByRole('button', { name: COLLECTION_TABS.toCollect }).first().click();
    await page.waitForTimeout(1_000);

    const reject = rejectButton(page, NAME);
    const offered = await reject.isVisible().catch(() => false);

    expect(
      offered,
      'FINDING L9. The Reject control is rendered on the "To Collect" tab ' +
      '(CollectionWorkstation.tsx:344-353), so a specimen nobody has drawn can be rejected — ' +
      'which immediately queues a recollection for a draw that never happened, inflates the ' +
      'rejection rate the lab reports at assessment, and describes an event that did not occur. ' +
      'Rejection is a judgement about a specimen in hand; it cannot apply before one exists.',
    ).toBe(false);
  });

  test('TC-P5B-011 The recollection is traceably linked to the tube it replaces', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedCollectableOrder();
    await collectSample(page, NAME);

    const before = await labSamples(orderId);
    const originalId = before[0].id as string;
    const originalBarcode = String(before[0].barcode ?? '');

    await rejectSample(page, {
      rowText: NAME,
      fromTab: COLLECTION_TABS.collected,
      reason: String(P5.sample.rejectionReasonHaemolysed),
    });

    const after = await labSamples(orderId);
    const recollection = after.find(s => s.id !== originalId && s.status === 'pending');

    expect(recollection, 'No recollection was created to link.').toBeTruthy();
    expect(
      recollection!.recollected_from_sample_id,
      'The recollection does not point back at the tube it replaces. Without that link the lab ' +
      'cannot show an assessor why a specimen was drawn twice, and a repeat-draw audit reads as ' +
      'two unexplained punctures.',
    ).toBe(originalId);
    expect(
      String(recollection!.barcode ?? ''),
      `The recollection barcode ("${recollection!.barcode}") should derive from the original ` +
      `("${originalBarcode}") so the pair is recognisable on the bench.`,
    ).not.toBe(originalBarcode);
  });

  test('TC-P5B-012 A sample rejection writes no NABH evidence, so the quality record has no trace of it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, orderId } = await seedCollectableOrder();
    const since = new Date(Date.now() - 60_000);

    await collectSample(page, NAME);
    await rejectSample(page, {
      rowText: NAME,
      fromTab: COLLECTION_TABS.collected,
      reason: String(P5.sample.rejectionReasonHaemolysed),
      note: String(P5.sample.rejectionNote),
    });

    const after = await labSamples(orderId);
    expect(after.some(s => s.status === 'rejected'), 'Nothing was rejected, so there is nothing to log.').toBe(true);

    const { data: evidence } = await db().from('nabh_evidence_log')
      .select('id, standard_code, description')
      .eq('hospital_id', hid).gte('created_at', since.toISOString());

    const rejectionEvidence = (evidence ?? []).filter(e =>
      /reject/i.test(String((e as { description?: string }).description ?? '')));

    expect(
      rejectionEvidence.length,
      'FINDING L9. logNABHEvidence is not imported by labSamples.ts or CollectionWorkstation.tsx ' +
      'at all, so a rejected specimen leaves no quality-record entry. Evidence is logged for ' +
      'ordering, QC override and auto-verification but not for the one event an assessor asks ' +
      'about by name — specimen rejection rate is a standing NABL/NABH indicator, and a lab that ' +
      'cannot produce the underlying events cannot evidence the number it reports.',
    ).toBeGreaterThan(0);
  });
});
