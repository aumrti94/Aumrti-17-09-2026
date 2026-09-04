/**
 * Phase 4 · Section G — Orders out to Lab & Radiology (P4-S12, P4-S13 🔴)
 * Locks tracker cases TC-P4G-001 … TC-P4G-022
 *
 * The point of Phase 4: what the doctor types in the Rx & Orders tab has to become a real
 * order in another module.
 *
 * PAYMENT FIRST, ORDER SECOND. Completing a consultation creates NO order row. It saves the
 * prescription; the Lab/Radiology module lists the patient under "Pending from OPD" and the desk
 * takes the cash, which is what creates the order — already paid and billed — in one step.
 * Every case below that asserts an order exists therefore calls `collectPendingLabFromOpd` /
 * `collectPendingRadiologyFromOpd` after `completeConsultation`.
 *
 * These cases used to assert the order straight after completion, because the consultation
 * created it directly. That was the defect: `postCharge` resolves payment_status from
 * admissionId, absent on the OPD path, so every test landed as "pending_payment" on an UNPAID
 * bill while the order was simultaneously stamped billing_status:"billed", billed:true — and the
 * lab drew the sample on the strength of a payment nobody had taken. It also starved the module
 * meant to collect: `getPendingInvestigations` subtracts already-ordered tests, so nothing was
 * ever left in "Pending from OPD".
 *
 * The chip in the Rx tab now has three states — PRESCRIBED → AWAITING PAYMENT → BILLED & ORDERED
 * — so it can no longer claim a payment it cannot back (TC-P4G-007, TC-P4G-021).
 *
 * TWO ASYMMETRIES AND A STATUTORY GAP:
 *
 *   1. AN UNMATCHED LAB TEST IS SILENTLY DROPPED. `syncLabOrders` matches
 *      `lab_test_master.test_name` exactly (case-insensitively) and pushes anything else onto
 *      `unmatched` — no order, no charge, only an amber banner. SETTINGS_PREREQ_MATRIX.md:55
 *      flags this; TC-P4G-009 proves it. Revenue leaks with no error anywhere.
 *
 *   2. AN UNMATCHED RADIOLOGY STUDY IS ORDERED ANYWAY. `syncRadiologyOrders` has no `unmatched`
 *      concept — it falls back to a default modality and creates the order regardless. The two
 *      sibling functions handle the same failure in opposite directions (TC-P4G-020).
 *
 *   3. 🔴 BUG-P4-002 / BUG-P4-003 (TC-P4G-016/017/018) — NO PCPNDT FORM F ON THE OPD PATH.
 *      Form F used to be created in exactly ONE place — `NewRadiologyOrderModal` — guarded by
 *          isObstetricUsg = modalityType === "usg" && name.toLowerCase().includes("obstetric")
 *      `syncRadiologyOrders`, the function an OPD consultation actually calls, created neither
 *      a `pcpndt_form_f` row nor even the `is_pcpndt` flag. So the commonest way to order an
 *      obstetric scan in the product generated no Form F at all. And the trigger itself was a
 *      substring of a free-text label, so "USG Pregnancy Profile" was missed even on the path
 *      that had one. Under the PCPNDT Act a Form F is mandatory for EVERY obstetric ultrasound
 *      and its absence is a criminal exposure, not a data-quality issue.
 *      FIXED: the determination now lives in `src/lib/pcpndt.ts` and is called by BOTH paths.
 *      It keys on `radiology_study_master.requires_form_f` (migration 20261013000019, with a
 *      backfill) and falls back to a broadened keyword list restricted to ultrasound modalities.
 *      TC-P4G-016/017/018 are REGRESSION LOCKS and are expected to PASS; TC-P4G-019 guards the
 *      false-positive side, because a register padded with non-obstetric scans is its own problem.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow } from '../utils/db-verify';
import { openOpd, tab, billedAndOrderedChip, prescribedChip, testsNotFoundBanner } from './opd-locators';
import { registerWalkIn, openTokenAndStart, fillComplaint, addLabTest, completeConsultation } from './opd-flows';
import { patientIdByUhid, purgeOpdArtefacts } from './opd-helpers';
import {
  collectPendingLabFromOpd, collectPendingRadiologyFromOpd,
} from '../phase-05-lab-radiology/p5-stages';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const ORDERS = P4.orders as Record<string, string | string[]>;
const DOCTOR = MOCK.doctorFees[0].doctor;
const DEPARTMENT = MOCK.doctorFees[0].department;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const PREGNANT_UHID = 'PT-QA-0012';
const PREGNANT_NAME = 'Deepa Nair';

const labNames = ORDERS.labTests as string[];

async function freshConsultation(page: import('@playwright/test').Page, uhid = UHID, name = NAME) {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  await purgeOpdArtefacts(hid, [pid]);
  await registerWalkIn(page, { existingPatientQuery: uhid, department: DEPARTMENT, doctor: DOCTOR });
  await openTokenAndStart(page, name);
  await fillComplaint(page, P4.consultation.chiefComplaint);
  return { hid, pid };
}

async function addRadiologyStudy(page: import('@playwright/test').Page, studyName: string): Promise<void> {
  await tab(page, /Rx & Orders/i).click();
  await page.waitForTimeout(900);
  const { radiologySearchInput } = await import('./opd-locators');
  const input = radiologySearchInput(page);
  if (await input.count()) {
    await input.fill(studyName);
    await page.waitForTimeout(1200);
    const suggestion = page.getByRole('button').filter({ hasText: new RegExp(studyName.replace(/[()]/g, '.'), 'i') }).first();
    if (await suggestion.count()) await suggestion.click();
    else await page.getByRole('button', { name: '+' }).last().click();
  } else {
    await page.getByRole('button').filter({ hasText: new RegExp(studyName.replace(/[()]/g, '.'), 'i') }).first().click();
  }
  await page.waitForTimeout(1000);
}

async function labOrdersFor(hospitalId: string, patientId: string) {
  const { data } = await db().from('lab_orders')
    .select('id, encounter_id, clinical_notes, billing_status, payment_status, lab_order_items(id, test_id)')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function radiologyOrdersFor(hospitalId: string, patientId: string) {
  const { data } = await db().from('radiology_orders').select('*')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId);
  return (data ?? []) as Array<Record<string, unknown>>;
}

test.describe('P4G — Orders out to Lab & Radiology', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('doctor', { hospital: 'A' });
    await openOpd(page);
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    for (const uhid of [UHID, PREGNANT_UHID]) {
      await purgeOpdArtefacts(hid, [await patientIdByUhid(hid, uhid)]);
    }
  });

  /* ── The catalogues ────────────────────────────────────────────────── */

  test('TC-P4G-001 Lab test chips are rendered from the lab test master', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await freshConsultation(page);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(1200);
    await expect(
      page.getByText(labNames[0]).first(),
      'The lab chips are empty. SETTINGS_PREREQ_MATRIX.md: no lab_test_master rows means the ' +
      'doctor has nothing to click, types free text instead, and every test is then silently dropped.',
    ).toBeVisible();
  });

  test('TC-P4G-002 Radiology study chips are rendered from the radiology study master', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(1200);
    await expect(
      page.getByText(String(ORDERS.plainStudy)).first(),
      'The radiology chips are empty — same prerequisite failure as the lab chips.',
    ).toBeVisible();
  });

  test('TC-P4G-003 Selecting a lab test moves it into the Selected list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await expect(
      page.getByText(/Selected \(\d+\)/i).first(),
      'The chosen test did not appear in the Selected list, so the doctor cannot see what they ' +
      'have actually ordered before finishing the consultation.',
    ).toBeVisible();
  });

  /* ── The lab handoff (P4-S12) ──────────────────────────────────────── */

  test('TC-P4G-004 A test prescribed in OPD becomes a real lab_orders row once it is paid for', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    const orders = await labOrdersFor(hid, pid);
    expect(
      orders.length,
      'The doctor ordered a test and no lab_orders row exists. The patient goes to the ' +
      'phlebotomy counter and the lab has no idea they are coming.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4G-005 The lab order carries a line item for the test that was ordered', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    const orders = await labOrdersFor(hid, pid);
    expect(orders.length).toBeGreaterThan(0);
    const items = (orders[0].lab_order_items ?? []) as unknown[];
    expect(
      items.length,
      'A lab order header was created with no items — a "ghost order" the lab can see but not ' +
      'act on, because nothing says which test to run.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4G-006 The lab order is linked back to the OPD encounter that raised it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    const enc = await expectRow<{ id: string }>('opd_encounters', { hospital_id: hid, patient_id: pid });
    const orders = await labOrdersFor(hid, pid);
    expect(
      orders[0].encounter_id,
      'The lab order has no encounter_id. The result comes back attached to nothing, so it never ' +
      'appears in the chart the doctor reviews.',
    ).toBe(enc.id);
  });

  test('TC-P4G-007 The Rx chip reads PRESCRIBED before payment and BILLED & ORDERED after', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);

    const reopenRxTab = async () => {
      await openOpd(page);
      await page.getByRole('button').filter({ hasText: NAME }).first().click();
      await page.waitForTimeout(2000);
      await tab(page, /Rx & Orders/i).click();
      await page.waitForTimeout(1800);
    };

    await reopenRxTab();
    await expect(
      prescribedChip(page).first(),
      'Straight after completion the chip must read PRESCRIBED. No money has been taken and no ' +
      'order row exists, so anything stronger is a claim the app cannot back — which is exactly ' +
      'what "BILLED & ORDERED" was doing here before payment-first ordering.',
    ).toBeVisible();
    await expect(
      billedAndOrderedChip(page),
      'The chip claimed BILLED before the cashier had collected anything.',
    ).toHaveCount(0);

    await collectPendingLabFromOpd(page, NAME);

    await reopenRxTab();
    await expect(
      billedAndOrderedChip(page).first(),
      'The chip never flipped to BILLED & ORDERED after payment was collected. That badge is the ' +
      'doctor\'s only visual proof the handoff to the lab actually happened — without it they ' +
      'cannot tell a real order from a note to themselves.',
    ).toBeVisible();
  });

  test('TC-P4G-008 Two tests ordered together become ONE order holding both', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await addLabTest(page, labNames[1]);
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    const orders = await labOrdersFor(hid, pid);
    const itemCount = orders.reduce((n, o) => n + ((o.lab_order_items as unknown[]) ?? []).length, 0);
    expect(
      itemCount,
      `Two tests were ordered and ${itemCount} line item(s) reached the lab. The missing one is ` +
      `both an untreated patient and an uncollected fee.`,
    ).toBeGreaterThanOrEqual(2);

    // REGRESSION LOCK: syncLabOrders used to call create_lab_order_with_items INSIDE its
    // per-test loop, so one visit produced one lab_orders header per test — its own accession,
    // its own sample, its own card in the worklist. A patient with four tests appeared four
    // times and the phlebotomist drew blood four times. The RPC has always taken p_items as an
    // array; only the caller was wrong.
    expect(
      orders.length,
      `Two tests produced ${orders.length} separate lab orders. A patient's visit is ONE order ` +
      `holding every test — separate orders mean separate accessions, separate tubes and a lab ` +
      `worklist that cannot tell one visit from four.`,
    ).toBe(1);
  });

  // WAS: "A test name not in the catalogue is silently dropped from the order", which pinned
  // the defect rather than the requirement. `offCatalogueTest` is "Compleet Blood Kount" — a
  // MISSPELLING of a test this hospital does offer, not a test it does not. Dropping it was
  // never correct behaviour; it is the revenue leak pendingInvestigations.ts measures.
  //
  // Resolution now runs in three local tiers (exact → alias → token/phonetic fuzzy) in both
  // the Rx & Orders tab and syncLabOrders itself, so the misspelling reaches the lab as the
  // real test. TC-P4G-010 below covers the case this one used to: a name that genuinely is
  // not in the catalogue.
  test('TC-P4G-009 A misspelled catalogue test is resolved and ordered, not dropped', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, String(ORDERS.offCatalogueTest));
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    const orders = await labOrdersFor(hid, pid);
    const itemCount = orders.reduce((n, o) => n + ((o.lab_order_items as unknown[]) ?? []).length, 0);
    expect(
      itemCount,
      `"${ORDERS.offCatalogueTest}" is a misspelling of a test this hospital offers. It was ` +
      `dropped for as long as matching was exact-name-only: the doctor believed it was ordered, ` +
      `the lab never saw it, and nobody was billed. If this is 0 again, the resolver has stopped ` +
      `reaching syncLabOrders and the leak is back.`,
    ).toBeGreaterThan(0);
  });

  test('TC-P4G-010 A test the hospital genuinely does not offer still gets the amber banner', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page);
    await addLabTest(page, String(ORDERS.trulyOffCatalogueTest));
    await completeConsultation(page);
    await openOpd(page);
    await page.getByRole('button').filter({ hasText: NAME }).first().click();
    await page.waitForTimeout(2000);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(1800);

    const banner = await testsNotFoundBanner(page).count();
    expect(
      banner,
      'A test that is genuinely not in the catalogue showed no warning at all. Fuzzy matching ' +
      'must not swallow the signal: a test nobody can perform has to say so, or the doctor ' +
      'believes it was ordered and the patient is never told to go elsewhere.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4G-010b A panel prescribed with a redundant word resolves, and says what it matched', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // The reported defect verbatim: "Fever panel test" rendered "Not offered here — Prescribed
    // test not found in the lab catalogue" while Fever Panel was on screen as an orderable
    // panel chip. Two bugs at once — panels were never consulted by the catalogue check, and
    // the trailing "test" put the name under the fuzzy threshold.
    await freshConsultation(page);
    await addLabTest(page, String(ORDERS.redundantWordTest));
    await page.waitForTimeout(2500);

    await expect(
      testsNotFoundBanner(page),
      'A panel the hospital offers was reported as missing from the catalogue.',
    ).toHaveCount(0);

    await expect(
      page.getByText(new RegExp(`matched from\\s*[“"']${ORDERS.redundantWordTest}`, 'i')).first(),
      'The name was rewritten on the doctor\'s behalf with nothing on screen saying so. An ' +
      'auto-selection that raises a charge has to be visible and undoable.',
    ).toBeVisible();
  });

  test('TC-P4G-011 A catalogue test typed in lower case still matches', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0].toLowerCase());
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    const orders = await labOrdersFor(hid, pid);
    const itemCount = orders.reduce((n, o) => n + ((o.lab_order_items as unknown[]) ?? []).length, 0);
    expect(
      itemCount,
      'A lower-case spelling of a catalogue test was dropped. The match is documented as ' +
      'case-insensitive; if it has become case-sensitive, ordinary typing habits now lose orders.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4G-012 Ordering the same test twice in one encounter does not duplicate it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);
    await openOpd(page);
    await page.getByRole('button').filter({ hasText: NAME }).first().click();
    await page.waitForTimeout(2000);
    const { resumeConsultationButton } = await import('./opd-locators');
    if (await resumeConsultationButton(page).count()) {
      await resumeConsultationButton(page).click();
      await page.waitForTimeout(1800);
    }
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    const orders = await labOrdersFor(hid, pid);
    const itemCount = orders.reduce((n, o) => n + ((o.lab_order_items as unknown[]) ?? []).length, 0);
    expect(
      itemCount,
      `The same test was ordered twice for one encounter and produced ${itemCount} items. The ` +
      `patient is bled twice and charged twice for one investigation.`,
    ).toBe(1);
  });

  test('TC-P4G-013 A sample with a barcode is created alongside the lab order', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    const orders = await labOrdersFor(hid, pid);
    expect(orders.length).toBeGreaterThan(0);
    const { data } = await db().from('lab_samples').select('barcode').eq('lab_order_id', orders[0].id as string);
    expect(
      data?.length,
      'No lab_samples row was created with the order. The phlebotomist has no barcode to print, ' +
      'so the tube that reaches the analyser cannot be tied back to this patient.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4G-014 The lab order records the clinical indication the doctor gave', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    const orders = await labOrdersFor(hid, pid);
    expect(orders.length).toBeGreaterThan(0);
    expect(
      'clinical_notes' in orders[0],
      'lab_orders has no clinical_notes column to carry the indication. A pathologist reporting a ' +
      'result with no clinical context cannot interpret a borderline value.',
    ).toBeTruthy();
  });

  /* ── The radiology handoff & PCPNDT (P4-S13 🔴) ────────────────────── */

  test('TC-P4G-015 A radiology study ordered in OPD creates a radiology_orders row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addRadiologyStudy(page, String(ORDERS.plainStudy));
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingRadiologyFromOpd(page, NAME);

    const orders = await radiologyOrdersFor(hid, pid);
    expect(
      orders.length,
      'The doctor ordered a chest X-ray and radiology never received it.',
    ).toBeGreaterThan(0);
    expect(orders[0].encounter_id, 'The radiology order is not linked to the encounter.').toBeTruthy();
  });

  test('TC-P4G-016 An obstetric ultrasound ordered in OPD creates a PCPNDT Form F', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page, PREGNANT_UHID, PREGNANT_NAME);
    await addRadiologyStudy(page, String(ORDERS.obstetricStudy));
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingRadiologyFromOpd(page, PREGNANT_NAME);

    const orders = await radiologyOrdersFor(hid, pid);
    expect(orders.length, 'The obstetric scan produced no radiology order at all.').toBeGreaterThan(0);

    const { data } = await db().from('pcpndt_form_f').select('id').eq('order_id', orders[0].id as string);
    expect(
      data?.length ?? 0,
      'REGRESSION LOCK (BUG-P4-002, fixed — P1, LEGAL): an obstetric ultrasound ordered from the ' +
      'OPD consultation created NO PCPNDT Form F. syncRadiologyOrders must call ' +
      'requiresPcpndtFormF() from src/lib/pcpndt.ts and insert the pcpndt_form_f row. Check that ' +
      'migration 20261013000019 has been applied and that the study carries requires_form_f. ' +
      'Under the PCPNDT Act a Form F is mandatory for EVERY obstetric ultrasound; its absence is ' +
      'a criminal exposure for the hospital and the radiologist, not a reporting gap.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4G-017 An obstetric ultrasound order is flagged is_pcpndt', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page, PREGNANT_UHID, PREGNANT_NAME);
    await addRadiologyStudy(page, String(ORDERS.obstetricStudy));
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingRadiologyFromOpd(page, PREGNANT_NAME);

    const orders = await radiologyOrdersFor(hid, pid);
    expect(orders.length).toBeGreaterThan(0);
    expect(
      orders[0].is_pcpndt,
      'REGRESSION LOCK (BUG-P4-002, fixed): the order is not FLAGGED as PCPNDT. Without the flag ' +
      'the register cannot find the scan retrospectively either, so there is no way to reconcile ' +
      'a shortfall before an inspection finds it.',
    ).toBe(true);
  });

  test('TC-P4G-018 An obstetric study whose name omits the word "obstetric" still creates a Form F', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page, PREGNANT_UHID, PREGNANT_NAME);
    await addRadiologyStudy(page, String(ORDERS.obstetricStudyVariant));
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingRadiologyFromOpd(page, PREGNANT_NAME);

    const orders = await radiologyOrdersFor(hid, pid);
    expect(orders.length).toBeGreaterThan(0);
    const { data } = await db().from('pcpndt_form_f').select('id').eq('order_id', orders[0].id as string);
    expect(
      data?.length ?? 0,
      `REGRESSION LOCK (BUG-P4-003, fixed): "${ORDERS.obstetricStudyVariant}" is clinically an ` +
      `obstetric scan whose name does not contain the word "obstetric". It must be caught by ` +
      `radiology_study_master.requires_form_f — the flag is what makes the trigger independent ` +
      `of a hospital's naming conventions — or, failing that, by the "pregnan" keyword fallback ` +
      `in src/lib/pcpndt.ts. If this fails, check the study is seeded with requires_form_f = true.`,
    ).toBeGreaterThan(0);
  });

  test('TC-P4G-019 A non-obstetric ultrasound must NOT create a Form F', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addRadiologyStudy(page, String(ORDERS.nonObstetricStudy));
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingRadiologyFromOpd(page, NAME);

    const orders = await radiologyOrdersFor(hid, pid);
    expect(orders.length).toBeGreaterThan(0);
    const { data } = await db().from('pcpndt_form_f').select('id').eq('order_id', orders[0].id as string);
    expect(
      data?.length ?? 0,
      'An abdominal ultrasound created a PCPNDT Form F. False positives are their own problem: a ' +
      'register padded with non-obstetric scans is unusable at inspection and invites scrutiny ' +
      'the hospital does not need.',
    ).toBe(0);
  });

  test('TC-P4G-020 An off-catalogue radiology study is ordered anyway, unlike a lab test', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addRadiologyStudy(page, 'Zzz Imaging Study 999');
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingRadiologyFromOpd(page, NAME);

    const orders = await radiologyOrdersFor(hid, pid);
    expect(
      orders.length,
      'CURRENT BEHAVIOUR: syncRadiologyOrders has no "unmatched" concept — it falls back to a ' +
      'default modality and creates the order regardless, where syncLabOrders would have dropped ' +
      'it silently. The two sibling functions handle the same failure in OPPOSITE directions, so ' +
      'a doctor cannot form one mental model of what happens to a mistyped investigation.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4G-021 A lab order raised in OPD exists only once it is paid for', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // REGRESSION LOCK, both directions.
    //
    // BUG-P4-009 was that an OPD order stayed "unbilled" forever, invisible to the Lab worklist
    // (it filters .neq("billing_status","unbilled")) and to "Pending from OPD" alike. The fix
    // for it — charge at consultation completion — overshot: postCharge has no admissionId on
    // this path, so it wrote "pending_payment" onto an UNPAID bill while stamping the order
    // billing_status:"billed". The order claimed to be paid for and was not.
    //
    // Under payment-first both failures are unreachable: no order exists before the cashier
    // collects, and the one that exists afterwards is genuinely paid. This case asserts both
    // halves, so neither regression can come back alone.
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);

    expect(
      (await labOrdersFor(hid, pid)).length,
      'A lab order was created by completing the consultation, before anyone had been asked to ' +
      'pay. The lab will draw the sample on the strength of a payment nobody collected.',
    ).toBe(0);

    await collectPendingLabFromOpd(page, NAME);

    const orders = await labOrdersFor(hid, pid);
    expect(
      orders.length,
      'Payment was collected and no lab order came out of it. The patient has paid for an ' +
      'investigation the lab has never heard of.',
    ).toBeGreaterThan(0);
    expect(
      orders[0].billing_status,
      'The paid order is not marked billed, so nothing tells the billing module this ' +
      'investigation happened. Unbilled investigations are the largest single source of OPD ' +
      'revenue leakage.',
    ).toBe('billed');
    expect(
      orders[0].payment_status,
      'The order was created by the Collect Payment step but is not marked paid. Every ' +
      'downstream gate — sample collection, study start — reads this column.',
    ).toBe('paid');
  });

  test('TC-P4G-022 A lab technician can see the order the OPD doctor raised', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page);
    await addLabTest(page, labNames[0]);
    await completeConsultation(page);
    // Payment is what creates the order — see the header note.
    await collectPendingLabFromOpd(page, NAME);

    await logout();
    await loginAs('lab_technician', { hospital: 'A' });
    await page.goto('/lab', { waitUntil: 'domcontentloaded' });
    // A full logout -> re-login -> navigate cycle is slower than an in-session tab switch;
    // 3s was too tight and raced the orders fetch (same class of cold-start latency as
    // openOpd/consultationFee elsewhere in this suite).
    await page.waitForTimeout(6000);

    const orders = await labOrdersFor(hid, pid);
    expect(orders.length, 'No lab order exists to be seen.').toBeGreaterThan(0);
    await expect(
      page.getByText(NAME).first(),
      'The lab technician cannot see the patient the OPD doctor just ordered a test for. The ' +
      'cross-module handoff is the whole point of this phase — an order nobody in the lab can ' +
      'see is a piece of paper the patient has to carry.',
    ).toBeVisible();
  });
});
