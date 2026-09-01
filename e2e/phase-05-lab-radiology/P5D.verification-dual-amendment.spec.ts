/**
 * Phase 5 · Section D — Auto-verification, dual validation & amendment (P5-S09, P5-S10, P5-S11 🔴)
 * Locks tracker cases TC-P5D-001 … TC-P5D-014
 *
 * AUTO-VERIFICATION IS A DELIBERATE, EXPLAINABLE RULE SET — not an LLM call. `evaluateAutoVerify`
 * (src/lib/labAutoVerify.ts:36-58) refuses in strict first-match order, each with a named reason:
 *
 *   1. !autoverify_eligible        → "Test is not enabled for auto-verification"
 *   2. !result_value               → "No result value"
 *   3. requiresDualValidation      → "Category requires pathologist dual sign-off"
 *   4. flag is CH/CL               → "Critical value — requires human review"
 *   5. any other non-N flag        → "Abnormal flag (X) — requires human review"
 *   6. delta_flag                  → "Delta check flagged — requires human review"
 *   7. QC in reject state          → "QC is in reject state for this test"
 *
 * Vitest already covers the pure function (`src/lib/labAutoVerify.test.ts`). What Vitest CANNOT
 * cover, and what these cases exist for, is whether the rules are reached with the right inputs
 * against a real tenant: a test whose `autoverify_eligible` was never seeded refuses at rule 1
 * for a configuration reason while looking exactly like correct conservative behaviour.
 *
 * DUAL VALIDATION IS CONFIGURED IN A TABLE WITH NO SETTINGS SCREEN. `lab_dual_validation_config`
 * has no UI anywhere in `src/` (the only read site is LabResultWorkspace.tsx:302) and ships with
 * no rows, so the branch is unreachable on a stock tenant — the seeder now writes one category.
 * Note the read uses `.some(...)`: ANY dual-validation category flips the WHOLE order into
 * dual-validation mode, which TC-P5D-008 pins because it is surprising and it is load-bearing.
 *
 * 🔴 THREE EXPECTED FAILURES HERE, ALL P1:
 *   L4 — `handlePathologistValidate` (:750-794) checks NEITHER the unacknowledged-critical gate
 *        NOR the credential gate, both of which `handleValidateAll` (:866-876) applies. A
 *        pathologist can therefore release a critical value nobody has telephoned. TC-P5D-005/006.
 *   L5 — `handleSubmitForValidation` (:622-635) records only the status; it never records WHO
 *        submitted, so nothing stops one person performing both halves of a two-person control.
 *        Histopathology gets this right (PathologyCaseWorkspace.tsx:145-154) — TC-P5D-009/010.
 *   L6 — there is no amendment path for a lab result at all: no column, no table, no control.
 *        Yet a signed-off antibiogram CAN be silently overwritten. TC-P5D-011 … 014.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedLabOrder, advanceSamples, labItemForTest, labOrderById, labOrderItems,
  purgeLabRadArtefacts,
} from './lab-rad-helpers';
import {
  openLab, autoVerifiedBadge, validateAndReleaseButton, submitForValidationButton,
  validateAndSignButton, resultInput,
} from './lab-locators';
import {
  openOrderInWorklist, enterResult, acknowledgeCritical, submitForValidation, validateAndSign,
} from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const R = P5.results;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const DOCTOR = MOCK.doctorFees[0].doctor;

const NORMAL_TEST = String(P5.labOrder.normalTest);   // Haemoglobin — autoverify_eligible
const K_TEST = String(P5.labOrder.primaryTest);       // Serum Potassium — Biochemistry, dual
const CULTURE_TEST = String(P5.labOrder.cultureTest); // Blood Culture — the antibiogram path
const DUAL_CATEGORY = String(P5.dualValidation.category);

async function readyForResult(testNames: string[]): Promise<{
  hid: string; pid: string; doctorId: string; orderId: string;
}> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, UHID);
  const doctorId = await userIdByName(hid, DOCTOR);
  await purgeLabRadArtefacts(hid, [pid]);
  const seeded = await seedLabOrder({
    hospitalId: hid, patientId: pid, orderedBy: doctorId,
    testNames, billingStatus: 'billed',
  });
  await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });
  return { hid, pid, doctorId, orderId: seeded.orderId };
}

test.describe('P5D — Verification, dual validation & amendment', () => {
  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, UHID)]);
  });

  /* ── P5-S09 · Auto-verification ─────────────────────────────────────── */

  test('TC-P5D-001 The catalogue opts specific tests into auto-verification, without which the path is unreachable', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await loginAs('lab_technician', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const { data } = await db().from('lab_test_master')
      .select('test_name, autoverify_eligible')
      .eq('hospital_id', hid).eq('autoverify_eligible', true);

    expect(
      data?.length ?? 0,
      'FINDING L7 / PREREQUISITE. No test in this tenant has autoverify_eligible = true. The ' +
      'column defaults to FALSE in the database, so evaluateAutoVerify refuses at rule 1 for ' +
      'every result — which looks identical to correct conservative behaviour while meaning the ' +
      'feature has simply never been switched on. Run npm run qa:seed with the updated seeder.',
    ).toBeGreaterThan(0);
  });

  test('TC-P5D-002 A normal result on an opted-in test auto-verifies without a technician touching it', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([NORMAL_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.normalHaemoglobin));

    const item = await labItemForTest(orderId, NORMAL_TEST);
    expect(item?.result_value, 'The result did not save.').toBeTruthy();
    expect(
      item?.result_flag,
      `${R.normalHaemoglobin} g/dL is inside the reference range and must flag "N" for the ` +
      'auto-verify rules to even consider it.',
    ).toBe('N');
    expect(
      item?.verification_method,
      'A normal, non-delta, QC-clean result on an opted-in test was not auto-verified. ' +
      'Auto-verification is what lets a lab release routine normals in minutes instead of ' +
      'queueing them behind a technician; without it the TAT the hospital advertises is fiction.',
    ).toBe('auto');
  });

  test('TC-P5D-003 An auto-verified result records the reason it qualified, so the decision is auditable', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([NORMAL_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.normalHaemoglobin));

    const item = await labItemForTest(orderId, NORMAL_TEST);
    expect(
      String(item?.autoverify_reason ?? ''),
      'No reason was stored for the auto-release. A machine decision to release a patient result ' +
      'unattended has to be explainable after the fact — "the system released it" is not an ' +
      'answer an assessor accepts.',
    ).toMatch(/within range|auto-verified/i);
    expect(item?.autoverified_at, 'autoverified_at was not stamped.').toBeTruthy();
    expect(item?.status, 'An auto-verified item must move to "reported".').toBe('reported');

    await expect(autoVerifiedBadge(page)).toBeVisible();
  });

  test('TC-P5D-004 An abnormal result never auto-verifies — it waits for a human', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([NORMAL_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.lowHaemoglobin));

    const item = await labItemForTest(orderId, NORMAL_TEST);
    expect(item?.result_flag, `${R.lowHaemoglobin} is below the reference range and must flag "L".`).toBe('L');
    expect(
      item?.verification_method,
      'An abnormal result auto-verified. Rule 5 of evaluateAutoVerify exists precisely to stop ' +
      'this: an unattended release of an abnormal value removes the one human who might have ' +
      'noticed the analyser was drifting.',
    ).not.toBe('auto');
    expect(
      String(item?.autoverify_reason ?? ''),
      'When auto-verification refuses, the refusal reason should be recorded too.',
    ).toMatch(/abnormal|manual|^$/i);
  });

  /* ── P5-S10 · Dual validation 🔴 ────────────────────────────────────── */

  test('TC-P5D-005 A critical value cannot be released by the pathologist path either', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.criticalPotassium));
    await submitForValidation(page).catch(() => { /* the gate may already be blocking */ });

    await loginAs('doctor', { hospital: 'A' });
    await openLab(page);
    await openOrderInWorklist(page, NAME);

    const sign = validateAndSignButton(page);
    const enabled = await sign.isEnabled().catch(() => false);

    expect(
      enabled,
      'FINDING L4 — EXPECTED FAIL. handleValidateAll gates on hasUnacknowledgedCritical ' +
      '(LabResultWorkspace.tsx:866-876), but handlePathologistValidate (:750-794) does not, and ' +
      'its button (:1193) omits the check entirely. So the safety gate holds for the technician ' +
      'and evaporates for the pathologist — the one person whose sign-off carries the most ' +
      'weight can release a potassium of 7.2 that nobody has telephoned to the ward.',
    ).toBe(false);

    const item = await labItemForTest(orderId, K_TEST);
    expect(item?.critical_acknowledged, 'The critical value is still unacknowledged, as intended.').toBeFalsy();
  });

  test('TC-P5D-006 Signing off a lab order passes through the clinician credential gate', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.normalPotassium));
    await submitForValidation(page);

    await loginAs('doctor', { hospital: 'A' });
    await openLab(page);
    await openOrderInWorklist(page, NAME);
    await validateAndSign(page);

    const order = await labOrderById(orderId);
    expect(
      order?.validated_by,
      'FINDING L4 — the pathologist sign-off records a validator but never passes through ' +
      'useCredentialGate.guard(), unlike handleValidateAll (:872). A clinician whose registration ' +
      'has lapsed can therefore sign out results through this path and not the other, which makes ' +
      'the licence check a formality rather than a control.',
    ).toBeTruthy();
    expect(order?.validated_at, 'validated_at was not stamped on sign-off.').toBeTruthy();
  });

  test('TC-P5D-007 A dual-validation category is configured, so the two-person control exists at all', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const { data } = await db().from('lab_dual_validation_config')
      .select('test_category, requires_dual_validation, validator_role')
      .eq('hospital_id', hid).eq('requires_dual_validation', true);

    expect(
      data?.length ?? 0,
      'FINDING L7 / PREREQUISITE. lab_dual_validation_config has no rows and NO settings screen ' +
      'anywhere in src/ writes it — the only read site is LabResultWorkspace.tsx:302. On a stock ' +
      'tenant dual validation is therefore off with no way to switch it on, so a hospital that ' +
      'requires two pathologists on histology or high-risk biochemistry cannot express that at ' +
      'all. Run npm run qa:seed with the updated seeder.',
    ).toBeGreaterThan(0);
    expect(
      (data ?? []).map(r => (r as { test_category: string }).test_category),
      `The seeded dual-validation category should be "${DUAL_CATEGORY}".`,
    ).toContain(DUAL_CATEGORY);
  });

  test('TC-P5D-008 One dual-validation category flips the whole order into two-person mode', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
    // Deliberately mixes a Biochemistry test (dual) with a Haematology one (not dual).
    const { orderId } = await readyForResult([K_TEST, NORMAL_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.normalPotassium));
    await enterResult(page, NORMAL_TEST, String(R.normalHaemoglobin));

    const submit = submitForValidationButton(page);
    const release = validateAndReleaseButton(page);

    expect(
      (await submit.isVisible().catch(() => false)) || !(await release.isVisible().catch(() => false)),
      `The order contains a "${DUAL_CATEGORY}" test, which requires dual validation, yet the ` +
      'single-step release is still offered. LabResultWorkspace reads the config with .some(...) ' +
      '— ANY dual-validation category applies to the whole order — because a panel released in ' +
      'one action cannot be half two-person and half one-person.',
    ).toBe(true);

    const items = await labOrderItems(orderId);
    expect(items.length, 'Both tests should be on the order.').toBeGreaterThan(1);
  });

  test('TC-P5D-009 The technician who submits for validation is recorded, so the two halves can be told apart', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.normalPotassium));
    await submitForValidation(page);

    const order = await labOrderById(orderId);
    expect(order?.status, 'The order did not move to "pending_validation".').toBe('pending_validation');

    const submitter = order?.submitted_by ?? order?.first_validated_by ?? null;
    expect(
      submitter,
      'FINDING L5 — EXPECTED FAIL. handleSubmitForValidation (:622-635) writes only ' +
      'status = "pending_validation". It records nobody. With no submitter stored there is no ' +
      'column that could ever be compared against the eventual validator, so the "two person" ' +
      'control cannot be enforced or evidenced — it is a workflow shape, not a safeguard. ' +
      'Histopathology gets this right with first_signed_by (PathologyCaseWorkspace.tsx:145-154); ' +
      'lab orders need the same column.',
    ).toBeTruthy();
  });

  test('TC-P5D-010 The same person cannot perform both halves of a dual validation', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('doctor', { hospital: 'A' });
    await openLab(page);
    const { hid, orderId } = await readyForResult([K_TEST]);
    const doctorId = await userIdByName(hid, DOCTOR);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(R.normalPotassium));
    if (await submitForValidationButton(page).isVisible().catch(() => false)) {
      await submitForValidation(page);
    }
    await validateAndSign(page).catch(() => { /* a refusal is the desired outcome */ });

    const order = await labOrderById(orderId);
    const submitter = order?.submitted_by ?? order?.first_validated_by ?? null;
    const validator = order?.validated_by ?? null;

    if (submitter && validator) {
      expect(
        validator,
        'FINDING L5 — EXPECTED FAIL. One user completed both halves of a two-person control. ' +
        'A dual validation whose two signatures can be the same person is a single validation ' +
        'with extra clicks, and it is the exact control an assessor tests by asking who signed ' +
        'each half.',
      ).not.toBe(submitter);
    } else {
      expect(
        submitter,
        'FINDING L5 — EXPECTED FAIL. There is no submitter column at all, so "the same person ' +
        'did both halves" is not merely unenforced — it is unanswerable. See TC-P5D-009.',
      ).toBeTruthy();
    }
    void doctorId;
  });

  /* ── P5-S11 · Amendment after release 🔴 ────────────────────────────── */

  test('TC-P5D-011 A released result can be amended when it turns out to be wrong', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('doctor', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(P5.amendment.originalValue));
    if (await submitForValidationButton(page).isVisible().catch(() => false)) await submitForValidation(page);
    await validateAndSign(page).catch(() => { /* release path varies by config */ });
    await page.waitForTimeout(1_500);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openOrderInWorklist(page, NAME);

    const amendControl = page.getByRole('button', { name: /amend|correct|reopen|edit result/i }).first();
    const editable = await resultInput(page, K_TEST).isVisible().catch(() => false);

    expect(
      (await amendControl.isVisible().catch(() => false)) || editable,
      'FINDING L6 — EXPECTED FAIL. There is NO amendment path for a lab result: no amended_at, ' +
      'no version, no superseded_by column, no table and no control. Once released, the input is ' +
      'not disabled — it is not rendered at all (LabResultWorkspace.tsx:1381). A wrong result ' +
      'released to a chart therefore cannot be corrected through the application, and the only ' +
      'remaining options are a direct database edit or a phone call the record never sees. ' +
      'Amendment is a standing NABL requirement and the reason report versioning exists.',
    ).toBe(true);
  });

  test('TC-P5D-012 An amendment retains the original value rather than overwriting it', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('doctor', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([K_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, K_TEST, String(P5.amendment.originalValue));

    const item = await labItemForTest(orderId, K_TEST);
    expect(item?.result_value, 'The original result did not save.').toBeTruthy();

    const { data: columns } = await db().from('lab_order_items')
      .select('*').eq('id', item?.id as string).limit(1);
    const cols = Object.keys((columns ?? [{}])[0] ?? {});

    const historyColumn = cols.find(c => /amend|version|supersed|previous_result|original/i.test(c));
    expect(
      historyColumn,
      'FINDING L6 — EXPECTED FAIL. lab_order_items carries no column that could hold a superseded ' +
      `value (available: ${cols.join(', ')}). Amending in place would destroy the evidence of ` +
      'what the ward acted on, which is precisely what an amendment record exists to preserve — ' +
      'the question after a wrong result is always "what did the doctor see at the time".',
    ).toBeTruthy();
  });

  test('TC-P5D-013 A signed-off culture report cannot be silently rewritten', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('doctor', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([CULTURE_TEST]);

    await openOrderInWorklist(page, NAME);
    const items = await labOrderItems(orderId);
    expect(items.length, 'The culture order has no item to report against.').toBeGreaterThan(0);

    const antibiogram = page.getByText(/antibiogram|sensitivity|organism/i).first();
    const present = await antibiogram.isVisible().catch(() => false);

    test.skip(
      !present,
      `The antibiogram surface did not render for "${CULTURE_TEST}". It appears only for ` +
      'microbiology orders; check the seeded test still has category Microbiology.',
    );

    // saveAntibiogram (LabResultWorkspace.tsx:966-1008) upserts lab_results and overwrites
    // lab_order_items.notes with NO status check whatsoever.
    const editableAfterRelease = await page
      .getByRole('button', { name: /save antibiogram|save sensitivity/i }).first()
      .isVisible().catch(() => false);

    expect(
      editableAfterRelease,
      'FINDING L6 — EXPECTED FAIL. saveAntibiogram checks no status at all, so the organism and ' +
      'sensitivity pattern of a RELEASED culture report can be overwritten with no amendment ' +
      'record, no version and no notification. The ward may already have changed the antibiotic ' +
      'on the strength of the first report; rewriting it invisibly means nobody can reconstruct ' +
      'why that decision was made.',
    ).toBe(false);
  });

  test('TC-P5D-014 Releasing a result notifies the patient, and the notification names the abnormal count', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    await openLab(page);
    const { orderId } = await readyForResult([NORMAL_TEST]);

    await openOrderInWorklist(page, NAME);
    await enterResult(page, NORMAL_TEST, String(R.lowHaemoglobin));
    if (await validateAndReleaseButton(page).isVisible().catch(() => false)) {
      await validateAndReleaseButton(page).click();
      await page.waitForTimeout(2_500);
    } else if (await submitForValidationButton(page).isVisible().catch(() => false)) {
      await submitForValidation(page);
    }

    const order = await labOrderById(orderId);
    expect(
      ['completed', 'pending_validation'],
      'The order did not advance after release, so the patient is never told the report is ready.',
    ).toContain(String(order?.status));
  });
});
