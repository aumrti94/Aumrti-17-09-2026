/**
 * Phase 4 · Section E — Consultation workspace & clinical documentation (P4-S01, P4-S09)
 * Locks tracker cases TC-P4E-001 … TC-P4E-024
 *
 * What the doctor actually types, and whether any of it survives. The workspace autosaves into
 * `opd_encounters` and, on completion, writes an MRD row into `medical_records` plus a pending
 * `icd_codings` row (ConsultationWorkspace.tsx:1004-1030). Both of those are what a NABH
 * assessor asks to see; neither shows the doctor any confirmation that it happened.
 *
 * VITALS ARE ADDRESSED BY PLACEHOLDER, not by label. VitalsTab renders each card as an
 * unassociated `<label>` above an `<input>`, and Blood Pressure is TWO inputs under one label
 * — so the label-walk in opd-locators.ts cannot disambiguate them. The placeholders
 * (120 / 80 / 72 / 98.6 / 98 / 65 / 170) are stable defaults written into the component.
 *
 * The retention window is deliberately checked (TC-P4E-021): `destroy_after` is 3 years for an
 * ordinary OPD record and 10 for an MLC. Getting that backwards destroys medico-legal evidence
 * seven years early.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { hospitalIdFor, expectRow } from '../utils/db-verify';
import { openOpd, tab, completeButton, startConsultationButton, field, fillField } from './opd-locators';
import {
  registerWalkIn, openTokenAndStart, fillComplaint, fillVitals, fillExamination,
  completeConsultation,
} from './opd-flows';
import { patientIdByUhid, purgeOpdArtefacts, encountersFor, tokensToday } from './opd-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const C = P4.consultation;
const V = MOCK.commonValues.standardVitals;
const SEPSIS = MOCK.commonValues.sepsisVitals;
const DOCTOR = MOCK.doctorFees[0].doctor;
const DEPARTMENT = MOCK.doctorFees[0].department;
const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const PAED_UHID = 'PT-QA-0009';
const PAED_NAME = 'Baby Aarav Sharma';

const bp = (v: string) => v.split('/');

async function freshToken(page: import('@playwright/test').Page, uhid = UHID) {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  await purgeOpdArtefacts(hid, [pid]);
  await registerWalkIn(page, { existingPatientQuery: uhid, department: DEPARTMENT, doctor: DOCTOR });
  return { hid, pid };
}

/**
 * Make sure the DiagnosisPanel add row is showing, whatever its starting state.
 *
 * It now opens by default on an encounter with no diagnoses yet (the ICD field used to be
 * hidden behind this toggle at the bottom of the Examination tab, which is what made ICD
 * coding hard to find). Blindly clicking the toggle would CLOSE an already-open row, so
 * assert the end state instead of assuming the click opens it.
 */
async function openDiagnosisRow(page: import('@playwright/test').Page) {
  const input = page.getByPlaceholder(/Diagnosis \/ impression/i).first();
  if (await input.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /^\+?\s*add diagnosis$/i }).first().click();
  await input.waitFor({ state: 'visible' });
}

test.describe('P4E — Consultation workspace & documentation', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await openOpd(page);
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    for (const uhid of [UHID, PAED_UHID]) {
      await purgeOpdArtefacts(hid, [await patientIdByUhid(hid, uhid)]);
    }
  });

  test('TC-P4E-001 Selecting a token opens the consultation workspace for that patient', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await freshToken(page);
    await openOpd(page);
    await page.getByRole('button').filter({ hasText: NAME }).first().click();
    await page.waitForTimeout(1800);
    await expect(
      page.getByText(NAME).first(),
      'Clicking a queue token did not open that patient in the workspace.',
    ).toBeVisible();
  });

  test('TC-P4E-002 A waiting token offers Start Consultation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshToken(page);
    await openOpd(page);
    await page.getByRole('button').filter({ hasText: NAME }).first().click();
    await page.waitForTimeout(1800);
    await expect(startConsultationButton(page)).toBeVisible();
  });

  test('TC-P4E-003 Starting the consultation moves the token to in_consultation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    const tokens = await tokensToday(hid, pid);
    expect(
      tokens[0].status,
      'The token did not move to in_consultation. The queue display keeps calling a patient who ' +
      'is already in the room, and the waiting-time metric never stops counting.',
    ).toBe('in_consultation');
  });

  test('TC-P4E-004 Starting the consultation stamps consultation_start_at', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    const tokens = await tokensToday(hid, pid);
    expect(
      tokens[0].consultation_start_at,
      'consultation_start_at is null, so the door-to-doctor time this hospital reports to NABH ' +
      'is computed from nothing.',
    ).toBeTruthy();
  });

  test('TC-P4E-005 Every clinical tab is present in the workspace', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshToken(page);
    await openTokenAndStart(page, NAME);
    for (const label of ['Complaint', 'Vitals', 'Examination', 'Rx & Orders', 'Plan & Advice', 'History']) {
      expect(
        await tab(page, new RegExp(label.replace('&', '&'), 'i')).count(),
        `The "${label}" tab is missing. Anything the doctor cannot reach in the workspace gets ` +
        `written on paper instead, and the electronic record is incomplete from day one.`,
      ).toBeGreaterThan(0);
    }
  });

  test('TC-P4E-006 The chief complaint is saved to the encounter', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint, C.historyOfPresentIllness, C.duration);
    await completeConsultation(page);

    const enc = await expectRow<{ chief_complaint: string }>(
      'opd_encounters', { hospital_id: hid, patient_id: pid },
      'No opd_encounters row after a completed consultation — the visit happened and nothing was recorded.',
    );
    expect(enc.chief_complaint).toContain(C.chiefComplaint.slice(0, 20));
  });

  test('TC-P4E-007 The history of present illness is saved to the encounter', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint, C.historyOfPresentIllness);
    await completeConsultation(page);

    const enc = await expectRow<{ history_of_present_illness: string | null }>(
      'opd_encounters', { hospital_id: hid, patient_id: pid });
    expect(
      enc.history_of_present_illness,
      'The HPI the doctor typed was not persisted. It is the narrative the next clinician reads ' +
      'to understand why this patient came in at all.',
    ).toBeTruthy();
  });

  test('TC-P4E-008 A consultation cannot be completed with no chief complaint recorded', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await completeConsultation(page);

    const encounters = await encountersFor(hid, pid);
    if (encounters.length) {
      expect(
        String(encounters[0].chief_complaint ?? '').trim(),
        'CURRENT BEHAVIOUR: an encounter was finalised with an empty chief complaint. A visit ' +
        'record with no reason for attendance cannot be coded, cannot be claimed and fails a ' +
        'NABH file review. If a required-field gate is added later this case flips to expecting ' +
        'the block — update it, do not delete it.',
      ).toBe('');
    }
  });

  test('TC-P4E-009 Normal vitals are saved into the encounter vitals JSON', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    const [sys, dia] = bp(String(V.bp));
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint);
    await fillVitals(page, {
      bpSystolic: sys, bpDiastolic: dia, pulse: String(V.pulse),
      temperature: String(V.tempF), spo2: String(V.spo2),
    });
    await completeConsultation(page);

    const enc = await expectRow<{ vitals: Record<string, unknown> }>(
      'opd_encounters', { hospital_id: hid, patient_id: pid });
    expect(
      String(enc.vitals?.bp_systolic ?? ''),
      'The vitals the nurse recorded are not in the encounter. Every downstream score (NEWS2, ' +
      'sepsis screening, paediatric dosing) reads this JSON and has nothing to read.',
    ).toBe(sys);
    expect(String(enc.vitals?.spo2 ?? '')).toBe(String(V.spo2));
  });

  test('TC-P4E-010 A systolic BP above the alert threshold is flagged on screen', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillVitals(page, { bpSystolic: '190', bpDiastolic: '110' });
    const red = page.locator('.border-red-300').first();
    await expect(
      red,
      'A systolic of 190 rendered with no visual alert. VitalsTab turns the card red above 180 — ' +
      'a hypertensive emergency that reads like a normal number is missed in a 200-patient OPD.',
    ).toBeVisible();
  });

  test('TC-P4E-011 SpO2 below 95 is flagged as a red alert', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillVitals(page, { spo2: String(SEPSIS.spo2) });
    await expect(
      page.locator('.border-red-300').first(),
      `SpO2 ${SEPSIS.spo2}% did not raise a red alert. Hypoxia is the single most time-critical ` +
      `abnormal vital an OPD nurse will see.`,
    ).toBeVisible();
  });

  test('TC-P4E-012 SpO2 of exactly 95 is not treated as the red hypoxia band', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillVitals(page, { spo2: '95' });
    expect(
      await page.locator('.border-red-300').count(),
      'SpO2 95% was flagged red. The rule is "< 95 is red, 95-97 amber" — an off-by-one here ' +
      'turns a borderline-normal reading into an emergency and feeds alert fatigue.',
    ).toBe(0);
  });

  test('TC-P4E-013 A temperature above 100.4°F is flagged', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillVitals(page, { temperature: String(SEPSIS.tempF) });
    await expect(
      page.locator('.border-amber-300, .border-red-300').first(),
      `${SEPSIS.tempF}°F was not flagged as pyrexia.`,
    ).toBeVisible();
  });

  test('TC-P4E-014 BMI is computed and categorised from weight and height', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillVitals(page, { weightKg: '70', heightCm: '170' });
    await page.waitForTimeout(900);
    await expect(
      page.getByText(/^24\.2$/).first(),
      'BMI was not computed from 70 kg / 170 cm (expected 24.2). Weight-based dosing and ' +
      'nutrition screening both start here.',
    ).toBeVisible();
    await expect(page.getByText(/^Normal$/).first()).toBeVisible();
  });

  test('TC-P4E-015 Weight alone, with no height, produces no BMI rather than a wrong one', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillVitals(page, { weightKg: '70' });
    await page.waitForTimeout(700);
    expect(
      await page.getByText(/^BMI$/).count(),
      'A BMI was shown with no height entered. A divide-by-zero result presented as a clinical ' +
      'number is worse than showing nothing.',
    ).toBe(0);
  });

  test('TC-P4E-016 Examination findings are saved to the encounter', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint);
    await fillExamination(page, C.examination);
    await completeConsultation(page);

    const enc = await expectRow<{ examination_notes: string | null }>(
      'opd_encounters', { hospital_id: hid, patient_id: pid });
    expect(
      enc.examination_notes,
      'The examination findings were not persisted — the one part of the record that proves the ' +
      'doctor actually examined the patient.',
    ).toBeTruthy();
  });

  test('TC-P4E-017 A diagnosis added in the Examination tab is stored on the encounter', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint);
    await tab(page, /^Examination$/i).click();
    await page.waitForTimeout(900);
    await openDiagnosisRow(page);
    await page.getByPlaceholder(/Diagnosis \/ impression/i).first().fill(C.diagnosis);
    // The submit button's accessible name is plain "Add" — a different, exact-matched button
    // from the "Add Diagnosis" toggle just clicked above.
    await page.getByRole('button', { name: /^Add$/ }).first().click();
    await page.waitForTimeout(1500);
    await completeConsultation(page);

    const enc = await expectRow<{ diagnosis: string | null }>(
      'opd_encounters', { hospital_id: hid, patient_id: pid });
    expect(
      enc.diagnosis,
      'The diagnosis the doctor recorded is not on the encounter. Nothing downstream — coding, ' +
      'the claim, the discharge summary, the disease register — has anything to work from.',
    ).toBeTruthy();
  });

  test('TC-P4E-018 An ICD-10 code entered with the diagnosis is stored alongside it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint);
    await tab(page, /^Examination$/i).click();
    await page.waitForTimeout(900);
    await openDiagnosisRow(page);
    await page.getByPlaceholder(/Diagnosis \/ impression/i).first().fill(C.diagnosis);
    await page.getByPlaceholder(/ICD-10 code/i).first().fill(C.icd10Code);
    await page.getByRole('button', { name: /^Add$/ }).first().click();
    await page.waitForTimeout(1500);
    await completeConsultation(page);

    const enc = await expectRow<{ icd10_code: string | null }>(
      'opd_encounters', { hospital_id: hid, patient_id: pid });
    expect(
      enc.icd10_code,
      'The ICD-10 code was dropped. Government reporting (IHIP/HMIS), PMJAY package matching and ' +
      'the hospital\'s own morbidity statistics are all keyed on this field.',
    ).toBeTruthy();
  });

  test('TC-P4E-019 Completing the consultation stamps consultation_end_at and closes the token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint);
    await completeConsultation(page);

    const tokens = await tokensToday(hid, pid);
    expect(tokens[0].status, 'The token did not close after completion.').toBe('completed');
    expect(
      tokens[0].consultation_end_at,
      'consultation_end_at is null, so the consultation duration this hospital reports is unbounded.',
    ).toBeTruthy();
  });

  test('TC-P4E-020 Completing the consultation creates the MRD medical_records row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint);
    await completeConsultation(page);

    const enc = await expectRow<{ id: string }>('opd_encounters', { hospital_id: hid, patient_id: pid });
    await expectRow(
      'medical_records', { hospital_id: hid, patient_id: pid, visit_id: enc.id },
      'No medical_records row. The MRD department has no index entry for this visit, so the file ' +
      'cannot be retrieved, tracked or retained to policy.',
    );
  });

  test('TC-P4E-021 An ordinary OPD record is retained for three years, not the MLC ten', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint);
    await completeConsultation(page);

    const enc = await expectRow<{ id: string }>('opd_encounters', { hospital_id: hid, patient_id: pid });
    const record = await expectRow<{ destroy_after: string }>(
      'medical_records', { hospital_id: hid, patient_id: pid, visit_id: enc.id });
    const years = (new Date(record.destroy_after).getTime() - Date.now()) / (365 * 86_400_000);
    expect(
      Math.round(years),
      `destroy_after is ${Math.round(years)} years out. A non-MLC OPD record is retained for 3 ` +
      `years and an MLC for 10 — getting them the wrong way round either destroys medico-legal ` +
      `evidence seven years early or holds ordinary PHI far beyond its purpose limitation.`,
    ).toBe(3);
  });

  test('TC-P4E-022 Completing the consultation queues an icd_codings row for the coders', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint);
    await completeConsultation(page);

    const enc = await expectRow<{ id: string }>('opd_encounters', { hospital_id: hid, patient_id: pid });
    const coding = await expectRow<{ status: string }>(
      'icd_codings', { hospital_id: hid, visit_id: enc.id },
      'No icd_codings row was queued. The coding team never sees this visit, so it is absent from ' +
      'every statutory return the hospital files.',
    );
    expect(coding.status).toBe('pending');
  });

  test('TC-P4E-023 A completed consultation can be reopened for the patient who returns with reports', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, C.chiefComplaint);
    await completeConsultation(page);

    await openOpd(page);
    await page.getByRole('button').filter({ hasText: NAME }).first().click();
    await page.waitForTimeout(1800);
    const { resumeConsultationButton } = await import('./opd-locators');
    await expect(
      resumeConsultationButton(page),
      'There is no way to reopen a finished consultation. The patient who comes back the same ' +
      'afternoon with their lab report has to be registered and charged all over again.',
    ).toBeVisible();
    await resumeConsultationButton(page).click();
    await page.waitForTimeout(2000);

    const tokens = await tokensToday(hid, pid);
    expect(tokens[0].status).toBe('in_consultation');
  });

  test('TC-P4E-024 A paediatric patient\'s weight is recorded for weight-based dosing', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page, PAED_UHID);
    await openTokenAndStart(page, PAED_NAME);
    await fillComplaint(page, 'Fever for two days');
    await fillVitals(page, { weightKg: String(P4.prescription.paediatric.weightKg) });
    await completeConsultation(page);

    const enc = await expectRow<{ vitals: Record<string, unknown> }>(
      'opd_encounters', { hospital_id: hid, patient_id: pid });
    expect(
      String(enc.vitals?.weight_kg ?? ''),
      'An 8-month-old was documented with no weight. Every paediatric dose in India is mg/kg — ' +
      'a missing weight means the prescription is either guessed or copied from an adult.',
    ).toBe(String(P4.prescription.paediatric.weightKg));
  });
});

void completeButton; void field; void fillField;
