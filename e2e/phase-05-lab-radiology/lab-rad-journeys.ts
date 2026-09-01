/**
 * Phase 5 — the complete cross-module journeys, written once.
 *
 * WHY THIS FILE REPLACED THE OLD PER-SECTION HELPERS
 * --------------------------------------------------
 * The first version of Phase 5 split one journey across five sections and re-created the
 * starting state at each boundary with a service-role insert: 5A raised an order, 5B *seeded* an
 * order and collected a sample, 5C *seeded* an order and typed a result, 5D *seeded* again and
 * validated. Every section fabricated what the previous one had just proved, so the suite never
 * walked the chain and never tested the one thing that actually breaks in production — the
 * hand-off between stages.
 *
 * Everything here goes through the browser. No journey may call `seedLabOrder()` or
 * `advanceSamples()`; those remain in `lab-rad-helpers.ts` for 5K/5L only.
 *
 * THE FACT THAT SHAPES EVERY JOURNEY
 * ----------------------------------
 * **Completing an OPD consultation creates NO `lab_orders` row.** This is deliberate — see
 * `ConsultationWorkspace.tsx:1361`:
 *
 *     // Lab / Radiology handoff — PAYMENT FIRST, ORDER SECOND.
 *     // Completing a consultation deliberately creates NO lab_orders / radiology_orders row
 *     // and posts NO charge. The prescription JSON saved just above is the handoff …
 *
 * The prescription lands in `prescriptions.lab_orders` as JSON; the Lab module reads it through
 * `getPendingInvestigations` and lists the patient under **"Pending from OPD"**, where the desk
 * runs the payment wizard that takes the cash and creates the order, already billed, in one
 * step. There is no UI path that skips it. A journey that jumped from "doctor ordered" to "lab
 * has an order" would be testing a transition the product does not have.
 *
 * TWO THINGS THAT SILENTLY BREAK A JOURNEY, both learned the hard way
 * ------------------------------------------------------------------
 *  1. **Result values commit on `onBlur`, not on change** (`LabResultWorkspace.tsx:1439`). A
 *     `fill()` alone updates React state, shows the number on screen and writes nothing. Every
 *     helper here blurs.
 *  2. **"Pending from OPD" is filtered to TODAY only** (`PendingOpdLabTab.tsx:29`). A journey
 *     cannot use a back-dated encounter; the consultation must happen in the same run.
 *
 * Every stage is a `test.step()`, so a journey that fails still names the stage that broke
 * rather than leaving you to infer it from a database assertion three stages downstream.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  registerWalkIn, openTokenAndStart, fillComplaint, addLabTest, completeConsultation,
} from '../phase-04-opd-journey/opd-flows';
import { openOpd, tab } from '../phase-04-opd-journey/opd-locators';
import { MOCK } from '../fixtures/mock-data';

const P5 = MOCK.phase5;

/* ══ Shared, verified locators for the journey ═══════════════════════ */

export const LAB_ROUTE = '/lab';

/** The lab module's top tabs. Text includes the emoji — match on the word. */
export const LAB_TAB = {
  worklist: /Worklist/i,
  collection: /Collection/i,
  pendingOpd: /Pending from OPD/i,
} as const;

/** Collection workstation sub-tabs (`CollectionWorkstation.tsx:51-56`). */
export const COLLECT_TAB = {
  toCollect: /To Collect/i,
  collected: /^\W*Collected/i,
  received: /Received/i,
  rejected: /Rejected/i,
} as const;

/* ══ Making a failed journey diagnose itself ════════════════════════ */

export interface ApiFailure {
  status: number;
  method: string;
  table: string;
  body: string;
}

/**
 * Record every failed PostgREST/Edge call for the life of the page.
 *
 * WHY THIS IS PERMANENT AND NOT DEBUG SCAFFOLDING. A journey spans four modules and a dozen
 * round trips. When one of them 400s, the symptom is always the same on screen — a wizard that
 * does not advance — and the cause is invisible: the response body naming the column, constraint
 * or policy that refused never reaches the test report. Without this, every such failure costs a
 * re-run with hand-added logging, and the `afterEach` purge has usually destroyed the evidence
 * by then.
 *
 * Attach once per test and pass the array into `apiFailureNote()` when asserting.
 */
export function recordApiFailures(page: Page): ApiFailure[] {
  const failures: ApiFailure[] = [];
  page.on('response', res => {
    const url = res.url();
    if (res.status() < 400) return;
    if (!/\/rest\/v1\/|\/functions\/v1\//.test(url)) return;
    const table = url.split('/rest/v1/')[1]?.split('?')[0]
      ?? url.split('/functions/v1/')[1]?.split('?')[0]
      ?? url;
    void res.text().then(
      body => failures.push({
        status: res.status(),
        method: res.request().method(),
        table,
        body: body.slice(0, 400),
      }),
      () => { /* body already consumed */ },
    );
  });
  return failures;
}

/** Render collected API failures for an assertion message. Empty string when there were none. */
export function apiFailureNote(failures: ApiFailure[]): string {
  const writes = failures.filter(f => f.method !== 'GET' && f.method !== 'HEAD');
  const shown = (writes.length ? writes : failures).slice(0, 5);
  if (!shown.length) return '';
  return (
    '\n\nFAILED API CALLS DURING THIS JOURNEY (this is almost always the real cause):\n' +
    shown.map(f => `  ${f.status} ${f.method} ${f.table}\n    ${f.body}`).join('\n')
  );
}

export async function openLabTab(page: Page, name: RegExp): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith(LAB_ROUTE)) {
    await page.goto(LAB_ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_500);
  }
  const t = page.getByRole('button', { name }).first();
  await t.waitFor({ state: 'visible', timeout: 25_000 });
  await t.click();
  await page.waitForTimeout(1_200);
}

/* ══ Stage 1 — the consultation that raises the prescription ════════ */

export interface ConsultationOrders {
  labTests?: string[];
}

/**
 * Register the patient at OPD, run a consultation, prescribe the investigations, complete.
 *
 * Returns the toast text so a journey can assert the hand-off actually announced itself
 * ("N investigation(s) sent for billing"). A chief complaint is MANDATORY — `handleComplete`
 * refuses with "Chief complaint is required" — so it is always filled.
 */
export async function consultAndPrescribe(page: Page, opts: {
  uhid: string;
  patientName: string;
  department: string;
  doctor: string;
  complaint?: string;
  orders: ConsultationOrders;
}): Promise<void> {
  await test.step(`Register ${opts.patientName} at OPD and issue a token`, async () => {
    await registerWalkIn(page, {
      existingPatientQuery: opts.uhid,
      department: opts.department,
      doctor: opts.doctor,
    });
  });

  await test.step('Open the token and start the consultation', async () => {
    await openTokenAndStart(page, opts.patientName);
  });

  await test.step('Record the chief complaint', async () => {
    await fillComplaint(page, opts.complaint ?? String(P5.labOrder.clinicalNotes));
  });

  for (const testName of opts.orders.labTests ?? []) {
    await test.step(`Prescribe ${testName} in Rx & Orders`, async () => {
      await addLabTest(page, testName);
      await expect(
        page.getByText(/Selected \(\d+\)/i).first(),
        `"${testName}" did not appear under Selected. The doctor cannot see what they have ` +
        'ordered before finishing the consultation, and the prescription is what the Lab module ' +
        'reads — nothing downstream happens if this list is empty.',
      ).toBeVisible();
    });
  }

  await test.step('Complete the consultation', async () => {
    await completeConsultation(page);
  });
}

/* ══ Stage 2 — Pending from OPD → payment → the order exists ════════ */

/**
 * Turn the prescription into a real, paid lab order through the desk's payment wizard.
 *
 * This is where the order is actually created. The modal opens with the patient AND the
 * prescribed tests already selected — `NewLabOrderModal.tsx:138-191` — which is why the journey
 * must NOT re-search for the patient. The earlier version of this suite did exactly that: it
 * filled a search box that is not rendered when a patient is preselected, then clicked whatever
 * buttons matched, and ended up selecting four unrelated tests (MCV, MCH, MCHC, RDW) against no
 * patient at all.
 *
 * Returns the bill number from the success screen so the journey can find the charge later.
 */
export async function collectPaymentForPendingLab(page: Page, opts: {
  patientName: string;
  expectTests: string[];
  paymentMode?: RegExp;
  apiFailures?: ApiFailure[];
}): Promise<{ billNumber: string; total: string }> {
  await test.step('Open Pending from OPD and find the patient', async () => {
    await openLabTab(page, LAB_TAB.pendingOpd);
    await expect(
      page.getByText(opts.patientName).first(),
      `${opts.patientName} is not listed under "Pending from OPD". The consultation saved a ` +
      'prescription but the Lab module cannot see it, so the hand-off from OPD to Lab is broken ' +
      'and the patient is standing at a counter nobody has been told to expect them at. NOTE: ' +
      'this tab is filtered to TODAY only (PendingOpdLabTab.tsx:29).',
    ).toBeVisible({ timeout: 20_000 });
  });

  await test.step('Click Create Order to open the payment wizard', async () => {
    const row = page.locator('div').filter({ hasText: opts.patientName });
    await row.getByRole('button', { name: /create order/i }).last().click();
    await page.waitForTimeout(1_800);
    await expect(
      page.getByText(/New Lab Order/i).first(),
      'The New Lab Order modal did not open.',
    ).toBeVisible();
  });

  await test.step('The prescribed tests and the patient are carried into the order', async () => {
    // The patient arrives PRESELECTED — assert the card, never re-search.
    await expect(
      page.getByText(opts.patientName).first(),
      'The modal did not carry the patient across from the pending row, so the desk would have ' +
      'to identify them again by hand — which is how an order ends up on the wrong chart.',
    ).toBeVisible();

    for (const t of opts.expectTests) {
      await expect(
        page.getByText(t, { exact: false }).first(),
        `"${t}" was prescribed but did not arrive preselected in the order. The pre-fill matches ` +
        'lab_test_master.test_name EXACTLY (case-insensitively, trimmed) — a prescribed name ' +
        'that is not a verbatim catalogue entry falls into the amber "not found in lab catalog" ' +
        'block and is silently not ordered.',
      ).toBeVisible();
    }
  });

  await test.step('Proceed to payment', async () => {
    await page.getByRole('button', { name: /proceed to payment/i }).first().click();
    await page.waitForTimeout(1_500);
    await expect(
      page.getByText(/Collect Payment/i).first(),
      'The wizard did not reach the payment step.',
    ).toBeVisible();
  });

  const total = await test.step('Price every test, then take the cash', async () => {
    // Any test with no configured rate renders an editable "Enter fee" box; an unpriced test
    // would otherwise be billed at ₹0 and the journey would prove nothing about money.
    const feeInputs = page.getByPlaceholder(/enter fee/i);
    const n = await feeInputs.count();
    for (let i = 0; i < n; i++) await feeInputs.nth(i).fill('200');
    if (n) await page.waitForTimeout(600);

    await page.getByRole('button', { name: opts.paymentMode ?? /Cash/i }).first().click();
    await page.waitForTimeout(400);

    const payBtn = page.getByRole('button', { name: /collect ₹.*create order/i }).first();
    const label = (await payBtn.innerText()).trim();
    await payBtn.click();
    await page.waitForTimeout(4_000);
    return label;
  });

  const billNumber = await test.step('Confirm the payment receipt', async () => {
    await expect(
      page.getByText(/Payment Collected!/i).first(),
      'The payment step did not confirm. Cash may have been taken with no bill and no order — ' +
      'the worst possible outcome at a counter.' + apiFailureNote(opts.apiFailures ?? []),
    ).toBeVisible({ timeout: 20_000 });

    const receipt = await page.getByText(/LAB-\d+/i).first().innerText().catch(() => '');
    await page.getByRole('button', { name: /^done$/i }).first().click();
    await page.waitForTimeout(1_500);
    return receipt.trim();
  });

  return { billNumber, total };
}

/* ══ Stage 3 — phlebotomy ═══════════════════════════════════════════ */

/**
 * Draw the sample through the Collection workstation, clearing the two-identifier check.
 *
 * `Collect` does not collect — it opens `PatientIdentityConfirmDialog`, whose confirm button
 * stays disabled until the "I have verified the patient's identity…" checkbox is ticked. That
 * checkbox has no `id`/`htmlFor`, so `getByLabel` cannot find it; it is located by input type
 * inside the dialog.
 */
export async function collectSampleThroughWorkstation(page: Page, patientName: string): Promise<void> {
  await test.step('Draw the sample at the collection workstation', async () => {
    await openLabTab(page, LAB_TAB.collection);
    await page.getByRole('button', { name: COLLECT_TAB.toCollect }).first().click();
    await page.waitForTimeout(1_200);

    const row = page.locator('tr').filter({ hasText: patientName }).first();
    await expect(
      row,
      `${patientName} is not on the "To Collect" list. Paying for a test must put the patient in ` +
      'front of the phlebotomist; if it does not, the sample is never drawn and the patient goes ' +
      'home believing the test was done.',
    ).toBeVisible({ timeout: 20_000 });

    await row.getByRole('button', { name: /^collect$/i }).click();
    await page.waitForTimeout(1_200);
  });

  await test.step('Confirm patient identity with two identifiers', async () => {
    const dialog = page.getByRole('dialog').filter({ hasText: /Verify Patient Identity/i }).first();
    await expect(
      dialog,
      'No identity confirmation was required before drawing blood. Two-identifier verification ' +
      'at the bedside is the control that stops a sample being drawn from the wrong patient — ' +
      'a wrong-blood-in-tube event is a sentinel event.',
    ).toBeVisible({ timeout: 15_000 });

    await dialog.locator('input[type="checkbox"]').first().check();
    const confirm = dialog.getByRole('button', { name: /confirm & collect/i });
    await expect(
      confirm,
      'The confirm button should only enable once identity has been attested.',
    ).toBeEnabled();
    await confirm.click();
    await page.waitForTimeout(2_000);
  });
}

export async function receiveAndProcess(page: Page, patientName: string): Promise<void> {
  await test.step('Receive the sample into the laboratory', async () => {
    await openLabTab(page, LAB_TAB.collection);
    await page.getByRole('button', { name: COLLECT_TAB.collected }).first().click();
    await page.waitForTimeout(1_200);
    await page.locator('tr').filter({ hasText: patientName }).first()
      .getByRole('button', { name: /^receive$/i }).click();
    await page.waitForTimeout(2_000);
  });

  await test.step('Start processing on the bench', async () => {
    await page.getByRole('button', { name: COLLECT_TAB.received }).first().click();
    await page.waitForTimeout(1_200);
    await page.locator('tr').filter({ hasText: patientName }).first()
      .getByRole('button', { name: /^process$/i }).click();
    await page.waitForTimeout(2_000);
  });
}

/* ══ Stage 4 — result, acknowledgement, release ═════════════════════ */

export async function openOrderInWorklist(page: Page, patientName: string): Promise<void> {
  await test.step('Open the order in the result workspace', async () => {
    await openLabTab(page, LAB_TAB.worklist);
    const filter = page.locator('select').filter({ hasText: /Pending Validation|In Process/i }).first();
    if (await filter.count()) {
      await filter.selectOption({ label: 'All' }).catch(() => { /* already unfiltered */ });
      await page.waitForTimeout(1_000);
    }
    const row = page.getByRole('button').filter({ hasText: patientName }).first();
    await expect(
      row,
      `${patientName} is not in the lab worklist. NOTE: LabPage filters on today's order_date ` +
      'AND excludes billing_status = "unbilled", so an order whose charge failed is invisible here.',
    ).toBeVisible({ timeout: 20_000 });
    await row.click();
    await page.waitForTimeout(2_000);
  });
}

/**
 * Type a result and let it persist.
 *
 * THE BLUR IS THE SAVE. `onBlur` is what calls `saveResult` — a `fill()` with no blur shows the
 * value on screen and writes nothing, so a test that skipped it would pass while proving the
 * opposite of what it claims.
 */
export async function enterResult(page: Page, testName: string, value: string): Promise<void> {
  await test.step(`Enter ${testName} = ${value}`, async () => {
    const input = page.locator('tr, [role="row"], div')
      .filter({ hasText: testName })
      .locator('input[type="number"]')
      .first();
    await input.waitFor({ state: 'visible', timeout: 20_000 });
    await input.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
    await input.fill(value);
    await input.press('Tab');          // <- the commit
    await page.waitForTimeout(2_000);
  });
}

export async function acknowledgeCriticalValue(page: Page): Promise<void> {
  await test.step('Acknowledge the critical value after telephoning the doctor', async () => {
    const banner = page.getByText(/Critical Value — Notify Treating Doctor Immediately/i).first();
    await expect(
      banner,
      'No critical banner appeared, so nothing prompts the technician to pick up the phone.',
    ).toBeVisible({ timeout: 15_000 });

    await page.locator('label').filter({ hasText: /I have notified the treating doctor/i })
      .locator('input[type="checkbox"]').first().check();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Acknowledge & Continue/i }).first().click();
    await page.waitForTimeout(2_000);
  });
}

/** Release the report. Handles both the single-step and the dual-validation shapes. */
export async function releaseResults(page: Page): Promise<string> {
  return test.step('Release the report', async () => {
    const release = page.getByRole('button', { name: /validate & release/i }).first();
    const submit = page.getByRole('button', { name: /submit for validation/i }).first();

    if (await release.isVisible().catch(() => false)) {
      await release.click();
    } else if (await submit.isVisible().catch(() => false)) {
      await submit.click();
    } else {
      throw new Error(
        'Neither "Validate & Release" nor "Submit for Validation" is offered. Release is gated ' +
        'by allResultsEntered, unacknowledged criticals, a QC reject state and a sample-mixup ' +
        'flag — check which one is holding it.',
      );
    }
    await page.waitForTimeout(3_000);
    return (await page.locator('[role="status"], [data-sonner-toast]').first()
      .innerText().catch(() => '')).trim();
  });
}

/* ══ Stage 5 — the chart the treating doctor reads ══════════════════ */

/**
 * Assert the released result reached the OPD chart.
 *
 * `/opd` → the patient's token → the `🧪 Reports` tab renders `InvestigationResultsPanel`, a
 * table with headers Test / Result / Ref. Range / Flag. This is the whole point of the phase: a
 * result the laboratory can see and the treating doctor cannot is a phone call, not a record.
 */
export async function expectResultOnChart(page: Page, opts: {
  patientName: string;
  testName: string;
  value: string;
}): Promise<void> {
  await test.step('The treating doctor sees the result on the chart', async () => {
    await openOpd(page);
    await page.getByRole('button').filter({ hasText: opts.patientName }).first().click();
    await page.waitForTimeout(2_500);

    await tab(page, /Reports/i).click();
    await page.waitForTimeout(3_000);

    await expect(
      page.getByText(opts.testName, { exact: false }).first(),
      `"${opts.testName}" is not on the patient's Reports tab. The laboratory released it and ` +
      'the treating doctor cannot see it, so the result reaches them only if somebody telephones.',
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      page.getByText(opts.value, { exact: false }).first(),
      `The result value ${opts.value} is not shown on the chart alongside the test name.`,
    ).toBeVisible();
  });
}
