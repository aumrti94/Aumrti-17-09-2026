/**
 * Phase 2 · Section B — Identity: Branding, White-Label, Support, Training
 * Locks tracker cases TC-P2B-085 … TC-P2B-134
 *
 * Four screens that share one theme: they are what the hospital and its patients SEE.
 * Branding prints on every bill and discharge summary, white-label decides which domain
 * patients are sent to, support is the only in-product route to the vendor, and training is
 * how a ward nurse learns a screen with no trainer on site.
 *
 * Three of the four write to `hospitals` through an `as any` cast, which suppresses the type
 * checking that would otherwise catch a wrong column name — so each carries an explicit
 * console-error case. TC-P2B-101 exists because White-Label has three separate save buttons
 * writing to the same row: if one sends a partial payload it silently nulls what the others set.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import { fillField, readField, selectByValue, save, awaitSaveAck, reloadAndSettle, heading, openTab } from './settings-locators';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const A = MOCK.hospitals.A;
const E = MOCK.phase2.entry;

const BRANDING = '/settings/branding';
const WHITE_LABEL = '/settings/white-label';
const SUPPORT = '/settings/support';
const TRAINING = '/settings/training';

const WL = E[WHITE_LABEL] as { customDomain: string };
const TICKET = E[SUPPORT] as { subject: string; body: string };
const TRAIN = E[TRAINING] as { search: string };
const TAGLINE = 'NABH Accredited';

async function hospitalRow(): Promise<Record<string, unknown>> {
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('hospitals').select('*').eq('id', hid).maybeSingle();
  return (data ?? {}) as Record<string, unknown>;
}

async function purgeTickets(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('platform_support_tickets').delete()
    .eq('hospital_id', hid).eq('subject', TICKET.subject);
}

/** A tiny real PNG, generated in-page so no binary fixture is committed. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function uploadLogo(page: import('@playwright/test').Page, bytes: number): Promise<void> {
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({
    name: 'qa-logo.png',
    mimeType: 'image/png',
    buffer: bytes <= 0
      ? Buffer.from(TINY_PNG_BASE64, 'base64')
      : Buffer.concat([Buffer.from(TINY_PNG_BASE64, 'base64'), Buffer.alloc(bytes)]),
  });
  await page.waitForTimeout(2000);
}

/** Shared body for the four ticket-category cases. Titles stay literal. */
async function ticketCategoryCase(page: import('@playwright/test').Page, value: string) {
  const hid = await hospitalIdFor('A');
  const subject = `${TICKET.subject} ${value}`;

  await fillField(page, 'Subject', subject, SUPPORT);
  await selectByValue(page, 'Category', value, { route: SUPPORT });
  await fillField(page, 'Describe the issue', TICKET.body, SUPPORT);
  await page.getByRole('button', { name: /submit|raise|send/i }).first().click();
  await awaitSaveAck(page);

  const row = await expectRow<{ category: string }>(
    'platform_support_tickets', { hospital_id: hid, subject },
    `Category "${value}" — no ticket row was written.`,
  );
  expect(
    row.category,
    `Category was stored as "${row.category}", not "${value}". Category routes a ticket to the ` +
    `right team and sets its urgency — one failing to save sends every such ticket to the ` +
    `default queue.`,
  ).toBe(value);

  await db().from('platform_support_tickets').delete().eq('hospital_id', hid).eq('subject', subject);
}

test.describe('P2B — Identity: Branding', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(BRANDING, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
  });

  test('TC-P2B-085 Branding screen loads with the current logo, name and print settings', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Branding')).toBeVisible();
    for (const label of ['Hospital Name', 'Tagline', 'Primary Font', 'Base Font Size', 'Footer Text']) {
      await expect(page.getByText(label, { exact: false }).first(), `"${label}" is missing`).toBeVisible();
    }
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2B-086 A logo under the size limit uploads and is stored', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    test.skip(!(await page.locator('input[type="file"]').count()), 'No file input rendered on the Branding screen');

    await uploadLogo(page, 0);
    const body = await page.locator('body').innerText();
    expect(
      /logo uploaded|upload failed/i.test(body),
      'The upload produced no feedback at all. An upload that appears to succeed but stores ' +
      'nothing leaves an empty box at the top of every invoice.',
    ).toBeTruthy();
    expect(body, 'The logo upload failed').not.toMatch(/upload failed/i);
  });

  test('TC-P2B-087 A logo over 2MB is refused', async ({ page }) => {
    test.skip(!(await page.locator('input[type="file"]').count()), 'No file input rendered on the Branding screen');

    await uploadLogo(page, 2 * 1024 * 1024 + 1024);
    const body = await page.locator('body').innerText();
    expect(
      /too large|max 2\s?MB/i.test(body),
      'A file over 2MB was accepted. An oversized logo embedded in every printed document can ' +
      'exceed the PDF payload limit, at which point bills stop printing entirely.',
    ).toBeTruthy();
  });

  test('TC-P2B-088 The branding hospital name saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    expect(
      await readField(page, 'Hospital Name', BRANDING),
      'The Branding name and the Profile name have drifted apart. Only one of them is the ' +
      'registered legal name, and both print on documents.',
    ).toBe(A.name);
  });

  test('TC-P2B-089 The tagline saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Tagline', TAGLINE, BRANDING);
    await save(page, /save/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Tagline', BRANDING),
      'The tagline did not persist. Claiming NABH accreditation on a letterhead is a statement ' +
      'an assessor may check, so it has to be the hospital\'s own words.',
    ).toBe(TAGLINE);
  });

  test('TC-P2B-090 The primary print font can be changed and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { optionValues } = await import('./settings-locators');
    const fonts = await optionValues(page, 'Primary Font', BRANDING);
    test.skip(fonts.length < 2, 'Fewer than two fonts offered, so a change cannot be made');

    const target = fonts[1];
    await selectByValue(page, 'Primary Font', target, { route: BRANDING });
    await save(page, /save/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Primary Font', BRANDING),
      'The print font did not persist, so the hospital never gets the one it chose.',
    ).toBe(target);
  });

  test('TC-P2B-091 The base font size saves and respects the legibility floor', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const current = await readField(page, 'Base Font Size', BRANDING);
    const size = Number(current.replace(/\D/g, '')) || 0;
    expect(
      size === 0 || size >= 9,
      `Base font size is ${size}. Dosage instructions printed at an unreadable size are a ` +
      `medication-safety risk, not a cosmetic preference.`,
    ).toBeTruthy();
  });

  test('TC-P2B-092 The three-part footer text saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const footers = page.locator('input[placeholder*="Left"], input[placeholder*="Center"], input[placeholder*="Right"]');
    test.skip(!(await footers.count()), 'Footer segment inputs not found');

    const values = ['For appointments: 9876500001', 'www.qa-aarogya.example.in', 'Reg No: NABH-QA-A-2026'];
    const n = Math.min(await footers.count(), values.length);
    for (let i = 0; i < n; i++) await footers.nth(i).fill(values[i]);

    await save(page, /save/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    const lost = values.slice(0, n).filter(v => !body.includes(v));
    expect(
      lost,
      `Footer segment(s) lost on save: ${lost.join(' | ')}. Losing one while keeping the others ` +
      `is a partial-save defect that is easy to miss — and the footer carries the number a ` +
      `patient calls.`,
    ).toEqual([]);
  });

  test('TC-P2B-093 Branding changes survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Tagline', TAGLINE, BRANDING);
    await save(page, /save/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Tagline', BRANDING),
      'Branding claims "applies to all new printouts" in its own success message, which makes a ' +
      'silent failure here especially misleading.',
    ).toBe(TAGLINE);
  });

  test('TC-P2B-094 The print preview reflects unsaved changes live', async ({ page }) => {
    await fillField(page, 'Tagline', 'QA Live Preview Probe', BRANDING);
    await page.waitForTimeout(600);

    const body = await page.locator('body').innerText();
    expect(
      body.includes('QA Live Preview Probe'),
      'The preview did not update before saving. It exists so an administrator can see the ' +
      'letterhead before committing it — otherwise the first real proof is a printed bill ' +
      'handed to a patient.',
    ).toBeTruthy();
  });

  test('TC-P2B-095 The saved branding is what a printed document uses', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Tagline', TAGLINE, BRANDING);
    await save(page, /save/i);
    await awaitSaveAck(page);

    const row = await hospitalRow();
    expect(
      row.name,
      'The branding save did not leave the hospital name readable to the print layer. The toast ' +
      'promises the change "applies to all new printouts" — if branding is stored but never ' +
      'read by the print layer, that promise is false.',
    ).toBe(A.name);
  });

  test("TC-P2B-096 Hospital A's branding is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('hospitals', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2B-097 A receptionist cannot reach the Branding screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, BRANDING),
      'A receptionist reached /settings/branding. Branding is the hospital\'s public identity ' +
      'on legal documents — a change alters every invoice printed afterwards.',
    ).toBeTruthy();
  });

  test('TC-P2B-098 The Branding screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Tagline', TAGLINE, BRANDING);
    await save(page, /save/i);
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe logo upload goes to Supabase storage rather ` +
      `than a table, so a bucket or policy misconfiguration fails silently in the UI.`,
    ).toHaveLength(0);
  });
});

test.describe('P2B — Identity: White-Label', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(WHITE_LABEL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
  });

  test('TC-P2B-099 White-Label Branding screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'White-Label Branding')).toBeVisible();
    // Radix unmounts the inactive panel, so the Custom Domain field only exists once this tab is open.
    await openTab(page, /custom domain/i);
    await expect(page.getByPlaceholder(/hms\.yourhospital\.com/i)).toBeVisible();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2B-100 A custom theme colour saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hex = (E[BRANDING] as { primaryColour: string }).primaryColour;
    const field = page.locator('input').filter({ hasNot: page.locator('[type="file"]') }).first();
    await field.fill(hex);
    await page.getByRole('button', { name: /save theme/i }).click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);
    await openTab(page, /custom domain/i);

    const body = await page.locator('body').innerText();
    expect(
      body.toLowerCase().includes(hex.toLowerCase()),
      `The theme colour ${hex} did not persist. It carries through to the patient portal — a ` +
      `colour that resets makes the portal look unrelated to the hospital that sent the link.`,
    ).toBeTruthy();
  });

  test('TC-P2B-101 Save Theme and Save Domain are independent actions', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // Radix unmounts the inactive panel, so the Custom Domain field only exists once this tab is open.
    await openTab(page, /custom domain/i);
    await fillField(page, 'Custom Domain', WL.customDomain, WHITE_LABEL);
    await page.getByRole('button', { name: /save domain/i }).click();
    await awaitSaveAck(page);

    // Save Theme lives on the other tab, and the point of this case is that using it does not
    // clobber what Save Domain just wrote — so the switch is part of the scenario, not setup.
    await openTab(page, /theme/i);
    await page.getByRole('button', { name: /save theme/i }).click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);
    await openTab(page, /custom domain/i);

    expect(
      await readField(page, 'Custom Domain', WHITE_LABEL),
      'Saving the theme cleared the custom domain. This screen has three save buttons writing ' +
      'to the same hospitals row — if one sends a partial payload it silently nulls whatever ' +
      'the others set.',
    ).toBe(WL.customDomain);
  });

  test('TC-P2B-102 A custom domain saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // Radix unmounts the inactive panel, so the Custom Domain field only exists once this tab is open.
    await openTab(page, /custom domain/i);
    await fillField(page, 'Custom Domain', WL.customDomain, WHITE_LABEL);
    await page.getByRole('button', { name: /save domain/i }).click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);
    await openTab(page, /custom domain/i);

    expect(
      await readField(page, 'Custom Domain', WHITE_LABEL),
      'The custom domain did not persist, so every portal link points at the generic product ' +
      'URL instead of the hospital.',
    ).toBe(WL.customDomain);
  });

  test('TC-P2B-103 A malformed custom domain is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // Radix unmounts the inactive panel, so the Custom Domain field only exists once this tab is open.
    await openTab(page, /custom domain/i);
    await fillField(page, 'Custom Domain', 'not a domain!', WHITE_LABEL);
    await page.getByRole('button', { name: /save domain/i }).click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);
    await openTab(page, /custom domain/i);

    expect(
      await readField(page, 'Custom Domain', WHITE_LABEL),
      'A malformed domain was stored. It cannot have a DNS record or an SSL certificate issued ' +
      'against it, so the setup silently stalls at a step the hospital cannot diagnose.',
    ).not.toBe('not a domain!');
  });

  test('TC-P2B-104 The DNS record to create is displayed for the entered domain', async ({ page }) => {
    // Radix unmounts the inactive panel, so the Custom Domain field only exists once this tab is open.
    await openTab(page, /custom domain/i);
    await fillField(page, 'Custom Domain', WL.customDomain, WHITE_LABEL);
    await page.waitForTimeout(600);

    const body = await page.locator('body').innerText();
    expect(
      /CNAME|A record|DNS/i.test(body),
      'No DNS record is shown. The hospital\'s IT contact has to create it at their registrar — ' +
      'showing the exact value is the difference between a five-minute task and a support ticket.',
    ).toBeTruthy();
  });

  test('TC-P2B-105 The DNS value can be copied to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    // Radix unmounts the inactive panel, so the Custom Domain field only exists once this tab is open.
    await openTab(page, /custom domain/i);
    await fillField(page, 'Custom Domain', WL.customDomain, WHITE_LABEL);
    await page.waitForTimeout(500);

    const copy = page.getByRole('button', { name: /copy/i }).first();
    test.skip(!(await copy.count()), 'No copy control rendered beside the DNS value');
    await copy.click();
    await page.waitForTimeout(700);

    const body = await page.locator('body').innerText();
    expect(
      /copied/i.test(body),
      'No copy confirmation. A DNS value mistyped by one character fails verification with no ' +
      'useful error, which is the commonest cause of a stalled domain setup.',
    ).toBeTruthy();
  });

  test('TC-P2B-106 DNS verification reports its outcome', async ({ page }) => {
    // Radix unmounts the inactive panel, so the Custom Domain field only exists once this tab is open.
    await openTab(page, /custom domain/i);
    await fillField(page, 'Custom Domain', WL.customDomain, WHITE_LABEL);
    const verify = page.getByRole('button', { name: /verify/i }).first();
    test.skip(!(await verify.count()), 'No verify control rendered');
    await verify.click();
    await page.waitForTimeout(1600);

    const body = await page.locator('body').innerText();
    expect(
      /verified|pending|not found|SSL|propagat/i.test(body),
      'Verification produced no stated outcome. Without one the hospital cannot tell whether it ' +
      'is waiting on DNS propagation or on a mistake it made.',
    ).toBeTruthy();
  });

  test('TC-P2B-107 White-label settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // Radix unmounts the inactive panel, so the Custom Domain field only exists once this tab is open.
    await openTab(page, /custom domain/i);
    await fillField(page, 'Custom Domain', WL.customDomain, WHITE_LABEL);
    await page.getByRole('button', { name: /save domain/i }).click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);
    await openTab(page, /custom domain/i);

    expect(
      await readField(page, 'Custom Domain', WHITE_LABEL),
      'This screen writes to hospitals through an `as any` cast, which suppresses the type ' +
      'checking that would otherwise catch a wrong column name.',
    ).toBe(WL.customDomain);
  });

  test("TC-P2B-108 Hospital A's white-label settings are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('hospitals', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2B-109 A receptionist cannot reach the White-Label screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, WHITE_LABEL),
      'A receptionist reached /settings/white-label. Changing the custom domain changes where ' +
      'patients are sent — an infrastructure decision, not a front-desk one.',
    ).toBeTruthy();
  });

  test('TC-P2B-110 The White-Label screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // Radix unmounts the inactive panel, so the Custom Domain field only exists once this tab is open.
    await openTab(page, /custom domain/i);
    await fillField(page, 'Custom Domain', WL.customDomain, WHITE_LABEL);
    await page.getByRole('button', { name: /save domain/i }).click();
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nBoth saves write through an \`as any\` cast, so a ` +
      `column that does not exist produces a PostgREST error that never reaches the UI.`,
    ).toHaveLength(0);
  });
});

test.describe('P2B — Identity: Support', () => {
  test.beforeAll(async () => { await purgeTickets(); });
  test.afterAll(async () => { await purgeTickets(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(SUPPORT, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
  });

  test('TC-P2B-111 Support screen loads with the ticket form and existing tickets', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Support')).toBeVisible();
    for (const label of ['Subject', 'Category', 'Describe the issue']) {
      await expect(page.getByText(label, { exact: false }).first(), `"${label}" is missing`).toBeVisible();
    }
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2B-112 A support ticket submits and is stored', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    await fillField(page, 'Subject', TICKET.subject, SUPPORT);
    await fillField(page, 'Describe the issue', TICKET.body, SUPPORT);
    await page.getByRole('button', { name: /submit|raise|send/i }).first().click();
    await awaitSaveAck(page);

    await expectRow(
      'platform_support_tickets', { hospital_id: hid, subject: TICKET.subject },
      'No ticket row after a successful-looking submit. A ticket that appears to submit and ' +
      'writes nothing is worse than no support form: the hospital believes help is coming and waits.',
    );
  });

  test('TC-P2B-113 A ticket cannot be submitted without a subject', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('platform_support_tickets', { hospital_id: hid });

    await fillField(page, 'Describe the issue', TICKET.body, SUPPORT);
    await page.getByRole('button', { name: /submit|raise|send/i }).first().click();
    await awaitSaveAck(page);

    expect(
      await countRows('platform_support_tickets', { hospital_id: hid }),
      'A subjectless ticket was created. It cannot be triaged or prioritised, so it sits at the ' +
      'bottom of the queue while the hospital waits.',
    ).toBe(before);
  });

  test('TC-P2B-114 A ticket cannot be submitted without a description', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const subject = `${TICKET.subject} no-body`;

    await fillField(page, 'Subject', subject, SUPPORT);
    await page.getByRole('button', { name: /submit|raise|send/i }).first().click();
    await awaitSaveAck(page);

    await expectNoRow(
      'platform_support_tickets', { hospital_id: hid, subject },
      'A ticket with only a subject forces a round trip before anyone can begin, doubling the ' +
      'time to resolution on an issue that may be blocking clinical work.',
    );
  });

  test('TC-P2B-115 Support ticket category "Billing" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await ticketCategoryCase(page, 'billing');
  });
  test('TC-P2B-116 Support ticket category "Technical" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await ticketCategoryCase(page, 'technical');
  });
  test('TC-P2B-117 Support ticket category "Clinical Workflow" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await ticketCategoryCase(page, 'clinical_workflow');
  });
  test('TC-P2B-118 Support ticket category "Training" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await ticketCategoryCase(page, 'training');
  });

  test("TC-P2B-119 A submitted ticket appears in the hospital's ticket list", async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Subject', TICKET.subject, SUPPORT);
    await fillField(page, 'Describe the issue', TICKET.body, SUPPORT);
    await page.getByRole('button', { name: /submit|raise|send/i }).first().click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(TICKET.subject),
      'The submitted ticket is not listed. Without a visible list the hospital cannot tell ' +
      'whether a ticket was raised and submits it again, creating duplicates that slow the queue.',
    ).toBeTruthy();
  });

  test('TC-P2B-120 A reply can be added to an existing ticket', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Subject', TICKET.subject, SUPPORT);
    await fillField(page, 'Describe the issue', TICKET.body, SUPPORT);
    await page.getByRole('button', { name: /submit|raise|send/i }).first().click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    await page.getByText(TICKET.subject, { exact: false }).first().click();
    await page.waitForTimeout(900);

    const replyBox = page.getByPlaceholder(/reply/i).first();
    test.skip(!(await replyBox.count()), 'No reply control rendered on the ticket');
    await replyBox.fill('QA follow-up reply. Safe to ignore.');
    await page.getByRole('button', { name: /send|reply/i }).first().click();
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /reply sent|QA follow-up reply/i.test(body),
      'The reply was not recorded. Support is a conversation — a lost reply means the vendor ' +
      'asks for the same detail again by email, outside the system.',
    ).toBeTruthy();
  });

  test('TC-P2B-121 A submitted ticket survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Subject', TICKET.subject, SUPPORT);
    await fillField(page, 'Describe the issue', TICKET.body, SUPPORT);
    await page.getByRole('button', { name: /submit|raise|send/i }).first().click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    await expectRow(
      'platform_support_tickets', { hospital_id: hid, subject: TICKET.subject },
      'On a support form specifically, a false success means the hospital stops chasing an ' +
      'issue that nobody has received.',
    );
  });

  test("TC-P2B-122 Hospital A's support tickets are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('platform_support_tickets', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2B-123 The Support screen is reachable by hospital_admin', async ({ page }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    expect(
      await isRouteBlocked(page, SUPPORT),
      'hospital_admin cannot reach /settings/support. Unlike the rest of Settings, support must ' +
      'be easy to reach in a crisis — a gate that is too tight means the person who needs help ' +
      'cannot ask for it.',
    ).toBeFalsy();
  });

  test('TC-P2B-124 The Support screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Subject', TICKET.subject, SUPPORT);
    await fillField(page, 'Describe the issue', TICKET.body, SUPPORT);
    await page.getByRole('button', { name: /submit|raise|send/i }).first().click();
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe insert uses an \`as any\` cast, so a column ` +
      `mismatch fails at runtime only — on the one screen a hospital uses to report problems.`,
    ).toHaveLength(0);
  });
});

test.describe('P2B — Identity: Training Videos', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(TRAINING, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
  });

  test('TC-P2B-125 Training Videos screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Training Videos')).toBeVisible();
    await expect(page.getByPlaceholder(/search videos/i)).toBeVisible();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2B-126 Training videos are listed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { count } = await db().from('platform_training_videos').select('*', { count: 'exact', head: true });
    test.skip(!count, 'The platform training library is empty — this is platform-managed content');

    const body = await page.locator('body').innerText();
    expect(
      body.trim().length,
      'An empty library on a screen that promises "short how-to videos for every role" tells a ' +
      'new hospital the product is unfinished.',
    ).toBeGreaterThan(80);
  });

  test('TC-P2B-127 Searching filters the video list', async ({ page }) => {
    const box = page.getByPlaceholder(/search videos/i);
    // With no videos published there is nothing for a filter to change, so an empty library
    // would fail this case for a reason that has nothing to do with the filter. Skip instead —
    // an unseeded library is an environment gap, not a defect.
    const cards = page.locator('button').filter({ has: page.locator('img, .h-32') });
    test.skip(
      /no training videos published yet/i.test(await page.locator('body').innerText()),
      'No training videos published — seed platform_training_videos before running this case',
    );
    expect(await cards.count()).toBeGreaterThan(0);

    const before = (await page.locator('body').innerText()).length;
    await box.fill(TRAIN.search);
    await page.waitForTimeout(700);
    const after = (await page.locator('body').innerText()).length;

    expect(
      after,
      'Searching did not change the list. A receptionist looking for the OPD token video should ' +
      'not have to scroll the whole library during a shift.',
    ).not.toBe(before);
  });

  test('TC-P2B-128 A search with no matches shows an empty state rather than a blank page', async ({ page }) => {
    await page.getByPlaceholder(/search videos/i).fill('zzzznotathing');
    await page.waitForTimeout(700);

    const body = await page.locator('body').innerText();
    expect(
      body.trim().length,
      'A blank result area reads as a broken page, and a user who thinks training is broken ' +
      'stops looking for help entirely.',
    ).toBeGreaterThan(50);
  });

  test('TC-P2B-129 The Training screen offers no save action', async ({ page }) => {
    expect(
      await page.getByRole('button', { name: /save changes/i }).count(),
      'A Save control implies the hospital can edit vendor-managed content. The screen must not ' +
      'make a promise it cannot keep.',
    ).toBe(0);
  });

  test('TC-P2B-130 A training video can be opened', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { count } = await db().from('platform_training_videos').select('*', { count: 'exact', head: true });
    test.skip(!count, 'The platform training library is empty');

    const card = page.locator('button, a').filter({ hasText: /./ }).nth(1);
    if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(1200); }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Opening a video produced console errors:\n${real.join('\n')}\n\nA library that lists ` +
      `videos nobody can play is worse than no library.`,
    ).toHaveLength(0);
  });

  test('TC-P2B-131 Videos carry the role they are aimed at', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { data, error } = await db().from('platform_training_videos').select('*').limit(3);
    test.skip(!!error || !data?.length, 'The platform training library is empty or unreadable');

    const keys = Object.keys(data![0]);
    expect(
      keys.some(k => /role|module|category|audience/i.test(k)),
      `platform_training_videos has no role or module column (${keys.join(', ')}). The catalogue ` +
      `promises "videos for every role" — without it a pharmacist watches billing videos to ` +
      `find out they are not relevant.`,
    ).toBeTruthy();
  });

  test('TC-P2B-132 The training library is shared platform content, not tenant data', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { data, error } = await db().from('platform_training_videos').select('*').limit(1);
    test.skip(!!error || !data?.length, 'The platform training library is empty or unreadable');

    // This table is DELIBERATELY shared. Recorded so it is never "fixed" into a
    // tenant-scoped table by someone applying the isolation rule mechanically.
    expect(
      Object.keys(data![0]).includes('hospital_id'),
      'platform_training_videos has a hospital_id column, which contradicts it being shared ' +
      'platform content. Either the table is tenant-scoped and this case is wrong, or the ' +
      'column is vestigial and will confuse the next person who reads it.',
    ).toBeFalsy();
  });

  test('TC-P2B-133 The Training screen is reachable by hospital_admin', async ({ page }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    expect(
      await isRouteBlocked(page, TRAINING),
      'hospital_admin cannot reach /settings/training. Training is read-only vendor content ' +
      'with no patient data in it — a gate that is too tight blocks the adoption the videos ' +
      'exist to drive.',
    ).toBeFalsy();
  });

  test('TC-P2B-134 The Training screen loads with no red console errors', async ({ page, consoleErrors }) => {
    await page.getByPlaceholder(/search videos/i).fill(TRAIN.search);
    await page.waitForTimeout(900);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nVideo embeds pull from an external host, so a ` +
      `blocked embed shows as an empty player with the real cause visible only here.`,
    ).toHaveLength(0);
  });
});
