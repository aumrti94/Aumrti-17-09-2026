/**
 * Phase 4 — the multi-step OPD journeys, written once.
 *
 * Almost every case in this phase needs the same preamble: open /opd, register a walk-in,
 * pay, get a token, open it, start the consultation. Repeating those ~15 UI steps in 260
 * tests would make each one unreadable and every locator change a 260-file edit.
 *
 * These are FLOWS, not assertions. A flow gets the app into the state a case starts from and
 * returns what the case needs to assert on. It deliberately does not assert anything itself —
 * if a flow starts failing, the spec that called it reports the failure at the step it cares
 * about, and `docs/qa/README.md`'s rule still holds: the database is what proves the pass,
 * not the toast the flow waited for.
 */
import { type Page, expect } from '@playwright/test';
import {
  OPD_ROUTE, openOpd, registerWalkInButton, walkInSearch, field, fillField, selectOption,
  toggle, dpdpConsentCheckbox, mlcCheckbox, proceedToPaymentButton, payAndIssueButton,
  doneButton, consultationFee, rateSourceBadge, queueRow, startConsultationButton,
  completeButton, tab, awaitSaveAck, drugSearchInput, addDrugButton, labSearchInput,
} from './opd-locators';

export interface WalkInOptions {
  /** Search text that resolves an EXISTING patient — a UHID, phone or name. */
  existingPatientQuery?: string;
  /** Fields for a brand-new patient. Ignored when `existingPatientQuery` is set. */
  newPatient?: { fullName: string; phone?: string; age?: string; address?: string; allergies?: string };
  department: string;
  doctor: string;
  priority?: 'normal' | 'urgent' | 'emergency' | string;
  visitType?: 'New' | 'Revisit' | 'Follow-up' | 'Emergency';
  visitPurpose?: string;
  payerType?: string;
  payerName?: string;
  isMlc?: boolean;
  policeStation?: string;
  paymentMode?: 'Cash' | 'UPI' | 'Card';
  paymentRef?: string;
  /** Stop after the details step, before paying — for cases that assert on the fee preview. */
  stopAtPayment?: boolean;
}

export interface WalkInResult {
  /** The fee the payment step displayed, in rupees. */
  fee: number;
  /** "Doctor rate" / "Dept rate" / "Global rate" / "Default rate" / "Follow-up rate (within Nd)" / "Emergency rate". */
  rateSource: string;
}

/** Open the walk-in modal from the OPD queue. */
export async function openWalkIn(page: Page): Promise<void> {
  await openOpd(page);
  await registerWalkInButton(page).click();
  await page.waitForTimeout(900);
}

/**
 * Fill the walk-in details step. Leaves the modal ON the details step.
 * Returns nothing — callers that want the fee call `proceedToPayment` next.
 */
export async function fillWalkInDetails(page: Page, opts: WalkInOptions): Promise<void> {
  if (opts.existingPatientQuery) {
    await walkInSearch(page).fill(opts.existingPatientQuery);
    await page.waitForTimeout(1400);
    // The modal auto-selects when exactly one match comes back; click the row when it doesn't.
    const suggestion = page.getByRole('button').filter({ hasText: opts.existingPatientQuery }).first();
    if (await suggestion.count()) await suggestion.click().catch(() => { /* already selected */ });
    await page.waitForTimeout(600);
  } else if (opts.newPatient) {
    await fillField(page, 'Full Name', opts.newPatient.fullName);
    if (opts.newPatient.age) await fillField(page, 'Age', opts.newPatient.age);
    if (opts.newPatient.address) await fillField(page, 'Address', opts.newPatient.address).catch(() => { /* collapsed section */ });
    if (opts.newPatient.allergies) await fillField(page, 'Known Allergies', opts.newPatient.allergies).catch(() => { /* collapsed section */ });
  }

  await selectOption(page, 'Department', opts.department);
  await page.waitForTimeout(500);
  await selectOption(page, 'Doctor', opts.doctor);
  await page.waitForTimeout(900);

  if (opts.priority) await toggle(page, new RegExp(opts.priority, 'i')).click().catch(() => { /* default kept */ });
  if (opts.visitType) await toggle(page, new RegExp(`^${opts.visitType}$`, 'i')).click();
  if (opts.visitPurpose) await selectOption(page, 'Visit Purpose', opts.visitPurpose);

  if (opts.isMlc) {
    await mlcCheckbox(page).check();
    if (opts.policeStation) await page.getByPlaceholder(/police station/i).fill(opts.policeStation);
  }

  if (opts.payerType) {
    await selectOption(page, 'Payer Type', opts.payerType);
    await page.waitForTimeout(500);
    if (opts.payerName) {
      const payerSelect = page.locator('select').filter({ hasText: /select payer/i }).first();
      if (await payerSelect.count()) {
        await payerSelect.selectOption({ label: opts.payerName }).catch(async () => {
          const options = await payerSelect.locator('option').allInnerTexts();
          const match = options.find(o => o.toLowerCase().includes(opts.payerName!.toLowerCase()));
          if (match) await payerSelect.selectOption({ label: match });
        });
      }
    }
  }

  // Only new patients see the DPDP block — an existing record already has consent on file.
  if (!opts.existingPatientQuery) {
    await dpdpConsentCheckbox(page).check().catch(() => { /* not rendered for existing patients */ });
  }

  await page.waitForTimeout(700);
}

/** Move to the payment step and read back the fee the app decided on. */
export async function proceedToPayment(page: Page): Promise<WalkInResult> {
  await proceedToPaymentButton(page).click();
  await page.waitForTimeout(1200);

  // "Patient already in queue today" can interrupt here — the second-token scenarios expect it.
  const registerAnyway = page.getByRole('button', { name: /register anyway/i });
  if (await registerAnyway.count()) {
    await registerAnyway.click();
    await page.waitForTimeout(900);
  }

  return { fee: await consultationFee(page), rateSource: await rateSourceBadge(page) };
}

/** Pay and issue the token. Closes the receipt so the queue refreshes. */
export async function payAndIssue(page: Page, opts: { paymentMode?: string; paymentRef?: string } = {}): Promise<void> {
  if (opts.paymentMode && !/cash/i.test(opts.paymentMode)) {
    await toggle(page, new RegExp(opts.paymentMode, 'i')).click();
    await page.waitForTimeout(400);
    if (opts.paymentRef) await fillField(page, 'Reference / Txn ID', opts.paymentRef);
  }
  await payAndIssueButton(page).click();
  await page.waitForTimeout(3000);
  await doneButton(page).click().catch(() => { /* receipt already dismissed */ });
  await page.waitForTimeout(1800);
}

/** The whole walk-in journey: open → fill → pay → token issued. */
export async function registerWalkIn(page: Page, opts: WalkInOptions): Promise<WalkInResult> {
  await openWalkIn(page);
  await fillWalkInDetails(page, opts);
  const result = await proceedToPayment(page);
  if (!opts.stopAtPayment) {
    await payAndIssue(page, { paymentMode: opts.paymentMode, paymentRef: opts.paymentRef });
  }
  return result;
}

/** Select a patient's token in the queue and start the consultation. */
export async function openTokenAndStart(page: Page, patientName: string): Promise<void> {
  await openOpd(page);
  // A token registered moments earlier in the same test can lag behind the queue's realtime
  // refresh under sustained real-browser load (found live — TC-P4G-017 timed out here with no
  // error, the row simply hadn't rendered yet). openOpd()'s own wait only confirms the queue
  // PANEL is ready, not that THIS row is in it — wait for the row itself before clicking.
  const row = queueRow(page, patientName);
  await row.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => { /* fall through — the click below reports the real failure */ });
  await row.click();
  await page.waitForTimeout(1500);
  const start = startConsultationButton(page);
  if (await start.count()) {
    await start.click();
    await page.waitForTimeout(1800);
  }
}

/** Fill the Complaint tab. */
export async function fillComplaint(page: Page, complaint: string, hpi?: string, duration?: string): Promise<void> {
  await tab(page, /^Complaint$/i).click();
  await page.waitForTimeout(700);
  await fillField(page, 'Chief Complaint', complaint);
  if (hpi) await fillField(page, 'History of Present Illness', hpi);
  if (duration) await fillField(page, 'Duration', duration).catch(() => { /* optional */ });
  await page.waitForTimeout(500);
}

export interface VitalsInput {
  bpSystolic?: string; bpDiastolic?: string; pulse?: string;
  temperature?: string; spo2?: string; weightKg?: string; heightCm?: string;
}

/**
 * Fill the Vitals tab.
 *
 * Vitals cards are `<label>` + `<input>` with no association, and BP is TWO inputs under one
 * label, so they are addressed by placeholder (120 / 80 / 72 / 98.6 / 98 / 65 / 170) — the
 * placeholders are stable defaults written into VitalsTab.tsx.
 */
export async function fillVitals(page: Page, v: VitalsInput): Promise<void> {
  await tab(page, /^Vitals$/i).click();
  await page.waitForTimeout(700);
  const byPlaceholder = async (ph: string, value?: string) => {
    if (value === undefined) return;
    await page.getByPlaceholder(ph, { exact: true }).first().fill(value);
  };
  await byPlaceholder('120', v.bpSystolic);
  await byPlaceholder('80', v.bpDiastolic);
  await byPlaceholder('72', v.pulse);
  await byPlaceholder('98.6', v.temperature);
  await byPlaceholder('98', v.spo2);
  await byPlaceholder('65', v.weightKg);
  await byPlaceholder('170', v.heightCm);
  await page.waitForTimeout(500);
}

/** Fill the Examination tab's free-text notes. */
export async function fillExamination(page: Page, notes: string): Promise<void> {
  await tab(page, /^Examination$/i).click();
  await page.waitForTimeout(700);
  const box = page.locator('textarea').first();
  await box.fill(notes);
  await page.waitForTimeout(400);
}

/**
 * Add a drug through the Rx & Orders tab.
 *
 * Returns TRUE when the drug-safety modal interrupted — that is the assertion most of Section
 * 4F is built on, so it is the return value rather than a side effect.
 */
export async function addDrug(page: Page, drug: {
  drugName: string; dose?: string; durationDays?: string; quantity?: string; instructions?: string;
}): Promise<boolean> {
  await tab(page, /Rx & Orders/i).click();
  await page.waitForTimeout(900);
  await addDrugButton(page).click();
  await page.waitForTimeout(600);

  await drugSearchInput(page).fill(drug.drugName);
  await page.waitForTimeout(1200);
  // Take the master-list suggestion when one appears, so the prescription carries the
  // catalogue spelling rather than what was typed.
  const suggestion = page.getByRole('button').filter({ hasText: new RegExp(drug.drugName, 'i') }).first();
  if (await suggestion.count()) await suggestion.click().catch(() => { /* free-text entry */ });
  await page.waitForTimeout(500);

  if (drug.dose) await page.getByPlaceholder('Dose').first().fill(drug.dose);
  if (drug.durationDays) await page.getByPlaceholder('Days').first().fill(drug.durationDays);
  if (drug.quantity) await page.getByPlaceholder('Auto').first().fill(drug.quantity);
  if (drug.instructions) await page.getByPlaceholder(/Instructions/i).first().fill(drug.instructions);

  // "Add to Prescription" runs checkDrugSafety() first — it is the gate, not a plain submit.
  await page.getByRole('button', { name: /add to prescription|checking safety/i }).first().click();
  await page.waitForTimeout(3000);

  // An antibiotic-stewardship gate (RxOrdersTab.tsx's isAntibioticByName check) fires BEFORE
  // checkDrugSafety() for drugs matching ANTIBIOTIC_KEYWORDS (e.g. amoxicillin, augmentin),
  // opening AntibioticJustificationModal instead of the safety modal. Satisfy it so the flow
  // reaches the underlying safety check — its onSaved callback re-invokes that check
  // automatically, so no re-click of "Add to Prescription" is needed afterward.
  const antibioticModal = page.getByText(/Antibiotic Stewardship — Justification/i).first();
  if (await antibioticModal.count()) {
    await page.getByPlaceholder(/community-acquired pneumonia/i).first()
      .fill('QA automated justification — routine empirical therapy.');
    await page.getByRole('button', { name: /save justification/i }).first().click();
    await page.waitForTimeout(2500);
  }

  return (await page.getByText(/CONTRAINDICATION DETECTED|Drug Safety|Override with clinical justification/i).count()) > 0;
}

/** Add a lab test by name through the Rx & Orders tab. */
export async function addLabTest(page: Page, testName: string): Promise<void> {
  await tab(page, /Rx & Orders/i).click();
  await page.waitForTimeout(900);
  await labSearchInput(page).fill(testName);
  await page.waitForTimeout(1000);
  const suggestion = page.getByRole('button').filter({ hasText: new RegExp(testName, 'i') }).first();
  if (await suggestion.count()) {
    await suggestion.click();
  } else {
    // No catalogue match. RxOrdersTab.tsx's lab search input has an onKeyDown handler that
    // accepts the typed text verbatim on Enter — the identical action the adjacent inline "+"
    // button performs. Enter on the input itself is unambiguous; a bare
    // getByRole('button', {name:'+'}) is not scoped to this panel and can match a WRONG "+"
    // button elsewhere on the page (found live: it opened a global "Quick Registration" modal
    // instead, blocking every later step in the test). This is the path that produces a
    // silently-dropped order (SETTINGS_PREREQ_MATRIX.md), and 4G tests it.
    await labSearchInput(page).press('Enter');
  }
  await page.waitForTimeout(900);
}

/** Finalise the consultation. */
export async function completeConsultation(page: Page): Promise<void> {
  await completeButton(page).click();
  await awaitSaveAck(page);
  await page.waitForTimeout(2500);
}

/** The whole "seen by the doctor" journey for a token already in the queue. */
export async function runConsultation(page: Page, opts: {
  patientName: string; complaint: string; hpi?: string;
  vitals?: VitalsInput; examination?: string; diagnosis?: string;
  complete?: boolean;
}): Promise<void> {
  await openTokenAndStart(page, opts.patientName);
  await fillComplaint(page, opts.complaint, opts.hpi);
  if (opts.vitals) await fillVitals(page, opts.vitals);
  if (opts.examination) await fillExamination(page, opts.examination);
  if (opts.diagnosis) {
    await tab(page, /Plan & Advice/i).click().catch(() => { /* tab absent for this specialty */ });
    await page.waitForTimeout(600);
    await fillField(page, 'Diagnosis', opts.diagnosis).catch(() => { /* diagnosis lives in the Rx tab for some layouts */ });
  }
  if (opts.complete !== false) await completeConsultation(page);
}

/** True when the OPD queue actually rendered (as opposed to a permission or plan gate). */
export async function opdQueueVisible(page: Page): Promise<boolean> {
  return (await page.getByText(/OPD Queue|Call Next|Register Walk-?in/i).count()) > 0;
}

export { OPD_ROUTE, expect };
