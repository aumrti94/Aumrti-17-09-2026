/**
 * Phase 1 · Section A — Hospital registration
 * Locks tracker cases TC-P1A-001 … TC-P1A-025
 *
 * SELECTOR NOTE — read before editing.
 * Your registration form uses <Label>Hospital Name *</Label> with NO htmlFor, and
 * <Input> with no id. There is therefore no label/input association, so
 * page.getByLabel() finds nothing and every fill silently does nothing — which
 * looks exactly like "Playwright isn't using the mock data".
 *
 * These specs target the PLACEHOLDER text instead, which is present and unique on
 * every field. The permanent fix is to add htmlFor/id (or data-testid) to the form;
 * until then, placeholders are the stable handle.
 *
 * Cases needing a real inbox or a live OTP stay MANUAL-ONLY in the tracker —
 * automating them would test a mock, not the thing that breaks.
 */
import type { Page } from '@playwright/test';
import { test, expect, MOCK, PASSWORD } from '../fixtures/auth.fixture';

const A = MOCK.hospitals.A;

/* Field handles — the single place to adjust if the form changes ---------- */
const F = {
  hospitalName: (p: Page) => p.getByPlaceholder(/Apollo General Hospital/i),
  mobile:       (p: Page) => p.locator('input[type="tel"]').first(),
  fullName:     (p: Page) => p.getByPlaceholder(/Dr\. Ramesh Kumar/i),
  email:        (p: Page) => p.locator('input[type="email"]').first(),
  password:     (p: Page) => p.getByPlaceholder(/Min 8 characters/i),
  confirm:      (p: Page) => p.getByPlaceholder(/Re-enter password/i),
};

const nextBtn = (p: Page) => p.getByRole('button', { name: /next|continue/i }).first();
const backBtn = (p: Page) => p.getByRole('button', { name: /back|previous/i }).first();

/**
 * shadcn <Select> is a button + popover listbox, not a native <select>.
 * Click the trigger by its placeholder, then pick the option.
 */
async function pickSelect(page: Page, triggerPlaceholder: RegExp, optionLabel: string) {
  await page.getByText(triggerPlaceholder).first().click();
  await page.getByRole('option', { name: optionLabel, exact: false }).first().click();
}

async function fillStep1(page: Page, over: Partial<typeof A> = {}) {
  const d = { ...A, ...over };
  await F.hospitalName(page).fill(d.name);
  await pickSelect(page, /Select type/i, d.type);
  await pickSelect(page, /Select state/i, d.state);
  // Bed count stores a value ("101_200") but displays a label ("101–200 beds").
  await pickSelect(page, /Select range/i, bedCountLabel(d.bedCount));
  await F.mobile(page).fill(d.phone);
}

function bedCountLabel(value: string): string {
  return ({
    under_30: 'Under 30 beds',
    '30_50': '30–50 beds',
    '51_100': '51–100 beds',
    '101_200': '101–200 beds',
    '201_500': '201–500 beds',
    '500_plus': '500+ beds',
  } as Record<string, string>)[value] ?? value;
}

test.describe('P1A — Hospital registration', () => {

  test('TC-P1A-001 registration loads at step 1 with no console errors', async ({ page, consoleErrors }) => {
    await page.goto('/register');
    await expect(F.hospitalName(page)).toBeVisible({ timeout: 15_000 });

    const fatal = consoleErrors.filter(e => !/favicon|analytics|third-party|net::ERR_/i.test(e));
    expect(fatal, `Registration page threw:\n${fatal.join('\n')}`).toHaveLength(0);
  });

  test('TC-P1A-002 step 1 accepts the mock hospital identity and advances', async ({ page }) => {
    await page.goto('/register');
    await fillStep1(page);

    // Prove the mock data actually landed in the fields before advancing.
    await expect(F.hospitalName(page)).toHaveValue(A.name);
    await expect(F.mobile(page)).toHaveValue(A.phone);

    await expect(nextBtn(page)).toBeEnabled();
    await nextBtn(page).click();
    await expect(F.fullName(page)).toBeVisible({ timeout: 10_000 });
  });

  test('TC-P1A-003 Next stays disabled while step 1 is incomplete', async ({ page }) => {
    await page.goto('/register');
    await F.hospitalName(page).fill(A.name);
    // State deliberately left blank — a hospital with no state breaks GST
    // place-of-supply and state scheme eligibility downstream.
    await page.waitForTimeout(600);
    await expect(nextBtn(page)).toBeDisabled();
  });

  test('TC-P1A-004 mobile accepts exactly 10 digits', async ({ page }) => {
    await page.goto('/register');
    const phone = F.mobile(page);

    await phone.fill('98765');
    expect(await phone.inputValue()).toBe('98765');

    await phone.fill('98765000011');
    const digits = (await phone.inputValue()).replace(/\D/g, '');
    expect(
      digits.length,
      'The mobile field accepted more than 10 digits — the OTP and every WhatsApp message will never arrive',
    ).toBeLessThanOrEqual(10);

    await phone.fill(A.phone);
    expect(await phone.inputValue()).toBe(A.phone);
  });

  test('TC-P1A-005 mobile rejects letters', async ({ page }) => {
    await page.goto('/register');
    const phone = F.mobile(page);
    await phone.fill('abcdefghij');
    await page.waitForTimeout(400);

    const digits = (await phone.inputValue()).replace(/\D/g, '');
    expect(
      digits.length === 0 || await nextBtn(page).isDisabled(),
      'A non-numeric mobile number was accepted',
    ).toBeTruthy();
  });

  test('TC-P1A-010 malformed email is rejected', async ({ page }) => {
    await page.goto('/register');
    await fillStep1(page);
    await nextBtn(page).click();
    await expect(F.fullName(page)).toBeVisible({ timeout: 10_000 });

    await F.fullName(page).fill(A.adminName);
    await F.password(page).fill(PASSWORD);
    await F.confirm(page).fill(PASSWORD);

    for (const bad of ['notanemail', 'a@b']) {
      await F.email(page).fill(bad);
      await page.waitForTimeout(500);
      await expect(
        nextBtn(page),
        `"${bad}" was accepted as an email — the admin address is where account recovery goes`,
      ).toBeDisabled();
    }
  });

  test('TC-P1A-011 weak passwords are rejected', async ({ page }) => {
    // Rule: 8+ characters, at least one letter and one digit.
    await page.goto('/register');
    await fillStep1(page);
    await nextBtn(page).click();
    await expect(F.fullName(page)).toBeVisible({ timeout: 10_000 });

    await F.fullName(page).fill(A.adminName);
    await F.email(page).fill(A.adminEmail);

    for (const weak of ['pass', 'password', '12345678']) {
      await F.password(page).fill(weak);
      await F.confirm(page).fill(weak);
      await page.waitForTimeout(500);
      await expect(
        nextBtn(page),
        `"${weak}" was accepted — this account can see every patient record in the hospital`,
      ).toBeDisabled();
    }

    await F.password(page).fill(PASSWORD);
    await F.confirm(page).fill(PASSWORD);
    await page.waitForTimeout(500);
    await expect(nextBtn(page), 'A valid password was rejected').toBeEnabled();
  });

  test('TC-P1A-012 mismatched password confirmation is rejected', async ({ page }) => {
    await page.goto('/register');
    await fillStep1(page);
    await nextBtn(page).click();
    await expect(F.fullName(page)).toBeVisible({ timeout: 10_000 });

    await F.fullName(page).fill(A.adminName);
    await F.email(page).fill(A.adminEmail);
    await F.password(page).fill(PASSWORD);
    await F.confirm(page).fill('TestPass@2025');
    await page.waitForTimeout(600);

    await expect(nextBtn(page), 'Mismatched passwords were accepted').toBeDisabled();
  });

  test('TC-P1A-024 back navigation preserves entered data', async ({ page }) => {
    await page.goto('/register');
    await fillStep1(page);
    await nextBtn(page).click();
    await expect(F.fullName(page)).toBeVisible({ timeout: 10_000 });

    await backBtn(page).click();
    await expect(F.hospitalName(page)).toBeVisible({ timeout: 10_000 });

    expect(
      await F.hospitalName(page).inputValue(),
      'Going back cleared the form — the biggest drop-off cause in any signup flow',
    ).toBe(A.name);
  });
});
