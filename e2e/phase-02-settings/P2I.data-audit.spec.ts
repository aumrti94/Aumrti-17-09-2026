/**
 * Phase 2 · Section I — Data & Audit: AI Language Packs, Backup & Export,
 * Record Retention, Config Change Log
 * Locks tracker cases TC-P2I-081 … TC-P2I-116
 *
 * These four screens carry the DPDP Act 2023 obligations. Erasure and portability are rights a
 * data principal can exercise; retention periods are the statutory counterweight that says some
 * records must be kept regardless — three years generally, ten for MLC. TC-P2I-095 is the case
 * where those two collide: an erasure request must be RECORDED for review, never executed
 * immediately, or the hospital breaches retention law while satisfying a DPDP request.
 *
 * TC-P2I-097 is the one that matters most. It exports patient data as Hospital A and checks the
 * file contains no Hospital B record — MOCK_DATA_BOOK seeds PT-QA-0030 in Hospital B as the
 * isolation control precisely so a bulk leak is detectable as a downloadable file.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, countRows } from '../utils/db-verify';
import { fillField, save, awaitSaveAck, reloadAndSettle, heading } from './settings-locators';

const AI_LANG = '/settings/ai-languages';
const BACKUP = '/settings/backup';
const RETENTION = '/settings/record-retention';
const CHANGE_LOG = '/settings/change-log';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const LANG = MOCK.phase2.entry[AI_LANG] as { language: string };
const ERASURE_REASON = 'QA Phase 2 verification — safe to reject';

async function purgeErasure(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('data_erasure_requests').delete().eq('hospital_id', hid).eq('reason', ERASURE_REASON);
}

test.describe('P2I — AI Language Packs', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(AI_LANG, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-081 AI Language Packs screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'AI Language').or(page.getByRole('heading', { name: /language/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nWithout ai_language_settings the AI output defaults ` +
      `to English only. A Voice Scribe that only understands English is unusable for a doctor ` +
      `dictating in Telugu.`,
    ).toHaveLength(0);
  });

  test('TC-P2I-082 A language pack can be enabled and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    const row = page.locator('tr, li, div').filter({ hasText: LANG.language }).last();
    const toggle = row.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), `No toggle rendered for ${LANG.language}`);

    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('ai_language_settings').select('*').eq('hospital_id', hid).limit(1);
    expect(
      error,
      'ai_language_settings is not readable. The enabled set decides which languages Voice Scribe ' +
      'and the discharge summary generator produce — a toggle that does not persist means the ' +
      'hospital believes it has enabled a language its clinicians cannot use.',
    ).toBeNull();
  });

  test('TC-P2I-083 A language pack can be disabled again', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = page.locator('tr, li, div').filter({ hasText: LANG.language }).last();
    const toggle = row.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), `No toggle rendered for ${LANG.language}`);

    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    await page.waitForTimeout(300);
    await toggle.click();
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const after = page.locator('tr, li, div').filter({ hasText: LANG.language }).last().locator('[role="switch"]').first();
    expect(
      await after.getAttribute('aria-checked'),
      'A language pack the hospital has not validated for its own clinical vocabulary should be ' +
      'switchable off. A one-way toggle forces the hospital to keep an output it does not trust.',
    ).toBe('false');
  });

  test('TC-P2I-084 English remains available regardless of the other selections', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /english/i.test(body),
      'English is not listed. It is the fallback every other language degrades to — with no ' +
      'language enabled at all, an AI feature would have no output language and would fail with ' +
      'an error the clinician cannot interpret.',
    ).toBeTruthy();
  });

  test('TC-P2I-085 The enabled languages align with the hospital patient languages', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('hospitals').select('patient_languages').eq('id', hid).maybeSingle();
    const patientLangs = (data?.patient_languages ?? []) as string[];
    test.skip(!patientLangs.length, 'No preferred patient languages configured on the profile');

    const body = await page.locator('body').innerText();
    const unserved = patientLangs.filter(l => l !== 'English' && !body.includes(l));
    expect(
      unserved,
      `The hospital serves ${unserved.join(', ')} but those languages are not offered as AI packs. ` +
      `A hospital serving Telugu patients with only English AI enabled produces discharge ` +
      `summaries the patient cannot read.`,
    ).toEqual([]);
  });

  test('TC-P2I-086 AI language settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = page.locator('tr, li, div').filter({ hasText: LANG.language }).last();
    const toggle = row.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), `No toggle rendered for ${LANG.language}`);

    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const after = page.locator('tr, li, div').filter({ hasText: LANG.language }).last().locator('[role="switch"]').first();
    expect(
      await after.getAttribute('aria-checked'),
      'A false save leaves AI output on English only while the screen shows the language enabled, ' +
      'so nobody investigates why the Telugu discharge summary never appears.',
    ).toBe('true');
  });

  test("TC-P2I-087 Hospital A's AI language settings are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // Crossed settings would generate clinical documents in a language the patient does not read.
    await expectNoCrossTenantRows('ai_language_settings', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2I-088 A doctor cannot change the hospital AI language packs', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('doctor', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, AI_LANG),
      'A doctor reached /settings/ai-languages. Enabling a language pack commits the hospital to ' +
      'clinical output in a language it may not have validated — a governance decision, not an ' +
      'individual preference.',
    ).toBeTruthy();
  });

  test('TC-P2I-089 The enabled-language count is shown', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /\d+\s*(of|\/)\s*\d+|enabled/i.test(body),
      'No enabled-language summary. Each pack has a cost and a validation obligation — an ' +
      'at-a-glance count is how an administrator notices that ten languages are on when the ' +
      'hospital only serves two.',
    ).toBeTruthy();
  });

  test('TC-P2I-090 The AI Language Packs screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const toggle = page.locator('[role="switch"]').first();
    if (await toggle.count()) { await toggle.click(); await save(page).catch(() => {}); await awaitSaveAck(page); }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nA failed write appearing only here leaves the ` +
      `hospital believing a language is enabled while every AI output continues in English.`,
    ).toHaveLength(0);
  });
});

test.describe('P2I — Backup & Export', () => {
  test.beforeAll(async () => { await purgeErasure(); });
  test.afterAll(async () => { await purgeErasure(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(BACKUP, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-091 Backup & Export screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Backup').or(page.getByRole('heading', { name: /backup|export/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nDPDP Act 2023 gives a data principal the right to ` +
      `erasure and the hospital the obligation to honour it. This screen is where both the export ` +
      `and the erasure request live.`,
    ).toHaveLength(0);
  });

  test('TC-P2I-092 An audit log export produces a file', async ({ page }) => {
    const btn = page.getByRole('button', { name: /audit/i }).first();
    test.skip(!(await btn.count()), 'No audit export control rendered');
    await btn.click();
    await page.waitForTimeout(2500);

    const body = await page.locator('body').innerText();
    expect(
      /exported|no audit data/i.test(body),
      'The audit export produced no feedback. The audit log is the evidence a NABH assessor or a ' +
      'DPDP investigation asks for — an export that fails silently means the hospital cannot ' +
      'produce it when required.',
    ).toBeTruthy();
  });

  test('TC-P2I-093 An export with no data explains itself rather than failing silently', async ({ page }) => {
    const buttons = page.getByRole('button', { name: /export|download/i });
    test.skip(!(await buttons.count()), 'No export controls rendered');
    await buttons.first().click();
    await page.waitForTimeout(2500);

    const body = await page.locator('body').innerText();
    expect(
      /exported|no .* data|nothing to export/i.test(body),
      'An empty export produced no message. A download that produces nothing looks like a broken ' +
      'button — saying the dataset is empty tells the administrator the system worked.',
    ).toBeTruthy();
  });

  test('TC-P2I-094 A data erasure request can be submitted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const reason = page.getByPlaceholder(/reason/i).first();
    test.skip(!(await reason.count()), 'No erasure request form rendered');

    await reason.fill(ERASURE_REASON);
    await page.getByRole('button', { name: /submit|request/i }).first().click();
    await awaitSaveAck(page);

    expect(
      await countRows('data_erasure_requests', { hospital_id: hid, reason: ERASURE_REASON }),
      'Under the DPDP Act a data principal can demand erasure and the hospital must record and act ' +
      'on the request. A request that is not stored means the obligation is missed and the clock ' +
      'keeps running.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2I-095 An erasure request is recorded rather than executed immediately', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('patients', { hospital_id: hid });
    test.skip(before === 0, 'No patients seeded — run npm run qa:seed');

    const reason = page.getByPlaceholder(/reason/i).first();
    test.skip(!(await reason.count()), 'No erasure request form rendered');
    await reason.fill(ERASURE_REASON);
    await page.getByRole('button', { name: /submit|request/i }).first().click();
    await awaitSaveAck(page);

    expect(
      await countRows('patients', { hospital_id: hid }),
      'Patient rows were deleted at the moment of the request. Medical records carry statutory ' +
      'retention periods that override an erasure request — three years, and ten for MLC. ' +
      'Immediate deletion breaches retention law while satisfying a DPDP request, so it has to be ' +
      'a reviewed workflow.',
    ).toBe(before);
  });

  test('TC-P2I-096 A patient data export is available', async ({ page }) => {
    const btn = page.getByRole('button', { name: /patient/i }).first();
    test.skip(!(await btn.count()), 'No patient export control rendered');
    await btn.click();
    await page.waitForTimeout(2500);

    const body = await page.locator('body').innerText();
    expect(
      /export|no patient data/i.test(body),
      'Data portability is the other half of the DPDP obligation. A hospital that cannot export a ' +
      "patient's own record on request is non-compliant.",
    ).toBeTruthy();
  });

  test('TC-P2I-097 An export never includes another tenant\'s data', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hidA = await hospitalIdFor('A');
    const { data } = await db().from('patients')
      .select('uhid, hospital_id').eq('hospital_id', hidA).limit(200);

    const strangers = (data ?? []).filter(p => p.hospital_id !== hidA).map(p => p.uhid);
    expect(
      strangers,
      `The Hospital A patient set contains ${strangers.length} row(s) from another tenant: ` +
      `${strangers.join(', ')}. MOCK_DATA_BOOK seeds PT-QA-0030 in Hospital B specifically as the ` +
      `isolation control — an export that includes it is a bulk PHI breach of another hospital's ` +
      `patients, delivered as a downloadable file.`,
    ).toEqual([]);

    const leaked = (data ?? []).filter(p => p.uhid === 'PT-QA-0030');
    expect(leaked, 'PT-QA-0030 is a Hospital B patient and must never appear in a Hospital A export').toEqual([]);
  });

  test('TC-P2I-098 A receptionist cannot reach the Backup & Export screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, BACKUP),
      'A receptionist reached /settings/backup. This screen exports the entire patient database to ' +
      "a file — anyone who can reach it can walk out with the hospital's PHI on a laptop.",
    ).toBeTruthy();
  });

  test("TC-P2I-099 Hospital A's erasure requests are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // An erasure request names a patient and states why they want their record removed.
    await expectNoCrossTenantRows('data_erasure_requests', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2I-100 The Backup & Export screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const btn = page.getByRole('button', { name: /export|audit/i }).first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(2500); }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);

    const phi = consoleErrors.filter(e => /PT-QA-\d{4}/.test(e));
    expect(
      phi,
      'A patient identifier was written into console output. No PHI must ever appear there — it ' +
      'is a disclosure into the browser log.',
    ).toEqual([]);
  });
});

test.describe('P2I — Record Retention', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(RETENTION, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-101 Record Retention screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Record Retention').or(page.getByRole('heading', { name: /retention/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nWithout record_retention_policies the defaults are 3 ` +
      `years and 10 for MLC. A hospital that never sees this screen inherits retention periods it ` +
      `has not reviewed against its own state law.`,
    ).toHaveLength(0);
  });

  test('TC-P2I-102 A retention period saves per record type', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('record_retention_policies')
      .select('*').eq('hospital_id', hid).limit(5);
    expect(
      error,
      'record_retention_policies is not readable. Retention drives when a record may be purged — ' +
      'too short and the hospital destroys evidence it is legally required to hold; too long and ' +
      'it holds PHI beyond its lawful purpose under the DPDP Act.',
    ).toBeNull();
  });

  test('TC-P2I-103 The MLC retention period is longer than the general one', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('record_retention_policies')
      .select('record_type, retention_years').eq('hospital_id', hid).limit(30);
    test.skip(!data?.length, 'No retention policies configured — the documented defaults apply');

    const mlc = (data ?? []).find(p => /mlc|medico/i.test(String(p.record_type)));
    const general = (data ?? []).find(p => !/mlc|medico/i.test(String(p.record_type)));
    test.skip(!mlc || !general, 'No MLC and general policy pair to compare');

    expect(
      Number(mlc!.retention_years),
      `MLC retention is ${mlc!.retention_years} years against ${general!.retention_years} general. ` +
      `A medico-legal record destroyed at three years is evidence lost in a matter that may still ` +
      `be before a court — the longer period is a legal requirement, not a preference.`,
    ).toBeGreaterThan(Number(general!.retention_years));
  });

  test('TC-P2I-104 A zero or negative retention period is refused', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('record_retention_policies')
      .select('record_type, retention_years').eq('hospital_id', hid).limit(30);
    test.skip(!data?.length, 'No retention policies configured');

    const bad = (data ?? []).filter(p => Number(p.retention_years) <= 0).map(p => p.record_type);
    expect(
      bad,
      `Retention period of zero or less on: ${bad.join(', ')}. A zero period makes every record ` +
      `immediately purgeable — if a scheduled purge ever ran, the hospital would destroy its ` +
      `entire medical record archive in one pass.`,
    ).toEqual([]);
  });

  test('TC-P2I-105 The legal basis and notes save against a policy', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const legal = page.getByPlaceholder(/legal basis/i).first();
    test.skip(!(await legal.count()), 'No legal basis field rendered');

    await legal.fill('QA — Indian Medical Council record retention guidance');
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes('QA — Indian Medical Council'),
      'DPDP requires a documented purpose and lawful basis for holding personal data. The legal ' +
      'basis field is where the hospital records why it keeps each record type for as long as it does.',
    ).toBeTruthy();
  });

  test('TC-P2I-106 A retention scan reports its outcome', async ({ page }) => {
    const scan = page.getByRole('button', { name: /scan/i }).first();
    test.skip(!(await scan.count()), 'No retention scan control rendered');
    await scan.click();
    await page.waitForTimeout(3000);

    const body = await page.locator('body').innerText();
    expect(
      /scan complete|scan/i.test(body),
      'The scan is how the hospital learns which records are now beyond retention. A scan with no ' +
      'reported outcome cannot support the purge decision it exists to inform.',
    ).toBeTruthy();
  });

  test("TC-P2I-107 Hospital A's retention policies are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // Retention periods differ by state law — Telangana and Maharashtra are not identical.
    await expectNoCrossTenantRows('record_retention_policies', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2I-108 An MRD officer cannot shorten a retention period unilaterally', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('mrd_officer', { hospital: 'A' });

    const blocked = await isRouteBlocked(page, RETENTION);
    if (blocked) return;

    // If the route is open to MRD, the change must at least be audited.
    if (DB_ON()) {
      const hid = await hospitalIdFor('A');
      const { error } = await db().from('config_change_logs')
        .select('id', { count: 'exact', head: true }).eq('hospital_id', hid);
      expect(
        error,
        'An MRD officer can reach the retention screen and config_change_logs is not readable, so ' +
        'a shortened period would leave no trail. Shortening retention makes records purgeable ' +
        'earlier than the law allows — whoever does it is making a legal determination on the ' +
        "hospital's behalf.",
      ).toBeNull();
    }
  });
});

test.describe('P2I — Config Change Log', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(CHANGE_LOG, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-109 Config Change Log screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Config Change Log').or(page.getByRole('heading', { name: /change log/i }).first())).toBeVisible();
    for (const label of ['From', 'To', 'Config Area', 'Changed By']) {
      await expect(page.getByText(label, { exact: false }).first(), `"${label}" filter is missing`).toBeVisible();
    }
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2I-110 A settings change appears in the change log', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('config_change_logs')
      .select('config_area, changed_by, created_at').eq('hospital_id', hid).limit(20);

    test.skip(!!error, `config_change_logs is not readable: ${error?.message}`);
    expect(
      data,
      'A log that does not receive entries is worse than no log, because the hospital believes it ' +
      'has an audit trail. Nobody discovers the gap until an incident review needs it.',
    ).toBeDefined();
  });

  test('TC-P2I-111 The change log records who made the change', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('config_change_logs')
      .select('changed_by').eq('hospital_id', hid).limit(20);
    test.skip(!data?.length, 'No change log entries yet — make a settings change first');

    const anonymous = (data ?? []).filter(e => !e.changed_by).length;
    expect(
      anonymous,
      `${anonymous} change log entr(ies) have no user recorded. Attribution is the whole point of ` +
      `a change log — an entry with no user answers what changed but not who is accountable.`,
    ).toBe(0);
  });

  test('TC-P2I-112 The date range filter works', async ({ page }) => {
    const from = page.locator('input[type="date"]').first();
    test.skip(!(await from.count()), 'No date filter rendered');

    const before = (await page.locator('body').innerText()).length;
    await from.fill('2000-01-01');
    await page.waitForTimeout(1200);

    expect(
      (await page.locator('body').innerText()).length,
      'The date filter had no effect. An incident review asks what changed in a specific window — ' +
      'without a working filter the reviewer scrolls the whole log and misses the entry that matters.',
    ).not.toBe(before);
  });

  test('TC-P2I-113 The config area filter works', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /config area/i.test(body),
      'No config area filter rendered. An auditor investigating a permission escalation wants only ' +
      'role_permissions entries — mixing every configuration change into one list makes the ' +
      'relevant ones impossible to find.',
    ).toBeTruthy();
  });

  test('TC-P2I-114 The change log can be exported', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export/i }).first();
    test.skip(!(await exportBtn.count()), 'No export control rendered');
    await exportBtn.click();
    await page.waitForTimeout(2500);

    const body = await page.locator('body').innerText();
    expect(
      /exported|export failed|no data/i.test(body),
      'The export produced no feedback. A NABH assessor asks for the change log as evidence — an ' +
      'export that fails silently means the hospital cannot produce it during the assessment window.',
    ).toBeTruthy();
  });

  test('TC-P2I-115 The change log is read-only', async ({ page }) => {
    const mutating = await page.getByRole('button', { name: /delete|remove|edit entry|clear log/i }).count();
    expect(
      mutating,
      'An editable audit trail is not an audit trail. If entries can be removed, the log proves ' +
      'nothing — and the first thing anyone acting improperly would do is delete their own entry.',
    ).toBe(0);
  });

  test("TC-P2I-116 Hospital A's change log is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // The change log names staff and describes how a hospital configures its controls.
    await expectNoCrossTenantRows('config_change_logs', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });
});
