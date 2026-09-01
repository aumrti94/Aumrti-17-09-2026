/**
 * Phase 4 — how a test finds a control in the OPD workspace, the walk-in modal and the
 * token queue.
 *
 * Same root problem as Phase 2 (settings-locators.ts) and Phase 3 (patient-locators.ts):
 * TokenQueue.tsx, WalkInModal.tsx, ConsultationWorkspace.tsx and every tab under
 * components/opd/tabs/ render `<label>` with no `htmlFor` beside a plain `<input>`/`<select>`
 * with no `id`, so `page.getByLabel()` resolves nothing. The strategy here is the same one
 * the other two phases use: find the visible label text, then walk up to the nearest ancestor
 * that also contains a control.
 *
 * WHAT IS DIFFERENT IN THIS PHASE, and why this file is not just a re-export:
 *
 *   1. Several OPD controls are NOT form controls at all. The consultation fee is a read-only
 *      `<div>` (deliberately — WalkInModal.tsx comments it as "read-only to prevent front-desk
 *      manipulation"), so `field()` can never find it. `consultationFee()` reads the rendered
 *      rupee text instead.
 *   2. Priority, Visit Type and Payment Mode are rows of `<button>` toggles, not `<select>`s.
 *   3. The rate-source badge ("Doctor rate" / "Dept rate" / "Global rate" / "Default rate" /
 *      "Follow-up rate (within 7d)" / "Emergency rate") is the single most useful assertion
 *      target in the phase — it tells you WHICH tier of the fee lookup won without going to
 *      the database. `rateSourceBadge()` exposes it.
 *
 * WHEN A LOCATOR FAILS, IT IS FRAMEWORK WORK — NOT A PRODUCT DEFECT. Fix the label text this
 * file searches for; do not log it as a bug against the app (docs/qa/README.md).
 */
import { expect, type Locator, type Page } from '@playwright/test';

const MAX_ANCESTOR_HOPS = 4;

const CONTROL_SELECTOR = [
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="combobox"]',
  '[role="switch"]',
].join(', ');

export const OPD_ROUTE = '/opd';

export function fieldMissingMessage(label: string, route: string): string {
  return (
    `Could not find a control for the label "${label}" on ${route}.\n` +
    `This is a FRAMEWORK failure, not a product defect — the label text here no longer ` +
    `matches what the page renders. Fix the label text in this file's caller; do not log it ` +
    `as a bug against the app (docs/qa/README.md).`
  );
}

export function labelNode(page: Page, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Tolerates a trailing "*" (required marker) — "Full Name *", "Chief Complaint *".
  return page
    .locator('label')
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*\\*?\\s*$`, 'i') })
    .first();
}

/** The control belonging to `label`, walking up from the label the way a human eye does. */
export async function field(page: Page, label: string, route = OPD_ROUTE): Promise<Locator> {
  const lbl = labelNode(page, label);
  if ((await lbl.count()) === 0) throw new Error(fieldMissingMessage(label, route));

  let scope: Locator = lbl;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
    scope = scope.locator('xpath=..');
    const control = scope.locator(CONTROL_SELECTOR).first();
    if ((await control.count()) > 0) return control;
  }
  throw new Error(fieldMissingMessage(label, route));
}

export async function fillField(page: Page, label: string, value: string | number, route = OPD_ROUTE): Promise<void> {
  await (await field(page, label, route)).fill(String(value));
}

export async function selectOption(page: Page, label: string, optionLabel: string | RegExp, route = OPD_ROUTE): Promise<void> {
  const control = await field(page, label, route);
  await control.selectOption({ label: typeof optionLabel === 'string' ? optionLabel : undefined as never })
    .catch(async () => {
      // Fall back to matching the option's visible text when the exact label differs
      // (departments and doctors are rendered from live data, so their text varies by tenant).
      const options = control.locator('option');
      const count = await options.count();
      for (let i = 0; i < count; i++) {
        const text = (await options.nth(i).innerText()).trim();
        const matches = typeof optionLabel === 'string'
          ? text.toLowerCase().includes(optionLabel.toLowerCase())
          : optionLabel.test(text);
        if (matches) {
          await control.selectOption(await options.nth(i).getAttribute('value') ?? text);
          return;
        }
      }
      throw new Error(
        `No option matching "${optionLabel}" under the label "${label}" on ${route}. ` +
        `Available: ${(await control.locator('option').allInnerTexts()).join(' | ')}. ` +
        `If the list is empty this is a PREREQUISITE gap (see SETTINGS_PREREQ_MATRIX.md), not a locator bug.`,
      );
    });
}

/** Read every option text under a `<select>` — used to prove a master list actually loaded. */
export async function optionTexts(page: Page, label: string, route = OPD_ROUTE): Promise<string[]> {
  const control = await field(page, label, route);
  return (await control.locator('option').allInnerTexts()).map(t => t.trim()).filter(Boolean);
}

/* ── Token queue ──────────────────────────────────────────────────────── */

export function registerWalkInButton(page: Page): Locator {
  return page.getByRole('button', { name: /register walk-?in/i }).first();
}

export function callNextButton(page: Page): Locator {
  return page.getByRole('button', { name: /call next/i }).first();
}

export function queueSearch(page: Page): Locator {
  return page.getByPlaceholder(/search name, uhid, phone, token/i).first();
}

/** A queue row. Matched on the patient name the row renders. */
export function queueRow(page: Page, patientName: string): Locator {
  return page.getByRole('button').filter({ hasText: patientName }).first();
}

/* ── Walk-in modal ────────────────────────────────────────────────────── */

export function walkInSearch(page: Page): Locator {
  return page.getByPlaceholder(/search by name, phone, or uhid/i).first();
}

/** A pill/chip/button toggle — Priority, Visit Type, Payment Mode, Gender. */
export function toggle(page: Page, text: string | RegExp): Locator {
  return page.getByRole('button', { name: text, exact: false }).first();
}

export function dpdpConsentCheckbox(page: Page): Locator {
  return page.locator('label')
    .filter({ hasText: /Digital Personal Data Protection Act/i })
    .locator('input[type="checkbox"]')
    .first();
}

export function mlcCheckbox(page: Page): Locator {
  return page.locator('label')
    .filter({ hasText: /Medico-Legal Case/i })
    .locator('input[type="checkbox"]')
    .first();
}

export function proceedToPaymentButton(page: Page): Locator {
  return page.getByRole('button', { name: /proceed to payment/i }).first();
}

export function payAndIssueButton(page: Page): Locator {
  return page.getByRole('button', { name: /pay .* issue token|processing/i }).first();
}

export function bookAppointmentButton(page: Page): Locator {
  return page.getByRole('button', { name: /book appointment|booking/i }).first();
}

export function doneButton(page: Page): Locator {
  return page.getByRole('button', { name: /^done$/i }).first();
}

/**
 * The consultation fee shown on the payment step.
 *
 * It is a read-only `<div>`, not an input — WalkInModal renders it that way on purpose so the
 * front desk cannot edit the rate. Returns the integer rupee value.
 */
export async function consultationFee(page: Page): Promise<number> {
  const label = labelNode(page, 'Consultation Fee (₹)');
  // The payment step's fee render can lag behind the click that opens it under real network
  // latency (found by the first live run). Wait for the label to actually appear before the
  // existence check, rather than throwing on an instantaneous count. 18s was still not always
  // enough under a long, sustained real-browser run (found by the second live run, 2 of 22
  // P4G tests) — widened for headroom.
  await label.waitFor({ state: 'visible', timeout: 28_000 }).catch(() => { /* fall through to the richer error below */ });
  if ((await label.count()) === 0) {
    throw new Error(fieldMissingMessage('Consultation Fee (₹)', OPD_ROUTE));
  }
  // The amount div is a sibling of the label's wrapper. Read the whole block and take the
  // FIRST ₹ figure — the second, when present, is the struck-through base fee.
  const block = label.locator('xpath=../..');
  const text = await block.innerText();
  const match = text.match(/₹\s*([\d,]+)/);
  if (!match) {
    throw new Error(
      `The Consultation Fee block rendered no ₹ amount. Got:\n${text}\n` +
      fieldMissingMessage('Consultation Fee (₹)', OPD_ROUTE),
    );
  }
  return parseInt(match[1].replace(/,/g, ''), 10);
}

/**
 * The rate-source badge beside the fee — "Doctor rate", "Dept rate", "Global rate",
 * "Default rate", "Follow-up rate (within 7d)" or "Emergency rate".
 *
 * "Default rate" is the one that matters most: it means every service_master lookup missed and
 * the hardcoded ₹500 is being billed with no warning to the user.
 */
export async function rateSourceBadge(page: Page): Promise<string> {
  const badge = page.getByText(/^(Doctor rate|Dept rate|Global rate|Default rate|Emergency rate|Follow-up rate \(within \d+d\))$/).first();
  await badge.waitFor({ state: 'visible', timeout: 10_000 });
  return (await badge.innerText()).trim();
}

/** The token number the modal previews before payment ("Token A-014 will be assigned"). */
export async function previewedToken(page: Page): Promise<string> {
  const block = page.getByText(/will be assigned/i).first();
  await block.waitFor({ state: 'visible', timeout: 10_000 });
  const text = await block.locator('xpath=..').innerText();
  return text.replace(/token|will be assigned/gi, '').trim();
}

/* ── Consultation workspace ───────────────────────────────────────────── */

export function tab(page: Page, name: string | RegExp): Locator {
  return page.getByRole('button', { name, exact: false }).first();
}

export function startConsultationButton(page: Page): Locator {
  return page.getByRole('button', { name: /start consultation/i }).first();
}

export function completeButton(page: Page): Locator {
  return page.getByRole('button', { name: /^✓?\s*complete(ing…)?$/i }).first();
}

export function resumeConsultationButton(page: Page): Locator {
  return page.getByRole('button', { name: /resume consultation/i }).first();
}

export function admitButton(page: Page): Locator {
  return page.getByRole('button', { name: /^admit$/i }).first();
}

export function referPhysioButton(page: Page): Locator {
  return page.getByRole('button', { name: /refer physio/i }).first();
}

export function saveDraftButton(page: Page): Locator {
  return page.getByRole('button', { name: /save|draft/i }).first();
}

/* ── Rx & Orders tab ──────────────────────────────────────────────────── */

export function addDrugButton(page: Page): Locator {
  return page.getByRole('button', { name: /add drug/i }).first();
}

export function drugSearchInput(page: Page): Locator {
  return page.getByPlaceholder(/search drug name/i).first();
}

export function labSearchInput(page: Page): Locator {
  return page.getByPlaceholder(/search test name/i).first();
}

export function radiologySearchInput(page: Page): Locator {
  return page.getByPlaceholder(/search stud|search scan|search radiolog/i).first();
}

/**
 * The order-state chip beside a selected lab test / study.
 *
 * Three states, because the chip is a claim about MONEY and used to make one it could not back:
 * it read "BILLED & ORDERED" from the mere existence of a lab_orders row.
 *   PRESCRIBED       — in the doctor's draft, no order row yet (the state right after Complete)
 *   AWAITING PAYMENT — an order exists but payment_status is not "paid"
 *   BILLED & ORDERED — collected, and the order is live in the module
 */
export function billedAndOrderedChip(page: Page): Locator {
  return page.getByText(/BILLED & ORDERED/i);
}

export function awaitingPaymentChip(page: Page): Locator {
  return page.getByText(/AWAITING PAYMENT/i);
}

export function prescribedChip(page: Page): Locator {
  return page.getByText(/\bPRESCRIBED\b/i);
}

/** The amber banner shown when prescribed tests were not found in lab_test_master. */
export function testsNotFoundBanner(page: Page): Locator {
  return page.getByText(/prescribed tests? not found|not found in the (lab )?catalogue/i).first();
}

/* ── Drug safety modal ────────────────────────────────────────────────── */

export function safetyModal(page: Page): Locator {
  return page.getByText(/CONTRAINDICATION DETECTED|drug interaction|safety alert/i).first();
}

export function contraindicationNotice(page: Page): Locator {
  return page.getByText(/CONTRAINDICATED — Do not administer/i).first();
}

export function overrideOpenButton(page: Page): Locator {
  return page.getByRole('button', { name: /override with clinical justification/i }).first();
}

export function overrideReasonInput(page: Page): Locator {
  return page.getByPlaceholder(/reason|justification/i).first();
}

export function overrideAcknowledgeCheckbox(page: Page): Locator {
  return page.locator('input[type="checkbox"]').last();
}

export function overrideSubmitButton(page: Page): Locator {
  return page.getByRole('button', { name: /override and add drug/i }).first();
}

/* ── Generic ──────────────────────────────────────────────────────────── */

export function toast(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"], [data-sonner-toast], .toast').first();
}

export async function awaitSaveAck(page: Page, timeout = 12_000): Promise<void> {
  await page.waitForTimeout(300);
  await toast(page).waitFor({ state: 'visible', timeout }).catch(() => {
    // Some OPD flows re-render instead of toasting; the DB assertion is the real check.
  });
  await page.waitForTimeout(900);
}

export async function openOpd(page: Page, date?: string): Promise<void> {
  await page.goto(date ? `${OPD_ROUTE}?date=${date}` : OPD_ROUTE, { waitUntil: 'domcontentloaded' });
  // A fixed sleep here used to be too short under real Supabase round-trip latency (found by
  // the first live run — TC-P4F-007 timed out waiting for Register Walk-in with no error).
  // Wait for a real signal that the queue has loaded instead, reusing the same locators
  // opdQueueVisible() already checks against.
  await registerWalkInButton(page)
    .or(page.getByText(/OPD Queue|Call Next/i).first())
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => { /* a permission/plan gate is a legitimate empty state here */ });
}

/** Assert a control exists at all, with the framework-vs-product message attached. */
export async function expectField(page: Page, label: string, route = OPD_ROUTE): Promise<Locator> {
  const control = await field(page, label, route);
  await expect(control, fieldMissingMessage(label, route)).toBeVisible();
  return control;
}
