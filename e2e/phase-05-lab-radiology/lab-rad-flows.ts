/**
 * Phase 5 — the multi-step Lab & Radiology journeys, written once.
 *
 * Phase 5's cases are WORKFLOWS, not field checks: "a haemolysed sample is rejected, recollected
 * and the patient is not charged twice" is one case with a dozen steps. Repeating those steps
 * inline across ~145 tests would make every test unreadable and every locator change a
 * 145-file edit.
 *
 * THE CONTRACT, same as `opd-flows.ts`: a flow gets the app into the state a case starts from
 * and returns what the case needs to assert on. **A flow never asserts.** If a flow starts
 * failing, the spec that called it reports the failure at the step it cares about, and
 * `docs/qa/README.md`'s rule still holds — the database is what proves the pass, never the toast
 * a flow waited for.
 *
 * ONE PLACE THIS IS EASY TO GET WRONG: `enterResult()` fills AND blurs. The result input saves
 * on `onBlur`, not on change (`LabResultWorkspace.tsx:1389`), so a fill without a blur updates
 * React state, shows the number on screen, and writes nothing at all. Every flow here blurs.
 */
import { type Page } from '@playwright/test';
import {
  LAB_TABS, COLLECTION_TABS, openLab, openLabTab, openLabOrder, queueFilterSelect,
  enterNumericResult, textResultSelect, markCollectedButton, submitForValidationButton,
  validateAndSignButton, validateAndReleaseButton, criticalNotifyCheckbox,
  acknowledgeCriticalButton, collectButton, receiveButton, processButton, rejectButton,
  rejectReasonSelect, rejectNoteInput, confirmRejectButton, identityConfirmDialog,
  paymentPendingDialog, overrideReasonInput, overrideConfirmButton, awaitSaveAck, toastText,
  proceedToPaymentButton, collectAndCreateButton,
} from './lab-locators';
import {
  RADIOLOGY_TABS,
  openRadiology, openStudy, startStudyButton, imagesAcquiredButton, beginReportButton,
  fillReportField, saveDraftButton, validateAndSignButton as radValidateAndSign,
  openPcpndtFormButton, pcpndtSexDeclarationCheckbox, pcpndtConsentCheckbox,
  savePcpndtFormButton, aiSuggestButton, aiUseThisButton, aiAttestationTextarea,
  aiAttestationCheckbox, aiAttestationAcceptButton,
  awaitSaveAck as radAwaitSaveAck, toastText as radToastText,
} from './radiology-locators';
import { MOCK } from '../fixtures/mock-data';

const P5 = MOCK.phase5;

/* ══ Payment-first ordering ═══════════════════════════════════════════ */

/**
 * Take the cash for an investigation a doctor prescribed in OPD, which is what CREATES the order.
 *
 * An OPD consultation deliberately writes no lab_orders / radiology_orders row — it saves the
 * prescription and stops. The tests reach the module as a "Pending from OPD" row, and the desk
 * turns that row into a real order and a paid bill in one step: Create Order → (the picker is
 * pre-filled from the prescription) → Proceed to Payment → Collect ₹X & Create Order.
 *
 * Phase 4 specs that assert an order exists must run this first. Before payment-first ordering
 * they did not have to, because completing the consultation created the order directly — and
 * charged an unpaid OPD bill while stamping the order "billed", which is the bug that model
 * replaced.
 *
 * Returns the toast so a caller can distinguish "collected" from "the gate refused".
 */
async function collectPendingFromOpd(
  page: Page,
  module: 'lab' | 'radiology',
  patientText: string,
): Promise<string> {
  if (module === 'lab') {
    await openLabTab(page, LAB_TABS.pendingOpd);
  } else {
    await openRadiology(page);
    await page.getByRole('tab', { name: RADIOLOGY_TABS.pendingOpd }).first().click().catch(async () => {
      await page.getByRole('button', { name: RADIOLOGY_TABS.pendingOpd }).first().click();
    });
  }
  await page.waitForTimeout(1_200);

  const row = page.locator('div').filter({ hasText: new RegExp(patientText, 'i') });
  const createBtn = row.getByRole('button', { name: /create order/i }).last();
  await createBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await createBtn.click();
  await page.waitForTimeout(1_500);

  // The modal opens on step 1 with the prescribed tests already ticked.
  const proceed = proceedToPaymentButton(page);
  if (await proceed.count()) {
    await proceed.click();
    await page.waitForTimeout(1_200);
  }

  const collect = collectAndCreateButton(page);
  await collect.waitFor({ state: 'visible', timeout: 15_000 });
  await collect.click();
  return module === 'lab' ? await toastText(page) : await radToastText(page);
}

export async function collectPendingLabFromOpd(page: Page, patientText: string): Promise<string> {
  await openLab(page);
  return collectPendingFromOpd(page, 'lab', patientText);
}

export async function collectPendingRadiologyFromOpd(page: Page, patientText: string): Promise<string> {
  return collectPendingFromOpd(page, 'radiology', patientText);
}

/* ══ Lab ══════════════════════════════════════════════════════════════ */

/**
 * Open an order in the result workspace from the worklist.
 *
 * Sets the queue filter to "All" first. The worklist defaults to a filtered view and, worse,
 * the "Ready" option maps to `partial_results` — a status no code in the app ever writes — so a
 * flow that trusted the default filter could look at a permanently empty list and report "the
 * order was never created" for an order that exists.
 */
export async function openOrderInWorklist(page: Page, rowText: string): Promise<void> {
  await openLabTab(page, LAB_TABS.worklist);
  const filter = queueFilterSelect(page);
  if (await filter.count()) {
    await filter.selectOption({ label: 'All' }).catch(() => { /* already unfiltered */ });
    await page.waitForTimeout(900);
  }
  await openLabOrder(page, rowText);
}

/**
 * Collect a sample through the Collection workstation — the path a phlebotomist actually uses.
 *
 * Clears the two-identifier confirm dialog that gates every collection here
 * (`CollectionWorkstation.tsx:365-372`). Returns whether the pre-payment gate blocked it, so a
 * pre-paid case can assert the block and a post-paid case can assert its absence, without either
 * of them having to know which dialog appeared.
 */
export async function collectSample(page: Page, rowText: string): Promise<{ blocked: boolean; toast: string }> {
  await openLabTab(page, LAB_TABS.collection);
  const btn = collectButton(page, rowText);
  await btn.waitFor({ state: 'visible', timeout: 20_000 });
  await btn.scrollIntoViewIfNeeded().catch(() => { /* already in view */ });
  await btn.click();
  await page.waitForTimeout(1_200);

  // Two-identifier confirmation, when the dialog is showing.
  if (await identityConfirmDialog(page).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /confirm|yes|proceed/i }).first()
      .click().catch(() => { /* auto-confirmed */ });
    await page.waitForTimeout(1_200);
  }

  const blocked = await paymentPendingDialog(page).isVisible().catch(() => false);
  const t = await toastText(page, blocked ? 2_000 : 10_000);
  if (!blocked) await page.waitForTimeout(900);
  return { blocked, toast: t };
}

/** Override the pre-payment gate with a reason. Returns the toast so a case can read it. */
export async function overridePaymentGate(page: Page, reason: string): Promise<string> {
  const input = overrideReasonInput(page);
  if (await input.count()) await input.fill(reason);
  await overrideConfirmButton(page).click();
  await page.waitForTimeout(1_500);
  return toastText(page);
}

export async function receiveSample(page: Page, rowText: string): Promise<void> {
  await openLabTab(page, LAB_TABS.collection);
  await page.getByRole('button', { name: COLLECTION_TABS.collected }).first().click();
  await page.waitForTimeout(1_000);
  await receiveButton(page, rowText).click();
  await awaitSaveAck(page);
}

export async function processSample(page: Page, rowText: string): Promise<void> {
  await openLabTab(page, LAB_TABS.collection);
  await page.getByRole('button', { name: COLLECTION_TABS.received }).first().click();
  await page.waitForTimeout(1_000);
  await processButton(page, rowText).click();
  await awaitSaveAck(page);
}

/**
 * Reject a sample with a reason, from whichever collection tab it currently sits in.
 *
 * `fromTab` is explicit rather than searched-for because the Reject button is rendered on EVERY
 * non-rejected tab — including "To Collect", where rejecting a sample nobody has drawn yet is
 * possible and immediately queues a recollection for a draw that never happened. That is a
 * finding (L9), and a flow that quietly picked whichever tab had a match would hide it.
 */
export async function rejectSample(page: Page, opts: {
  rowText: string;
  fromTab: RegExp;
  reason: string;
  note?: string;
}): Promise<string> {
  await openLabTab(page, LAB_TABS.collection);
  await page.getByRole('button', { name: opts.fromTab }).first().click();
  await page.waitForTimeout(1_000);

  await rejectButton(page, opts.rowText).click();
  await page.waitForTimeout(900);

  const select = rejectReasonSelect(page);
  if (await select.count()) {
    await select.selectOption({ label: opts.reason })
      .catch(() => select.selectOption(opts.reason));
  }
  if (opts.note) {
    const note = rejectNoteInput(page);
    if (await note.count()) await note.fill(opts.note);
  }

  await confirmRejectButton(page).click();
  await page.waitForTimeout(1_800);
  return toastText(page);
}

/** Mark collected from the result workspace — the OTHER collection path (see finding L10). */
export async function markCollectedFromWorkspace(page: Page): Promise<{ toast: string; dialogShown: boolean }> {
  await markCollectedButton(page).click();
  await page.waitForTimeout(1_500);
  const dialogShown = await paymentPendingDialog(page).isVisible().catch(() => false);
  return { toast: await toastText(page, dialogShown ? 2_000 : 10_000), dialogShown };
}

/**
 * Type a numeric result and let it save.
 *
 * The blur is what persists it. See this file's header.
 */
export async function enterResult(page: Page, testName: string, value: string): Promise<void> {
  await enterNumericResult(page, testName, value);
}

export async function enterTextResult(page: Page, testName: string, option: string): Promise<void> {
  const select = textResultSelect(page, testName);
  await select.waitFor({ state: 'visible', timeout: 20_000 });
  await select.selectOption({ label: option }).catch(() => select.selectOption(option));
  await page.waitForTimeout(1_500);
}

/**
 * Work the critical-value banner: tick "I have notified the treating doctor", then Acknowledge.
 *
 * The Acknowledge button is disabled until the checkbox is ticked
 * (`LabResultWorkspace.tsx:1490`), which is the point of the control — an acknowledgement that
 * did not require confirming the doctor was told would be a checkbox, not a safety step.
 */
export async function acknowledgeCritical(page: Page): Promise<string> {
  const check = criticalNotifyCheckbox(page);
  await check.waitFor({ state: 'visible', timeout: 20_000 });
  await check.check();
  await page.waitForTimeout(400);
  await acknowledgeCriticalButton(page).click();
  await page.waitForTimeout(1_500);
  return toastText(page);
}

/** The technician half of dual validation. Returns the toast, blocked or not. */
export async function submitForValidation(page: Page): Promise<string> {
  await submitForValidationButton(page).click();
  await page.waitForTimeout(1_800);
  return toastText(page);
}

/** The pathologist/doctor half. */
export async function validateAndSign(page: Page): Promise<string> {
  await validateAndSignButton(page).click();
  await page.waitForTimeout(2_000);
  return toastText(page);
}

/** The single-step technician release, used when dual validation is not required. */
export async function validateAndRelease(page: Page): Promise<string> {
  await validateAndReleaseButton(page).click();
  await page.waitForTimeout(2_000);
  return toastText(page);
}

/**
 * The whole lab happy path in one call, for cases whose subject is downstream of it.
 *
 * Returns the toast from each step so a case can assert on any of them without repeating the
 * journey. Steps that are not applicable to the tenant's configuration (no payment gate on a
 * post-paid tenant, no critical banner on a normal value) are skipped rather than failed —
 * the flow's job is to reach the state, and the case's job is to say what should be true there.
 */
export async function runLabJourney(page: Page, opts: {
  rowText: string;
  testName: string;
  value: string;
  acknowledgeCriticalValue?: boolean;
  release?: boolean;
}): Promise<{ collectToast: string; resultToast: string; releaseToast: string }> {
  const collect = await collectSample(page, opts.rowText);
  await openOrderInWorklist(page, opts.rowText);
  await enterResult(page, opts.testName, opts.value);
  const resultToast = await toastText(page, 4_000);

  if (opts.acknowledgeCriticalValue) {
    await acknowledgeCritical(page).catch(() => { /* not a critical value on this tenant's ranges */ });
  }

  let releaseToast = '';
  if (opts.release !== false) {
    if (await validateAndReleaseButton(page).isVisible().catch(() => false)) {
      releaseToast = await validateAndRelease(page);
    } else if (await submitForValidationButton(page).isVisible().catch(() => false)) {
      releaseToast = await submitForValidation(page);
    }
  }

  return { collectToast: collect.toast, resultToast, releaseToast };
}

/* ══ Radiology ════════════════════════════════════════════════════════ */

/**
 * Walk an order from `ordered` to `images_acquired` through the real buttons.
 *
 * Stops there deliberately: the next transition differs by modality. A USG or PCPNDT order is
 * rerouted from "Begin Report" straight into `validateAndSign()`
 * (`RadiologyReportingWorkspace.tsx:214-217`), so it never passes through `reported` at all,
 * and a flow that assumed a uniform four-step ladder would hang waiting for a status that
 * cannot occur for half the studies in the catalogue.
 *
 * Returns `blockedByPcpndt` when "Start Study" has been replaced by "Fill PCPNDT Form First",
 * so a case can assert the gate instead of timing out on a button that is not there.
 */
export async function driveStudyToImagesAcquired(page: Page, rowText: string): Promise<{ blockedByPcpndt: boolean }> {
  await openRadiology(page);
  await openStudy(page, rowText);

  const gate = page.getByRole('button', { name: /fill pcpndt form first/i }).first();
  if (await gate.isVisible().catch(() => false)) return { blockedByPcpndt: true };

  await startStudyButton(page).click();
  await page.waitForTimeout(1_800);

  await imagesAcquiredButton(page).click();
  await page.waitForTimeout(1_800);

  return { blockedByPcpndt: false };
}

/** Type a report. Does not sign it — signing is its own step, and its own assertion. */
export async function fillReport(page: Page, opts: {
  technique?: string; findings: string; impression: string;
}): Promise<void> {
  if (await beginReportButton(page).isVisible().catch(() => false)) {
    await beginReportButton(page).click();
    await page.waitForTimeout(1_500);
  }
  if (opts.technique) {
    await fillReportField(page, /Technique/i, opts.technique).catch(() => { /* optional field */ });
  }
  await fillReportField(page, /^\s*Findings\s*$/i, opts.findings);
  await fillReportField(page, /Impression/i, opts.impression);
  await page.waitForTimeout(600);
}

export async function saveReportDraft(page: Page): Promise<string> {
  await saveDraftButton(page).click();
  await page.waitForTimeout(1_800);
  return radToastText(page);
}

export async function signReport(page: Page): Promise<string> {
  await radValidateAndSign(page).click();
  await page.waitForTimeout(2_500);
  return radToastText(page);
}

/**
 * Fill and save the PCPNDT Form F through `PCPNDTFormModal`.
 *
 * All three of indication, the sex-determination declaration and patient consent are mandatory
 * (`PCPNDTFormModal.tsx:132-144`) and the Save button stays disabled until they are set — which
 * is correct, and is why this flow sets all three rather than only the field a case cares about.
 * The row lands in `pcpndt_records`, NOT `pcpndt_form_f`.
 */
export async function fillPcpndtFormF(page: Page, opts?: { indication?: string }): Promise<string> {
  await openPcpndtFormButton(page).click();
  await page.waitForTimeout(1_500);

  await fillReportField(page, /Indication/i, opts?.indication ?? String(P5.pcpndt.indication))
    .catch(() => { /* pre-filled from the order */ });

  const sexDecl = pcpndtSexDeclarationCheckbox(page);
  if (await sexDecl.count()) await sexDecl.check().catch(() => { /* already ticked */ });

  const consent = pcpndtConsentCheckbox(page);
  if (await consent.count()) await consent.check().catch(() => { /* already ticked */ });

  await page.waitForTimeout(400);
  await savePcpndtFormButton(page).click();
  await page.waitForTimeout(2_000);
  return radToastText(page);
}

/**
 * Take the AI impression suggestion, edit it, and attest.
 *
 * The EDIT is the point of the case, not decoration: `onAccept(editedText)` calls
 * `setImpression(editedText)`, so what reaches `radiology_reports.impression` is the
 * radiologist's text, and `ai_attestations.edited_before_save` records that it differed from the
 * draft. A flow that accepted the draft unchanged could not tell those two apart.
 *
 * Returns the raw AI draft so a case can prove the saved impression is NOT it.
 */
export async function useAiImpression(page: Page, editedText: string): Promise<{ draft: string; toast: string }> {
  await aiSuggestButton(page).click();
  await page.waitForTimeout(6_000);

  await aiUseThisButton(page).click();
  await page.waitForTimeout(1_500);

  const box = aiAttestationTextarea(page);
  const draft = (await box.inputValue().catch(() => '')).trim();

  await box.fill(editedText);
  const check = aiAttestationCheckbox(page);
  if (await check.count()) await check.check().catch(() => { /* already ticked */ });
  await page.waitForTimeout(400);

  await aiAttestationAcceptButton(page).click();
  await page.waitForTimeout(2_000);

  return { draft, toast: await radToastText(page) };
}

export { openLab, openLabTab, LAB_TABS, COLLECTION_TABS, awaitSaveAck, radAwaitSaveAck };
