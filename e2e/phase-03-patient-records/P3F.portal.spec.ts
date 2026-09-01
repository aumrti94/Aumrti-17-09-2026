/**
 * Phase 3 · Section F — Patient portal (P3-S08)
 * Locks tracker cases TC-P3F-001 … TC-P3F-010
 *
 * PatientPortalLogin.tsx authenticates via Supabase Auth EMAIL OTP — there is no password
 * login, so a real inbox is normally required. Rather than leaving this whole section
 * MANUAL-ONLY, `loginToPortal()` below mints a real Supabase session using the SERVICE-ROLE
 * client's `auth.admin.generateLink({ type: 'magiclink' })`, then opens the returned action
 * link directly in the browser. That link is Supabase's own verify endpoint — it redirects to
 * `redirectTo` with the session tokens in the URL hash, which the app's Supabase client
 * (default `detectSessionInUrl: true`) picks up automatically on load. This requires Email
 * OTP / magic-link to be enabled for the QA Supabase project's Auth settings (see the header
 * comment in PatientPortalLogin.tsx) — if generateLink errors, that setting is the first thing
 * to check, per docs/qa/README.md's "framework work, not a product defect" rule.
 *
 * This is also how the RLS question raised during code review gets a real answer instead of a
 * guess from reading migrations: the OTP-authenticated Supabase Auth user has no row in
 * `users`, so `get_user_hospital_id()` returns NULL. TC-P3F-002/003/004 prove live whether a
 * genuine patient session sees its own data or silently sees none.
 *
 * FIRST LIVE RUN RESULT (read from docs/qa/results/latest.json): TC-P3F-001/005/006/010 all got
 * stuck on `/portal?h=...` and never reached /portal/dashboard or the profile picker, while
 * TC-P3F-007 (the ONE case that expects "0 matches → Create Profile") passed, and TC-P3F-008
 * (self-service create) failed with "no patient row was created." Together that is exactly the
 * signature the RLS hypothesis above predicts: EVERY login looks like "0 matches," whether a
 * real match exists or not, because RLS silently excludes an OTP session from every read AND
 * write on `patients`. `loginToPortal()` now confirms the browser session was actually
 * established (rules out a redirect-URL/harness misconfiguration) before handing back — if that
 * check ever throws, the problem is the test harness, not the app; if it doesn't throw and
 * TC-P3F-001/005/006/010 still fail, that is this RLS defect, not a test bug — do not "fix" it
 * by loosening the assertions. See PHASE_MAP.md Finding #7 / candidate BUG-P3-NNN (routed to
 * Meera per .agents/agents.md — she owns RLS policy).
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectNoRow } from '../utils/db-verify';
import { TEST_ENV } from '../utils/env';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const PORTAL = MOCK.phase3.portal as {
  singleMatchEmail: string; multiMatchEmail: string; noMatchEmail: string;
  createProfile: { fullName: string; phone: string; dob: string };
};

async function loginToPortal(page: import('@playwright/test').Page, email: string, hospitalId: string): Promise<void> {
  const redirectTo = `${TEST_ENV.baseURL}/portal?h=${hospitalId}`;
  const { data, error } = await db().auth.admin.generateLink({
    type: 'magiclink', email, options: { redirectTo },
  });
  if (error) {
    throw new Error(
      `auth.admin.generateLink failed for ${email}: ${error.message}. Check that Email OTP / ` +
      `magic-link is enabled under Supabase Auth → Providers → Email for this QA project.`,
    );
  }
  const link = (data as any)?.properties?.action_link ?? (data as any)?.action_link;
  if (!link) throw new Error('generateLink returned no action_link.');
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Disambiguate "session never established" (a harness/redirect-URL config problem) from
  // "session established but the app still can't find/create the patient" (the RLS defect).
  const hasSession = await page.evaluate(
    () => Object.keys(localStorage).some(k => k.includes('auth-token') || k.includes('auth_token')),
  );
  if (!hasSession) {
    throw new Error(
      `No Supabase auth session was found in localStorage after opening the magic link for ` +
      `${email}. This points at the TEST HARNESS, not the app — check that "${redirectTo}" is ` +
      `on Supabase Auth's allowed redirect URL list (Authentication → URL Configuration).`,
    );
  }
}

/** Asserts the portal actually progressed past the login screen — the common precondition every
 * "own data only, not another patient's" negative check below needs BEFORE it can mean anything.
 * Without this, a broken login (stuck on the login screen, no patient data of ANY kind loaded)
 * makes every "no leaked data" assertion pass vacuously for the wrong reason. */
async function expectLeftLoginScreen(page: import('@playwright/test').Page): Promise<void> {
  await expect(
    page.getByText(/create your profile|select your profile/i),
    'The portal is still showing the login/profile-selection screen — this negative check ' +
    'cannot mean anything about data isolation until login itself succeeds. If this is failing, ' +
    'it is very likely the same RLS gap TC-P3F-001 documents, not a bug in this specific case.',
  ).toHaveCount(0, { timeout: 15_000 });
}

async function purgeByEmail(hid: string, ...emails: string[]): Promise<void> {
  if (!DB_ON()) return;
  await db().from('patients').update({ email: null }).eq('hospital_id', hid).in('email', emails);
  await db().from('patients').delete().eq('hospital_id', hid).eq('full_name', PORTAL.createProfile.fullName);
}

test.describe('P3F — Patient portal', () => {
  test.afterAll(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await purgeByEmail(hid, PORTAL.singleMatchEmail, PORTAL.multiMatchEmail, PORTAL.noMatchEmail);
  });

  test('TC-P3F-001 A single-match email lands directly on the portal dashboard', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('patients').update({ email: PORTAL.singleMatchEmail }).eq('hospital_id', hid).eq('uhid', 'PT-QA-0002');

    await loginToPortal(page, PORTAL.singleMatchEmail, hid);
    await expect(
      page,
      'Login did not reach /portal/dashboard for an email matching exactly one active patient. ' +
      'If the session WAS established (loginToPortal did not throw), this is very likely the RLS ' +
      'gap this program flagged as a risk: an OTP session has no `users` row, so ' +
      'get_user_hospital_id() is NULL and every patients RLS policy silently excludes it — ' +
      'findPatients() sees 0 rows regardless of whether a match exists. Do not loosen this ' +
      'assertion; log/confirm BUG-P3-NNN instead (see PHASE_MAP.md).',
    ).toHaveURL(/\/portal\/dashboard/, { timeout: 15_000 });
    await expect(page.getByText(/Sunita Reddy/i)).toBeVisible();
  });

  test('TC-P3F-002 A portal session can see its own bills but not another patient\'s', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('patients').update({ email: PORTAL.singleMatchEmail }).eq('hospital_id', hid).eq('uhid', 'PT-QA-0002');
    const patient = await db().from('patients').select('id').eq('hospital_id', hid).eq('uhid', 'PT-QA-0002').maybeSingle();

    await loginToPortal(page, PORTAL.singleMatchEmail, hid);
    await page.goto(`/portal/bills?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await expectLeftLoginScreen(page);

    const bodyText = await page.locator('body').innerText();
    // The definitive negative proof: no OTHER patient's bill number appears on this page.
    const { data: otherBills } = await db().from('bills').select('bill_number')
      .eq('hospital_id', hid).neq('patient_id', patient.data?.id).limit(20);
    const leaked = (otherBills ?? []).filter(b => bodyText.includes(b.bill_number));
    expect(
      leaked,
      `Portal /portal/bills page contains another patient's bill number(s): ${leaked.map(b => b.bill_number).join(', ')}.`,
    ).toEqual([]);
  });

  test('TC-P3F-003 A portal session can see its own reports but not another patient\'s', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('patients').update({ email: PORTAL.singleMatchEmail }).eq('hospital_id', hid).eq('uhid', 'PT-QA-0002');

    await loginToPortal(page, PORTAL.singleMatchEmail, hid);
    await page.goto(`/portal/reports?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await expectLeftLoginScreen(page);
  });

  test('TC-P3F-004 A portal session shows only its own upcoming appointments', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('patients').update({ email: PORTAL.singleMatchEmail }).eq('hospital_id', hid).eq('uhid', 'PT-QA-0002');
    const patient = await db().from('patients').select('id').eq('hospital_id', hid).eq('uhid', 'PT-QA-0002').maybeSingle();

    await loginToPortal(page, PORTAL.singleMatchEmail, hid);
    await page.goto(`/portal/appointments?h=${hid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await expectLeftLoginScreen(page);

    const { data: otherTokens } = await db().from('opd_tokens').select('token_number')
      .eq('hospital_id', hid).neq('patient_id', patient.data?.id).limit(20);
    const bodyText = await page.locator('body').innerText();
    const leaked = (otherTokens ?? []).filter(t => bodyText.includes(t.token_number));
    expect(leaked, `Portal /portal/appointments shows another patient's token(s): ${leaked.map(t => t.token_number).join(', ')}.`).toEqual([]);
  });

  test('TC-P3F-005 An email matching more than one patient record shows a profile picker', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('patients').update({ email: PORTAL.multiMatchEmail }).eq('hospital_id', hid).in('uhid', ['PT-QA-0002', 'PT-QA-0003']);

    await loginToPortal(page, PORTAL.multiMatchEmail, hid);
    await expect(
      page.getByText(/select your profile/i),
      'Profile picker never appeared for an email matching 2 patients — see the file header ' +
      'note: likely the same RLS gap as TC-P3F-001, not a bug specific to this case.',
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Sunita Reddy/i)).toBeVisible();
    await expect(page.getByText(/Anitha Menon/i)).toBeVisible();
  });

  test('TC-P3F-006 Selecting a profile from the picker logs in as that specific patient only', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('patients').update({ email: PORTAL.multiMatchEmail }).eq('hospital_id', hid).in('uhid', ['PT-QA-0002', 'PT-QA-0003']);

    await loginToPortal(page, PORTAL.multiMatchEmail, hid);
    await expect(page.getByText(/select your profile/i)).toBeVisible({ timeout: 15_000 });
    await page.getByText(/Anitha Menon/i).first().click();
    await expect(page).toHaveURL(/\/portal\/dashboard/, { timeout: 15_000 });
    await expect(page.getByText(/Anitha Menon/i)).toBeVisible();
    expect(await page.getByText(/Sunita Reddy/i).count()).toBe(0);
  });

  test('TC-P3F-007 An email matching zero patient records shows the self-service Create Profile form', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await expectNoRow('patients', { hospital_id: hid, email: PORTAL.noMatchEmail });

    await loginToPortal(page, PORTAL.noMatchEmail, hid);
    await expect(page.getByText(/create your profile/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PORTAL.noMatchEmail)).toBeVisible();
  });

  test('TC-P3F-008 Self-service profile creation issues a THIRD, distinct UHID series', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await loginToPortal(page, PORTAL.noMatchEmail, hid);
    await expect(page.getByText(/create your profile/i)).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder(/as on your id/i).fill(PORTAL.createProfile.fullName);
    await page.getByPlaceholder(/10-digit number/i).fill(PORTAL.createProfile.phone);
    await page.getByRole('button', { name: /create profile & continue/i }).click();
    await page.waitForTimeout(2000);

    const row = await db().from('patients').select('uhid').eq('hospital_id', hid).eq('full_name', PORTAL.createProfile.fullName).maybeSingle();
    expect(row.data?.uhid, 'No patient row was created by self-service profile creation.').toBeTruthy();
    expect(
      /^PAT-\d{4}-[A-Z0-9]{6}$/.test(row.data!.uhid),
      `Expected the self-service UHID "${row.data!.uhid}" to match PAT-YYYY-XXXXXX — a THIRD series distinct from staff registration and the kiosk's "K..." series.`,
    ).toBeTruthy();
  });

  test('TC-P3F-009 A soft-deleted patient cannot be found by portal login', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // CAVEAT: while the RLS gap documented in TC-P3F-001 stands, EVERY login shows "Create Your
    // Profile" regardless of is_active — so a pass here does not yet distinguish "correctly
    // excluded because inactive" from "excluded because RLS blocks everyone." Re-verify this
    // case specifically once TC-P3F-001 passes for a genuine active match.
    const hid = await hospitalIdFor('A');
    await db().from('patients').update({ email: PORTAL.singleMatchEmail, is_active: false })
      .eq('hospital_id', hid).eq('uhid', 'PT-QA-0002');

    try {
      await loginToPortal(page, PORTAL.singleMatchEmail, hid);
      // is_active=true patients see the dashboard directly; a soft-deleted one must fall
      // through to Create Profile instead, since findPatients() filters is_active=true.
      await expect(page.getByText(/create your profile/i)).toBeVisible({ timeout: 15_000 });
    } finally {
      await db().from('patients').update({ is_active: true }).eq('hospital_id', hid).eq('uhid', 'PT-QA-0002');
    }
  });

  test('TC-P3F-010 A Hospital B patient\'s portal session cannot see Hospital A data by guessing the URL', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hidA = await hospitalIdFor('A');
    const hidB = await hospitalIdFor('B');
    const emailB = 'yeswanthvarma94+qa.portal.hospb@gmail.com';
    await db().from('patients').update({ email: emailB }).eq('hospital_id', hidB).eq('uhid', 'PT-QA-0030');

    await loginToPortal(page, emailB, hidB);
    await expect(page).toHaveURL(/\/portal\/dashboard/, { timeout: 15_000 });

    // Tamper the URL's hospital param to Hospital A and see what the bills page shows.
    await page.goto(`/portal/bills?h=${hidA}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const { data: hospAOnlyBills } = await db().from('bills').select('bill_number').eq('hospital_id', hidA).limit(20);
    const bodyText = await page.locator('body').innerText();
    const leaked = (hospAOnlyBills ?? []).filter(b => bodyText.includes(b.bill_number));
    expect(
      leaked,
      `A Hospital B patient session saw Hospital A bill number(s) after editing ?h= in the URL: ${leaked.map(b => b.bill_number).join(', ')}.`,
    ).toEqual([]);

    await db().from('patients').update({ email: null }).eq('hospital_id', hidB).eq('uhid', 'PT-QA-0030');
  });
});
