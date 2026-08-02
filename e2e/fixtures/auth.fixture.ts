/**
 * Shared Playwright fixtures.
 *
 * Two things every Phase 1 spec needs:
 *   loginAs(role)     — sign in through the real UI as a seeded staff member
 *   consoleErrors     — collected red console text, so a spec can assert the
 *                       page is clean as well as functionally correct
 */
import { test as base, expect, type Page } from '@playwright/test';
import { MOCK, PASSWORD, staffByRole, type Staff } from './mock-data';
import { TEST_ENV } from '../utils/env';

export interface AumrtiFixtures {
  loginAs: (role: string, opts?: { hospital?: 'A' | 'B'; index?: number }) => Promise<Staff>;
  logout: () => Promise<void>;
  consoleErrors: string[];
}

export const test = base.extend<AumrtiFixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));
    await use(errors);
  },

  loginAs: async ({ page }, use) => {
    await use(async (role, opts = {}) => {
      const hospital = opts.hospital ?? 'A';
      const staff = staffByRole(hospital, role, opts.index ?? 0);

      await page.goto('/login');
      await fillLogin(page, staff.email, PASSWORD);

      // Land anywhere authenticated — the specific landing route is itself
      // under test in P1C, so we deliberately do not assert it here.
      await page.waitForURL(url => !/\/login\b/.test(url.pathname), { timeout: 20_000 });
      return staff;
    });
  },

  logout: async ({ page }, use) => {
    await use(async () => {
      await page.evaluate(() => {
        sessionStorage.clear();
        localStorage.clear();
      });
      await page.goto('/login');
    });
  },
});

export { expect, MOCK, PASSWORD, staffByRole, TEST_ENV };

/**
 * Login form filler.
 *
 * Uses accessible-name lookups with a fallback to input types, so it survives
 * label wording changes. If your login form uses different labels, this is the
 * ONE place to adjust it.
 */
export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  const emailField = page
    .getByLabel(/email/i)
    .or(page.getByPlaceholder(/email/i))
    .or(page.locator('input[type="email"]'))
    .first();
  const passwordField = page
    .getByLabel(/password/i)
    .or(page.getByPlaceholder(/password/i))
    .or(page.locator('input[type="password"]'))
    .first();

  await emailField.fill(email);
  await passwordField.fill(password);

  await page
    .getByRole('button', { name: /sign in|log ?in|continue/i })
    .or(page.locator('button[type="submit"]'))
    .first()
    .click();
}

/**
 * Did navigating to `path` actually give this user the page?
 *
 * "Blocked" covers every legitimate shape: a redirect away, a 403/permission
 * message, or a plan-gate upsell. What it must never be is the real content.
 */
export async function isRouteBlocked(page: Page, path: string): Promise<boolean> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);           // allow client-side guards to settle

  const landed = new URL(page.url()).pathname.replace(/\/$/, '');
  const wanted = path.split('?')[0].replace(/\/$/, '');
  if (landed !== wanted) return true;        // redirected away

  const denial = page.getByText(
    /access denied|not authoris|not authoriz|permission|forbidden|no access|upgrade your plan|not included in your plan|404|not found/i,
  );
  return (await denial.count()) > 0;
}

/** Assert the console stayed clean. Call at the end of a happy-path spec. */
export function expectNoConsoleErrors(errors: string[], allow: RegExp[] = []): void {
  const real = errors.filter(e => !allow.some(rx => rx.test(e)));
  expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
}
