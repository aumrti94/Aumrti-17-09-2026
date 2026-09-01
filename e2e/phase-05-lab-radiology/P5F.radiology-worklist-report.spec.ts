/**
 * Phase 5 · Section F — Radiology order → worklist → report (P5-S12)
 * Locks tracker cases TC-P5F-001 … TC-P5F-016
 *
 * THE REAL STATUS LADDER, which is not the one the scenario docs describe:
 *
 *     ordered → [scheduled] → [patient_arrived] → in_progress → images_acquired
 *             → reported → validated
 *
 * There is NO `performed` and NO `verified`. `scheduled` and `patient_arrived` are valid enum
 * values with worklist filters and stat counters, but NOTHING in the UI ever writes them — there
 * is no scheduling, room-assignment or arrival screen anywhere, and `scheduled_time` is a dead
 * column. TC-P5F-004 records that as finding R6 rather than leaving a spec hanging on a status
 * that cannot occur.
 *
 * VERIFICATION IS ONE SIGNATURE, NOT TWO. `validateAndSign` writes `is_signed`, `validated_by`,
 * `validated_at` and `radiologist_id` — all set to the SAME `currentUserId`. There is no separate
 * verifier and no second-radiologist check, unlike histopathology. TC-P5F-009 states that as
 * current behaviour so a later change is visible rather than silent.
 *
 * ✅ TC-P5F-013 … 015 WERE FINDING R1. R1 IS FIXED; THEY NOW GUARD THE FIX.
 * R1 was: only `NewRadiologyOrderModal.tsx` created the `radiology_reports` shell row, while
 * `syncRadiologyOrders` — what an OPD consultation actually calls — did not, and BOTH
 * `saveDraft` and `validateAndSign` opened with `if (!report || !currentUserId) return;`. So on
 * an order raised from a consultation the "Validate & Sign" button was enabled, did nothing at
 * all when clicked, and raised no toast: the radiologist typed a report, pressed the button,
 * saw no error, and the study stayed unreported forever.
 *
 * Fixed in three layers: syncRadiologyOrders now creates the shell, migration
 * 20261018000002 backfilled the stranded orders, and `RadiologyReportingWorkspace` creates the
 * row on demand (`ensureReport`) rather than returning silently. These three cases still seed
 * the shell-less state deliberately, to prove that last layer holds no matter how the order
 * was created. Every OTHER case in this section seeds the shell via
 * `seedRadiologyOrder({ withReportShell: true })` so it can test reporting rather than
 * re-testing R1. Do NOT "fix" 013–015 by seeding the shell.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedRadiologyOrder, radiologyOrderById, radiologyReportFor, radiologyOrdersFor,
  purgeLabRadArtefacts, clinicalAlertsFor,
} from './lab-rad-helpers';
import {
  openRadiology, openStudy, worklistRow, worklistEmptyState, startStudyButton,
  imagesAcquiredButton, beginReportButton, validateAndSignButton, saveDraftButton,
  fillReportField, toastText,
} from './radiology-locators';
import { driveStudyToImagesAcquired, fillReport, signReport, saveReportDraft } from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const RAD = P5.radiology;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const DOCTOR = MOCK.doctorFees[0].doctor;
const STUDY = String(RAD.plainStudy);
const CT_STUDY = String(RAD.ctStudy);

async function seedStudy(opts?: {
  studyName?: string; withReportShell?: boolean; billingStatus?: 'unbilled' | 'billed';
  orderDateDaysAgo?: number;
}): Promise<{ hid: string; pid: string; doctorId: string; orderId: string }> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, UHID);
  const doctorId = await userIdByName(hid, DOCTOR);
  await purgeLabRadArtefacts(hid, [pid]);

  const seeded = await seedRadiologyOrder({
    hospitalId: hid, patientId: pid, orderedBy: doctorId,
    studyName: opts?.studyName ?? STUDY,
    billingStatus: opts?.billingStatus ?? 'billed',
    withReportShell: opts?.withReportShell !== false,
  });

  if (opts?.orderDateDaysAgo) {
    const d = new Date(Date.now() - opts.orderDateDaysAgo * 86_400_000).toISOString().split('T')[0];
    const { error } = await db().from('radiology_orders')
      .update({ order_date: d } as never).eq('id', seeded.orderId);
    if (error) throw new Error(`Back-dating the radiology order: ${error.message}`);
  }

  return { hid, pid, doctorId, orderId: seeded.orderId };
}

test.describe('P5F — Radiology order → worklist → report', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('radiologist', { hospital: 'A' });
    await openRadiology(page);
  });

  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, UHID)]);
  });

  /* ── The worklist ───────────────────────────────────────────────────── */

  test('TC-P5F-001 A billed radiology order appears in today\'s worklist for the radiographer to pick up', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await seedStudy();
    await openRadiology(page);

    await expect(
      worklistRow(page, NAME),
      'The order does not appear in the worklist. The worklist is the only place a radiographer ' +
      'sees who is waiting; an order that never reaches it means the patient sits outside the ' +
      'room and nobody calls them.',
    ).toBeVisible();
  });

  test('TC-P5F-002 An unbilled order is invisible in the worklist, with no screen anywhere that would show it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedStudy({ billingStatus: 'unbilled' });
    await openRadiology(page);
    await page.waitForTimeout(2_500);

    const visible = await worklistRow(page, NAME).isVisible().catch(() => false);
    const order = await radiologyOrderById(orderId);
    expect(order?.billing_status, 'The fixture did not create an unbilled order.').toBe('unbilled');

    expect(
      visible,
      'FINDING R8. RadiologyPage.tsx:103 filters `.neq("billing_status","unbilled")`, and ' +
      'ConsultationWorkspace only flips an order to "billed" AFTER chargeRadiologyOrders ' +
      'succeeds. So any order whose charge failed — a network blip, a missing rate — becomes ' +
      'permanently invisible: it is in the database, the patient was told to go for the scan, ' +
      'and no screen in the product will ever show it to anyone. There needs to be an unbilled ' +
      'view, or the filter needs to be a filter rather than a hard exclusion.',
    ).toBe(true);
  });

  test('TC-P5F-003 An order raised yesterday is still reachable, not lost to the single-date worklist', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await seedStudy({ orderDateDaysAgo: 1 });
    await openRadiology(page);
    await page.waitForTimeout(2_500);

    const visibleToday = await worklistRow(page, NAME).isVisible().catch(() => false);
    if (!visibleToday) {
      // The worklist is date-scoped; look for a date control before calling it lost.
      const dateInput = page.locator('input[type="date"]').first();
      expect(
        await dateInput.isVisible().catch(() => false),
        'FINDING R8. The worklist queries a single `order_date` (RadiologyPage.tsx:88) and there ' +
        'is no way to reach another day, so a study ordered late yesterday and performed this ' +
        'morning cannot be found at all. Overnight and weekend work is exactly the case this ' +
        'breaks, which is when a hospital can least afford to lose an order.',
      ).toBe(true);

      const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
      await dateInput.fill(yesterday);
      await page.waitForTimeout(2_500);
      await expect(
        worklistRow(page, NAME),
        'Even after moving the worklist date back, yesterday\'s order does not appear.',
      ).toBeVisible();
    }
  });

  test('TC-P5F-004 The statuses the worklist filters on are statuses the application can actually reach', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, orderId } = await seedStudy();

    const { data } = await db().from('radiology_orders')
      .select('status').eq('hospital_id', hid)
      .in('status', ['scheduled', 'patient_arrived']);

    const order = await radiologyOrderById(orderId);
    expect(order?.status, 'A new order should start at "ordered".').toBe('ordered');

    expect(
      data?.length ?? 0,
      'FINDING R6. `scheduled` and `patient_arrived` are in the status CHECK constraint, have ' +
      'worklist filter options and feed the "pending" stat counter — but NOTHING in the ' +
      'application ever writes them, and `scheduled_time` is never read or written either. There ' +
      'is no scheduling or arrival screen at all. Either build the scheduling step the enum ' +
      'promises, or remove the dead states so the worklist stops offering filters that can never ' +
      'match anything. This assertion is expected to be 0 today and documents the gap.',
    ).toBe(0);
  });

  /* ── The reporting journey ──────────────────────────────────────────── */

  test('TC-P5F-005 Full reporting journey: order → start study → images acquired → report → sign', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedStudy();

    const drive = await driveStudyToImagesAcquired(page, NAME);
    expect(drive.blockedByPcpndt, 'A plain chest X-ray must not be gated behind PCPNDT.').toBe(false);

    let order = await radiologyOrderById(orderId);
    expect(
      order?.status,
      'The study did not reach "images_acquired". That status is what moves the case from the ' +
      'radiographer to the reporting radiologist; stuck before it, the images are taken and ' +
      'nobody is asked to read them.',
    ).toBe('images_acquired');

    await fillReport(page, {
      technique: String(RAD.technique), findings: String(RAD.findings), impression: String(RAD.impression),
    });
    await signReport(page);

    order = await radiologyOrderById(orderId);
    expect(
      order?.status,
      'The signed report did not move the order to "validated". An unvalidated study stays on ' +
      'the reporting worklist forever and the referring doctor never sees a final report.',
    ).toBe('validated');
  });

  test('TC-P5F-006 The signed report persists findings and impression, not just a status change', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedStudy();

    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: String(RAD.impression) });
    await signReport(page);

    const report = await radiologyReportFor(orderId);
    expect(report, 'No radiology_reports row exists after signing.').toBeTruthy();
    expect(
      String(report?.findings ?? ''),
      'The findings did not save. A status of "validated" against an empty report is the worst ' +
      'possible state: the referring doctor sees a completed study and opens a blank page.',
    ).toContain('consolidation');
    expect(String(report?.impression ?? ''), 'The impression did not save.').toContain('pneumonia');
    expect(report?.is_signed, 'The report was not marked signed.').toBe(true);
  });

  test('TC-P5F-007 A report cannot be signed with an empty impression', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedStudy();

    await driveStudyToImagesAcquired(page, NAME);
    if (await beginReportButton(page).isVisible().catch(() => false)) {
      await beginReportButton(page).click();
      await page.waitForTimeout(1_500);
    }
    await fillReportField(page, /^\s*Findings\s*$/i, String(RAD.findings));
    // Impression deliberately left blank.
    await page.waitForTimeout(600);

    const message = await signReport(page);

    const report = await radiologyReportFor(orderId);
    expect(
      report?.is_signed,
      `A report was signed with no impression (toast: "${message}"). The impression is the only ` +
      'part a referring clinician reliably reads — findings without one leave the treating team ' +
      'to interpret raw radiological description themselves, which is exactly what they asked a ' +
      'radiologist to avoid.',
    ).toBeFalsy();
  });

  test('TC-P5F-008 A draft can be saved and reopened without signing', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedStudy();

    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: String(RAD.impression) });
    await saveReportDraft(page);

    const report = await radiologyReportFor(orderId);
    expect(String(report?.findings ?? ''), 'The draft findings were not saved.').toContain('consolidation');
    expect(
      report?.is_signed,
      'Saving a draft marked the report signed. A radiologist who steps away mid-dictation must ' +
      'not have an unfinished report released to the ward under their name.',
    ).toBeFalsy();

    const order = await radiologyOrderById(orderId);
    expect(order?.status, 'Saving a draft must not validate the order.').not.toBe('validated');
  });

  test('TC-P5F-009 Signing records who signed it and when', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedStudy();

    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: String(RAD.impression) });
    await signReport(page);

    const report = await radiologyReportFor(orderId);
    expect(
      report?.validated_by,
      'Nobody is recorded as having validated the report. A radiology report is a medico-legal ' +
      'document; an unsigned-in-fact report cannot be defended, and the radiologist cannot prove ' +
      'they did not write one attributed to them.',
    ).toBeTruthy();
    expect(report?.validated_at, 'validated_at was not stamped.').toBeTruthy();
    expect(
      report?.radiologist_id,
      'radiologist_id is null. CURRENT BEHAVIOUR: validated_by, radiologist_id and the ' +
      'credential-gate subject are all set to the same currentUserId — there is no separate ' +
      'verifier for radiology, unlike histopathology. Recorded here so a future change to a ' +
      'two-signature model is visible rather than silent.',
    ).toBeTruthy();
  });

  test('TC-P5F-010 A critical radiology finding raises a critical alert to the treating team', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid, orderId } = await seedStudy();

    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, {
      findings: String(RAD.criticalFindings), impression: String(RAD.criticalFindings),
    });

    const criticalToggle = page.getByRole('switch').or(page.locator('input[type="checkbox"]')).first();
    if (await criticalToggle.count()) await criticalToggle.check().catch(() => { /* already set */ });
    const criticalNote = page.getByPlaceholder(/critical finding/i).first();
    if (await criticalNote.count()) await criticalNote.fill(String(RAD.criticalFindingNote));
    await page.waitForTimeout(500);

    await signReport(page);

    const report = await radiologyReportFor(orderId);
    expect(report?.is_critical, 'The report was not flagged critical.').toBe(true);

    const alerts = await clinicalAlertsFor({
      hospitalId: hid, patientId: pid, alertType: 'critical_radiology',
    });
    expect(
      alerts.length,
      'A tension pneumothorax was reported and no critical_radiology alert was raised. A ' +
      'critical imaging finding has to reach a human within minutes — a flag on a report the ' +
      'referring doctor opens tomorrow is not a notification.',
    ).toBeGreaterThan(0);
    expect(alerts[0].severity, 'The radiology critical alert was not raised at critical severity.').toBe('critical');
  });

  test('TC-P5F-011 The study cannot be started twice, and the ladder cannot be skipped', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedStudy();

    await openRadiology(page);
    await openStudy(page, NAME);
    await startStudyButton(page).click();
    await page.waitForTimeout(2_000);

    const order = await radiologyOrderById(orderId);
    expect(order?.status, 'Start Study did not move the order to "in_progress".').toBe('in_progress');

    await expect(
      startStudyButton(page),
      'The Start Study button is still offered on a study already in progress. Two radiographers ' +
      'acting on the same order is how a patient is scanned twice and irradiated twice.',
    ).toBeHidden();

    await expect(
      imagesAcquiredButton(page),
      'The next step in the ladder is not offered, so the radiographer cannot record that the ' +
      'images were taken.',
    ).toBeVisible();
  });

  test('TC-P5F-012 A CT study records the radiation dose, so cumulative exposure can be tracked', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedStudy({ studyName: CT_STUDY });

    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: String(RAD.impression) });

    const dose = page.getByPlaceholder(/dose|mgy/i).first();
    if (await dose.count()) {
      await dose.fill(String(RAD.doseMgy));
      await page.waitForTimeout(400);
    }
    await saveReportDraft(page);

    const order = await radiologyOrderById(orderId);
    expect(
      order?.dose_mgy,
      'No radiation dose was recorded for a CT. Cumulative dose is what stops a patient being ' +
      'scanned repeatedly without anyone adding it up, and the dose field is rendered for exactly ' +
      'the modalities where it matters (xray, ct, fluoroscopy).',
    ).toBeTruthy();
  });

  /* ── ✅ Finding R1 (fixed) — the OPD-raised order that could never be reported ── */

  test('TC-P5F-013 A study raised without a report shell can still be reported', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // Deliberately NO report shell — the state syncRadiologyOrders used to leave behind, and
    // the state any future insert path could still produce.
    const { orderId } = await seedStudy({ withReportShell: false });

    expect(
      await radiologyReportFor(orderId),
      'Precondition: this case is only meaningful when the order genuinely starts with no ' +
      'report row.',
    ).toBeNull();

    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: String(RAD.impression) });
    await saveReportDraft(page);
    await page.waitForTimeout(2_500);

    const report = await radiologyReportFor(orderId);
    expect(
      report,
      'The radiologist wrote a report and it went nowhere. This was FINDING R1: only ' +
      'NewRadiologyOrderModal created the radiology_reports row, so every study a doctor ' +
      'ordered from the consultation workspace arrived in radiology with nothing to write ' +
      'into, and saveDraft returned silently. RadiologyReportingWorkspace.ensureReport() now ' +
      'creates the row on demand — if this fails, that safety net is gone and a completed ' +
      'study can be stranded as permanently unreportable again.',
    ).not.toBeNull();
    expect(String((report as Record<string, unknown>)?.findings ?? '')).toContain(String(RAD.findings));
  });

  test('TC-P5F-014 Signing a study that has no report shell does not fail silently', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedStudy({ withReportShell: false });

    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: String(RAD.impression) });

    const sign = validateAndSignButton(page);
    const enabled = await sign.isEnabled().catch(() => false);
    await sign.click().catch(() => { /* the button may not be actionable */ });
    await page.waitForTimeout(2_500);
    const message = await toastText(page, 4_000);

    const order = await radiologyOrderById(orderId);
    const signed = order?.status === 'validated';

    expect(
      signed || message.length > 0,
      'FINDING R1 — EXPECTED FAIL. THE WORST SHAPE OF THIS BUG. `validateAndSign` opens with ' +
      '`if (!report || !currentUserId) return;` (:283), while `canSign` only checks that ' +
      `findings and impression are non-empty (:556) — so the button is ENABLED (${enabled}), the ` +
      'radiologist clicks it, and absolutely nothing happens: no toast, no error, no status ' +
      'change. They believe the study is reported. The referring doctor sees it as unreported. ' +
      'Neither of them is told. A failure has to be visible to the person who caused it.',
    ).toBe(true);
  });

  test('TC-P5F-015 A study with no report shell does not present itself as reportable', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await seedStudy({ withReportShell: false });

    await driveStudyToImagesAcquired(page, NAME);
    await fillReport(page, { findings: String(RAD.findings), impression: String(RAD.impression) });

    const sign = validateAndSignButton(page);
    const draft = saveDraftButton(page);

    expect(
      (await sign.isEnabled().catch(() => false)) || (await draft.isEnabled().catch(() => false)),
      'FINDING R1 — EXPECTED FAIL. Both Save Draft and Validate & Sign are enabled on a study ' +
      'that has no report row for either of them to write into. A control that cannot succeed ' +
      'must not be offered — either disable it with a reason the radiologist can read, or create ' +
      'the missing shell when the workspace opens.',
    ).toBe(false);
  });

  test('TC-P5F-016 A radiology order is scoped to the tenant that raised it', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, orderId } = await seedStudy();
    const hidB = await hospitalIdFor('B');

    const order = await radiologyOrderById(orderId);
    expect(order?.hospital_id, 'The order was stamped with the wrong tenant.').toBe(hid);

    const { data: leaked } = await db().from('radiology_orders')
      .select('id').eq('id', orderId).eq('hospital_id', hidB);
    expect(
      leaked?.length ?? 0,
      'A Hospital A radiology order resolved inside Hospital B. An imaging order carries the ' +
      'patient name, the clinical history and the indication — a cross-tenant read is a DPDP Act ' +
      'breach, and RLS is the only thing standing between the two hospitals.',
    ).toBe(0);

    const allForPatient = await radiologyOrdersFor(hid, order?.patient_id as string);
    expect(allForPatient.every(o => o.hospital_id === hid), 'A patient read returned another tenant\'s rows.').toBe(true);
  });
});
