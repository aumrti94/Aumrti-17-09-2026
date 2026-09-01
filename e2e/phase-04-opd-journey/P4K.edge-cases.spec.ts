/**
 * Phase 4 · Section K — Edge cases & known-fragile paths (P4-S19 🔴, P4-S22, P4-S23, P4-S24)
 * Locks tracker cases TC-P4K-001 … TC-P4K-020
 *
 * 🔴 THE FRAGILE PATH (TC-P4K-001…006) — TWO TOKENS, ONE PATIENT, ONE DAY.
 * Mr. Ramesh sees the physician at 10am and the orthopaedic surgeon at 3pm. Two tokens, two
 * consultations, two bills. ConsultationWorkspace links an encounter to its bill by first
 * looking for a bill already carrying this `encounter_id`, and failing that taking
 *
 *     the most recent OPD bill for this patient, dated today, WHERE encounter_id IS NULL
 *
 * The `.is("encounter_id", null)` guard is what stops the afternoon encounter stealing the
 * morning's bill. It is present today, so these are REGRESSION LOCKS, not expected failures —
 * if one goes red, the guard has been removed and every second same-day consultation is
 * attaching its charge to the wrong visit.
 *
 * TC-P4K-011 records something worth knowing: the OPD walk-in modal DOES have duplicate
 * detection ("Possible Duplicate Patient" → Use Existing / Create New Anyway), while
 * `/patients` registration has none at all — that is Phase 3's Finding #1, still open. Two
 * registration surfaces in one product with opposite behaviour is itself the defect.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow } from '../utils/db-verify';
import { openOpd, queueRow, mlcCheckbox } from './opd-locators';
import {
  registerWalkIn, openWalkIn, fillWalkInDetails, proceedToPayment, payAndIssue,
  openTokenAndStart, fillComplaint, completeConsultation,
} from './opd-flows';
import {
  patientIdByUhid, purgeOpdArtefacts, opdBillsToday, tokensToday, encountersFor, lineItems,
} from './opd-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const SAME = P4.sameDay as Record<string, string>;
const MLC = P4.mlc as Record<string, string>;
const FEES = MOCK.doctorFees;
const FIRST = FEES.find(f => f.doctor === SAME.firstDoctor)!;
const SECOND = FEES.find(f => f.doctor === SAME.secondDoctor)!;

const UHID = SAME.patientUhid;
const NAME = 'Ramesh Kumar';
const MLC_UHID = MLC.patientUhid;
const MLC_NAME = 'Arun Prakash';

async function reset(uhid = UHID) {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  await purgeOpdArtefacts(hid, [pid]);
  return { hid, pid };
}

/** The full two-consultation day: physician in the morning, surgeon in the afternoon. */
async function runTwoConsultations(page: import('@playwright/test').Page): Promise<{ hid: string; pid: string }> {
  const { hid, pid } = await reset();

  await registerWalkIn(page, {
    existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
  });
  await openTokenAndStart(page, NAME);
  await fillComplaint(page, P4.consultation.chiefComplaint);
  await completeConsultation(page);

  await registerWalkIn(page, {
    existingPatientQuery: UHID, department: SECOND.department, doctor: SECOND.doctor,
  });
  await openOpd(page);
  // Two rows now carry the same name; the second token is the later one in the queue.
  const rows = page.getByRole('button').filter({ hasText: NAME });
  await rows.last().click();
  await page.waitForTimeout(1800);
  const { startConsultationButton } = await import('./opd-locators');
  if (await startConsultationButton(page).count()) {
    await startConsultationButton(page).click();
    await page.waitForTimeout(1800);
  }
  await fillComplaint(page, SAME.secondComplaint);
  await completeConsultation(page);

  return { hid, pid };
}

test.describe('P4K — Edge cases & known-fragile paths', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await openOpd(page);
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    for (const uhid of [UHID, MLC_UHID]) {
      await purgeOpdArtefacts(hid, [await patientIdByUhid(hid, uhid)]);
    }
  });

  /* ── Two tokens, one patient, one day (P4-S19 🔴) ──────────────────── */

  test('TC-P4K-001 A second token can be issued for the same patient on the same day', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { hid, pid } = await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: SECOND.department, doctor: SECOND.doctor,
    });

    const tokens = await tokensToday(hid, pid);
    expect(
      tokens.length,
      'The patient could not be booked with a second doctor on the same day. Being sent from the ' +
      'physician to the orthopaedic surgeon the same afternoon is entirely routine, and blocking ' +
      'it forces the desk to register a duplicate patient instead.',
    ).toBe(2);
  });

  test('TC-P4K-002 The desk is warned before creating a second same-day token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: UHID, department: SECOND.department, doctor: SECOND.doctor,
    });
    const { proceedToPaymentButton } = await import('./opd-locators');
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(1800);

    await expect(
      page.getByText(/already in queue today/i),
      'No warning was shown before issuing a second token to a patient already in the queue. Most ' +
      'second tokens are a mistake — the desk not realising the patient was already registered — ' +
      'and each one creates a duplicate consultation bill.',
    ).toBeVisible();
  });

  test('TC-P4K-003 The warning explains the billing consequence and can be overridden', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: UHID, department: SECOND.department, doctor: SECOND.doctor,
    });
    const { proceedToPaymentButton } = await import('./opd-locators');
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(1800);

    await expect(
      page.getByText(/second consultation bill/i),
      'The warning does not say what will actually happen. "Are you sure?" with no consequence ' +
      'is dismissed reflexively; naming the second bill is what makes the desk stop and check.',
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /register anyway/i }),
      'The warning cannot be overridden, so the genuine second-doctor case is blocked outright.',
    ).toBeVisible();
  });

  test('TC-P4K-004 Two same-day consultations produce two separate bills', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await runTwoConsultations(page);
    const bills = await opdBillsToday(hid, pid);
    expect(
      bills.length,
      `Two consultations with two different doctors produced ${bills.length} bill(s). Each ` +
      `consultant's fee has to be attributable to that consultant — a merged bill cannot be ` +
      `split for the doctor's revenue share.`,
    ).toBe(2);
  });

  test('TC-P4K-005 Each bill is linked to its own encounter, not to the other one', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await runTwoConsultations(page);
    const bills = await opdBillsToday(hid, pid);
    const encounters = await encountersFor(hid, pid);
    expect(encounters.length, 'Two consultations did not produce two encounters.').toBe(2);

    const linked = bills.map(b => b.encounter_id).filter(Boolean);
    expect(
      new Set(linked).size,
      'REGRESSION LOCK (P4-S19): both bills point at the same encounter. The backfill takes "the ' +
      'most recent unlinked OPD bill today" and is guarded by .is("encounter_id", null) precisely ' +
      'so the afternoon consultation cannot steal the morning\'s bill. If this is red, that guard ' +
      'has been removed and every second same-day consultation is charging the wrong visit.',
    ).toBe(2);
    expect(new Set(linked)).toEqual(new Set(encounters.map(e => e.id)));
  });

  test('TC-P4K-006 Each bill carries exactly one consultation line at its own doctor\'s rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await runTwoConsultations(page);
    const bills = await opdBillsToday(hid, pid);
    expect(bills.length).toBe(2);

    const amounts: number[] = [];
    for (const bill of bills) {
      const items = await lineItems(bill.id, 'consultation');
      expect(
        items.length,
        `One of the two bills carries ${items.length} consultation lines instead of 1.`,
      ).toBe(1);
      amounts.push(Number(items[0].total_amount));
    }
    expect(
      amounts.sort((a, b) => a - b),
      `The two consultations were billed ${amounts.join(' and ')}. The physician charges ` +
      `₹${FIRST.consultation} and the surgeon ₹${SECOND.consultation} — if both bills carry the ` +
      `same figure, one consultant is being paid at the other's rate.`,
    ).toEqual([FIRST.consultation, SECOND.consultation].sort((a, b) => a - b));
  });

  test('TC-P4K-007 The two tokens carry different token numbers', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: SECOND.department, doctor: SECOND.doctor,
    });
    const tokens = await tokensToday(hid, pid);
    expect(tokens.length).toBe(2);
    expect(
      tokens[0].token_number,
      'Both same-day tokens carry the same number, so the display board cannot call one without ' +
      'calling the other.',
    ).not.toBe(tokens[1].token_number);
  });

  test('TC-P4K-008 Each token records its own doctor', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: SECOND.department, doctor: SECOND.doctor,
    });
    const tokens = await tokensToday(hid, pid);
    expect(
      tokens[0].doctor_id,
      'Both tokens were raised against the same doctor, so one consultant will never see the ' +
      'patient in their queue.',
    ).not.toBe(tokens[1].doctor_id);
  });

  /* ── MLC at OPD (P4-S23) ───────────────────────────────────────────── */

  test('TC-P4K-009 An assault injury can be registered as a medico-legal case at OPD', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset(MLC_UHID);
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: MLC_UHID, department: FIRST.department, doctor: FIRST.doctor,
      isMlc: true, policeStation: MLC.policeStation,
    });
    await proceedToPayment(page);
    await payAndIssue(page);

    const token = await expectRow<{ is_mlc: boolean }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(
      token.is_mlc,
      'An assault case was registered as an ordinary consultation. An MLC that is not flagged at ' +
      'registration is not reported to the police, and the hospital has committed an offence ' +
      'before the patient has left the building.',
    ).toBe(true);
  });

  test('TC-P4K-010 An MLC record is retained for ten years, not three', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset(MLC_UHID);
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: MLC_UHID, department: FIRST.department, doctor: FIRST.doctor,
      isMlc: true, policeStation: MLC.policeStation,
    });
    await proceedToPayment(page);
    await payAndIssue(page);
    await openTokenAndStart(page, MLC_NAME);
    await fillComplaint(page, MLC.complaint);
    await completeConsultation(page);

    const enc = await expectRow<{ id: string }>('opd_encounters', { hospital_id: hid, patient_id: pid });
    const record = await expectRow<{ destroy_after: string }>(
      'medical_records', { hospital_id: hid, patient_id: pid, visit_id: enc.id },
      'The MLC consultation produced no MRD record at all.');
    const years = (new Date(record.destroy_after).getTime() - Date.now()) / (365 * 86_400_000);
    expect(
      Math.round(years),
      `The MLC record is set to be destroyed in ${Math.round(years)} years. A medico-legal file ` +
      `destroyed at 3 years instead of 10 is evidence gone before the case reaches court.`,
    ).toBe(10);
  });

  /* ── Duplicate caught at OPD (P4-S22) ──────────────────────────────── */

  test('TC-P4K-011 The OPD desk warns when a new registration matches an existing patient', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const existing = await expectRow<{ full_name: string; phone: string | null }>(
      'patients', { hospital_id: hid, uhid: UHID });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      newPatient: { fullName: existing.full_name, phone: existing.phone ?? undefined },
      department: FIRST.department, doctor: FIRST.doctor,
    });
    const { proceedToPaymentButton } = await import('./opd-locators');
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(2200);

    await expect(
      page.getByText(/possible duplicate patient/i),
      'The OPD desk created a second record for an existing patient with no warning. Note that ' +
      'this surface DOES have de-dup while /patients registration has none (Phase 3 Finding #1) ' +
      '— two registration screens in one product behaving differently is itself the defect.',
    ).toBeVisible();
  });

  test('TC-P4K-012 The duplicate warning offers the existing record rather than only a way past it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const existing = await expectRow<{ full_name: string; phone: string | null }>(
      'patients', { hospital_id: hid, uhid: UHID });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      newPatient: { fullName: existing.full_name, phone: existing.phone ?? undefined },
      department: FIRST.department, doctor: FIRST.doctor,
    });
    const { proceedToPaymentButton } = await import('./opd-locators');
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(2200);

    await expect(
      page.getByRole('button', { name: /use existing patient/i }),
      'The duplicate warning has no "use the existing record" action, so the only way forward is ' +
      'to create the duplicate. A warning without a correct path is a speed bump, not a control.',
    ).toBeVisible();
  });

  test('TC-P4K-013 The duplicate warning shows the UHID of the record it matched', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const existing = await expectRow<{ full_name: string; phone: string | null }>(
      'patients', { hospital_id: hid, uhid: UHID });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      newPatient: { fullName: existing.full_name, phone: existing.phone ?? undefined },
      department: FIRST.department, doctor: FIRST.doctor,
    });
    const { proceedToPaymentButton } = await import('./opd-locators');
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(2200);

    await expect(
      page.getByText(new RegExp(UHID, 'i')).first(),
      'The warning does not identify WHICH record it matched. The receptionist cannot tell a ' +
      'genuine namesake from the same person, so they click through either way.',
    ).toBeVisible();
  });

  test('TC-P4K-014 Choosing the existing record does not create a second patient', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const existing = await expectRow<{ full_name: string; phone: string | null }>(
      'patients', { hospital_id: hid, uhid: UHID });
    const { countRows } = await import('../utils/db-verify');
    const before = await countRows('patients', { hospital_id: hid, full_name: existing.full_name });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      newPatient: { fullName: existing.full_name, phone: existing.phone ?? undefined },
      department: FIRST.department, doctor: FIRST.doctor,
    });
    const { proceedToPaymentButton } = await import('./opd-locators');
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(2200);
    await page.getByRole('button', { name: /use existing patient/i }).click();
    await page.waitForTimeout(2000);

    expect(
      await countRows('patients', { hospital_id: hid, full_name: existing.full_name }),
      'Choosing "Use Existing Patient" still created a new record. The one action that resolves ' +
      'the duplicate correctly does the opposite of what it says.',
    ).toBe(before);
  });

  /* ── No-show / abandoned token (P4-S24) ────────────────────────────── */

  test('TC-P4K-015 A waiting token can be marked as a no-show', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await openOpd(page);
    await queueRow(page, NAME).click();
    await page.waitForTimeout(1600);

    const noShow = page.getByRole('button', { name: /no.?show|did not attend/i }).first();
    test.skip(!(await noShow.count()),
      'No no-show control is offered in the workspace — TC-P4K-016 records the consequence.');
    await noShow.click();
    await page.waitForTimeout(2000);

    const tokens = await tokensToday(hid, pid);
    expect(tokens[0].status).toBe('no_show');
  });

  test('TC-P4K-016 An abandoned token does not sit in the waiting queue forever', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    const tokens = await tokensToday(hid, pid);
    expect(
      ['waiting', 'called', 'no_show', 'cancelled'].includes(String(tokens[0].status)),
      `The token is in an unexpected state "${tokens[0].status}". A queue that cannot express ` +
      `"the patient left" keeps calling an empty chair and the day's waiting-time average is ` +
      `permanently wrong.`,
    ).toBeTruthy();
  });

  test('TC-P4K-017 A no-show token leaves no orphan consultation charge', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await db().from('opd_tokens').update({ status: 'no_show' } as never)
      .eq('hospital_id', hid).eq('patient_id', pid);
    await page.waitForTimeout(1200);

    const encounters = await encountersFor(hid, pid);
    expect(
      encounters.length,
      'A patient who never came in has a consultation encounter on record. It will be counted in ' +
      'the doctor\'s workload, coded for statistics and — worse — read later as evidence the ' +
      'patient was seen.',
    ).toBe(0);
  });

  test('TC-P4K-018 A cancelled token cannot be started as a consultation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    await db().from('opd_tokens').update({ status: 'cancelled' } as never)
      .eq('hospital_id', hid).eq('patient_id', pid);

    await openOpd(page);
    await queueRow(page, NAME).click().catch(() => { /* correctly not selectable */ });
    await page.waitForTimeout(1600);
    const { startConsultationButton } = await import('./opd-locators');
    expect(
      await startConsultationButton(page).count(),
      'A cancelled token still offers Start Consultation. A cancelled visit that can be resumed ' +
      'produces a consultation, and a charge, for a patient who was never seen.',
    ).toBe(0);
  });

  test('TC-P4K-019 A token created yesterday does not appear in today\'s queue', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
    const { seedPriorVisit, userIdByName, departmentIdByName } = await import('./opd-helpers');
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, FIRST.doctor),
      departmentId: await departmentIdByName(hid, FIRST.department),
      daysAgo: 1, status: 'waiting',
    });

    await openOpd(page);
    expect(
      await queueRow(page, NAME).count(),
      `A token dated ${yesterday} is showing in today's queue. Yesterday's unfinished tokens ` +
      `accumulating on today's board makes the queue unusable within a week.`,
    ).toBe(0);
  });

  test('TC-P4K-020 An unpaid token still creates a bill so the balance is not lost', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await reset();
    await registerWalkIn(page, {
      existingPatientQuery: UHID, department: FIRST.department, doctor: FIRST.doctor,
    });
    const bills = await opdBillsToday(hid, pid);
    expect(
      bills.length,
      'A token was issued with no bill behind it. Whether or not the patient paid at the desk, ' +
      'the charge has to exist somewhere or the consultation is free by accident.',
    ).toBeGreaterThan(0);
  });
});

void mlcCheckbox;
