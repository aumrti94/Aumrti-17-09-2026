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

export function queueSearch(page: Page): Locator {
  return page.getByPlaceholder(/search/i).first();
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
  return page.locator('tr, [role="row"], div')
    .filter({ hasText: testName })
    .locator('input[type="number"]')
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
export function textResultSelect(page: Page, testName: string): Locator {
  return page.locator('tr, [role="row"], div')
    .filter({ hasText: testName })
    .locator('select')
    .first();
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

export function acknowledgeCriticalButton(page: Page): Locator {
  return page.getByRole('button', { name: /^acknowledge/i }).first();
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
  return page.getByText(/confirm patient identity|two identifier/i).first();
}

/* ── Rejection dialog ─────────────────────────────────────────────────── */

export function rejectDialog(page: Page): Locator {
  return page.getByText(/^Reject Sample$/i).first();
}

export function rejectReasonSelect(page: Page): Locator {
  return page.locator('select').filter({ hasText: /Hemolyzed|Clotted/i }).first();
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

export function proceedToPaymentButton(page: Page): Locator {
  return page.getByRole('button', { name: /proceed to payment/i }).first();
}

export function collectAndCreateButton(page: Page): Locator {
  return page.getByRole('button', { name: /collect ₹.*create order|create order/i }).first();
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
