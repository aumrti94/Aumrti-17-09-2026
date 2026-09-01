/**
 * Phase 4 · Section B — Consultation fee engine & revisit rules (P4-S01, P4-S02, P4-S03)
 * Locks tracker cases TC-P4B-001 … TC-P4B-024
 *
 * This is the money section. Two independent pieces of logic decide what a patient pays:
 *
 *   1. RATE PRECEDENCE — doctor → department → global → a hardcoded ₹500
 *      (ConsultationWorkspace.tsx handleComplete, and the mirror of it in WalkInModal). The
 *      ₹500 fallback is SILENT: no toast, no warning, nothing in the UI except the rate-source
 *      badge quietly reading "Default rate". A hospital that never noticed would under-bill
 *      every specialist consultation indefinitely.
 *
 *   2. FOLLOW-UP PRICING — WalkInModal.tsx:
 *          qualifiesFollowUp = followUpFee !== null &&
 *                              (autoWithinValidity || (manualFollowUp && daysSince === null))
 *      Two subtleties are each worth their own case: `!== null` rather than `> 0` (so a
 *      configured FREE follow-up bills ₹0 instead of falling through to the base fee), and a
 *      prior visit OUTSIDE the window being a full-fee fresh consultation even when the desk
 *      ticks "Follow-up".
 *
 * The seeded fee card (mock-data.json `doctorFees`) is built for exactly this:
 *   Dr. Suresh Menon  ₹500, follow-up ₹0   (FREE), validity  7 days, emergency ₹800
 *   Dr. Kavitha Rao   ₹700, follow-up ₹300,        validity 10 days, emergency ₹1000
 *   Dr. Arjun Nair    ₹800, follow-up ₹0   (FREE), validity  7 days, emergency ₹1200
 *
 * SETUP NOTE: the precedence cases (TC-P4B-005…007) temporarily deactivate service_master rows
 * to force the lookup down a tier, then restore them in a finally. That is the only honest way
 * to prove a fallback fires — a fallback you never provoke is a fallback you have not tested.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow } from '../utils/db-verify';
import { openOpd, consultationFee, rateSourceBadge, field } from './opd-locators';
import { openWalkIn, fillWalkInDetails, proceedToPayment, payAndIssue, registerWalkIn } from './opd-flows';
import {
  patientIdByUhid, userIdByName, departmentIdByName, purgeOpdArtefacts,
  seedPriorVisit, opdBillsToday, lineItems, expectedConsultationFee,
} from './opd-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const FEES = MOCK.doctorFees;
const BASELINE_UHID = 'PT-QA-0001';

const feeCardFor = (doctor: string) => {
  const card = FEES.find(f => f.doctor === doctor);
  if (!card) throw new Error(`No fee card for "${doctor}" in mock-data.json doctorFees.`);
  return card;
};

const MENON = feeCardFor('Dr. Suresh Menon');
const RAO = feeCardFor('Dr. Kavitha Rao');
const NAIR = feeCardFor('Dr. Arjun Nair');

async function resetPatient(uhid = BASELINE_UHID): Promise<{ hid: string; pid: string }> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  await purgeOpdArtefacts(hid, [pid]);
  return { hid, pid };
}

/** Temporarily deactivate a service_master consultation row so the lookup falls to the next tier. */
async function withDeactivatedRate(
  filter: { hospital_id: string; doctor_id?: string | null; department_id?: string | null },
  body: () => Promise<void>,
): Promise<void> {
  let q = db().from('service_master').select('id')
    .eq('hospital_id', filter.hospital_id).eq('item_type', 'consultation').eq('is_active', true);
  if (filter.doctor_id !== undefined) {
    q = filter.doctor_id === null ? q.is('doctor_id', null) : q.eq('doctor_id', filter.doctor_id);
  }
  if (filter.department_id !== undefined) {
    q = filter.department_id === null ? q.is('department_id', null) : q.eq('department_id', filter.department_id);
  }
  const { data } = await q;
  const ids = (data ?? []).map((r: { id: string }) => r.id);

  if (ids.length) {
    const { error } = await db().from('service_master').update({ is_active: false } as never).in('id', ids);
    if (error) throw new Error(`Could not deactivate service_master rows for the precedence test: ${error.message}`);
  }
  try {
    await body();
  } finally {
    if (ids.length) {
      // Restore unconditionally. Leaving these off would silently re-price every later case.
      await db().from('service_master').update({ is_active: true } as never).in('id', ids);
    }
  }
}

test.describe('P4B — Consultation fee engine & revisit rules', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await openOpd(page);
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    const { hid, pid } = await resetPatient();
    void hid; void pid;
  });

  /* ── Rate precedence ───────────────────────────────────────────────── */

  test('TC-P4B-001 A new consultation is priced at the doctor\'s own configured rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await resetPatient();
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'New',
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      `The desk was shown ₹${fee} for ${MENON.doctor}, whose configured consultation fee is ` +
      `₹${MENON.consultation}. Every consultation this doctor sees is mispriced.`,
    ).toBe(MENON.consultation);
  });

  test('TC-P4B-002 The rate-source badge names the doctor tier, not the hardcoded default', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await resetPatient();
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'New',
    });
    const { rateSource } = await proceedToPayment(page);
    expect(
      rateSource,
      `The fee came from "${rateSource}". "Default rate" means every service_master lookup ` +
      `missed and the hardcoded ₹500 is being charged with no warning anywhere on screen.`,
    ).toBe('Doctor rate');
  });

  test('TC-P4B-003 A second doctor with a different configured rate prices differently', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await resetPatient();
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: RAO.department, doctor: RAO.doctor, visitType: 'New',
    });
    const { fee } = await proceedToPayment(page);
    expect(fee, `${RAO.doctor} should price at ₹${RAO.consultation}, not ₹${fee}.`).toBe(RAO.consultation);
  });

  test('TC-P4B-004 A specialist consultation prices at the specialist rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await resetPatient();
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: NAIR.department, doctor: NAIR.doctor, visitType: 'New',
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      `The surgeon's consultation was priced at ₹${fee} instead of ₹${NAIR.consultation}. ` +
      `A specialist billed at the general rate is direct revenue leakage on every visit.`,
    ).toBe(NAIR.consultation);
  });

  test('TC-P4B-005 With no doctor-level rate, the department rate is used', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid } = await resetPatient();
    const doctorId = await userIdByName(hid, MENON.doctor);
    const deptId = await departmentIdByName(hid, MENON.department);

    await withDeactivatedRate({ hospital_id: hid, doctor_id: doctorId }, async () => {
      const expected = await expectedConsultationFee(hid, doctorId, deptId);
      test.skip(expected.source !== 'dept',
        `This tenant has no department-level consultation rate for ${MENON.department}, so the ` +
        `department tier cannot be exercised. Configure one in Settings → Services (Phase 2).`);

      await openWalkIn(page);
      await fillWalkInDetails(page, {
        existingPatientQuery: BASELINE_UHID,
        department: MENON.department, doctor: MENON.doctor, visitType: 'New',
      });
      const { fee, rateSource } = await proceedToPayment(page);
      expect(rateSource, 'The lookup did not fall through to the department tier.').toBe('Dept rate');
      expect(fee).toBe(expected.fee);
    });
  });

  test('TC-P4B-006 With no doctor and no department rate, the global rate is used', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid } = await resetPatient();
    const doctorId = await userIdByName(hid, MENON.doctor);
    const deptId = await departmentIdByName(hid, MENON.department);

    await withDeactivatedRate({ hospital_id: hid, doctor_id: doctorId }, async () => {
      await withDeactivatedRate({ hospital_id: hid, doctor_id: null, department_id: deptId }, async () => {
        const expected = await expectedConsultationFee(hid, doctorId, deptId);
        test.skip(expected.source !== 'global',
          'This tenant has no global consultation rate, so the global tier cannot be exercised.');

        await openWalkIn(page);
        await fillWalkInDetails(page, {
          existingPatientQuery: BASELINE_UHID,
          department: MENON.department, doctor: MENON.doctor, visitType: 'New',
        });
        const { fee, rateSource } = await proceedToPayment(page);
        expect(rateSource).toBe('Global rate');
        expect(fee).toBe(expected.fee);
      });
    });
  });

  test('TC-P4B-007 With no rate configured at any tier, ₹500 is charged silently', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid } = await resetPatient();
    const doctorId = await userIdByName(hid, MENON.doctor);
    const deptId = await departmentIdByName(hid, MENON.department);

    await withDeactivatedRate({ hospital_id: hid, doctor_id: doctorId }, async () => {
      await withDeactivatedRate({ hospital_id: hid, doctor_id: null, department_id: deptId }, async () => {
        await withDeactivatedRate({ hospital_id: hid, doctor_id: null, department_id: null }, async () => {
          await openWalkIn(page);
          await fillWalkInDetails(page, {
            existingPatientQuery: BASELINE_UHID,
            department: MENON.department, doctor: MENON.doctor, visitType: 'New',
          });
          const { fee, rateSource } = await proceedToPayment(page);
          expect(fee, 'The unconfigured fallback is not ₹500 any more — SETTINGS_PREREQ_MATRIX.md needs updating.').toBe(500);
          expect(
            rateSource,
            'The ₹500 fallback fired but the badge did not say "Default rate" — there is then NO ' +
            'signal anywhere on screen that the hospital\'s own rate card was not used.',
          ).toBe('Default rate');
        });
      });
    });
  });

  /* ── Follow-up window ──────────────────────────────────────────────── */

  test('TC-P4B-008 A follow-up inside the validity window is charged the follow-up rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, MENON.doctor),
      departmentId: await departmentIdByName(hid, MENON.department),
      daysAgo: Number(P4.followUp.withinWindowDays),
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor,
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      `A patient returning on day ${P4.followUp.withinWindowDays} of a ${MENON.validityDays}-day ` +
      `window was charged ₹${fee} instead of the follow-up rate ₹${MENON.followUp}. The hospital ` +
      `told this patient the review was free — charging them anyway is the single most common ` +
      `front-desk complaint.`,
    ).toBe(MENON.followUp);
  });

  test('TC-P4B-009 The badge names the follow-up rate and its window', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, MENON.doctor),
      departmentId: await departmentIdByName(hid, MENON.department),
      daysAgo: Number(P4.followUp.withinWindowDays),
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor,
    });
    const { rateSource } = await proceedToPayment(page);
    expect(rateSource).toBe(`Follow-up rate (within ${MENON.validityDays}d)`);
  });

  test('TC-P4B-010 A return on exactly the last day of the window is still a follow-up', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, MENON.doctor),
      departmentId: await departmentIdByName(hid, MENON.department),
      daysAgo: MENON.validityDays,
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor,
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      `Day ${MENON.validityDays} of a ${MENON.validityDays}-day window was charged ₹${fee}. ` +
      `The comparison is "daysSince <= validityDays", so the last day is inclusive — an ` +
      `off-by-one here charges a patient on the exact day they were told to come back.`,
    ).toBe(MENON.followUp);
  });

  test('TC-P4B-011 A return one day after the window is a fresh consultation at full fee', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, MENON.doctor),
      departmentId: await departmentIdByName(hid, MENON.department),
      daysAgo: MENON.validityDays + 1,
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor,
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      `Day ${MENON.validityDays + 1} was still priced at the follow-up rate. The window has no ` +
      `upper edge, so every returning patient is free forever and the OPD earns nothing on reviews.`,
    ).toBe(MENON.consultation);
  });

  test('TC-P4B-012 A return well outside the window is charged the full fee', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, MENON.doctor),
      departmentId: await departmentIdByName(hid, MENON.department),
      daysAgo: Number(P4.followUp.outsideWindowDays),
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor,
    });
    const { fee } = await proceedToPayment(page);
    expect(fee).toBe(MENON.consultation);
  });

  test('TC-P4B-013 A configured FREE follow-up bills ₹0, not the base fee', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    test.skip(MENON.followUp !== 0, `${MENON.doctor}'s follow-up fee is no longer 0 in mock-data.json.`);
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, MENON.doctor),
      departmentId: await departmentIdByName(hid, MENON.department),
      daysAgo: Number(P4.followUp.withinWindowDays),
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor,
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      `A free follow-up was priced at ₹${fee}. The qualifying test is "followUpFee !== null", ` +
      `deliberately not "> 0" — if it regresses to a truthiness check, every hospital that ` +
      `configures free reviews starts charging for them.`,
    ).toBe(0);
  });

  test('TC-P4B-014 A paid follow-up rate is charged where the doctor configures one', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    test.skip(RAO.followUp === 0, `${RAO.doctor} no longer has a non-zero follow-up fee.`);
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, RAO.doctor),
      departmentId: await departmentIdByName(hid, RAO.department),
      daysAgo: 3,
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: RAO.department, doctor: RAO.doctor,
    });
    const { fee } = await proceedToPayment(page);
    expect(fee, `${RAO.doctor}'s follow-up should be ₹${RAO.followUp}.`).toBe(RAO.followUp);
  });

  test('TC-P4B-015 A doctor with a longer validity window honours that longer window', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, RAO.doctor),
      departmentId: await departmentIdByName(hid, RAO.department),
      daysAgo: RAO.validityDays,
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: RAO.department, doctor: RAO.doctor,
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      `Day ${RAO.validityDays} for a ${RAO.validityDays}-day window was charged ₹${fee}. ` +
      `The window must come from the doctor's own validity_days, not a single hospital-wide constant.`,
    ).toBe(RAO.followUp);
  });

  test('TC-P4B-016 A doctor\'s window does not extend past its own last day', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, RAO.doctor),
      departmentId: await departmentIdByName(hid, RAO.department),
      daysAgo: RAO.validityDays + 1,
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: RAO.department, doctor: RAO.doctor,
    });
    const { fee } = await proceedToPayment(page);
    expect(fee).toBe(RAO.consultation);
  });

  test('TC-P4B-017 A visit marked Follow-up with no prior visit on record still gets the follow-up rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await resetPatient();   // deliberately NO prior visit seeded

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'Follow-up',
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      'A patient whose first visit predates the system (paper records, or a visit to another ' +
      'branch) was charged the full fee despite the desk marking it a follow-up. Validity cannot ' +
      'be evaluated with no history, so the desk\'s judgement is the only input there is.',
    ).toBe(MENON.followUp);
  });

  test('TC-P4B-018 A prior visit outside the window is full fee even when marked Follow-up', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, MENON.doctor),
      departmentId: await departmentIdByName(hid, MENON.department),
      daysAgo: Number(P4.followUp.outsideWindowDays),
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'Follow-up',
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      `A visit ${P4.followUp.outsideWindowDays} days after the last one was given the follow-up ` +
      `rate because the desk ticked the box. If the tick alone can zero the fee, the follow-up ` +
      `policy is unenforceable and free consultations can be handed out at will.`,
    ).toBe(MENON.consultation);
  });

  test('TC-P4B-019 A prior visit with a different doctor does not trigger the follow-up rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, NAIR.doctor),
      departmentId: await departmentIdByName(hid, NAIR.department),
      daysAgo: 2,
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'New',
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      'A recent visit to a DIFFERENT doctor discounted this consultation. The follow-up ' +
      'entitlement belongs to the doctor who asked the patient back, not to the hospital.',
    ).toBe(MENON.consultation);
  });

  /* ── Emergency precedence & the fee control itself ─────────────────── */

  test('TC-P4B-020 An emergency visit is charged the emergency rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await resetPatient();
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'Emergency',
    });
    const { fee, rateSource } = await proceedToPayment(page);
    expect(rateSource).toBe('Emergency rate');
    expect(fee, `The emergency rate for ${MENON.doctor} is ₹${MENON.emergency}.`).toBe(MENON.emergency);
  });

  test('TC-P4B-021 Emergency pricing takes precedence over an otherwise-qualifying follow-up', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await seedPriorVisit({
      hospitalId: hid, patientId: pid,
      doctorId: await userIdByName(hid, MENON.doctor),
      departmentId: await departmentIdByName(hid, MENON.department),
      daysAgo: 2,
    });

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'Emergency',
    });
    const { fee } = await proceedToPayment(page);
    expect(
      fee,
      'A patient who came back two days later as an EMERGENCY was billed the free follow-up rate. ' +
      'An after-hours emergency attendance is a different service from a routine review and must ' +
      'not be zeroed by the follow-up window.',
    ).toBe(MENON.emergency);
  });

  test('TC-P4B-022 The consultation fee cannot be edited at the front desk', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await resetPatient();
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'New',
    });
    await proceedToPayment(page);
    await expect(
      async () => { await field(page, 'Consultation Fee (₹)'); },
      'The consultation fee is an editable input. A front desk that can retype the amount can ' +
      'collect ₹500 and record ₹100, and the difference never reaches the hospital.',
    ).rejects.toThrow();
  });

  test('TC-P4B-023 The fee shown at the desk is the amount that lands on the bill', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'New',
    });
    const shown = await consultationFee(page);
    await payAndIssue(page);

    const bills = await opdBillsToday(hid, pid);
    expect(bills.length, 'The walk-in payment created no bill.').toBeGreaterThan(0);
    expect(
      Number(bills[0].total_amount),
      `The desk displayed ₹${shown} and the bill was raised for ₹${bills[0].total_amount}. ` +
      `The receipt in the patient's hand and the hospital's ledger disagree.`,
    ).toBe(shown);
  });

  test('TC-P4B-024 Paying at the desk records a bill_payments row for the collected amount', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await resetPatient();
    const result = await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID,
      department: MENON.department, doctor: MENON.doctor, visitType: 'New',
    });

    const bills = await opdBillsToday(hid, pid);
    expect(bills.length).toBeGreaterThan(0);
    const payment = await expectRow<{ amount: number }>(
      'bill_payments', { bill_id: bills[0].id },
      'Cash was collected at the desk but no bill_payments row exists — the day\'s collection ' +
      'reconciliation will be short by exactly this consultation.',
    );
    expect(Number(payment.amount)).toBe(result.fee);
    const items = await lineItems(bills[0].id, 'consultation');
    expect(items.length, 'The bill has no consultation line item.').toBeGreaterThan(0);
  });
});

void rateSourceBadge;
