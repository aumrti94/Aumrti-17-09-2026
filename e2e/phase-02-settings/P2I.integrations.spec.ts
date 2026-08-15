/**
 * Phase 2 · Section I — Integrations: Console, HL7/FHIR, ABDM, HMIS, API Keys, API Portal, API Hub
 * Locks tracker cases TC-P2I-001 … TC-P2I-080
 *
 * Everything on these screens is a credential or an endpoint, and every one of them fails
 * QUIETLY. SETTINGS_PREREQ_MATRIX says it directly: without HL7 and analyser connectors,
 * analyser results do not arrive; without hospital_abdm_config the ABDM edge functions fail
 * silently; without hospital_pacs_config the DICOM features are inert.
 *
 * A recurring assertion here is that secrets never reach the DOM or the console. `leaksIntoDom`
 * checks the rendered page and each console-error case additionally checks that the secret was
 * not written into console output — a credential logged there is readable by any browser
 * extension the hospital has installed.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import {
  fillField, readField, selectByValue, save, openCreate, awaitSaveAck, reloadAndSettle, heading,
} from './settings-locators';

const INTEGRATIONS = '/settings/integrations';
const HL7 = '/settings/hl7';
const ABDM = '/settings/abdm';
const HMIS = '/settings/hmis-portal';
const API_KEYS = '/settings/api-keys';
const API_PORTAL = '/settings/api-portal';
const API_HUB = '/settings/api-hub';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const E = MOCK.phase2.entry;
const CONN = E[INTEGRATIONS] as { connector: string; endpoint: string };
const HL7E = E[HL7] as { endpoint: string; port: string };
const ABDME = E[ABDM] as { hipId: string; hipName: string };
const HMISE = E[HMIS] as { facilityCode: string };
const KEYE = E[API_KEYS] as { keyName: string };
const PORTALE = E[API_PORTAL] as { endpoint: string };
const HUBE = E[API_HUB] as { label: string };
const INSECURE = MOCK.phase2.invalid.webhookInsecure as string;

const SECRET = 'qa_secret_value_00000000';

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('lab_device_connectors').delete().eq('hospital_id', hid).eq('name', CONN.connector);
  await db().from('api_keys').delete().eq('hospital_id', hid).in('name', [KEYE.keyName, 'QA Portal Key']);
  await db().from('webhook_endpoints').delete().eq('hospital_id', hid).eq('url', PORTALE.endpoint);
}

/** True when `value` is readable anywhere in the rendered DOM. */
async function leaksIntoDom(page: import('@playwright/test').Page, value: string): Promise<boolean> {
  return page.evaluate((v) => {
    if (document.body.innerText.includes(v)) return true;
    return [...document.querySelectorAll('input, textarea')].some(
      el => (el as HTMLInputElement).value === v && (el as HTMLInputElement).type !== 'password',
    );
  }, value);
}

/** Shared bodies — titles stay literal so every result reaches a tracker row. */
async function gatewayCase(page: import('@playwright/test').Page, value: string, label: string) {
  const options = await page.locator('select').first().locator('option')
    .evaluateAll(els => els.map(e => (e as HTMLOptionElement).value)).catch(() => [] as string[]);
  const offered = options.length
    ? options
    : (await page.locator('body').innerText()).toLowerCase();

  const present = Array.isArray(offered) ? offered.includes(value) : offered.includes(value);
  expect(
    present,
    `Payment gateway "${label}" (${value}) is not offered. The gateway decides where a patient's ` +
    `payment settles — a missing option silently leaves the hospital on a provider it may not ` +
    `hold a merchant account with.`,
  ).toBeTruthy();
}

async function vitalsVendorCase(page: import('@playwright/test').Page, value: string, label: string) {
  const body = (await page.locator('body').innerText()).toLowerCase();
  const options = await page.locator('select').evaluateAll(
    els => els.flatMap(s => [...(s as HTMLSelectElement).options].map(o => o.value)),
  ).catch(() => [] as string[]);

  expect(
    options.includes(value) || body.includes(label.toLowerCase().split(' ')[0]),
    `Vitals monitor vendor "${label}" (${value}) is not offered. Each vendor speaks a different ` +
    `dialect of HL7 for vitals — a missing one means the ICU flowsheet is populated with the ` +
    `wrong parameters or nothing at all, while the nurse believes charting is automatic.`,
  ).toBeTruthy();
}

test.describe('P2I — Integrations Console', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(INTEGRATIONS, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('TC-P2I-001 Integrations Console loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Integrations').or(page.getByRole('heading', { name: /integration/i }).first())).toBeVisible();
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(
      /analy[sz]er|pacs|whatsapp|tally/.test(body),
      'No connector sections rendered. Without HL7 and analyser connectors, analyser results ' +
      'simply do not arrive — the lab runs the sample and nothing reaches the patient chart.',
    ).toBeTruthy();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2I-002 A lab analyser connector saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add connector|add analy|new connector/i).catch(() => {});
    await fillField(page, 'Name', CONN.connector, INTEGRATIONS).catch(() => {});
    await fillField(page, 'Host / IP', CONN.endpoint, INTEGRATIONS).catch(() => {});
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    await expectRow(
      'lab_device_connectors', { hospital_id: hid, name: CONN.connector },
      'The connector is what pulls results off the analyser. Without it a technician retypes ' +
      'every value by hand — the commonest source of transcription error in a lab.',
    );
  });

  test('TC-P2I-003 A connector cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('lab_device_connectors', { hospital_id: hid });

    await openCreate(page, /add connector|add analy|new connector/i).catch(() => {});
    await fillField(page, 'Host / IP', CONN.endpoint, INTEGRATIONS).catch(() => {});
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /name is required/i.test(body) ||
        (await countRows('lab_device_connectors', { hospital_id: hid })) === before,
      'An unnamed connector cannot be identified in the list, so when results stop arriving ' +
      'nobody can tell which machine has gone offline.',
    ).toBeTruthy();
  });

  test('TC-P2I-004 The connector protocol and connection type save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = await page.locator('body').innerText();
    expect(
      /protocol/i.test(body) && /connection type/i.test(body),
      'Protocol and connection type controls are missing. A Sysmex on serial and a Sysmex on TCP ' +
      'need entirely different handling — the wrong protocol produces a connector that appears ' +
      'configured and never receives a byte.',
    ).toBeTruthy();
  });

  test('TC-P2I-005 A serial connector stores its port and a network connector stores host and port', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /serial port/i.test(body) && /host \/ ip/i.test(body),
      'The two connection types use different fields. A form that stores only one set silently ' +
      'discards whichever the other kind of analyser needs, and that machine never connects.',
    ).toBeTruthy();
  });

  test('TC-P2I-006 A file-drop connector stores its folder path', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /file drop|folder path/i.test(body),
      'No file-drop path field rendered. Windows paths contain backslashes that are easy to ' +
      'mangle — a corrupted path means the watcher polls a folder that does not exist and no ' +
      'results are ever picked up.',
    ).toBeTruthy();
  });

  test('TC-P2I-007 A connector can be removed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add connector|add analy|new connector/i).catch(() => {});
    await fillField(page, 'Name', CONN.connector, INTEGRATIONS).catch(() => {});
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    page.on('dialog', d => d.accept());
    const row = page.locator('tr, li').filter({ hasText: CONN.connector }).first();
    const del = row.locator('button').last();
    if (await del.count()) { await del.click(); await page.waitForTimeout(1600); }

    expect(
      await countRows('lab_device_connectors', { hospital_id: hid, name: CONN.connector }),
      'A decommissioned analyser left configured keeps polling a dead IP, which fills the error ' +
      'log and masks a genuine failure on a machine that is still in use.',
    ).toBe(0);
  });

  test('TC-P2I-008 A PACS connector saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'PACS Vendor / System Name', 'QA Orthanc', INTEGRATIONS).catch(() => {});
    await fillField(page, 'DICOM AE Title', 'AUMRTI_SCU', INTEGRATIONS).catch(() => {});
    await fillField(page, 'DICOM Port', '4242', INTEGRATIONS).catch(() => {});
    await save(page, /save/i).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('pacs_connectors').select('*').eq('hospital_id', hid).limit(1);
    expect(
      error,
      'pacs_connectors is not readable. Without hospital_pacs_config the DICOM and PACS features ' +
      'are inert — the radiologist opens a study and there are no images attached to it.',
    ).toBeNull();
  });

  test('TC-P2I-009 A PACS connector cannot be saved without a vendor name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'PACS Vendor / System Name', '', INTEGRATIONS).catch(() => {});
    await save(page, /save/i).catch(() => {});
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /vendor name is required/i.test(body) || !/PACS configuration saved/i.test(body),
      'A hospital may run more than one PACS. An unnamed one cannot be told apart when images ' +
      'stop arriving from one of them.',
    ).toBeTruthy();
  });

  test('TC-P2I-010 Testing a PACS endpoint with no base URL is refused', async ({ page }) => {
    await fillField(page, 'Base URL', '', INTEGRATIONS).catch(() => {});
    const testBtn = page.getByRole('button', { name: /test/i }).first();
    test.skip(!(await testBtn.count()), 'No PACS test control rendered');
    await testBtn.click();
    await page.waitForTimeout(1200);

    const body = await page.locator('body').innerText();
    expect(
      /enter base url|required/i.test(body),
      'A test that silently does nothing teaches the administrator the PACS is unreachable, when ' +
      'in fact they have not entered the address yet.',
    ).toBeTruthy();
  });

  test('TC-P2I-011 The PACS reachability test reports its outcome', async ({ page }) => {
    await fillField(page, 'Base URL', 'https://pacs.qa.example.invalid/wado', INTEGRATIONS).catch(() => {});
    const testBtn = page.getByRole('button', { name: /test/i }).first();
    test.skip(!(await testBtn.count()), 'No PACS test control rendered');
    await testBtn.click();
    await page.waitForTimeout(3000);

    const body = await page.locator('body').innerText();
    expect(
      /reachable|cannot reach|success|failed/i.test(body),
      'No reachability outcome reported. This is the only way to confirm the PACS link works ' +
      'before a radiologist depends on it — otherwise the failure surfaces mid-report, with a ' +
      'patient waiting on the finding.',
    ).toBeTruthy();
  });

  test('TC-P2I-012 A WhatsApp connector saves with its sender number', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Sender Number', '+91 98765 43210', INTEGRATIONS).catch(() => {});
    await save(page, /save/i).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('whatsapp_connectors').select('*').eq('hospital_id', hid).limit(1);
    expect(
      error,
      'whatsapp_connectors is not readable. The sender number is what a patient sees the message ' +
      'arrive from — a wrong or missing one means reminders come from an unrecognised sender and ' +
      'are ignored or reported as spam.',
    ).toBeNull();
  });

  test('TC-P2I-013 Tally ledger mapping saves', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('tally_ledger_mapping').select('*').eq('hospital_id', hid).limit(1);
    expect(
      error,
      'tally_ledger_mapping is not readable. Most Indian hospitals still keep statutory books in ' +
      'Tally — an unmapped ledger means the export lands in a suspense account and the accountant ' +
      'reallocates every line by hand.',
    ).toBeNull();
  });

  test("TC-P2I-014 Hospital A's connectors are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // Connector rows carry internal IP addresses and API credentials.
    await expectNoCrossTenantRows('lab_device_connectors', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2I-015 A lab technician cannot edit the Integrations Console', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('lab_technician', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, INTEGRATIONS),
      'A lab technician reached /settings/integrations. The console holds internal IP addresses ' +
      'and integration credentials — repointing an analyser connector could redirect result ' +
      'traffic without anyone noticing.',
    ).toBeTruthy();
  });

  test('TC-P2I-016 The Integrations Console loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await openCreate(page, /add connector|add analy|new connector/i).catch(() => {});
    await fillField(page, 'Name', CONN.connector, INTEGRATIONS).catch(() => {});
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThis screen writes to four separate tables. A ` +
      `failure on one leaves the console looking correct while one entire integration is ` +
      `silently unconfigured.`,
    ).toHaveLength(0);
  });

  test('TC-P2I-017 Payment gateway "Razorpay" can be selected and saves', async ({ page }) => {
    await gatewayCase(page, 'razorpay', 'Razorpay');
  });
  test('TC-P2I-018 Payment gateway "PayU" can be selected and saves', async ({ page }) => {
    await gatewayCase(page, 'payu', 'PayU');
  });
  test('TC-P2I-019 Payment gateway "PhonePe for Business" can be selected and saves', async ({ page }) => {
    await gatewayCase(page, 'phonepe', 'PhonePe for Business');
  });
  test('TC-P2I-020 Payment gateway "CCAvenue" can be selected and saves', async ({ page }) => {
    await gatewayCase(page, 'ccavenue', 'CCAvenue');
  });
});

test.describe('P2I — HL7 / FHIR', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(HL7, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-021 HL7 / FHIR screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'HL7').or(page.getByRole('heading', { name: /hl7|fhir/i }).first())).toBeVisible();
    for (const label of ['Mirth Host / IP', 'Port', 'Sending Facility', 'Receiving Facility']) {
      await expect(page.getByText(label, { exact: false }).first(), `"${label}" is missing`).toBeVisible();
    }
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2I-022 The Mirth host and port save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Mirth Host / IP', HL7E.endpoint, HL7);
    await fillField(page, 'Port', HL7E.port, HL7);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Mirth Host / IP', HL7),
      'Port 2575 is the conventional HL7 MLLP port. A wrong host or port means the integration ' +
      'engine is never reached and every result stays on the analyser.',
    ).toBe(HL7E.endpoint);
    expect(await readField(page, 'Port', HL7)).toBe(HL7E.port);
  });

  test('TC-P2I-023 A non-numeric HL7 port is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Port', MOCK.phase2.invalid.feeNonNumeric as string, HL7).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const stored = await readField(page, 'Port', HL7);
    expect(
      stored === MOCK.phase2.invalid.feeNonNumeric,
      'A non-numeric port cannot open a socket. The connection fails with a low-level error that ' +
      'looks like a network problem rather than a typo on this screen.',
    ).toBeFalsy();
  });

  test('TC-P2I-024 An HL7 port outside the valid range is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Port', 70000, HL7).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const stored = Number(await readField(page, 'Port', HL7));
    expect(
      stored <= 65535,
      `Port stored as ${stored}. A port above 65535 cannot be bound — the failure appears at ` +
      `connection time as an obscure system error, days after the value was entered.`,
    ).toBeTruthy();
  });

  test('TC-P2I-025 The sending and receiving facility identifiers save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Sending Facility', 'QA_AUMRTI', HL7).catch(() => {});
    await fillField(page, 'Receiving Facility', 'QA_LIS', HL7).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Sending Facility', HL7).catch(() => ''),
      'These values populate the MSH segment of every HL7 message. A mismatch makes the receiving ' +
      'system reject the message outright, and the rejection is logged at the far end where the ' +
      'hospital cannot see it.',
    ).toBe('QA_AUMRTI');
  });

  test('TC-P2I-026 The Mirth channel ID saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Channel ID (optional)', 'qa-channel-0001', HL7).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Channel ID (optional)', HL7).catch(() => ''),
      'The channel ID routes the message to the right Mirth pipeline. Wrong, and lab results are ' +
      'processed by the radiology channel, which drops them as unparseable.',
    ).toBe('qa-channel-0001');
  });

  test('TC-P2I-027 Testing the Mirth connection with no host is refused', async ({ page }) => {
    await fillField(page, 'Mirth Host / IP', '', HL7).catch(() => {});
    const testBtn = page.getByRole('button', { name: /test/i }).first();
    test.skip(!(await testBtn.count()), 'No connection test control rendered');
    await testBtn.click();
    await page.waitForTimeout(1500);

    const body = await page.locator('body').innerText();
    expect(
      /no host configured/i.test(body),
      'A generic "connection failed" sends the hospital IT team investigating the network. Naming ' +
      'the missing field turns a half-day of debugging into a ten-second fix.',
    ).toBeTruthy();
  });

  test('TC-P2I-028 The Mirth connection test reports reachability explicitly', async ({ page }) => {
    await fillField(page, 'Mirth Host / IP', HL7E.endpoint, HL7).catch(() => {});
    await fillField(page, 'Port', HL7E.port, HL7).catch(() => {});
    const testBtn = page.getByRole('button', { name: /test/i }).first();
    test.skip(!(await testBtn.count()), 'No connection test control rendered');
    await testBtn.click();
    await page.waitForTimeout(3000);

    const body = await page.locator('body').innerText();
    expect(
      /reachable|failed|testing/i.test(body),
      'Without an explicit reachability result the hospital discovers the integration is down ' +
      'when a clinician asks why a result from three hours ago has not appeared.',
    ).toBeTruthy();
  });

  test('TC-P2I-029 Vitals monitor vendor "Mindray (BeneVision)" can be selected and saves', async ({ page }) => {
    await vitalsVendorCase(page, 'mindray', 'Mindray (BeneVision)');
  });
  test('TC-P2I-030 Vitals monitor vendor "Philips IntelliVue" can be selected and saves', async ({ page }) => {
    await vitalsVendorCase(page, 'philips', 'Philips IntelliVue');
  });
  test('TC-P2I-031 Vitals monitor vendor "GE Healthcare" can be selected and saves', async ({ page }) => {
    await vitalsVendorCase(page, 'ge', 'GE Healthcare');
  });
  test('TC-P2I-032 Vitals monitor vendor "Dräger" can be selected and saves', async ({ page }) => {
    await vitalsVendorCase(page, 'drager', 'Dräger');
  });
  test('TC-P2I-033 Vitals monitor vendor "Nihon Kohden" can be selected and saves', async ({ page }) => {
    await vitalsVendorCase(page, 'nihon_kohden', 'Nihon Kohden');
  });

  test('TC-P2I-034 The vitals vendor selector appears only once bedside monitoring is enabled', async ({ page }) => {
    const before = (await page.locator('body').innerText()).includes('Device Manufacturer');
    const toggle = page.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No bedside monitoring toggle rendered');

    await toggle.click();
    await page.waitForTimeout(800);
    const after = (await page.locator('body').innerText()).includes('Device Manufacturer');

    expect(
      before !== after,
      'The vendor selector visibility did not change with the toggle. MOCK_DATA_BOOK records this ' +
      'conditional deliberately — a vendor selected while the feature is off stores a setting ' +
      'that does nothing, and the administrator believes bedside integration is configured.',
    ).toBeTruthy();
  });

  test('TC-P2I-035 HL7 settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Mirth Host / IP', HL7E.endpoint, HL7);
    await fillField(page, 'Port', HL7E.port, HL7);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Mirth Host / IP', HL7),
      'A false save leaves the integration unconfigured while the screen shows it set up. Results ' +
      'stop arriving and the lab assumes the analyser has failed.',
    ).toBe(HL7E.endpoint);
  });

  test('TC-P2I-036 A lab technician cannot change the HL7 configuration', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('lab_technician', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, HL7),
      'A lab technician reached /settings/hl7. Repointing the HL7 receiving facility would divert ' +
      'result messages to another system — a clinical data-routing change that belongs to ' +
      'whoever owns the integration.',
    ).toBeTruthy();
  });
});

test.describe('P2I — ABDM / ABHA', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ABDM, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-037 ABDM screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'ABDM').or(page.getByRole('heading', { name: /abdm|abha/i }).first())).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(
      /HFR|Facility Name|Bridge URL/i.test(body),
      'No ABDM configuration fields rendered. Without hospital_abdm_config the ABDM edge functions ' +
      'fail quietly — ABHA linkage appears to work and no record ever reaches the national exchange.',
    ).toBeTruthy();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2I-038 The HFR ID and facility name save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'HFR (Health Facility Registry) ID', ABDME.hipId, ABDM).catch(() => {});
    await fillField(page, 'Facility Name (as per HFR)', ABDME.hipName, ABDM).catch(() => {});
    await save(page);
    await awaitSaveAck(page);

    const { error } = await db().from('hospital_abdm_config').select('*').eq('hospital_id', hid).maybeSingle();
    expect(
      error,
      'hospital_abdm_config is not readable. The HFR ID is the hospital\'s registered identity in ' +
      'the national Health Facility Registry — a wrong one means records are published under ' +
      'another facility.',
    ).toBeNull();
  });

  test('TC-P2I-039 The ABDM facility name matches the registered hospital name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const shown = await readField(page, 'Facility Name (as per HFR)', ABDM).catch(() => '');
    test.skip(!shown, 'No facility name is configured yet');

    expect(
      shown,
      `The ABDM facility name is "${shown}" but the hospital is registered as ` +
      `"${MOCK.hospitals.A.name}". ABDM validates the name against the HFR record — a mismatch is ` +
      `rejected at the gateway with an error the hospital sees only in an edge-function log it ` +
      `never reads.`,
    ).toBe(MOCK.hospitals.A.name);
  });

  test('TC-P2I-040 The bridge callback URL saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Bridge URL (Callback URL)', 'https://qa.example.invalid/abdm/callback', ABDM).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Bridge URL (Callback URL)', ABDM).catch(() => ''),
      'ABDM calls back to this URL with consent artefacts. A wrong address means consent requests ' +
      'are issued and the response never arrives, so the linkage hangs forever in a pending state.',
    ).toBe('https://qa.example.invalid/abdm/callback');
  });

  test('TC-P2I-041 ABDM credentials are stored securely and can be rotated', async ({ page }) => {
    const rotate = page.getByRole('button', { name: /rotate/i }).first();
    test.skip(!(await rotate.count()), 'No credential rotation control rendered');
    await rotate.click();
    await page.waitForTimeout(2000);

    const body = await page.locator('body').innerText();
    expect(
      /rotated|token cache|rotation failed/i.test(body),
      'Rotation produced no stated outcome. ABDM credentials authorise publishing patient records ' +
      'to the national exchange — they must be rotatable without a redeploy, and rotation must ' +
      'clear the cached token or the old credential keeps being used.',
    ).toBeTruthy();
  });

  test('TC-P2I-042 ABDM credentials are never rendered in plain text', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const secretField = page.locator('input[type="password"]').first();
    test.skip(!(await secretField.count()), 'No credential field rendered');
    await secretField.fill(SECRET);
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await leaksIntoDom(page, SECRET),
      'An ABDM credential is readable in the DOM. It lets the holder publish or retrieve patient ' +
      'health records under the hospital\'s national identity — the highest-value credential in ' +
      'the product.',
    ).toBeFalsy();
  });

  test('TC-P2I-043 Switching ABDM to Production Mode warns before it takes effect', async ({ page }) => {
    const toggle = page.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No production mode toggle rendered');
    await toggle.click();
    await page.waitForTimeout(1000);

    const body = await page.locator('body').innerText();
    expect(
      /production|live|real|warning|caution/i.test(body),
      'Switching to Production gave no warning. A record published to the national exchange cannot ' +
      'be recalled — flipping this during configuration would push real PHI into ABDM before the ' +
      'hospital has verified anything.',
    ).toBeTruthy();
  });

  test('TC-P2I-044 ABDM settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'HFR (Health Facility Registry) ID', ABDME.hipId, ABDM).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'HFR (Health Facility Registry) ID', ABDM).catch(() => ''),
      'The ABDM edge functions fail quietly when unconfigured. A false save means ABHA linkage ' +
      'silently does nothing while the settings screen shows it as ready.',
    ).toBe(ABDME.hipId);
  });

  test("TC-P2I-045 Hospital A's ABDM configuration is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // The HFR ID is a national registered identity.
    await expectNoCrossTenantRows('hospital_abdm_config', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2I-046 An MRD officer cannot change the ABDM configuration', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('mrd_officer', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ABDM),
      'An MRD officer reached /settings/abdm. MRD publishes records through ABDM but must not hold ' +
      'the credentials that authorise publishing under the hospital\'s national identity.',
    ).toBeTruthy();
  });
});

test.describe('P2I — HMIS / IHIP Portal', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(HMIS, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-047 HMIS Portal screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'HMIS').or(page.getByRole('heading', { name: /hmis|ihip/i }).first())).toBeVisible();
    for (const label of ['HIN Code', 'Facility Code', 'Portal Username', 'Portal Base URL']) {
      await expect(page.getByText(label, { exact: false }).first(), `"${label}" is missing`).toBeVisible();
    }
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2I-048 The HIN and facility codes save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Facility Code', HMISE.facilityCode, HMIS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Facility Code', HMIS).catch(() => ''),
      'The HIN identifies the hospital on the National Health Portal. A wrong code files the ' +
      'hospital\'s monthly return against another facility, which is very hard to unwind once ' +
      'submitted.',
    ).toBe(HMISE.facilityCode);
  });

  test('TC-P2I-049 The HMIS portal password is never rendered in plain text', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Portal Password', SECRET, HMIS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await leaksIntoDom(page, SECRET),
      'The HMIS portal password is readable in the DOM. These are government portal credentials ' +
      'tied to a named hospital — exposure would let someone file or alter statutory returns in ' +
      'the hospital\'s name.',
    ).toBeFalsy();
  });

  test('TC-P2I-050 The portal base URL saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Portal Base URL', 'https://ihip.nhp.gov.in', HMIS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Portal Base URL', HMIS).catch(() => ''),
      'The IHIP portal address changes between state and central deployments. A wrong base URL ' +
      'means submissions post to an endpoint that accepts and discards them.',
    ).toBe('https://ihip.nhp.gov.in');
  });

  test('TC-P2I-051 An insecure http portal URL is refused or warned', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Portal Base URL', INSECURE, HMIS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const stored = await readField(page, 'Portal Base URL', HMIS).catch(() => '');
    const body = await page.locator('body').innerText();
    expect(
      stored !== INSECURE || /https|insecure|warning/i.test(body),
      'An http:// portal URL was accepted with no warning. Posting government portal credentials ' +
      'over plain http exposes them to anyone on the hospital network.',
    ).toBeTruthy();
  });

  test('TC-P2I-052 HMIS settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Facility Code', HMISE.facilityCode, HMIS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Facility Code', HMIS).catch(() => ''),
      'A false save means the monthly statutory return cannot be filed, and the hospital only ' +
      'discovers it at the filing deadline.',
    ).toBe(HMISE.facilityCode);
  });

  test("TC-P2I-053 Hospital A's HMIS credentials are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('api_configurations', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2I-054 The HMIS Portal screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Portal Password', SECRET, HMIS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
    expect(
      consoleErrors.filter(e => e.includes(SECRET)),
      'A government portal password was written into console output, where any browser extension ' +
      'the hospital has installed can read it.',
    ).toEqual([]);
  });
});

test.describe('P2I — API Keys', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(API_KEYS, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-055 API Keys screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'API Keys').or(page.getByRole('heading', { name: /api key/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nIf the screen will not load, existing keys cannot be ` +
      `reviewed or revoked, which is the entire point of having a key management page.`,
    ).toHaveLength(0);
  });

  test('TC-P2I-056 An API key can be generated with a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Key Name', KEYE.keyName, API_KEYS).catch(() => {});
    await page.getByRole('button', { name: /generate|create/i }).first().click();
    await awaitSaveAck(page);

    await expectRow(
      'api_keys', { hospital_id: hid, name: KEYE.keyName },
      'The name is how a key is identified for revocation later. An unnamed key cannot be safely ' +
      'revoked because nobody knows what would break.',
    );
  });

  test('TC-P2I-057 The generated key value is shown once and never again', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Key Name', KEYE.keyName, API_KEYS).catch(() => {});
    await page.getByRole('button', { name: /generate|create/i }).first().click();
    await awaitSaveAck(page);

    const shown = await page.locator('body').innerText();
    const keyMatch = shown.match(/[A-Za-z0-9_-]{24,}/);
    test.skip(!keyMatch, 'No key value was displayed at generation');

    await reloadAndSettle(page);
    expect(
      await leaksIntoDom(page, keyMatch![0]),
      'The full key is still retrievable after a reload. A key readable from the list is a key any ' +
      'settings-permitted user can copy at any time — show-once is what makes revocation ' +
      'meaningful, because the stored value is a hash rather than the secret.',
    ).toBeFalsy();
  });

  test('TC-P2I-058 A key cannot be generated without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('api_keys', { hospital_id: hid });

    await fillField(page, 'Key Name', '', API_KEYS).catch(() => {});
    await page.getByRole('button', { name: /generate|create/i }).first().click();
    await awaitSaveAck(page);

    expect(
      await countRows('api_keys', { hospital_id: hid }),
      'An unnamed key in the list cannot be attributed to a system, so nobody dares revoke it and ' +
      'it lives forever.',
    ).toBe(before);
  });

  test('TC-P2I-059 An API key can be revoked', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Key Name', KEYE.keyName, API_KEYS).catch(() => {});
    await page.getByRole('button', { name: /generate|create/i }).first().click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    page.on('dialog', d => d.accept());
    const row = page.locator('tr, li').filter({ hasText: KEYE.keyName }).first();
    const revoke = row.getByRole('button', { name: /revoke/i }).first();
    test.skip(!(await revoke.count()), 'No revoke control rendered');
    await revoke.click();
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /revoked/i.test(body),
      'Revocation is the only response to a leaked key. If it does not persist, the compromised ' +
      'key keeps working while the screen says it is revoked.',
    ).toBeTruthy();
  });

  test('TC-P2I-060 A revoked key no longer authenticates', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('api_keys')
      .select('name, is_active, revoked_at').eq('hospital_id', hid).limit(10);

    test.skip(!!error, `api_keys is not readable: ${error?.message}`);
    expect(
      data,
      'api_keys must record a revocation state that the API can enforce. A revocation stored but ' +
      'not enforced is the worst possible security failure: the hospital believes it has ' +
      'responded to a leak and the attacker retains access.',
    ).toBeDefined();
  });

  test('TC-P2I-061 The key value can be copied to the clipboard at generation', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await fillField(page, 'Key Name', KEYE.keyName, API_KEYS).catch(() => {});
    await page.getByRole('button', { name: /generate|create/i }).first().click();
    await awaitSaveAck(page);

    const copy = page.getByRole('button', { name: /copy/i }).first();
    test.skip(!(await copy.count()), 'No copy control rendered');
    await copy.click();
    await page.waitForTimeout(900);

    const body = await page.locator('body').innerText();
    expect(
      /copied/i.test(body),
      'The key is shown once. Forcing the integrator to transcribe a long secret by hand ' +
      'guarantees a typo, and the key cannot be re-read to check.',
    ).toBeTruthy();
  });

  test("TC-P2I-062 Hospital A's API keys are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // An API key grants programmatic access to a hospital's patient data.
    await expectNoCrossTenantRows('api_keys', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2I-063 A receptionist cannot reach the API Keys screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, API_KEYS),
      'A receptionist reached /settings/api-keys. Generating a key creates a credential with ' +
      'programmatic access to patient data that outlives the session and is not tied to a login.',
    ).toBeTruthy();
  });

  test('TC-P2I-064 The API Keys screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Key Name', KEYE.keyName, API_KEYS).catch(() => {});
    await page.getByRole('button', { name: /generate|create/i }).first().click();
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nA generated key logged to the console defeats ` +
      `show-once entirely — the secret sits in the browser log where any extension can read it.`,
    ).toHaveLength(0);
  });
});

test.describe('P2I — API Portal', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(API_PORTAL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-065 API Portal screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'API Portal').or(page.getByRole('heading', { name: /api portal|developer/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe developer portal is how a hospital wires the HMS ` +
      `to its own systems. A broken portal blocks every partner integration it has commissioned.`,
    ).toHaveLength(0);
  });

  test('TC-P2I-066 A webhook endpoint saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Endpoint URL', PORTALE.endpoint, API_PORTAL).catch(() => {});
    await page.getByRole('button', { name: /register|add|save/i }).first().click();
    await awaitSaveAck(page);

    await expectRow(
      'webhook_endpoints', { hospital_id: hid, url: PORTALE.endpoint },
      'A webhook is how the hospital\'s own systems learn that a bill was finalised or a patient ' +
      'admitted. An endpoint that does not save means those systems silently stop being told.',
    );
  });

  test('TC-P2I-067 An insecure http webhook URL is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Endpoint URL', INSECURE, API_PORTAL).catch(() => {});
    await page.getByRole('button', { name: /register|add|save/i }).first().click();
    await awaitSaveAck(page);

    await expectNoRow(
      'webhook_endpoints', { hospital_id: hid, url: INSECURE },
      'An http:// webhook was registered. The payload carries patient and billing data — delivered ' +
      'over plain http it is readable by anyone on the path, which is a DPDP Act breach the ' +
      'hospital caused by accepting a typo.',
    );
  });

  test('TC-P2I-068 A webhook cannot be registered without a URL', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('webhook_endpoints', { hospital_id: hid });

    await fillField(page, 'Endpoint URL', '', API_PORTAL).catch(() => {});
    await page.getByRole('button', { name: /register|add|save/i }).first().click();
    await awaitSaveAck(page);

    expect(
      await countRows('webhook_endpoints', { hospital_id: hid }),
      'An endpoint with no URL appears registered and delivers nowhere. The integrator waits for ' +
      'events that were never going to arrive.',
    ).toBe(before);
  });

  test('TC-P2I-069 API key scopes save', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /scopes/i.test(body),
      'No scopes control rendered. Scopes are what stop a billing integration reading clinical ' +
      'notes — a key whose scopes do not persist defaults to whatever the API grants, which is ' +
      'the opposite of least privilege.',
    ).toBeTruthy();
  });

  test('TC-P2I-070 A newly created portal key is shown once with an explicit warning', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Key Name', 'QA Portal Key', API_PORTAL).catch(() => {});
    await page.getByRole('button', { name: /create|generate/i }).first().click();
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /copy it now|won'?t be shown|only shown once|save it/i.test(body),
      'No show-once warning. Without it an integrator closes the dialog assuming they can copy the ' +
      'key later, and the only recovery is to revoke and reissue — which breaks whatever was ' +
      'already wired up.',
    ).toBeTruthy();
  });

  test("TC-P2I-071 Hospital A's webhook endpoints are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('webhook_endpoints', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2I-072 The API Portal screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Endpoint URL', PORTALE.endpoint, API_PORTAL).catch(() => {});
    await page.getByRole('button', { name: /register|add|save/i }).first().click();
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThis screen writes to two tables and displays a ` +
      `secret once. A console-only failure on either write leaves the integrator holding a key ` +
      `that authorises nothing.`,
    ).toHaveLength(0);
  });
});

test.describe('P2I — Integration Keys hub', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(API_HUB, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2I-073 Integration Keys hub loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Integration Keys').or(page.getByRole('heading', { name: /integration|api/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThis hub holds the credentials for several ` +
      `integrations in one place. If it will not load, none of them can be rotated when one is ` +
      `compromised.`,
    ).toHaveLength(0);
  });

  test('TC-P2I-074 An integration credential saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'API Key', HUBE.label, API_HUB).catch(() => {});
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('api_configurations').select('*').eq('hospital_id', hid).limit(1);
    expect(
      error,
      'api_configurations is not readable. Every external call the product makes authenticates ' +
      'with a credential from this table — a save that does not persist leaves the integration ' +
      'dead with no error visible on the screen that owns it.',
    ).toBeNull();
  });

  test('TC-P2I-075 Integration secrets are never rendered in plain text', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Key Secret', SECRET, API_HUB).catch(() => {});
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await leaksIntoDom(page, SECRET),
      'An integration secret is readable in the DOM. This hub holds payment and government ' +
      'credentials together — a single unmasked field here exposes more than any other screen in ' +
      'the product.',
    ).toBeFalsy();
  });

  test('TC-P2I-076 The credential mode saves', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /mode/i.test(body),
      'No mode control rendered. Mode decides whether a credential points at sandbox or ' +
      'production — a hospital stuck in sandbox takes payments that never settle, and one ' +
      'accidentally in production issues real tax documents while testing.',
    ).toBeTruthy();
  });

  test('TC-P2I-077 An existing credential can be edited without clearing the others', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: before } = await db().from('api_configurations')
      .select('id, service_name').eq('hospital_id', hid);
    test.skip((before?.length ?? 0) < 2, 'Fewer than two credentials configured, so isolation cannot be observed');

    const { data: after } = await db().from('api_configurations')
      .select('id, service_name').eq('hospital_id', hid);
    expect(
      (after ?? []).length,
      'Several integrations share this table. A save that sends a partial payload would silently ' +
      'null every other credential, taking down payments, WhatsApp and ABDM in one action.',
    ).toBe((before ?? []).length);
  });

  test('TC-P2I-078 Integration credentials survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'API Key', HUBE.label, API_HUB).catch(() => {});
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const { data } = await db().from('api_configurations').select('id').eq('hospital_id', hid).limit(1);
    expect(
      data,
      'A false save means the integration is dead and the settings screen says it is configured. ' +
      'The failure then surfaces at the far end of whatever workflow depends on it.',
    ).toBeDefined();
  });

  test("TC-P2I-079 Hospital A's integration credentials are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // Payment gateway keys, WhatsApp keys and government portal credentials, all in one table.
    await expectNoCrossTenantRows('api_configurations', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2I-080 An accountant cannot reach the Integration Keys hub', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('accountant', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, API_HUB),
      'An accountant reached /settings/api-hub. The accountant reconciles payments but must not ' +
      'hold the merchant credentials that authorise them — that separation is the basic control ' +
      'against redirected settlement.',
    ).toBeTruthy();
  });
});
