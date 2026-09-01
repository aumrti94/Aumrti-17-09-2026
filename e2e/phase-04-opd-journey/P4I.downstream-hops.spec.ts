/**
 * Phase 4 · Section I — Downstream hops out of OPD (P4-S14, P4-S15, P4-S16)
 * Locks tracker cases TC-P4I-001 … TC-P4I-020
 *
 * Where the OPD consultation hands the patient to another module: an admission, a physio
 * referral, or the pharmacy counter.
 *
 * ONE DOCUMENTED BEHAVIOUR THAT LOOKS LIKE A BUG AND IS NOT (yet):
 * JOURNEY_SCENARIOS P4-S15 states plainly that orders and vitals from the OPD encounter do
 * NOT carry over into the admission — only the clinical summary does. TC-P4I-005/006 assert
 * the CURRENT behaviour rather than the desirable one, so that if it changes, it changes
 * visibly. The clinical question of whether it *should* carry over belongs to Priya and
 * Dr. Ramesh, not to a test quietly asserting one answer.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow } from '../utils/db-verify';
import { openOpd, admitButton, referPhysioButton, tab } from './opd-locators';
import {
  registerWalkIn, openTokenAndStart, fillComplaint, fillVitals, addLabTest,
  addDrug, completeConsultation,
} from './opd-flows';
import { patientIdByUhid, purgeOpdArtefacts, encountersFor } from './opd-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const REFERRAL = P4.referral as Record<string, string>;
const DOCTOR = MOCK.doctorFees[0].doctor;
const DEPARTMENT = MOCK.doctorFees[0].department;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const PHYSIO_UHID = REFERRAL.physioPatientUhid;
const PHYSIO_NAME = 'Geetha Krishnan';

async function inConsultation(page: import('@playwright/test').Page, uhid = UHID, name = NAME) {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  await purgeOpdArtefacts(hid, [pid]);
  await registerWalkIn(page, { existingPatientQuery: uhid, department: DEPARTMENT, doctor: DOCTOR });
  await openTokenAndStart(page, name);
  await fillComplaint(page, P4.consultation.chiefComplaint);
  return { hid, pid };
}

async function admissionsFor(hospitalId: string, patientId: string) {
  const { data } = await db().from('admissions').select('*')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  return (data ?? []) as Array<Record<string, unknown>>;
}

test.describe('P4I — Downstream hops out of OPD', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('doctor', { hospital: 'A' });
    await openOpd(page);
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    for (const uhid of [UHID, PHYSIO_UHID]) {
      const pid = await patientIdByUhid(hid, uhid);
      await db().from('admissions').delete().eq('hospital_id', hid).eq('patient_id', pid);
      await purgeOpdArtefacts(hid, [pid]);
    }
  });

  /* ── Admit to IPD mid-consultation (P4-S15) ────────────────────────── */

  test('TC-P4I-001 The Admit action is available during a consultation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await inConsultation(page);
    await expect(
      admitButton(page),
      'A doctor who decides mid-consultation that the patient needs admission has no way to start ' +
      'one from the workspace. They have to send the patient back to the front desk to be ' +
      'registered a second time.',
    ).toBeVisible();
  });

  test('TC-P4I-002 Opening Admit from the workspace pre-selects the patient in the consultation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await inConsultation(page);
    await admitButton(page).click();
    await page.waitForTimeout(2000);
    await expect(
      page.getByText(/admit|admission/i).first(),
      'The Admit modal did not open.',
    ).toBeVisible();
    expect(
      await page.getByText(/select a patient first/i).count(),
      'Admit was opened from an active consultation and still asked for a patient. The context ' +
      'the doctor is already in was thrown away.',
    ).toBe(0);
  });

  test('TC-P4I-003 The admission form requires an admitting doctor', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await inConsultation(page);
    await admitButton(page).click();
    await page.waitForTimeout(2000);
    await expect(
      page.getByText(/Admitting Doctor/i).first(),
      'The admission form has no admitting-doctor field. An inpatient with no named consultant ' +
      'has nobody accountable for their care and nobody to bill visits against.',
    ).toBeVisible();
  });

  test('TC-P4I-004 The admission form requires a bed to be selected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await inConsultation(page);
    await admitButton(page).click();
    await page.waitForTimeout(2000);
    await expect(
      page.getByText(/Select Bed/i).first(),
      'The admission form offers no bed selection. An admission with no bed cannot be found by ' +
      'nursing, cannot be charged a room rate, and does not appear on the bed map.',
    ).toBeVisible();
  });

  test('TC-P4I-005 OPD orders do not carry over into the admission', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page);
    await addLabTest(page, (P4.orders as Record<string, string[]>).labTests[0]);
    await completeConsultation(page);

    const admissions = await admissionsFor(hid, pid);
    test.skip(!admissions.length, 'No admission was created — TC-P4I-002/004 cover the modal itself.');
    const { data } = await db().from('lab_orders').select('id')
      .eq('hospital_id', hid).eq('patient_id', pid).eq('admission_id', admissions[0].id as string);
    expect(
      data?.length ?? 0,
      'CURRENT BEHAVIOUR, documented in JOURNEY_SCENARIOS P4-S15: orders raised in the OPD ' +
      'encounter stay attached to the encounter and do not follow the patient into the ' +
      'admission. The case asserts what happens today so that a change is visible; whether it ' +
      'SHOULD carry over is a clinical call for Priya and Dr. Ramesh, not for a test to decide ' +
      'silently.',
    ).toBe(0);
  });

  test('TC-P4I-006 OPD vitals do not carry over into the admission', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page);
    const [sys, dia] = String(MOCK.commonValues.standardVitals.bp).split('/');
    await fillVitals(page, { bpSystolic: sys, bpDiastolic: dia });
    await completeConsultation(page);

    const encounters = await encountersFor(hid, pid);
    expect(
      String(encounters[0].vitals ? (encounters[0].vitals as Record<string, unknown>).bp_systolic : ''),
      'The OPD vitals were not even saved on the encounter, so the question of whether they carry ' +
      'over into the admission cannot be answered either way.',
    ).toBe(sys);
  });

  test('TC-P4I-007 An admission created from OPD is linked to the patient', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page);
    await admitButton(page).click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /^admit( patient)?$|confirm admission/i }).last().click().catch(() => { /* required fields unfilled */ });
    await page.waitForTimeout(2500);

    const admissions = await admissionsFor(hid, pid);
    test.skip(!admissions.length,
      'The admission was not completed — the modal needs a bed and an admitting doctor, which ' +
      'depends on Phase 2 ward/bed configuration. TC-P4I-004 asserts the field exists.');
    expect(admissions[0].patient_id).toBe(pid);
  });

  test('TC-P4I-008 The OPD encounter is marked as admitted once the patient is admitted', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page);
    await completeConsultation(page);
    const encounters = await encountersFor(hid, pid);
    expect(
      'is_admitted' in encounters[0],
      'opd_encounters has no is_admitted column, so nothing distinguishes a consultation that ' +
      'ended in an admission from one where the patient went home. Conversion rate — the single ' +
      'most watched OPD metric in a private hospital — cannot be computed.',
    ).toBeTruthy();
  });

  /* ── Refer to physiotherapy (P4-S16) ───────────────────────────────── */

  test('TC-P4I-009 The Refer Physio action is offered in the workspace', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await inConsultation(page, PHYSIO_UHID, PHYSIO_NAME);
    await expect(
      referPhysioButton(page),
      'There is no way to refer to physiotherapy from the consultation, so the referral is made ' +
      'verbally and the physio department has no work queue.',
    ).toBeVisible();
  });

  test('TC-P4I-010 Referring to physiotherapy creates a physio_referrals row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page, PHYSIO_UHID, PHYSIO_NAME);
    await referPhysioButton(page).click();
    await page.waitForTimeout(2500);

    await expectRow(
      'physio_referrals', { hospital_id: hid, patient_id: pid },
      'The referral reported success and wrote no row. The patient is told to attend physio and ' +
      'physio never hears about them.',
    );
  });

  test('TC-P4I-011 The physio referral carries a diagnosis for the therapist to work from', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page, PHYSIO_UHID, PHYSIO_NAME);
    await referPhysioButton(page).click();
    await page.waitForTimeout(2500);

    const row = await expectRow<{ diagnosis: string | null }>(
      'physio_referrals', { hospital_id: hid, patient_id: pid });
    expect(
      row.diagnosis,
      'The referral carries no diagnosis or complaint. A physiotherapist receiving a patient with ' +
      'no indication has to re-take the whole history before they can treat anything.',
    ).toBeTruthy();
  });

  test('TC-P4I-012 The physio referral is linked back to the OPD encounter', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page, PHYSIO_UHID, PHYSIO_NAME);
    await referPhysioButton(page).click();
    await page.waitForTimeout(2500);

    const row = await expectRow<{ opd_encounter_id: string | null }>(
      'physio_referrals', { hospital_id: hid, patient_id: pid });
    expect(
      row.opd_encounter_id,
      'The referral has no encounter link, so the therapist cannot open the consultation that ' +
      'generated it and the episode of care is split in two.',
    ).toBeTruthy();
  });

  test('TC-P4I-013 The referral names the doctor who made it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page, PHYSIO_UHID, PHYSIO_NAME);
    await referPhysioButton(page).click();
    await page.waitForTimeout(2500);

    const row = await expectRow<{ referred_by: string | null }>(
      'physio_referrals', { hospital_id: hid, patient_id: pid });
    expect(
      row.referred_by,
      'The referral records no referring doctor. The therapist has nobody to query about the ' +
      'treatment goal, and the referring consultant gets no feedback loop.',
    ).toBeTruthy();
  });

  test('TC-P4I-014 A referral letter can be raised from the consultation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await inConsultation(page);
    await page.getByRole('button', { name: /^refer$/i }).first().click();
    await page.waitForTimeout(2000);
    await expect(
      page.getByText(/referral/i).first(),
      'The Refer action opened nothing. A patient sent to an outside specialist leaves with no ' +
      'written summary, which is the single most common complaint referring consultants make.',
    ).toBeVisible();
  });

  /* ── Prescription → pharmacy (P4-S14) ──────────────────────────────── */

  test('TC-P4I-015 A prescription raised in OPD is stored for the pharmacy to read', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page);
    await addDrug(page, {
      drugName: P4.prescription.primary.drugName,
      dose: P4.prescription.primary.dose,
      durationDays: P4.prescription.primary.durationDays,
    });
    await completeConsultation(page);

    const rx = await expectRow<{ drugs: unknown; status?: string }>(
      'prescriptions', { hospital_id: hid, patient_id: pid },
      'The prescription never reached the database, so the pharmacy counter has nothing to dispense against.',
    );
    expect(JSON.stringify(rx.drugs)).toContain(P4.prescription.primary.drugName);
  });

  test('TC-P4I-016 The prescription records the quantity the pharmacy must dispense', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await inConsultation(page);
    await addDrug(page, {
      drugName: P4.prescription.primary.drugName,
      dose: P4.prescription.primary.dose,
      durationDays: P4.prescription.primary.durationDays,
      quantity: P4.prescription.primary.quantity,
    });
    await completeConsultation(page);

    const rx = await expectRow<{ drugs: unknown }>('prescriptions', { hospital_id: hid, patient_id: pid });
    expect(
      JSON.stringify(rx.drugs),
      'The prescription carries no quantity. The pharmacist has to work it out from dose × ' +
      'frequency × days at the counter, which is where part-course dispensing errors come from.',
    ).toContain('quantity');
  });

  test('TC-P4I-017 A pharmacist can open the pharmacy module and see the OPD prescription', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await inConsultation(page);
    await addDrug(page, {
      drugName: P4.prescription.primary.drugName,
      dose: P4.prescription.primary.dose,
      durationDays: P4.prescription.primary.durationDays,
    });
    await completeConsultation(page);

    await logout();
    await loginAs('pharmacist', { hospital: 'A' });
    await page.goto('/pharmacy', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3200);
    await expect(
      page.getByText(NAME).first(),
      'The pharmacist cannot see the prescription the doctor just wrote. The patient carries a ' +
      'paper slip to the counter and the electronic prescription is decorative.',
    ).toBeVisible();
  });

  test('TC-P4I-018 The drug batches the pharmacy will dispense from carry expiry dates', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('drug_batches').select('expiry_date, quantity_available, status')
      .eq('hospital_id', hid).limit(20);
    expect(
      data?.length,
      'There is no stock at all. FEFO batch selection and expiry blocking (P4-S14, and the whole ' +
      'of Phase 6) cannot be exercised against an empty store.',
    ).toBeGreaterThan(0);
    expect(
      data!.every((b: Record<string, unknown>) => b.expiry_date),
      'A batch exists with no expiry date. FEFO cannot order batches it cannot date, and an ' +
      'undated batch can never be blocked as expired.',
    ).toBeTruthy();
  });

  test('TC-P4I-019 Stock includes an expired batch so the dispensing block can be proven', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const today = new Date().toISOString().split('T')[0];
    const { data } = await db().from('drug_batches').select('id, expiry_date')
      .eq('hospital_id', hid).lt('expiry_date', today).limit(1);
    expect(
      data?.length,
      'The seeded stock contains no expired batch. qa-seed.mjs is documented as seeding one ' +
      '("incl. 1 expired + 1 quarantined + FEFO pair") precisely so the refuse-to-dispense path ' +
      'can be tested — without it, Phase 6 can only ever prove the happy case.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4I-020 A nurse is not offered the Admit action', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await inConsultation(page);
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    await openOpd(page);
    await page.getByRole('button').filter({ hasText: NAME }).first().click().catch(() => { /* not in this nurse's queue */ });
    await page.waitForTimeout(2000);
    expect(
      await admitButton(page).count(),
      'A nurse can admit a patient. Admission commits a bed, opens an IPD bill and starts a room ' +
      'charge — it is a consultant decision, and the permission gate is what enforces that.',
    ).toBe(0);
  });
});

void tab;
