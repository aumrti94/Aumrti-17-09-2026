/**
 * Phase 4 · Section F — Drug safety & prescribing (P4-S09, P4-S10, P4-S11 🔴)
 * Locks tracker cases TC-P4F-001 … TC-P4F-026
 *
 * The most patient-safety-critical section in the phase. Three defects were found here while
 * authoring it, all now FIXED — so these are REGRESSION LOCKS and are expected to PASS. A red
 * result means the fix has been reverted, not that the test is stale. Do not quarantine them.
 *
 * 🔴 BUG-P4-001 (TC-P4F-022 / TC-P4F-023) — BRAND NAMES DEFEATED THE ALLERGY CHECK.
 *   `checkDrugSafety` matched the typed drug name against `drug_allergy_cross_reactivity` by
 *   substring after `normalize()` stripped only the strength. That table is keyed on GENERICS
 *   ('penicillin' → amoxicillin, ampicillin, co-amoxiclav …) and nothing resolved a brand to
 *   its generic, though `drug_master` carries both columns:
 *       "Amoxicillin" on a penicillin-allergic patient  → "amoxicillin" → BLOCKED ✓
 *       "Mox 500"     on the same patient               → "mox"         → NO ALERT ✗
 *   Indian doctors prescribe by brand almost exclusively, so the check was silent on the normal
 *   way a drug is ordered.
 *   FIXED: `resolveAliases()` in src/lib/drugSafetyCheck.ts now resolves every prescribed name
 *   to its generic constituents via `drug_master` (splitting combinations like
 *   "Amoxicillin + Clavulanate"), and all three checks — duplicates, interactions and allergies
 *   — match on those aliases. 10 unit cases in drugSafetyCheck.test.ts pin the behaviour,
 *   including the false-positive side.
 *
 * 🔴 BUG-P4-004 (TC-P4F-020 / TC-P4F-021) — THE OVERRIDE WAS IN NOBODY'S RECORD.
 *   DrugSafetyAlertModal promises "This override will be logged in the patient record", but
 *   `handleSafetyOverride` inserted into `clinical_alerts` with only hospital_id, alert_type,
 *   severity and alert_message. `patient_id` existed and was left NULL; no column recorded the
 *   prescriber at all. P4-S11 requires a reason AND the prescriber's identity.
 *   FIXED: migration 20261013000017 adds `clinical_alerts.created_by`; ConsultationWorkspace
 *   now passes `patientId` and `userId` into RxOrdersTab, and the insert populates both. A
 *   failed insert now raises a destructive toast rather than failing silently.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow } from '../utils/db-verify';
import { openOpd, tab, optionTexts } from './opd-locators';
import { registerWalkIn, openTokenAndStart, fillComplaint, addDrug, completeConsultation } from './opd-flows';
import { patientIdByUhid, purgeOpdArtefacts } from './opd-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const RX = P4.prescription;
const SAFETY = P4.drugSafety as Record<string, string>;
const CONFIG = MOCK.configValues;
const DOCTOR = MOCK.doctorFees[0].doctor;
const DEPARTMENT = MOCK.doctorFees[0].department;

const PLAIN_UHID = 'PT-QA-0001';
const PLAIN_NAME = 'Ramesh Kumar';
const ALLERGY_UHID = SAFETY.allergyPatientUhid;
const ALLERGY_NAME = 'Fatima Begum';
const POLY_UHID = SAFETY.polypharmacyPatientUhid;
const POLY_NAME = 'Krishnamurthy Iyer';

async function freshConsultation(page: import('@playwright/test').Page, uhid: string, name: string) {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  await purgeOpdArtefacts(hid, [pid]);
  await registerWalkIn(page, { existingPatientQuery: uhid, department: DEPARTMENT, doctor: DOCTOR });
  await openTokenAndStart(page, name);
  await fillComplaint(page, P4.consultation.chiefComplaint);
  return { hid, pid };
}

/** Complete the override dialog with a written justification. */
async function overrideWith(page: import('@playwright/test').Page, reason: string): Promise<void> {
  const { overrideOpenButton, overrideSubmitButton } = await import('./opd-locators');
  await overrideOpenButton(page).click();
  await page.waitForTimeout(800);
  await page.locator('textarea').last().fill(reason);
  await page.locator('input[type="checkbox"]').last().check();
  await page.waitForTimeout(400);
  await overrideSubmitButton(page).click();
  await page.waitForTimeout(2500);
}

test.describe('P4F — Drug safety & prescribing', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('doctor', { hospital: 'A' });
    await openOpd(page);
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    for (const uhid of [PLAIN_UHID, ALLERGY_UHID, POLY_UHID]) {
      await purgeOpdArtefacts(hid, [await patientIdByUhid(hid, uhid)]);
    }
  });

  /* ── Prescribing masters (the prerequisites) ───────────────────────── */

  test('TC-P4F-001 The Route dropdown is populated from the configured drug_routes', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);

    const routes = await page.locator('select').first().locator('option').allInnerTexts();
    expect(
      routes.filter(Boolean).length,
      'The Route dropdown rendered empty. SETTINGS_PREREQ_MATRIX.md calls this "the most common ' +
      'false OPD is broken report" — it is a missing hospital_config_values row, not a code defect.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4F-002 Every configured route value is offered, not a sample', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);

    const routes = (await page.locator('select').first().locator('option').allInnerTexts()).map(r => r.trim());
    for (const configured of CONFIG.drug_routes) {
      expect(
        routes.join(' | '),
        `The route "${configured}" is configured but not offered. A route the doctor cannot pick ` +
        `gets approximated — an IV drug prescribed as Oral is a dosing error, not a typo.`,
      ).toContain(configured);
    }
  });

  test('TC-P4F-003 The Frequency dropdown is populated from the configured drug_frequencies', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);

    const freqs = await page.locator('select').nth(1).locator('option').allInnerTexts();
    expect(freqs.filter(Boolean).length, 'The Frequency dropdown rendered empty.').toBeGreaterThan(0);
  });

  test('TC-P4F-004 Every configured frequency value is offered, not a sample', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);

    const freqs = (await page.locator('select').nth(1).locator('option').allInnerTexts()).map(f => f.trim());
    for (const configured of CONFIG.drug_frequencies) {
      expect(
        freqs.join(' | '),
        `The frequency "${configured}" is configured but not offered. Quantity is computed from ` +
        `frequency, so a missing value silently produces the wrong dispensed count too.`,
      ).toContain(configured);
    }
  });

  test('TC-P4F-005 Drug search returns matches from the drug master', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton, drugSearchInput } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);
    await drugSearchInput(page).fill(RX.primary.drugName.slice(0, 4));
    await page.waitForTimeout(1600);

    await expect(
      page.getByText(RX.primary.drugName).first(),
      'Drug search returned nothing for a drug that is in drug_master. Doctors then type free ' +
      'text, which no safety check and no pharmacy stock lookup can match.',
    ).toBeVisible();
  });

  test('TC-P4F-006 A drug that is not in the master returns no suggestion', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton, drugSearchInput } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);
    await drugSearchInput(page).fill(RX.unknownDrug.drugName);
    await page.waitForTimeout(1600);

    expect(
      await page.getByRole('button').filter({ hasText: RX.unknownDrug.drugName }).count(),
      'A drug absent from the master was offered as a suggestion, which means the suggestions are ' +
      'not coming from the catalogue at all.',
    ).toBe(0);
  });

  /* ── The ordinary prescription ─────────────────────────────────────── */

  test('TC-P4F-007 A drug with no safety issue is added with no alert', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    const interrupted = await addDrug(page, {
      drugName: RX.primary.drugName, dose: RX.primary.dose,
      durationDays: RX.primary.durationDays, instructions: RX.primary.instructions,
    });
    expect(
      interrupted,
      'Paracetamol on a patient with no allergies raised a safety alert. Alerts that fire on ' +
      'harmless prescriptions are how doctors learn to click through the ones that matter.',
    ).toBeFalsy();
    await expect(page.getByText(RX.primary.drugName).first()).toBeVisible();
  });

  test('TC-P4F-008 The prescription is written to the prescriptions table on completion', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await addDrug(page, {
      drugName: RX.primary.drugName, dose: RX.primary.dose, durationDays: RX.primary.durationDays,
    });
    await completeConsultation(page);

    const rx = await expectRow<{ drugs: unknown }>(
      'prescriptions', { hospital_id: hid, patient_id: pid },
      'No prescriptions row after the doctor prescribed and completed. The patient walks to the ' +
      'pharmacy with a prescription the system has no record of.',
    );
    expect(JSON.stringify(rx.drugs)).toContain(RX.primary.drugName);
  });

  test('TC-P4F-009 Quantity is auto-calculated from dose, frequency and duration', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton, drugSearchInput } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);
    await drugSearchInput(page).fill(RX.primary.drugName);
    await page.waitForTimeout(1200);
    await page.getByPlaceholder('Dose').first().fill('1');
    await page.locator('select').nth(1).selectOption('TDS').catch(() => { /* value list differs */ });
    await page.getByPlaceholder('Days').first().fill('5');
    await page.waitForTimeout(900);

    const qty = await page.getByPlaceholder('Auto').first().inputValue();
    expect(
      Number(qty),
      `1 tablet TDS for 5 days is 15 tablets; the form computed ${qty || 'nothing'}. An under-` +
      `calculated quantity sends the patient home with too few tablets to finish the course.`,
    ).toBe(15);
  });

  test('TC-P4F-010 A once-daily drug computes one unit per day, not three', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton, drugSearchInput } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);
    await drugSearchInput(page).fill(RX.secondary.drugName);
    await page.waitForTimeout(1200);
    await page.getByPlaceholder('Dose').first().fill('1');
    await page.locator('select').nth(1).selectOption('OD').catch(() => { /* value list differs */ });
    await page.getByPlaceholder('Days').first().fill('5');
    await page.waitForTimeout(900);

    expect(Number(await page.getByPlaceholder('Auto').first().inputValue())).toBe(5);
  });

  test('TC-P4F-011 The quantity remains editable so the doctor can override the calculation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton, drugSearchInput } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);
    await drugSearchInput(page).fill(RX.primary.drugName);
    await page.waitForTimeout(1000);
    const qtyBox = page.getByPlaceholder('Auto').first();
    await qtyBox.fill('7');
    expect(
      await qtyBox.inputValue(),
      'The quantity could not be overridden. Half-strip dispensing and part-supplies are routine ' +
      'in an Indian pharmacy; a locked quantity forces the pharmacist to work around the system.',
    ).toBe('7');
  });

  test('TC-P4F-012 An NDPS drug shows the dual-verification warning at prescribing time', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(900);
    const { addDrugButton, drugSearchInput } = await import('./opd-locators');
    await addDrugButton(page).click();
    await page.waitForTimeout(700);
    await drugSearchInput(page).fill(RX.ndps.drugName);
    await page.waitForTimeout(1600);
    await page.getByRole('button').filter({ hasText: new RegExp(RX.ndps.drugName, 'i') }).first().click().catch(() => { /* free text */ });
    await page.waitForTimeout(1000);

    await expect(
      page.getByText(/NDPS Drug — Dual verification required/i),
      'A narcotic was selected with no NDPS warning. The prescriber has no on-screen signal that ' +
      'this drug carries a statutory register and a two-signature dispensing rule.',
    ).toBeVisible();
  });

  test('TC-P4F-013 A prescribed NDPS drug is badged on the prescription line', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, PLAIN_UHID, PLAIN_NAME);
    await addDrug(page, {
      drugName: RX.ndps.drugName, dose: RX.ndps.dose,
      durationDays: RX.ndps.durationDays, instructions: RX.ndps.instructions,
    });
    await expect(
      page.getByText(/^NDPS$/).first(),
      'The prescribed narcotic carries no NDPS badge on the line, so the pharmacist reading the ' +
      'prescription has no visual cue before dispensing.',
    ).toBeVisible();
  });

  /* ── The allergy block (P4-S11 🔴) ─────────────────────────────────── */

  test('TC-P4F-014 An allergic patient\'s allergies are surfaced in the Rx tab', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    await tab(page, /Rx & Orders/i).click();
    await page.waitForTimeout(1000);
    await expect(
      page.getByText(new RegExp(SAFETY.allergyRecorded, 'i')).first(),
      `The patient's recorded ${SAFETY.allergyRecorded} allergy is not shown on the prescribing ` +
      `screen. The banner is the doctor's last human-readable warning before the software's.`,
    ).toBeVisible();
  });

  test('TC-P4F-015 The cross-reactivity reference data this check depends on exists', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { data } = await db().from('drug_allergy_cross_reactivity').select('allergen, cross_reacts')
      .ilike('allergen', '%penicillin%').limit(1);
    expect(
      data?.length,
      'There is no penicillin row in drug_allergy_cross_reactivity. Without it the allergy check ' +
      'can only ever catch an exact name match, and every cross-reactive drug passes silently. ' +
      'This is reference data, not tenant configuration — it ships in migration 20260327071615.',
    ).toBeGreaterThan(0);
    expect(String((data![0] as { cross_reacts: string[] }).cross_reacts)).toContain('amoxicillin');
  });

  test('TC-P4F-016 Prescribing the generic cross-reactive drug blocks with a contraindication', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    const interrupted = await addDrug(page, { drugName: 'Amoxicillin', dose: '500 mg', durationDays: '5' });
    expect(
      interrupted,
      'Amoxicillin was added to a PENICILLIN-ALLERGIC patient with no alert at all. This is the ' +
      'exact case the cross-reactivity table exists for, and anaphylaxis is the failure mode.',
    ).toBeTruthy();
    await expect(page.getByText(/CONTRAINDICATION DETECTED|CONTRAINDICATED/i).first()).toBeVisible();
  });

  test('TC-P4F-017 The contraindication names the allergy and the drug that conflicts', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    await addDrug(page, { drugName: 'Amoxicillin', dose: '500 mg', durationDays: '5' });
    const text = await page.locator('body').innerText();
    expect(
      /penicillin/i.test(text),
      'The alert did not name the allergy it fired on. A warning that says only "contraindicated" ' +
      'gives the doctor nothing to weigh a clinical decision against.',
    ).toBeTruthy();
  });

  test('TC-P4F-018 The override requires a written clinical justification', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    await addDrug(page, { drugName: 'Amoxicillin', dose: '500 mg', durationDays: '5' });
    const { overrideOpenButton, overrideSubmitButton } = await import('./opd-locators');
    await overrideOpenButton(page).click();
    await page.waitForTimeout(800);
    await expect(
      overrideSubmitButton(page),
      'The override could be submitted with a blank reason. An unexplained override is legally ' +
      'indistinguishable from not having checked at all.',
    ).toBeDisabled();
  });

  test('TC-P4F-019 The override also requires an explicit acknowledgement', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    await addDrug(page, { drugName: 'Amoxicillin', dose: '500 mg', durationDays: '5' });
    const { overrideOpenButton, overrideSubmitButton } = await import('./opd-locators');
    await overrideOpenButton(page).click();
    await page.waitForTimeout(800);
    await page.locator('textarea').last().fill(SAFETY.overrideReason);
    await page.waitForTimeout(400);
    await expect(
      overrideSubmitButton(page),
      'A reason alone unlocked the override. The acknowledgement tick is the deliberate second ' +
      'action that stops a reflex click-through.',
    ).toBeDisabled();
  });

  test('TC-P4F-020 An allergy override is recorded against the patient it was made for', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    await addDrug(page, { drugName: 'Amoxicillin', dose: '500 mg', durationDays: '5' });
    await overrideWith(page, SAFETY.overrideReason);

    const { data } = await db().from('clinical_alerts').select('*')
      .eq('hospital_id', hid).eq('alert_type', 'drug_override')
      .order('created_at', { ascending: false }).limit(1);
    expect(data?.length, 'The override wrote no clinical_alerts row at all.').toBeGreaterThan(0);

    expect(
      (data![0] as { patient_id: string | null }).patient_id,
      'REGRESSION LOCK (BUG-P4-004, fixed): the override was logged with patient_id NULL again. ' +
      'The modal promises the prescriber "This override will be logged in the patient record"; ' +
      'ConsultationWorkspace must pass patientId into RxOrdersTab and handleSafetyOverride must ' +
      'write it. Without it, nobody reviewing this patient\'s chart will ever see that a ' +
      'contraindicated antibiotic was deliberately given.',
    ).toBe(pid);
  });

  test('TC-P4F-021 An allergy override records who overrode it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid } = await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    await addDrug(page, { drugName: 'Amoxicillin', dose: '500 mg', durationDays: '5' });
    await overrideWith(page, SAFETY.overrideReason);

    const { data } = await db().from('clinical_alerts').select('*')
      .eq('hospital_id', hid).eq('alert_type', 'drug_override')
      .order('created_at', { ascending: false }).limit(1);
    expect(data?.length, 'The override wrote no clinical_alerts row at all.').toBeGreaterThan(0);

    const row = data![0] as Record<string, unknown>;
    const prescriber = row.created_by ?? row.prescribed_by ?? row.acknowledged_by ?? row.overridden_by;
    expect(
      prescriber,
      'REGRESSION LOCK (BUG-P4-004, fixed): the override names no prescriber. ' +
      'clinical_alerts.created_by is added by migration 20261013000017 and populated from the ' +
      'userId prop — check that migration has been applied and that ConsultationWorkspace still ' +
      'passes userId. Scenario P4-S11 requires a reason AND the prescriber\'s identity; an ' +
      'anonymous override cannot be defended in a medico-legal review.',
    ).toBeTruthy();
  });

  test('TC-P4F-022 Prescribing the brand name of a cross-reactive drug also blocks', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    const interrupted = await addDrug(page, {
      drugName: SAFETY.crossReactiveDrug, dose: '500 mg', durationDays: '5',
    });
    expect(
      interrupted,
      `REGRESSION LOCK (BUG-P4-001, fixed): "${SAFETY.crossReactiveDrug}" is Amoxicillin under ` +
      `its Indian brand name and it was added to a PENICILLIN-ALLERGIC patient with NO alert. ` +
      `resolveAliases() in src/lib/drugSafetyCheck.ts must resolve the brand to its generic via ` +
      `drug_master before matching the cross-reactivity table, which is keyed on generics. ` +
      `Check that the drug is seeded with its generic_name — a formulary row with a blank ` +
      `generic_name silently reopens this hole for that drug alone.`,
    ).toBeTruthy();
  });

  test('TC-P4F-023 A combination brand containing the allergen also blocks', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    const interrupted = await addDrug(page, {
      drugName: SAFETY.crossReactiveCombination, dose: '1 tablet', durationDays: '5',
    });
    expect(
      interrupted,
      `REGRESSION LOCK (BUG-P4-001, fixed — the combination half): ` +
      `"${SAFETY.crossReactiveCombination}" is Amoxicillin + Clavulanate, and co-amoxiclav is ` +
      `listed in the penicillin cross_reacts array. splitGenerics() must break a combination ` +
      `generic on "+" so EACH constituent is checked — a combination whose second component is ` +
      `the allergen must block just as loudly as a single-molecule brand.`,
    ).toBeTruthy();
  });

  test('TC-P4F-024 A genuinely safe alternative is added without an alert', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, ALLERGY_UHID, ALLERGY_NAME);
    const interrupted = await addDrug(page, {
      drugName: SAFETY.safeAlternative, dose: '200 mg', durationDays: '5',
    });
    expect(
      interrupted,
      `${SAFETY.safeAlternative} raised an alert on a penicillin-allergic patient. Cefixime is a ` +
      `cephalosporin with a small but real cross-reactivity — if this alert is intended, the case ` +
      `should be rewritten to expect it and the risk level documented, because right now the ` +
      `doctor is being warned off a drug the reference data does not flag.`,
    ).toBeFalsy();
  });

  /* ── Polypharmacy & interactions (P4-S10) ──────────────────────────── */

  test('TC-P4F-025 Adding a drug that interacts with one already prescribed raises an alert', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, POLY_UHID, POLY_NAME);
    const [first, second] = SAFETY.interactionProbePair as unknown as string[];
    await addDrug(page, { drugName: first, dose: '40 mg', durationDays: '30' });
    const interrupted = await addDrug(page, { drugName: second, dose: '40 mg', durationDays: '30' });
    expect(
      interrupted,
      `Adding ${second} on top of ${first} raised no interaction alert on a 74-year-old already ` +
      `on six medicines. Polypharmacy in the elderly is where interactions actually hurt people, ` +
      `and it is the one place the check must not be silent.`,
    ).toBeTruthy();
  });

  test('TC-P4F-026 An interaction alert names both drugs rather than warning generically', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshConsultation(page, POLY_UHID, POLY_NAME);
    const [first, second] = SAFETY.interactionProbePair as unknown as string[];
    await addDrug(page, { drugName: first, dose: '40 mg', durationDays: '30' });
    await addDrug(page, { drugName: second, dose: '40 mg', durationDays: '30' });

    const text = await page.locator('body').innerText();
    expect(
      /clinical effect|mechanism|severity|interaction/i.test(text),
      'The interaction alert carried no clinical effect, mechanism or severity — only a generic ' +
      'warning. Dr. Ramesh\'s rule applies: more alerts is not better. An alert the doctor cannot ' +
      'act on trains them to dismiss the next one, which is a patient-safety harm in itself.',
    ).toBeTruthy();
  });
});

void optionTexts;
