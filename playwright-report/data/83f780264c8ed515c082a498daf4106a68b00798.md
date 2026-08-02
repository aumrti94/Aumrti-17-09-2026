# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase-01-foundation\P1C.login.spec.ts >> P1C — Login & session >> TC-P1C-004 empty credentials are rejected
- Location: e2e\phase-01-foundation\P1C.login.spec.ts:47:3

# Error details

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: /sign in|log ?in|continue/i }).or(locator('button[type="submit"]')).first()
    - locator resolved to <button disabled class="w-full h-12 bg-primary text-primary-foreground rounded-lg text-[15px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 100ms
    12 × waiting for element to be visible, enabled and stable
       - element is not enabled
     - retrying click action
       - waiting 500ms

```

# Test source

```ts
  1   | /**
  2   |  * Phase 1 · Section C — Login & session
  3   |  * Locks tracker cases TC-P1C-001 … TC-P1C-018
  4   |  *
  5   |  * These are the specs that need the least setup, so run this file first to
  6   |  * confirm the harness is wired up correctly before anything else.
  7   |  */
  8   | import { test, expect, fillLogin, isRouteBlocked, PASSWORD, staffByRole } from '../fixtures/auth.fixture';
  9   | import { db, hospitalIdFor } from '../utils/db-verify';
  10  | 
  11  | const DB = () => process.env.QA_DB_AVAILABLE === 'true';
  12  | 
  13  | test.describe('P1C — Login & session', () => {
  14  | 
  15  |   test('TC-P1C-001 valid login succeeds', async ({ page }) => {
  16  |     const staff = staffByRole('A', 'hospital_admin');
  17  |     await page.goto('/login');
  18  |     await fillLogin(page, staff.email, PASSWORD);
  19  | 
  20  |     await page.waitForURL(u => !/\/login\b/.test(u.pathname), { timeout: 20_000 });
  21  |     expect(new URL(page.url()).pathname).not.toBe('/login');
  22  |   });
  23  | 
  24  |   test('TC-P1C-002/003 wrong password and unknown email give the SAME message', async ({ page }) => {
  25  |     // Differing messages let an attacker enumerate every staff email address.
  26  |     const staff = staffByRole('A', 'doctor');
  27  | 
  28  |     await page.goto('/login');
  29  |     await fillLogin(page, staff.email, 'WrongPass@2026');
  30  |     await page.waitForTimeout(2500);
  31  |     const wrongPasswordMsg = (await page.locator('body').innerText())
  32  |       .replace(staff.email, '<email>');
  33  | 
  34  |     await page.goto('/login');
  35  |     await fillLogin(page, 'nosuchuser-qa@example.com', 'WrongPass@2026');
  36  |     await page.waitForTimeout(2500);
  37  |     const unknownEmailMsg = (await page.locator('body').innerText())
  38  |       .replace('nosuchuser-qa@example.com', '<email>');
  39  | 
  40  |     expect(new URL(page.url()).pathname).toBe('/login');
  41  |     expect(
  42  |       normalise(wrongPasswordMsg),
  43  |       'The wrong-password and unknown-email responses differ, which leaks whether an account exists.',
  44  |     ).toBe(normalise(unknownEmailMsg));
  45  |   });
  46  | 
  47  |   test('TC-P1C-004 empty credentials are rejected', async ({ page }) => {
  48  |     await page.goto('/login');
  49  |     await page
  50  |       .getByRole('button', { name: /sign in|log ?in|continue/i })
  51  |       .or(page.locator('button[type="submit"]'))
  52  |       .first()
> 53  |       .click();
      |        ^ Error: locator.click: Target page, context or browser has been closed
  54  |     await page.waitForTimeout(1500);
  55  |     expect(new URL(page.url()).pathname).toBe('/login');
  56  |   });
  57  | 
  58  |   test('TC-P1C-013 logout clears the session and the hms_ctx cache', async ({ page, loginAs }) => {
  59  |     await loginAs('doctor');
  60  | 
  61  |     const before = await page.evaluate(() =>
  62  |       Object.keys(sessionStorage).filter(k => k.startsWith('hms_ctx_')));
  63  |     expect(before.length, 'Expected a hms_ctx_* context cache key after login').toBeGreaterThan(0);
  64  | 
  65  |     await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  66  |     await page.goto('/login');
  67  | 
  68  |     const after = await page.evaluate(() =>
  69  |       Object.keys(sessionStorage).filter(k => k.startsWith('hms_ctx_')));
  70  |     expect(after, 'Context cache survived logout — a shared terminal would expose the previous user').toHaveLength(0);
  71  | 
  72  |     await page.goBack();
  73  |     await page.waitForTimeout(1500);
  74  |     const url = new URL(page.url()).pathname;
  75  |     expect(/\/(login|)$/.test(url) || url === '/login').toBeTruthy();
  76  |   });
  77  | 
  78  |   test('TC-P1C-014/015 every protected route redirects when logged out', async ({ page, context }) => {
  79  |     await context.clearCookies();
  80  |     await page.goto('/');
  81  |     await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  82  | 
  83  |     const protectedRoutes = [
  84  |       '/dashboard', '/patients', '/opd', '/ipd', '/billing',
  85  |       '/lab', '/radiology', '/pharmacy', '/settings', '/accounts', '/platform',
  86  |     ];
  87  | 
  88  |     const leaked: string[] = [];
  89  |     for (const route of protectedRoutes) {
  90  |       await page.goto(route, { waitUntil: 'domcontentloaded' });
  91  |       await page.waitForTimeout(1200);
  92  |       const landed = new URL(page.url()).pathname;
  93  |       const redirected = landed !== route;
  94  |       const showsAuth = await page.locator('input[type="password"]').count() > 0;
  95  |       if (!redirected && !showsAuth) leaked.push(`${route} -> ${landed}`);
  96  |     }
  97  |     expect(leaked, `Routes reachable while logged out:\n${leaked.join('\n')}`).toHaveLength(0);
  98  |   });
  99  | 
  100 |   test('TC-P1C-011 session persists across a refresh', async ({ page, loginAs }) => {
  101 |     await loginAs('doctor');
  102 |     const before = new URL(page.url()).pathname;
  103 |     await page.reload({ waitUntil: 'domcontentloaded' });
  104 |     await page.waitForTimeout(2000);
  105 |     expect(new URL(page.url()).pathname, 'Refresh logged the user out').not.toBe('/login');
  106 |     expect(before).not.toBe('/login');
  107 |   });
  108 | 
  109 |   test('TC-P1C-016 a LOGIN audit row is written', async ({ loginAs }) => {
  110 |     test.skip(!DB(), 'Database access not enabled — see .env.example');
  111 |     const staff = await loginAs('doctor');
  112 | 
  113 |     const hid = await hospitalIdFor('A');
  114 |     const { data, error } = await db()
  115 |       .from('audit_log')
  116 |       .select('id, action, created_at')
  117 |       .eq('hospital_id', hid)
  118 |       .eq('action', 'LOGIN')
  119 |       .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
  120 |       .limit(5);
  121 | 
  122 |     expect(error?.message ?? null).toBeNull();
  123 |     expect(
  124 |       data?.length ?? 0,
  125 |       `No LOGIN audit row written for ${staff.email}. NABH and DPDP both require access logging.`,
  126 |     ).toBeGreaterThan(0);
  127 |   });
  128 | 
  129 |   test('TC-P1C-017 each role lands on a page it is allowed to see', async ({ page, loginAs }) => {
  130 |     // Not asserting a specific landing route — only that nobody is dumped on a
  131 |     // page they are then denied, which is what makes the product look broken.
  132 |     for (const role of ['doctor', 'nurse', 'receptionist', 'pharmacist', 'billing_executive']) {
  133 |       await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); }).catch(() => {});
  134 |       await loginAs(role);
  135 |       const landed = new URL(page.url()).pathname;
  136 |       expect(landed, `${role} was left on /login`).not.toBe('/login');
  137 | 
  138 |       const denied = await page.getByText(
  139 |         /access denied|not authoris|not authoriz|forbidden|no access/i,
  140 |       ).count();
  141 |       expect(denied, `${role} landed on ${landed} and was immediately denied`).toBe(0);
  142 |     }
  143 |   });
  144 | 
  145 |   test('TC-P1C-018 login is usable on a tablet @tablet', async ({ page }) => {
  146 |     await page.goto('/login');
  147 |     const overflow = await page.evaluate(() =>
  148 |       document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  149 |     expect(overflow, 'Login page scrolls horizontally on a tablet').toBeFalsy();
  150 |   });
  151 | });
  152 | 
  153 | function normalise(text: string): string {
```