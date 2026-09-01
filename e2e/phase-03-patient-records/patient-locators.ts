/**
 * Phase 3 — how a test finds a control on the patient registration / edit / kiosk / portal
 * screens.
 *
 * Same problem as Phase 2 (see e2e/phase-02-settings/settings-locators.ts) and Phase 1's
 * P1A.registration.spec.ts: PatientRegistrationModal.tsx, PatientDetailDrawer.tsx and
 * KioskCheckinPage.tsx all use `<label>` with no `htmlFor` next to a plain `<input>` with no
 * `id` — there is no accessible-name association, so `page.getByLabel()` finds nothing.
 *
 * This module resolves a field the same way settings-locators.ts does: find the visible label
 * text, then walk up to the nearest ancestor that also contains a control. Kept as its own
 * file (rather than importing settings-locators.ts) so this phase's folder is self-contained,
 * per the convention in docs/qa/PHASE_MAP.md.
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
  // Tolerates a trailing "*" (required-field marker) or "(Optional)" (rendered as a nested
  // <span> inside several PatientRegistrationModal labels — "Insurance / TPA ID", "Aadhaar
  // ID" and "ABHA ID" all render as "<label>Insurance / TPA ID (Optional)</label>", so the
  // label's full innerText includes that suffix).
  return page
    .locator('label')
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*(\\*|\\(Optional\\))?\\s*$`, 'i') })
    .first();
}

/** The control belonging to `label`, walking up from the label the way a human eye does. */
export async function field(page: Page, label: string, route = ''): Promise<Locator> {
  const lbl = labelNode(page, label);
  if ((await lbl.count()) === 0) {
    throw new Error(fieldMissingMessage(label, route || page.url()));
  }

  let scope: Locator = lbl;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
    scope = scope.locator('xpath=..');
    const control = scope.locator(CONTROL_SELECTOR).first();
    if ((await control.count()) > 0) return control;
  }
  throw new Error(fieldMissingMessage(label, route || page.url()));
}

export async function fillField(page: Page, label: string, value: string | number, route = ''): Promise<void> {
  const control = await field(page, label, route);
  await control.fill(String(value));
}

export async function readField(page: Page, label: string, route = ''): Promise<string> {
  const control = await field(page, label, route);
  return (await control.inputValue()).trim();
}

/** A pill/chip/button toggle — Gender, Blood Group, Patient Category, Arrival Mode, Triage. */
export function chip(page: Page, text: string | RegExp): Locator {
  return page.getByRole('button', { name: text, exact: false }).first();
}

/** The DPDP / verbal-consent checkbox — these ARE implicitly wrapped by their <label>, so getByText + locator works. */
export function consentCheckbox(page: Page, labelText: string | RegExp): Locator {
  return page.locator('label').filter({ hasText: labelText }).locator('input[type="checkbox"]').first();
}

export function toast(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"], [data-sonner-toast], .toast').first();
}

export async function awaitSaveAck(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForTimeout(300);
  await toast(page).waitFor({ state: 'visible', timeout }).catch(() => {
    // Some flows re-render instead of toasting; the DB assertion is the real check.
  });
  await page.waitForTimeout(700);
}

export async function reloadAndSettle(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}
