/**
 * Phase 2 — how a test finds a control on a settings screen.
 *
 * WHY THIS IS NOT JUST page.getByLabel()
 * --------------------------------------
 * `grep -c data-testid src/pages/settings/*.tsx` returns 0, and the labels carry no `htmlFor`
 * either. SettingsDepartmentsPage is typical:
 *
 *     <div>
 *       <label className="text-[11px] …">Department Name *</label>
 *       <Input value={form.name} … />
 *     </div>
 *
 * There is no association between the label and the input beyond them sharing a parent, so
 * Playwright's accessible-name lookup finds nothing. This module resolves a field the way a
 * human does: find the visible label text, then take the nearest enclosing element that also
 * contains a control.
 *
 * Two control families are in play and both must work:
 *   native   16 pages — Wards, Departments, Staff, Services, Payers, Drugs, Radiology,
 *                       Profile, Roles, OPD Workflow, Day Care, Branding, Support,
 *                       API Portal, Change Log, Templates
 *   shadcn   11 pages — Lab Tests, Language, Notifications, Report Schedules, HL7,
 *                       ICD Codes, Consent Forms, Discharge Workflow, AI Language,
 *                       TV Display, Integrations
 *
 * WHEN A LOCATOR FAILS, IT IS FRAMEWORK WORK — NOT A PRODUCT DEFECT.
 * docs/qa/README.md is explicit about this. Every failure here names the label it searched
 * for so the fix is to correct the label text in settings-forms.ts, not to raise a bug
 * against the app. `fieldMissingMessage()` produces that wording; use it.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** How far up from the label we are willing to walk looking for a control. */
const MAX_ANCESTOR_HOPS = 4;

/** Everything we consider "a control" when walking up from a label. */
const CONTROL_SELECTOR = [
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="combobox"]',
  '[role="radiogroup"]',
  '[role="switch"]',
  'button[role="combobox"]',
].join(', ');

export function fieldMissingMessage(label: string, route: string): string {
  return (
    `Could not find a control for the label "${label}" on ${route}.\n` +
    `This is a FRAMEWORK failure, not a product defect — the label text in ` +
    `settings-forms.ts no longer matches what the page renders. Fix the label there; ` +
    `do not log it as a bug against the app (docs/qa/README.md).`
  );
}

/**
 * The visible `<label>` (or shadcn `<Label>`, which also renders a `<label>`) whose text
 * matches. Trailing `*` on required fields is tolerated so callers can write the plain name.
 */
export function labelNode(page: Page, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page
    .locator('label')
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*\\*?\\s*$`, 'i') })
    .first();
}

/**
 * The control belonging to `label`.
 *
 * Walks up from the label one ancestor at a time and returns the first control found. Going
 * up rather than sideways is what makes this survive the wrapper `<div>`s and `mt-1.5`
 * spacing divs these pages use inconsistently.
 */
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

/** Type into a text/number field. Clears first — settings forms are pre-populated. */
export async function fillField(
  page: Page, label: string, value: string | number, route = '',
): Promise<void> {
  const control = await field(page, label, route);
  await control.fill(String(value));
}

/** Read back what a field currently shows. Used by the reload-persistence cases. */
export async function readField(page: Page, label: string, route = ''): Promise<string> {
  const control = await field(page, label, route);
  const tag = await control.evaluate(el => el.tagName.toLowerCase());
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return (await control.inputValue()).trim();
  }
  return (await control.innerText()).trim();
}

/**
 * Choose a dropdown option by its stored VALUE, whichever family the control belongs to.
 *
 * Native  — selectOption({ value }) directly.
 * shadcn  — Radix renders the trigger as button[role="combobox"] and the options into a
 *           portal outside the field's DOM subtree, so the option must be located on `page`,
 *           not on the trigger. Radix does not put the value on the option element either,
 *           hence the label→value map argument.
 */
export async function selectByValue(
  page: Page, label: string, value: string, opts: { visibleLabel?: string; route?: string } = {},
): Promise<void> {
  const route = opts.route ?? '';
  const control = await field(page, label, route);
  const tag = await control.evaluate(el => el.tagName.toLowerCase());

  if (tag === 'select') {
    await control.selectOption({ value });
    return;
  }

  // shadcn / Radix
  await control.click();
  const listbox = page.locator('[role="listbox"]').last();
  await expect(listbox, `Opening "${label}" on ${route} did not reveal a listbox`).toBeVisible();

  const option = opts.visibleLabel
    ? listbox.getByRole('option', { name: opts.visibleLabel, exact: false })
    : listbox.getByRole('option', { name: new RegExp(`^\\s*${value}\\s*$`, 'i') });

  await expect(
    option,
    `Option "${opts.visibleLabel ?? value}" is not offered by "${label}" on ${route}. ` +
    `If the database supports this value but the dropdown does not render it, that IS a ` +
    `product defect — the ward bed Status dropdown missing "cleaning" was exactly this.`,
  ).toBeVisible();

  await option.click();
}

/** Every option value a dropdown currently offers. The missing-value cases assert on this. */
export async function optionValues(page: Page, label: string, route = ''): Promise<string[]> {
  const control = await field(page, label, route);
  const tag = await control.evaluate(el => el.tagName.toLowerCase());

  if (tag === 'select') {
    return control.locator('option').evaluateAll(
      els => els.map(e => (e as HTMLOptionElement).value).filter(v => v !== ''),
    );
  }

  await control.click();
  const listbox = page.locator('[role="listbox"]').last();
  await expect(listbox).toBeVisible();
  const texts = await listbox.getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  return texts.map(t => t.trim());
}

/**
 * Pick a radio option. Radix renders `<button role="radio">` with an id the sibling Label
 * points at, so clicking the label text is both the most robust route and the one a real
 * user takes.
 */
export async function chooseRadio(page: Page, optionLabel: string): Promise<void> {
  await page.getByText(optionLabel, { exact: true }).first().click();
}

/** Flip a switch to an explicit state rather than toggling blindly. */
export async function setSwitch(page: Page, label: string, on: boolean, route = ''): Promise<void> {
  const control = await field(page, label, route);
  const checked = await control.getAttribute('aria-checked');
  if ((checked === 'true') !== on) await control.click();
}

/**
 * The page's primary save control.
 *
 * SettingsPageWrapper renders "Save Changes" for the ~27 screens that use it. Screens with
 * their own header use their own wording ("Save Department", "Save Ward"), so callers pass
 * `name` for those.
 */
export function saveButton(page: Page, name: string | RegExp = /save changes/i): Locator {
  return page.getByRole('button', { name }).first();
}

export async function save(page: Page, name?: string | RegExp): Promise<void> {
  await saveButton(page, name).click();
}

/** The page heading. SettingsPageWrapper renders the title as an h1. */
export function heading(page: Page, title: string): Locator {
  return page.getByRole('heading', { name: title, exact: false }).first();
}

/**
 * A toast — success or failure.
 *
 * Deliberately never used on its own as proof of a save. It confirms the UI *claimed*
 * success; the row assertion in db-verify.ts is what confirms it happened. Four screens in
 * this very phase showed a green toast and wrote nothing.
 */
export function toast(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"], [data-sonner-toast], .toast').first();
}

/** Wait for the UI to claim success, so the DB read that follows is not racing the write. */
export async function awaitSaveAck(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForTimeout(300);
  await toast(page).waitFor({ state: 'visible', timeout }).catch(() => {
    // Some screens re-render the list instead of toasting. The DB assertion is the
    // real check, so a missing toast is not itself a failure here.
  });
  await page.waitForTimeout(700);
}

/**
 * Reload and let the page re-fetch.
 *
 * The persistence battery leans on this: a value still on screen after a hard reload came
 * from the database, and a value that vanished never got there. It is the cheapest possible
 * detector for the "success toast, no write" class of defect.
 */
export async function reloadAndSettle(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

/** Open a create form — a drawer on some screens, an inline row on others. */
export async function openCreate(page: Page, buttonName: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: buttonName }).first().click();
  await page.waitForTimeout(400);
}

/** True when a control refuses input — the shape "required field omitted" takes on most screens. */
export async function isSaveDisabled(page: Page, name?: string | RegExp): Promise<boolean> {
  return saveButton(page, name).isDisabled();
}
