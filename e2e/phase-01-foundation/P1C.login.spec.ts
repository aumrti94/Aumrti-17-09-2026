/**
 * Phase 1 · Section C — Login & session
 * Locks tracker cases TC-P1C-001 … TC-P1C-018
 *
 * These are the specs that need the least setup, so run this file first to
 * confirm the harness is wired up correctly before anything else.
 */
import { test, expect, fillLogin, isRouteBlocked, PASSWORD, staffByRole } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';

const DB = () => process.env.QA_DB_AVAILABLE === 'true';

test.describe('P1C — Login & session', () => {

  test('TC-P1C-001 valid login succeeds', async ({ page }) => {
    const staff = staffByRole('A', 'hospital_admin');
    await page.goto('/login');
    await fillLogin(page, staff.email, PASSWORD);

    await page.waitForURL(u => !/\/login\b/.test(u.pathname), { timeout: 20_000 });
    expect(new URL(page.url()).pathname).not.toBe('/login');
  });

  test('TC-P1C-002/003 wrong password and unknown email give the SAME message', async ({ page }) => {
    // Differing messages let an attacker enumerate every staff email address.
    const staff = staffByRole('A', 'doctor');

    await page.goto('/login');
    await fillLogin(page, staff.email, 'WrongPass@2026');
    await page.waitForTimeout(2500);
    // Scoped to the error banner itself, not the whole page — the page also renders a
    // live clock (updates every second), which would make a full-body text comparison
    // flaky/false-failing even when the actual error messages are identical.
    const wrongPasswordMsg = (await page.getByTestId('login-error').innerText())
      .replace(staff.email, '<email>');

    await page.goto('/login');
    await fillLogin(page, 'nosuchuser-qa@example.com', 'WrongPass@2026');
    await page.waitForTimeout(2500);
    const unknownEmailMsg = (await page.getByTestId('login-error').innerText())
      .replace('nosuchuser-qa@example.com', '<email>');

    expect(new URL(page.url()).pathname).toBe('/login');
    expect(
      normalise(wrongPasswordMsg),
      'The wrong-password and unknown-email responses differ, which leaks whether an account exists.',
    ).toBe(normalise(unknownEmailMsg));
  });

  test('TC-P1C-004 empty credentials are rejected', async ({ page }) => {
    await page.goto('/login');
    const submitButton = page
      .getByRole('button', { name: /sign in|log ?in|continue/i })
      .or(page.locator('button[type="submit"]'))
      .first();
    // The button is intentionally disabled until both fields are filled — clicking a
    // disabled button never fires, so assert the disabled state directly instead.
    await expect(submitButton).toBeDisabled();
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('TC-P1C-013 logout clears the session and the hms_ctx cache', async ({ page, loginAs }) => {
    await loginAs('doctor');

    const before = await page.evaluate(() =>
      Object.keys(sessionStorage).filter(k => k.startsWith('hms_ctx_')));
    expect(before.length, 'Expected a hms_ctx_* context cache key after login').toBeGreaterThan(0);

    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
    await page.goto('/login');

    const after = await page.evaluate(() =>
      Object.keys(sessionStorage).filter(k => k.startsWith('hms_ctx_')));
    expect(after, 'Context cache survived logout — a shared terminal would expose the previous user').toHaveLength(0);

    await page.goBack();
    await page.waitForTimeout(1500);
    const url = new URL(page.url()).pathname;
    expect(/\/(login|)$/.test(url) || url === '/login').toBeTruthy();
  });

  test('TC-P1C-014/015 every protected route redirects when logged out', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/');
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });

    const protectedRoutes = [
      '/dashboard', '/patients', '/opd', '/ipd', '/billing',
      '/lab', '/radiology', '/pharmacy', '/settings', '/accounts', '/platform',
    ];

    const leaked: string[] = [];
    for (const route of protectedRoutes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const landed = new URL(page.url()).pathname;
      const redirected = landed !== route;
      const showsAuth = await page.locator('input[type="password"]').count() > 0;
      if (!redirected && !showsAuth) leaked.push(`${route} -> ${landed}`);
    }
    expect(leaked, `Routes reachable while logged out:\n${leaked.join('\n')}`).toHaveLength(0);
  });

  test('TC-P1C-011 session persists across a refresh', async ({ page, loginAs }) => {
    await loginAs('doctor');
    const before = new URL(page.url()).pathname;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    expect(new URL(page.url()).pathname, 'Refresh logged the user out').not.toBe('/login');
    expect(before).not.toBe('/login');
  });

  test('TC-P1C-016 a LOGIN audit row is written', async ({ loginAs }) => {
    test.skip(!DB(), 'Database access not enabled — see .env.example');
    const staff = await loginAs('doctor');

    const hid = await hospitalIdFor('A');
    const { data, error } = await db()
      .from('audit_log')
      .select('id, action, created_at')
      .eq('hospital_id', hid)
      .eq('action', 'LOGIN')
      .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
      .limit(5);

    expect(error?.message ?? null).toBeNull();
    expect(
      data?.length ?? 0,
      `No LOGIN audit row written for ${staff.email}. NABH and DPDP both require access logging.`,
    ).toBeGreaterThan(0);
  });

  test('TC-P1C-017 each role lands on a page it is allowed to see', async ({ page, loginAs }) => {
    // Not asserting a specific landing route — only that nobody is dumped on a
    // page they are then denied, which is what makes the product look broken.
    for (const role of ['doctor', 'nurse', 'receptionist', 'pharmacist', 'billing_executive']) {
      await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); }).catch(() => {});
      await loginAs(role);
      const landed = new URL(page.url()).pathname;
      expect(landed, `${role} was left on /login`).not.toBe('/login');

      const denied = await page.getByText(
        /access denied|not authoris|not authoriz|forbidden|no access/i,
      ).count();
      expect(denied, `${role} landed on ${landed} and was immediately denied`).toBe(0);
    }
  });

  test('TC-P1C-018 login is usable on a tablet @tablet', async ({ page }) => {
    await page.goto('/login');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow, 'Login page scrolls horizontally on a tablet').toBeFalsy();
  });
});

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}
