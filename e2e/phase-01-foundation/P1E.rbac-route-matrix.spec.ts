/**
 * Phase 1 · Section E — RBAC route matrix
 * Locks tracker cases TC-P1E-001 … TC-P1E-045
 *
 * Data-driven rather than one spec per role: adding a seventeenth role is a
 * one-line change here, not seventeen new files.
 *
 * Source of truth for the expectations: src/lib/routeRoles.ts
 */
import { test, expect, isRouteBlocked } from '../fixtures/auth.fixture';

interface RoleMatrix {
  role: string;
  allowed: string[];
  blocked: string[];
}

/** Core routes every authenticated user may reach (see hasAccess coreRoutes). */
const CORE_ROUTES = ['/dashboard', '/modules', '/settings/profile', '/inbox', '/my-hr'];

const MATRIX: RoleMatrix[] = [
  {
    role: 'hospital_admin',                                   // bypass role
    allowed: ['/dashboard', '/patients', '/opd', '/ipd', '/lab', '/radiology',
              '/pharmacy', '/billing', '/accounts', '/insurance', '/hr', '/inventory', '/settings'],
    blocked: ['/platform'],
  },
  {
    role: 'doctor',
    allowed: ['/dashboard', '/opd', '/ipd', '/patients', '/lab', '/radiology', '/schedule'],
    blocked: ['/hr', '/accounts', '/settings', '/platform'],
  },
  {
    role: 'nurse',
    allowed: ['/dashboard', '/nursing', '/ipd', '/patients'],
    blocked: ['/billing', '/accounts', '/hr', '/settings', '/platform'],
  },
  {
    role: 'receptionist',
    allowed: ['/dashboard', '/patients', '/opd', '/schedule'],
    blocked: ['/ipd', '/lab', '/pharmacy', '/accounts', '/hr', '/settings', '/platform'],
  },
  {
    role: 'pharmacist',
    allowed: ['/pharmacy'],
    blocked: ['/ipd', '/billing', '/hr', '/settings', '/platform'],
  },
  {
    role: 'lab_technician',
    allowed: ['/lab'],
    blocked: ['/radiology', '/billing', '/hr', '/platform'],
  },
  {
    role: 'lab_tech',                                          // duplicate role, same job
    allowed: ['/lab'],
    blocked: ['/radiology', '/billing', '/platform'],
  },
  {
    role: 'radiologist',
    allowed: ['/radiology'],
    blocked: ['/lab', '/pharmacy', '/hr', '/platform'],
  },
  {
    role: 'billing_executive',
    allowed: ['/billing', '/billing/closure', '/payments', '/insurance', '/accounts'],
    blocked: ['/hr', '/settings', '/platform'],
  },
  {
    role: 'billing_staff',
    allowed: ['/billing'],
    // Day closure locks the cash books — deliberately excluded from billing_staff.
    blocked: ['/billing/closure', '/hr', '/settings', '/platform'],
  },
  {
    role: 'accountant',
    allowed: ['/accounts', '/accounts/chart-of-accounts', '/accounts/journal-workbench'],
    blocked: ['/opd', '/ipd', '/patients', '/lab', '/platform'],
  },
  {
    role: 'cfo',
    allowed: ['/accounts/financial-statements', '/accounts/budget',
              '/accounts/fixed-assets', '/analytics/revenue-intelligence'],
    blocked: ['/opd', '/ipd', '/patients', '/platform'],
  },
  {
    role: 'hr_manager',
    allowed: ['/hr'],
    blocked: ['/opd', '/billing', '/accounts', '/platform'],
  },
  {
    role: 'insurance_executive',
    allowed: ['/insurance'],
    blocked: ['/hr', '/accounts', '/platform'],
  },
  {
    role: 'mrd_officer',
    allowed: ['/mrd'],
    blocked: ['/billing', '/hr', '/platform'],
  },
];

test.describe('P1E — RBAC route matrix', () => {

  for (const { role, allowed, blocked } of MATRIX) {

    test(`TC-P1E ${role} reaches its permitted routes`, async ({ page, loginAs }) => {
      await loginAs(role);
      const wrongly: string[] = [];
      for (const route of allowed) {
        if (await isRouteBlocked(page, route)) wrongly.push(route);
      }
      expect(
        wrongly,
        `"${role}" was BLOCKED from routes it should reach:\n  ${wrongly.join('\n  ')}`,
      ).toHaveLength(0);
    });

    test(`TC-P1E ${role} is blocked from routes it must not reach`, async ({ page, loginAs }) => {
      await loginAs(role);
      const leaked: string[] = [];
      for (const route of blocked) {
        if (!(await isRouteBlocked(page, route))) leaked.push(route);
      }
      expect(
        leaked,
        `SECURITY: "${role}" REACHED routes it must not:\n  ${leaked.join('\n  ')}`,
      ).toHaveLength(0);
    });
  }

  test('TC-P1E-027 every role reaches the core routes', async ({ page, loginAs }) => {
    // 15 roles x 5 core routes, each via a full UI login + isRouteBlocked's mandatory
    // 1200ms settle wait — comfortably exceeds the global 60s default on sleep time alone.
    test.setTimeout(180_000);
    const failures: string[] = [];
    for (const { role } of MATRIX) {
      await loginAs(role);
      for (const route of CORE_ROUTES) {
        if (await isRouteBlocked(page, route)) failures.push(`${role} -> ${route}`);
      }
    }
    expect(
      failures,
      `Core routes must be open to every authenticated user:\n  ${failures.join('\n  ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1E-029 no hospital role can reach /platform', async ({ page, loginAs }) => {
    // /platform is your SaaS console. One role slipping through exposes every
    // hospital on the system, not just this one.
    const leaked: string[] = [];
    for (const { role } of MATRIX) {
      await loginAs(role);
      if (!(await isRouteBlocked(page, '/platform'))) leaked.push(role);
    }
    expect(
      leaked,
      `SECURITY: these hospital roles reached the platform console: ${leaked.join(', ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1E-031 a blocked route does not fetch data before redirecting', async ({ page, loginAs }) => {
    await loginAs('nurse');

    const dataRequests: string[] = [];
    // Only attribute requests while still on/navigating to the blocked route — RoleGuard
    // redirects to /dashboard on denial (a client-side SPA swap, no reload), and /dashboard
    // has its own legitimate data fetches that must not be misattributed to /accounts.
    page.on('request', req => {
      if (new URL(page.url()).pathname.replace(/\/$/, '') !== '/accounts') return;
      const u = req.url();
      if (/\/rest\/v1\/(bills|journal_entries|chart_of_accounts|bill_payments)/.test(u)) {
        dataRequests.push(u);
      }
    });

    await page.goto('/accounts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    expect(
      dataRequests,
      `A blocked route still requested financial data — it has already reached the ` +
      `browser, so this is a leak even though the page redirected:\n  ${dataRequests.join('\n  ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1E-037/038 query strings and trailing slashes do not bypass the guard', async ({ page, loginAs }) => {
    await loginAs('nurse');
    for (const variant of ['/accounts?tab=journals', '/accounts/', '/accounts']) {
      expect(
        await isRouteBlocked(page, variant),
        `Path normalisation failed — "${variant}" was reachable by a nurse`,
      ).toBeTruthy();
    }
  });

  test('TC-P1E-039 an unknown route shows a clean 404', async ({ page, loginAs, consoleErrors }) => {
    await loginAs('doctor');
    await page.goto('/this-route-does-not-exist-qa', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    const body = await page.locator('body').innerText();
    expect(body.trim().length, 'Unknown route rendered a blank page').toBeGreaterThan(0);
    expect(body, 'A stack trace is exposed on the 404 page').not.toMatch(/at\s+\w+\s+\(.*\.tsx?:\d+/);

    const fatal = consoleErrors.filter(e => /ChunkLoadError|Uncaught/.test(e));
    expect(fatal, `Unknown route threw:\n${fatal.join('\n')}`).toHaveLength(0);
  });

  test('TC-P1E-045 browser Back after a block does not grant access', async ({ page, loginAs }) => {
    await loginAs('nurse');
    await page.goto('/nursing', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await page.goto('/accounts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await page.goBack();
    await page.waitForTimeout(1500);
    await page.goForward();
    await page.waitForTimeout(1500);

    const onAccounts = new URL(page.url()).pathname.replace(/\/$/, '') === '/accounts';
    if (onAccounts) {
      const denied = await page.getByText(
        /access denied|not authoris|not authoriz|forbidden|no access/i,
      ).count();
      expect(denied, 'History navigation landed on /accounts with real content').toBeGreaterThan(0);
    }
  });
});
