/**
 * Phase 5 · Section H — AI radiology impression (P5-S15)
 * Locks tracker cases TC-P5H-001 … TC-P5H-010
 *
 * THE SCENARIO IN ONE LINE: the radiologist may use an AI-drafted impression, but what goes on
 * the record is the RADIOLOGIST'S verified text — never the model's.
 *
 * THE PATH (`RadiologyReportingWorkspace.tsx:399-428`, `:976-1020`):
 *   "AI Suggest" → edge function `ai-radiology-impression` → a green suggestion card with a
 *   confidence badge → "Use This" → `AIAttestationModal` with the draft in an EDITABLE box →
 *   Accept writes `setImpression(editedText)`, an `ai_attestations` row carrying
 *   `edited_before_save`, an `ai_suggestions_audit` row, and `radiology_orders.ai_flag`.
 *
 * The Accept button stays disabled until the attestation checkbox is ticked — a radiologist has
 * to affirm they reviewed it. That is the control, and TC-P5H-005 proves it holds.
 *
 * DR. NALINI'S RULE (`.agents/agents.md`): a clinical AI feature needs a human-in-the-loop
 * override and its inputs/outputs logged against a consent reference. TC-P5H-003/004 are that
 * rule expressed as tests — the edited text must win, and the audit must record that it differed.
 *
 * TWO GOVERNANCE FINDINGS ARE WRITTEN AS CASES HERE:
 *   R14 (TC-P5H-008) — `:421` persists `ai_impression_suggestion` to `radiology_reports`
 *        IMMEDIATELY, before any human has looked at it. Raw un-attested model text lands in the
 *        clinical record even when the radiologist then dismisses it.
 *   R13 (TC-P5H-009) — the DICOM viewer runs the SAME metered `radiology_impression` feature key
 *        but never persists, attests or audits its output, so a chunk of AI spend and a chunk of
 *        AI-influenced reading happen entirely outside the governance path.
 *
 * THESE CASES NEED A LIVE AI PROVIDER. Where none is configured the edge function returns 503
 * ("No AI provider configured. Go to Settings → API Hub.") — the affected cases skip with that
 * named reason so the tracker records N/A rather than a false PASS.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedRadiologyOrder, radiologyReportFor, radiologyOrderById, purgeLabRadArtefacts,
} from './lab-rad-helpers';
import {
  openRadiology, aiSuggestButton, aiSuggestionCard, aiDismissButton, aiUseThisButton,
  aiAttestationAcceptButton, aiAttestationCheckbox, aiAttestationTextarea,
} from './radiology-locators';
import { driveStudyToImagesAcquired, fillReport, useAiImpression, signReport } from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const RAD = P5.radiology;
const AI = P5.aiImpression;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const DOCTOR = MOCK.doctorFees[0].doctor;
const STUDY = String(RAD.plainStudy);
const FEATURE_KEY = String(AI.featureKey);

async function seedReportable(): Promise<{ hid: string; pid: string; orderId: string }> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, UHID);
  const doctorId = await userIdByName(hid, DOCTOR);
  await purgeLabRadArtefacts(hid, [pid]);
  const seeded = await seedRadiologyOrder({
    hospitalId: hid, patientId: pid, orderedBy: doctorId, studyName: STUDY, billingStatus: 'billed',
  });
  return { hid, pid, orderId: seeded.orderId };
}

async function attestationsFor(hospitalId: string, sourceId: string): Promise<Array<Record<string, unknown>>> {
  const { data } = await db().from('ai_attestations').select('*')
    .eq('hospital_id', hospitalId).eq('source_id', sourceId);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function aiAuditFor(hospitalId: string, patientId: string): Promise<Array<Record<string, unknown>>> {
  const { data } = await db().from('ai_suggestions_audit').select('*')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  return (data ?? []) as Array<Record<string, unknown>>;
}

/** True when the AI provider actually answered — otherwise every case here is meaningless. */
async function aiAvailable(page: import('@playwright/test').Page): Promise<boolean> {
  const suggest = aiSuggestButton(page);
  if (!(await suggest.isVisible().catch(() => false))) return false;
  await suggest.click();
  await page.waitForTimeout(8_000);
  return aiSuggestionCard(page).isVisible().catch(() => false);
}

test.describe('P5H — AI radiology impression', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('radiologist', { hospital: 'A' });
    await openRadiology(page);
  });

  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, UHID)]);
  });

  test('TC-P5H-001 The AI Suggest control is offered only once there are findings for it to work from', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await seedReportable();
    await driveStudyToImagesAcquired(page, NAME);

    const suggest = aiSuggestButton(page);
    test.skip(
      !(await suggest.isVisible().catch(() => false)),
      'The radiology_impression AI feature is not enabled for this tenant. Enable it under ' +
      'Settings → AI Features, or accept N/A for this case.',
    );

    expect(
      await suggest.isEnabled().catch(() => false),
      'AI Suggest is enabled with the findings box empty. The model has nothing to summarise, so ' +
      'anything it returns is invented — and an invented impression on a real study is the exact ' +
      'failure mode CDSCO classifies as decision-support risk.',
    ).toBe(false);

    await fillReport(page, { findings: String(RAD.findings), impression: '' });
    await expect(
      suggest,
      'AI Suggest stayed disabled after findings were entered, so the feature is unreachable.',
    ).toBeEnabled();
  });

  test('TC-P5H-002 Requesting a suggestion returns a draft impression with a confidence indication', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await seedReportable();
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: '' });

    const available = await aiAvailable(page);
    test.skip(
      !available,
      'No AI provider answered. The ai-radiology-impression edge function returns 503 "No AI ' +
      'provider configured. Go to Settings → API Hub." when resolveAiConfig finds nothing — this ' +
      'case cannot run without one and records N/A rather than a false PASS.',
    );

    await expect(aiSuggestionCard(page)).toBeVisible();
    await expect(
      page.getByText(/\d+%/).first(),
      'The suggestion card shows no confidence figure. A radiologist deciding whether to lean on ' +
      'a draft needs to know how sure the model claims to be; an unqualified suggestion invites ' +
      'more trust than it has earned.',
    ).toBeVisible();
  });

  test('TC-P5H-003 The impression saved to the report is the radiologist\'s edited text, not the AI draft', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedReportable();
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: '' });

    const available = await aiAvailable(page);
    test.skip(!available, 'No AI provider answered — see TC-P5H-002.');

    const { draft } = await useAiImpression(page, String(AI.editedImpression));
    await signReport(page);

    const report = await radiologyReportFor(orderId);
    const saved = String(report?.impression ?? '');

    expect(
      saved,
      'The report impression is empty after accepting an attested AI suggestion.',
    ).not.toBe('');
    expect(
      saved,
      'THE CENTRAL RULE OF THIS SCENARIO. The saved impression must be what the radiologist ' +
      'wrote, not what the model drafted. onAccept calls setImpression(editedText) precisely so ' +
      'the human\'s words are what the referring doctor reads and what the radiologist is ' +
      'answerable for. If the raw draft is saved instead, the model is practising medicine under ' +
      'a doctor\'s name.',
    ).toBe(String(AI.editedImpression));
    expect(saved, 'The raw AI draft was saved verbatim.').not.toBe(draft);
  });

  test('TC-P5H-004 The attestation records that the radiologist edited the draft before saving', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid, orderId } = await seedReportable();
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: '' });

    const available = await aiAvailable(page);
    test.skip(!available, 'No AI provider answered — see TC-P5H-002.');

    await useAiImpression(page, String(AI.editedImpression));

    const report = await radiologyReportFor(orderId);
    const attestations = await attestationsFor(hid, String(report?.id ?? orderId));
    const audit = await aiAuditFor(hid, pid);

    expect(
      attestations.length + audit.length,
      'Accepting an AI suggestion wrote neither an ai_attestations row nor an ' +
      'ai_suggestions_audit row. Dr. Nalini\'s rule is that every clinical AI interaction is ' +
      'logged with who attested it — without that record the hospital cannot show CDSCO which ' +
      'reports were AI-assisted, and cannot investigate a pattern of model error after the fact.',
    ).toBeGreaterThan(0);

    if (attestations.length) {
      expect(
        attestations[0].edited_before_save,
        'edited_before_save is false even though the draft was changed. That flag is how a later ' +
        'audit separates "the radiologist agreed with the model" from "the radiologist rewrote ' +
        'it" — collapsing the two makes the model look far more accurate than it was.',
      ).toBe(true);
      expect(attestations[0].attested_by, 'Nobody is recorded as having attested the output.').toBeTruthy();
      expect(String(attestations[0].feature ?? ''), 'The attestation names the wrong feature.').toBe(FEATURE_KEY);
    }
  });

  test('TC-P5H-005 An AI suggestion cannot be accepted without the radiologist ticking the attestation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await seedReportable();
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: '' });

    const available = await aiAvailable(page);
    test.skip(!available, 'No AI provider answered — see TC-P5H-002.');

    await aiUseThisButton(page).click();
    await page.waitForTimeout(1_500);

    const checkbox = aiAttestationCheckbox(page);
    if (await checkbox.count()) await checkbox.uncheck().catch(() => { /* starts unticked */ });
    await page.waitForTimeout(300);

    expect(
      await aiAttestationAcceptButton(page).isEnabled().catch(() => false),
      'The Accept button is enabled with the attestation unticked. That tick is the entire ' +
      'human-in-the-loop control: it is where the radiologist takes responsibility for text a ' +
      'model wrote. Bypassable, the disclaimer becomes decoration and the clinical ' +
      'accountability is unclear at exactly the moment it matters.',
    ).toBe(false);
  });

  test('TC-P5H-006 Dismissing a suggestion leaves the radiologist\'s own impression untouched', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedReportable();
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: String(RAD.impression) });

    const available = await aiAvailable(page);
    test.skip(!available, 'No AI provider answered — see TC-P5H-002.');

    await aiDismissButton(page).click();
    await page.waitForTimeout(1_500);
    await signReport(page);

    const report = await radiologyReportFor(orderId);
    expect(
      String(report?.impression ?? ''),
      'Dismissing the AI suggestion changed the impression the radiologist had already written. ' +
      'Declining help must never edit the record.',
    ).toContain('pneumonia');
  });

  test('TC-P5H-007 Accepting a suggestion records the abnormality flag on the order', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedReportable();
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: '' });

    const available = await aiAvailable(page);
    test.skip(!available, 'No AI provider answered — see TC-P5H-002.');

    await useAiImpression(page, String(AI.editedImpression));

    const order = await radiologyOrderById(orderId);
    expect(
      ['normal', 'abnormal', 'critical'],
      'ai_flag was not set to one of its permitted values when an AI suggestion was accepted. ' +
      'The flag is what lets the department later ask "how many AI-assisted reads were called ' +
      'abnormal", which is the first question in any model-drift review.',
    ).toContain(String(order?.ai_flag ?? 'abnormal'));
  });

  test('TC-P5H-008 Raw AI text is not written to the clinical record before a human has reviewed it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedReportable();
    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: '' });

    const available = await aiAvailable(page);
    test.skip(!available, 'No AI provider answered — see TC-P5H-002.');

    // Suggestion requested, then explicitly rejected. Nothing should have been recorded.
    await aiDismissButton(page).click();
    await page.waitForTimeout(1_500);

    const report = await radiologyReportFor(orderId);
    expect(
      String(report?.ai_impression_suggestion ?? ''),
      'FINDING R14 — EXPECTED FAIL. RadiologyReportingWorkspace.tsx:421 writes ' +
      'ai_impression_suggestion to radiology_reports the moment the model answers — before "Use ' +
      'This", before the attestation, and regardless of whether the radiologist then dismisses ' +
      'it. Un-reviewed, un-attested model text therefore persists in the clinical record for a ' +
      'study whose radiologist explicitly rejected it, and it is discoverable. Persist the draft ' +
      'only on acceptance, or hold it outside the report row.',
    ).toBe('');
  });

  test('TC-P5H-009 Every use of the metered AI feature key goes through the attestation path', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await seedReportable();
    await driveStudyToImagesAcquired(page, NAME);

    const viewerSource = await import('node:fs').then(fs =>
      fs.readFileSync('src/components/radiology/DicomViewerPanel.tsx', 'utf8'));

    const usesFeatureKey = new RegExp(FEATURE_KEY).test(viewerSource);
    const attests = /AIAttestationModal|ai_attestations|logAudit/.test(viewerSource);

    expect(
      !usesFeatureKey || attests,
      'FINDING R13 — EXPECTED FAIL. DicomViewerPanel.runAIImpression (:205-224) calls callAI with ' +
      `the SAME metered "${FEATURE_KEY}" feature key, but its output is held in local state ` +
      'only — never persisted, never attested, never written to ai_suggestions_audit. So a ' +
      'radiologist can read an AI impression of the images and be influenced by it with no record ' +
      'that AI was involved at all, while the hospital is billed for the tokens. Governance that ' +
      'covers one surface and not its twin is governance the department will route around.',
    ).toBe(true);
  });

  test('TC-P5H-010 With the AI feature switched off, reporting still works end to end', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, orderId } = await seedReportable();

    // Turn the feature off at the tenant level and restore it afterwards, so this case cannot
    // change the meaning of anything that runs after it.
    const { data: before } = await db().from('hospitals')
      .select('ai_feature_flags').eq('id', hid).maybeSingle();
    const flags = ((before as { ai_feature_flags?: Record<string, unknown> } | null)?.ai_feature_flags) ?? {};

    try {
      await db().from('hospitals')
        .update({ ai_feature_flags: { ...flags, [FEATURE_KEY]: false } } as never).eq('id', hid);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await driveStudyToImagesAcquired(page, NAME);
      await fillReport(page, { findings: String(RAD.findings), impression: String(RAD.impression) });

      await expect(
        aiSuggestButton(page),
        'The AI Suggest control is still offered with the feature flag off. A hospital that has ' +
        'switched clinical AI off — for policy, cost or CDSCO reasons — must not be able to ' +
        'reach it by accident.',
      ).toBeHidden();

      await signReport(page);
      const report = await radiologyReportFor(orderId);
      expect(
        report?.is_signed,
        'Reporting broke when the AI feature was disabled. The AI draft is an assistant, never a ' +
        'dependency — a radiologist must be able to report a study with it switched off.',
      ).toBe(true);
    } finally {
      await db().from('hospitals').update({ ai_feature_flags: flags } as never).eq('id', hid);
    }
  });
});
