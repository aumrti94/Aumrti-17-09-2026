/**
 * Phase 2 · Section D — Structure: Bank Accounts
 * Locks tracker cases TC-P2D-107 … TC-P2D-124
 *
 * Bank accounts are what collections are reconciled against at day closure. The account
 * number and IFSC are the two fields money is actually settled on, and both fail late and
 * quietly: an invalid IFSC is accepted here and rejected by the bank days later, with no
 * trail back to the typo.
 *
 * These rows are also among the most sensitive in the database. TC-P2D-123 and TC-P2D-124
 * exist because a leak here is a fraud enabler, not merely a privacy breach.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import { fillField, save, openCreate, awaitSaveAck, reloadAndSettle, heading } from './settings-locators';

const ROUTE = '/settings/bank-accounts';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const ACC = MOCK.phase2.entry[ROUTE] as { label: string; accountNumber: string; ifsc: string };
const BAD_IFSC = MOCK.phase2.invalid.ifscTooShort as string;
const OPENING = 250000;

const NAMES = [ACC.label, 'QA No Bank', 'QA No Number', 'QA Bad IFSC', 'QA No IFSC', 'QA Zero Balance'];

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('bank_accounts').delete().eq('hospital_id', hid).in('account_name', NAMES);
}

async function addAccount(
  page: import('@playwright/test').Page,
  o: { name?: string; bank?: string; number?: string; ifsc?: string; opening?: number },
): Promise<void> {
  await openCreate(page, /add (first )?account/i);
  if (o.name !== undefined) await fillField(page, 'Account Name', o.name, ROUTE);
  if (o.bank !== undefined) await fillField(page, 'Bank Name', o.bank, ROUTE);
  if (o.number !== undefined) await fillField(page, 'Account Number', o.number, ROUTE);
  if (o.ifsc !== undefined) await fillField(page, 'IFSC Code', o.ifsc, ROUTE);
  if (o.opening !== undefined) await fillField(page, 'Opening Balance (₹)', o.opening, ROUTE);
  await save(page, /^(add|update) account$/i);
  await awaitSaveAck(page);
}

const FULL = { name: ACC.label, bank: 'HDFC Bank', number: ACC.accountNumber, ifsc: ACC.ifsc };

test.describe('P2D — Structure: Bank Accounts', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  test('TC-P2D-107 Bank Accounts screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Bank Accounts')).toBeVisible();
    await expect(page.getByRole('button', { name: /add (first )?account/i }).first()).toBeVisible();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2D-108 An empty bank account list offers a first-run action', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    test.skip(
      (await countRows('bank_accounts', { hospital_id: hid })) > 0,
      'Bank accounts already exist for this tenant, so the empty state cannot be observed',
    );

    await expect(
      page.getByRole('button', { name: /add first account/i }),
      'Reconciliation is set up once, usually by someone who has never seen the screen. A ' +
      'first-run action is what makes the next step obvious.',
    ).toBeVisible();
  });

  test('TC-P2D-109 A bank account saves with its IFSC code', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, FULL);

    const row = await expectRow<{ ifsc_code: string; bank_name: string }>(
      'bank_accounts', { hospital_id: hid, account_number: ACC.accountNumber },
      'No bank_accounts row after a successful-looking save. A green toast is not a save.',
    );
    expect(
      row.ifsc_code,
      'The IFSC did not persist. Account number and IFSC are what money is actually settled ' +
      'against — without both, collections cannot be matched to the bank statement.',
    ).toBe(ACC.ifsc);
  });

  test('TC-P2D-110 An account cannot be saved without an account name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, { bank: 'HDFC Bank', number: ACC.accountNumber });
    await expectNoRow(
      'bank_accounts', { hospital_id: hid, account_number: ACC.accountNumber },
      'An unnamed account was saved. A hospital runs several — operations, salary, corpus — and ' +
      'unnamed they appear as identical blank options at reconciliation.',
    );
  });

  test('TC-P2D-111 An account cannot be saved without a bank name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, { name: 'QA No Bank', number: '50100999999999' });
    await expectNoRow('bank_accounts', { hospital_id: hid, account_name: 'QA No Bank' });
  });

  test('TC-P2D-112 An account cannot be saved without an account number', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, { name: 'QA No Number', bank: 'HDFC Bank' });
    await expectNoRow(
      'bank_accounts', { hospital_id: hid, account_name: 'QA No Number' },
      'An account with no number cannot be reconciled to anything. It sits in the list looking ' +
      'configured while every settlement against it fails to match.',
    );
  });

  test('TC-P2D-113 A malformed IFSC code is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, { name: 'QA Bad IFSC', bank: 'HDFC Bank', number: '50100888888888', ifsc: BAD_IFSC });

    const { data } = await db().from('bank_accounts')
      .select('ifsc_code').eq('hospital_id', hid).eq('account_name', 'QA Bad IFSC').maybeSingle();

    expect(
      data?.ifsc_code ?? null,
      `IFSC "${BAD_IFSC}" (${BAD_IFSC.length} characters) was stored. An IFSC is exactly 11 ` +
      `characters with a zero fifth character. An invalid one is accepted here and rejected by ` +
      `the bank days later, with no trail back to the typo.`,
    ).not.toBe(BAD_IFSC);
  });

  test('TC-P2D-114 A valid 11-character IFSC with a zero fifth character is accepted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    expect(ACC.ifsc).toMatch(/^[A-Z]{4}0[A-Z0-9]{6}$/);

    await addAccount(page, FULL);
    await expectRow(
      'bank_accounts', { hospital_id: hid, ifsc_code: ACC.ifsc },
      `The valid IFSC "${ACC.ifsc}" was rejected. A rule that refuses real IFSCs is worse than ` +
      `none — the accountant cannot enter the real account and works around the system entirely.`,
    );
  });

  test('TC-P2D-115 The IFSC code is optional', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, { name: 'QA No IFSC', bank: 'HDFC Bank', number: '50100777777777' });

    const row = await expectRow<{ ifsc_code: string | null }>(
      'bank_accounts', { hospital_id: hid, account_name: 'QA No IFSC' },
      'Cash-in-hand and petty accounts have no IFSC. Forcing one makes the accountant invent a ' +
      'value that then fails at transfer time looking like a real account.',
    );
    expect(row.ifsc_code, 'A blank IFSC must store as null, not an empty string').toBeNull();
  });

  test('TC-P2D-116 The opening balance is stored as entered', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, { ...FULL, opening: OPENING });

    const row = await expectRow<{ opening_balance: number }>(
      'bank_accounts', { hospital_id: hid, account_number: ACC.accountNumber },
    );
    expect(
      Number(row.opening_balance),
      'The opening balance is the starting point of every reconciliation. Wrong or dropped, ' +
      'every day closure is out by the same amount and the accountant chases a difference that ' +
      'was never a transaction.',
    ).toBe(OPENING);
  });

  test('TC-P2D-117 A zero opening balance is stored as zero, not as null', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, { name: 'QA Zero Balance', bank: 'HDFC Bank', number: '50100666666666', opening: 0 });

    const row = await expectRow<{ opening_balance: number | null }>(
      'bank_accounts', { hospital_id: hid, account_name: 'QA Zero Balance' },
    );
    expect(
      row.opening_balance,
      'A null opening balance breaks the running-total arithmetic in reconciliation, where a ' +
      'real zero is perfectly valid. The two must not collapse into each other.',
    ).not.toBeNull();
    expect(Number(row.opening_balance)).toBe(0);
  });

  test('TC-P2D-118 The opening balance renders in en-IN grouping with the rupee symbol', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addAccount(page, { ...FULL, opening: OPENING });
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      /₹\s?2,50,000/.test(body),
      'The opening balance is not rendered with Indian digit grouping. ₹250,000 reads as an ' +
      'unfamiliar number to an Indian accountant and invites a misread by a factor of ten. ' +
      `Body contained: ${body.match(/[₹]\s?[\d,]+/g)?.join(', ') ?? 'no currency-looking text'}`,
    ).toBeTruthy();
  });

  test('TC-P2D-119 Editing a bank account persists the change', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, FULL);
    await reloadAndSettle(page);

    const row = page.locator('tr').filter({ hasText: ACC.label }).first();
    await row.locator('button').first().click();
    await page.waitForTimeout(600);
    await fillField(page, 'Bank Name', 'HDFC Bank Ltd', ROUTE);
    await save(page, /update account/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const stored = await expectRow<{ bank_name: string }>(
      'bank_accounts', { hospital_id: hid, account_number: ACC.accountNumber },
    );
    expect(
      stored.bank_name,
      'Bank details change on merger and branch transfer. An edit that toasts success without ' +
      'persisting leaves stale details that fail at the next settlement.',
    ).toBe('HDFC Bank Ltd');
  });

  test('TC-P2D-120 A bank account can be deactivated and reactivated', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, FULL);
    await reloadAndSettle(page);

    const toggle = () => page.locator('tr').filter({ hasText: ACC.label }).first().locator('[role="switch"]');
    test.skip(!(await toggle().count()), 'No active toggle rendered on the account row');

    await toggle().click();
    await page.waitForTimeout(1400);
    let row = await expectRow<{ is_active: boolean }>('bank_accounts', { hospital_id: hid, account_number: ACC.accountNumber });
    expect(row.is_active).toBe(false);

    await toggle().click();
    await page.waitForTimeout(1400);
    row = await expectRow<{ is_active: boolean }>('bank_accounts', { hospital_id: hid, account_number: ACC.accountNumber });
    expect(
      row.is_active,
      'A closed account must stop being offered for new collections while its historical ' +
      'transactions stay attached. Deleting it instead orphans every past reconciliation.',
    ).toBe(true);
  });

  test('TC-P2D-121 A duplicate account number is not created twice', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addAccount(page, FULL);
    await reloadAndSettle(page);
    await addAccount(page, { ...FULL, name: `${ACC.label} 2` });

    expect(
      await countRows('bank_accounts', { hospital_id: hid, account_number: ACC.accountNumber }),
      'Two rows for one real bank account split the reconciliation — half the day\'s collections ' +
      'match one row and half the other, and neither balances against the statement.',
    ).toBe(1);
  });

  test('TC-P2D-122 A saved bank account survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addAccount(page, FULL);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(ACC.label),
      `"${ACC.label}" vanished after a reload. Four screens in this phase showed a green toast ` +
      `and wrote nothing — and it matters most where money is settled.`,
    ).toBeTruthy();
  });

  test("TC-P2D-123 Hospital A's bank accounts are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('bank_accounts', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2D-124 A receptionist cannot reach the Bank Accounts settings screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A receptionist reached /settings/bank-accounts. Reception collects cash but must never ' +
      'see or alter the hospital\'s bank details — exposure here is the first step in a ' +
      'redirected-settlement fraud.',
    ).toBeTruthy();
  });
});
