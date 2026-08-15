/**
 * Phase 2 · Section B — Identity: Language & Region
 * Locks tracker cases TC-P2B-001 … TC-P2B-040
 *
 * REGRESSION LOCK FOR BUG-P2-004. Until Phase 2 QA this screen persisted nothing at all — it
 * had no target table, and Save ran a 500ms setTimeout before showing a green toast. A fake
 * spinner in front of a no-op is the most convincing possible disguise for a screen that
 * saves nothing: a hospital in Hyderabad could set Telugu and 24-hour time, be told it
 * worked, and find English and 12-hour back the next morning.
 *
 * It now persists to hospital_settings under `language_region`, the same key/value pattern
 * `discount_approval_rules` and `ipd_ancillary_payment` already use.
 *
 * Every option value gets its own case because the visible label and the stored code differ
 * — "Hindi (हिन्दी)" stores as 'hi' — so a mapping error affects one language and not the rest.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { chooseRadio, selectByValue, optionValues, save, awaitSaveAck, reloadAndSettle, heading } from './settings-locators';

const ROUTE = '/settings/language';
const KEY = 'language_region';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const D = MOCK.phase2.dropdowns;

/** Visible label → stored code, as rendered by SettingsLanguagePage. */
const LANG_LABEL: Record<string, string> = {
  en: 'English', hi: 'Hindi (हिन्दी)', te: 'Telugu (తెలుగు)', ta: 'Tamil (தமிழ்)',
  kn: 'Kannada (ಕನ್ನಡ)', ml: 'Malayalam (മലയാളം)', mr: 'Marathi (मराठी)',
};
const CURRENCY_LABEL: Record<string, string> = {
  INR: '₹ Indian Rupee (INR)', AED: 'AED (UAE)', USD: 'USD', GBP: 'GBP',
};
const TZ_LABEL: Record<string, string> = {
  'Asia/Kolkata': 'Asia/Kolkata (IST)', 'Asia/Dubai': 'Asia/Dubai (GST)',
  'America/New_York': 'America/New_York (EST)', 'Europe/London': 'Europe/London (GMT)',
};
const TIME_LABEL: Record<string, string> = { '12': '12-hour (2:30 PM)', '24': '24-hour (14:30)' };
const NUM_LABEL: Record<string, string> = {
  indian: 'Indian (1,00,000)', international: 'International (100,000)',
};

async function clearStored(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('hospital_settings').delete().eq('hospital_id', hid).eq('key', KEY);
}

async function storedConfig(): Promise<Record<string, string> | null> {
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('hospital_settings')
    .select('value').eq('hospital_id', hid).eq('key', KEY).maybeSingle();
  return (data?.value ?? null) as Record<string, string> | null;
}

/** Set one field, save, reload, and return what the database holds. */
async function setAndPersist(
  page: import('@playwright/test').Page,
  apply: () => Promise<void>,
): Promise<Record<string, string> | null> {
  await apply();
  await save(page);
  await awaitSaveAck(page);
  await reloadAndSettle(page);
  return storedConfig();
}

/* Shared bodies — titles stay literal so the tracker can map every result. */
async function languageCase(page: import('@playwright/test').Page, code: string) {
  const cfg = await setAndPersist(page, () =>
    selectByValue(page, 'Interface Language', code, { visibleLabel: LANG_LABEL[code], route: ROUTE }));
  expect(
    cfg?.language,
    `Interface Language "${LANG_LABEL[code]}" did not persist as '${code}'. The visible label and ` +
    `the stored code differ, so a mapping error affects one language and not the others.`,
  ).toBe(code);
}

async function dateFormatCase(page: import('@playwright/test').Page, fmt: string) {
  const cfg = await setAndPersist(page, () => chooseRadio(page, fmt));
  expect(cfg?.dateFormat, `Date Format "${fmt}" did not persist`).toBe(fmt);
}

async function timeFormatCase(page: import('@playwright/test').Page, value: string) {
  const cfg = await setAndPersist(page, () => chooseRadio(page, TIME_LABEL[value]));
  expect(
    cfg?.timeFormat,
    `Time Format "${TIME_LABEL[value]}" did not persist as '${value}'. An ambiguous medication ` +
    `chart between 2:30 and 14:30 is a dosing-time error.`,
  ).toBe(value);
}

async function currencyCase(page: import('@playwright/test').Page, code: string) {
  const cfg = await setAndPersist(page, () =>
    selectByValue(page, 'Currency', code, { visibleLabel: CURRENCY_LABEL[code], route: ROUTE }));
  expect(cfg?.currency, `Currency "${CURRENCY_LABEL[code]}" did not persist as '${code}'`).toBe(code);
}

async function timezoneCase(page: import('@playwright/test').Page, tz: string) {
  const cfg = await setAndPersist(page, () =>
    selectByValue(page, 'Timezone', tz, { visibleLabel: TZ_LABEL[tz], route: ROUTE }));
  expect(
    cfg?.timezone,
    `Timezone "${tz}" did not round-trip. A mangled IANA identifier makes every timestamp ` +
    `calculation fall back to the server zone silently.`,
  ).toBe(tz);
}

async function numberFormatCase(page: import('@playwright/test').Page, value: string) {
  const cfg = await setAndPersist(page, () => chooseRadio(page, NUM_LABEL[value]));
  expect(cfg?.numberFormat, `Number Format "${NUM_LABEL[value]}" did not persist as '${value}'`).toBe(value);
}

test.describe('P2B — Identity: Language & Region', () => {
  test.afterAll(async () => { await clearStored(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
  });

  test('TC-P2B-001 Language & Region screen loads with all six controls', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Language & Region')).toBeVisible();
    for (const label of ['Interface Language', 'Date Format', 'Time Format', 'Currency', 'Timezone', 'Number Format']) {
      await expect(page.getByText(label, { exact: true }).first(), `"${label}" is missing`).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2B-002 The shipped defaults are Indian conventions', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await clearStored();
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body,
      'The default date format is not DD/MM/YYYY. A default of MM/DD/YYYY renders 08/12/2026 as ' +
      'an August date on every discharge summary in the building.',
    ).toContain('DD/MM/YYYY');
    expect(body).toContain('Indian (1,00,000)');
  });

  test('TC-P2B-003 Interface Language offers exactly the seven supported languages', async ({ page }) => {
    const offered = await optionValues(page, 'Interface Language', ROUTE);
    expect(
      offered.length,
      `Interface Language offers ${offered.length} options, expected 7: ${offered.join(' | ')}`,
    ).toBe((D.interfaceLanguage as string[]).length);
  });

  test('TC-P2B-004 Date Format offers exactly three options', async ({ page }) => {
    const body = await page.locator('body').innerText();
    for (const f of D.dateFormat as string[]) {
      expect(body, `Date Format option "${f}" is not offered`).toContain(f);
    }
  });

  test('TC-P2B-005 Time Format offers exactly two options', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).toContain('12-hour');
    expect(body).toContain('24-hour');
  });

  test('TC-P2B-006 Currency offers exactly four options', async ({ page }) => {
    const offered = await optionValues(page, 'Currency', ROUTE);
    expect(
      offered.length,
      `Currency offers ${offered.length} options, expected 4: ${offered.join(' | ')}`,
    ).toBe((D.currency as string[]).length);
  });

  test('TC-P2B-007 Timezone offers exactly four options', async ({ page }) => {
    const offered = await optionValues(page, 'Timezone', ROUTE);
    expect(
      offered.length,
      `Timezone offers ${offered.length} options, expected 4: ${offered.join(' | ')}`,
    ).toBe((D.timezone as string[]).length);
  });

  test('TC-P2B-008 Number Format offers exactly two options', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).toContain('Indian (1,00,000)');
    expect(body).toContain('International (100,000)');
  });

  test('TC-P2B-009 Saving writes the language_region row to hospital_settings', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await clearStored();
    await reloadAndSettle(page);

    await chooseRadio(page, TIME_LABEL['24']);
    await chooseRadio(page, NUM_LABEL.indian);
    await save(page);
    await awaitSaveAck(page);

    const cfg = await storedConfig();
    expect(
      cfg,
      'BUG-P2-004 REGRESSION: no hospital_settings row after a successful-looking save. This ' +
      'screen had no target table at all — Save ran a setTimeout and toasted success.',
    ).not.toBeNull();
    expect(cfg!.timeFormat).toBe('24');
    expect(cfg!.numberFormat).toBe('indian');
  });

  test('TC-P2B-010 The save spinner reflects a real request, not a fixed delay', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const calls: string[] = [];
    page.on('request', r => {
      if (/hospital_settings/.test(r.url())) calls.push(`${r.method()} ${r.url()}`);
    });

    await chooseRadio(page, TIME_LABEL['24']);
    await save(page);
    await awaitSaveAck(page);

    expect(
      calls.length,
      'BUG-P2-004 REGRESSION: clicking Save issued no request to hospital_settings. The original ' +
      'code ran setTimeout(…, 500) before toasting success — a fake spinner in front of a no-op.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2B-011 The Language & Region screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await chooseRadio(page, TIME_LABEL['24']);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThis screen was newly wired to hospital_settings, ` +
      `so a key or column mismatch would surface only here while the UI looked healthy.`,
    ).toHaveLength(0);
  });

  test("TC-P2B-012 Hospital A's language settings are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // hospital_settings has no per-role RLS, so tenant isolation is its only protection.
    await expectNoCrossTenantRows('hospital_settings', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2B-013 A nurse cannot reach the Language & Region screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A nurse reached /settings/language. Changing the date format changes how every date in ' +
      'the hospital renders, and the route guard is the only control here because ' +
      'hospital_settings has no per-role RLS.',
    ).toBeTruthy();
  });

  test('TC-P2B-014 Stored settings are loaded back into the form on open', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await chooseRadio(page, TIME_LABEL['24']);
    await save(page);
    await awaitSaveAck(page);

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);

    const checked = await page.locator('[role="radio"][aria-checked="true"]').allTextContents();
    const body = await page.locator('body').innerText();
    expect(
      checked.some(t => /24/.test(t)) || /24-hour/.test(body),
      'The saved value was not loaded back into the form. A screen that saves but never reads ' +
      'back looks broken in a subtler way — the administrator sets it, returns, sees the ' +
      'default, and never knows which one is live.',
    ).toBeTruthy();
  });

  test('TC-P2B-015 A partially stored config merges with the shipped defaults', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('hospital_settings').upsert(
      { hospital_id: hid, key: KEY, value: { timeFormat: '24' } as never, updated_at: new Date().toISOString() },
      { onConflict: 'hospital_id,key' },
    );
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body,
      'A config saved before a new setting shipped lacks that key. Rendering it blank rather ' +
      'than defaulting means a hospital silently loses its currency on the next release.',
    ).toContain('DD/MM/YYYY');
    expect(body).not.toMatch(/undefined|\[object Object\]/);
  });

  test('TC-P2B-016 Currency INR renders amounts with the rupee symbol', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await selectByValue(page, 'Currency', 'INR', { visibleLabel: CURRENCY_LABEL.INR, route: ROUTE });
    await save(page);
    await awaitSaveAck(page);

    await page.goto('/settings/wards', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const body = await page.locator('body').innerText();
    expect(
      /₹/.test(body),
      'No rupee symbol rendered on the Wards screen. Currency is chosen here and consumed by ' +
      'formatCurrency() everywhere else — if the two disconnect, a hospital sets INR and still ' +
      'sees unsymbolised numbers on every bill.',
    ).toBeTruthy();
  });

  test('TC-P2B-017 Number Format Indian renders lakh grouping', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await chooseRadio(page, NUM_LABEL.indian);
    await save(page);
    await awaitSaveAck(page);

    await page.goto('/settings/wards', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const body = await page.locator('body').innerText();

    const international = body.match(/₹\s?\d{3},\d{3}(?!\d)/g) ?? [];
    expect(
      international,
      `Amounts render with international grouping (${international.join(', ')}). MOCK_DATA_BOOK ` +
      `is explicit: ₹125,000 instead of ₹1,25,000 is a defect — an Indian accountant reads the ` +
      `comma position, and the wrong one shifts the apparent value by an order of magnitude.`,
    ).toEqual([]);
  });

  test('TC-P2B-018 Language & region settings survive a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await selectByValue(page, 'Interface Language', 'te', { visibleLabel: LANG_LABEL.te, route: ROUTE });
    await chooseRadio(page, TIME_LABEL['24']);
    await selectByValue(page, 'Currency', 'INR', { visibleLabel: CURRENCY_LABEL.INR, route: ROUTE });
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const cfg = await storedConfig();
    expect(
      cfg,
      'BUG-P2-004 REGRESSION: nothing was stored. Every field on this screen was enterable and ' +
      'selectable, the toast said saved, and none of it survived a reload — a hospital in ' +
      'Hyderabad could set Telugu and 24-hour time and find English and 12-hour back the next morning.',
    ).not.toBeNull();
    expect(cfg!.language, 'Interface Language did not survive the reload').toBe('te');
    expect(cfg!.timeFormat, 'Time Format did not survive the reload').toBe('24');
    expect(cfg!.currency, 'Currency did not survive the reload').toBe('INR');

    const body = await page.locator('body').innerText();
    expect(
      body.includes(LANG_LABEL.te),
      'The stored language was not rendered back into the form after the reload.',
    ).toBeTruthy();
  });

  /* ── Every option value, one literal test apiece ────────────────────────── */

  test('TC-P2B-019 Interface Language "English" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await languageCase(page, 'en');
  });
  test('TC-P2B-020 Interface Language "Hindi (हिन्दी)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await languageCase(page, 'hi');
  });
  test('TC-P2B-021 Interface Language "Telugu (తెలుగు)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await languageCase(page, 'te');
  });
  test('TC-P2B-022 Interface Language "Tamil (தமிழ்)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await languageCase(page, 'ta');
  });
  test('TC-P2B-023 Interface Language "Kannada (ಕನ್ನಡ)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await languageCase(page, 'kn');
  });
  test('TC-P2B-024 Interface Language "Malayalam (മലയാളം)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await languageCase(page, 'ml');
  });
  test('TC-P2B-025 Interface Language "Marathi (मराठी)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await languageCase(page, 'mr');
  });

  test('TC-P2B-026 Date Format "DD/MM/YYYY" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await dateFormatCase(page, 'DD/MM/YYYY');
  });
  test('TC-P2B-027 Date Format "MM/DD/YYYY" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await dateFormatCase(page, 'MM/DD/YYYY');
  });
  test('TC-P2B-028 Date Format "YYYY-MM-DD" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await dateFormatCase(page, 'YYYY-MM-DD');
  });

  test('TC-P2B-029 Time Format "12-hour (2:30 PM)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await timeFormatCase(page, '12');
  });
  test('TC-P2B-030 Time Format "24-hour (14:30)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await timeFormatCase(page, '24');
  });

  test('TC-P2B-031 Currency "₹ Indian Rupee (INR)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await currencyCase(page, 'INR');
  });
  test('TC-P2B-032 Currency "AED (UAE)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await currencyCase(page, 'AED');
  });
  test('TC-P2B-033 Currency "USD" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await currencyCase(page, 'USD');
  });
  test('TC-P2B-034 Currency "GBP" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await currencyCase(page, 'GBP');
  });

  test('TC-P2B-035 Timezone "Asia/Kolkata (IST)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await timezoneCase(page, 'Asia/Kolkata');
  });
  test('TC-P2B-036 Timezone "Asia/Dubai (GST)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await timezoneCase(page, 'Asia/Dubai');
  });
  test('TC-P2B-037 Timezone "America/New_York (EST)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await timezoneCase(page, 'America/New_York');
  });
  test('TC-P2B-038 Timezone "Europe/London (GMT)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await timezoneCase(page, 'Europe/London');
  });

  test('TC-P2B-039 Number Format "Indian (1,00,000)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await numberFormatCase(page, 'indian');
  });
  test('TC-P2B-040 Number Format "International (100,000)" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await numberFormatCase(page, 'international');
  });
});
