# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase-01-foundation\P1C.login.spec.ts >> P1C — Login & session >> TC-P1C-013 logout clears the session and the hms_ctx cache
- Location: e2e\phase-01-foundation\P1C.login.spec.ts:58:3

# Error details

```
Error: page.waitForURL: Target page, context or browser has been closed
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Test source

```ts
  1   | /**
  2   |  * Shared Playwright fixtures.
  3   |  *
  4   |  * Two things every Phase 1 spec needs:
  5   |  *   loginAs(role)     — sign in through the real UI as a seeded staff member
  6   |  *   consoleErrors     — collected red console text, so a spec can assert the
  7   |  *                       page is clean as well as functionally correct
  8   |  */
  9   | import { test as base, expect, type Page } from '@playwright/test';
  10  | import { MOCK, PASSWORD, staffByRole, type Staff } from './mock-data';
  11  | import { TEST_ENV } from '../utils/env';
  12  | 
  13  | export interface AumrtiFixtures {
  14  |   loginAs: (role: string, opts?: { hospital?: 'A' | 'B'; index?: number }) => Promise<Staff>;
  15  |   logout: () => Promise<void>;
  16  |   consoleErrors: string[];
  17  | }
  18  | 
  19  | export const test = base.extend<AumrtiFixtures>({
  20  |   consoleErrors: async ({ page }, use) => {
  21  |     const errors: string[] = [];
  22  |     page.on('console', msg => {
  23  |       if (msg.type() === 'error') errors.push(msg.text());
  24  |     });
  25  |     page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));
  26  |     await use(errors);
  27  |   },
  28  | 
  29  |   loginAs: async ({ page }, use) => {
  30  |     await use(async (role, opts = {}) => {
  31  |       const hospital = opts.hospital ?? 'A';
  32  |       const staff = staffByRole(hospital, role, opts.index ?? 0);
  33  | 
  34  |       await page.goto('/login');
  35  |       await fillLogin(page, staff.email, PASSWORD);
  36  | 
  37  |       // Land anywhere authenticated — the specific landing route is itself
  38  |       // under test in P1C, so we deliberately do not assert it here.
> 39  |       await page.waitForURL(url => !/\/login\b/.test(url.pathname), { timeout: 20_000 });
      |                  ^ Error: page.waitForURL: Target page, context or browser has been closed
  40  |       return staff;
  41  |     });
  42  |   },
  43  | 
  44  |   logout: async ({ page }, use) => {
  45  |     await use(async () => {
  46  |       await page.evaluate(() => {
  47  |         sessionStorage.clear();
  48  |         localStorage.clear();
  49  |       });
  50  |       await page.goto('/login');
  51  |     });
  52  |   },
  53  | });
  54  | 
  55  | export { expect, MOCK, PASSWORD, staffByRole, TEST_ENV };
  56  | 
  57  | /**
  58  |  * Login form filler.
  59  |  *
  60  |  * Uses accessible-name lookups with a fallback to input types, so it survives
  61  |  * label wording changes. If your login form uses different labels, this is the
  62  |  * ONE place to adjust it.
  63  |  */
  64  | export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  65  |   const emailField = page
  66  |     .getByLabel(/email/i)
  67  |     .or(page.getByPlaceholder(/email/i))
  68  |     .or(page.locator('input[type="email"]'))
  69  |     .first();
  70  |   const passwordField = page
  71  |     .getByLabel(/password/i)
  72  |     .or(page.getByPlaceholder(/password/i))
  73  |     .or(page.locator('input[type="password"]'))
  74  |     .first();
  75  | 
  76  |   await emailField.fill(email);
  77  |   await passwordField.fill(password);
  78  | 
  79  |   await page
  80  |     .getByRole('button', { name: /sign in|log ?in|continue/i })
  81  |     .or(page.locator('button[type="submit"]'))
  82  |     .first()
  83  |     .click();
  84  | }
  85  | 
  86  | /**
  87  |  * Did navigating to `path` actually give this user the page?
  88  |  *
  89  |  * "Blocked" covers every legitimate shape: a redirect away, a 403/permission
  90  |  * message, or a plan-gate upsell. What it must never be is the real content.
  91  |  */
  92  | export async function isRouteBlocked(page: Page, path: string): Promise<boolean> {
  93  |   await page.goto(path, { waitUntil: 'domcontentloaded' });
  94  |   await page.waitForTimeout(1200);           // allow client-side guards to settle
  95  | 
  96  |   const landed = new URL(page.url()).pathname.replace(/\/$/, '');
  97  |   const wanted = path.split('?')[0].replace(/\/$/, '');
  98  |   if (landed !== wanted) return true;        // redirected away
  99  | 
  100 |   const denial = page.getByText(
  101 |     /access denied|not authoris|not authoriz|permission|forbidden|no access|upgrade your plan|not included in your plan|404|not found/i,
  102 |   );
  103 |   return (await denial.count()) > 0;
  104 | }
  105 | 
  106 | /** Assert the console stayed clean. Call at the end of a happy-path spec. */
  107 | export function expectNoConsoleErrors(errors: string[], allow: RegExp[] = []): void {
  108 |   const real = errors.filter(e => !allow.some(rx => rx.test(e)));
  109 |   expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  110 | }
  111 | 
```