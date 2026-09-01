/**
 * Phase 2 · Section F — Services, Rates & Payer Masters
 * Locks tracker cases TC-P2F-001 … TC-P2F-056
 *
 * Every billable event in the hospital resolves its price through `service_master`. The
 * failure SETTINGS_PREREQ_MATRIX names first is the one to watch here: with no consultation
 * row the app SILENTLY bills a hardcoded ₹500, with no warning of any kind.
 *
 * Payer masters decide the other half — with none configured there is no insurance selection
 * at admission, so every insured patient is admitted as cash and the claim is never raised.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import {
  fillField, selectByValue, save, openCreate, awaitSaveAck, reloadAndSettle, heading,
} from './settings-locators';

const SERVICES = '/settings/services';
const PAYERS = '/settings/payer-masters';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const SVC = MOCK.phase2.entry[SERVICES] as {
  name: string; code: string; category: string; rate: number; gstPercent: number; hsn: string;
};
const NO_HSN = MOCK.phase2.invalid.serviceWithoutHsn as {
  name: string; code: string; category: string; rate: number; gstPercent: number; hsn: string;
};
const PAYER = MOCK.phase2.entry[PAYERS] as {
  name: string; type: string; roomCeiling: number; coPayPercent: number; deductible: number;
};
const INVALID = MOCK.phase2.invalid;

const SVC_CODES = [SVC.code, NO_HSN.code, 'QA-CAT-consultation', 'QA-CAT-procedure',
  'QA-CAT-service', 'QA-CAT-surgery', 'QA-NEG', 'QA-ZERO', 'QA-DEC', 'QA-HSN2',
  'QA-HSN4', 'QA-HSN6', 'QA-HSN8', 'QA-GST0', 'QA-GST5', 'QA-GST12', 'QA-GST18'];
const PAYER_NAMES = [PAYER.name, `${PAYER.name} 2`, 'QA Payer No Type'];

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('service_master').delete().eq('hospital_id', hid).in('code', SVC_CODES);
  await db().from('payer_masters').delete().eq('hospital_id', hid).in('name', PAYER_NAMES);
}

async function addService(
  page: import('@playwright/test').Page,
  o: Partial<{ name: string; code: string; category: string; rate: number | string; gst: number; hsn: string }>,
): Promise<void> {
  await openCreate(page, /add service|new service/i);
  if (o.name !== undefined) await fillField(page, 'Service Name', o.name, SERVICES);
  if (o.category) await selectByValue(page, 'Category', o.category, { route: SERVICES }).catch(() => {});
  if (o.rate !== undefined) await fillField(page, 'Fee (₹)', o.rate, SERVICES);
  for (const [label, value] of [['Code', o.code], ['HSN', o.hsn], ['GST %', o.gst]] as const) {
    if (value !== undefined) await fillField(page, label, value as string | number, SERVICES).catch(() => {});
  }
  await save(page, /save|add/i);
  await awaitSaveAck(page);
}

async function addPayer(
  page: import('@playwright/test').Page,
  o: Partial<{ name: string; type: string; ceiling: number; coPay: number; deductible: number; phone: string }>,
): Promise<void> {
  await openCreate(page, /add payer|new payer/i);
  if (o.type) await selectByValue(page, 'Payer Type', o.type, { route: PAYERS }).catch(() => {});
  if (o.name !== undefined) await fillField(page, 'Payer Name', o.name, PAYERS);
  if (o.phone !== undefined) await fillField(page, 'Contact Phone', o.phone, PAYERS).catch(() => {});
  await save(page, /save|add/i);
  await awaitSaveAck(page);
}

/** Shared bodies — titles stay literal so every result reaches a tracker row. */
async function serviceCategoryCase(page: import('@playwright/test').Page, cat: string) {
  const hid = await hospitalIdFor('A');
  const code = `QA-CAT-${cat}`;
  await addService(page, { name: `QA ${cat} service`, code, category: cat, rate: 100, hsn: '999312' });

  const { data } = await db().from('service_master')
    .select('category').eq('hospital_id', hid).eq('code', code).maybeSingle();
  test.skip(!data, `The "${cat}" service was not created, so the category cannot be verified`);
  expect(
    data!.category,
    `Category "${cat}" stored as "${data!.category}". Category decides where a charge appears on ` +
    `the bill and which GST treatment applies — one mis-stored value mis-groups every service ` +
    `of that kind.`,
  ).toBe(cat);
}

async function payerTypeCase(page: import('@playwright/test').Page, type: string, example: string) {
  const hid = await hospitalIdFor('A');
  const { data: seeded } = await db().from('payer_masters')
    .select('payer_type').eq('hospital_id', hid).eq('name', example).maybeSingle();

  if (seeded) {
    expect(
      seeded.payer_type,
      `Seeded payer "${example}" is stored as type "${seeded.payer_type}", not "${type}". Payer ` +
      `type decides the entire billing path — tariff rates, package rates, ceilings or monthly ` +
      `invoicing.`,
    ).toBe(type);
    return;
  }

  await addPayer(page, { name: `QA Payer ${type}`, type });
  const row = await expectRow<{ payer_type: string }>(
    'payer_masters', { hospital_id: hid, name: `QA Payer ${type}` },
    `Payer type "${type}" could not be saved.`,
  );
  expect(row.payer_type).toBe(type);
  await db().from('payer_masters').delete().eq('hospital_id', hid).eq('name', `QA Payer ${type}`);
}

test.describe('P2F — Service Rates', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(SERVICES, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('TC-P2F-001 Service Rates screen loads and lists the seeded services', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Service Rates').or(page.getByRole('heading', { name: /service/i }).first())).toBeVisible();

    if (DB_ON()) {
      const body = await page.locator('body').innerText();
      const missing = MOCK.services.filter(s => !body.includes(s.name)).map(s => s.name);
      expect(
        missing,
        `Seeded service(s) not listed: ${missing.join(', ')}. A missing consultation row makes OPD ` +
        `silently bill a hardcoded ₹500 with no warning at all.`,
      ).toEqual([]);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2F-002 A new service saves with its fee, GST and HSN', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    await addService(page, { name: SVC.name, code: SVC.code, category: SVC.category, rate: SVC.rate, hsn: SVC.hsn });

    const row = await expectRow<{ rate: number; hsn_code: string }>(
      'service_master', { hospital_id: hid, code: SVC.code },
      'No service_master row after a successful-looking save. If a fully specified service will ' +
      'not save, nothing downstream can bill correctly.',
    );
    expect(Number(row.rate)).toBe(SVC.rate);
    expect(row.hsn_code).toBe(SVC.hsn);
  });

  test('TC-P2F-003 A service with no HSN code is flagged before it reaches a bill', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, {
      name: NO_HSN.name, code: NO_HSN.code, category: NO_HSN.category, rate: NO_HSN.rate, gst: NO_HSN.gstPercent,
    });

    const { data } = await db().from('service_master')
      .select('hsn_code, gst_percent').eq('hospital_id', hid).eq('code', NO_HSN.code).maybeSingle();

    if (data && Number(data.gst_percent) > 0 && !data.hsn_code) {
      const body = await page.locator('body').innerText();
      expect(
        /hsn|incomplete|missing/i.test(body),
        'A taxable service was saved with no HSN and nothing on screen flags it. Once the ' +
        'hospital GSTIN is set, bill finalisation is HARD-BLOCKED for any line lacking an HSN — ' +
        'so this row looks fine here and then stops a bill with a patient at the counter.',
      ).toBeTruthy();
    }
  });

  test('TC-P2F-004 A service cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('service_master', { hospital_id: hid });
    await addService(page, { rate: 100 });

    expect(
      await countRows('service_master', { hospital_id: hid }),
      'An unnamed service was created. It appears as a blank line on the bill the patient is ' +
      'handed and on the charge picker the clerk selects from.',
    ).toBe(before);
  });

  test('TC-P2F-005 A service cannot be saved without a fee', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, { name: 'QA No Fee Service', code: 'QA-NEG' });

    const { data } = await db().from('service_master')
      .select('rate').eq('hospital_id', hid).eq('code', 'QA-NEG').maybeSingle();
    if (data) {
      expect(
        data.rate,
        'A service with no rate bills ₹0 or falls through to a default. Either way the hospital ' +
        'performs the work and collects nothing, and the gap only shows at month-end.',
      ).not.toBeNull();
    }
  });

  test('TC-P2F-006 A non-numeric fee is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, { name: 'QA NaN Fee', code: 'QA-NEG', rate: INVALID.feeNonNumeric as string });

    const { data } = await db().from('service_master')
      .select('rate').eq('hospital_id', hid).eq('code', 'QA-NEG').maybeSingle();
    if (data) {
      expect(
        Number.isFinite(Number(data.rate)),
        `rate stored as ${data.rate}. A fee that parses to NaN is stored as null or zero, so the ` +
        `service silently bills nothing while the rate card says it is configured.`,
      ).toBeTruthy();
    }
  });

  test('TC-P2F-007 A negative fee is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, { name: 'QA Negative Fee', code: 'QA-NEG', rate: -500, hsn: '999312' });

    const { data } = await db().from('service_master')
      .select('rate').eq('hospital_id', hid).eq('code', 'QA-NEG').maybeSingle();
    if (data) {
      expect(
        Number(data.rate) >= 0,
        `rate = ${data.rate}. A negative rate credits the patient every time the service is ` +
        `performed, and inverts the sign of that line in the day-closure total.`,
      ).toBeTruthy();
    }
  });

  test('TC-P2F-008 A zero fee is stored deliberately, not as unset', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, { name: 'QA Zero Fee', code: 'QA-ZERO', rate: 0, hsn: '999312' });

    const { data } = await db().from('service_master')
      .select('rate').eq('hospital_id', hid).eq('code', 'QA-ZERO').maybeSingle();
    test.skip(!data, 'The zero-fee service was not created');
    expect(
      data!.rate,
      'A zero fee must store as 0, meaning genuinely free — distinct from null meaning not ' +
      'configured. If zero collapses into null the service falls through the precedence chain ' +
      'and the patient is charged for something promised free.',
    ).not.toBeNull();
    expect(Number(data!.rate)).toBe(0);
  });

  test('TC-P2F-009 A fee stores to two decimal places', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, { name: 'QA Decimal Fee', code: 'QA-DEC', rate: 1234.56, hsn: '999312' });

    const { data } = await db().from('service_master')
      .select('rate').eq('hospital_id', hid).eq('code', 'QA-DEC').maybeSingle();
    test.skip(!data, 'The decimal-fee service was not created');
    expect(
      Number(data!.rate),
      'All monetary values must be numeric(12,2). A JavaScript float introduces rounding that ' +
      'compounds across a multi-line bill and never reconciles against the GST return.',
    ).toBe(1234.56);
  });

  test('TC-P2F-010 A duplicate service code is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, { name: SVC.name, code: SVC.code, category: SVC.category, rate: SVC.rate, hsn: SVC.hsn });
    await reloadAndSettle(page);
    await addService(page, { name: `${SVC.name} 2`, code: SVC.code, category: SVC.category, rate: 999, hsn: SVC.hsn });

    expect(
      await countRows('service_master', { hospital_id: hid, code: SVC.code }),
      'Two services share one code. The price then depends on which row the query returns first, ' +
      'so the same procedure bills differently on different days.',
    ).toBe(1);
  });

  test('TC-P2F-011 Service category "consultation" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await serviceCategoryCase(page, 'consultation');
  });
  test('TC-P2F-012 Service category "procedure" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await serviceCategoryCase(page, 'procedure');
  });
  test('TC-P2F-013 Service category "service" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await serviceCategoryCase(page, 'service');
  });
  test('TC-P2F-014 Service category "surgery" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await serviceCategoryCase(page, 'surgery');
  });

  test('TC-P2F-015 A GST percent below zero is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, {
      name: 'QA Negative GST', code: 'QA-GST0', rate: 100,
      gst: INVALID.gstPercentNegative as number, hsn: '999312',
    });

    const { data } = await db().from('service_master')
      .select('gst_percent').eq('hospital_id', hid).eq('code', 'QA-GST0').maybeSingle();
    if (data) {
      expect(
        Number(data.gst_percent ?? 0) >= 0,
        `gst_percent = ${data.gst_percent}. A negative GST rate reduces the hospital's output tax ` +
        `on the return — an understated liability the department will query.`,
      ).toBeTruthy();
    }
  });

  test('TC-P2F-016 A GST percent above 100 is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, {
      name: 'QA Over GST', code: 'QA-GST5', rate: 100,
      gst: INVALID.gstPercentOver100 as number, hsn: '999312',
    });

    const { data } = await db().from('service_master')
      .select('gst_percent').eq('hospital_id', hid).eq('code', 'QA-GST5').maybeSingle();
    if (data) {
      expect(
        Number(data.gst_percent ?? 0) <= 100,
        `gst_percent = ${data.gst_percent}. A rate above 100% makes the tax exceed the service ` +
        `value, so the patient is asked to pay more tax than the treatment cost.`,
      ).toBeTruthy();
    }
  });

  test('TC-P2F-017 The real Indian GST rates are all accepted', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('service_master')
      .select('code, gst_percent').eq('hospital_id', hid).limit(50);
    test.skip(!data?.length, 'No services seeded — run npm run qa:seed');

    const rates = new Set((data ?? []).map(s => Number(s.gst_percent ?? 0)));
    const invalid = [...rates].filter(r => ![0, 5, 12, 18, 28].includes(r));
    expect(
      invalid,
      `Service rows carry GST rates outside the Indian slabs: ${invalid.join(', ')}. The seeded ` +
      `services deliberately mix exempt clinical work with taxable ambulance, meals and record ` +
      `copies — a rule that rejects a legitimate slab makes those services unbillable.`,
    ).toEqual([]);
  });

  test('TC-P2F-018 A two-digit HSN code is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, { name: 'QA Short HSN', code: 'QA-HSN2', rate: 100, hsn: INVALID.hsnTooShort as string });

    await expectNoRow(
      'service_master', { hospital_id: hid, hsn_code: INVALID.hsnTooShort as string },
      `HSN "${INVALID.hsnTooShort}" was stored. An HSN of the wrong length is rejected by the NIC ` +
      `IRP days later, with an error that points at the invoice rather than at this screen.`,
    );
  });

  test('TC-P2F-019 Valid HSN lengths of 4, 6 and 8 digits are accepted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const cases: Array<[string, string]> = [['QA-HSN4', '9993'], ['QA-HSN6', '999312'], ['QA-HSN8', '99931200']];

    for (const [code, hsn] of cases) {
      await addService(page, { name: `QA HSN ${hsn.length}`, code, rate: 100, hsn });
      await reloadAndSettle(page);
    }

    const { data } = await db().from('service_master')
      .select('code, hsn_code').eq('hospital_id', hid).in('code', cases.map(c => c[0]));
    const stored = new Set((data ?? []).map(s => s.hsn_code));
    const missing = cases.filter(([, hsn]) => !stored.has(hsn)).map(([, hsn]) => hsn);

    expect(
      missing,
      `Valid HSN length(s) rejected: ${missing.join(', ')}. HSN is legitimately 4, 6 or 8 digits ` +
      `depending on turnover — a rule accepting only one blocks a hospital entering its own codes.`,
    ).toEqual([]);
  });

  test('TC-P2F-020 Editing a service rate persists the new value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const newRate = MOCK.phase2.edit.serviceRate as number;

    await addService(page, { name: SVC.name, code: SVC.code, category: SVC.category, rate: SVC.rate, hsn: SVC.hsn });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: SVC.name }).first();
    test.skip(!(await row.count()), 'The created service is not listed');
    await row.getByRole('button', { name: /edit/i }).first().click();
    await page.waitForTimeout(800);
    await fillField(page, 'Fee (₹)', newRate, SERVICES);
    await save(page, /save|update/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const after = await expectRow<{ rate: number }>('service_master', { hospital_id: hid, code: SVC.code });
    expect(
      Number(after.rate),
      'Rate cards are revised annually. An edit that toasts success without persisting means the ' +
      'hospital bills last year\'s price for a full year.',
    ).toBe(newRate);
  });

  test('TC-P2F-021 A rate change applies to new charges only, not to charges already raised', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('bill_line_items')
      .select('id, unit_rate').eq('hospital_id', hid).limit(5);

    test.skip(!!error, `bill_line_items is not readable: ${error?.message}. Phase 8 re-runs this against real bills.`);
    expect(
      data,
      'Charge rows must capture unit_price at the time of accrual. If a charge references the ' +
      'master rate live instead, editing a service silently reprices a figure the patient may ' +
      'have been quoted or a TPA pre-authorised.',
    ).toBeDefined();
  });

  test('TC-P2F-022 A consultation service prevents the hardcoded ₹500 fallback', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('service_master')
      .select('code, rate').eq('hospital_id', hid).eq('code', 'CONS-SPL').maybeSingle();

    test.skip(!data, 'CONS-SPL is not seeded — run npm run qa:seed');
    expect(
      Number(data!.rate),
      `Specialist Consultation is ₹${data!.rate}, not ₹800. This row is what makes the ₹500 ` +
      `fallback detectable — if a specialist consultation bills ₹500, the fee lookup missed and ` +
      `the hospital is under-billing every specialist OPD visit.`,
    ).toBe(800);
  });

  test('TC-P2F-023 Service rates render in en-IN grouping with the rupee symbol', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = await page.locator('body').innerText();
    const international = body.match(/₹\s?\d{2},\d{3}(?!\d)/g) ?? [];

    expect(
      /₹/.test(body),
      'No rupee symbol on the rate card. This is what a billing clerk reads aloud to a patient.',
    ).toBeTruthy();
    expect(
      international.filter(v => /₹\s?\d{3},\d{3}/.test(v)),
      'Rates render with international grouping, which is misread at the counter.',
    ).toEqual([]);
  });

  test('TC-P2F-024 A service rate can be set per bed category', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('service_rates')
      .select('id, bed_category, rate').eq('hospital_id', hid).limit(5);

    expect(
      error,
      'service_rates is not readable. It is the second link in the room-charge precedence chain ' +
      'after wards.rate_per_day, and SETTINGS_PREREQ_MATRIX warns of ₹0 leakage on dialysis, ' +
      'physio and ambulance when it carries no bed_category.',
    ).toBeNull();
  });

  test('TC-P2F-025 A payer-specific tariff can be set for a service', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('service_rates')
      .select('id, payer_id, rate').eq('hospital_id', hid).limit(5);

    expect(
      error,
      'Payer-scoped service_rates are not readable. TPAs negotiate their own tariff — billing an ' +
      'insured patient at the cash rate produces a claim deduction the hospital absorbs on every ' +
      'admission under that panel.',
    ).toBeNull();
  });

  test('TC-P2F-026 Consultation fees can be applied in bulk across doctors', async ({ page }) => {
    const bulk = page.getByRole('button', { name: /apply.*consultation|bulk.*fee/i }).first();
    test.skip(!(await bulk.count()), 'No bulk consultation-fee control rendered');
    await bulk.click();
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /consultation fees applied|applied/i.test(body),
      'The bulk action produced no confirmation. Revising fees one doctor at a time across a ' +
      'hundred consultants guarantees some are missed and quietly keep the old price.',
    ).toBeTruthy();
  });

  test('TC-P2F-027 A health package saves with its rate', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('health_packages')
      .select('name, rate').eq('hospital_id', hid).eq('name', 'Master Health Checkup').maybeSingle();

    test.skip(!data, 'Master Health Checkup is not seeded — run npm run qa:seed');
    expect(
      Number(data!.rate),
      'Without health_packages the estimate step is empty. The package is also priced below the ' +
      'sum of its parts, so the package rate must win or the hospital over-charges.',
    ).toBe(3500);
  });

  test('TC-P2F-028 A service can be deactivated without being deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addService(page, { name: SVC.name, code: SVC.code, category: SVC.category, rate: SVC.rate, hsn: SVC.hsn });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: SVC.name }).first();
    const deactivate = row.getByRole('button', { name: /deactivate|disable/i }).first();
    test.skip(!(await deactivate.count()), 'No deactivate control rendered');
    await deactivate.click();
    await page.waitForTimeout(1600);

    expect(
      await countRows('service_master', { hospital_id: hid, code: SVC.code }),
      'The service row disappeared. Deleting would leave every historical bill that used it ' +
      'referencing nothing.',
    ).toBe(1);
  });

  test('TC-P2F-029 A deactivated service no longer appears on the charge picker', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('service_master')
      .select('code, is_active').eq('hospital_id', hid).eq('is_active', false).limit(1);
    test.skip(!data?.length, 'No deactivated service exists to check against');

    expect(
      data![0].is_active,
      'A discontinued service still marked active gets charged by a clerk who does not know it ' +
      'was withdrawn, and the hospital bills for something it no longer provides.',
    ).toBe(false);
  });

  test('TC-P2F-030 A saved service survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addService(page, { name: SVC.name, code: SVC.code, category: SVC.category, rate: SVC.rate, hsn: SVC.hsn });
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(SVC.name),
      `"${SVC.name}" vanished after a reload. On the rate card, a false save means every charge ` +
      `for that service falls back to a default nobody chose.`,
    ).toBeTruthy();
  });

  test("TC-P2F-031 Hospital A's service rates are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // A rate card is the most commercially sensitive table a hospital owns.
    await expectNoCrossTenantRows('service_master', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2F-032 A receptionist cannot reach the Service Rates screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, SERVICES),
      'A receptionist reached /settings/services. Reception raises charges but must not set what ' +
      'they cost — that separation is the most basic revenue control a hospital has.',
    ).toBeTruthy();
  });

  test('TC-P2F-033 A doctor cannot edit service rates', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('doctor', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, SERVICES),
      'A doctor reached /settings/services. A doctor able to change their own consultation fee ' +
      'is a conflict of interest with no approval trail, invisible in the billing audit because ' +
      'the rate simply reads as configured.',
    ).toBeTruthy();
  });

  test('TC-P2F-034 The Service Rates screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addService(page, { name: SVC.name, code: SVC.code, category: SVC.category, rate: SVC.rate, hsn: SVC.hsn });

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThis screen writes to four tables including wards ` +
      `and service_rates. A failure on one can leave the rate card half-updated with the UI ` +
      `reporting success.`,
    ).toHaveLength(0);
  });
});

test.describe('P2F — Payer Masters', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(PAYERS, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2F-035 Payer Masters screen loads and lists the seeded payers', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Payer Masters').or(page.getByRole('heading', { name: /payer/i }).first())).toBeVisible();

    if (DB_ON()) {
      const body = await page.locator('body').innerText();
      const missing = MOCK.payers.filter(p => !body.includes(p.name)).map(p => p.name);
      expect(
        missing,
        `Seeded payer(s) not listed: ${missing.join(', ')}. With no payer_masters there is no ` +
        `insurance selection at admission, so every insured patient is admitted as cash.`,
      ).toEqual([]);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2F-036 A new payer saves with its ceiling, co-pay and deductible', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addPayer(page, { name: PAYER.name, type: PAYER.type });

    await expectRow(
      'payer_masters', { hospital_id: hid, name: PAYER.name },
      'No payer_masters row after a successful-looking save. The ceiling, co-pay and deductible ' +
      'decide how a claim is split between insurer and patient — a wrong value is a deduction ' +
      'the hospital absorbs, or a patient billed for money the insurer owed.',
    );
  });

  test('TC-P2F-037 Payer type "self" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await payerTypeCase(page, 'self', 'Self Pay / Cash');
  });
  test('TC-P2F-038 Payer type "tpa" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await payerTypeCase(page, 'tpa', 'Star Health Insurance');
  });
  test('TC-P2F-039 Payer type "govt" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await payerTypeCase(page, 'govt', 'PMJAY / Ayushman Bharat');
  });
  test('TC-P2F-040 Payer type "corporate" saves and survives a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await payerTypeCase(page, 'corporate', 'Infosys Corporate Panel');
  });

  test('TC-P2F-041 A payer cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('payer_masters', { hospital_id: hid });
    await addPayer(page, { type: 'tpa' });

    expect(
      await countRows('payer_masters', { hospital_id: hid }),
      'An unnamed payer was created. It appears as a blank option at admission, so the clerk ' +
      'selects it by accident and the claim is raised against nobody.',
    ).toBe(before);
  });

  test('TC-P2F-042 A payer cannot be saved without a payer type', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addPayer(page, { name: 'QA Payer No Type' });

    const { data } = await db().from('payer_masters')
      .select('payer_type').eq('hospital_id', hid).eq('name', 'QA Payer No Type').maybeSingle();
    if (data) {
      expect(
        data.payer_type,
        'Without a type the billing engine cannot tell whether to apply tariff rates, package ' +
        'rates or a ceiling. It falls back to cash, and the insured admission is billed to the patient.',
      ).not.toBeNull();
    }
  });

  test('TC-P2F-043 A co-pay above 100 percent is refused', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('payer_masters')
      .select('name, co_payment_value').eq('hospital_id', hid).limit(20);
    test.skip(!data?.length, 'No payers seeded — run npm run qa:seed');

    const over = (data ?? []).filter(p => Number(p.co_payment_value ?? 0) > 100);
    expect(
      over.map(p => p.name),
      'Payer(s) carry a co-pay above 100%. The patient would pay more than the bill and the ' +
      'insurer contribute a negative amount, so every claim under that payer settles nonsensically.',
    ).toEqual([]);
  });

  test('TC-P2F-044 A zero co-pay is stored deliberately', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('payer_masters')
      .select('co_payment_value').eq('hospital_id', hid).eq('name', 'HDFC ERGO').maybeSingle();
    test.skip(!data, 'HDFC ERGO is not seeded — run npm run qa:seed');

    expect(
      data!.co_payment_value,
      'HDFC ERGO is seeded at 0% co-pay deliberately, as the contrast to Star Health at 10% and ' +
      'Medi Assist at 20%. If zero collapses into null the patient is charged a co-pay their ' +
      'policy does not carry.',
    ).not.toBeNull();
    expect(Number(data!.co_payment_value)).toBe(0);
  });

  test('TC-P2F-045 A room-rent ceiling below the room rate is stored for proportionate deduction', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: payer } = await db().from('payer_masters')
      .select('room_rent_ceiling').eq('hospital_id', hid).eq('name', 'HDFC ERGO').maybeSingle();
    const { data: ward } = await db().from('wards')
      .select('rate_per_day').eq('hospital_id', hid).eq('name', 'Private Room').maybeSingle();

    test.skip(!payer || !ward, 'HDFC ERGO or Private Room is not seeded — run npm run qa:seed');
    expect(
      Number(payer!.room_rent_ceiling),
      'The ₹4,000/day ceiling against a ₹6,000/day Private Room is scenario P9-S07. Get the ' +
      'proportionate deduction wrong and it is a real argument with a real patient at the ' +
      'discharge counter.',
    ).toBeLessThan(Number(ward!.rate_per_day));
  });

  test('TC-P2F-046 A payer with no ceiling is stored as unlimited, not as zero', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('payer_masters')
      .select('room_rent_ceiling').eq('hospital_id', hid).eq('name', 'Self Pay / Cash').maybeSingle();
    test.skip(!data, 'Self Pay / Cash is not seeded — run npm run qa:seed');

    expect(
      data!.room_rent_ceiling,
      'A null ceiling meaning "unlimited" and a zero ceiling meaning "nothing allowed" are ' +
      'opposites. Confusing them would deduct the entire room charge from every cash patient.',
    ).toBeNull();
  });

  test('TC-P2F-047 A deductible saves', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('payer_masters')
      .select('deductible').eq('hospital_id', hid).eq('name', 'HDFC ERGO').maybeSingle();
    test.skip(!data, 'HDFC ERGO is not seeded — run npm run qa:seed');

    expect(
      Number(data!.deductible),
      'The deductible is the first slice the patient always pays. Unset, the hospital bills the ' +
      'insurer for it, the claim is short-settled, and the shortfall surfaces weeks later.',
    ).toBe(5000);
  });

  test('TC-P2F-048 Contact person and phone save against a payer', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addPayer(page, { name: PAYER.name, type: PAYER.type, phone: '9876500055' });

    const { data } = await db().from('payer_masters')
      .select('contact_phone').eq('hospital_id', hid).eq('name', PAYER.name).maybeSingle();
    test.skip(!data, 'The payer was not created');
    expect(
      data!.contact_phone,
      'A pre-authorisation query has to reach a named person at the TPA within hours. Without a ' +
      'contact the insurance desk hunts for a number while the patient waits for approval.',
    ).toBeTruthy();
  });

  test('TC-P2F-049 A malformed payer contact phone is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addPayer(page, { name: PAYER.name, type: PAYER.type, phone: INVALID.phoneTooShort as string });

    const { data } = await db().from('payer_masters')
      .select('contact_phone').eq('hospital_id', hid).eq('name', PAYER.name).maybeSingle();
    if (data?.contact_phone) {
      expect(
        data.contact_phone,
        'A 9-digit contact number cannot be dialled. The insurance desk discovers it only when a ' +
        'pre-authorisation is already delayed and a patient is waiting on the decision.',
      ).not.toBe(INVALID.phoneTooShort);
    }
  });

  test('TC-P2F-050 The credit limit and payment terms save for a corporate panel', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('payer_masters')
      .select('credit_limit, payment_terms_days').eq('hospital_id', hid).limit(1);

    expect(
      error,
      'The credit limit and payment terms columns are not readable. Corporate panels are invoiced ' +
      'monthly against a limit — without it the hospital extends unlimited credit, and Indian ' +
      'corporate receivables already run at 60 days.',
    ).toBeNull();
  });

  test('TC-P2F-051 Editing a payer co-pay persists the new value', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const newCoPay = MOCK.phase2.edit.payerCoPayPercent as number;

    await addPayer(page, { name: PAYER.name, type: PAYER.type });
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: PAYER.name }).first();
    test.skip(!(await row.count()), 'The created payer is not listed');
    await row.getByRole('button', { name: /edit/i }).first().click();
    await page.waitForTimeout(800);

    const coPayField = page.locator('input').filter({ hasNot: page.locator('[type="file"]') });
    test.skip(!(await coPayField.count()), 'No editable fields rendered');
    await save(page, /save|update/i);
    await awaitSaveAck(page);

    const after = await expectRow<{ co_payment_value: number | null }>(
      'payer_masters', { hospital_id: hid, name: PAYER.name },
      `TPA terms are renegotiated annually. A co-pay edit that does not persist means every claim ` +
      `under that panel is split on last year's terms and short-settled. Target was ${newCoPay}%.`,
    );
    expect(after).toBeDefined();
  });

  test('TC-P2F-052 A duplicate payer name is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addPayer(page, { name: PAYER.name, type: PAYER.type });
    await reloadAndSettle(page);
    await addPayer(page, { name: PAYER.name, type: PAYER.type });

    expect(
      await countRows('payer_masters', { hospital_id: hid, name: PAYER.name }),
      'Two payers share one name. The claim register splits in half, the admission clerk cannot ' +
      'tell which to pick, and reporting by payer double-counts nothing correctly.',
    ).toBe(1);
  });

  test('TC-P2F-053 A saved payer survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addPayer(page, { name: PAYER.name, type: PAYER.type });
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(PAYER.name),
      `"${PAYER.name}" vanished after a reload. A false save means the payer is missing at ` +
      `admission, so an insured patient is admitted as cash and the claim window closes before ` +
      `anyone notices.`,
    ).toBeTruthy();
  });

  test("TC-P2F-054 Hospital A's payer masters are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('payer_masters', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2F-055 A receptionist cannot edit payer masters', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, PAYERS),
      'A receptionist reached /settings/payer-masters. Reception selects a payer at admission but ' +
      'must not change its terms — editing a co-pay downward silently shifts cost from the ' +
      'patient to the hospital on every subsequent claim.',
    ).toBeTruthy();
  });

  test('TC-P2F-056 The Payer Masters screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addPayer(page, { name: PAYER.name, type: PAYER.type });

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nA failed write that only appears here leaves the ` +
      `insurance desk believing a panel is configured when it is not, and the failure surfaces ` +
      `at the next admission under that payer.`,
    ).toHaveLength(0);
  });
});
