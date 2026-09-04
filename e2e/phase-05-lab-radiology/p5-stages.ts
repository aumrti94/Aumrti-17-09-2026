/**
 * Phase 5 — the stage library. Every action a journey performs, through the browser.
 *
 * THE CONTRACT, AND IT IS NOT NEGOTIABLE
 * --------------------------------------
 * **A stage never asserts product behaviour.** It asserts only that the control it needs is on the
 * screen, then acts. Every claim about whether the product is *right* belongs in the spec, next to
 * the sentence explaining what it costs a hospital when it is wrong. A stage that starts asserting
 * correctness becomes a second, invisible place where coverage lives, and the journey stops being
 * readable as a story.
 *
 * WHY THIS FILE REPLACED THE OLD PER-SECTION HELPERS
 * --------------------------------------------------
 * The first version of Phase 5 split one journey across five sections and re-created the starting
 * state at each boundary with a service-role insert: 5A raised an order, 5B *seeded* an order and
 * collected a sample, 5C *seeded* an order and typed a result, 5D *seeded* again and validated.
 * Every section fabricated what the previous one had just proved, so the suite never walked the
 * chain and never tested the one thing that actually breaks in production — the hand-off between
 * stages.
 *
 * It also replaced `lab-rad-flows.ts`, which was a second library for the same actions with a
 * different contract: two `openLabTab`, two `enterResult` (one committing with `.blur()`, one with
 * `.press('Tab')`), two `toastText`. Two ways to save a result is one way too many, and "which one
 * actually writes" was the most common question asked of this suite.
 *
 * Everything here goes through the browser. A service-role write is permitted only under the three
 * conditions documented in `p5-seed-of-last-resort.ts`.
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
import { test, expect, type Page, type Locator } from '@playwright/test';
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


/**
 * Click a control, or report that it was DISABLED rather than waiting out the action timeout.
 *
 * Half the negative stages in this phase press a submit button on a deliberately-empty form and
 * expect the product to refuse. When the product refuses by disabling the button — which is the
 * better refusal — a bare `.click()` waits the full 15s actionability timeout and then throws
 * `locator.click: Timeout exceeded`. The journey records a click failure at the exact moment the
 * product did the right thing, and the run reads as a defect.
 *
 * Returns what actually happened so the caller can assert on it.
 */
export async function clickIfEnabled(
  locator: Locator,
  opts: { timeout?: number } = {},
): Promise<'clicked' | 'disabled' | 'absent'> {
  const timeout = opts.timeout ?? 5_000;
  if (!(await locator.isVisible({ timeout }).catch(() => false))) return 'absent';
  if (!(await locator.isEnabled().catch(() => false))) return 'disabled';
  await locator.click();
  return 'clicked';
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
    // USE THE SHARED, ROW-SCOPED LOCATOR. This function used to carry its own copy —
    // `page.locator('tr, [role="row"], div').filter({ hasText }).locator('input[type=number]').first()`
    // — which matches an ANCESTOR containing every test in the order and then takes the first
    // number input in it. On a three-test order every value was typed into the first row: potassium
    // came back 11.2 flagged CH while haemoglobin stayed null, and the journey reported a
    // reference-range defect that did not exist. Fixing `resultInput` alone did nothing, because
    // this copy is what the journeys actually call.
    const input = resultInput(page, testName);
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

/**
 * Release the report. Handles the single-step shape, the dual-validation shape, and the case where
 * there is nothing left to release.
 *
 * AUTO-VERIFICATION IS A LEGITIMATE THIRD OUTCOME. A normal result on an `autoverify_eligible` test
 * is released by `evaluateAutoVerify` the moment it is entered, so by the time a journey reaches
 * this stage neither button exists — the order is already `reported`. The first version threw
 * there, which turned the auto-verification working correctly into a 15-second click timeout at
 * the release stage. Returning a marker lets the caller's own DB assertion decide whether the order
 * actually advanced, which is the question that matters either way.
 */
export async function releaseResults(page: Page): Promise<string> {
  return test.step('Release the report', async () => {
    const release = page.getByRole('button', { name: /validate & release/i }).first();
    const submit = page.getByRole('button', { name: /submit for validation/i }).first();

    // ENABLED, not merely visible. Both controls stay rendered but disabled while a critical is
    // unacknowledged, QC is in a reject state, or a mix-up flag is open — and `.click()` on a
    // disabled button waits the full action timeout and then reports a click failure, which reads
    // as a broken locator rather than as the gate doing exactly its job.
    const canRelease = (await release.isVisible().catch(() => false))
      && (await release.isEnabled().catch(() => false));
    const canSubmit = (await submit.isVisible().catch(() => false))
      && (await submit.isEnabled().catch(() => false));

    // The click itself is given a SHORT budget and its timeout is caught. Entering a result on an
    // auto-verify-eligible test releases the order and re-renders the footer, so a button that was
    // enabled a moment ago can detach mid-click. That is the product working, and it must not be
    // reported as a 15-second click failure at the release stage.
    if (canRelease) {
      try {
        await release.click({ timeout: 6_000 });
      } catch {
        return 'already released: the release control went away mid-click (auto-verified)';
      }
    } else if (canSubmit) {
      try {
        await submit.click({ timeout: 6_000 });
      } catch {
        return 'already released: the submit control went away mid-click';
      }
    } else {
      // Either auto-verified already, or genuinely gated. `validated`/`reported` badges tell them
      // apart; the caller asserts the order status regardless.
      const alreadyOut = await page
        .getByText(/auto-verified|✓ Validated|✓ Reported|Report released/i).first()
        .isVisible().catch(() => false);
      return alreadyOut
        ? 'already released: auto-verified, no manual release offered'
        : 'blocked: neither Validate & Release nor Submit for Validation is offered — release is ' +
          'gated by allResultsEntered, an unacknowledged critical, a QC reject state or a ' +
          'sample-mixup flag';
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

/* ══════════════════════════════════════════════════════════════════════
 * Stages added for the journey rewrite.
 *
 * Everything below drives a surface that the previous suite either faked with a service-role
 * insert or never touched at all: the New Lab Order modal end to end, sample receipt and
 * processing as separate acts, rejection with a chosen reason, the QC dashboard, NABL calibration,
 * the analyzer interface, histopathology, and the ancillary-payment settings screen.
 *
 * The contract from this file's header still holds: a stage asserts only that the control it needs
 * is present, then acts. Whether the product did the RIGHT thing is the spec's claim to make.
 * ══════════════════════════════════════════════════════════════════════ */

import {
  LAB_TABS, openLab as openLabPage, openLabTab as openLabTabL,
  newLabOrderButton, patientSearchInput, labTestSearchInput, priorityButton,
  clinicalNotesTextarea, referringDoctorSelect, proceedToPaymentButton, collectAndCreateButton,
  createOrdersIpdButton, paymentModeButton, paymentReferenceInput, wizardDoneButton, feeInputs,
  collectionTab, COLLECTION_TABS, collectButton, receiveButton, processButton, rejectButton,
  identityVerifiedCheckbox, confirmAndCollectButton,
  rejectReasonRadio, rejectNoteInput, confirmRejectButton, rejectCancelButton,
  type SampleRejectionReason,
  paymentPendingDialog, overrideReasonInput, overrideConfirmButton,
  workspaceTab, WORKSPACE_TABS, textResultSelect, saveAllButton, labNotesTextarea,
  recordQcButton, qcTestNameInput, qcAnalyzerInput, qcValueInput, qcMeanInput, qcSdInput,
  saveQcEntryButton, qcOverrideOpenButton, qcOverrideReasonTextarea, qcOverrideConfirmButton,
  addCalibrationButton, calibrationAnalyzerInput, calibrationDeviationInput,
  calibrationCalibratedByInput, saveCalibrationButton,
  addAnalyzerButton, analyzerNameInput, analyzerManufacturerInput, analyzerHostInput,
  analyzerSecretInput, saveAnalyzerButton, analyzerMappingsButton, mappingCodeInput,
  mappingNameInput, mappingAddButton,
  pathologyRegisterButton, pathologyPatientSearch, pathologySpecimenTypeInput,
  pathologySpecimenSiteInput, pathologyClinicalHistoryInput, registerSpecimenButton,
  pathologyField, pathologySaveDraftButton,
  newReferralButton, referralLabNameInput, referralPhoneInput, referralAddressInput,
  referralTestsInput, createReferralButton, referralAdvanceButton,
  toastText as labToastText, resultInput,
} from './lab-locators';
import { openRadiology, RADIOLOGY_TABS, toastText as radToastText2 } from './radiology-locators';

/* ── Phase 4 compatibility ────────────────────────────────────────────── */

/**
 * Raise the order a consultation prescribed, from the module's "Pending from OPD" tab.
 *
 * `P4G.orders-lab-radiology.spec.ts` imports both of these — Phase 4 asserts that a consultation's
 * prescription REACHES the lab, and the only way to see the resulting order row is to let the desk
 * create it. They lived in `lab-rad-flows.ts`; that file was deleted as a duplicate library, so
 * they live here now with the same behaviour and the same names.
 */
async function collectPendingFromOpd(
  page: Page,
  module: 'lab' | 'radiology',
  patientText: string,
): Promise<string> {
  if (module === 'lab') {
    await openLabTabL(page, LAB_TABS.pendingOpd);
  } else {
    await openRadiology(page);
    await page.getByRole('tab', { name: RADIOLOGY_TABS.pendingOpd }).first().click().catch(async () => {
      await page.getByRole('button', { name: RADIOLOGY_TABS.pendingOpd }).first().click();
    });
  }
  await page.waitForTimeout(1_200);

  const row = page.locator('div').filter({ hasText: new RegExp(patientText, 'i') });
  const createBtn = row.getByRole('button', { name: /create order/i }).last();
  await createBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await createBtn.click();
  await page.waitForTimeout(1_500);

  const proceed = proceedToPaymentButton(page);
  if (await proceed.count()) {
    await proceed.click();
    await page.waitForTimeout(1_200);
  }

  const collect = collectAndCreateButton(page);
  await collect.waitFor({ state: 'visible', timeout: 15_000 });
  await collect.click();
  return module === 'lab' ? await labToastText(page) : await radToastText2(page);
}

export async function collectPendingLabFromOpd(page: Page, patientText: string): Promise<string> {
  await openLabPage(page);
  return collectPendingFromOpd(page, 'lab', patientText);
}

export async function collectPendingRadiologyFromOpd(page: Page, patientText: string): Promise<string> {
  return collectPendingFromOpd(page, 'radiology', patientText);
}

/* ── The New Lab Order modal, driven end to end ───────────────────────── */

export interface LabOrderThroughModal {
  /** Typed into the patient search — the UHID, because it is unique per case. */
  uhid: string;
  tests: string[];
  priority?: 'Routine' | 'Urgent' | 'STAT';
  clinicalNotes?: string;
  /** Leave undefined to keep whatever the modal defaulted to. */
  referringDoctor?: string;
  paymentMode?: 'Cash' | 'UPI' | 'Card' | 'NEFT';
  paymentReference?: string;
  /** Price any test the catalogue has no rate for, so nothing is billed at ₹0 by accident. */
  fallbackFee?: string;
  /** An admitted patient under post-paid: the primary button charges the advance instead. */
  expectChargeToAdvance?: boolean;
  /** Stop after selecting tests, for a case asserting the wizard REFUSES to go on. */
  stopBeforeProceed?: boolean;
}

/** Open the modal from the worklist. Separate so a case can assert its initial disabled state. */
export async function openNewLabOrder(page: Page): Promise<void> {
  await openLabTabL(page, LAB_TABS.worklist);
  const btn = newLabOrderButton(page);
  await btn.waitFor({ state: 'visible', timeout: 20_000 });
  await btn.click();
  await page.waitForTimeout(1_500);
}

/** Search and select the patient inside an already-open modal. */
export async function selectPatientInModal(page: Page, uhid: string): Promise<void> {
  const search = patientSearchInput(page);
  await search.waitFor({ state: 'visible', timeout: 15_000 });
  await search.fill(uhid);
  await page.waitForTimeout(1_800);
  const hit = page.getByRole('button').filter({ hasText: uhid }).first();
  if (await hit.count()) await hit.click().catch(() => { /* auto-selected on a single match */ });
  await page.waitForTimeout(900);
}

/** Add one catalogue test by name inside an already-open modal. Returns whether it was found. */
export async function addTestInModal(page: Page, testName: string): Promise<boolean> {
  const search = labTestSearchInput(page);
  if (await search.count()) {
    await search.fill(testName);
    await page.waitForTimeout(1_400);
  }
  const chip = page.getByRole('button')
    .filter({ hasText: new RegExp(testName.replace(/[()]/g, '.'), 'i') }).first();
  if (!(await chip.count())) return false;
  await chip.click();
  await page.waitForTimeout(800);
  return true;
}

/**
 * The whole desk-order wizard: patient, tests, priority, notes, payment, receipt.
 *
 * This is the path the previous suite never drove — every lab order in Phase 5 was a service-role
 * insert through `create_lab_order_with_items`, so the modal that a receptionist actually uses,
 * with its validation and its pricing step, was entirely unproven.
 */
export async function orderLabThroughModal(
  page: Page,
  opts: LabOrderThroughModal,
): Promise<{ billNumber: string; payLabel: string }> {
  await openNewLabOrder(page);
  await selectPatientInModal(page, opts.uhid);

  for (const t of opts.tests) await addTestInModal(page, t);

  if (opts.priority) {
    await priorityButton(page, opts.priority).click().catch(() => { /* already selected */ });
    await page.waitForTimeout(400);
  }

  if (opts.referringDoctor) {
    await referringDoctorSelect(page)
      .selectOption({ label: opts.referringDoctor })
      .catch(() => { /* the doctor list differs on this tenant */ });
  }

  if (opts.clinicalNotes) {
    const notes = clinicalNotesTextarea(page);
    if (await notes.count()) await notes.fill(opts.clinicalNotes);
  }

  if (opts.stopBeforeProceed) return { billNumber: '', payLabel: '' };

  // Under post-paid IPD the primary button charges the advance and there is no payment step.
  if (opts.expectChargeToAdvance) {
    const ipd = createOrdersIpdButton(page);
    await ipd.waitFor({ state: 'visible', timeout: 15_000 });
    await ipd.click();
    await page.waitForTimeout(4_000);
    return { billNumber: '', payLabel: 'charged to advance' };
  }

  await proceedToPaymentButton(page).click();
  await page.waitForTimeout(1_500);

  // An unpriced test renders an editable "Enter fee" box; left blank it bills ₹0 and the journey
  // would prove nothing about money.
  const fees = feeInputs(page);
  const n = await fees.count();
  for (let i = 0; i < n; i++) await fees.nth(i).fill(opts.fallbackFee ?? '200');
  if (n) await page.waitForTimeout(600);

  await paymentModeButton(page, opts.paymentMode ?? 'Cash').click().catch(() => { /* default mode */ });
  await page.waitForTimeout(400);

  if (opts.paymentReference) {
    const ref = paymentReferenceInput(page);
    if (await ref.count()) await ref.fill(opts.paymentReference);
  }

  const payBtn = collectAndCreateButton(page);
  const payLabel = (await payBtn.innerText().catch(() => '')).trim();
  await payBtn.click();
  await page.waitForTimeout(4_000);

  const receipt = await page.getByText(/LAB-\d+/i).first().innerText().catch(() => '');
  const done = wizardDoneButton(page);
  if (await done.count()) {
    await done.click().catch(() => { /* wizard already closed */ });
    await page.waitForTimeout(1_500);
  }
  return { billNumber: receipt.trim(), payLabel };
}


/**
 * Apply a PANEL by its chip, which is how a desk actually orders one.
 *
 * `NewLabOrderModal.tsx:832-857` renders a 'Groups / Panels' row of chips labelled
 * `{group_name} ₹{fee}`, and `addGroup()` adds every member AND records the group so
 * `fetchRates()` can apply the group price. Adding the same eight tests one at a time is the
 * ORDER-PART-OF-A-PANEL path instead, which is correctly billed at individual fees — so a journey
 * that clicks eight tests and then asserts the panel price is asserting against the wrong path.
 */
export async function applyGroupInModal(page: Page, groupName: string): Promise<boolean> {
  const chip = page.getByRole('button').filter({ hasText: new RegExp(groupName, 'i') }).first();
  if (!(await chip.isVisible({ timeout: 8_000 }).catch(() => false))) return false;
  await chip.click();
  await page.waitForTimeout(1_200);
  return true;
}

/* ── Specimen lifecycle, as three separate acts ───────────────────────── */

/**
 * Draw the sample, clearing the two-identifier check.
 *
 * `Collect` does not collect — it opens `PatientIdentityConfirmDialog`, whose confirm button stays
 * disabled until the verification checkbox is ticked. Clicking the button without ticking it does
 * nothing at all, and the case then reports "the phlebotomist drew blood the system still believes
 * is waiting" for a draw that was never confirmed.
 */
export async function collectThroughWorkstation(page: Page, rowText: string): Promise<{ blocked: boolean; toast: string }> {
  await openLabTabL(page, LAB_TABS.collection);
  await collectionTab(page, COLLECTION_TABS.toCollect).click();
  await page.waitForTimeout(1_200);

  const btn = collectButton(page, rowText);
  await btn.waitFor({ state: 'visible', timeout: 20_000 });
  await btn.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
  await btn.click();
  await page.waitForTimeout(1_200);

  const gate = paymentPendingDialog(page);
  if (await gate.isVisible().catch(() => false)) {
    return { blocked: true, toast: await labToastText(page, 3_000) };
  }

  const checkbox = identityVerifiedCheckbox(page);
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.check().catch(() => { /* already ticked */ });
    await page.waitForTimeout(300);
  }
  await confirmAndCollectButton(page).click().catch(() => { /* auto-confirmed */ });
  await page.waitForTimeout(2_000);

  return { blocked: false, toast: await labToastText(page, 6_000) };
}

export async function receiveSample(page: Page, rowText: string): Promise<void> {
  await openLabTabL(page, LAB_TABS.collection);
  await collectionTab(page, COLLECTION_TABS.collected).click();
  await page.waitForTimeout(1_200);
  await receiveButton(page, rowText).click();
  await page.waitForTimeout(2_000);
}

export async function processSample(page: Page, rowText: string): Promise<void> {
  await openLabTabL(page, LAB_TABS.collection);
  await collectionTab(page, COLLECTION_TABS.received).click();
  await page.waitForTimeout(1_200);
  await processButton(page, rowText).click();
  await page.waitForTimeout(2_000);
}

/** Collect, receive and process in one call, for journeys whose subject is downstream. */
export async function takeSampleToBench(page: Page, rowText: string): Promise<void> {
  await collectThroughWorkstation(page, rowText);
  await receiveSample(page, rowText);
  await processSample(page, rowText);
}

/**
 * Reject a tube with a chosen reason.
 *
 * The reasons are RADIO BUTTONS, not a select — see `rejectReasonRadio`. `cancel: true` opens the
 * dialog and backs out, for the case proving that cancelling rejects nothing.
 */
export async function rejectSampleWithReason(page: Page, opts: {
  rowText: string;
  tab?: RegExp;
  reason?: SampleRejectionReason;
  note?: string;
  cancel?: boolean;
}): Promise<string> {
  await openLabTabL(page, LAB_TABS.collection);
  await collectionTab(page, opts.tab ?? COLLECTION_TABS.collected).click();
  await page.waitForTimeout(1_200);

  await rejectButton(page, opts.rowText).click();
  await page.waitForTimeout(1_200);

  if (opts.reason) {
    await rejectReasonRadio(page, opts.reason).check()
      .catch(() => { /* the dialog may pre-select it */ });
    await page.waitForTimeout(300);
  }
  if (opts.note) {
    const n = rejectNoteInput(page);
    if (await n.count()) await n.fill(opts.note);
  }

  if (opts.cancel) {
    await rejectCancelButton(page).click().catch(() => { /* dialog closed itself */ });
    await page.waitForTimeout(1_000);
    return '';
  }

  await confirmRejectButton(page).click();
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

/** Release the pre-payment gate with a recorded clinical reason. */
export async function overridePaymentGate(page: Page, reason: string): Promise<string> {
  const open = page.getByRole('button', { name: /^override$/i }).first();
  if (await open.isVisible().catch(() => false)) {
    await open.click();
    await page.waitForTimeout(800);
  }
  await overrideReasonInput(page).fill(reason);
  await page.waitForTimeout(300);
  await overrideConfirmButton(page).click();
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

/* ── Result workspace ─────────────────────────────────────────────────── */

export async function openWorkspaceTab(page: Page, name: RegExp): Promise<void> {
  const t = workspaceTab(page, name);
  await t.waitFor({ state: 'visible', timeout: 15_000 });
  await t.click();
  await page.waitForTimeout(1_200);
}

/** A qualitative result — the Positive / Negative / Detected dropdown, not the numeric box. */
export async function enterTextResult(page: Page, testName: string, option: string): Promise<void> {
  const sel = textResultSelect(page, testName);
  await sel.waitFor({ state: 'visible', timeout: 15_000 });
  await sel.selectOption({ label: option });
  await page.waitForTimeout(1_800);
}

export async function saveAllResults(page: Page): Promise<string> {
  await saveAllButton(page).click();
  await page.waitForTimeout(2_000);
  return labToastText(page, 6_000);
}

export async function writeLabNotes(page: Page, notes: string): Promise<void> {
  const box = labNotesTextarea(page);
  await box.waitFor({ state: 'visible', timeout: 15_000 });
  await box.fill(notes);
  await box.press('Tab');          // the commit — this field saves on blur
  await page.waitForTimeout(1_800);
}

/* ── Quality control ──────────────────────────────────────────────────── */

export async function recordQcRun(page: Page, opts: {
  test: string; analyzer: string; value: string; mean: string; sd: string;
  submit?: boolean;
}): Promise<string> {
  await openLabTabL(page, LAB_TABS.qc);
  await recordQcButton(page).click();
  await page.waitForTimeout(1_200);

  if (opts.submit !== false) {
    await qcTestNameInput(page).fill(opts.test);
    await qcAnalyzerInput(page).fill(opts.analyzer);
    await qcValueInput(page).fill(opts.value);
    await qcMeanInput(page).fill(opts.mean);
    await qcSdInput(page).fill(opts.sd);
    await page.waitForTimeout(400);
  }

  // May be correctly DISABLED on a deliberately-empty form; see clickIfEnabled.
  const outcome = await clickIfEnabled(saveQcEntryButton(page));
  if (outcome !== 'clicked') return `refused: Save QC Entry is ${outcome}`;
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

export async function recordQcOverride(page: Page, reason: string): Promise<string> {
  const opened = await clickIfEnabled(qcOverrideOpenButton(page));
  if (opened !== 'clicked') return `refused: the QC override control is ${opened}`;
  await page.waitForTimeout(1_000);

  const box = qcOverrideReasonTextarea(page);
  if (!(await box.isVisible().catch(() => false))) return 'refused: no override reason field appeared';
  await box.fill(reason);
  await page.waitForTimeout(300);

  const confirmed = await clickIfEnabled(qcOverrideConfirmButton(page));
  if (confirmed !== 'clicked') return `refused: the override confirm is ${confirmed}`;
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

/* ── Calibration (NABL) ───────────────────────────────────────────────── */

export async function addCalibrationRecord(page: Page, opts: {
  analyzer: string; calibrationDate: string; nextDue: string;
  deviation?: string; calibratedBy?: string; submitEmpty?: boolean;
}): Promise<string> {
  await openLabTabL(page, LAB_TABS.calibration);
  await addCalibrationButton(page).click();
  await page.waitForTimeout(1_200);

  if (!opts.submitEmpty) {
    await calibrationAnalyzerInput(page).fill(opts.analyzer);
    const dates = page.locator('input[type="date"]');
    if (await dates.count()) {
      await dates.nth(0).fill(opts.calibrationDate).catch(() => { /* different field order */ });
      await dates.nth(1).fill(opts.nextDue).catch(() => { /* only one date field */ });
    }
    if (opts.deviation) await calibrationDeviationInput(page).fill(opts.deviation);
    if (opts.calibratedBy) await calibrationCalibratedByInput(page).fill(opts.calibratedBy);
    await page.waitForTimeout(400);
  }

  // May be correctly DISABLED on a deliberately-empty form; see clickIfEnabled.
  const outcome = await clickIfEnabled(saveCalibrationButton(page));
  if (outcome !== 'clicked') return `refused: Save Record is ${outcome}`;
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

/* ── Analyzer interface ───────────────────────────────────────────────── */

export async function addAnalyzerDevice(page: Page, opts: {
  name: string; manufacturer?: string; host?: string; secret?: string; submitEmpty?: boolean;
}): Promise<string> {
  await openLabTabL(page, LAB_TABS.analyzer);
  await addAnalyzerButton(page).click();
  await page.waitForTimeout(1_200);

  if (!opts.submitEmpty) {
    await analyzerNameInput(page).fill(opts.name);
    if (opts.manufacturer) await analyzerManufacturerInput(page).fill(opts.manufacturer);
    if (opts.host) await analyzerHostInput(page).fill(opts.host);
    if (opts.secret) await analyzerSecretInput(page).fill(opts.secret);
    await page.waitForTimeout(400);
  }

  // May be correctly DISABLED on a deliberately-empty form; see clickIfEnabled.
  const outcome = await clickIfEnabled(saveAnalyzerButton(page));
  if (outcome !== 'clicked') return `refused: Save Analyzer is ${outcome}`;
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

export async function addAnalyzerMapping(page: Page, opts: {
  code: string; name?: string; testLabel?: string; submitEmpty?: boolean;
}): Promise<string> {
  if (await clickIfEnabled(analyzerMappingsButton(page)) !== 'clicked') return 'refused: Mappings is unavailable';
  await page.waitForTimeout(1_200);

  if (!opts.submitEmpty) {
    await mappingCodeInput(page).fill(opts.code);
    if (opts.name) await mappingNameInput(page).fill(opts.name);
    if (opts.testLabel) {
      const sel = page.locator('select').last();
      await sel.selectOption({ label: opts.testLabel }).catch(() => { /* label differs */ });
    }
    await page.waitForTimeout(400);
  }

  // May be correctly DISABLED on a deliberately-empty form; see clickIfEnabled.
  const outcome = await clickIfEnabled(mappingAddButton(page));
  if (outcome !== 'clicked') return `refused: Add is ${outcome}`;
  await page.waitForTimeout(2_000);
  return labToastText(page, 6_000);
}

/* ── Histopathology ───────────────────────────────────────────────────── */

export async function registerPathologySpecimen(page: Page, opts: {
  uhid: string; specimenType: string; site: string; history: string; submitEmpty?: boolean;
}): Promise<string> {
  await openLabTabL(page, LAB_TABS.histopathology);
  await pathologyRegisterButton(page).click();
  await page.waitForTimeout(1_200);

  if (!opts.submitEmpty) {
    const search = pathologyPatientSearch(page);
    await search.fill(opts.uhid);
    await page.waitForTimeout(1_800);
    const hit = page.getByRole('button').filter({ hasText: opts.uhid }).first();
    if (await hit.count()) await hit.click().catch(() => { /* auto-selected */ });
    await page.waitForTimeout(800);

    await pathologySpecimenTypeInput(page).fill(opts.specimenType);
    await pathologySpecimenSiteInput(page).fill(opts.site);
    await pathologyClinicalHistoryInput(page).fill(opts.history);
    await page.waitForTimeout(400);
  }

  // May be correctly DISABLED on a deliberately-empty form; see clickIfEnabled.
  const outcome = await clickIfEnabled(registerSpecimenButton(page));
  if (outcome !== 'clicked') return `refused: Register Specimen is ${outcome}`;
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

export async function writePathologyReport(page: Page, opts: {
  gross?: string; microscopic?: string; impression?: string;
}): Promise<void> {
  for (const [label, value] of [
    ['gross description', opts.gross],
    ['microscopic description', opts.microscopic],
    ['impression', opts.impression],
  ] as const) {
    if (!value) continue;
    const box = pathologyField(page, label);
    if (await box.count()) {
      await box.fill(value);
      await page.waitForTimeout(400);
    }
  }
}

export async function savePathologyDraft(page: Page): Promise<string> {
  await pathologySaveDraftButton(page).click();
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

/* ── External referrals ───────────────────────────────────────────────── */

export async function createExternalReferral(page: Page, opts: {
  labName?: string; phone?: string; address?: string; tests?: string; expected?: string;
}): Promise<string> {
  await openLabTabL(page, LAB_TABS.external);
  await newReferralButton(page).click();
  await page.waitForTimeout(1_200);

  if (opts.labName) await referralLabNameInput(page).fill(opts.labName);
  if (opts.phone) await referralPhoneInput(page).fill(opts.phone);
  if (opts.address) await referralAddressInput(page).fill(opts.address);
  if (opts.tests) await referralTestsInput(page).fill(opts.tests);
  if (opts.expected) {
    const d = page.locator('input[type="date"]').first();
    if (await d.count()) await d.fill(opts.expected);
  }
  await page.waitForTimeout(400);

  // May be correctly DISABLED on a deliberately-empty form; see clickIfEnabled.
  const outcome = await clickIfEnabled(createReferralButton(page));
  if (outcome !== 'clicked') return `refused: Create Referral is ${outcome}`;
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

/** Push a referral one step along `pending -> sample_sent -> report_awaited -> completed`. */
export async function advanceReferral(page: Page, nextLabel: RegExp): Promise<string> {
  const btn = referralAdvanceButton(page, nextLabel);
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.waitForTimeout(2_500);
  return labToastText(page, 6_000);
}

/* ── Settings: the IPD ancillary payment policy ───────────────────────── */

/**
 * Flip the ancillary payment mode through the settings screen, not through a service-role write.
 *
 * TENANT-WIDE STATE. Whatever a journey sets here applies to every subsequent case in the run, so
 * a case that changes it MUST restore it in a `finally`. `p5Prerequisites()` re-reads the policy at
 * the start of every journey so a leaked flip surfaces immediately rather than three cases later.
 */
export async function setAncillaryModeThroughSettings(
  page: Page,
  service: 'lab' | 'radiology' | 'pharmacy',
  mode: 'pre_paid' | 'post_paid',
): Promise<boolean> {
  await page.goto('/settings/approvals', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_500);

  const label = mode === 'pre_paid' ? /pre-?paid|pay before/i : /post-?paid|pay at discharge|bill later/i;
  const row = page.locator('div, tr').filter({ hasText: new RegExp(service, 'i') }).first();

  const select = row.locator('select').first();
  if (await select.count()) {
    await select.selectOption({ label: mode === 'pre_paid' ? 'Pre-paid' : 'Post-paid' })
      .catch(async () => { await select.selectOption(mode).catch(() => { /* option text differs */ }); });
    await page.waitForTimeout(1_200);
  } else {
    const btn = row.getByRole('button', { name: label }).first();
    if (!(await btn.count())) return false;
    await btn.click();
    await page.waitForTimeout(1_200);
  }

  const save = page.getByRole('button', { name: /save|apply|update/i }).first();
  if (await save.count()) {
    await save.click().catch(() => { /* saves on change */ });
    await page.waitForTimeout(2_000);
  }
  return true;
}
