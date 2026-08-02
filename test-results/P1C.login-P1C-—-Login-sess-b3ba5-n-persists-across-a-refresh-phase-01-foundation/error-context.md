# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase-01-foundation\P1C.login.spec.ts >> P1C — Login & session >> TC-P1C-011 session persists across a refresh
- Location: e2e\phase-01-foundation\P1C.login.spec.ts:100:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 20000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - region "Notifications (F8)":
    - list
  - region "Notifications alt+T"
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - heading "Aumrti" [level=1] [ref=e6]
        - paragraph [ref=e7]: Monday, 27 July 2026
        - paragraph [ref=e8]: 12:32:30 pm
        - paragraph [ref=e10]: 🌅 Morning Shift
        - paragraph [ref=e11]:
          - text: Every login matters.
          - text: Every patient counts.
      - paragraph [ref=e12]: Powered by Aumrti
    - generic [ref=e14]:
      - img "Aumrti" [ref=e15]
      - paragraph [ref=e16]: Welcome back
      - heading "Sign in to continue" [level=2] [ref=e17]
      - generic [ref=e18]:
        - generic [ref=e19]:
          - text: Email Address
          - generic [ref=e20]:
            - img [ref=e21]
            - textbox "Enter your email" [ref=e24]: yeswanthvarma94+qa.doctor.a@gmail.com
        - generic [ref=e25]:
          - text: Password
          - generic [ref=e26]:
            - textbox "Enter your password" [ref=e27]: TestPass@2026
            - button [ref=e28] [cursor=pointer]:
              - img [ref=e29]
        - generic [ref=e32]:
          - generic [ref=e33] [cursor=pointer]:
            - checkbox "Remember me" [ref=e34]
            - generic [ref=e35]: Remember me
          - button "Forgot password?" [ref=e36] [cursor=pointer]
        - paragraph [ref=e37]: Invalid credentials. Please try again.
        - button "Sign In" [ref=e38] [cursor=pointer]:
          - text: Sign In
          - img [ref=e39]
        - generic [ref=e45]: or continue with
        - generic [ref=e46]:
          - button "Google" [ref=e47] [cursor=pointer]:
            - img [ref=e48]
            - text: Google
          - button "Microsoft" [ref=e53] [cursor=pointer]:
            - img [ref=e54]
            - text: Microsoft
          - button "Facebook" [ref=e59] [cursor=pointer]:
            - img [ref=e60]
            - text: Facebook
      - paragraph [ref=e63]:
        - text: Don't have an account?
        - button "Register your hospital →" [ref=e64] [cursor=pointer]
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
      |                  ^ TimeoutError: page.waitForURL: Timeout 20000ms exceeded.
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