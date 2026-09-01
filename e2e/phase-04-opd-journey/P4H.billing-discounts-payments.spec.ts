/**
 * Phase 4 · Section H — Billing, discounts & payments (P4-S01, P4-S20 🔴, P4-S21)
 * Locks tracker cases TC-P4H-001 … TC-P4H-028
 *
 * Completing a consultation is what creates the consultation charge — ConsultationWorkspace
 * calls this "the authoritative consultation charge creation point" and guards it three ways:
 * the `opd_encounters.consultation_billed` flag, an existing `item_type = 'consultation'` line
 * on the bill, and a `source_dedupe_key` of `opd_consult:{encounterId}`. TC-P4H-004/005 exist
 * because a consultation billed twice is the most common OPD billing complaint there is.
 *
 * THE DISCOUNT TIER IS DECIDED BY TWO CONDITIONS ANDed, not by a percentage alone:
 *      tier "none" when  amount <= t1_amount AND pct <= t1_pct
 *      tier "t2"   when  amount <= t2_amount AND pct <= t2_pct
 *      tier "t3"   otherwise
 * so these specs read the live thresholds out of `hospital_settings` (`discountRules()`) and
 * compute the percentages to test from them. Hardcoding "15% is below the threshold" would be
 * asserting against MOCK_DATA_BOOK's prose rather than the rules the seeder actually writes —
 * with the seeded t1 of ₹500/5%, a 15% discount is NOT free, it needs a billing executive.
 *
 * The approver roles are FROZEN onto the approval row at creation time (DiscountTab.tsx:169),
 * so a later change to the rules cannot retroactively decide who was allowed to approve a
 * request that is already in flight. TC-P4H-024 locks that.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, recomputeBillTotalsForTest } from '../utils/db-verify';
import { openOpd } from './opd-locators';
import { registerWalkIn, openTokenAndStart, fillComplaint, completeConsultation } from './opd-flows';
import {
  patientIdByUhid, purgeOpdArtefacts, opdBillsToday, lineItems,
  discountRules, discountApprovalsFor, paymentsFor, encountersFor,
} from './opd-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const MONEY = P4.money as Record<string, string | number>;
const DOCTOR = MOCK.doctorFees[0].doctor;
const DEPARTMENT = MOCK.doctorFees[0].department;
const BILLING_ROUTE = '/billing';

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const PARTIAL_UHID = String(MONEY.partialPaymentPatientUhid);
const PARTIAL_NAME = 'Ganesh Pawar';
const DISCOUNT_UHID = String(MONEY.discountPatientUhid);
const DISCOUNT_NAME = 'Mohan Rao';

async function billedConsultation(page: import('@playwright/test').Page, uhid = UHID, name = NAME) {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  await purgeOpdArtefacts(hid, [pid]);
  await registerWalkIn(page, { existingPatientQuery: uhid, department: DEPARTMENT, doctor: DOCTOR });
  await openTokenAndStart(page, name);
  await fillComplaint(page, P4.consultation.chiefComplaint);
  await completeConsultation(page);
  return { hid, pid };
}

async function openBill(page: import('@playwright/test').Page, patientName: string): Promise<boolean> {
  await page.goto(BILLING_ROUTE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const row = page.getByText(patientName).first();
  if (!(await row.count())) return false;
  await row.click();
  await page.waitForTimeout(2200);
  return true;
}

/** Open the Discount tab and submit a percentage with a reason. */
async function submitDiscount(page: import('@playwright/test').Page, percent: number, reason: string): Promise<void> {
  // The Discount control is a Radix TabsTrigger inside BillEditor's TabsList — real ARIA
  // role is "tab", not "button" (BillEditor.tsx:567-572).
  await page.getByRole('tab', { name: /discount/i }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /add discount|apply discount|new discount/i }).first().click().catch(() => { /* form already open */ });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /% ?percent/i }).first().click().catch(() => { /* percent already selected */ });
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/e\.g\. 5$/).first().fill(String(percent));
  await page.getByPlaceholder(/government employee|charity case/i).first().fill(reason);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /apply discount|request approval/i }).first().click();
  await page.waitForTimeout(2800);
}

test.describe('P4H — Billing, discounts & payments', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await openOpd(page);
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    for (const uhid of [UHID, PARTIAL_UHID, DISCOUNT_UHID]) {
      await purgeOpdArtefacts(hid, [await patientIdByUhid(hid, uhid)]);
    }
  });

  /* ── The consultation charge ───────────────────────────────────────── */

  test('TC-P4H-001 Completing a consultation produces a bill with a consultation line', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { hid, pid } = await billedConsultation(page);
    const bills = await opdBillsToday(hid, pid);
    expect(bills.length, 'A completed consultation produced no bill.').toBeGreaterThan(0);
    const items = await lineItems(bills[0].id, 'consultation');
    expect(
      items.length,
      'The bill exists but carries no consultation line. The doctor saw the patient and the ' +
      'hospital charged for nothing.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4H-002 The consultation line is priced at the doctor\'s configured fee', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page);
    const bills = await opdBillsToday(hid, pid);
    const items = await lineItems(bills[0].id, 'consultation');
    expect(
      Number(items[0].total_amount),
      `The consultation line was raised at ₹${items[0].total_amount} instead of ` +
      `₹${MOCK.doctorFees[0].consultation}. A ₹500 default silently replacing the hospital's own ` +
      `rate card is exactly the leak SETTINGS_PREREQ_MATRIX.md warns about.`,
    ).toBe(MOCK.doctorFees[0].consultation);
  });

  test('TC-P4H-003 The encounter is stamped as billed so the charge cannot be raised again', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page);
    const encounters = await encountersFor(hid, pid);
    expect(encounters.length).toBeGreaterThan(0);
    expect(
      encounters[0].consultation_billed,
      'consultation_billed was never stamped. It is the idempotency flag — without it every ' +
      'reopen of the consultation adds another consultation charge.',
    ).toBe(true);
  });

  test('TC-P4H-004 Completing the same consultation twice adds only one consultation line', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page);
    await openOpd(page);
    await page.getByRole('button').filter({ hasText: NAME }).first().click();
    await page.waitForTimeout(2000);
    const { resumeConsultationButton } = await import('./opd-locators');
    if (await resumeConsultationButton(page).count()) {
      await resumeConsultationButton(page).click();
      await page.waitForTimeout(2000);
      await completeConsultation(page);
    }

    const bills = await opdBillsToday(hid, pid);
    const items = await lineItems(bills[0].id, 'consultation');
    expect(
      items.length,
      `The consultation was billed ${items.length} times. A patient charged twice for one ` +
      `consultation is the most common billing complaint an Indian OPD receives, and it is ` +
      `guarded three separate ways precisely because it keeps happening.`,
    ).toBe(1);
  });

  test('TC-P4H-005 Re-completing does not inflate the bill total', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page);
    const before = Number((await opdBillsToday(hid, pid))[0].total_amount);

    await openOpd(page);
    await page.getByRole('button').filter({ hasText: NAME }).first().click();
    await page.waitForTimeout(2000);
    const { resumeConsultationButton } = await import('./opd-locators');
    if (await resumeConsultationButton(page).count()) {
      await resumeConsultationButton(page).click();
      await page.waitForTimeout(2000);
      await completeConsultation(page);
    }

    expect(
      Number((await opdBillsToday(hid, pid))[0].total_amount),
      'The bill total grew when the consultation was reopened and finished again.',
    ).toBe(before);
  });

  test('TC-P4H-006 The bill is linked to the encounter that generated it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page);
    const encounters = await encountersFor(hid, pid);
    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].encounter_id,
      'The bill carries no encounter_id. Nothing connects the money to the clinical episode, so ' +
      'no audit can show what the patient was actually charged for.',
    ).toBe(encounters[0].id);
  });

  test('TC-P4H-007 The bill number is minted by the database, not by the client', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page);
    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_number,
      'The bill has no number. The BEFORE INSERT trigger mints it inside the transaction so a ' +
      'failed insert rolls the counter back instead of leaving a hole in the OPD series — a ' +
      'gap in a bill series is what a GST audit asks about first.',
    ).toBeTruthy();
  });

  test('TC-P4H-008 Two bills raised the same day carry different bill numbers', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const first = await billedConsultation(page);
    const second = await billedConsultation(page, 'PT-QA-0003', 'Anitha Menon');

    const a = await opdBillsToday(first.hid, first.pid);
    const b = await opdBillsToday(second.hid, second.pid);
    expect(a.length && b.length, 'One of the two bills is missing.').toBeTruthy();
    expect(
      a[0].bill_number,
      `Two patients were issued bill number "${a[0].bill_number}". Duplicate invoice numbers ` +
      `invalidate the GST return for the whole month.`,
    ).not.toBe(b[0].bill_number);
    await purgeOpdArtefacts(second.hid, [second.pid]);
  });

  /* ── Payments (P4-S21) ─────────────────────────────────────────────── */

  test('TC-P4H-009 Paying the full fee at the desk marks the bill paid with no balance', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    await purgeOpdArtefacts(hid, [pid]);
    await registerWalkIn(page, { existingPatientQuery: UHID, department: DEPARTMENT, doctor: DOCTOR });

    const bills = await opdBillsToday(hid, pid);
    expect(bills.length).toBeGreaterThan(0);
    expect(
      Number(bills[0].balance_due),
      'The patient paid in full at the desk and the bill still shows a balance. It will chase ' +
      'them through pending collections for money they have already handed over.',
    ).toBe(0);
  });

  test('TC-P4H-010 A cash payment at the desk records the payment mode', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    await purgeOpdArtefacts(hid, [pid]);
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: DEPARTMENT, doctor: DOCTOR, paymentMode: 'Cash',
    });

    const bills = await opdBillsToday(hid, pid);
    const payments = await paymentsFor(bills[0].id);
    expect(payments.length, 'No payment row for a paid consultation.').toBeGreaterThan(0);
    expect(
      String(payments[0].payment_mode ?? payments[0].mode ?? '').toLowerCase(),
      'The payment mode was not recorded. Day-closure reconciliation splits cash from digital ' +
      'collections; an unmoded payment lands in neither.',
    ).toContain('cash');
  });

  test('TC-P4H-011 A UPI payment records the transaction reference', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, UHID);
    await purgeOpdArtefacts(hid, [pid]);
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: DEPARTMENT, doctor: DOCTOR,
      paymentMode: 'UPI', paymentRef: String(MONEY.upiReference),
    });

    const bills = await opdBillsToday(hid, pid);
    const payments = await paymentsFor(bills[0].id);
    expect(payments.length).toBeGreaterThan(0);
    expect(
      JSON.stringify(payments[0]),
      'The UPI transaction reference was not stored. A disputed digital payment cannot be traced ' +
      'back to the gateway without it.',
    ).toContain(String(MONEY.upiReference));
  });

  test('TC-P4H-012 A partly-paid bill keeps the outstanding balance', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, PARTIAL_UHID, PARTIAL_NAME);
    const bills = await opdBillsToday(hid, pid);
    expect(
      bills.length,
      'More than one OPD bill exists for this patient today — the arithmetic below would be ' +
      'reading against the wrong one. purgeOpdArtefacts should have left exactly one.',
    ).toBe(1);

    // The desk takes ₹300 of the fee and lets the patient see the doctor.
    await db().from('bill_payments').insert({
      hospital_id: hid, bill_id: bills[0].id,
      amount: Number(MONEY.partialPaymentAmount), payment_mode: 'cash',
      payment_date: new Date().toISOString().split('T')[0],
    } as never);
    // Nothing in the app recomputes bills.total_amount/balance_due for a service-role-inserted
    // payment (no DB trigger, and the RPC the client fallback tries first does not exist) — see
    // recomputeBillTotalsForTest()'s doc comment for why this can't just import billTotals.ts.
    await recomputeBillTotalsForTest(bills[0].id);

    const after = await opdBillsToday(hid, pid);
    const paid = (await paymentsFor(bills[0].id)).reduce((n, p) => n + Number(p.amount ?? 0), 0);
    expect(
      Number(after[0].total_amount) - paid,
      `₹${paid} was collected against a ₹${after[0].total_amount} bill and the arithmetic does ` +
      `not leave a balance. A part-paid patient treated as settled is money the hospital never ` +
      `chases.`,
    ).toBeGreaterThan(0);
  });

  test('TC-P4H-013 A partly-paid bill is not marked as fully paid', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, PARTIAL_UHID, PARTIAL_NAME);
    const bills = await opdBillsToday(hid, pid);
    expect(bills.length, 'More than one OPD bill exists for this patient today.').toBe(1);

    await db().from('bill_payments').insert({
      hospital_id: hid, bill_id: bills[0].id,
      amount: Number(MONEY.partialPaymentAmount), payment_mode: 'cash',
      payment_date: new Date().toISOString().split('T')[0],
    } as never);
    await recomputeBillTotalsForTest(bills[0].id);

    const after = await opdBillsToday(hid, pid);
    expect(
      after[0].payment_status,
      'A bill with an outstanding balance is flagged as paid. It disappears from pending ' +
      'collections and the shortfall is never recovered.',
    ).not.toBe('paid');
  });

  test('TC-P4H-014 An unpaid OPD bill is visible on the billing screen for follow-up', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await billedConsultation(page, PARTIAL_UHID, PARTIAL_NAME);
    const found = await openBill(page, PARTIAL_NAME);
    expect(
      found,
      'A patient with an open balance does not appear on /billing. Nobody can collect what nobody ' +
      'can see.',
    ).toBeTruthy();
  });

  /* ── Discounts (P4-S20 🔴) ─────────────────────────────────────────── */

  test('TC-P4H-015 The discount approval thresholds are configured for this tenant', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('hospital_settings').select('value')
      .eq('hospital_id', hid).eq('key', 'discount_approval_rules').maybeSingle();
    expect(
      data,
      'No discount_approval_rules row. DiscountTab then falls back to its own built-in defaults ' +
      '(₹500 / 5%), so the hospital\'s actual approval policy is not being enforced at all and ' +
      'nobody is told.',
    ).toBeTruthy();
  });

  test('TC-P4H-016 A discount inside the free tier is applied without approval', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, Math.max(1, rules.t1_pct - 1), String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_status,
      `A discount below the free threshold (${rules.t1_pct}%) was sent for approval. Every small ` +
      `goodwill rounding-off at the counter would then need a manager, and the queue stops.`,
    ).not.toBe('pending_approval');
    expect(Number(bills[0].discount_amount ?? 0)).toBeGreaterThan(0);
  });

  test('TC-P4H-017 A free-tier discount is still written to the approvals log for audit', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, Math.max(1, rules.t1_pct - 1), String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    const approvals = await discountApprovalsFor(bills[0].id);
    expect(
      approvals.length,
      'A discount was applied with no audit row. Discounts that leave no trace are how counter ' +
      'fraud goes unnoticed for months.',
    ).toBeGreaterThan(0);
    expect(approvals[0].status).toBe('approved');
  });

  test('TC-P4H-018 A discount at exactly the free-tier percentage still needs no approval', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, rules.t1_pct, String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_status,
      `Exactly ${rules.t1_pct}% was escalated. The comparison is "pct <= t1_pct", so the ` +
      `threshold value itself is inside the free tier — an off-by-one here sends the most common ` +
      `discount in the hospital to a manager every time.`,
    ).not.toBe('pending_approval');
  });

  test('TC-P4H-019 One point above the free tier requires approval', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, rules.t1_pct + 1, String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_status,
      `${rules.t1_pct + 1}% was applied with no approval. If the threshold does not bite one ` +
      `point above itself, it does not bite at all and any amount can be discounted at the counter.`,
    ).toBe('pending_approval');
  });

  test('TC-P4H-020 An above-threshold discount creates a pending approval request', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, rules.t1_pct + 1, String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    const approvals = await discountApprovalsFor(bills[0].id);
    expect(approvals.length, 'No approval request was raised.').toBeGreaterThan(0);
    expect(approvals[0].status).toBe('pending');
  });

  test('TC-P4H-021 The discount is not applied to the bill while approval is pending', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, rules.t1_pct + 1, String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    expect(
      Number(bills[0].discount_amount ?? 0),
      'The discount was applied to the bill before anyone approved it. The approval step then ' +
      'records a decision that has already been taken.',
    ).toBe(0);
  });

  test('TC-P4H-022 The approval row freezes the roles allowed to approve it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, rules.t1_pct + 1, String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    const approvals = await discountApprovalsFor(bills[0].id);
    expect(approvals.length).toBeGreaterThan(0);
    expect(
      (approvals[0].required_approver_roles as string[])?.length,
      'The approval request records no authorised role set. Anyone could then approve it, which ' +
      'makes the whole threshold decorative.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4H-023 A discount above the second tier escalates to the higher approver set', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, Math.min(99, rules.t2_pct + 5), String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    const approvals = await discountApprovalsFor(bills[0].id);
    expect(approvals.length).toBeGreaterThan(0);
    expect(
      (approvals[0].required_approver_roles as string[]).join(','),
      `A discount above the ${rules.t2_pct}% tier was routed to the lower approver set. The whole ` +
      `point of tiering is that a 50% write-off does not get signed off by the same person as a 10% one.`,
    ).toBe(rules.t3_roles.join(','));
  });

  test('TC-P4H-024 Changing the rules later does not alter an approval already in flight', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, rules.t1_pct + 1, String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    const before = (await discountApprovalsFor(bills[0].id))[0].required_approver_roles as string[];

    const original = JSON.stringify(rules);
    try {
      await db().from('hospital_settings')
        .update({ value: JSON.stringify({ ...rules, t2_roles: ['cfo'] }) } as never)
        .eq('hospital_id', hid).eq('key', 'discount_approval_rules');
      await page.waitForTimeout(1000);

      const after = (await discountApprovalsFor(bills[0].id))[0].required_approver_roles as string[];
      expect(
        after.join(','),
        'Changing the approval rules retroactively changed who may approve a request that was ' +
        'already raised. The roles are frozen onto the row at creation for exactly this reason — ' +
        'otherwise a pending request can be unlocked simply by editing the settings page.',
      ).toBe(before.join(','));
    } finally {
      await db().from('hospital_settings').update({ value: original } as never)
        .eq('hospital_id', hid).eq('key', 'discount_approval_rules');
    }
  });

  test('TC-P4H-025 A discount with no reason is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    // The Discount control is a Radix TabsTrigger inside BillEditor's TabsList — real ARIA
  // role is "tab", not "button" (BillEditor.tsx:567-572).
  await page.getByRole('tab', { name: /discount/i }).first().click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /add discount|apply discount|new discount/i }).first().click().catch(() => { /* already open */ });
    await page.waitForTimeout(800);
    await page.getByPlaceholder(/e\.g\. 5$|e\.g\. 500/).first().fill('10');
    await page.getByRole('button', { name: /apply discount|request approval/i }).first().click();
    await page.waitForTimeout(2000);

    await expect(
      page.getByText(/enter discount amount and reason/i),
      'A discount was accepted with no reason. An unexplained write-off cannot be defended to an ' +
      'auditor or distinguished from a staff member simply pocketing the difference.',
    ).toBeVisible();
  });

  test('TC-P4H-026 A discount larger than the bill is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, 150, String(MONEY.discountReason));
    const bills = await opdBillsToday(hid, pid);
    expect(
      Number(bills[0].total_amount),
      'A discount larger than the bill produced a negative total — the hospital now owes the ' +
      'patient money for a consultation they received.',
    ).toBeGreaterThanOrEqual(0);
  });

  test('TC-P4H-027 A zero discount is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, 0, String(MONEY.discountReason));
    await expect(
      page.getByText(/greater than zero|enter discount/i),
      'A zero-value discount was accepted, filling the approvals log with rows that record nothing.',
    ).toBeVisible();
  });

  test('TC-P4H-028 A bill awaiting discount approval cannot be finalised', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await billedConsultation(page, DISCOUNT_UHID, DISCOUNT_NAME);
    const rules = await discountRules(hid);
    const found = await openBill(page, DISCOUNT_NAME);
    test.skip(!found, 'The bill did not appear on /billing for selection.');

    await submitDiscount(page, rules.t1_pct + 1, String(MONEY.discountReason));
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).first().click().catch(() => { /* correctly hidden while pending */ });
    await page.waitForTimeout(2000);

    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_status,
      'A bill was finalised while its discount was still awaiting approval. The approval is then ' +
      'meaningless — the money has already left.',
    ).toBe('pending_approval');
  });
});

void expectRow;
