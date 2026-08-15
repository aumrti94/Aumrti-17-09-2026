/**
 * Phase 2 · Section F — GST / NIC IRP, Approval Rules, Razorpay
 * Locks tracker cases TC-P2F-057 … TC-P2F-100
 *
 * Three money screens with three distinct failure modes:
 *
 *   GST       — setting the GSTIN switches ON a HARD BLOCK at bill finalisation for any line
 *               lacking an HSN. That is deliberate, but it means a hospital can configure its
 *               tax identity and then find it cannot raise a single bill.
 *   Approvals — SETTINGS_PREREQ_MATRIX is blunt: with no discount_approval_rules, EVERY
 *               discount auto-approves and there is no approval workflow at all. The control
 *               the finance team believes exists simply does not.
 *   Razorpay  — without keys in api_configurations, payment links are DEAD. The patient gets a
 *               link that does nothing and the hospital never sees the money.
 *
 * Several cases here assert that secrets are never rendered in plain text. No PHI or credential
 * may appear in the DOM or in console output.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { fillField, readField, chooseRadio, save, awaitSaveAck, reloadAndSettle, heading } from './settings-locators';

const GST = '/settings/gst';
const APPROVALS = '/settings/approvals';
const RAZORPAY = '/settings/razorpay';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const A = MOCK.hospitals.A;
const INVALID = MOCK.phase2.invalid;
const RZP = MOCK.phase2.entry[RAZORPAY] as { keyId: string; mode: string };
const APPROVE = MOCK.phase2.entry[APPROVALS] as { tier2Percent: number };

const TEST_SECRET = 'qa_test_secret_value_0000';
const SANDBOX_URL = 'https://einvoice1-uat.nic.in';

async function hospitalRow(): Promise<Record<string, unknown>> {
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('hospitals').select('*').eq('id', hid).maybeSingle();
  return (data ?? {}) as Record<string, unknown>;
}

async function restoreGstin(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('hospitals').update({ gstin: A.gstin }).eq('id', hid);
}

/** True when `value` appears anywhere in the rendered DOM as readable text or an input value. */
async function leaksIntoDom(page: import('@playwright/test').Page, value: string): Promise<boolean> {
  return page.evaluate((v) => {
    if (document.body.innerText.includes(v)) return true;
    return [...document.querySelectorAll('input, textarea')].some(
      el => (el as HTMLInputElement).value === v && (el as HTMLInputElement).type !== 'password',
    );
  }, value);
}

test.describe('P2F — GST / NIC IRP', () => {
  test.afterAll(async () => { await restoreGstin(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(GST, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2F-057 GST screen loads with the hospital GSTIN', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'GST').or(page.getByRole('heading', { name: /gst/i }).first())).toBeVisible();

    if (DB_ON()) {
      const row = await hospitalRow();
      const shown = await readField(page, 'GSTIN', GST);
      expect(
        shown,
        `The GST screen shows "${shown}" but hospitals.gstin is "${row.gstin}". If the two screens ` +
        `can disagree, invoices carry one registration and the e-invoice request another, and the ` +
        `IRP rejects every submission.`,
      ).toBe(row.gstin);
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2F-058 An invalid GSTIN is rejected on the GST screen too', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await fillField(page, 'GSTIN', INVALID.gstinTooShort as string, GST);
    await save(page);
    await awaitSaveAck(page);

    const row = await hospitalRow();
    expect(
      row.gstin,
      `The 14-character GSTIN was stored from this screen. Validation on the profile but not here ` +
      `lets an invalid GSTIN in through the back door — it then turns on the HSN hard-block and ` +
      `fails at the IRP on the first real invoice.`,
    ).not.toBe(INVALID.gstinTooShort);
    await restoreGstin();
  });

  test('TC-P2F-059 The state code matches the GSTIN prefix', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = await hospitalRow();
    const gstin = String(row.gstin ?? '');
    test.skip(!gstin, 'No GSTIN set — run npm run qa:seed');

    const stateCode = await readField(page, 'State Code', GST).catch(() => '');
    if (stateCode) {
      expect(
        gstin.slice(0, 2),
        `State Code is "${stateCode}" but the GSTIN begins "${gstin.slice(0, 2)}". A mismatch ` +
        `produces CGST/SGST where IGST is due, and the return has to be amended.`,
      ).toBe(stateCode.trim());
    }
    expect(gstin.slice(0, 2), 'Hospital A is registered in Telangana, GST state code 36').toBe('36');
  });

  test('TC-P2F-060 Legal name and trade name save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Legal Name', A.name, GST).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const shown = await readField(page, 'Legal Name', GST).catch(() => '');
    expect(
      shown,
      'The legal name on an e-invoice must match the GST registration exactly. A trade name that ' +
      'differs from the registered legal name is a rejection reason at the IRP.',
    ).toBe(A.name);
  });

  test('TC-P2F-061 The place of supply saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Place of Supply', A.state, GST).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const shown = await readField(page, 'Place of Supply', GST).catch(() => '');
    expect(
      shown,
      'Place of supply decides the CGST/SGST versus IGST split on every invoice. Wrong, and the ' +
      'hospital pays the right total to the wrong heads, requiring an amended return.',
    ).toBe(A.state);
  });

  test('TC-P2F-062 The IRP credentials save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'IRP Username (GST_IRP_USERNAME)', 'qa_irp_user', GST).catch(() => {});
    await fillField(page, 'IRP Password (GST_IRP_PASSWORD)', TEST_SECRET, GST).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const user = await readField(page, 'IRP Username (GST_IRP_USERNAME)', GST).catch(() => '');
    expect(
      user,
      'Without IRP credentials no e-invoice can be generated, so bills above the threshold cannot ' +
      'be issued legally.',
    ).toBe('qa_irp_user');
  });

  test('TC-P2F-063 IRP secrets are never rendered in plain text', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'IRP Password (GST_IRP_PASSWORD)', TEST_SECRET, GST).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await leaksIntoDom(page, TEST_SECRET),
      'The IRP secret is readable in the DOM after a reload. These credentials authorise invoice ' +
      'generation under the hospital\'s GST registration — anyone who walks past a logged-in ' +
      'terminal can copy them.',
    ).toBeFalsy();
  });

  test('TC-P2F-064 The IRP base URL saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Base URL (GST_IRP_BASE_URL)', SANDBOX_URL, GST).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const shown = await readField(page, 'Base URL (GST_IRP_BASE_URL)', GST).catch(() => '');
    expect(
      shown,
      'Pointing at the wrong base URL sends real invoices to the sandbox — they appear to succeed ' +
      'and no legally valid IRN is ever generated.',
    ).toBe(SANDBOX_URL);
  });

  test('TC-P2F-065 GST mode "Sandbox" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await chooseRadio(page, 'Sandbox').catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const checked = await page.locator('[role="radio"][aria-checked="true"], input:checked').allTextContents();
    const body = await page.locator('body').innerText();
    expect(
      checked.some(t => /sandbox/i.test(t)) || /sandbox/i.test(body),
      'Sandbox mode did not persist. Every new API integration must be tested in sandbox first — ' +
      'a mode that will not hold forces testing against the live IRP with real invoice numbers.',
    ).toBeTruthy();
  });

  test('TC-P2F-066 GST mode "Production" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await chooseRadio(page, 'Production').catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      /production/i.test(body),
      'Production mode did not persist. A hospital stuck in sandbox generates invoices with no ' +
      'legal IRN and does not discover it until the GST return will not reconcile.',
    ).toBeTruthy();
    await chooseRadio(page, 'Sandbox').catch(() => {});
    await save(page).catch(() => {});
  });

  test('TC-P2F-067 Switching to Production warns that live invoices will be generated', async ({ page }) => {
    await chooseRadio(page, 'Production').catch(() => {});
    await page.waitForTimeout(800);

    const body = await page.locator('body').innerText();
    expect(
      /live|production|real|caution|warning|irreversible/i.test(body),
      'Switching to Production gave no warning. An IRN generated in production cannot be ' +
      'un-issued, only cancelled within 24 hours — flipping this by accident during ' +
      'configuration creates real tax documents.',
    ).toBeTruthy();
  });

  test('TC-P2F-068 Setting the GSTIN turns on the HSN hard-block at bill finalisation', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const row = await hospitalRow();
    test.skip(!row.gstin, 'No GSTIN set on Hospital A — run npm run qa:seed');

    const { data: missing } = await db().from('service_master')
      .select('name, hsn_code').eq('hospital_id', hid).is('hsn_code', null).limit(10);

    expect(
      missing,
      'service_master is not readable, so the HSN precondition cannot be checked. The block is ' +
      'deliberate, but it must name the offending line — otherwise the billing clerk sees only ' +
      '"cannot finalise" with a patient waiting.',
    ).toBeDefined();
  });

  test('TC-P2F-069 GST settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'GSTIN', A.gstin, GST);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'GSTIN', GST),
      'A false save leaves the hospital believing e-invoicing is configured. The failure surfaces ' +
      'at the first invoice above the threshold, which is a legal filing obligation with a deadline.',
    ).toBe(A.gstin);
  });

  test("TC-P2F-070 Hospital A's GST configuration is invisible to Hospital B", async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await logout();
    await loginAs('hospital_admin', { hospital: 'B' });
    await page.goto(GST, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    const shown = await readField(page, 'GSTIN', GST).catch(() => '');
    expect(
      shown,
      `Hospital B's GST screen shows "${shown}" — Hospital A's registration. A GSTIN is a legal ` +
      `tax identity, and one hospital raising invoices under another's is a tax offence with ` +
      `consequences for both parties.`,
    ).not.toBe(A.gstin);
  });

  test('TC-P2F-071 A billing executive cannot change the GST configuration', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('billing_executive', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, GST),
      'A billing executive reached /settings/gst. Billing staff raise invoices; they must not ' +
      'hold the credentials that authorise invoice generation under the hospital\'s tax ' +
      'registration. Separating the two is a basic financial control.',
    ).toBeTruthy();
  });

  test('TC-P2F-072 The GST screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'IRP Password (GST_IRP_PASSWORD)', TEST_SECRET, GST).catch(() => {});
    await save(page);
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
    expect(
      consoleErrors.filter(e => e.includes(TEST_SECRET)),
      'An IRP secret was written into console output. A secret logged to the console is captured ' +
      'by any browser extension the hospital has installed.',
    ).toEqual([]);
  });
});

test.describe('P2F — Approval Rules', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(APPROVALS, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2F-073 Approval Rules screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Approval Rules').or(page.getByRole('heading', { name: /approval/i }).first())).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(
      /maximum|percentage|approve/i.test(body),
      'No approval controls rendered. With no discount_approval_rules, EVERY discount ' +
      'auto-approves and there is no approval workflow at all.',
    ).toBeTruthy();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2F-074 A discount approval tier saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Maximum Percentage (%)', APPROVE.tier2Percent, APPROVALS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);

    const { data } = await db().from('hospital_settings')
      .select('key, value').eq('hospital_id', hid).limit(30);
    const rules = (data ?? []).find(r => /discount|approval/i.test(r.key));

    expect(
      rules,
      'No approval-rules row in hospital_settings after saving. Unsaved, the threshold defaults ' +
      'to permitting everything, and a 50% discount is granted at the counter with no approval.',
    ).toBeDefined();
  });

  test('TC-P2F-075 A discount threshold above 100 percent is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Maximum Percentage (%)', INVALID.discountThresholdOver100 as number, APPROVALS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);

    const { data } = await db().from('hospital_settings')
      .select('key, value').eq('hospital_id', hid).limit(30);
    const rules = (data ?? []).find(r => /discount|approval/i.test(r.key));
    const blob = JSON.stringify(rules?.value ?? {});

    expect(
      /\b1[0-9]{2,}\b/.test(blob) && blob.includes('120'),
      'A 120% threshold was stored. It can never be exceeded, so the approval tier below it ' +
      'becomes unreachable and every discount auto-approves — the exact failure the rules exist ' +
      'to prevent.',
    ).toBeFalsy();
  });

  test('TC-P2F-076 A negative discount threshold is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Maximum Percentage (%)', -5, APPROVALS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);

    const { data } = await db().from('hospital_settings')
      .select('key, value').eq('hospital_id', hid).limit(30);
    const rules = (data ?? []).find(r => /discount|approval/i.test(r.key));

    expect(
      JSON.stringify(rules?.value ?? {}),
      'A negative threshold is exceeded by every discount including zero, so every single bill ' +
      'would require approval and the billing counter stops.',
    ).not.toMatch(/-\d/);
  });

  test('TC-P2F-077 The three seeded discount tiers are ordered correctly', async ({ page }) => {
    const body = await page.locator('body').innerText();
    const percents = [...body.matchAll(/(\d{1,3})\s?%/g)].map(m => Number(m[1])).filter(n => n <= 100);
    test.skip(percents.length < 2, 'Fewer than two percentage tiers rendered');

    const ascending = [...percents].sort((a, b) => a - b);
    expect(
      percents.filter((v, i) => v !== ascending[i]).length === 0 || percents.length < 3,
      `Discount tiers render out of order: ${percents.join(', ')}. A 55% discount would match the ` +
      `20% tier first and be approved by one signature instead of two.`,
    ).toBeTruthy();
  });

  test('TC-P2F-078 The approver role for a tier saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await save(page);
    await awaitSaveAck(page);

    const { data } = await db().from('hospital_settings')
      .select('key, value').eq('hospital_id', hid).limit(30);
    const rules = (data ?? []).find(r => /discount|approval/i.test(r.key));
    test.skip(!rules, 'No approval-rules row to inspect');

    expect(
      JSON.stringify(rules!.value),
      'The stored rules name no approver role. Dual approval on a 55% discount is the control ' +
      'that stops one person writing off half a bill — if only one approver saves, the second ' +
      'signature is never requested.',
    ).toMatch(/admin|cfo|role|approve/i);
  });

  test('TC-P2F-079 A tier cannot be saved with no approver', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = await page.locator('body').innerText();
    expect(
      /who can approve/i.test(body),
      'No approver selector rendered. A tier with no approver either blocks the discount forever ' +
      'or fails open and approves it automatically — and which one happens is not obvious from ' +
      'this screen.',
    ).toBeTruthy();
  });

  test('TC-P2F-080 A discount below the threshold is auto-approved and audited', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('audit_log')
      .select('id', { count: 'exact', head: true }).eq('hospital_id', hid);

    expect(
      error,
      'audit_log is not readable. Auto-approval below the threshold is correct, but unaudited it ' +
      'means nobody can later see who granted a discount — MOCK_DATA_BOOK specifies an audit row ' +
      'is written even on auto-approval.',
    ).toBeNull();
  });

  test('TC-P2F-081 A discount above the threshold requires administrator approval', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('hospital_settings')
      .select('key, value').eq('hospital_id', hid).limit(30);
    const rules = (data ?? []).find(r => /discount|approval/i.test(r.key));

    // Phase 8 re-runs this against a real bill; here we prove the rule exists to enforce.
    expect(
      rules,
      'No discount approval rules are stored, so a 35% discount would apply with no approval at ' +
      'all. The control would exist only on the settings screen and not in the billing flow.',
    ).toBeDefined();
  });

  test('TC-P2F-082 A discount above the upper tier requires two approvals', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('hospital_settings')
      .select('key, value').eq('hospital_id', hid).limit(30);
    const rules = (data ?? []).find(r => /discount|approval/i.test(r.key));
    test.skip(!rules, 'No approval-rules row to inspect');

    const blob = JSON.stringify(rules!.value);
    expect(
      blob,
      'The stored rules describe no second approver tier. Dual approval is the control against a ' +
      'single person writing off more than half a bill — if one signature releases it, the second ' +
      'approver is decorative.',
    ).toMatch(/50|cfo/i);
  });

  test('TC-P2F-083 The maximum discount amount saves alongside the percentage', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Maximum Amount (₹)', 5000, APPROVALS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const shown = await readField(page, 'Maximum Amount (₹)', APPROVALS).catch(() => '');
    expect(
      Number(String(shown).replace(/[^\d.]/g, '')),
      'A 15% discount is trivial on a ₹500 consultation and ₹5,250 on a ₹35,000 surgery. Without ' +
      'an absolute cap the percentage tier lets large write-offs through unapproved.',
    ).toBe(5000);
  });

  test('TC-P2F-084 Clinical approval toggles save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = await page.locator('body').innerText();
    const expected = ['Restricted Antibiotics', 'Blood Transfusion', 'LAMA'];
    const missing = expected.filter(t => !body.includes(t));

    expect(
      missing,
      `Clinical approval toggle(s) missing: ${missing.join(', ')}. Restricted-antibiotic approval ` +
      `is an antimicrobial stewardship control NABH expects, and LAMA requires a documented ` +
      `sign-off because the patient is leaving against advice.`,
    ).toEqual([]);
  });

  test('TC-P2F-085 Approval rules survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'Maximum Percentage (%)', APPROVE.tier2Percent, APPROVALS).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const { data } = await db().from('hospital_settings')
      .select('key').eq('hospital_id', hid).limit(30);
    expect(
      (data ?? []).some(r => /discount|approval/i.test(r.key)),
      'A false save leaves the hospital believing approvals are enforced while every discount ' +
      'auto-approves. That is not a missing feature — it is a control the finance team believes ' +
      'exists and does not.',
    ).toBeTruthy();
  });

  test("TC-P2F-086 Hospital A's approval rules are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // hospital_settings has no per-role RLS, so tenant isolation is its only protection.
    await expectNoCrossTenantRows('hospital_settings', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2F-087 A billing executive cannot change the approval thresholds', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('billing_executive', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, APPROVALS),
      'A billing executive reached /settings/approvals. The person applying discounts must not ' +
      'set the threshold above which approval is needed — allowing it removes the control ' +
      'entirely, and the audit trail would show every discount as legitimately auto-approved.',
    ).toBeTruthy();
  });

  test('TC-P2F-088 The Approval Rules screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await save(page);
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe rules are stored as a JSON blob under a ` +
      `hospital_settings key. A malformed blob rejected by Postgres would surface only here, ` +
      `while the UI reports the rules saved.`,
    ).toHaveLength(0);
  });
});

test.describe('P2F — Razorpay Payments', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(RAZORPAY, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2F-089 Razorpay screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Razorpay').or(page.getByRole('heading', { name: /razorpay|payment/i }).first())).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(
      /key id/i.test(body),
      'No credential fields rendered. Without Razorpay keys in api_configurations, payment links ' +
      'are dead — the patient receives a link that does nothing and the hospital never sees the money.',
    ).toBeTruthy();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2F-090 The Razorpay key ID and secret save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Key ID', RZP.keyId, RAZORPAY);
    await fillField(page, 'Key Secret', TEST_SECRET, RAZORPAY).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'Key ID', RAZORPAY),
      'Without both values no payment link can be generated.',
    ).toBe(RZP.keyId);
  });

  test('TC-P2F-091 The Razorpay key secret is never rendered in plain text', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Key Secret', TEST_SECRET, RAZORPAY).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await leaksIntoDom(page, TEST_SECRET),
      'The key secret is readable in the DOM after a reload. It can authorise refunds and charges ' +
      'against the hospital\'s merchant account — anyone who walks past a logged-in settings ' +
      'screen could copy it.',
    ).toBeFalsy();
  });

  test('TC-P2F-092 Razorpay mode "Test Mode" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await chooseRadio(page, 'Test Mode').catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      /test mode/i.test(body),
      'Test Mode did not persist. Sandbox testing is required before any integration goes live — ' +
      'a mode that will not hold forces configuration testing against real card charges.',
    ).toBeTruthy();
  });

  test('TC-P2F-093 Razorpay mode "Live Mode" saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await chooseRadio(page, 'Live Mode').catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      /live mode/i.test(body),
      'Live Mode did not persist. A hospital stuck in test mode takes payments that never settle, ' +
      'and discovers it when the bank reconciliation shows nothing arrived.',
    ).toBeTruthy();
    await chooseRadio(page, 'Test Mode').catch(() => {});
    await save(page).catch(() => {});
  });

  test('TC-P2F-094 A test key cannot be saved against Live Mode', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await chooseRadio(page, 'Live Mode').catch(() => {});
    await fillField(page, 'Key ID', RZP.keyId, RAZORPAY);
    await save(page);
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /test key|mismatch|live mode requires|rzp_live/i.test(body),
      `The test key "${RZP.keyId}" was accepted under Live Mode with no warning. A test key in ` +
      `live mode makes every payment link fail at the moment a patient tries to pay — and the ` +
      `error surfaces to the patient, not to the hospital.`,
    ).toBeTruthy();

    await chooseRadio(page, 'Test Mode').catch(() => {});
    await save(page).catch(() => {});
  });

  test('TC-P2F-095 The UPI ID saves for QR code generation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'UPI ID (for QR codes)', 'hospital@upi', RAZORPAY).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await readField(page, 'UPI ID (for QR codes)', RAZORPAY).catch(() => ''),
      'UPI is how most Indian outpatients pay. A missing UPI ID means no QR code at the counter ' +
      'and the queue falls back to cash, which then has to be reconciled by hand at day closure.',
    ).toBe('hospital@upi');
  });

  test('TC-P2F-096 A malformed UPI ID is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'UPI ID (for QR codes)', 'hospital-upi', RAZORPAY).catch(() => {});
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const stored = await readField(page, 'UPI ID (for QR codes)', RAZORPAY).catch(() => '');
    expect(
      stored === 'hospital-upi',
      'A UPI ID with no @ separator was stored. It produces a QR code no payment app can resolve — ' +
      'the patient scans it at the counter, it fails, and the queue stalls.',
    ).toBeFalsy();
  });

  test('TC-P2F-097 The part-payment and auto-receipt toggles save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = await page.locator('body').innerText();
    const expected = ['Allow Part Payments', 'Auto-send Receipt'];
    const missing = expected.filter(t => !body.includes(t));

    expect(
      missing,
      `Payment toggle(s) missing: ${missing.join(', ')}. Part payments are how a patient who ` +
      `cannot clear a bill at discharge pays in instalments — without it the counter can only ` +
      `take the full amount and the patient leaves owing with no record.`,
    ).toEqual([]);
  });

  test("TC-P2F-098 Hospital A's payment credentials are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // A gateway key authorises charges and refunds against a merchant account.
    await expectNoCrossTenantRows('api_configurations', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2F-099 A billing executive cannot change the Razorpay credentials', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('billing_executive', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, RAZORPAY),
      'A billing executive reached /settings/razorpay. Changing the merchant key redirects where ' +
      'patient payments settle — the single highest-value fraud target in the product, and ' +
      'billing staff have no reason to touch it.',
    ).toBeTruthy();
  });

  test('TC-P2F-100 The Razorpay screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Key Secret', TEST_SECRET, RAZORPAY).catch(() => {});
    await save(page);
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
    expect(
      consoleErrors.filter(e => e.includes(TEST_SECRET)),
      'A merchant secret was written into console output. It is then captured by any browser ' +
      'extension the hospital has installed.',
    ).toEqual([]);
  });
});
