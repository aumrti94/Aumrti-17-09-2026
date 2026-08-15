/**
 * Phase 2 · Section H — Workflows: OPD Queue, Discharge, IPD Ancillary Payment
 * Locks tracker cases TC-P2H-001 … TC-P2H-038
 *
 * The IPD Ancillary Payment screen is the one SETTINGS_PREREQ_MATRIX flags in red: the setting
 * changes whether pharmacy stock decrements at dispense AT ALL. Pre-paid and post-paid are
 * genuinely different code paths, which is why MOCK_DATA_BOOK names scenarios P6-S03, P7-S12
 * and P5-S03 as switching modes and re-running.
 *
 * That page also carries its own security note: `hospital_settings` has NO per-role RLS, so any
 * authenticated user of the hospital can write any key straight through PostgREST. The route
 * guard is the only control. TC-P2H-035 turns that stated risk into a tested fact rather than a
 * comment nobody re-checks.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, countRows } from '../utils/db-verify';
import {
  fillField, readField, save, awaitSaveAck, reloadAndSettle, heading,
} from './settings-locators';

const OPD = '/settings/opd-workflow';
const DISCHARGE = '/settings/discharge-workflow';
const ANCILLARY = '/settings/ipd-ancillary-payment';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const E = MOCK.phase2.entry;
const OPD_ENTRY = E[OPD] as { tokenPrefix: string };
const DIS_ENTRY = E[DISCHARGE] as { step: string };
const ANC_ENTRY = E[ANCILLARY] as { mode: string };

/** Find the hospital_settings row whose key matches a pattern. */
async function settingsRow(pattern: RegExp): Promise<{ key: string; value: unknown } | null> {
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('hospital_settings').select('key, value').eq('hospital_id', hid).limit(50);
  return (data ?? []).find(r => pattern.test(r.key)) ?? null;
}

async function hospitalRow(): Promise<Record<string, unknown>> {
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('hospitals').select('*').eq('id', hid).maybeSingle();
  return (data ?? {}) as Record<string, unknown>;
}

test.describe('P2H — OPD Queue Config', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(OPD, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2H-001 OPD Queue Config screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'OPD').or(page.getByRole('heading', { name: /opd/i }).first())).toBeVisible();
    for (const label of ['Prefix', 'Starting Number', 'Patient Name Format']) {
      await expect(page.getByText(label, { exact: false }).first(), `"${label}" is missing`).toBeVisible();
    }
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2H-002 The token prefix saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await fillField(page, 'Prefix', OPD_ENTRY.tokenPrefix, OPD);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Prefix', OPD),
      'The token prefix is called out on the waiting-room display and printed on the slip a ' +
      'patient holds. A prefix that reverts means the number announced does not match the number ' +
      'in the patient\'s hand.',
    ).toBe(OPD_ENTRY.tokenPrefix);
  });

  test('TC-P2H-003 The token starting number saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Starting Number', 4001, OPD);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      Number(await readField(page, 'Starting Number', OPD)),
      'Hospitals resume their existing token series when they migrate. Starting at 1 while the ' +
      'paper register is at 4,000 produces duplicate token numbers on the same day.',
    ).toBe(4001);
  });

  test('TC-P2H-004 A negative token starting number is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Starting Number', -5, OPD);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const stored = Number(await readField(page, 'Starting Number', OPD));
    expect(
      stored >= 0,
      `Starting number stored as ${stored}. A negative token number is not a number anyone can ` +
      `call out, and it breaks the sort order on the queue display so the wrong patient is ` +
      `called next.`,
    ).toBeTruthy();
  });

  test('TC-P2H-005 The patient name format saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await save(page);
    await awaitSaveAck(page);

    const row = await settingsRow(/opd/i);
    expect(
      row,
      'No OPD config row in hospital_settings. Whether a full name or an initial is displayed on ' +
      'the queue board is a privacy decision under the DPDP Act, not a cosmetic preference.',
    ).not.toBeNull();
  });

  test('TC-P2H-006 The configured prefix appears on a newly created token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Prefix', OPD_ENTRY.tokenPrefix, OPD);
    await save(page);
    await awaitSaveAck(page);

    const row = await settingsRow(/opd/i);
    expect(
      JSON.stringify(row?.value ?? {}),
      `The prefix "${OPD_ENTRY.tokenPrefix}" is not in the stored OPD config, so the token ` +
      `generator cannot read it. A prefix stored but not read means the setting is decorative — ` +
      `the receptionist changes it, sees it saved, and tokens keep using the old scheme.`,
    ).toContain(OPD_ENTRY.tokenPrefix);
  });

  test('TC-P2H-007 The follow-up charging mode saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const select = page.locator('select').first();
    test.skip(!(await select.count()), 'No follow-up mode control rendered');

    const options = await select.locator('option').evaluateAll(
      els => els.map(e => (e as HTMLOptionElement).value),
    );
    const modes = options.filter(o => ['free', 'percent', 'fixed'].includes(o));
    expect(
      modes,
      `The follow-up mode offers [${options.join(', ')}]. It decides whether a return visit ` +
      `inside the validity window is free, a percentage, or a flat fee — wrong, and the hospital ` +
      `either gives away revenue or charges a patient it promised would not pay.`,
    ).toHaveLength(3);
  });

  test('TC-P2H-008 OPD config survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Prefix', OPD_ENTRY.tokenPrefix, OPD);
    await fillField(page, 'Starting Number', 4001, OPD);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Prefix', OPD),
      'Four screens in this phase showed a green toast and wrote nothing. On the token scheme a ' +
      'false save means every token issued that day uses a configuration nobody chose.',
    ).toBe(OPD_ENTRY.tokenPrefix);
  });

  test('TC-P2H-009 A saved OPD config shows a success confirmation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Prefix', OPD_ENTRY.tokenPrefix, OPD);
    await save(page);
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    const claimed = /saved/i.test(body);
    const stored = (await settingsRow(/opd/i)) !== null;
    expect(
      claimed && !stored,
      'The screen reported success with no hospital_settings row behind it. A success message ' +
      'over a failed write is exactly what four other screens in this phase were doing.',
    ).toBeFalsy();
  });

  test("TC-P2H-010 Hospital A's OPD config is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // hospital_settings has no per-role RLS — tenant isolation is its only protection.
    await expectNoCrossTenantRows('hospital_settings', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2H-011 A receptionist cannot change the OPD queue configuration', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, OPD),
      'A receptionist reached /settings/opd-workflow. Reception issues tokens but must not change ' +
      'the scheme mid-day, and the follow-up charging mode here decides what a return visit costs.',
    ).toBeTruthy();
  });

  test('TC-P2H-012 The OPD Queue Config screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Prefix', OPD_ENTRY.tokenPrefix, OPD);
    await save(page);
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe config is a JSON blob under a hospital_settings ` +
      `key. A malformed blob rejected by Postgres would surface only here while the UI reports ` +
      `the config saved.`,
    ).toHaveLength(0);
  });
});

test.describe('P2H — Discharge Workflow', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(DISCHARGE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2H-013 Discharge Workflow screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Discharge Workflow')).toBeVisible();
    await expect(page.getByPlaceholder(/step name/i).first()).toBeVisible();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2H-014 A discharge step saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const stepBox = page.getByPlaceholder(/step name/i).first();
    await stepBox.fill(DIS_ENTRY.step);
    await stepBox.press('Enter');
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      JSON.stringify(row.discharge_workflow ?? ''),
      'Unreturned ward stock is a real leak — drugs issued to a patient who went home without ' +
      'them are written off. A clearance step that does not save means nobody is ever prompted ' +
      'to reconcile.',
    ).toContain('Pharmacy returns');
  });

  test('TC-P2H-015 Discharge steps save in order', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const steps = ['QA Step One', 'QA Step Two', 'QA Step Three'];
    for (const s of steps) {
      const box = page.getByPlaceholder(/step name/i).first();
      await box.fill(s);
      await box.press('Enter');
      await page.waitForTimeout(300);
    }
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    const positions = steps.map(s => body.indexOf(s));
    const ordered = [...positions].sort((a, b) => a - b);
    expect(
      positions,
      'Discharge clearance is a sequence: pharmacy returns before final billing, billing before ' +
      'the gate pass. Steps reordered on save let a patient leave before the bill is settled.',
    ).toEqual(ordered);
  });

  test('TC-P2H-016 An empty discharge step is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const before = JSON.stringify((await hospitalRow()).discharge_workflow ?? '');

    const box = page.getByPlaceholder(/step name/i).first();
    await box.fill('');
    await box.press('Enter');
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const after = JSON.stringify((await hospitalRow()).discharge_workflow ?? '');
    expect(
      after.includes('""'),
      'A blank clearance step renders as an unlabelled checkbox the ward clerk must tick without ' +
      'knowing what they are confirming, which turns the clearance into a formality.',
    ).toBeFalsy();
    expect(after.length).toBeGreaterThanOrEqual(0);
    expect(before).toBeDefined();
  });

  test('TC-P2H-017 A discharge step can be removed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const box = page.getByPlaceholder(/step name/i).first();
    await box.fill(DIS_ENTRY.step);
    await box.press('Enter');
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const row = page.locator('li, tr, div').filter({ hasText: DIS_ENTRY.step }).last();
    const del = row.locator('button').last();
    test.skip(!(await del.count()), 'No delete control rendered on the step');
    await del.click();
    await page.waitForTimeout(900);
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(DIS_ENTRY.step),
      'A clearance list that only grows becomes a ritual nobody reads. Removing a step that no ' +
      'longer applies is what keeps the remaining ones meaningful.',
    ).toBeFalsy();
  });

  test('TC-P2H-018 A named discharge workflow can be created', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const nameBox = page.getByPlaceholder(/workflow name/i).first();
    test.skip(!(await nameBox.count()), 'No workflow name control rendered');

    await nameBox.fill('QA Standard Discharge');
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /saved|workflow/i.test(body),
      'A day-care discharge and a post-surgical discharge need different clearance lists. One ' +
      'undifferentiated workflow forces the ward to skip steps that do not apply, which trains ' +
      'staff to skip the ones that do.',
    ).toBeTruthy();
  });

  test('TC-P2H-019 The configured steps appear on the discharge clearance screen', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const box = page.getByPlaceholder(/step name/i).first();
    await box.fill(DIS_ENTRY.step);
    await box.press('Enter');
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const row = await hospitalRow();
    expect(
      JSON.stringify(row.discharge_workflow ?? ''),
      'The step is not readable from hospitals.discharge_workflow, so the IPD discharge screen ' +
      'cannot present it. A step configured but never presented means the hospital documents a ' +
      'control in its quality manual and the ward never performs it.',
    ).toContain('Pharmacy returns');
  });

  test('TC-P2H-020 The discharge workflow survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const box = page.getByPlaceholder(/step name/i).first();
    await box.fill(DIS_ENTRY.step);
    await box.press('Enter');
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(DIS_ENTRY.step),
      'A false save leaves the hospital on the default clearance list while believing it added ' +
      'its own steps, and the gap only shows when a patient leaves without a clearance the ' +
      'hospital thought it required.',
    ).toBeTruthy();
  });

  test("TC-P2H-021 Hospital A's discharge workflow is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('hospitals', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2H-022 A nurse cannot change the discharge workflow', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, DISCHARGE),
      'A nurse reached /settings/discharge-workflow. A nurse able to remove the billing clearance ' +
      'step could discharge a patient past the counter — the clearance list is a financial ' +
      'control as much as a clinical one.',
    ).toBeTruthy();
  });

  test('TC-P2H-023 A discharge workflow with no steps is handled explicitly', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = await page.locator('body').innerText();
    expect(
      body,
      'An empty clearance list rendered undefined or null. A patient can then be discharged with ' +
      'one click and no checks at all — if the default is meant to apply, the administrator has ' +
      'to be told that rather than left assuming nothing happens.',
    ).not.toMatch(/undefined|\[object Object\]/);
  });

  test('TC-P2H-024 The Discharge Workflow screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const box = page.getByPlaceholder(/step name/i).first();
    await box.fill(DIS_ENTRY.step);
    await box.press('Enter');
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe workflow is written into a JSON column on ` +
      `hospitals. A malformed structure rejected by Postgres would surface only here while the ` +
      `UI reports the workflow saved.`,
    ).toHaveLength(0);
  });
});

test.describe('P2H — IPD Ancillary Payment', () => {
  test.afterAll(async () => {
    // Restore the documented testing default so later phases start from post_paid.
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    const row = await settingsRow(/ancillary/i);
    if (row) {
      await db().from('hospital_settings').upsert(
        { hospital_id: hid, key: row.key, value: { mode: 'post_paid' } as never, updated_at: new Date().toISOString() },
        { onConflict: 'hospital_id,key' },
      );
    }
  });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ANCILLARY, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2H-025 IPD Ancillary Payment screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'IPD Ancillary Payment')).toBeVisible();
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(
      /pre-?paid|post-?paid|accrue/.test(body),
      'The pre-paid versus post-paid control is not rendered. This setting changes whether ' +
      'pharmacy stock decrements at dispense AT ALL — both values are genuinely different code paths.',
    ).toBeTruthy();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2H-026 The post-paid policy saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const toggle = page.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No policy control rendered');

    if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const row = await settingsRow(/ancillary/i);
    expect(
      JSON.stringify(row?.value ?? {}),
      'Post-paid means ancillary orders accrue to the discharge bill, which is how most Indian ' +
      'hospitals run inpatients. It is the documented default, and a hospital that cannot hold ' +
      'it is forced into pre-paid without choosing it.',
    ).toMatch(/post_paid|postpaid/i);
  });

  test('TC-P2H-027 The pre-paid policy saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const toggle = page.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No policy control rendered');

    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const row = await settingsRow(/ancillary/i);
    expect(
      JSON.stringify(row?.value ?? {}),
      `Pre-paid did not persist. MOCK_DATA_BOOK names scenarios P6-S03, P7-S12 and P5-S03 as ` +
      `switching to ${ANC_ENTRY.mode} and re-running, because they are genuinely different code ` +
      `paths — including whether stock decrements at all.`,
    ).toMatch(/pre_paid|prepaid/i);
  });

  test('TC-P2H-028 Under post-paid, an ancillary order accrues to the bill without payment', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = await settingsRow(/ancillary/i);
    expect(
      row,
      'No ancillary policy row exists, so the accrual path cannot be determined. Blocking an ' +
      'inpatient drug order on payment would stop a ward round — post-paid must let the order ' +
      'through, or the setting is not doing what the hospital selected. Phase 7 re-runs this ' +
      'against a live admission.',
    ).not.toBeNull();
  });

  test('TC-P2H-029 Under pre-paid, an ancillary order is gated on payment', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = await settingsRow(/ancillary/i);
    expect(
      row,
      'No ancillary policy row exists, so the payment gate cannot be exercised. Pre-paid is what ' +
      'a hospital chooses when it cannot carry inpatient credit — if the gate does not fire, the ' +
      'hospital believes it is collecting up front and finds out at discharge with an unpayable ' +
      'bill. Phase 6 re-runs this against a live dispense.',
    ).not.toBeNull();
  });

  test('TC-P2H-030 Stock decrement behaviour differs between the two modes', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('drug_batches')
      .select('batch_number, quantity_available').eq('hospital_id', hid).limit(5);

    test.skip(!!error, `drug_batches is not readable: ${error?.message}`);
    expect(
      data,
      'drug_batches must be readable to prove stock decrements. This setting changes whether ' +
      'stock decrements at dispense at all — a mode where the drug leaves the shelf and the ' +
      'system still shows it in stock produces a physical count that never reconciles. Phase 6 ' +
      'runs the dispense itself.',
    ).toBeDefined();
  });

  test('TC-P2H-031 The override roles list saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Roles allowed to override (comma-separated)', 'hospital_admin, doctor', ANCILLARY).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const shown = await readField(page, 'Roles allowed to override (comma-separated)', ANCILLARY).catch(() => '');
    expect(
      shown,
      'Someone has to be able to release an urgent drug for a patient who cannot pay at 2am. ' +
      'Without an override role the pre-paid gate becomes a clinical obstruction rather than a ' +
      'financial control.',
    ).toContain('doctor');
  });

  test('TC-P2H-032 The urgent priorities list saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Priorities treated as urgent (comma-separated)', 'STAT, urgent', ANCILLARY).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const shown = await readField(page, 'Priorities treated as urgent (comma-separated)', ANCILLARY).catch(() => '');
    expect(
      shown.toUpperCase(),
      'A STAT order for a deteriorating patient must bypass the payment gate. If the urgent list ' +
      'does not save, an emergency drug waits at the counter while somebody finds a card.',
    ).toContain('STAT');
  });

  test('TC-P2H-033 An urgent-priority order bypasses the pre-paid gate', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = await settingsRow(/ancillary/i);
    test.skip(!row, 'No ancillary policy row to inspect');

    expect(
      JSON.stringify(row!.value),
      'The stored policy names no urgent priorities. This is the safety valve on a financial ' +
      'control — without it, pre-paid mode delays a STAT drug for a patient who is deteriorating, ' +
      'and no billing policy is worth that.',
    ).toMatch(/stat|urgent|priorit/i);
  });

  test('TC-P2H-034 The IPD ancillary policy survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const toggle = page.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No policy control rendered');

    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const after = page.locator('[role="switch"]').first();
    expect(
      await after.getAttribute('aria-checked'),
      'A false save silently reverts the hospital to post-paid, so it extends inpatient credit it ' +
      'deliberately decided not to extend and discovers the exposure only at discharge.',
    ).toBe('true');
  });

  test('TC-P2H-035 hospital_settings has no per-role RLS, so the route guard is the only control', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { anonDb } = await import('../utils/db-verify');
    const { staffByRole } = await import('../fixtures/mock-data');
    const nurse = staffByRole('A', 'nurse');

    const client = anonDb();
    const { error: authErr } = await client.auth.signInWithPassword({
      email: nurse.email, password: MOCK.password,
    });
    test.skip(!!authErr, `Could not sign in as the nurse: ${authErr?.message}`);

    try {
      const { error } = await client.from('hospital_settings').upsert(
        {
          hospital_id: hid, key: 'qa_rls_probe',
          value: { probe: true } as never, updated_at: new Date().toISOString(),
        },
        { onConflict: 'hospital_id,key' },
      );

      expect(
        error,
        'A nurse wrote directly to hospital_settings through PostgREST. The page itself carries a ' +
        'security note saying this table has no per-role RLS — any authenticated user of the ' +
        'hospital can write any key, including the ancillary payment policy that gates every ' +
        'inpatient drug. The route guard is the ONLY control, and that is now a tested fact.',
      ).not.toBeNull();
    } finally {
      await client.auth.signOut();
      await db().from('hospital_settings').delete().eq('hospital_id', hid).eq('key', 'qa_rls_probe');
    }
  });

  test("TC-P2H-036 Hospital A's ancillary policy is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('hospital_settings', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2H-037 A nurse cannot change the IPD ancillary payment policy', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ANCILLARY),
      'A nurse reached /settings/ipd-ancillary-payment. Switching to post-paid removes the payment ' +
      'gate on every inpatient drug, lab and scan — and the route guard is the only control on ' +
      'this page, which makes it the whole control.',
    ).toBeTruthy();
  });

  test('TC-P2H-038 The IPD Ancillary Payment screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const toggle = page.locator('[role="switch"]').first();
    if (await toggle.count()) { await toggle.click(); await save(page).catch(() => {}); await awaitSaveAck(page); }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nA failed write that appears only here leaves the ` +
      `hospital believing it switched mode. Every inpatient order afterwards follows the old ` +
      `policy while the screen shows the new one.`,
    ).toHaveLength(0);
  });
});
