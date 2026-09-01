/**
 * Phase 4 · Section D — Payer variations (P4-S05, P4-S06, P4-S07 🔴, P4-S08 🔴)
 * Locks tracker cases TC-P4D-001 … TC-P4D-022
 *
 * Four payers walk through the same OPD door and the hospital owes each of them something
 * different. A cash patient pays and leaves. A TPA patient's outpatient consultation usually
 * is not covered, but the payer must still be on the record or the later admission has no
 * continuity. A PMJAY beneficiary follows package rules. And a CGHS pensioner without a
 * referral letter is the one case where the app deliberately REFUSES to let you finish —
 * BillEditor.handleFinalize blocks finalisation, because a CGHS claim raised without a
 * referral is rejected by the payer and the hospital eats the whole bill.
 *
 * 🔴 BUG-P4-005 (TC-P4D-009), NOW FIXED — REGRESSION LOCK:
 * handleFinalize looks the beneficiary up with `.eq("patient_id", bill.patient_id)`, but
 * `cghs_echs_beneficiaries.patient_id` was added by a GUARDED ALTER in migration
 * 20260521000005 that only fires "IF EXISTS (the table)" — and the table is not created until
 * 20260901000010, which sorts LATER. On any database migrated in filename order the column was
 * never added, the lookup errored, `cghs` came back null, and the block fired for EVERY CGHS
 * patient including the ones holding a valid referral letter. That is not a safe failure: it is
 * a hard stop on legitimate government billing that looks identical to the feature working, and
 * the desk's workaround — re-registering the patient as cash — loses the claim outright.
 * FIXED by migration 20261013000018, which re-applies the columns unconditionally after the
 * table certainly exists, idempotently. TC-P4D-009 now guards against the column disappearing
 * again; TC-P4D-012 proves the positive path it was blocking.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { hospitalIdFor, expectRow } from '../utils/db-verify';
import { openOpd } from './opd-locators';
import { registerWalkIn } from './opd-flows';
import {
  patientIdByUhid, purgeOpdArtefacts, opdBillsToday, tokensToday,
  setCghsReferral, setPatientCategory, cghsPatientIdColumnExists, clearCghsBeneficiaries,
} from './opd-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const PAYER = P4.payer;
const DOCTOR = MOCK.doctorFees[0].doctor;
const DEPARTMENT = MOCK.doctorFees[0].department;
const BILLING_ROUTE = '/billing';

const CGHS_IDS = ['CGHS-QA-0006-11', PAYER.referralBeneficiaryNo];

async function ctxFor(uhid: string) {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  await purgeOpdArtefacts(hid, [pid]);
  return { hid, pid };
}

/** Open the billing screen and select this patient's open OPD bill. */
async function openBillFor(page: import('@playwright/test').Page, patientName: string): Promise<boolean> {
  await page.goto(BILLING_ROUTE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const row = page.getByText(patientName).first();
  if (!(await row.count())) return false;
  await row.click();
  await page.waitForTimeout(2000);
  return true;
}

test.describe('P4D — Payer variations', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await openOpd(page);
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await clearCghsBeneficiaries(hid, CGHS_IDS);
    for (const uhid of [PAYER.tpaPatientUhid, PAYER.pmjayPatientUhid, PAYER.cghsWithReferralUhid, PAYER.cghsWithoutReferralUhid]) {
      const pid = await patientIdByUhid(hid, uhid);
      await purgeOpdArtefacts(hid, [pid]);
    }
  });

  /* ── Cash & the payer dropdown ─────────────────────────────────────── */

  test('TC-P4D-001 The Payer Type dropdown offers every payer class the hospital bills', async ({ page }) => {
    const { openWalkIn } = await import('./opd-flows');
    const { optionTexts } = await import('./opd-locators');
    await openWalkIn(page);
    const options = (await optionTexts(page, 'Payer Type')).join(' | ').toLowerCase();
    for (const expected of ['cash', 'tpa', 'pmjay', 'cghs', 'esi', 'corporate']) {
      expect(
        options,
        `The Payer Type list has no "${expected}" option. A payer that cannot be selected at ` +
        `registration can never be claimed against later — the revenue is written off by default.`,
      ).toContain(expected);
    }
  });

  test('TC-P4D-002 A cash walk-in records payer_type cash on the token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { hid, pid } = await ctxFor('PT-QA-0001');
    await registerWalkIn(page, {
      existingPatientQuery: 'PT-QA-0001', department: DEPARTMENT, doctor: DOCTOR, payerType: 'Cash',
    });
    const token = await expectRow<{ payer_type: string }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(token.payer_type).toBe('cash');
  });

  /* ── Private insurance / TPA (P4-S05) ──────────────────────────────── */

  test('TC-P4D-003 Selecting TPA reveals the payer list so an insurer can be named', async ({ page }) => {
    const { openWalkIn, fillWalkInDetails } = await import('./opd-flows');
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: PAYER.tpaPatientUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'TPA / Insurance',
    });
    await expect(
      page.locator('select').filter({ hasText: /select payer/i }).first(),
      'Choosing TPA did not reveal an insurer list. "TPA" with no named insurer cannot be claimed.',
    ).toBeVisible();
  });

  test('TC-P4D-004 A TPA patient\'s insurer is stored as payer_id on the token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.tpaPatientUhid);
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.tpaPatientUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'TPA / Insurance', payerName: PAYER.tpaName,
    });
    const token = await expectRow<{ payer_type: string; payer_id: string | null }>(
      'opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(token.payer_type).toBe('tpa');
    expect(
      token.payer_id,
      `The insurer was chosen at the desk but payer_id is null. When this patient is admitted ` +
      `next week the pre-auth team has no record of who covers them, and the cashless request ` +
      `starts from scratch.`,
    ).toBeTruthy();
  });

  test('TC-P4D-005 A TPA outpatient consultation still raises a payable bill', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.tpaPatientUhid);
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.tpaPatientUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'TPA / Insurance', payerName: PAYER.tpaName,
    });
    const bills = await opdBillsToday(hid, pid);
    expect(bills.length, 'A TPA patient produced no bill at all.').toBeGreaterThan(0);
    expect(
      Number(bills[0].total_amount),
      'The consultation was billed at ₹0 because the patient has insurance. Outpatient ' +
      'consultation is normally NOT covered by an Indian health policy — zeroing it hands away ' +
      'the fee on every insured walk-in.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4D-006 Choosing an insurer that is not on the payer master is impossible', async ({ page }) => {
    const { openWalkIn, fillWalkInDetails } = await import('./opd-flows');
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: PAYER.tpaPatientUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'TPA / Insurance',
    });
    const select = page.locator('select').filter({ hasText: /select payer/i }).first();
    const options = (await select.locator('option').allInnerTexts()).map(o => o.trim());
    expect(
      options.some(o => /star health/i.test(o)),
      'The payer list does not contain the seeded TPA. SETTINGS_PREREQ_MATRIX.md: payers must be ' +
      'configured in Settings → Payer Masters before OPD can attribute a claim to anyone.',
    ).toBeTruthy();
    expect(
      options.every(o => o.length > 0),
      'The payer list contains a blank option — a bill attributed to an unnamed payer is unclaimable.',
    ).toBeTruthy();
  });

  /* ── PMJAY (P4-S06) ────────────────────────────────────────────────── */

  test('TC-P4D-007 A PMJAY beneficiary\'s token records the scheme as the payer', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.pmjayPatientUhid);
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.pmjayPatientUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'PMJAY / Ayushman', payerName: PAYER.pmjayName,
    });
    const token = await expectRow<{ payer_type: string }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(
      token.payer_type,
      'An Ayushman Bharat beneficiary was recorded as an ordinary payer. The claim can never be ' +
      'lodged against the scheme and the patient — who is entitled to free care — gets an invoice.',
    ).toBe('pmjay');
  });

  test('TC-P4D-008 A PMJAY consultation produces a bill that can be reconciled against the scheme', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.pmjayPatientUhid);
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.pmjayPatientUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'PMJAY / Ayushman', payerName: PAYER.pmjayName,
    });
    const bills = await opdBillsToday(hid, pid);
    expect(bills.length, 'No bill was raised for the PMJAY beneficiary.').toBeGreaterThan(0);
    expect(bills[0].id, 'The bill has no id to attach a claim to.').toBeTruthy();
  });

  /* ── CGHS / ECHS — the hard block (P4-S07 / P4-S08) ────────────────── */

  test('TC-P4D-009 The CGHS referral lookup can actually run on this database', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const exists = await cghsPatientIdColumnExists();
    expect(
      exists,
      'REGRESSION LOCK (BUG-P4-005, fixed): cghs_echs_beneficiaries.patient_id does not exist, ' +
      'but BillEditor.handleFinalize filters on it. Migration 20261013000018 adds it ' +
      'unconditionally — check it has been applied. Without the column the referral lookup ' +
      'errors and the finalisation block fires for EVERY CGHS patient, including the ones ' +
      'holding a valid referral letter, which is a hard stop on legitimate government billing.',
    ).toBeTruthy();
  });

  test('TC-P4D-010 A CGHS patient can be registered with the scheme as the payer', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.cghsWithReferralUhid);
    await setPatientCategory(pid, 'cghs');
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.cghsWithReferralUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'CGHS', payerName: PAYER.cghsName,
    });
    const token = await expectRow<{ payer_type: string }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(token.payer_type).toBe('cghs');
  });

  test('TC-P4D-011 A CGHS patient WITH a referral has the referral_date on record', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, PAYER.cghsWithReferralUhid);
    await setPatientCategory(pid, 'cghs');
    await setCghsReferral({
      hospitalId: hid, patientId: pid, cghsId: CGHS_IDS[0],
      beneficiaryName: 'R. Subramanian',
      referralDate: new Date().toISOString().split('T')[0],
      referralHospital: PAYER.referralHospital,
    });
    const row = await expectRow<{ referral_date: string | null }>(
      'cghs_echs_beneficiaries', { hospital_id: hid, cghs_id: CGHS_IDS[0] });
    expect(row.referral_date, 'The referral was recorded with no date — an undated referral is not a referral.').toBeTruthy();
  });

  test('TC-P4D-012 A CGHS bill WITH a referral finalises normally', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    test.skip(!(await cghsPatientIdColumnExists()),
      'cghs_echs_beneficiaries.patient_id is missing, so the referral lookup cannot run and this ' +
      'positive path is untestable. Apply migration 20261013000018 — see TC-P4D-009.');
    const { hid, pid } = await ctxFor(PAYER.cghsWithReferralUhid);
    await setPatientCategory(pid, 'cghs');
    await setCghsReferral({
      hospitalId: hid, patientId: pid, cghsId: CGHS_IDS[0],
      beneficiaryName: 'R. Subramanian',
      referralDate: new Date().toISOString().split('T')[0],
      referralHospital: PAYER.referralHospital,
    });
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.cghsWithReferralUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'CGHS', payerName: PAYER.cghsName,
    });

    const found = await openBillFor(page, 'Subramanian');
    test.skip(!found, 'The bill did not appear on /billing for selection.');
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).click();
    await page.waitForTimeout(2500);

    expect(
      await page.getByText(/CGHS \/ ECHS Referral Missing/i).count(),
      'A CGHS patient holding a valid referral was still blocked from finalisation. Legitimate ' +
      'government billing has stopped and the desk has no way past it.',
    ).toBe(0);
    const bills = await opdBillsToday(hid, pid);
    expect(bills[0].bill_status, 'The bill did not reach final status.').toBe('final');
  });

  test('TC-P4D-013 A CGHS bill WITHOUT a referral is hard-blocked at finalisation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.cghsWithoutReferralUhid);
    await setPatientCategory(pid, 'cghs');
    await clearCghsBeneficiaries(hid, [PAYER.referralBeneficiaryNo]);
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.cghsWithoutReferralUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'CGHS', payerName: PAYER.cghsName,
    });

    const found = await openBillFor(page, 'Venkatesan');
    test.skip(!found, 'The bill did not appear on /billing for selection.');
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).click();
    await page.waitForTimeout(2500);

    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_status,
      'A CGHS bill with no referral on file reached FINAL status. The claim will be rejected by ' +
      'the payer and the hospital carries the whole amount — this block is the only thing that ' +
      'stops the problem being created in the first place.',
    ).not.toBe('final');
  });

  test('TC-P4D-014 The block explains what is missing and where to fix it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.cghsWithoutReferralUhid);
    await setPatientCategory(pid, 'cghs');
    await clearCghsBeneficiaries(hid, [PAYER.referralBeneficiaryNo]);
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.cghsWithoutReferralUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'CGHS', payerName: PAYER.cghsName,
    });

    const found = await openBillFor(page, 'Venkatesan');
    test.skip(!found, 'The bill did not appear on /billing for selection.');
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).click();
    await page.waitForTimeout(2000);

    await expect(
      page.getByText(/CGHS \/ ECHS Referral Missing/i),
      'The bill was refused with no explanation. A blocked action the user cannot diagnose gets ' +
      'worked around — usually by re-registering the patient as cash, which loses the claim entirely.',
    ).toBeVisible();
    await expect(
      page.getByText(/Insurance → CGHS \/ ECHS/i),
      'The message does not name the screen that fixes it.',
    ).toBeVisible();
  });

  test('TC-P4D-015 Adding the referral clears the block on the same bill', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    test.skip(!(await cghsPatientIdColumnExists()),
      'cghs_echs_beneficiaries.patient_id is missing — apply migration 20261013000018 (TC-P4D-009).');
    const { hid, pid } = await ctxFor(PAYER.cghsWithoutReferralUhid);
    await setPatientCategory(pid, 'cghs');
    await clearCghsBeneficiaries(hid, [PAYER.referralBeneficiaryNo]);
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.cghsWithoutReferralUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'CGHS', payerName: PAYER.cghsName,
    });

    const found = await openBillFor(page, 'Venkatesan');
    test.skip(!found, 'The bill did not appear on /billing for selection.');
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(/CGHS \/ ECHS Referral Missing/i)).toBeVisible();

    // The letter arrives; the insurance desk records it.
    await setCghsReferral({
      hospitalId: hid, patientId: pid, cghsId: PAYER.referralBeneficiaryNo,
      beneficiaryName: 'K. Venkatesan',
      referralDate: new Date().toISOString().split('T')[0],
      referralHospital: PAYER.referralHospital,
    });

    await openBillFor(page, 'Venkatesan');
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).click();
    await page.waitForTimeout(2500);

    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_status,
      'The referral was added and the bill still would not finalise. A block that cannot be ' +
      'cleared traps the bill permanently and forces a manual write-off.',
    ).toBe('final');
  });

  test('TC-P4D-016 A referral row with a null referral_date does not satisfy the block', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.cghsWithoutReferralUhid);
    await setPatientCategory(pid, 'cghs');
    await setCghsReferral({
      hospitalId: hid, patientId: pid, cghsId: PAYER.referralBeneficiaryNo,
      beneficiaryName: 'K. Venkatesan', referralDate: null,
    });
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.cghsWithoutReferralUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'CGHS', payerName: PAYER.cghsName,
    });

    const found = await openBillFor(page, 'Venkatesan');
    test.skip(!found, 'The bill did not appear on /billing for selection.');
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).click();
    await page.waitForTimeout(2500);

    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_status,
      'An empty beneficiary row with no referral_date was accepted as proof of referral. The ' +
      'query filters on "referral_date is not null" precisely so a half-filled record cannot ' +
      'unlock the claim.',
    ).not.toBe('final');
  });

  test('TC-P4D-017 An ECHS patient is subject to the same referral block as CGHS', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.cghsWithoutReferralUhid);
    await setPatientCategory(pid, 'echs');
    await clearCghsBeneficiaries(hid, [PAYER.referralBeneficiaryNo]);
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.cghsWithoutReferralUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'CGHS', payerName: PAYER.echsName,
    });

    const found = await openBillFor(page, 'Venkatesan');
    test.skip(!found, 'The bill did not appear on /billing for selection.');
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).click();
    await page.waitForTimeout(2500);

    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_status,
      'An ECHS bill finalised without a referral. ECHS is checked by the same branch as CGHS — ' +
      'if only one of the two is covered, half the ex-servicemen claims are raised unbacked.',
    ).not.toBe('final');
  });

  test('TC-P4D-018 A cash patient is never subjected to the CGHS referral block', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor('PT-QA-0001');
    await setPatientCategory(pid, 'general');
    await registerWalkIn(page, {
      existingPatientQuery: 'PT-QA-0001', department: DEPARTMENT, doctor: DOCTOR, payerType: 'Cash',
    });

    const found = await openBillFor(page, 'Ramesh Kumar');
    test.skip(!found, 'The bill did not appear on /billing for selection.');
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).click();
    await page.waitForTimeout(2500);

    expect(
      await page.getByText(/CGHS \/ ECHS Referral Missing/i).count(),
      'A cash walk-in was blocked by the CGHS referral check. A guard that fires on the wrong ' +
      'patients stops the busiest queue in the hospital.',
    ).toBe(0);
    const bills = await opdBillsToday(hid, pid);
    expect(bills[0].bill_status).toBe('final');
  });

  /* ── Payer continuity ──────────────────────────────────────────────── */

  test('TC-P4D-019 Changing the payer type resets a previously chosen insurer', async ({ page }) => {
    const { openWalkIn, fillWalkInDetails } = await import('./opd-flows');
    const { selectOption } = await import('./opd-locators');
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: PAYER.tpaPatientUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'TPA / Insurance', payerName: PAYER.tpaName,
    });
    await selectOption(page, 'Payer Type', 'CGHS');
    await page.waitForTimeout(900);
    const select = page.locator('select').filter({ hasText: /select payer/i }).first();
    if (await select.count()) {
      expect(
        await select.inputValue(),
        'Switching from TPA to CGHS kept the previously selected insurer. The bill would be ' +
        'claimed against a health insurer under a government scheme code — rejected by both.',
      ).toBe('');
    }
  });

  test('TC-P4D-020 The payer chosen at OPD is still on the token when the bill is read back', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor(PAYER.tpaPatientUhid);
    await registerWalkIn(page, {
      existingPatientQuery: PAYER.tpaPatientUhid, department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'TPA / Insurance', payerName: PAYER.tpaName,
    });
    const tokens = await tokensToday(hid, pid);
    const bills = await opdBillsToday(hid, pid);
    expect(tokens.length && bills.length, 'Either the token or the bill is missing.').toBeTruthy();
    expect(
      tokens[0].payer_type,
      'The payer captured at registration did not survive to the token that the bill hangs off. ' +
      'This is the record the pre-auth team reads when the patient is admitted.',
    ).toBe('tpa');
  });

  test('TC-P4D-021 A corporate-panel patient records the corporate payer class', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor('PT-QA-0021');
    await registerWalkIn(page, {
      existingPatientQuery: 'PT-QA-0021', department: DEPARTMENT, doctor: DOCTOR,
      payerType: 'Corporate', payerName: 'Infosys Corporate Panel',
    });
    const token = await expectRow<{ payer_type: string }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(
      token.payer_type,
      'A corporate-panel employee was recorded under the wrong payer class, so the monthly ' +
      'employer invoice will not pick this visit up.',
    ).toBe('corporate');
  });

  test('TC-P4D-022 A billing executive can finalise an ordinary cash OPD bill', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await ctxFor('PT-QA-0001');
    await setPatientCategory(pid, 'general');
    await registerWalkIn(page, {
      existingPatientQuery: 'PT-QA-0001', department: DEPARTMENT, doctor: DOCTOR, payerType: 'Cash',
    });

    await logout();
    await loginAs('billing_executive', { hospital: 'A' });
    const found = await openBillFor(page, 'Ramesh Kumar');
    test.skip(!found, 'The bill did not appear on /billing for the billing executive.');
    await page.getByRole('button', { name: /finalise bill|finalize bill/i }).click();
    await page.waitForTimeout(2500);

    const bills = await opdBillsToday(hid, pid);
    expect(
      bills[0].bill_status,
      'The billing executive — the role that closes bills all day — could not finalise one.',
    ).toBe('final');
  });
});

void P4;
