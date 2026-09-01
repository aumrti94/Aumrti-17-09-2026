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
  /**
   * Collected red console text.
   *
   * `auto: true` so it runs for EVERY test, not only the handful that name it — the
   * tracker has a "Console Error" column for every case, and a fixture nobody requests
   * fills none of them.
   *
   * The teardown attaches what it found, because the array lives in the worker process
   * and a reporter can only see what reaches TestResult.attachments.
   */
  consoleErrors: [async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));

    await use(errors);

    if (errors.length) {
      await testInfo.attach('console-errors', {
        body: errors.join('\n'),
        contentType: 'text/plain',
      });
    }
  }, { auto: true }],

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
export async function isRouteBlocked(page: Page, path: string, timeout = 8_000): Promise<boolean> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });

  const wanted = path.split('?')[0].replace(/\/$/, '');

  // Word-boundary'd so this never false-positives on benign page content that merely
  // contains "permission" (e.g. a "Roles & Permissions" settings card). Includes
  // ModuleGate's actual copy ("Module Not Enabled" / "not included in your current
  // plan") since ModuleGate denies via a same-URL content swap rather than a redirect
  // (unlike RoleGuard, which is already caught by the URL check below), so this text
  // match is the only way to detect that case.
  const denial = page.getByText(
    /access denied|not authoris|not authoriz|forbidden|no access|\bno permission\b|permission denied|insufficient permission|module not enabled|not included in .*?plan|upgrade your plan|404|not found/i,
  );

  // POLL, don't sample once.
  //
  // Every settings screen is a `lazy()` import, so the first visit to a route also waits on
  // Vite compiling and shipping that chunk — and RoleGuard holds a spinner while it resolves
  // the session before it can redirect. A single 1,200 ms sample lands inside that window on a
  // cold route and sees neither a redirect nor a denial, which reads as "this role reached the
  // page" and reports a phantom RBAC bypass. Waiting for a *positive* blocked signal removes
  // the race in the only direction that matters: a guard is called broken only after it has
  // had a full `timeout` to act.
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (new URL(page.url()).pathname.replace(/\/$/, '') !== wanted) return true;
    if (await denial.count()) return true;
    if (await hasPageContent(page)) return false;   // the user really is on the screen
    await page.waitForTimeout(250);
  }

  // One last look, so a guard that fires exactly on the deadline is not misreported.
  if (new URL(page.url()).pathname.replace(/\/$/, '') !== wanted) return true;
  if (await denial.count()) return true;

  // Neither admitted nor refused. This is NOT a reach: the app shell can render with an
  // unresolved session — empty <main>, empty sidebar, the avatar showing "User" — and stay
  // that way, because RoleGuard holds a spinner behind its platform-admin check and never
  // gets to redirect. Scoring that as "the role reached the page" invents an RBAC bypass out
  // of a broken login. (It is how a duplicated `users` row for one QA account produced a
  // phantom nurse bypass across all five probe routes.) The screen was never delivered, so
  // the honest answer is "not reached".
  return !(await hasPageContent(page));
}

/**
 * Did the routed screen actually render? Content inside `<main>` is the signal — the header,
 * sidebar and toast regions render for everyone, resolved session or not.
 */
async function hasPageContent(page: Page): Promise<boolean> {
  const main = page.locator('main').first();
  const scope = (await main.count()) ? main : page.locator('body');
  const text = (await scope.innerText().catch(() => '')).trim();
  if (text.length > 0) return true;
  return (await scope.locator('input, button, select, textarea, table, h1, h2').count()) > 0;
}

/** Assert the console stayed clean. Call at the end of a happy-path spec. */
export function expectNoConsoleErrors(errors: string[], allow: RegExp[] = []): void {
  const real = errors.filter(e => !allow.some(rx => rx.test(e)));
  expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
}
