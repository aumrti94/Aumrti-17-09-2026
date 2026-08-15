/**
 * Phase 2 · Section A — Settings hub & catalogue
 * Locks tracker cases TC-P2A-001 … TC-P2A-020
 *
 * The hub is the only doorway to all 50 configuration screens. settingsCatalog.ts exists
 * because six settings routes once had no card at all and were unreachable by browsing OR
 * search — and a screen a hospital cannot find is a screen it never configures, which is
 * where every silent-fallback defect downstream begins.
 *
 * These cases are pure UI: no row is written, so none of them needs the database.
 */
import { test, expect } from '../fixtures/auth.fixture';
import { SETTINGS_ROUTES, ALIAS_CARDS, SETTINGS_SCREENS } from './settings.helpers';

const HUB = '/settings';

/** The catalogue's declared display order — settingsCatalog.ts SETTINGS_GROUP_ORDER. */
const GROUP_ORDER = [
  'Identity', 'Plan & Modules', 'Structure', 'People & Access', 'Clinical',
  'Queue Display & Kiosk', 'Workflows', 'Integrations', 'Inventory & Stores',
  'Audit & Compliance', 'Go-Live & Migration',
];

/** Cards render as <button> with the title in an <h3>. */
function cards(page: import('@playwright/test').Page) {
  return page.locator('button').filter({ has: page.locator('h3') });
}

async function searchFor(page: import('@playwright/test').Page, term: string) {
  const box = page.getByPlaceholder(/search settings or a module/i);
  await box.fill(term);
  await page.waitForTimeout(400);
}

async function visibleCardTitles(page: import('@playwright/test').Page): Promise<string[]> {
  return (await cards(page).locator('h3').allInnerTexts()).map(t => t.trim());
}

test.describe('P2A — Settings hub & catalogue', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(HUB, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
  });

  test('TC-P2A-001 Settings hub loads with heading, subtitle and search box', async ({ page, consoleErrors }) => {
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText('Configure your hospital system')).toBeVisible();
    await expect(page.getByPlaceholder(/search settings or a module/i)).toBeVisible();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors on the settings hub:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2A-002 every routable /settings/* route has a catalogue entry', async ({ page }) => {
    // A route with no card is reachable only by typing the URL — the exact defect
    // settingsCatalog.ts was introduced to prevent.
    const titles = await visibleCardTitles(page);
    const missing = SETTINGS_SCREENS
      .filter(s => !titles.some(t => t === s.title))
      .map(s => `${s.route} (${s.title})`);

    expect(
      missing,
      `${missing.length} settings route(s) have no card on the hub and can only be reached by ` +
      `typing the URL:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  test('TC-P2A-003 two alias cards point at a route another card already owns', async ({ page }) => {
    const titles = await visibleCardTitles(page);
    for (const alias of ALIAS_CARDS) {
      expect(titles, `Alias card "${alias.title}" is missing from the hub`).toContain(alias.title);
      expect(titles, `Primary card "${alias.primary}" is missing from the hub`).toContain(alias.primary);
    }
    // 50 routes + 2 aliases + 3 settings-adjacent (go-live, data migration, IMS access log).
    expect(titles.length).toBe(SETTINGS_ROUTES.length + ALIAS_CARDS.length + 3);
  });

  test('TC-P2A-004 groups render in the declared SETTINGS_GROUP_ORDER', async ({ page }) => {
    const body = await page.locator('body').innerText();
    const positions = GROUP_ORDER.map(g => ({ g, at: body.indexOf(g) }));

    const absent = positions.filter(p => p.at === -1).map(p => p.g);
    expect(absent, `Group heading(s) missing from the hub: ${absent.join(', ')}`).toEqual([]);

    const order = positions.map(p => p.at);
    const sorted = [...order].sort((a, b) => a - b);
    expect(
      order,
      `Groups are out of order. Identity and Structure must precede Clinical, or an ` +
      `administrator working the grid top to bottom hits prerequisites that do not exist yet.`,
    ).toEqual(sorted);
  });

  test('TC-P2A-005 clicking the Departments card navigates to /settings/departments', async ({ page }) => {
    await cards(page).filter({ hasText: 'Departments' }).first().click();
    await page.waitForURL(/\/settings\/departments/, { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/settings/departments');
  });

  test('TC-P2A-006 searching "pharmacy" surfaces the pages that actually configure Pharmacy', async ({ page }) => {
    await searchFor(page, 'pharmacy');
    const titles = await visibleCardTitles(page);

    expect(titles, 'Drug Formulary is the direct pharmacy page and must match').toContain('Drug Formulary');
    // The cross-cutting pages are the ones plain substring search used to miss entirely.
    const crossCutting = ['Configurable Dropdowns', 'Staff Members', 'IPD Ancillary Payment', 'Store Locations'];
    const found = crossCutting.filter(t => titles.includes(t));
    expect(
      found.length,
      `Searching "pharmacy" surfaced none of the cross-cutting pages that configure it ` +
      `(${crossCutting.join(', ')}). Got: ${titles.join(', ')}`,
    ).toBeGreaterThan(0);
  });

  test('TC-P2A-007 searching the alias "pathology" surfaces Lab Test Master', async ({ page }) => {
    await searchFor(page, 'pathology');
    expect(await visibleCardTitles(page)).toContain('Lab Test Master');
  });

  test('TC-P2A-008 searching the alias "theatre" surfaces the OT Checklist', async ({ page }) => {
    // Indian English is the house style — "theatre", not "theater".
    await searchFor(page, 'theatre');
    expect(await visibleCardTitles(page)).toContain('OT Checklist');
  });

  test('TC-P2A-009 searching the alias "x-ray" surfaces Radiology Modalities', async ({ page }) => {
    await searchFor(page, 'x-ray');
    expect(await visibleCardTitles(page)).toContain('Radiology Modalities');
  });

  test('TC-P2A-010 searching the alias "TPA" surfaces Payer Masters', async ({ page }) => {
    await searchFor(page, 'TPA');
    expect(await visibleCardTitles(page)).toContain('Payer Masters');
  });

  test('TC-P2A-011 searching the alias "ayushman" surfaces the PMJAY-related pages', async ({ page }) => {
    await searchFor(page, 'ayushman');
    const titles = await visibleCardTitles(page);
    expect(
      titles.some(t => ['Payer Masters', 'Configurable Dropdowns'].includes(t)),
      `Searching "ayushman" returned ${titles.length ? titles.join(', ') : 'nothing'}. PMJAY ` +
      `empanelment is a common reason hospitals buy — the scheme must be findable by its name.`,
    ).toBeTruthy();
  });

  test('TC-P2A-012 searching the alias "payroll" surfaces the HR-related settings', async ({ page }) => {
    await searchFor(page, 'payroll');
    const titles = await visibleCardTitles(page);
    expect(
      titles.some(t => ['Staff Members', 'Shifts'].includes(t)),
      `Salary fields live on the Staff screen, not on a page called Payroll. Got: ${titles.join(', ')}`,
    ).toBeTruthy();
  });

  test('TC-P2A-013 searching the alias "nabh" surfaces the quality and retention pages', async ({ page }) => {
    await searchFor(page, 'nabh');
    const titles = await visibleCardTitles(page);
    expect(
      titles.some(t => ['Record Retention', 'Record Access Log'].includes(t)),
      `During a mock assessment the quality officer needs the retention screen in seconds. ` +
      `Got: ${titles.join(', ')}`,
    ).toBeTruthy();
  });

  test('TC-P2A-014 searching a page title matches directly and highlights the matched text', async ({ page }) => {
    await searchFor(page, 'Wards');
    expect(await visibleCardTitles(page)).toContain('Wards & Beds');
    await expect(
      page.locator('mark').first(),
      'The matched substring is not highlighted, so the user cannot see why a card matched',
    ).toBeVisible();
  });

  test('TC-P2A-015 searching a keyword absent from both title and description still matches', async ({ page }) => {
    // "letterhead" appears only in the Branding entry's keywords array.
    await searchFor(page, 'letterhead');
    expect(await visibleCardTitles(page)).toContain('Branding');
  });

  test('TC-P2A-016 a search with no matches shows the empty state quoting what was typed', async ({ page }) => {
    await searchFor(page, 'zzzznotathing');
    await expect(page.getByText(/no settings found for/i)).toBeVisible();
    await expect(
      page.getByText('zzzznotathing'),
      'The empty state must quote the term back — a blank screen reads as a crash',
    ).toBeVisible();
    expect(await cards(page).count()).toBe(0);
  });

  test('TC-P2A-017 cross-cutting pages appear in their own bucket, not mixed into direct hits', async ({ page }) => {
    await searchFor(page, 'lab');
    await expect(
      page.getByText(/also configures/i),
      'Staff, Roles and Dropdowns configure every module. Merged into the results they drown ' +
      'the two or three pages the user actually wanted.',
    ).toBeVisible();
  });

  test('TC-P2A-018 a module search deep-links Configurable Dropdowns to the right category', async ({ page }) => {
    await searchFor(page, 'pharmacy');
    await cards(page).filter({ hasText: 'Configurable Dropdowns' }).first().click();
    await page.waitForURL(/\/settings\/config-values/, { timeout: 10_000 });

    expect(
      new URL(page.url()).searchParams.get('cat'),
      'Landing on the bare config-values page means hunting through 23 categories for ' +
      'drug_routes — and an empty route list is the commonest false "OPD is broken" report.',
    ).toBe('drug_routes');
  });

  test('TC-P2A-019 search is case-insensitive', async ({ page }) => {
    await searchFor(page, 'PHARMACY');
    const upper = await visibleCardTitles(page);
    await searchFor(page, 'pharmacy');
    const lower = await visibleCardTitles(page);
    expect(upper.sort()).toEqual(lower.sort());
  });

  test('TC-P2A-020 clearing the search box restores the full browse grid', async ({ page }) => {
    const before = (await visibleCardTitles(page)).length;
    await searchFor(page, 'pharmacy');
    expect((await visibleCardTitles(page)).length).toBeLessThan(before);

    await searchFor(page, '');
    expect(
      (await visibleCardTitles(page)).length,
      'A search box that traps the user in a filtered view forces a reload to escape, and a ' +
      'reload mid-configuration is where unsaved work is lost.',
    ).toBe(before);
  });
});
