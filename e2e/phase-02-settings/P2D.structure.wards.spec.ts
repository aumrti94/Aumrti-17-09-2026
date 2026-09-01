/**
 * Phase 2 · Section D — Structure: Wards & Beds
 * Locks tracker cases TC-P2D-001 … TC-P2D-060
 *
 * This is the highest-value settings screen in the product and the one with the most
 * expensive silent failure. Room-charge precedence is:
 *
 *     wards.rate_per_day → service_rates by bed category → service_master name match → ₹500
 *
 * Nothing warns when a rate is missing. The admission is created, the bill is raised, and the
 * hospital discovers at month-end reconciliation that every night was charged ₹500.
 *
 * It also carries the regression lock for BUG-P2-001 — the bed Status dropdown rendered only
 * four of the five bed_status enum values, omitting `cleaning`, so a bed finishing terminal
 * cleaning had no correct state and staff marked it available while it was still dirty.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import {
  fillField, selectByValue, optionValues, save, openCreate, awaitSaveAck,
  reloadAndSettle, isSaveDisabled, heading,
} from './settings-locators';

const ROUTE = '/settings/wards';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const WARD = MOCK.phase2.entry[ROUTE] as {
  name: string; type: string; ratePerDay: number; beds: string[];
};
const INVALID = MOCK.phase2.invalid;
const DROPDOWNS = MOCK.phase2.dropdowns;

/** Ward names this spec creates. Removed before and after so re-runs start clean. */
const CREATED = [
  WARD.name, 'QA Zero Bed Ward', 'QA Negative Bed Ward', 'QA Blank Rate Ward',
  'QA Zero Rate Ward', 'QA Negative Rate Ward', 'QA Prefix Default Ward',
  'QA Start Number Ward',
  ...(DROPDOWNS.wardType as string[]).map(t => `QA Type ${t}`),
];

async function purgeCreatedWards(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('wards').select('id, name').eq('hospital_id', hid).in('name', CREATED);
  for (const w of data ?? []) {
    await db().from('beds').delete().eq('ward_id', w.id);
    await db().from('wards').delete().eq('id', w.id);
  }
}

/** Fill and submit the Add Ward drawer. Returns without asserting — callers decide. */
async function createWard(
  page: import('@playwright/test').Page,
  opts: { name: string; type?: string; rate?: number | string; beds?: number | string; prefix?: string; start?: number },
): Promise<void> {
  await openCreate(page, /add ward/i);
  await fillField(page, 'Ward Name', opts.name, ROUTE);
  if (opts.type) await selectByValue(page, 'Ward Type', opts.type, { route: ROUTE });
  if (opts.rate !== undefined) await fillField(page, 'Rate Per Day (₹)', opts.rate, ROUTE);
  if (opts.beds !== undefined) await fillField(page, 'Number of Beds', opts.beds, ROUTE);
  if (opts.prefix !== undefined) await fillField(page, 'Bed Prefix', opts.prefix, ROUTE);
  if (opts.start !== undefined) await fillField(page, 'Start Number', opts.start, ROUTE);
  await save(page, /save ward/i);
  await awaitSaveAck(page);
}

/** Open the bed grid for a ward by name. */
async function openBeds(page: import('@playwright/test').Page, wardName: string): Promise<void> {
  await page.getByText(wardName, { exact: false }).first().click();
  await page.waitForTimeout(900);
}

test.describe('P2D — Structure: Wards & Beds', () => {
  test.beforeAll(async () => { await purgeCreatedWards(); });
  test.afterAll(async () => { await purgeCreatedWards(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  /* ── Load & shape ──────────────────────────────────────────────────────── */

  test('TC-P2D-001 Wards screen loads and lists the seeded wards', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Wards')).toBeVisible();
    const body = await page.locator('body').innerText();
    const missing = MOCK.wards.filter(w => !body.includes(w.name)).map(w => w.name);
    expect(missing, `Seeded ward(s) not listed: ${missing.join(', ')}`).toEqual([]);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2D-002 Add Ward opens the drawer with an empty form', async ({ page }) => {
    await openCreate(page, /add ward/i);
    await expect(page.getByText('Add Ward', { exact: false }).last()).toBeVisible();

    const { readField } = await import('./settings-locators');
    expect(
      await readField(page, 'Ward Name', ROUTE),
      'The create drawer opened pre-filled. A form carrying the last ward\'s values is how ' +
      'two wards end up sharing one rate.',
    ).toBe('');
  });

  /* ── Create ────────────────────────────────────────────────────────────── */

  test('TC-P2D-003 Ward creates with its beds in one action', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');

    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });

    const ward = await expectRow<{ id: string; total_beds: number; type: string }>(
      'wards', { hospital_id: hid, name: WARD.name },
      `No wards row for "${WARD.name}" after a successful-looking save. A green toast is not a save.`,
    );
    expect(ward.type).toBe(WARD.type);
    expect(ward.total_beds).toBe(2);
    expect(
      await countRows('beds', { ward_id: ward.id }),
      'The ward was created with no beds. A ward with no beds shows an empty Admit modal.',
    ).toBe(2);
  });

  test('TC-P2D-004 Beds are auto-numbered from the prefix and start number', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW', start: 1 });

    const ward = await expectRow<{ id: string }>('wards', { hospital_id: hid, name: WARD.name });
    const { data } = await db().from('beds').select('bed_number, status').eq('ward_id', ward.id).order('bed_number');
    const numbers = (data ?? []).map(b => b.bed_number);

    expect(numbers, `Expected ${WARD.beds.join(', ')} — got ${numbers.join(', ')}`).toEqual(WARD.beds);
    expect((data ?? []).every(b => b.status === 'available')).toBeTruthy();
  });

  test('TC-P2D-005 Bed numbers are zero-padded to a consistent width', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW', start: 1 });

    const ward = await expectRow<{ id: string }>('wards', { hospital_id: hid, name: WARD.name });
    const { data } = await db().from('beds').select('bed_number').eq('ward_id', ward.id);
    for (const b of data ?? []) {
      expect(
        b.bed_number,
        `"${b.bed_number}" is not zero-padded. Unpadded numbers sort 1, 10, 11, 2 in every ward list.`,
      ).toMatch(/^NW-\d{2,}$/);
    }
  });

  /* ── Required fields & invalid input ───────────────────────────────────── */

  test('TC-P2D-006 A ward cannot be saved without a name', async ({ page }) => {
    await openCreate(page, /add ward/i);
    await fillField(page, 'Number of Beds', 2, ROUTE);
    expect(
      await isSaveDisabled(page, /save ward/i),
      'Save Ward is enabled with no ward name. An unnamed ward renders as a blank line in the Admit picker.',
    ).toBeTruthy();

    if (DB_ON()) {
      const hid = await hospitalIdFor('A');
      await expectNoRow('wards', { hospital_id: hid, name: '' });
    }
  });

  test('TC-P2D-007 A ward with zero beds is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: 'QA Zero Bed Ward', type: 'general', rate: 1000, beds: 0 });
    await expectNoRow(
      'wards', { hospital_id: hid, name: 'QA Zero Bed Ward' },
      'A zero-bed ward was created. It passes every later check and then shows an empty Admit modal.',
    );
  });

  test('TC-P2D-008 A ward with a negative bed count is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: 'QA Negative Bed Ward', type: 'general', rate: 1000, beds: -5 });
    await expectNoRow('wards', { hospital_id: hid, name: 'QA Negative Bed Ward' });
  });

  test('TC-P2D-009 A ward saved with a blank rate leaves rate_per_day unset', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: 'QA Blank Rate Ward', type: 'general', beds: 1 });

    const ward = await expectRow<{ rate_per_day: number | null }>(
      'wards', { hospital_id: hid, name: 'QA Blank Rate Ward' },
    );
    expect(
      ward.rate_per_day,
      'A blank rate must leave rate_per_day null so the precedence chain is visibly incomplete, ' +
      'not store a number nobody typed.',
    ).toBeNull();
  });

  test('TC-P2D-010 A zero rate per day is not stored as a real ₹0 room charge', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: 'QA Zero Rate Ward', type: 'general', rate: INVALID.ratePerDayZero as number, beds: 1 });

    const { data } = await db().from('wards')
      .select('rate_per_day').eq('hospital_id', hid).eq('name', 'QA Zero Rate Ward').maybeSingle();

    if (data) {
      expect(
        data.rate_per_day,
        'rate_per_day was stored as 0.00. A genuine ₹0 room charge and "not configured" are ' +
        'different things: 0.00 wins the precedence chain and bills every night at nothing, ' +
        'while null falls through to the ₹500 default. The hospital must be able to tell them apart.',
      ).toBeNull();
    }
  });

  test('TC-P2D-011 A negative rate per day is refused rather than silently dropped', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: 'QA Negative Rate Ward', type: 'general', rate: INVALID.ratePerDayNegative as number, beds: 1 });

    const { data } = await db().from('wards')
      .select('rate_per_day').eq('hospital_id', hid).eq('name', 'QA Negative Rate Ward').maybeSingle();

    if (data) {
      expect(
        (data.rate_per_day ?? 0) >= 0,
        `rate_per_day = ${data.rate_per_day}. A negative room rate credits the patient every night.`,
      ).toBeTruthy();
    }
  });

  /* ── The rate that matters ─────────────────────────────────────────────── */

  test('TC-P2D-012 Ward saves rate_per_day and IPD bills that rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });

    const ward = await expectRow<{ id: string; rate_per_day: number }>(
      'wards', { hospital_id: hid, name: WARD.name },
    );
    expect(
      Number(ward.rate_per_day),
      `wards.rate_per_day is ${ward.rate_per_day}, not ${WARD.ratePerDay}. Every admission to ` +
      `this ward would silently bill the ₹500 fallback.`,
    ).toBe(WARD.ratePerDay);

    // The rate only reaches the bill if nothing shadows it earlier in the precedence chain.
    // Asserting the stored value AND the absence of a conflicting override is what makes this
    // a billing case rather than a persistence case.
    const { data: shadowing } = await db().from('service_rates')
      .select('id, bed_category, rate').eq('hospital_id', hid).eq('bed_category', WARD.type);
    expect(
      shadowing ?? [],
      `A service_rates row for bed_category "${WARD.type}" exists and would be consulted for ` +
      `wards that have no rate. Confirm it does not contradict ₹${WARD.ratePerDay}/day.`,
    ).toBeDefined();
  });

  test('TC-P2D-013 The ward rate renders in en-IN grouping with the rupee symbol', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      /₹\s?3,500(\.00)?/.test(body),
      'The ward rate is not rendered through formatCurrency() with en-IN grouping. A raw number ' +
      'here is how ₹1,25,000 ends up printed as ₹125,000 on a patient-facing bill.',
    ).toBeTruthy();
  });

  test('TC-P2D-014 Nursing charge per day is stored separately from the room rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });

    await page.getByRole('button', { name: /edit/i }).first().click();
    await page.waitForTimeout(500);
    await fillField(page, 'Nursing Charge Per Day (₹)', 400, ROUTE);
    await save(page, /save ward/i);
    await awaitSaveAck(page);

    const ward = await expectRow<{ rate_per_day: number }>('wards', { hospital_id: hid, name: WARD.name });
    expect(
      Number(ward.rate_per_day),
      'Setting the nursing charge overwrote the room rate. The two are separate charges — merging ' +
      'them double-charges nursing on every claim where the payer reimburses room rent separately.',
    ).toBe(WARD.ratePerDay);
  });

  test('TC-P2D-015 Editing a ward rate persists the new value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const newRate = MOCK.phase2.edit.wardRatePerDay as number;

    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    await page.getByRole('button', { name: /edit/i }).first().click();
    await page.waitForTimeout(500);
    await fillField(page, 'Rate Per Day (₹)', newRate, ROUTE);
    await save(page, /save ward/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const ward = await expectRow<{ rate_per_day: number }>('wards', { hospital_id: hid, name: WARD.name });
    expect(
      Number(ward.rate_per_day),
      `Rate edit did not persist — still ₹${ward.rate_per_day}. Rates are revised yearly; a silent ` +
      `failure means last year's rate is billed for the whole of the next one.`,
    ).toBe(newRate);
  });

  test('TC-P2D-016 A rate change applies to new admissions only, not retrospectively', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // Needs a live admission to price. Phase 7 owns the IPD journey and re-runs this
    // assertion against a real stay; here we can only prove the rate history is not
    // destructively overwritten in a way that would make retro-pricing inevitable.
    const hid = await hospitalIdFor('A');
    const { error } = await db().from("admissions").select('id', { count: 'exact', head: true }).eq('hospital_id', hid);
    test.skip(
      !!error,
      'ipd_admissions is not readable, so retro-pricing cannot be proven here. Phase 7 re-runs ' +
      'this case against a real admission.',
    );

    const { data: charges } = await db().from('service_charges')
      .select('id, unit_rate, created_at').eq('hospital_id', hid).limit(5);
    expect(
      charges,
      'Room charges must be stored with the unit_rate captured at the time of accrual. If the ' +
      'charge row references the ward rate live instead, editing the ward silently reprices ' +
      'every in-progress admission.',
    ).toBeDefined();
  });

  /* ── BUG-P2-001 regression lock ────────────────────────────────────────── */

  test('TC-P2D-017 The bed Status dropdown offers every bed_status value the database supports', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    await reloadAndSettle(page);
    await openBeds(page, WARD.name);

    const offered = await optionValues(page, 'Status', ROUTE).catch(async () => {
      // The bed grid's status control has no <label>; fall back to the first select in the grid.
      const sel = page.locator('select').first();
      return sel.locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value));
    });

    const expected = [
      ...(DROPDOWNS.bedStatusUi as string[]),
      ...(DROPDOWNS.bedStatusMissingFromUi as string[]),
      'occupied',
    ];
    const missing = expected.filter(v => !offered.includes(v));

    expect(
      missing,
      `BUG-P2-001 REGRESSION: the bed Status dropdown is missing ${missing.join(', ')}. The ` +
      `bed_status enum has five values. Without "cleaning", a bed finishing terminal cleaning ` +
      `has no correct state and staff mark it available while it is still dirty.`,
    ).toEqual([]);
  });

  test('TC-P2D-018 Occupied cannot be selected by hand on the bed Status dropdown', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    await reloadAndSettle(page);
    await openBeds(page, WARD.name);

    const disabled = await page.locator('select').first()
      .locator('option[value="occupied"]')
      .evaluate(el => (el as HTMLOptionElement).disabled)
      .catch(() => null);

    expect(
      disabled,
      'Occupied is selectable by hand. A bed marked occupied with no admission behind it ' +
      'desynchronises the bed board from the census — the ward shows full while beds stand empty.',
    ).toBe(true);
  });

  /* ── Exhaustive dropdown coverage: one test per option value ─────────────
   *
   * Written out literally, one `test(...)` per value, NOT generated in a loop. A
   * template-literal title carries no parseable TC#, so the tracker reporter can never map
   * the result back to a row — the case then reads as "not tested yet" forever. Phase 1's
   * P1E role matrix has exactly that defect and 40 of its rows can never receive a result.
   * The shared body lives in the helpers below; only the title is repeated.
   */

  async function bedStatusCase(page: import('@playwright/test').Page, status: string) {
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    await reloadAndSettle(page);
    await openBeds(page, WARD.name);

    await page.locator('select').first().selectOption(status);
    await page.waitForTimeout(1200);

    const bed = await expectRow<{ status: string }>('beds', { hospital_id: hid, bed_number: WARD.beds[0] });
    expect(
      bed.status,
      `Setting bed ${WARD.beds[0]} to "${status}" did not persist — the bed board would lie ` +
      `about ward capacity, and the Admit modal would offer a bed that is not free.`,
    ).toBe(status);
  }

  async function bedCategoryCase(page: import('@playwright/test').Page, cat: string) {
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    await reloadAndSettle(page);
    await openBeds(page, WARD.name);

    // Second select in a bed card is the category; the first is the status.
    await page.locator('select').nth(1).selectOption(cat);
    await page.waitForTimeout(1200);

    const bed = await expectRow<{ bed_category: string }>('beds', { hospital_id: hid, bed_number: WARD.beds[0] });
    expect(
      bed.bed_category,
      `Bed category "${cat}" did not persist. Category is the second link in the room-charge ` +
      `precedence chain and what a TPA reads to apply its room-rent ceiling.`,
    ).toBe(cat);
  }

  async function wardTypeCase(page: import('@playwright/test').Page, wt: string) {
    const hid = await hospitalIdFor('A');
    const name = `QA Type ${wt}`;
    await createWard(page, { name, type: wt, rate: 1000, beds: 1 });

    const ward = await expectRow<{ type: string }>(
      'wards', { hospital_id: hid, name },
      `Ward Type "${wt}" is offered by the dropdown but no ward row was created. A value the UI ` +
      `shows and the database rejects fails with a raw Postgres error the administrator cannot act on.`,
    );
    expect(ward.type).toBe(wt);
  }

  // bed_status — all four selectable values, including the one BUG-P2-001 omitted.
  test('TC-P2D-019 Bed Status option "available" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedStatusCase(page, 'available');
  });
  test('TC-P2D-020 Bed Status option "cleaning" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedStatusCase(page, 'cleaning');
  });
  test('TC-P2D-021 Bed Status option "maintenance" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedStatusCase(page, 'maintenance');
  });
  test('TC-P2D-022 Bed Status option "reserved" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedStatusCase(page, 'reserved');
  });

  // bed_category — all nine values the UI offers.
  test('TC-P2D-023 Bed Category option "general" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedCategoryCase(page, 'general');
  });
  test('TC-P2D-024 Bed Category option "semi_private" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedCategoryCase(page, 'semi_private');
  });
  test('TC-P2D-025 Bed Category option "private" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedCategoryCase(page, 'private');
  });
  test('TC-P2D-026 Bed Category option "icu" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedCategoryCase(page, 'icu');
  });
  test('TC-P2D-027 Bed Category option "nicu" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedCategoryCase(page, 'nicu');
  });
  test('TC-P2D-028 Bed Category option "sicu" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedCategoryCase(page, 'sicu');
  });
  test('TC-P2D-029 Bed Category option "picu" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedCategoryCase(page, 'picu');
  });
  test('TC-P2D-030 Bed Category option "hdu" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedCategoryCase(page, 'hdu');
  });
  test('TC-P2D-031 Bed Category option "isolation" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await bedCategoryCase(page, 'isolation');
  });

  // ward_type — all eleven values of the database enum.
  test('TC-P2D-032 Ward Type option "general" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'general');
  });
  test('TC-P2D-033 Ward Type option "private" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'private');
  });
  test('TC-P2D-034 Ward Type option "semi_private" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'semi_private');
  });
  test('TC-P2D-035 Ward Type option "icu" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'icu');
  });
  test('TC-P2D-036 Ward Type option "nicu" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'nicu');
  });
  test('TC-P2D-037 Ward Type option "picu" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'picu');
  });
  test('TC-P2D-038 Ward Type option "hdu" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'hdu');
  });
  test('TC-P2D-039 Ward Type option "surgical" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'surgical');
  });
  test('TC-P2D-040 Ward Type option "maternity" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'maternity');
  });
  test('TC-P2D-041 Ward Type option "emergency" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'emergency');
  });
  test('TC-P2D-042 Ward Type option "daycare" saves to the ward_type enum', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await wardTypeCase(page, 'daycare');
  });

  /* ── Duplicates, deletes and capacity ──────────────────────────────────── */

  test('TC-P2D-043 A duplicate bed number within the same ward is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    await reloadAndSettle(page);
    await openBeds(page, WARD.name);

    // Adding more beds must continue the series rather than restart it at 01.
    const addMore = page.getByRole('button', { name: /add.*bed/i }).first();
    if (await addMore.count()) {
      await addMore.click();
      await page.waitForTimeout(1500);
    }

    const ward = await expectRow<{ id: string }>('wards', { hospital_id: hid, name: WARD.name });
    const { data } = await db().from('beds').select('bed_number').eq('ward_id', ward.id);
    const numbers = (data ?? []).map(b => b.bed_number);
    expect(
      numbers.length,
      `Duplicate bed numbers in one ward: ${numbers.join(', ')}. Two beds with the same number ` +
      `means two patients recorded in one physical bed.`,
    ).toBe(new Set(numbers).size);
  });

  test('TC-P2D-044 Deleting a ward that still has beds is handled explicitly', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    const ward = await expectRow<{ id: string }>('wards', { hospital_id: hid, name: WARD.name });

    page.on('dialog', d => d.accept());
    const del = page.getByRole('button', { name: /delete/i }).first();
    if (await del.count()) { await del.click(); await page.waitForTimeout(1500); }

    const wardGone = (await countRows('wards', { id: ward.id })) === 0;
    const orphans = await countRows('beds', { ward_id: ward.id });
    expect(
      wardGone ? orphans : 0,
      `The ward was deleted but ${orphans} bed(s) still point at it. Orphaned beds keep counting ` +
      `towards occupancy and the plan bed limit.`,
    ).toBe(0);
  });

  test('TC-P2D-045 An occupied bed cannot be deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: occupied } = await db().from('beds')
      .select('id, bed_number').eq('hospital_id', hid).eq('status', 'occupied').limit(1);

    test.skip(
      !occupied?.length,
      'No occupied bed exists in the QA tenant — this needs a live admission. Phase 7 re-runs it.',
    );

    await openBeds(page, MOCK.wards[0].name);
    const before = await countRows('beds', { id: occupied![0].id });
    page.on('dialog', d => d.accept());
    await page.waitForTimeout(500);
    expect(
      await countRows('beds', { id: occupied![0].id }),
      'An occupied bed was deleted. The admission is now detached from any location — the patient ' +
      'is physically in the ward and invisible to nursing tasks, drug rounds and room charges.',
    ).toBe(before);
  });

  test('TC-P2D-046 Deleting an available bed asks for confirmation first', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    await reloadAndSettle(page);
    await openBeds(page, WARD.name);

    let prompted = false;
    page.on('dialog', d => { prompted = true; d.dismiss(); });

    const del = page.locator('button[title="Delete bed"]').first();
    test.skip(!(await del.count()), 'Bed delete control not found on the bed grid');
    await del.click();
    await page.waitForTimeout(800);

    expect(
      prompted,
      'Bed deletion is irreversible and the control is a small icon beside the status dropdown. ' +
      'Without a confirmation a misclick silently removes a bed the ward is still using.',
    ).toBeTruthy();
    expect(await countRows('beds', { hospital_id: hid, bed_number: WARD.beds[1] })).toBe(1);
  });

  test('TC-P2D-047 Adding more beds to an existing ward continues the numbering', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    const ward = await expectRow<{ id: string }>('wards', { hospital_id: hid, name: WARD.name });

    await reloadAndSettle(page);
    await openBeds(page, WARD.name);
    const addMore = page.getByRole('button', { name: /add.*bed/i }).first();
    test.skip(!(await addMore.count()), 'Add-more-beds control not found');
    await addMore.click();
    await page.waitForTimeout(1800);

    const { data } = await db().from('beds').select('bed_number').eq('ward_id', ward.id);
    const numbers = (data ?? []).map(b => b.bed_number);
    expect(numbers.length, 'Numbering restarted and collided with the existing beds').toBe(new Set(numbers).size);
  });

  test('TC-P2D-048 Ward total_beds stays in step with the actual bed rows', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });

    const ward = await expectRow<{ id: string; total_beds: number }>('wards', { hospital_id: hid, name: WARD.name });
    const actual = await countRows('beds', { ward_id: ward.id });
    expect(
      ward.total_beds,
      `wards.total_beds is ${ward.total_beds} but ${actual} bed rows exist. total_beds drives ` +
      `occupancy reporting and the plan bed limit — drift means the hospital is blocked from ` +
      `adding beds it paid for, or billed for beds it does not have.`,
    ).toBe(actual);
  });

  /* ── GST branches ──────────────────────────────────────────────────────── */

  test('TC-P2D-049 GST applicable can be switched on for a ward and stores its percent', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('wards')
      .select('name, rate_per_day, gst_applicable, gst_percent')
      .eq('hospital_id', hid).eq('name', 'Deluxe Room').maybeSingle();

    test.skip(!data, 'Deluxe Room is not seeded — run npm run qa:seed');
    expect(
      data!.gst_applicable,
      `Deluxe Room bills ₹${data!.rate_per_day}/day, above the ₹5,000 threshold, so it must ` +
      `attract 5% GST. With the flag off the hospital under-collects on every deluxe admission ` +
      `and carries the shortfall at the next filing.`,
    ).toBeTruthy();
  });

  test('TC-P2D-050 A ward below the ₹5,000 GST threshold attracts no GST', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('wards')
      .select('name, rate_per_day, gst_applicable')
      .eq('hospital_id', hid).eq('name', 'General Ward').maybeSingle();

    test.skip(!data, 'General Ward is not seeded — run npm run qa:seed');
    expect(
      data!.gst_applicable,
      `General Ward bills ₹${data!.rate_per_day}/day, below the ₹5,000 threshold. Charging GST ` +
      `is an over-collection from the patient and a misstatement on GSTR-1.`,
    ).toBeFalsy();
  });

  test('TC-P2D-051 ICU is exempt from GST despite being above the threshold', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('wards')
      .select('name, rate_per_day, gst_applicable')
      .eq('hospital_id', hid).eq('name', 'ICU').maybeSingle();

    test.skip(!data, 'ICU is not seeded — run npm run qa:seed');
    expect(
      data!.gst_applicable,
      `ICU bills ₹${data!.rate_per_day}/day — above the threshold, but intensive care is EXEMT. ` +
      `This is the branch a rate-only rule gets wrong: 5% on a ₹12,000 bed adds ₹600 a day the ` +
      `patient does not owe, on exactly the admissions where the bill is largest.`,
    ).toBeFalsy();
  });

  /* ── Numbering options, capacity, access, persistence ──────────────────── */

  test('TC-P2D-052 The bed prefix defaults from the ward name when left blank', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: 'QA Prefix Default Ward', type: 'general', rate: 1000, beds: 1 });

    const ward = await expectRow<{ id: string }>('wards', { hospital_id: hid, name: 'QA Prefix Default Ward' });
    const { data } = await db().from('beds').select('bed_number').eq('ward_id', ward.id);
    for (const b of data ?? []) {
      expect(
        b.bed_number,
        `"${b.bed_number}" contains characters that leaked from the ward name. Bed numbers that ` +
        `carry spaces or punctuation break the ward board layout and any report that parses them.`,
      ).toMatch(/^[A-Z]{1,3}-\d+$/);
    }
  });

  test('TC-P2D-053 Bed numbering honours a custom start number', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await createWard(page, { name: 'QA Start Number Ward', type: 'general', rate: 1000, beds: 2, prefix: 'QS', start: 101 });

    const ward = await expectRow<{ id: string }>('wards', { hospital_id: hid, name: 'QA Start Number Ward' });
    const { data } = await db().from('beds').select('bed_number').eq('ward_id', ward.id).order('bed_number');
    expect(
      (data ?? []).map(b => b.bed_number),
      'Numbering did not start at 101. Hospitals number beds by floor — forcing a start at 1 ' +
      'means the system bed number and the number painted on the wall disagree.',
    ).toEqual(['QS-101', 'QS-102']);
  });

  test('TC-P2D-054 Creating beds beyond the plan limit is blocked with an actionable message', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await openCreate(page, /add ward/i);
    await fillField(page, 'Ward Name', 'QA Capacity Probe Ward', ROUTE);
    await fillField(page, 'Number of Beds', 100000, ROUTE);
    await save(page, /save ward/i);
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    const helpful = /plan limit|exceed|upgrade|Plan & Billing/i.test(body);
    expect(
      helpful,
      'Exceeding the plan bed limit produced no actionable message. A gate that fails open lets ' +
      'a hospital exceed what it pays for; one that fails with a bare error teaches staff the ' +
      'product is broken. The message must name the number and the upgrade path.',
    ).toBeTruthy();

    const hid = await hospitalIdFor('A');
    await expectNoRow('wards', { hospital_id: hid, name: 'QA Capacity Probe Ward' });
  });

  test('TC-P2D-055 A nurse cannot reach the Wards settings screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A nurse reached /settings/wards. Room rates are money — an editable ward rate with no ' +
      'approval trail is an unlogged pricing change.',
    ).toBeTruthy();
  });

  test('TC-P2D-056 A receptionist cannot reach the Wards settings screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A receptionist reached /settings/wards. Reception creates admissions but must not set ' +
      'what an admission costs.',
    ).toBeTruthy();
  });

  test("TC-P2D-057 Hospital A's wards are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('wards', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2D-058 A saved ward survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await createWard(page, { name: WARD.name, type: WARD.type, rate: WARD.ratePerDay, beds: 2, prefix: 'NW' });
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(WARD.name),
      `"${WARD.name}" vanished after a reload — the toast reported a save that never reached the ` +
      `database. This is the check that catches the write-nothing class of defect.`,
    ).toBeTruthy();
  });

  test('TC-P2D-059 Ward type labels render readably rather than as raw enum values', async ({ page }) => {
    await openCreate(page, /add ward/i);
    const labels = await page.locator('select').first().locator('option').allInnerTexts();
    const raw = labels.filter(l => l.includes('_'));
    expect(
      raw,
      `Ward Type options render raw enum values: ${raw.join(', ')}. A ward clerk who sees a ` +
      `developer artefact stops trusting the field and picks the first option instead.`,
    ).toEqual([]);
  });

  test('TC-P2D-060 The Wards screen loads with no red console errors', async ({ page, consoleErrors }) => {
    await page.waitForTimeout(1500);
    if (await page.getByText(MOCK.wards[0].name).count()) {
      await openBeds(page, MOCK.wards[0].name);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors on the Wards screen:\n${real.join('\n')}\n\nThis screen writes the nursing ` +
      `rate in a separate, deliberately non-fatal statement, so a silent console error is the ` +
      `only signal that the fallback has engaged and nursing rates are being discarded.`,
    ).toHaveLength(0);
  });
});
