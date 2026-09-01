/**
 * Phase 5 · Radiology — how a test finds a control on /radiology.
 *
 * Text- and role-based throughout, for the same reason as the lab side: there is not one
 * `data-testid` anywhere in `src/components/radiology/` or `src/pages/radiology/`.
 *
 * WHAT IS DIFFERENT ABOUT THE RADIOLOGY SCREEN:
 *
 *   1. THE STATUS VOCABULARY IS NOT THE ONE THE SCENARIO DOCS USE. There is no `performed` and
 *      no `verified`. The real enum (migration 20260517000001) is
 *      `ordered → scheduled → patient_arrived → in_progress → images_acquired → reported →
 *      validated | cancelled`, and `scheduled` / `patient_arrived` are UNREACHABLE from the UI —
 *      no screen writes them. `STATUS_ACTIONS` below is the reachable subset, in order.
 *   2. EVERY BUTTON IS EMOJI-PREFIXED (`🟢 Routine`, `🔴 STAT`, `📡 Worklist`). Exact-name
 *      matching fails; every locator here uses a regex.
 *   3. THE PCPNDT GATE IS NOT WHERE YOU EXPECT IT. "Start Study" is replaced by "Fill PCPNDT
 *      Form First" for any `is_pcpndt` order, and that gate reads `pcpndt_records` — NOT the
 *      `pcpndt_form_f` row the order path auto-creates. See the note on `pcpndtGateButton()`.
 *   4. THE WORKLIST IS SCOPED TO A SINGLE `order_date` AND HIDES `billing_status='unbilled'`
 *      (`RadiologyPage.tsx:87-117`). An order created yesterday, or one whose charge failed, is
 *      invisible with no view anywhere that would show it.
 *
 * WHEN A LOCATOR FAILS, IT IS FRAMEWORK WORK — NOT A PRODUCT DEFECT (docs/qa/README.md).
 */
import { type Locator, type Page } from '@playwright/test';

export const RADIOLOGY_ROUTE = '/radiology';
export const PCPNDT_REGISTER_ROUTE = '/radiology/pcpndt-register';

export const RADIOLOGY_TABS = {
  worklist: /Worklist/i,
  pendingOpd: /Pending from OPD/i,
  tatDashboard: /TAT Dashboard/i,
} as const;

/**
 * The reachable status transitions, in order, with the button that performs each.
 *
 * `scheduled` and `patient_arrived` are deliberately absent: they are valid enum values with a
 * worklist filter and a stat counter, but nothing in the UI ever writes them, so a spec that
 * waited for either would hang forever.
 */
export const STATUS_ACTIONS = [
  { from: /ordered|scheduled|arrived/i, button: /start study/i, to: 'in_progress' },
  { from: /imaging/i, button: /images acquired/i, to: 'images_acquired' },
  { from: /awaiting report/i, button: /begin report/i, to: 'reported' },
] as const;

export function radiologyLocatorMessage(what: string): string {
  return (
    `Could not find "${what}" on ${RADIOLOGY_ROUTE}.\n` +
    `This is a FRAMEWORK failure, not a product defect — fix the text in ` +
    `e2e/phase-05-lab-radiology/radiology-locators.ts; do not log it as a bug against the app ` +
    `(docs/qa/README.md).`
  );
}

/* ── Navigation ───────────────────────────────────────────────────────── */

export async function openRadiology(page: Page): Promise<void> {
  await page.goto(RADIOLOGY_ROUTE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: RADIOLOGY_TABS.worklist })
    .or(page.getByText(/Select a study from the worklist|No studies in worklist|Radiology/i).first())
    .first()
    .waitFor({ state: 'visible', timeout: 25_000 })
    .catch(() => { /* a permission or plan gate is a legitimate empty state */ });
  await page.waitForTimeout(800);
}

export async function openRadiologyTab(page: Page, tab: RegExp): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith(RADIOLOGY_ROUTE)) await openRadiology(page);
  const trigger = page.getByRole('button', { name: tab }).first();
  await trigger.waitFor({ state: 'visible', timeout: 20_000 });
  await trigger.click();
  await page.waitForTimeout(1_200);
}

export async function openPcpndtRegister(page: Page): Promise<void> {
  await page.goto(PCPNDT_REGISTER_ROUTE, { waitUntil: 'domcontentloaded' });
  await page.getByText(/PCPNDT|No PCPNDT records found for this period/i).first()
    .waitFor({ state: 'visible', timeout: 25_000 })
    .catch(() => { /* an empty register is itself an assertable state */ });
  await page.waitForTimeout(800);
}

/* ── Worklist ─────────────────────────────────────────────────────────── */

export function worklistRow(page: Page, text: string): Locator {
  return page.getByRole('button').filter({ hasText: text }).first();
}

export async function openStudy(page: Page, text: string): Promise<void> {
  const row = worklistRow(page, text);
  await row.waitFor({ state: 'visible', timeout: 20_000 });
  await row.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
  await row.click();
  await page.waitForTimeout(1_500);
}

export function worklistEmptyState(page: Page): Locator {
  return page.getByText(/No studies in worklist|Select a study from the worklist/i).first();
}

/** The status pill on a worklist row or in the workspace header. */
export function statusPill(page: Page, label: RegExp): Locator {
  return page.getByText(label).first();
}

/* ── Reporting workspace ──────────────────────────────────────────────── */

export function workspaceTab(page: Page, name: RegExp): Locator {
  return page.getByRole('tab', { name }).or(page.getByRole('button', { name })).first();
}

/**
 * A workspace textarea, found by its visible label.
 *
 * Every field here is a `<Textarea>` with a plain `<label>` and no `htmlFor`, so this walks up
 * from the label the same way opd-locators' `field()` does.
 */
export async function reportField(page: Page, label: RegExp): Promise<Locator> {
  const lbl = page.locator('label').filter({ hasText: label }).first();
  if ((await lbl.count()) === 0) throw new Error(radiologyLocatorMessage(String(label)));

  let scope: Locator = lbl;
  for (let hop = 0; hop < 4; hop++) {
    scope = scope.locator('xpath=..');
    const control = scope.locator('textarea, input:not([type="hidden"]), select').first();
    if ((await control.count()) > 0) return control;
  }
  throw new Error(radiologyLocatorMessage(String(label)));
}

export async function fillReportField(page: Page, label: RegExp, value: string): Promise<void> {
  const control = await reportField(page, label);
  await control.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
  await control.fill(value);
}

export function findingsField(page: Page): Promise<Locator> {
  return reportField(page, /^\s*Findings\s*$/i);
}

export function impressionField(page: Page): Promise<Locator> {
  return reportField(page, /Impression/i);
}

/* ── Lifecycle buttons ────────────────────────────────────────────────── */

export function startStudyButton(page: Page): Locator {
  return page.getByRole('button', { name: /start study/i }).first();
}

export function imagesAcquiredButton(page: Page): Locator {
  return page.getByRole('button', { name: /images acquired/i }).first();
}

export function beginReportButton(page: Page): Locator {
  return page.getByRole('button', { name: /begin report/i }).first();
}

export function saveDraftButton(page: Page): Locator {
  return page.getByRole('button', { name: /save draft/i }).first();
}

export function validateAndSignButton(page: Page): Locator {
  return page.getByRole('button', { name: /validate & sign|signing/i }).first();
}

export function sendToDoctorButton(page: Page): Locator {
  return page.getByRole('button', { name: /send to doctor/i }).first();
}

/* ── PCPNDT ───────────────────────────────────────────────────────────── */

/**
 * The gate that replaces "Start Study" on a PCPNDT order.
 *
 * IMPORTANT: this gate reads `pcpndt_records` (`RadiologyReportingWorkspace.tsx:562`), while
 * both auto-create paths write `pcpndt_form_f`. The two tables are unrelated, so an order that
 * already HAS a statutory Form F row still shows this button. That is finding R2, and a spec
 * asserting on it should say so rather than treat it as a locator problem.
 */
export function pcpndtGateButton(page: Page): Locator {
  return page.getByRole('button', { name: /fill pcpndt form first/i }).first();
}

export function openPcpndtFormButton(page: Page): Locator {
  return page.getByRole('button', { name: /fill pcpndt form f|open \/ edit pcpndt form f/i }).first();
}

export function pcpndtModal(page: Page): Locator {
  return page.getByText(/PCPNDT|Form F/i).first();
}

export async function pcpndtField(page: Page, label: RegExp): Promise<Locator> {
  return reportField(page, label);
}

export function pcpndtSexDeclarationCheckbox(page: Page): Locator {
  return page.locator('label')
    .filter({ hasText: /sex determination|no sex determination/i })
    .locator('input[type="checkbox"]')
    .first();
}

export function pcpndtConsentCheckbox(page: Page): Locator {
  return page.locator('label')
    .filter({ hasText: /consent/i })
    .locator('input[type="checkbox"]')
    .first();
}

export function savePcpndtFormButton(page: Page): Locator {
  return page.getByRole('button', { name: /save form f|update form f/i }).first();
}

export function pcpndtRegisterEmptyState(page: Page): Locator {
  return page.getByText(/No PCPNDT records found for this period/i).first();
}

/* ── AI impression ────────────────────────────────────────────────────── */

export function aiSuggestButton(page: Page): Locator {
  return page.getByRole('button', { name: /ai suggest/i }).first();
}

export function aiSuggestionCard(page: Page): Locator {
  return page.getByText(/AI Suggestion/i).first();
}

export function aiUseThisButton(page: Page): Locator {
  return page.getByRole('button', { name: /use this/i }).first();
}

export function aiDismissButton(page: Page): Locator {
  return page.getByRole('button', { name: /^dismiss$/i }).first();
}

/** The attestation modal's editable impression box — the text saved is what is IN this box. */
export function aiAttestationTextarea(page: Page): Locator {
  return page.locator('textarea').last();
}

export function aiAttestationCheckbox(page: Page): Locator {
  return page.locator('input[type="checkbox"]').last();
}

export function aiAttestationAcceptButton(page: Page): Locator {
  return page.getByRole('button', { name: /accept|confirm|save/i }).first();
}

/* ── New radiology order modal ────────────────────────────────────────── */

export function newRadiologyOrderButton(page: Page): Locator {
  return page.getByRole('button', { name: /new radiology order|new study/i }).first();
}

export function studySearchInput(page: Page): Locator {
  return page.getByPlaceholder(/search stud|search scan/i).first();
}

export function pcpndtWarningBanner(page: Page): Locator {
  return page.getByText(/PCPNDT Act compliance required/i).first();
}

export function proceedToPaymentButton(page: Page): Locator {
  return page.getByRole('button', { name: /proceed to payment/i }).first();
}

export function collectAndCreateButton(page: Page): Locator {
  return page.getByRole('button', { name: /collect ₹.*create order/i }).first();
}

export function createOrdersIpdButton(page: Page): Locator {
  return page.getByRole('button', { name: /create order.*charge to advance/i }).first();
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
  await toast(page).waitFor({ state: 'visible', timeout }).catch(() => { /* DB is the real check */ });
  await page.waitForTimeout(1_000);
}
