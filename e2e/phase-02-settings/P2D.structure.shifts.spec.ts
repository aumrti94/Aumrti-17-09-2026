/**
 * Phase 2 · Section D — Structure: Shifts
 * Locks tracker cases TC-P2D-085 … TC-P2D-106
 *
 * REGRESSION LOCK FOR BUG-P2-002. Until Phase 2 QA this screen was a local-state mock: three
 * hardcoded shifts, and a Save that showed a green toast without issuing a single Supabase
 * call. Every hospital saw the same fake Morning/Afternoon/Night, its own shifts existed
 * nowhere, and `shift_master` stayed empty while rostering downstream had nothing to work from.
 *
 * The arithmetic case is the one that matters most: a night shift 22:00 → 06:00 is EIGHT
 * hours. Subtracting naively gives −16, and a negative duration flows straight into roster
 * hours and night-shift payroll. src/lib/shiftTiming.ts owns that logic and has its own
 * Vitest suite; TC-P2D-089 proves it survives the round trip through the database.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import { awaitSaveAck, reloadAndSettle, heading } from './settings-locators';

const ROUTE = '/settings/shifts';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const SHIFT = MOCK.phase2.entry[ROUTE] as { name: string; code: string };
const NIGHT = { name: SHIFT.name, code: SHIFT.code, start: '22:00', end: '06:00' };
const ZERO = MOCK.phase2.invalid.shiftZeroLength as { start: string; end: string };

const CREATED_CODES = ['NR', 'QAM', 'QX', 'QNS', 'QNE', 'QZS'];

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('shift_master').delete().eq('hospital_id', hid).in('shift_code', CREATED_CODES);
  await db().from('shift_master').delete().eq('hospital_id', hid).in('shift_name', ['QA No Code', 'QA Duplicate']);
}

/** The create row is the last table row; its inputs are positional. */
async function addShift(
  page: import('@playwright/test').Page,
  opts: { name?: string; code?: string; start?: string; end?: string },
): Promise<void> {
  await page.getByRole('button', { name: /add shift/i }).click();
  await page.waitForTimeout(400);

  const row = page.locator('tr').last();
  if (opts.name !== undefined) await row.getByPlaceholder('Name').fill(opts.name);
  if (opts.code !== undefined) await row.getByPlaceholder('Code').fill(opts.code);
  const times = row.locator('input[type="time"]');
  if (opts.start !== undefined) await times.nth(0).fill(opts.start);
  if (opts.end !== undefined) await times.nth(1).fill(opts.end);

  await row.getByRole('button', { name: /^save$/i }).click();
  await awaitSaveAck(page);
}

test.describe('P2D — Structure: Shifts', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  test('TC-P2D-085 Shifts screen loads its rows from shift_master rather than a hardcoded list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await expect(heading(page, 'Shifts')).toBeVisible();

    const hid = await hospitalIdFor('A');
    const { data } = await db().from('shift_master').select('shift_name').eq('hospital_id', hid);
    const stored = (data ?? []).map(r => r.shift_name);
    const body = await page.locator('body').innerText();

    if (stored.length === 0) {
      // The old mock always rendered these three regardless of the database.
      const ghosts = ['Morning', 'Afternoon', 'Night'].filter(n => new RegExp(`\\b${n}\\b`).test(body));
      expect(
        ghosts,
        `BUG-P2-002 REGRESSION: shift_master is empty for this hospital but the screen still ` +
        `renders ${ghosts.join(', ')}. Those are the hardcoded placeholders — the screen is ` +
        `not reading the database.`,
      ).toEqual([]);
    } else {
      const missing = stored.filter(n => !body.includes(n));
      expect(missing, `Stored shift(s) not rendered: ${missing.join(', ')}`).toEqual([]);
    }
  });

  test('TC-P2D-086 An empty shift list explains what to do next', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    test.skip(
      (await countRows('shift_master', { hospital_id: hid })) > 0,
      'Shifts already exist for this tenant, so the empty state cannot be observed',
    );

    await expect(
      page.getByText(/no shifts defined yet/i),
      'An empty grid reads as a loading failure. Naming what is missing is the difference ' +
      'between configuring shifts and raising a support ticket.',
    ).toBeVisible();
  });

  test('TC-P2D-087 Add Shift opens an inline row with blank fields', async ({ page }) => {
    await page.getByRole('button', { name: /add shift/i }).click();
    await page.waitForTimeout(400);

    const row = page.locator('tr').last();
    expect(await row.getByPlaceholder('Name').inputValue()).toBe('');
    expect(await row.getByPlaceholder('Code').inputValue()).toBe('');
    expect(
      await page.getByRole('button', { name: /add shift/i }).isDisabled(),
      'A second create row can be opened while the first is unsaved, which loses the first silently.',
    ).toBeTruthy();
  });

  test('TC-P2D-088 A new shift saves to shift_master', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, NIGHT);

    const row = await expectRow<{ shift_name: string; start_time: string; end_time: string }>(
      'shift_master', { hospital_id: hid, shift_code: 'NR' },
      'BUG-P2-002 REGRESSION: no shift_master row after a successful-looking save. This screen ' +
      'used to toast success and issue zero Supabase calls.',
    );
    expect(row.shift_name).toBe(NIGHT.name);
    expect(row.start_time).toMatch(/^22:00/);
    expect(row.end_time).toMatch(/^06:00/);
  });

  test('TC-P2D-089 A shift crossing midnight stores eight hours, not minus sixteen', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, NIGHT);

    const row = await expectRow<{ duration_hours: number }>('shift_master', { hospital_id: hid, shift_code: 'NR' });
    expect(
      Number(row.duration_hours),
      `duration_hours = ${row.duration_hours} for a 22:00→06:00 shift. Subtracting the times ` +
      `naively gives −16, and a negative duration flows straight into roster hours and ` +
      `night-shift payroll, so every nurse on nights is paid against a nonsense figure.`,
    ).toBe(8);
  });

  test('TC-P2D-090 A same-day shift stores its plain duration', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, { name: 'QA Morning', code: 'QAM', start: '07:00', end: '14:00' });

    const row = await expectRow<{ duration_hours: number }>('shift_master', { hospital_id: hid, shift_code: 'QAM' });
    expect(
      Number(row.duration_hours),
      'The midnight-wrap fix must not break the ordinary case — a rule that adds 24 hours ' +
      'unconditionally turns every day shift into a 31-hour one.',
    ).toBe(7);
  });

  test('TC-P2D-091 A shift cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, { code: 'QX', start: '08:00', end: '16:00' });
    await expectNoRow(
      'shift_master', { hospital_id: hid, shift_code: 'QX' },
      'An unnamed shift was saved. It shows as a blank entry on the roster, so the ward sister ' +
      'cannot tell which shift a nurse is rostered to.',
    );
  });

  test('TC-P2D-092 A shift cannot be saved without a code', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, { name: 'QA No Code', start: '08:00', end: '16:00' });
    await expectNoRow(
      'shift_master', { hospital_id: hid, shift_name: 'QA No Code' },
      'The code is what appears in the compressed roster grid where a full name will not fit.',
    );
  });

  test('TC-P2D-093 A shift cannot be saved without a start time', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, { name: 'QA No Start', code: 'QNS', end: '16:00' });
    await expectNoRow(
      'shift_master', { hospital_id: hid, shift_code: 'QNS' },
      'start_time is NOT NULL. Without client-side validation the user gets a raw Postgres ' +
      'constraint error instead of a sentence naming the missing field.',
    );
  });

  test('TC-P2D-094 A shift cannot be saved without an end time', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, { name: 'QA No End', code: 'QNE', start: '08:00' });
    await expectNoRow('shift_master', { hospital_id: hid, shift_code: 'QNE' });
  });

  test('TC-P2D-095 A zero-length shift is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, { name: 'QA Zero Shift', code: 'QZS', start: ZERO.start, end: ZERO.end });

    await expectNoRow(
      'shift_master', { hospital_id: hid, shift_code: 'QZS' },
      `A shift with start = end = ${ZERO.start} was saved. Identical times are ambiguous — zero ` +
      `hours or a continuous 24? Stored either way it silently misstates every roster hour and ` +
      `payroll line built on it.`,
    );
  });

  test('TC-P2D-096 A duplicate shift code is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, NIGHT);
    await reloadAndSettle(page);
    await addShift(page, { name: 'QA Duplicate', code: 'NR', start: '09:00', end: '17:00' });

    expect(
      await countRows('shift_master', { hospital_id: hid, shift_code: 'NR' }),
      'Two shifts share code NR. The roster grid keys on the code — attendance is then booked ' +
      'against whichever row the query returns first and the nurse is paid for the wrong shift.',
    ).toBe(1);
  });

  test('TC-P2D-097 The shift code is stored upper-cased', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, { ...NIGHT, code: 'nr' });

    await expectRow(
      'shift_master', { hospital_id: hid, shift_code: 'NR' },
      'Mixed-case codes defeat the duplicate check and let "nr" and "NR" coexist as two shifts ' +
      'that look identical on screen.',
    );
  });

  test('TC-P2D-098 Editing a shift persists the change', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, NIGHT);
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: NIGHT.name }).first();
    await row.locator('button').filter({ hasNot: page.locator('text=/save|cancel/i') }).first().click();
    await page.waitForTimeout(500);

    const editing = page.locator('tr').filter({ hasText: NIGHT.name }).first();
    await editing.locator('input[type="time"]').nth(1).fill('07:00');
    await editing.getByRole('button', { name: /^save$/i }).click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const after = await expectRow<{ end_time: string; duration_hours: number }>(
      'shift_master', { hospital_id: hid, shift_code: 'NR' },
    );
    expect(after.end_time, 'The edited end time did not persist').toMatch(/^07:00/);
    expect(
      Number(after.duration_hours),
      'duration_hours was not recomputed after the edit, so the roster keeps using the old length.',
    ).toBe(9);
  });

  test('TC-P2D-099 A shift can be deactivated and reactivated', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, NIGHT);
    await reloadAndSettle(page);

    const row = () => page.locator('tr').filter({ hasText: NIGHT.name }).first();
    await row().locator('[role="switch"]').click();
    await page.waitForTimeout(1400);

    let stored = await expectRow<{ is_active: boolean }>('shift_master', { hospital_id: hid, shift_code: 'NR' });
    expect(stored.is_active, 'Deactivating the shift did not persist').toBe(false);

    await row().locator('[role="switch"]').click();
    await page.waitForTimeout(1400);
    stored = await expectRow<{ is_active: boolean }>('shift_master', { hospital_id: hid, shift_code: 'NR' });
    expect(
      stored.is_active,
      'A one-way deactivation forces a duplicate shift when the pattern returns, orphaning ' +
      'months of attendance from the original.',
    ).toBe(true);
  });

  test('TC-P2D-100 Deleting a shift asks for confirmation naming the shift', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, NIGHT);
    await reloadAndSettle(page);

    let promptText = '';
    page.on('dialog', d => { promptText = d.message(); d.dismiss(); });

    const row = page.locator('tr').filter({ hasText: NIGHT.name }).first();
    await row.locator('button').last().click();
    await page.waitForTimeout(800);

    expect(
      promptText,
      'The delete confirmation did not name the shift. The control is a small icon beside the ' +
      'edit icon — without a named prompt a misclick removes a shift the roster is using.',
    ).toContain(NIGHT.name);
    expect(await countRows('shift_master', { hospital_id: hid, shift_code: 'NR' })).toBe(1);
  });

  test('TC-P2D-101 Confirming the delete removes the shift row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, { name: 'QA Morning', code: 'QAM', start: '07:00', end: '14:00' });
    await reloadAndSettle(page);

    page.on('dialog', d => d.accept());
    const row = page.locator('tr').filter({ hasText: 'QA Morning' }).first();
    await row.locator('button').last().click();
    await page.waitForTimeout(1600);
    await reloadAndSettle(page);

    expect(
      await countRows('shift_master', { hospital_id: hid, shift_code: 'QAM' }),
      'A delete that only removes the row from local state reappears on the next load, so the ' +
      'administrator deletes it repeatedly and concludes the screen is broken.',
    ).toBe(0);
  });

  test('TC-P2D-102 A saved shift survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addShift(page, NIGHT);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(NIGHT.name),
      `BUG-P2-002 REGRESSION: "${NIGHT.name}" vanished after a reload. Before the fix this screen ` +
      `kept everything in component state, so shift_master stayed empty while the UI looked healthy.`,
    ).toBeTruthy();
    expect(body, 'The stored duration is not rendered after the reload').toMatch(/8\s*h/);
  });

  test('TC-P2D-103 The shift colour is stored and rendered', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addShift(page, NIGHT);

    const row = await expectRow<{ color_code: string | null }>('shift_master', { hospital_id: hid, shift_code: 'NR' });
    expect(
      row.color_code,
      'color_code was not stored. Colour is how a ward sister reads a month-long roster grid at ' +
      'a glance — one that resets on reload makes the grid unreadable.',
    ).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("TC-P2D-104 Hospital A's shifts are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // This table was never queried before the fix, so its RLS has never been exercised.
    await expectNoCrossTenantRows('shift_master', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2D-105 A nurse cannot reach the Shifts settings screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A nurse reached /settings/shifts. Shift definitions drive payroll hours — a nurse able ' +
      'to widen a shift is a nurse able to change what the hospital pays, with no approval trail.',
    ).toBeTruthy();
  });

  test('TC-P2D-106 The Shifts screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addShift(page, NIGHT);
    await reloadAndSettle(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors on the Shifts screen:\n${real.join('\n')}\n\nThis screen was rewired to a ` +
      `table it had never touched, so a column-name mismatch would surface only here while the ` +
      `UI carried on looking healthy.`,
    ).toHaveLength(0);
  });
});
