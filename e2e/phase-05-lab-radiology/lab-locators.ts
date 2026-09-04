/**
 * Phase 5 · Laboratory — how a test finds a control on /lab.
 *
 * Same root problem as every phase before this one: `grep -rn "data-testid" src/` returns three
 * files and NONE of them are in the lab module, so every locator here is text- or role-based.
 *
 * WHAT IS DIFFERENT ABOUT THE LAB SCREEN, and why this is not a re-export of opd-locators:
 *
 *   1. THERE IS NO DEEP LINK TO A TAB. `LabPage.tsx:156` holds the active tab in `useState`
 *      with no URL sync and no query param, so `page.goto('/lab?tab=collection')` lands on the
 *      worklist every time. Every flow must CLICK through. `openLabTab()` is the only supported
 *      way in.
 *   2. AN ONBOARDING TOUR OVERLAY INTERCEPTS THE FIRST CLICK. `CollectionWorkstation.tsx:251`
 *      mounts `<OnboardingTour tourKey="lab_intro" />`. On a fresh QA login it covers the page,
 *      and Playwright's actionability check will time out on a button that is plainly visible.
 *      `dismissOnboardingTour()` clears it and is called by `openLabTab()`.
 *   3. THE QUEUE FILTER IS A `<select>`, NOT A ROW OF BUTTONS (`LabQueuePanel.tsx:105`) — it
 *      needs `selectOption`, not `click`.
 *   4. THE RESULT INPUT SAVES ON `onBlur`, NOT ON CHANGE (`LabResultWorkspace.tsx:1389`). A
 *      `.fill()` alone writes nothing to the database. `enterNumericResult()` fills AND blurs;
 *      using the raw locator without blurring is the single easiest way to write a Phase 5 test
 *      that passes locally and proves nothing.
 *   5. THE PAGE IS `height: calc(100vh - 56px)` with nested `overflow-hidden` panels
 *      (`LabPage.tsx:160`), so rows below the fold need `scrollIntoViewIfNeeded()`.
 *
 * WHEN A LOCATOR FAILS, IT IS FRAMEWORK WORK — NOT A PRODUCT DEFECT. Fix the text this file
 * searches for; do not log it as a bug against the app (docs/qa/README.md).
 */
import { type Locator, type Page } from '@playwright/test';

export const LAB_ROUTE = '/lab';

/** The nine top-level tabs, keyed by `LAB_MAIN_TABS` in LabPage.tsx:42-52. */
export const LAB_TABS = {
  worklist: /Worklist/i,
  collection: /Collection/i,
  pendingOpd: /Pending from OPD/i,
  qc: /QC Dashboard/i,
  calibration: /Calibration/i,
  histopathology: /Histopathology/i,
  tat: /^.{0,3}TAT$/i,
  external: /External Referrals/i,
  analyzer: /Analyzer Interface/i,
} as const;

export function labLocatorMessage(what: string): string {
  return (
    `Could not find "${what}" on ${LAB_ROUTE}.\n` +
    `This is a FRAMEWORK failure, not a product defect — the visible text this locator matches ` +
    `on no longer matches what the page renders. Fix it in e2e/phase-05-lab-radiology/` +
    `lab-locators.ts; do not log it as a bug against the app (docs/qa/README.md).`
  );
}

/* ── Getting onto the page and into a tab ─────────────────────────────── */

/**
 * Clear the onboarding tour overlay if it is showing.
 *
 * Deliberately tolerant: the tour only appears once per user per `tourKey`, so on most runs
 * there is nothing to dismiss and that is not an error.
 */
export async function dismissOnboardingTour(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: /skip|got it|finish|close|done|next/i });
  for (let i = 0; i < 6; i++) {
    if (!(await skip.first().isVisible().catch(() => false))) return;
    await skip.first().click({ timeout: 2_000 }).catch(() => { /* raced its own dismissal */ });
    await page.waitForTimeout(250);
  }
}

export async function openLab(page: Page): Promise<void> {
  await page.goto(LAB_ROUTE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: LAB_TABS.worklist })
    .or(page.getByText(/No orders|Select an order|Laboratory/i).first())
    .first()
    .waitFor({ state: 'visible', timeout: 25_000 })
    .catch(() => { /* a permission or plan gate is a legitimate empty state here */ });
  await dismissOnboardingTour(page);
}

/**
 * Open a lab tab BY CLICKING IT. There is no URL for a tab (see this file's header), so this is
 * the only way in — a spec that tries to navigate directly will silently test the worklist.
 */
export async function openLabTab(page: Page, tab: RegExp): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith(LAB_ROUTE)) await openLab(page);
  await dismissOnboardingTour(page);
  const trigger = page.getByRole('button', { name: tab }).first();
  await trigger.waitFor({ state: 'visible', timeout: 20_000 });
  await trigger.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
  await trigger.click();
  await page.waitForTimeout(1_200);
}

/* ── Worklist / queue ─────────────────────────────────────────────────── */

/**
 * The queue status filter. A `<select>`, not buttons — `LabQueuePanel.tsx:105`.
 * Options: All / Pending / In Process / Pending Validation / Ready / Completed.
 */
export function queueFilterSelect(page: Page): Locator {
  return page.locator('select').filter({ hasText: /Pending Validation|In Process/i }).first();
}

/**
 * THERE IS NO SEARCH BOX IN THE LAB QUEUE.
 *
 * `queueSearch()` used to live here and returned `getByPlaceholder(/search/i)`. `LabQueuePanel`
 * renders only a status `<select>` and a date input — no search field at all — so the locator could
 * never resolve, and any spec using it would fail claiming the queue was broken. Worse, with the
 * New Lab Order modal open it would happily match *that* modal's patient search and type a filter
 * term into a patient lookup.
 *
 * The real search boxes are elsewhere and are named for where they are:
 * `patientSearchInput` (the order modal), `pcpndtRegisterSearch` (radiology-locators) and
 * `pathologyPatientSearch` below. Filter the queue with `queueFilterSelect` and the date controls.
 */
export function queueDateInput(page: Page): Locator {
  return page.locator('input[type="date"]').first();
}

export function queueTodayButton(page: Page): Locator {
  return page.getByRole('button', { name: /^today$/i }).first();
}

export function queueYesterdayButton(page: Page): Locator {
  return page.getByRole('button', { name: /^yesterday$/i }).first();
}

/** A worklist row, matched on the patient name or accession number it renders. */
export function labOrderRow(page: Page, text: string): Locator {
  return page.getByRole('button').filter({ hasText: text }).first();
}

export async function openLabOrder(page: Page, text: string): Promise<void> {
  const row = labOrderRow(page, text);
  await row.waitFor({ state: 'visible', timeout: 20_000 });
  await row.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
  await row.click();
  await page.waitForTimeout(1_500);
}

/* ── Result workspace ─────────────────────────────────────────────────── */

/** Sub-tabs inside the opened order: Results / Sample / History / Notes. */
export function workspaceTab(page: Page, name: RegExp): Locator {
  return page.getByRole('tab', { name }).or(page.getByRole('button', { name })).first();
}

/**
 * The numeric result input for a test row.
 *
 * `LabResultWorkspace.tsx:1384-1391` renders `input[type=number][step=any]` with
 * `placeholder="—"`, scoped by the row that carries the test name.
 */
export function resultInput(page: Page, testName: string): Locator {
  return resultRow(page, testName).locator('input[type="number"]').first();
}

/**
 * THE ROW FOR ONE TEST — and the reason this is not a `.filter({ hasText })`.
 *
 * `LabResultWorkspace.tsx:1418` renders each result as a `<div class="grid grid-cols-[...]">`
 * holding `<div class="min-w-0"><p>{test_name}</p></div>` and then the input. A
 * `page.locator('div').filter({ hasText: testName })` matches EVERY ancestor that contains the
 * name too — including the container that holds all of the order's tests — so on a multi-test
 * order `.first()` resolved to the panel wrapper and then took the FIRST number input in it.
 *
 * The consequence was silent and expensive: a three-test order typed every value into the first
 * test's box. The journey then reported "14.5 is in range and must flag N" against a test that had
 * never received 14.5, which reads as a reference-range defect and is a locator picking the wrong
 * row. Anchoring on the exact `<p>` and walking up two levels gets the row itself.
 */
export function resultRow(page: Page, testName: string): Locator {
  // `<div class="grid …"><div class="min-w-0"><p>{test_name}</p>…` — so the row is exactly two
  // ancestors up from the name paragraph.
  //
  // ANCHORED ON THE ROW'S OWN GRID TEMPLATE, established by dumping the rendered DOM rather than
  // by reading the JSX. Two facts from that dump explain every earlier failure:
  //
  //   1. The test name appears MORE THAN ONCE. "Serum Potassium" matched twice — first inside the
  //      red critical-value banner (`li.text-red-700`), and only then in its results row. Anything
  //      anchored on `getByText(name).first()` therefore starts from the banner, whose ancestors
  //      contain no field at all.
  //   2. There are only TWO number inputs on a three-test order (the culture is a `<select>`), and
  //      Biochemistry renders BEFORE Haematology. So the old
  //      `.filter({ hasText }).locator('input[type=number]').first()` — which matched a container
  //      holding every row — always resolved to POTASSIUM's box. That is precisely how a
  //      haemoglobin value came to be saved as a potassium of 11.2 flagged CH, while haemoglobin
  //      stayed null and the journey reported a reference-range defect that did not exist.
  //
  // `grid-cols-[160px…` is the results row's own template (`LabResultWorkspace.tsx:1418`) and is
  // not shared by the banner; `has:` an EXACT text match keeps "Haemoglobin" from selecting a
  // "Glycated Haemoglobin" row.
  return page
    .locator('div[class*="grid-cols-[160px"]')
    .filter({ has: page.getByText(testName, { exact: true }) })
    .first();
}

/**
 * Enter a numeric result the way the component actually persists it.
 *
 * THE SAVE IS ON `onBlur`, NOT ON CHANGE (`LabResultWorkspace.tsx:1389`). A `.fill()` with no
 * blur updates React state, shows the value on screen, and writes NOTHING to the database — a
 * test that skipped the blur would pass while proving the opposite of what it claims.
 */
export async function enterNumericResult(page: Page, testName: string, value: string): Promise<void> {
  const input = resultInput(page, testName);
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  await input.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
  await input.fill(value);
  await input.blur();
  await page.waitForTimeout(1_800);
}

/** The text-result `<select>` — Positive / Negative / Detected / Not detected / Equivocal. */
/** The qualitative dropdown for one test. Row-scoped for the same reason as `resultInput`. */
export function textResultSelect(page: Page, testName: string): Locator {
  return resultRow(page, testName).locator('select').first();
}

/** The `H` / `L` / `CH` / `CL` / `N` / `A` flag badge rendered beside a result. */
export function resultFlagBadge(page: Page, flag: 'N' | 'H' | 'L' | 'CH' | 'CL' | 'A'): Locator {
  return page.getByText(new RegExp(`^\\s*${flag}\\s*$`)).first();
}

/** The delta badge — `Δ <previous value>` (LabResultWorkspace.tsx:1420-1424). */
export function deltaBadge(page: Page): Locator {
  return page.getByText(/Δ\s*[\d.]/).first();
}

/** The `🤖` auto-verified marker (LabResultWorkspace.tsx:1445-1447). */
export function autoVerifiedBadge(page: Page): Locator {
  return page.getByTitle(/auto-verified|Within range|not enabled for auto-verification/i).first();
}

/* ── Critical value banner ────────────────────────────────────────────── */

export function criticalBanner(page: Page): Locator {
  return page.getByText(/Critical Value — Notify Treating Doctor Immediately/i).first();
}

export function criticalNotifyCheckbox(page: Page): Locator {
  return page.locator('label')
    .filter({ hasText: /I have notified the treating doctor/i })
    .locator('input[type="checkbox"]')
    .first();
}

/**
 * "✓ Acknowledge & Continue" (`LabResultWorkspace.tsx:1543`).
 *
 * NOT anchored with `^`. The label starts with a tick glyph, so `/^acknowledge/i` matched nothing
 * and every acknowledgement in this phase timed out on a click against a button that was on the
 * screen the whole time — which reads as "the acknowledgement did not persist" rather than as a
 * locator that never found it.
 */
export function acknowledgeCriticalButton(page: Page): Locator {
  return page.getByRole('button', { name: /acknowledge\s*&\s*continue/i }).first();
}

export function criticalAcknowledgedMarker(page: Page): Locator {
  return page.getByText(/Critical acknowledged/i).first();
}

/* ── Lifecycle actions ────────────────────────────────────────────────── */

export function markCollectedButton(page: Page): Locator {
  return page.getByRole('button', { name: /mark collected/i }).first();
}

export function submitForValidationButton(page: Page): Locator {
  return page.getByRole('button', { name: /submit for validation|submitting/i }).first();
}

/** The pathologist / doctor sign-off. Distinct from "Validate & Release". */
export function validateAndSignButton(page: Page): Locator {
  return page.getByRole('button', { name: /validate & sign|signing/i }).first();
}

/** The technician-side single-step release. */
export function validateAndReleaseButton(page: Page): Locator {
  return page.getByRole('button', { name: /validate & release|validating/i }).first();
}

/* ── Collection workstation ───────────────────────────────────────────── */

export const COLLECTION_TABS = {
  toCollect: /To Collect/i,
  collected: /^.{0,3}Collected/i,
  received: /Received/i,
  rejected: /Rejected/i,
} as const;

export function collectionTab(page: Page, tab: RegExp): Locator {
  return page.getByRole('button', { name: tab }).first();
}

/** A row in the collection worklist, matched on patient name, UHID or accession. */
export function collectionRow(page: Page, text: string): Locator {
  return page.locator('tr').filter({ hasText: text }).first();
}

export function collectButton(page: Page, rowText: string): Locator {
  return collectionRow(page, rowText).getByRole('button', { name: /^collect$/i }).first();
}

export function receiveButton(page: Page, rowText: string): Locator {
  return collectionRow(page, rowText).getByRole('button', { name: /^receive$/i }).first();
}

export function processButton(page: Page, rowText: string): Locator {
  return collectionRow(page, rowText).getByRole('button', { name: /^process$/i }).first();
}

export function rejectButton(page: Page, rowText: string): Locator {
  return collectionRow(page, rowText).getByRole('button', { name: /^reject$/i }).first();
}

/**
 * The label/barcode print button.
 *
 * NOTE FOR ANY SPEC THAT CLICKS THIS: it opens a `window.open` popup that loads JsBarcode from
 * `cdn.jsdelivr.net` and then calls `window.print()` (`CollectionWorkstation.tsx:130-166`).
 * Handle the popup via `context.on('page')` or the run will hang on the print dialog.
 */
export function printLabelButton(page: Page, rowText: string): Locator {
  return collectionRow(page, rowText).getByRole('button', { name: /^label$/i }).first();
}

/* ── Two-identifier confirm dialog ────────────────────────────────────── */

export function identityConfirmDialog(page: Page): Locator {
  return page.getByText(/confirm patient identity|two identifier|verify patient identity/i).first();
}

/**
 * The verification checkbox. `Confirm & Collect` stays `disabled` until it is ticked
 * (`PatientIdentityConfirmDialog.tsx:27,46,53`), and the label carries no `htmlFor`, so it is
 * located by input type inside the dialog rather than by label.
 */
export function identityVerifiedCheckbox(page: Page): Locator {
  return page.getByRole('dialog').filter({ hasText: /Verify Patient Identity/i })
    .locator('input[type="checkbox"]').first()
    .or(page.locator('input[type="checkbox"]').first());
}

export function confirmAndCollectButton(page: Page): Locator {
  return page.getByRole('button', { name: /confirm & collect/i }).first();
}

/* ── Rejection dialog ─────────────────────────────────────────────────── */

export function rejectDialog(page: Page): Locator {
  return page.getByText(/^Reject Sample$/i).first();
}

/**
 * The eight rejection reasons, mirrored from `src/lib/labSamples.ts:9-18`.
 *
 * Mirrored deliberately rather than imported: if the product's list changes, this array stops
 * matching and the test breaks loudly, which is the point. An imported list would silently follow
 * the product and prove nothing about it.
 */
export const SAMPLE_REJECTION_REASONS = [
  'Hemolyzed',
  'Clotted',
  'Insufficient quantity (QNS)',
  'Wrong tube / container',
  'Unlabeled / mislabeled',
  'Lipemic',
  'Delayed transport',
  'Other',
] as const;

export type SampleRejectionReason = typeof SAMPLE_REJECTION_REASONS[number];

/**
 * One rejection reason. THEY ARE RADIO BUTTONS, NOT A SELECT.
 *
 * The previous `rejectReasonSelect()` looked for a `<select>` containing "Hemolyzed". The reasons
 * are `input[type="radio"][name="reject-reason"]` inside a `<label>` carrying the reason text
 * (`CollectionWorkstation.tsx:396-401`), so that locator could never resolve — which meant the
 * reason was always left at whatever the dialog defaulted to and seven of the eight reasons were
 * never selected by any test.
 */
export function rejectReasonRadio(page: Page, reason: SampleRejectionReason): Locator {
  return page.locator('label').filter({ hasText: reason })
    .locator('input[type="radio"]').first()
    .or(page.locator(`input[type="radio"][name="reject-reason"][value="${reason}"]`).first());
}

export function rejectCancelButton(page: Page): Locator {
  return page.getByRole('button', { name: /^cancel$/i }).last();
}

export function rejectNoteInput(page: Page): Locator {
  return page.getByPlaceholder(/note|detail|comment/i).first();
}

export function confirmRejectButton(page: Page): Locator {
  return page.getByRole('button', { name: /reject & queue recollection/i }).first();
}

/* ── Payment gate ─────────────────────────────────────────────────────── */

export function paymentPendingDialog(page: Page): Locator {
  return page.getByText(/payment pending|cannot be collected until|amount is paid/i).first();
}

export function overrideReasonInput(page: Page): Locator {
  return page.getByPlaceholder(/reason|justification/i).first();
}

export function overrideConfirmButton(page: Page): Locator {
  return page.getByRole('button', { name: /override|proceed anyway/i }).first();
}

/* ── New lab order modal ──────────────────────────────────────────────── */

export function newLabOrderButton(page: Page): Locator {
  return page.getByRole('button', { name: /new lab order|\+ new order/i }).first();
}

export function labTestSearchInput(page: Page): Locator {
  return page.getByPlaceholder(/search test|search lab/i).first();
}

/**
 * THE WIZARD'S CONTROLS ARE SCOPED TO THE DIALOG, AND THAT IS NOT COSMETIC.
 *
 * `NewLabOrderModal` is a Radix `<Dialog open onOpenChange={onClose}>`, so ANY click landing
 * outside it closes the wizard — and when the wizard was opened from "Pending from OPD", that
 * row's own **Create Order** button stays in the DOM behind the overlay the whole time. An
 * unscoped `.first()` therefore has two ways to go wrong: it clicks the row behind the overlay, or
 * it matches something else on the page. Both dismiss the wizard with no order created, and the
 * journey then fails with "the payment step did not confirm" — which sounds like a product defect
 * and is entirely a locator collision.
 *
 * Each locator falls back to an unscoped match so it still works on screens where the control is
 * not inside a dialog.
 */
export function proceedToPaymentButton(page: Page): Locator {
  return page.getByRole('dialog').getByRole('button', { name: /proceed to payment/i }).first()
    .or(page.getByRole('button', { name: /proceed to payment/i }).first());
}

/**
 * "Collect ₹1,200 & Create Order" — the payment step's primary button
 * (`NewLabOrderModal.tsx:1074`).
 *
 * MATCHED ON THE FULL LABEL, DELIBERATELY. This used to carry a `|create order` fallback, and that
 * fallback is what broke the flagship journey: when the wizard is opened from "Pending from OPD",
 * the pending row's own **Create Order** button is still in the DOM behind the modal overlay, and
 * `.first()` picked THAT one. The click landed outside the dialog, the dialog closed, no order was
 * created — and the failure read as "the payment step did not confirm", which sounds like a product
 * defect and is entirely a locator collision.
 *
 * The IPD variant has its own locator (`createOrdersIpdButton`), so there is nothing this narrower
 * match loses.
 */
export function collectAndCreateButton(page: Page): Locator {
  return page.getByRole('dialog').getByRole('button', { name: /collect\s*₹.*create order/i }).first()
    .or(page.getByRole('button', { name: /collect\s*₹.*create order/i }).first());
}

/** The IPD variant — "Create Orders (Charge to Advance)". */
export function createOrdersIpdButton(page: Page): Locator {
  return page.getByRole('button', { name: /create order.*charge to advance/i }).first();
}

/* ── External referrals ───────────────────────────────────────────────── */

export function newReferralButton(page: Page): Locator {
  return page.getByRole('button', { name: /new referral|refer out|\+ referral/i }).first();
}

export function referralAdvanceButton(page: Page, nextLabel: RegExp): Locator {
  return page.getByRole('button', { name: nextLabel }).first();
}

/* ── Generic ──────────────────────────────────────────────────────────── */

export function toast(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"], [data-sonner-toast], .toast').first();
}

export async function toastText(page: Page, timeout = 12_000): Promise<string> {
  const t = toast(page);
  await t.waitFor({ state: 'visible', timeout }).catch(() => { /* some paths re-render silently */ });
  return (await t.innerText().catch(() => '')).trim();
}

export async function awaitSaveAck(page: Page, timeout = 12_000): Promise<void> {
  await page.waitForTimeout(300);
  await toast(page).waitFor({ state: 'visible', timeout }).catch(() => {
    // Several lab paths re-render instead of toasting; the DB assertion is the real check.
  });
  await page.waitForTimeout(1_000);
}

/* ══════════════════════════════════════════════════════════════════════
 * Surfaces that no test had ever opened before the journey rewrite.
 *
 * `LAB_TABS.qc`, `.calibration`, `.histopathology`, `.tat` and `.analyzer` were declared above and
 * never passed to `openLabTab` by any spec, so five whole tabs — quality control, NABL calibration,
 * histopathology, turnaround and the analyzer interface — had no coverage at all. The locators
 * below are what makes them reachable.
 * ══════════════════════════════════════════════════════════════════════ */

/* ── Result workspace: sub-tabs and the bottom action bar ─────────────── */

/** `Results` / `Sample` / `History` / `Notes` — real Radix tabs (`LabResultWorkspace.tsx:1376`). */
export const WORKSPACE_TABS = {
  results: /^Results$/i,
  sample: /^Sample$/i,
  history: /^History$/i,
  notes: /^Notes$/i,
} as const;

export function saveAllButton(page: Page): Locator {
  return page.getByRole('button', { name: /^save all$/i }).first();
}

export function printReportButton(page: Page): Locator {
  return page.getByRole('button', { name: /^print report$/i }).first();
}

export function cumulativeButton(page: Page): Locator {
  return page.getByRole('button', { name: /^cumulative$/i }).first();
}

export function whatsappButton(page: Page): Locator {
  return page.getByRole('button', { name: /^whatsapp$/i }).first();
}

export function labNotesTextarea(page: Page): Locator {
  return page.getByPlaceholder(/lab notes, qc comments, instrument used/i).first();
}

export function pathologistNotesInput(page: Page): Locator {
  return page.getByPlaceholder(/pathologist notes/i).first();
}

/** The Sample sub-tab's own lifecycle buttons — distinct from the collection workstation's. */
export function markSampleCollectedButton(page: Page): Locator {
  return page.getByRole('button', { name: /mark sample collected/i }).first();
}

export function markSampleReceivedButton(page: Page): Locator {
  return page.getByRole('button', { name: /mark sample received/i }).first();
}

export function startProcessingButton(page: Page): Locator {
  return page.getByRole('button', { name: /start processing/i }).first();
}

export function printBarcodeLabelButton(page: Page): Locator {
  return page.getByRole('button', { name: /print barcode label/i }).first();
}

/* ── QC release gate & the supervisor override ────────────────────────── */

export function qcBlockedBanner(page: Page): Locator {
  return page.getByText(/Result release blocked/i).first();
}

export function qcOverrideOpenButton(page: Page): Locator {
  return page.getByRole('button', { name: /supervisor override/i }).first();
}

export function qcOverrideReasonTextarea(page: Page): Locator {
  return page.getByPlaceholder(/reason for override/i).first();
}

export function qcOverrideConfirmButton(page: Page): Locator {
  return page.getByRole('button', { name: /record override & permit release/i }).first();
}

/* ── Sample-integrity (mix-up) panel ──────────────────────────────────── */

export function mixupPanel(page: Page): Locator {
  return page.getByText(/Sample Integrity Check/i).first();
}

export function mixupAcknowledgeOpenButton(page: Page): Locator {
  return page.getByRole('button', { name: /review & acknowledge/i }).first();
}

export function mixupAcknowledgeConfirmButton(page: Page): Locator {
  return page.getByRole('button', { name: /acknowledge & permit release/i }).first();
}

/* ── Antibiogram ──────────────────────────────────────────────────────── */

export function antibiogramHeading(page: Page): Locator {
  return page.getByText(/Microbiology \/ Antibiogram/i).first();
}

export function organismInput(page: Page): Locator {
  return page.getByPlaceholder(/E\. coli, MRSA/i).first();
}

export function colonyCountInput(page: Page): Locator {
  return page.getByPlaceholder(/CFU\/mL/i).first();
}

export function saveAntibiogramButton(page: Page): Locator {
  return page.getByRole('button', { name: /save antibiogram/i }).first();
}

/* ── Interpretive comment ─────────────────────────────────────────────── */

export function interpretiveCommentTextarea(page: Page): Locator {
  return page.getByPlaceholder(/appears on the printed report/i).first();
}

export function saveCommentButton(page: Page): Locator {
  return page.getByRole('button', { name: /save comment/i }).first();
}

/* ── QC dashboard ─────────────────────────────────────────────────────── */

/**
 * The two QC filters are Radix `<Select>`, NOT `<select>` (`LabQCDashboard.tsx:112-125`).
 *
 * A `SelectTrigger` renders as a `button` with `role="combobox"` and the placeholder as its
 * accessible name, so `page.locator('select')` finds nothing at all — the first version of the QC
 * journey reported "the dashboard offers no test or analyzer filter" against two filters that were
 * plainly on screen.
 */
export function qcTestFilter(page: Page): Locator {
  return page.getByRole('combobox').filter({ hasText: /All Tests/i }).first()
    .or(page.getByRole('combobox').first());
}

export function qcAnalyzerFilter(page: Page): Locator {
  return page.getByRole('combobox').filter({ hasText: /All Analyzers/i }).first()
    .or(page.getByRole('combobox').nth(1));
}

/** Pick an option out of an OPEN Radix select. */
export function selectOption(page: Page, label: RegExp): Locator {
  return page.getByRole('option', { name: label }).first();
}

export function recordQcButton(page: Page): Locator {
  return page.getByRole('button', { name: /^record qc$/i }).first();
}

export function qcTestNameInput(page: Page): Locator {
  return page.getByPlaceholder(/test name/i).first();
}

export function qcAnalyzerInput(page: Page): Locator {
  return page.getByPlaceholder(/analyzer \(e\.g\./i).first();
}

export function qcValueInput(page: Page): Locator {
  return page.getByPlaceholder(/^Value$/).first();
}

export function qcMeanInput(page: Page): Locator {
  return page.getByPlaceholder(/^Mean$/).first();
}

export function qcSdInput(page: Page): Locator {
  return page.getByPlaceholder(/^SD$/).first();
}

export function saveQcEntryButton(page: Page): Locator {
  return page.getByRole('button', { name: /save qc entry/i }).first();
}

export function qcRejectBadge(page: Page): Locator {
  return page.getByText(/^REJECT$/).first();
}

/* ── Calibration (NABL) ───────────────────────────────────────────────── */

export function addCalibrationButton(page: Page): Locator {
  return page.getByRole('button', { name: /add calibration/i }).first();
}

export function calibrationAnalyzerInput(page: Page): Locator {
  return page.getByPlaceholder(/Sysmex|Cobas/i).first();
}

export function calibrationDeviationInput(page: Page): Locator {
  return page.getByPlaceholder(/e\.g\. 2\.5/i).first();
}

export function calibrationCalibratedByInput(page: Page): Locator {
  return page.getByPlaceholder(/technician name \/ agency/i).first();
}

export function saveCalibrationButton(page: Page): Locator {
  return page.getByRole('button', { name: /save record/i }).first();
}

export function calibrationOverdueBadge(page: Page): Locator {
  return page.getByText(/\d+ Overdue/i).first();
}

/* ── Analyzer interface ───────────────────────────────────────────────── */

export function addAnalyzerButton(page: Page): Locator {
  return page.getByRole('button', { name: /add analyzer/i }).first();
}

export function analyzerNameInput(page: Page): Locator {
  return page.getByPlaceholder(/Mindray BS-380/i).first();
}

export function analyzerManufacturerInput(page: Page): Locator {
  return page.getByPlaceholder(/Mindray, ROCHE, Abbott/i).first();
}

export function analyzerHostInput(page: Page): Locator {
  return page.getByPlaceholder(/192\.168/i).first();
}

export function analyzerSecretInput(page: Page): Locator {
  return page.getByPlaceholder(/shared secret/i).first();
}

export function saveAnalyzerButton(page: Page): Locator {
  return page.getByRole('button', { name: /save analyzer/i }).first();
}

export function analyzerMappingsButton(page: Page): Locator {
  return page.getByRole('button', { name: /^mappings$/i }).first();
}

export function mappingCodeInput(page: Page): Locator {
  return page.getByPlaceholder(/^GLU$/).first();
}

export function mappingNameInput(page: Page): Locator {
  return page.getByPlaceholder(/^Glucose$/).first();
}

export function mappingAddButton(page: Page): Locator {
  return page.getByRole('button', { name: /^add$/i }).first();
}

export function analyzerPostButton(page: Page): Locator {
  return page.getByRole('button', { name: /^post$/i }).first();
}

export function analyzerIgnoreButton(page: Page): Locator {
  return page.getByRole('button', { name: /^ignore$/i }).first();
}

/* ── Histopathology ───────────────────────────────────────────────────── */

export function pathologyRegisterButton(page: Page): Locator {
  return page.getByRole('button', { name: /^register$/i }).first();
}

export function pathologyPatientSearch(page: Page): Locator {
  return page.getByPlaceholder(/search patient name or uhid/i).first();
}

export function pathologySpecimenTypeInput(page: Page): Locator {
  return page.getByPlaceholder(/Biopsy, FNAC, Resection/i).first();
}

export function pathologySpecimenSiteInput(page: Page): Locator {
  return page.getByPlaceholder(/Left breast, Colon/i).first();
}

export function pathologyClinicalHistoryInput(page: Page): Locator {
  return page.getByPlaceholder(/Relevant clinical details/i).first();
}

export function registerSpecimenButton(page: Page): Locator {
  return page.getByRole('button', { name: /register specimen/i }).first();
}

/** `ReportField` renders `placeholder="Enter {label.toLowerCase()}…"` (PathologyCaseWorkspace:63). */
export function pathologyField(page: Page, label: string): Locator {
  return page.getByPlaceholder(new RegExp(`enter ${label}`, 'i')).first();
}

export function pathologySaveDraftButton(page: Page): Locator {
  return page.getByRole('button', { name: /save draft/i }).first();
}

export function firstSignOffButton(page: Page): Locator {
  return page.getByRole('button', { name: /first sign-?off/i }).first();
}

export function finalSignOffButton(page: Page): Locator {
  return page.getByRole('button', { name: /final sign-?off/i }).first();
}

export function pathologyLockBanner(page: Page): Locator {
  return page.getByText(/locked pending the second/i).first();
}

/* ── TAT dashboard ────────────────────────────────────────────────────── */

export function tatLoadButton(page: Page): Locator {
  return page.getByRole('button', { name: /load dashboard|^refresh$/i }).first();
}

export function tatOverdueBadge(page: Page): Locator {
  return page.getByText(/^OVERDUE$/).first();
}

/* ── External referrals ───────────────────────────────────────────────── */

export const REFERRAL_CHIPS = {
  all: /^All$/i,
  pending: /^Pending$/i,
  sampleSent: /^Sample Sent$/i,
  reportAwaited: /^Report Awaited$/i,
  completed: /^Completed$/i,
} as const;

export function referralChip(page: Page, chip: RegExp): Locator {
  return page.getByRole('button', { name: chip }).first();
}

export function referralLabNameInput(page: Page): Locator {
  return page.getByPlaceholder(/Metropolis, SRL, Thyrocare/i).first();
}

export function referralPhoneInput(page: Page): Locator {
  return page.getByPlaceholder(/contact number/i).first();
}

export function referralAddressInput(page: Page): Locator {
  return page.getByPlaceholder(/address \(optional\)/i).first();
}

export function referralTestsInput(page: Page): Locator {
  return page.getByPlaceholder(/HbA1c, Lipid Profile/i).first();
}

export function createReferralButton(page: Page): Locator {
  return page.getByRole('button', { name: /create referral/i }).first();
}

/* ── New Lab Order modal — the fields no test had filled ──────────────── */

export function patientSearchInput(page: Page): Locator {
  return page.getByPlaceholder(/name, uhid, phone/i).first();
}

export function referringDoctorSelect(page: Page): Locator {
  return page.locator('select').filter({ hasText: /No referring doctor/i }).first();
}

export function clinicalNotesTextarea(page: Page): Locator {
  return page.getByPlaceholder(/Reason for test, relevant history/i).first();
}

export function priorityButton(page: Page, priority: 'Routine' | 'Urgent' | 'STAT'): Locator {
  return page.getByRole('button', { name: new RegExp(priority, 'i') }).first();
}

export function paymentModeButton(page: Page, mode: 'Cash' | 'UPI' | 'Card' | 'NEFT'): Locator {
  // Dialog-scoped — an unscoped match can land outside the wizard and dismiss it.
  return page.getByRole('dialog').getByRole('button', { name: new RegExp(mode, 'i') }).first();
}

export function paymentReferenceInput(page: Page): Locator {
  return page.getByPlaceholder(/Reference|UTR|Approval code|cheque/i).first();
}

export function wizardBackButton(page: Page): Locator {
  return page.getByRole('button', { name: /^back$/i }).first();
}

export function wizardDoneButton(page: Page): Locator {
  return page.getByRole('button', { name: /^done$/i }).first();
}

export function feeInputs(page: Page): Locator {
  return page.getByPlaceholder(/enter fee/i);
}
