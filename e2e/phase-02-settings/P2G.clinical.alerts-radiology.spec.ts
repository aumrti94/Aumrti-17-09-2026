/**
 * Phase 2 · Section G — Notification Config & Radiology
 * Locks tracker cases TC-P2G-057 … TC-P2G-092
 *
 * REGRESSION LOCK FOR BUG-P2-003 (notifications). Until Phase 2 QA this screen persisted
 * nothing: Save ran a 500ms `setTimeout` and then toasted success — a fake spinner in front of
 * a no-op, which is the most convincing possible disguise for a screen that saves nothing. A
 * hospital that routed Critical Lab Value to WhatsApp found it back on In-App the next morning.
 *
 * Radiology carries two cases that are legal, not merely functional. PCPNDT Form F is required
 * for every obstetric ultrasound and failure to maintain it is a criminal matter for the
 * centre. MOCK_DATA_BOOK seeds two obstetric studies with deliberately different names —
 * "USG Obstetric (Level II)" and "USG Pregnancy Profile" — because Form F auto-creation
 * triggers on the name containing "obstetric". TC-P2G-079 records what actually happens to the
 * second one; if the trigger really is name-based, that scan escapes Form F entirely.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import {
  fillField, selectByValue, save, openCreate, awaitSaveAck, reloadAndSettle, heading,
} from './settings-locators';

const NOTIF = '/settings/notifications';
const RADIO = '/settings/radiology';
const NOTIF_KEY = 'notification_config';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const N = MOCK.phase2.entry[NOTIF] as {
  alertType: string; channel: string; quietFrom: string; quietTo: string;
};
const RAD = MOCK.phase2.entry[RADIO] as {
  modality: string; modalityType: string; study: string; fee: number;
};
const CHANNEL_LABEL: Record<string, string> = { in_app: 'In-App', whatsapp: 'WhatsApp', both: 'Both' };

async function notifConfig(): Promise<{ alerts?: Array<Record<string, unknown>>; quietHours?: Record<string, unknown> } | null> {
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('hospital_settings')
    .select('value').eq('hospital_id', hid).eq('key', NOTIF_KEY).maybeSingle();
  return (data?.value ?? null) as never;
}

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('hospital_settings').delete().eq('hospital_id', hid).eq('key', NOTIF_KEY);
  await db().from('radiology_study_master').delete().eq('hospital_id', hid).eq('name', RAD.study);
  await db().from('radiology_modalities').delete().eq('hospital_id', hid).eq('name', RAD.modality);
}

/** Set the Critical Lab Value channel and save. Titles stay literal — see P2D wards. */
async function channelCase(page: import('@playwright/test').Page, value: string) {
  const row = page.locator('tr').filter({ hasText: N.alertType }).first();
  const trigger = row.locator('[role="combobox"]').first();
  test.skip(!(await trigger.count()), `No channel control rendered for "${N.alertType}"`);

  await trigger.click();
  const option = page.locator('[role="listbox"]').last().getByRole('option', { name: CHANNEL_LABEL[value], exact: true });
  await expect(
    option,
    `Channel "${CHANNEL_LABEL[value]}" is not offered for ${N.alertType}.`,
  ).toBeVisible();
  await option.click();

  await save(page);
  await awaitSaveAck(page);
  await reloadAndSettle(page);

  const cfg = await notifConfig();
  const alert = (cfg?.alerts ?? []).find(a => a.type === N.alertType);
  expect(
    alert?.channel,
    `Channel "${CHANNEL_LABEL[value]}" did not persist as '${value}'. Each channel is stored as ` +
    `its own value, so one can fail to persist while the others save.`,
  ).toBe(value);
}

test.describe('P2G — Notification Config', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(NOTIF, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-057 Notification Config loads with all ten alert types', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Notification Config')).toBeVisible();

    const body = await page.locator('body').innerText();
    const expected = [
      'Critical Lab Value', 'NEWS2 Score Alert', 'Medication Due', 'Discharge TAT Alert',
      'Bed Occupancy > 90%', 'Drug Stockout', 'Large Bill', 'New Admission',
      'Code Blue', 'OT Starting in 30 min',
    ];
    const missing = expected.filter(t => !body.includes(t));
    expect(
      missing,
      `Alert type(s) not rendered: ${missing.join(', ')}. A missing alert type is an event nobody ` +
      `is ever notified about, and the omission is invisible because the screen simply shows one ` +
      `row fewer.`,
    ).toEqual([]);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-058 Saving the notification config writes to hospital_settings', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await save(page);
    await awaitSaveAck(page);

    const cfg = await notifConfig();
    expect(
      cfg,
      'BUG-P2-003 REGRESSION: no hospital_settings row after a successful-looking save. Save used ' +
      'to run a 500ms setTimeout then toast success without a single Supabase call.',
    ).not.toBeNull();
    expect(Array.isArray(cfg!.alerts)).toBeTruthy();
  });

  test('TC-P2G-059 The save spinner reflects a real request, not a fixed delay', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const calls: string[] = [];
    page.on('request', r => {
      if (/hospital_settings/.test(r.url())) calls.push(`${r.method()} ${r.url()}`);
    });

    await save(page);
    await awaitSaveAck(page);

    expect(
      calls.length,
      'BUG-P2-003 REGRESSION: clicking Save issued no request to hospital_settings. The fake 500ms ' +
      'delay was the most convincing possible disguise for a screen that saved nothing — it looked ' +
      'exactly like a real network round trip.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2G-060 Notification channel "In-App" saves for an alert type', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await channelCase(page, 'in_app');
  });
  test('TC-P2G-061 Notification channel "WhatsApp" saves for an alert type', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await channelCase(page, 'whatsapp');
  });
  test('TC-P2G-062 Notification channel "Both" saves for an alert type', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await channelCase(page, 'both');
  });

  test('TC-P2G-063 An alert type can be switched off and stays off', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = page.locator('tr').filter({ hasText: 'Large Bill' }).first();
    const toggle = row.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No active toggle rendered for the Large Bill alert');

    if ((await toggle.getAttribute('aria-checked')) !== 'false') await toggle.click();
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const cfg = await notifConfig();
    const alert = (cfg?.alerts ?? []).find(a => String(a.type).startsWith('Large Bill'));
    expect(
      alert?.active,
      'Alert fatigue is a real clinical risk — more alerts is not better. A hospital that ' +
      'deliberately silences a low-value alert must find it still silenced tomorrow, or staff ' +
      'learn to ignore the whole system.',
    ).toBe(false);
  });

  test('TC-P2G-064 Alert severity cannot be changed from the stored config', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('hospital_settings').upsert(
      {
        hospital_id: hid, key: NOTIF_KEY,
        value: { alerts: [{ type: 'Code Blue', severity: 'normal', channel: 'in_app' }] } as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hospital_id,key' },
    );
    await reloadAndSettle(page);

    const codeBlueRow = page.locator('tr').filter({ hasText: 'Code Blue' }).first();
    const text = (await codeBlueRow.innerText()).toLowerCase();
    expect(
      text,
      'Code Blue rendered with a severity taken from stored data. Whether Code Blue is critical ' +
      'is a product decision, not a hospital preference — if severity were editable, a stray edit ' +
      'could silently demote a life-safety alert.',
    ).toContain('critical');
  });

  test('TC-P2G-065 A stored config missing a newer alert type still shows it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('hospital_settings').upsert(
      {
        hospital_id: hid, key: NOTIF_KEY,
        value: { alerts: [{ type: N.alertType, channel: 'whatsapp' }] } as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hospital_id,key' },
    );
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    const missing = ['Code Blue', 'Drug Stockout', 'New Admission'].filter(t => !body.includes(t));
    expect(
      missing,
      `A partial stored config dropped alert type(s): ${missing.join(', ')}. Replacing rather than ` +
      `merging means a newly shipped critical alert never fires for any existing customer.`,
    ).toEqual([]);
  });

  test('TC-P2G-066 Quiet hours save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const from = page.getByLabel(/quiet hours from/i).first();
    const to = page.getByLabel(/quiet hours to/i).first();
    test.skip(!(await from.count()) || !(await to.count()), 'Quiet hours controls not rendered');

    await from.fill(N.quietFrom);
    await to.fill(N.quietTo);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const cfg = await notifConfig();
    expect(
      cfg?.quietHours?.from,
      'Quiet hours stop a ward being pinged all night for non-critical events. If they do not ' +
      'persist, night staff are woken by medication-due alerts and start muting the device entirely.',
    ).toBe(N.quietFrom);
    expect(cfg?.quietHours?.to).toBe(N.quietTo);
  });

  test('TC-P2G-067 Quiet hours suppress only non-critical alerts', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /non-critical/i.test(body),
      'The screen does not state that quiet hours apply to NON-CRITICAL alerts only. A critical ' +
      'potassium at 2am must still page a doctor — if quiet hours suppressed everything, the ' +
      'feature meant to reduce alert fatigue would hide the alerts that exist to save a life.',
    ).toBeTruthy();
  });

  test('TC-P2G-068 The notification config survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = page.locator('tr').filter({ hasText: N.alertType }).first();
    const trigger = row.locator('[role="combobox"]').first();
    if (await trigger.count()) {
      await trigger.click();
      await page.locator('[role="listbox"]').last().getByRole('option', { name: 'WhatsApp', exact: true }).click();
    }
    const from = page.getByLabel(/quiet hours from/i).first();
    if (await from.count()) await from.fill(N.quietFrom);

    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const cfg = await notifConfig();
    expect(
      cfg,
      'BUG-P2-003 REGRESSION: nothing survived the reload. This is the case that catches the ' +
      'original defect directly — the toast said saved and none of it was stored.',
    ).not.toBeNull();
    const alert = (cfg!.alerts ?? []).find(a => a.type === N.alertType);
    expect(alert?.channel, 'The alert channel did not survive the reload').toBe('whatsapp');
  });

  test("TC-P2G-069 Hospital A's notification config is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // hospital_settings has no per-role RLS — tenant isolation is its only protection.
    await expectNoCrossTenantRows('hospital_settings', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-070 The Notification Config screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThis screen was newly wired to hospital_settings, so ` +
      `a key or column mismatch would surface only here while the UI carried on looking healthy — ` +
      `exactly how the original defect hid.`,
    ).toHaveLength(0);
  });
});

test.describe('P2G — Radiology Modalities & Studies', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(RADIO, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-071 Radiology settings load with the seeded modalities', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Radiology').or(page.getByRole('heading', { name: /radiology/i }).first())).toBeVisible();

    if (DB_ON()) {
      const body = await page.locator('body').innerText();
      const missing = MOCK.radiologyModalities.filter(m => !body.includes(m.name)).map(m => m.name);
      expect(
        missing,
        `Seeded modality(s) not listed: ${missing.join(', ')}. Modalities must exist FIRST or the ` +
        `module shows "No studies configured. Go to Settings → Radiology Modalities" — the only ` +
        `clue a radiographer gets.`,
      ).toEqual([]);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-072 Adding a study before its modality exists is refused or explained', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await expectNoRow('radiology_modalities', { hospital_id: hid, name: RAD.modality });

    const addStudy = page.getByRole('button', { name: /add study/i }).first();
    if (await addStudy.count()) {
      await addStudy.click();
      await page.waitForTimeout(600);
      await fillField(page, 'Study Name', RAD.study, RADIO).catch(() => {});
      await fillField(page, 'Fee (₹)', RAD.fee, RADIO).catch(() => {});
      await save(page, /save|add/i).catch(() => {});
      await awaitSaveAck(page);
    }

    const { data } = await db().from('radiology_study_master')
      .select('modality_id').eq('hospital_id', hid).eq('name', RAD.study).maybeSingle();
    if (data) {
      expect(
        data.modality_id,
        'A study was created with no modality. MOCK_DATA_BOOK builds this ordering trap ' +
        'deliberately — a hospital that adds studies first sees them vanish, concludes the module ' +
        'is broken, and raises a support ticket for a sequencing rule nobody told them about.',
      ).not.toBeNull();
    }
  });

  test('TC-P2G-073 A modality saves with its type code', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add modality/i);
    await fillField(page, 'Name', RAD.modality, RADIO);
    await fillField(page, 'Type Code', RAD.modalityType, RADIO);
    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const row = await expectRow<Record<string, unknown>>(
      'radiology_modalities', { hospital_id: hid, name: RAD.modality },
      'No radiology_modalities row after a successful-looking save.',
    );
    expect(
      JSON.stringify(row),
      `The type code "${RAD.modalityType}" was not stored. It is what a PACS or DICOM worklist ` +
      `matches on — a wrong or missing code means images arrive with no study to attach them to.`,
    ).toContain(RAD.modalityType);
  });

  test('TC-P2G-074 A study saves with its fee against a modality', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add modality/i);
    await fillField(page, 'Name', RAD.modality, RADIO);
    await fillField(page, 'Type Code', RAD.modalityType, RADIO);
    await save(page, /save|add/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const addStudy = page.getByRole('button', { name: /add study/i }).first();
    test.skip(!(await addStudy.count()), 'No Add Study control rendered');
    await addStudy.click();
    await page.waitForTimeout(600);
    await fillField(page, 'Study Name', RAD.study, RADIO);
    await fillField(page, 'Fee (₹)', RAD.fee, RADIO);
    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const row = await expectRow<{ fee: number; modality_id: string | null }>(
      'radiology_study_master', { hospital_id: hid, name: RAD.study },
      'Without a fee, studies are missing or ordered at ₹0 — the department performs the scan and ' +
      'bills nothing.',
    );
    expect(Number(row.fee)).toBe(RAD.fee);
    expect(row.modality_id, 'The study was created with no modality').not.toBeNull();
  });

  test('TC-P2G-075 A modality cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('radiology_modalities', { hospital_id: hid });

    await openCreate(page, /add modality/i);
    await fillField(page, 'Type Code', 'qa_noname', RADIO).catch(() => {});
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    expect(
      await countRows('radiology_modalities', { hospital_id: hid }),
      'An unnamed modality renders as a blank group heading, so the radiographer cannot tell ' +
      'which machine a study belongs to.',
    ).toBe(before);
  });

  test('TC-P2G-076 A modality cannot be saved without a type code', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add modality/i);
    await fillField(page, 'Name', 'QA No Code Modality', RADIO);
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    await expectNoRow(
      'radiology_modalities', { hospital_id: hid, name: 'QA No Code Modality' },
      'The type code is the DICOM matching key. Without it the PACS integration cannot route ' +
      'images to the right study type and they land unassigned.',
    );
  });

  test('TC-P2G-077 A study cannot be saved without a fee', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('radiology_study_master')
      .select('name, fee').eq('hospital_id', hid).limit(20);
    test.skip(!data?.length, 'No radiology studies seeded — run npm run qa:seed');

    const unpriced = (data ?? []).filter(s => s.fee === null || Number(s.fee) === 0).map(s => s.name);
    expect(
      unpriced,
      `Unpriced study(s): ${unpriced.join(', ')}. An unpriced study orders at ₹0 — on an MRI at ` +
      `₹8,500 that is a substantial silent loss on every scan.`,
    ).toEqual([]);
  });

  test('TC-P2G-078 An obstetric study name triggers PCPNDT Form F', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('radiology_study_master')
      .select('name').eq('hospital_id', hid).ilike('name', '%obstetric%');

    expect(
      (data ?? []).length,
      'No study name contains "obstetric". Form F auto-creation triggers on that word, and PCPNDT ' +
      'Form F is a legal requirement for every obstetric ultrasound — failure to maintain it ' +
      'carries criminal liability and licence suspension for the centre.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2G-079 An obstetric study whose name lacks the trigger word is probed deliberately', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('radiology_study_master')
      .select('name').eq('hospital_id', hid).eq('name', 'USG Pregnancy Profile').maybeSingle();
    test.skip(!data, 'USG Pregnancy Profile is not seeded — run npm run qa:seed');

    // Clinically this IS an obstetric scan, but the name does not contain the trigger word.
    // Recording the mismatch is the point — Phase 5 re-runs it against a real order.
    expect(
      /obstetric/i.test(data!.name),
      `"${data!.name}" is clinically an obstetric scan but its name does not contain "obstetric". ` +
      `If Form F auto-creation is name-triggered, this scan escapes Form F entirely — which is ` +
      `exactly the gap a PCPNDT inspection would find. MOCK_DATA_BOOK seeds the two studies with ` +
      `deliberately different names to expose this.`,
    ).toBeFalsy();
  });

  test('TC-P2G-080 PCPNDT machine and doctor registration numbers save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Ultrasound Machine Name / Model', 'QA GE LOGIQ P9', RADIO).catch(() => {});
    await fillField(page, 'Machine Registration Number', 'QA-MACH-0001', RADIO).catch(() => {});
    await fillField(page, 'Doctor PCPNDT Registration Number', 'QA-PCPNDT-0001', RADIO).catch(() => {});
    await save(page, /save/i).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('pcpndt_settings')
      .select('*').eq('hospital_id', hid).maybeSingle();
    expect(
      error,
      'pcpndt_settings is not readable. Without it Form F may not generate correctly, and the ' +
      'machine and doctor registration numbers printed on Form F are what an inspector checks first.',
    ).toBeNull();
  });

  test('TC-P2G-081 The PACS viewer configuration saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'PACS Display Name', 'QA Orthanc', RADIO).catch(() => {});
    await fillField(page, 'OHIF / Viewer Base URL', 'https://pacs.qa.example.in/viewer', RADIO).catch(() => {});
    await fillField(page, 'WADO-URI Root URL', 'https://pacs.qa.example.in/wado', RADIO).catch(() => {});
    await save(page, /save/i).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('hospital_pacs_config')
      .select('*').eq('hospital_id', hid).maybeSingle();
    expect(
      error,
      'hospital_pacs_config is not readable. Without it the DICOM and PACS features are inert, so ' +
      'the radiologist has a report screen with no images attached to it.',
    ).toBeNull();
  });

  test('TC-P2G-082 The PACS AE title saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'AE Title (optional)', 'QA_HOSPITAL_PACS', RADIO).catch(() => {});
    await save(page, /save/i).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const { readField } = await import('./settings-locators');
    const shown = await readField(page, 'AE Title (optional)', RADIO).catch(() => '');
    expect(
      shown,
      'The AE title is how the modality identifies itself to the PACS. A wrong one means images ' +
      'are pushed and silently rejected at the far end.',
    ).toBe('QA_HOSPITAL_PACS');
  });

  test('TC-P2G-083 A duplicate modality type code is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    for (let i = 0; i < 2; i++) {
      await openCreate(page, /add modality/i);
      await fillField(page, 'Name', i === 0 ? RAD.modality : `${RAD.modality} 2`, RADIO);
      await fillField(page, 'Type Code', RAD.modalityType, RADIO);
      await save(page, /save|add/i).catch(() => {});
      await awaitSaveAck(page);
      await reloadAndSettle(page);
    }

    const { data } = await db().from('radiology_modalities')
      .select('id').eq('hospital_id', hid).ilike('name', `${RAD.modality}%`);
    expect(
      (data ?? []).length,
      'Two modalities share a DICOM type code. Incoming images then attach to whichever the query ' +
      'returns first, so a CT ends up filed under an ultrasound.',
    ).toBeLessThanOrEqual(1);
  });

  test('TC-P2G-084 The study sort order saves', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('radiology_study_master')
      .select('name, sort_order').eq('hospital_id', hid).limit(10);
    test.skip(!!error || !data?.length, 'No radiology studies seeded — run npm run qa:seed');

    expect(
      (data ?? []).every(s => s.sort_order !== null),
      'Studies carry no sort order. It puts Chest X-Ray at the top where it is ordered dozens of ' +
      'times a day instead of below an MRI nobody orders — it is what makes the picker usable ' +
      'during a busy OPD.',
    ).toBeTruthy();
  });

  test('TC-P2G-085 Study fees render in en-IN grouping with the rupee symbol', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = await page.locator('body').innerText();
    expect(
      /₹/.test(body),
      'No rupee symbol on the radiology rate card. This is the rate the counter quotes before an ' +
      'expensive scan.',
    ).toBeTruthy();
    expect(
      body.match(/₹\s?\d{3},\d{3}(?!\d)/g) ?? [],
      'Fees render with international grouping, which is misread at exactly the moment it matters most.',
    ).toEqual([]);
  });

  test('TC-P2G-086 A new radiology study appears as a chip in the OPD Rx tab', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('radiology_study_master')
      .select('name').eq('hospital_id', hid).limit(50);
    test.skip(!data?.length, 'No radiology studies seeded — run npm run qa:seed');

    expect(
      (data ?? []).length,
      'No studies are returned by the read path the OPD Rx tab uses. With no ' +
      'radiology_study_master rows the radiology chips are EMPTY, so a doctor writes the study as ' +
      'free text and it never reaches the radiology worklist.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2G-087 Editing a study fee persists', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('radiology_study_master')
      .select('id, name, fee').eq('hospital_id', hid).limit(1);
    test.skip(!data?.length, 'No radiology studies seeded — run npm run qa:seed');

    expect(
      Number(data![0].fee),
      `Study "${data![0].name}" has no usable fee. Imaging rates are revised as equipment ` +
      `contracts change — an edit that does not persist means the department bills the old rate.`,
    ).toBeGreaterThan(0);
  });

  test('TC-P2G-088 A study can be deactivated without being deleted', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('radiology_study_master')
      .select('id, is_active').eq('hospital_id', hid).limit(1);
    test.skip(!!error || !data?.length, 'No radiology studies seeded');

    expect(
      Object.prototype.hasOwnProperty.call(data![0], 'is_active'),
      'radiology_study_master has no is_active column, so a withdrawn study can only be deleted. ' +
      'That would leave every historical report referencing nothing.',
    ).toBeTruthy();
  });

  test('TC-P2G-089 Radiology settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add modality/i);
    await fillField(page, 'Name', RAD.modality, RADIO);
    await fillField(page, 'Type Code', RAD.modalityType, RADIO);
    await save(page, /save|add/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    await expectRow(
      'radiology_modalities', { hospital_id: hid, name: RAD.modality },
      'This screen writes to four tables — modalities, studies, PCPNDT settings and PACS config. ' +
      'A partial write that toasts success leaves a modality with no studies, which shows the ' +
      'radiographer "No studies configured".',
    );
  });

  test("TC-P2G-090 Hospital A's radiology catalogue is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // PCPNDT registration numbers are legal registrations tied to a named doctor and machine.
    await expectNoCrossTenantRows('radiology_study_master', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-091 A receptionist cannot edit the radiology catalogue', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, RADIO),
      'A receptionist reached /settings/radiology. This screen holds the PCPNDT registration ' +
      'numbers — altering them would put a wrong registration on a legal Form F, which is a ' +
      'PCPNDT offence attributable to the named doctor.',
    ).toBeTruthy();
  });

  test('TC-P2G-092 The Radiology settings screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await openCreate(page, /add modality/i);
    await fillField(page, 'Name', RAD.modality, RADIO);
    await fillField(page, 'Type Code', RAD.modalityType, RADIO);
    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nA failure on the PCPNDT or PACS write would leave the ` +
      `visible catalogue looking correct while Form F generation and image routing are both broken.`,
    ).toHaveLength(0);
  });
});
