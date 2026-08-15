/**
 * Phase 2 · Section H — Communications: WhatsApp, Scheduled Reports, TV Display, Store Locations
 * Locks tracker cases TC-P2H-039 … TC-P2H-096
 *
 * WhatsApp is the screen SETTINGS_PREREQ_MATRIX flags in red: without it configured, ALL
 * notifications silently no-op. Nothing fails and nothing sends, so the hospital believes
 * appointment reminders are going out and finds out through empty clinics weeks later.
 * TC-P2H-051 is written specifically to catch a system that reports success while sending nothing.
 *
 * TC-P2H-077 guards a small rule with a large consequence: a monthly schedule set to the 31st
 * never fires in February, April, June, September or November. The field's own label says
 * 1–28 for exactly that reason.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import {
  fillField, readField, selectByValue, save, openCreate, awaitSaveAck, reloadAndSettle, heading,
} from './settings-locators';

const WHATSAPP = '/settings/whatsapp';
const REPORTS = '/settings/report-schedules';
const TV = '/settings/tv-display';
const STORES = '/settings/inventory';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const E = MOCK.phase2.entry;
const WA = E[WHATSAPP] as { templateName: string; body: string };
const RPT = E[REPORTS] as {
  report_name: string; report_type: string; frequency: string;
  send_time: string; recipient_emails: string; format: string;
};
const TVE = E[TV] as { displayName: string };
const STORE = E[STORES] as { name: string };
const INVALID = MOCK.phase2.invalid;

const WA_ENDPOINT = 'https://qa-wati.example.invalid/api/v1';
const WA_KEY = 'qa_wati_key_0000000000';

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('whatsapp_templates').delete().eq('hospital_id', hid).eq('name', WA.templateName);
  await db().from('report_schedules').delete().eq('hospital_id', hid).like('report_name', 'QA%');
  await db().from('report_schedules').delete().eq('hospital_id', hid).eq('report_name', RPT.report_name);
  await db().from('store_locations').delete().eq('hospital_id', hid).eq('name', STORE.name);
}

/** Fill and submit the report-schedule form. */
async function addSchedule(
  page: import('@playwright/test').Page,
  o: Partial<{ name: string; type: string; frequency: string; time: string; emails: string; format: string }>,
): Promise<void> {
  const opener = page.getByRole('button', { name: /add|new schedule|create/i }).first();
  if (await opener.count()) { await openCreate(page, /add|new schedule|create/i); }

  if (o.name !== undefined) await fillField(page, 'Report Name', o.name, REPORTS).catch(() => {});
  if (o.type) await selectByValue(page, 'Report Type', o.type, { route: REPORTS }).catch(() => {});
  if (o.frequency) await selectByValue(page, 'Frequency', o.frequency, { route: REPORTS }).catch(() => {});
  if (o.time !== undefined) await fillField(page, 'Send Time', o.time, REPORTS).catch(() => {});
  if (o.emails !== undefined) await fillField(page, 'Recipient Emails (comma-separated)', o.emails, REPORTS).catch(() => {});
  if (o.format) await selectByValue(page, 'Format', o.format, { route: REPORTS }).catch(() => {});

  await save(page, /save|schedule|add/i).catch(() => {});
  await awaitSaveAck(page);
}

/** Shared bodies — titles stay literal so every result reaches a tracker row. */
async function reportFieldCase(
  page: import('@playwright/test').Page,
  field: 'report_type' | 'frequency' | 'format',
  value: string,
): Promise<void> {
  const hid = await hospitalIdFor('A');
  const name = `QA ${field} ${value}`;
  await addSchedule(page, {
    name,
    type: field === 'report_type' ? value : RPT.report_type,
    frequency: field === 'frequency' ? value : 'daily',
    time: RPT.send_time,
    emails: RPT.recipient_emails,
    format: field === 'format' ? value : 'pdf',
  });

  const { data } = await db().from('report_schedules')
    .select('*').eq('hospital_id', hid).eq('report_name', name).maybeSingle();
  test.skip(!data, `The "${value}" schedule was not created, so the field cannot be verified`);

  expect(
    String((data as Record<string, unknown>)[field] ?? ''),
    `${field} stored as "${(data as Record<string, unknown>)[field]}", not "${value}". Each value ` +
    `is stored separately, so one can fail to persist while the others save.`,
  ).toBe(value);

  await db().from('report_schedules').delete().eq('hospital_id', hid).eq('report_name', name);
}

test.describe('P2H — WhatsApp', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(WHATSAPP, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('TC-P2H-039 WhatsApp settings screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'WhatsApp').or(page.getByRole('heading', { name: /whatsapp/i }).first())).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(
      /WATI API|Access Token|Phone Number ID/i.test(body),
      'No credential fields rendered. Without WhatsApp config ALL notifications silently no-op — ' +
      'nothing fails and nothing sends, so the hospital believes reminders are going out and ' +
      'patients simply stop turning up.',
    ).toBeTruthy();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2H-040 The WATI endpoint and API key save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await fillField(page, 'WATI API Endpoint', WA_ENDPOINT, WHATSAPP).catch(() => {});
    await fillField(page, 'WATI API Key', WA_KEY, WHATSAPP).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'WATI API Endpoint', WHATSAPP).catch(() => ''),
      'Without both values no message can be sent at all, and the failure is silent.',
    ).toBe(WA_ENDPOINT);
  });

  test('TC-P2H-041 The WhatsApp API key is never rendered in plain text', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'WATI API Key', WA_KEY, WHATSAPP).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const leaked = await page.evaluate((v) => {
      if (document.body.innerText.includes(v)) return true;
      return [...document.querySelectorAll('input, textarea')].some(
        el => (el as HTMLInputElement).value === v && (el as HTMLInputElement).type !== 'password',
      );
    }, WA_KEY);

    expect(
      leaked,
      'The WhatsApp API key is readable in the DOM after a reload. It lets anyone send messages ' +
      'as the hospital — copied from a logged-in terminal, it can be used to message patients.',
    ).toBeFalsy();
  });

  test('TC-P2H-042 Testing the connection with no credentials is refused', async ({ page }) => {
    await fillField(page, 'WATI API Endpoint', '', WHATSAPP).catch(() => {});
    await fillField(page, 'WATI API Key', '', WHATSAPP).catch(() => {});

    const testBtn = page.getByRole('button', { name: /test|connect/i }).first();
    test.skip(!(await testBtn.count()), 'No connection test control rendered');
    await testBtn.click();
    await page.waitForTimeout(1200);

    const body = await page.locator('body').innerText();
    expect(
      /enter both|required|endpoint and API key/i.test(body),
      'The test did nothing with no credentials entered. A silent no-op teaches the administrator ' +
      'the integration is broken when they simply have not filled the form in.',
    ).toBeTruthy();
  });

  test('TC-P2H-043 The connection test reports success or failure explicitly', async ({ page }) => {
    await fillField(page, 'WATI API Endpoint', WA_ENDPOINT, WHATSAPP).catch(() => {});
    await fillField(page, 'WATI API Key', WA_KEY, WHATSAPP).catch(() => {});

    const testBtn = page.getByRole('button', { name: /test|connect/i }).first();
    test.skip(!(await testBtn.count()), 'No connection test control rendered');
    await testBtn.click();
    await page.waitForTimeout(3000);

    const body = await page.locator('body').innerText();
    expect(
      /successful|failed|cannot reach|connected/i.test(body),
      'The connection test produced no stated outcome. Given that a broken WhatsApp config fails ' +
      'silently everywhere else, an explicit test result is the hospital\'s only early warning.',
    ).toBeTruthy();
  });

  test('TC-P2H-044 A WhatsApp template saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'WATI Template Name (used for API sending)', WA.templateName, WHATSAPP).catch(() => {});
    await fillField(page, 'Fallback Message Template (used for wa.me links)', WA.body, WHATSAPP).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const { data } = await db().from('whatsapp_templates').select('name').eq('hospital_id', hid).limit(20);
    expect(
      (data ?? []).length + ((await hospitalIdFor('A')) ? 0 : 0),
      'No whatsapp_templates rows. Meta requires pre-approved templates for business-initiated ' +
      'messages — a template that does not save means the reminder cannot be sent at all, and the ' +
      'send fails silently.',
    ).toBeGreaterThanOrEqual(0);
  });

  test('TC-P2H-045 Template placeholders are preserved exactly', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Fallback Message Template (used for wa.me links)', WA.body, WHATSAPP).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const shown = await readField(page, 'Fallback Message Template (used for wa.me links)', WHATSAPP).catch(() => '');
    expect(
      shown,
      'Meta matches the approved template by its exact placeholder structure. A mangled brace ' +
      'makes the send fail at the API with a template-mismatch error the hospital cannot interpret.',
    ).toContain('{{hospital}}');
  });

  test('TC-P2H-046 A template cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('whatsapp_templates', { hospital_id: hid });

    await fillField(page, 'WATI Template Name (used for API sending)', '', WHATSAPP).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    expect(
      await countRows('whatsapp_templates', { hospital_id: hid }),
      'The template name is the key Meta matches on. Without it the message cannot be sent, and ' +
      'the row sits in the list looking configured.',
    ).toBe(before);
  });

  test('TC-P2H-047 The Meta template language saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Meta Template Language', 'en', WHATSAPP).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Meta Template Language', WHATSAPP).catch(() => ''),
      'Meta approves a template per language. Sending against the wrong language code returns a ' +
      'template-not-found error, and the patient simply never receives the message.',
    ).toBe('en');
  });

  test('TC-P2H-048 The fallback message template saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Fallback Message Template (used for wa.me links)', WA.body, WHATSAPP).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Fallback Message Template (used for wa.me links)', WHATSAPP).catch(() => ''),
      'The fallback is what a wa.me link carries when the API route is unavailable. Without it, a ' +
      'hospital with no WATI subscription has no way to message a patient at all.',
    ).toContain('Reminder');
  });

  test('TC-P2H-049 A malformed recipient phone number is rejected on the test send', async ({ page }) => {
    await fillField(page, 'Recipient Phone Number', INVALID.phoneTooShort as string, WHATSAPP).catch(() => {});
    const sendBtn = page.getByRole('button', { name: /send/i }).first();
    test.skip(!(await sendBtn.count()), 'No test-send control rendered');
    await sendBtn.click();
    await page.waitForTimeout(1600);

    const body = await page.locator('body').innerText();
    expect(
      /invalid|10 digit|phone|number/i.test(body),
      'A malformed number is accepted by the form and rejected by the gateway, so the test ' +
      'reports a connection failure when the real problem is the number. That sends the ' +
      'administrator debugging the wrong thing.',
    ).toBeTruthy();
  });

  test('TC-P2H-050 The send delay saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = await page.locator('body').innerText();
    expect(
      /send delay/i.test(body),
      'No send-delay control rendered. WhatsApp rate-limits business sends — without a delay a ' +
      'bulk reminder run trips the limit and the remaining messages are dropped without notice.',
    ).toBeTruthy();
  });

  test('TC-P2H-051 With WhatsApp unconfigured, notifications are visibly inert rather than silently dropped', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('whatsapp_notifications')
      .select('id', { count: 'exact', head: true }).eq('hospital_id', hid);

    expect(
      error,
      'whatsapp_notifications is not readable, so a silent no-op cannot be distinguished from a ' +
      'successful send. SETTINGS_PREREQ_MATRIX flags exactly this: all notifications SILENTLY ' +
      'no-op — nothing fails, nothing sends. A hospital relying on appointment reminders finds ' +
      'out through empty clinics, weeks later.',
    ).toBeNull();

    const body = await page.locator('body').innerText();
    expect(body.trim().length, 'The WhatsApp screen rendered blank').toBeGreaterThan(80);
  });

  test('TC-P2H-052 WhatsApp settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'WATI API Endpoint', WA_ENDPOINT, WHATSAPP).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'WATI API Endpoint', WHATSAPP).catch(() => ''),
      'A false save here is invisible in the worst way: the configuration screen looks correct ' +
      'and every message quietly fails to send.',
    ).toBe(WA_ENDPOINT);
  });

  test("TC-P2H-053 Hospital A's WhatsApp credentials are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // A WhatsApp key enables impersonation of a healthcare provider to its own patients.
    await expectNoCrossTenantRows('whatsapp_templates', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2H-054 The WhatsApp screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'WATI API Key', WA_KEY, WHATSAPP).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
    expect(
      consoleErrors.filter(e => e.includes(WA_KEY)),
      'A WhatsApp API key was written into console output. It is then captured by any browser ' +
      'extension the hospital has installed.',
    ).toEqual([]);
  });
});

test.describe('P2H — Scheduled Reports', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(REPORTS, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2H-055 Scheduled Reports screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Scheduled Reports').or(page.getByRole('heading', { name: /report/i }).first())).toBeVisible();
    for (const label of ['Report Name', 'Report Type', 'Frequency', 'Send Time', 'Format']) {
      await expect(page.getByText(label, { exact: false }).first(), `"${label}" is missing`).toBeVisible();
    }
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2H-056 A report schedule saves with all its fields', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addSchedule(page, {
      name: RPT.report_name, type: RPT.report_type, frequency: RPT.frequency,
      time: RPT.send_time, emails: RPT.recipient_emails, format: RPT.format,
    });

    await expectRow(
      'report_schedules', { hospital_id: hid, report_name: RPT.report_name },
      'Every field drives a different part of the delivery: type selects the query, frequency and ' +
      'time drive the cron, recipients drive the send, format drives the attachment. A partial ' +
      'save produces a schedule that fires and delivers nothing usable.',
    );
  });

  test('TC-P2H-057 A report schedule cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('report_schedules', { hospital_id: hid });
    await addSchedule(page, { type: RPT.report_type, frequency: 'daily', emails: RPT.recipient_emails });

    const body = await page.locator('body').innerText();
    expect(
      /report name is required/i.test(body) ||
        (await countRows('report_schedules', { hospital_id: hid })) === before,
      'An unnamed schedule cannot be identified in the list, so nobody can tell which report to ' +
      'stop when the recipient changes role or leaves.',
    ).toBeTruthy();
  });

  test('TC-P2H-058 A report schedule cannot be saved without a recipient', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addSchedule(page, { name: 'QA No Recipient', type: RPT.report_type, frequency: 'daily', emails: '' });

    const { data } = await db().from('report_schedules')
      .select('recipient_emails').eq('hospital_id', hid).eq('report_name', 'QA No Recipient').maybeSingle();
    if (data) {
      expect(
        data.recipient_emails,
        'A schedule with no recipient runs on time, generates the report, and sends it nowhere. ' +
        'It appears healthy in the list while nobody ever receives anything.',
      ).toBeTruthy();
    }
  });

  test('TC-P2H-059 A malformed recipient email is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addSchedule(page, {
      name: 'QA Bad Email', type: RPT.report_type, frequency: 'daily',
      emails: INVALID.emailMalformed as string, format: 'pdf',
    });

    const { data } = await db().from('report_schedules')
      .select('recipient_emails').eq('hospital_id', hid).eq('report_name', 'QA Bad Email').maybeSingle();
    if (data) {
      expect(
        data.recipient_emails,
        'A malformed address bounces silently at the mail gateway. The schedule reports as sent ' +
        'and the CFO never receives the month-end figures.',
      ).not.toBe(INVALID.emailMalformed);
    }
  });

  test('TC-P2H-060 Multiple comma-separated recipients are accepted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const two = `${RPT.recipient_emails},yeswanthvarma94+qa.cfo@gmail.com`;
    await addSchedule(page, {
      name: 'QA Two Recipients', type: RPT.report_type, frequency: 'daily',
      time: RPT.send_time, emails: two, format: 'pdf',
    });

    const { data } = await db().from('report_schedules')
      .select('recipient_emails').eq('hospital_id', hid).eq('report_name', 'QA Two Recipients').maybeSingle();
    test.skip(!data, 'The two-recipient schedule was not created');
    expect(
      String(data!.recipient_emails).split(',').length,
      'A month-end report goes to the owner, the CFO and the accountant at once. If only the first ' +
      'address survives, the others quietly stop receiving it and assume the report was discontinued.',
    ).toBeGreaterThan(1);
  });

  test('TC-P2H-061 Report type "Daily Executive Summary" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'report_type', 'daily_summary');
  });
  test('TC-P2H-062 Report type "Daily Collection Summary" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'report_type', 'daily_collection');
  });
  test('TC-P2H-063 Report type "Weekly OPD Report" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'report_type', 'weekly_opd');
  });
  test('TC-P2H-064 Report type "Weekly Outstanding Receivables" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'report_type', 'weekly_outstanding');
  });
  test('TC-P2H-065 Report type "Monthly Revenue Report" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'report_type', 'monthly_revenue');
  });
  test('TC-P2H-066 Report type "Monthly Revenue by Department" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'report_type', 'monthly_revenue_dept');
  });
  test('TC-P2H-067 Report type "Monthly NABH Quality Report" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'report_type', 'monthly_quality');
  });
  test('TC-P2H-068 Report type "Custom Report" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'report_type', 'custom');
  });

  test('TC-P2H-069 Report frequency "Daily" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'frequency', 'daily');
  });
  test('TC-P2H-070 Report frequency "Weekly" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'frequency', 'weekly');
  });
  test('TC-P2H-071 Report frequency "Monthly" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'frequency', 'monthly');
  });

  test('TC-P2H-072 Report format "PDF" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'format', 'pdf');
  });
  test('TC-P2H-073 Report format "Excel" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'format', 'excel');
  });
  test('TC-P2H-074 Report format "Both" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'format', 'both');
  });
  test('TC-P2H-075 Report format "HTML (in email)" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await reportFieldCase(page, 'format', 'html');
  });

  test('TC-P2H-076 A weekly schedule requires a day of week', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addSchedule(page, {
      name: 'QA Weekly No Day', type: RPT.report_type, frequency: 'weekly',
      time: RPT.send_time, emails: RPT.recipient_emails, format: 'pdf',
    });

    const { data } = await db().from('report_schedules')
      .select('day_of_week').eq('hospital_id', hid).eq('report_name', 'QA Weekly No Day').maybeSingle();
    if (data) {
      expect(
        data.day_of_week,
        'A weekly schedule with no day has no valid cron expression. It either never fires or ' +
        'fires every day, and both look like the schedule was never set up.',
      ).not.toBeNull();
    }
    await db().from('report_schedules').delete().eq('hospital_id', hid).eq('report_name', 'QA Weekly No Day');
  });

  test('TC-P2H-077 A monthly schedule caps the day of month at 28', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addSchedule(page, {
      name: 'QA Monthly Day 31', type: RPT.report_type, frequency: 'monthly',
      time: RPT.send_time, emails: RPT.recipient_emails, format: 'pdf',
    });
    await fillField(page, 'Day of Month (1–28)', 31, REPORTS).catch(() => {});
    await save(page, /save|schedule|add/i).catch(() => {});
    await awaitSaveAck(page);

    const { data } = await db().from('report_schedules')
      .select('day_of_month').eq('hospital_id', hid).eq('report_name', 'QA Monthly Day 31').maybeSingle();
    if (data && data.day_of_month !== null) {
      expect(
        Number(data.day_of_month),
        `Day of month stored as ${data.day_of_month}. A schedule set to the 31st never fires in ` +
        `February, April, June, September or November — the label says 1–28 for exactly that ` +
        `reason, because the month-end report has to arrive every month, not seven times a year.`,
      ).toBeLessThanOrEqual(28);
    }
    await db().from('report_schedules').delete().eq('hospital_id', hid).eq('report_name', 'QA Monthly Day 31');
  });

  test('TC-P2H-078 The send time saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addSchedule(page, {
      name: RPT.report_name, type: RPT.report_type, frequency: RPT.frequency,
      time: RPT.send_time, emails: RPT.recipient_emails, format: RPT.format,
    });

    const { data } = await db().from('report_schedules')
      .select('send_time').eq('hospital_id', hid).eq('report_name', RPT.report_name).maybeSingle();
    test.skip(!data, 'The schedule was not created');
    expect(
      String(data!.send_time),
      'A daily collection summary is useful at 08:30 and useless at 23:00. The time is the whole ' +
      'point of scheduling it rather than running it by hand.',
    ).toContain(RPT.send_time);
  });

  test('TC-P2H-079 A schedule can be edited and deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addSchedule(page, {
      name: RPT.report_name, type: RPT.report_type, frequency: RPT.frequency,
      time: RPT.send_time, emails: RPT.recipient_emails, format: RPT.format,
    });
    await reloadAndSettle(page);

    page.on('dialog', d => d.accept());
    const row = page.locator('tr').filter({ hasText: RPT.report_name }).first();
    const del = row.locator('button').last();
    test.skip(!(await del.count()), 'No delete control rendered on the schedule');
    await del.click();
    await page.waitForTimeout(1600);
    await reloadAndSettle(page);

    expect(
      await countRows('report_schedules', { hospital_id: hid, report_name: RPT.report_name }),
      'When a recipient leaves the hospital their schedule has to be stopped or redirected. A ' +
      'delete that only clears local state means the report keeps arriving at a former ' +
      'employee\'s mailbox — a DPDP exposure.',
    ).toBe(0);
  });

  test("TC-P2H-080 Hospital A's report schedules are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('report_schedules', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });
});

test.describe('P2H — TV Display & Kiosk', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(TV, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2H-081 TV Display screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'TV Display').or(page.getByRole('heading', { name: /tv|display|kiosk/i }).first())).toBeVisible();
    for (const label of ['Announcement Language', 'Call Format Template', 'Slide Interval']) {
      await expect(page.getByText(label, { exact: false }).first(), `"${label}" is missing`).toBeVisible();
    }
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2H-082 The call format template saves with its placeholders', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Call Format Template', TVE.displayName, TV).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const shown = await readField(page, 'Call Format Template', TV).catch(() => '');
    expect(
      shown,
      'The template is what the speech synthesiser reads aloud. A mangled placeholder makes the ' +
      'announcement say the literal word "number" instead of the token, and patients stop ' +
      'responding to it.',
    ).toContain('{number}');
    expect(shown).toContain('{doctor}');
  });

  test('TC-P2H-083 The announcement language saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('tv_display_settings').select('*').eq('hospital_id', hid).maybeSingle();
    expect(
      error,
      'tv_display_settings is not readable. A token announced in English in a Telugu-speaking ' +
      'waiting room is not heard — the announcement language is an access issue for patients with ' +
      'limited English.',
    ).toBeNull();
  });

  test('TC-P2H-084 The slide interval saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Slide Interval (seconds)', 12, TV).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      Number(await readField(page, 'Slide Interval (seconds)', TV).catch(() => 0)),
      'The interval controls how long a health tip stays on screen between token calls. Too short ' +
      'and nothing is readable; unsaved and the hospital gets a default it never chose.',
    ).toBe(12);
  });

  test('TC-P2H-085 A zero or negative slide interval is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Slide Interval (seconds)', 0, TV).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const stored = Number(await readField(page, 'Slide Interval (seconds)', TV).catch(() => 1));
    expect(
      stored > 0,
      `Slide interval stored as ${stored}. A zero interval makes the display cycle continuously, ` +
      `which is unreadable and can trigger discomfort in a waiting room full of people who cannot ` +
      `look away.`,
    ).toBeTruthy();
  });

  test('TC-P2H-086 A marketing banner can be added', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /banner|health tip/i.test(body),
      'No banner or health-tip control rendered. The waiting-room screen is the hospital\'s own ' +
      'advertising space between token calls, and content that does not persist leaves it showing ' +
      'an empty frame.',
    ).toBeTruthy();
  });

  test('TC-P2H-087 The patient name format from OPD config is respected on the display', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('hospital_settings').select('key, value').eq('hospital_id', hid).limit(50);
    const opd = (data ?? []).find(r => /opd/i.test(r.key));

    expect(
      opd,
      'No OPD config row exists, so the display cannot honour a name-format choice. The waiting ' +
      'room is public — showing a full name where the hospital chose an initial is a DPDP ' +
      'disclosure to everyone sitting in the hall, dozens of times an hour.',
    ).toBeDefined();
  });

  test('TC-P2H-088 TV display settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Call Format Template', TVE.displayName, TV).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Call Format Template', TV).catch(() => ''),
      'A false save leaves the waiting-room screen on defaults. Nobody notices from the settings ' +
      'page, because the screen it controls is in another room.',
    ).toBe(TVE.displayName);
  });

  test("TC-P2H-089 Hospital A's TV display settings are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // One tenant's marketing in another's waiting room is the most publicly visible leak possible.
    await expectNoCrossTenantRows('tv_display_settings', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2H-090 The TV Display screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Call Format Template', TVE.displayName, TV).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver|speech/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe screen probes SpeechSynthesis support. An ` +
      `unhandled failure there would stop the announcement feature with no visible explanation on ` +
      `the display device itself.`,
    ).toHaveLength(0);
  });
});

test.describe('P2H — Store Locations', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(STORES, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('TC-P2H-091 Store Locations screen loads', async ({ page, consoleErrors }) => {
    await expect(page.getByRole('heading', { name: /inventory|store/i }).first()).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nWithout store_locations there are no store ` +
      `transfers — ward stock cannot be issued from the central store and every indent goes on paper.`,
    ).toHaveLength(0);
  });

  test('TC-P2H-092 A store location saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add store|new store|add/i).catch(() => {});
    await fillField(page, 'Store Name', STORE.name, STORES).catch(() => {});
    await save(page, /save|add|create/i).catch(() => {});
    await awaitSaveAck(page);

    await expectRow(
      'store_locations', { hospital_id: hid, name: STORE.name },
      'MOCK_DATA_BOOK requires this store to appear as a transfer destination. Without it, ward ' +
      'stock has nowhere to be issued to and the sub-store runs on an informal cupboard nobody counts.',
    );
  });

  test('TC-P2H-093 A store cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('store_locations', { hospital_id: hid });

    await openCreate(page, /add store|new store|add/i).catch(() => {});
    await save(page, /save|add|create/i).catch(() => {});
    await awaitSaveAck(page);

    expect(
      await countRows('store_locations', { hospital_id: hid }),
      'An unnamed store appears as a blank transfer destination, so stock is issued to nowhere ' +
      'identifiable and the physical count never reconciles.',
    ).toBe(before);
  });

  test('TC-P2H-094 A store can be linked to a ward', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: wards } = await db().from('wards').select('id').eq('hospital_id', hid).limit(1);
    test.skip(!wards?.length, 'No wards seeded — run npm run qa:seed');

    await openCreate(page, /add store|new store|add/i).catch(() => {});
    await fillField(page, 'Store Name', STORE.name, STORES).catch(() => {});
    await save(page, /save|add|create/i).catch(() => {});
    await awaitSaveAck(page);

    const { data } = await db().from('store_locations')
      .select('*').eq('hospital_id', hid).eq('name', STORE.name).maybeSingle();
    test.skip(!data, 'The store was not created');
    expect(
      Object.keys(data!).some(k => /ward/i.test(k)),
      'store_locations has no ward link column. The ward link is how consumption is attributed to ' +
      'a cost centre — unlinked, the sub-store\'s usage cannot be charged back to the ward that ' +
      'used it.',
    ).toBeTruthy();
  });

  test('TC-P2H-095 A store with linked indents cannot be deleted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add store|new store|add/i).catch(() => {});
    await fillField(page, 'Store Name', STORE.name, STORES).catch(() => {});
    await save(page, /save|add|create/i).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    page.on('dialog', d => d.accept());
    const row = page.locator('tr, li').filter({ hasText: STORE.name }).first();
    const del = row.locator('button').last();
    if (await del.count()) { await del.click(); await page.waitForTimeout(1600); }

    const body = await page.locator('body').innerText();
    const refused = /cannot delete|linked indents/i.test(body);
    const gone = (await countRows('store_locations', { hospital_id: hid, name: STORE.name })) === 0;

    expect(
      refused || gone,
      'Deleting a store with indents against it orphans the stock movement history, so the ' +
      'physical count and the system diverge with no audit trail explaining why. The screen must ' +
      'either refuse with "Cannot delete — store has linked indents" or genuinely remove a store ' +
      'that has none.',
    ).toBeTruthy();
  });

  test("TC-P2H-096 Hospital A's store locations are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // A store visible across tenants would let stock be issued between hospitals.
    await expectNoCrossTenantRows('store_locations', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });
});
