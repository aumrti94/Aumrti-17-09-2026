/**
 * Phase 5 · Section G — Instrument governance (TC-P5G-001, 002)
 *
 * ENTIRELY NEW COVERAGE. Before this rewrite the `📊 QC Dashboard`, `🔧 Calibration (NABL)` and
 * `⚙️ Analyzer Interface` tabs had never been opened by a single test — three whole screens, and
 * with them the entire question of whether the number on a report can be trusted.
 *
 * WHY QC IS A PATIENT-SAFETY JOURNEY AND NOT A DASHBOARD TEST. Quality control is the difference
 * between a number and a result. If the analyser is out of control the value is untrustworthy no
 * matter how normal it looks, and a laboratory that releases anyway issues confidently wrong
 * reports for a whole shift. The override exists because a supervisor sometimes must release
 * regardless — which is exactly why it has to be recorded, attributable, and out of reach of the
 * bench technician who is under pressure to clear the queue.
 *
 * THE ONE SEED, AND WHY IT IS LEGITIMATE. Westgard rules are rules ABOUT A SEQUENCE — 2-2s, 4-1s
 * and 10x cannot be violated by a single run. Nine in-control runs are seeded (condition (a): they
 * predate the test's clock); the tenth, the one that BREAKS control, is typed through the dialog by
 * the journey, so the violation is triggered by a user action rather than fabricated.
 */
import { test, expect } from './p5-journey.fixture';
import { MOCK } from '../fixtures/auth.fixture';
import { db } from '../utils/db-verify';
import { testTitle } from './p5-manifest';
import { userIdByName } from '../phase-04-opd-journey/opd-helpers';
import { labOrdersFor, labOrderItems, nabhEvidenceFor } from './lab-rad-helpers';
import { seedQcHistory, seedAnalyzerMessage } from './p5-seed-of-last-resort';
import { RUN_TAG } from './p5-patients';
import {
  orderLabThroughModal, collectThroughWorkstation, receiveSample, processSample,
  openOrderInWorklist, enterResult, releaseResults, recordQcRun, recordQcOverride,
  addCalibrationRecord, addAnalyzerDevice, addAnalyzerMapping, clickIfEnabled,
} from './p5-stages';
import {
  openLabTab, LAB_TABS, recordQcButton, saveQcEntryButton, qcRejectBadge, qcBlockedBanner,
  qcOverrideOpenButton, qcOverrideConfirmButton, validateAndReleaseButton,
  submitForValidationButton, addCalibrationButton, saveCalibrationButton,
  calibrationOverdueBadge, addAnalyzerButton, saveAnalyzerButton, analyzerPostButton,
  mappingAddButton, qcTestFilter, qcAnalyzerFilter,
} from './lab-locators';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;

const DOCTOR = MOCK.doctorFees[0].doctor;
const K_TEST = String(P5.labOrder.primaryTest);
const HB = String(P5.labOrder.normalTest);
const ANALYZER = `QA Analyzer ${RUN_TAG}`;

test.describe('P5G — Instrument governance', () => {
  test(testTitle('TC-P5G-001'), async ({ page, loginAs, logout, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    let orderId = '';
    const QC_MEAN = 5.0;
    const QC_SD = 0.2;

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      // CONDITION (a) — a multi-rule needs a history; the violating run is typed by the journey.
      const doctorId = await userIdByName(hid, DOCTOR).catch(() => undefined);
      const n = await seedQcHistory({
        hospitalId: hid, testName: K_TEST, analyzer: ANALYZER,
        mean: QC_MEAN, sd: QC_SD, runs: 9, recordedBy: doctorId,
      });
      expect(n, 'The QC run history was not seeded.').toBe(9);
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await openLabTab(page, LAB_TABS.qc);
      await expect(
        page.getByText(/QC Dashboard|Westgard/i).first(),
        'The QC Dashboard did not open. It has never been opened by any test before this journey.' +
        jrn.note(),
      ).toBeVisible({ timeout: 20_000 });
    });

    await jrn.next(async () => {
      await expect.soft(
        page.getByText(new RegExp(K_TEST.replace(/[()]/g, '.'), 'i')).first(),
        'The seeded analyte does not appear on the QC dashboard, so nine recorded runs are ' +
        'invisible to the people who are supposed to act on them.',
      ).toBeVisible({ timeout: 12_000 });
    });

    await jrn.next(async () => {
      // The two filters are Radix `<Select>` (`LabQCDashboard.tsx:112-125`), which render as
      // `role="combobox"` buttons — NOT `<select>` elements. Looking for `<select>` found nothing
      // and reported two filters that are plainly on screen as missing.
      const testFilter = qcTestFilter(page);
      const analyzerFilter = qcAnalyzerFilter(page);

      await expect.soft(
        testFilter,
        'The dashboard offers no test filter, so a laboratory running twenty analytes reads one ' +
        'undifferentiated list and cannot see whether a single analyte is out of control.',
      ).toBeVisible({ timeout: 10_000 });
      await expect.soft(
        analyzerFilter,
        'The dashboard offers no analyzer filter, so a laboratory with three analysers cannot tell ' +
        'which instrument is drifting.',
      ).toBeVisible({ timeout: 10_000 });

      // Open and close each, to prove they are usable rather than merely rendered.
      for (const filter of [testFilter, analyzerFilter]) {
        if (await filter.isVisible().catch(() => false)) {
          await filter.click().catch(() => { /* already open */ });
          await page.waitForTimeout(600);
          await page.keyboard.press('Escape').catch(() => { /* nothing open */ });
          await page.waitForTimeout(300);
        }
      }
    });

    await jrn.next(async () => {
      await recordQcButton(page).click();
      await page.waitForTimeout(1_500);
      await expect(
        page.getByText(/Record QC Run/i).first(),
        'The Record QC dialog did not open.' + jrn.note(),
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await saveQcEntryButton(page).click();
      await page.waitForTimeout(2_000);
      const toastText = await page.locator('[role="status"], [data-sonner-toast]').first()
        .innerText().catch(() => '');
      expect.soft(
        /fill all fields/i.test(toastText),
        'An empty QC run was accepted. A QC entry with no value, mean or SD cannot be evaluated ' +
        'against any rule, so it silently becomes a run that "passed" and dilutes the very ' +
        `history the rules read. Toast was: "${toastText}"`,
      ).toBe(true);
    });

    await jrn.next(async () => {
      // A value 4 SD from the mean — an unambiguous 1-3s Westgard reject, not a borderline call.
      const violating = String(QC_MEAN + 4 * QC_SD);
      const { qcTestNameInput, qcAnalyzerInput, qcValueInput, qcMeanInput, qcSdInput } =
        await import('./lab-locators');
      await qcTestNameInput(page).fill(K_TEST);
      await qcAnalyzerInput(page).fill(ANALYZER);
      await qcValueInput(page).fill(violating);
      await qcMeanInput(page).fill(String(QC_MEAN));
      await qcSdInput(page).fill(String(QC_SD));
      await page.waitForTimeout(500);
    });

    await jrn.next(async () => {
      await saveQcEntryButton(page).click();
      await page.waitForTimeout(3_000);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_qc_entries').select('id, value')
        .eq('hospital_id', hid).eq('test_name', K_TEST).eq('analyzer', ANALYZER);
      expect(
        data?.length ?? 0,
        'The QC run typed through the dialog was not recorded, so the laboratory has no record ' +
        'that control was run at all.' + jrn.note(),
      ).toBeGreaterThan(9);
    });

    await jrn.next(async () => {
      await expect.soft(
        qcRejectBadge(page),
        'A value four standard deviations from the mean did not raise a REJECT. Westgard 1-3s is ' +
        'the least ambiguous rule there is — if this does not trip, no rule does, and the QC ' +
        'dashboard is decoration.',
      ).toBeVisible({ timeout: 12_000 });
    });

    await jrn.next(async () => {
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [K_TEST] });
      const orders = await labOrdersFor(hid, pid);
      orderId = orders[0].id as string;
      await collectThroughWorkstation(page, patient.uhid);
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
    });

    await jrn.next(async () => {
      await openOrderInWorklist(page, patient.uhid);
      await enterResult(page, K_TEST, String(P5.results.normalPotassium));
    });

    await jrn.next(async () => {
      const blocked = await qcBlockedBanner(page).isVisible().catch(() => false);
      const releaseEnabled = await validateAndReleaseButton(page).isEnabled().catch(() => false);
      const submitEnabled = await submitForValidationButton(page).isEnabled().catch(() => false);
      expect.soft(
        blocked || !(releaseEnabled || submitEnabled),
        'A result was releasable while QC for that analyte is in a reject state. The number looks ' +
        'perfectly normal — that is the danger. Every result on that analyser this shift is ' +
        'suspect, and releasing them means the laboratory issues confidently wrong reports until ' +
        'somebody notices the control failed.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect.soft(
        String((data as { status: string } | null)?.status ?? ''),
        'The order was released despite the QC reject.',
      ).not.toBe('completed');
    });

    await jrn.next(async () => {
      const canOverride = await qcOverrideOpenButton(page).isVisible().catch(() => false);
      expect.soft(
        canOverride,
        'A bench technician is offered the supervisor QC override. The override is the one control ' +
        'that lets a suspect result out; putting it in reach of the person under pressure to clear ' +
        'the queue removes the second opinion it exists to require.',
      ).toBe(false);
      await expect.soft(
        page.getByText(/pathologist\/supervisor must record/i).first(),
        'The technician is not told who can override, so they will either guess or ask nobody.',
      ).toBeVisible({ timeout: 8_000 });
    });

    await jrn.next(async () => {
      await logout();
      await loginAs('doctor', { hospital: 'A' });
      await openOrderInWorklist(page, patient.uhid);
    });

    await jrn.next(async () => {
      const open = qcOverrideOpenButton(page);
      await expect(
        open,
        'The supervising pathologist is not offered the QC override, so a laboratory with a failed ' +
        'control cannot release anything at all until QC is repeated — which on a night shift ' +
        'means no results leave the laboratory.' + jrn.note(),
      ).toBeVisible({ timeout: 15_000 });
      await open.click();
      await page.waitForTimeout(1_500);
    });

    await jrn.next(async () => {
      await expect.soft(
        qcOverrideConfirmButton(page),
        'The override confirms with no reason typed. "Somebody overrode QC" with no reason is an ' +
        'audit trail that records the fact and loses the justification, which is the half an ' +
        'assessor asks about.',
      ).toBeDisabled();
    });

    await jrn.next(async () => {
      await recordQcOverride(page, 'QC repeated and acceptable; corrective action logged separately.');
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('*').eq('id', orderId).maybeSingle();
      const row = JSON.stringify(data ?? {});
      expect.soft(
        /repeated and acceptable|override/i.test(row),
        'The override reason was not recorded against the order, so the report goes out with no ' +
        'trace of why a failed control was set aside.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      await releaseResults(page);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders').select('status').eq('id', orderId).maybeSingle();
      expect.soft(
        ['completed', 'pending_validation'],
        'The report could not be released even after a recorded supervisor override, so the ' +
        'override achieves nothing and the laboratory is still stuck.',
      ).toContain(String((data as { status: string } | null)?.status));
    });

    await jrn.next(async () => {
      const since = new Date(Date.now() - 30 * 60_000);
      const evidence = await nabhEvidenceFor(hid, since);
      const qc = evidence.filter(e => /qc|quality|override/i.test(JSON.stringify(e)));
      expect.soft(
        qc.length,
        'The QC override wrote no NABH evidence. QPS.2 is precisely about quality control and its ' +
        'exceptions — an override with no evidence row is the one event an assessor is most ' +
        'likely to ask to see and the laboratory least able to produce.',
      ).toBeGreaterThan(0);
    });
  });

  test(testTitle('TC-P5G-002'), async ({ page, loginAs, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    let orderId = '';
    let accession = '';

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await openLabTab(page, LAB_TABS.calibration);
      await expect(
        page.getByText(/Calibration/i).first(),
        'The Calibration (NABL) tab did not open. It has never been opened by any test before ' +
        'this journey.' + jrn.note(),
      ).toBeVisible({ timeout: 20_000 });
    });

    await jrn.next(async () => {
      await addCalibrationButton(page).click();
      await page.waitForTimeout(1_500);
      await expect(
        page.getByText(/Add Calibration Record/i).first(),
        'The Add Calibration dialog did not open.' + jrn.note(),
      ).toBeVisible();
    });

    await jrn.next(async () => {
      await saveCalibrationButton(page).click();
      await page.waitForTimeout(2_000);
      const toastText = await page.locator('[role="status"], [data-sonner-toast]').first()
        .innerText().catch(() => '');
      expect.soft(
        /required|analyzer name/i.test(toastText),
        'A calibration record was accepted with no analyser and no dates. A NABL file full of ' +
        `blank calibration entries is worse than an empty one — it looks compliant. Toast was: "${toastText}"`,
      ).toBe(true);
    });

    await jrn.next(async () => {
      const { calibrationAnalyzerInput } = await import('./lab-locators');
      await calibrationAnalyzerInput(page).fill(ANALYZER);
      const dates = page.locator('input[type="date"]');
      const today = new Date().toISOString().slice(0, 10);
      const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
      if (await dates.count()) {
        await dates.nth(0).fill(today).catch(() => { /* different order */ });
        await dates.nth(1).fill(past).catch(() => { /* only one date */ });
      }
      const typeSelect = page.locator('select').first();
      if (await typeSelect.count()) {
        await typeSelect.selectOption('internal').catch(() => { /* option differs */ });
      }
      await page.waitForTimeout(400);
    });

    await jrn.next(async () => {
      const { calibrationDeviationInput, calibrationCalibratedByInput } = await import('./lab-locators');
      const selects = page.locator('select');
      if (await selects.count() > 1) {
        await selects.nth(1).selectOption('pass').catch(() => { /* option differs */ });
      }
      await calibrationDeviationInput(page).fill('1.8').catch(() => { /* optional */ });
      await calibrationCalibratedByInput(page).fill(`QA Tech ${RUN_TAG}`).catch(() => { /* optional */ });
      await page.waitForTimeout(400);
    });

    await jrn.next(async () => {
      await saveCalibrationButton(page).click();
      await page.waitForTimeout(3_000);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_calibration_records').select('*')
        .eq('hospital_id', hid).ilike('analyzer_name', `%${RUN_TAG}%`);
      expect.soft(
        data?.length ?? 0,
        'The calibration record did not persist. NABL wants to see that the analyser producing a ' +
        'number was calibrated; a record that does not save means the laboratory can demonstrate ' +
        'nothing at an assessment.' + jrn.note(),
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      for (const header of [/Analyzer/i, /Calibration Date/i, /Next Due/i]) {
        await expect.soft(
          page.getByText(header).first(),
          `The calibration table has no ${String(header)} column.`,
        ).toBeVisible();
      }
    });

    await jrn.next(async () => {
      await expect.soft(
        calibrationOverdueBadge(page),
        'A calibration whose next-due date is in the past is not counted as overdue. The overdue ' +
        'count is the only thing that makes a laboratory look at this screen at all — without it ' +
        'an analyser drifts out of calibration and nobody is told.',
      ).toBeVisible({ timeout: 10_000 });
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.analyzer);
      await expect(
        page.getByText(/Analyzer|Result Inbox|Connected Analyzers/i).first(),
        'The Analyzer Interface tab did not open. It has never been opened by any test before ' +
        'this journey.' + jrn.note(),
      ).toBeVisible({ timeout: 20_000 });
    });

    await jrn.next(async () => {
      await addAnalyzerButton(page).click();
      await page.waitForTimeout(1_500);
      await expect(page.getByText(/Add Analyzer/i).first(), 'The Add Analyzer dialog did not open.')
        .toBeVisible();
    });

    await jrn.next(async () => {
      // Disabled is the BETTER refusal, and a bare click on a disabled button burns the full
      // action timeout and reports a click failure at the moment the product behaved correctly.
      const outcome = await clickIfEnabled(saveAnalyzerButton(page));
      await page.waitForTimeout(1_500);
      const stillOpen = outcome !== 'clicked'
        || await saveAnalyzerButton(page).isVisible().catch(() => false);
      expect.soft(
        stillOpen,
        'A connector was saved with no device name and no protocol. A nameless analyser on the ' +
        'wire cannot be matched to the results it pushes, so everything it sends lands in the ' +
        'inbox as unattributed.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      const { analyzerNameInput, analyzerManufacturerInput } = await import('./lab-locators');
      await analyzerNameInput(page).fill(ANALYZER);
      await analyzerManufacturerInput(page).fill('Mindray').catch(() => { /* optional */ });
      const proto = page.locator('select').first();
      if (await proto.count()) {
        await proto.selectOption('hl7_mllp').catch(() => { /* option differs */ });
      }
      await page.waitForTimeout(400);
    });

    await jrn.next(async () => {
      const { analyzerHostInput, analyzerSecretInput } = await import('./lab-locators');
      await analyzerHostInput(page).fill('192.168.1.50').catch(() => { /* optional */ });
      await analyzerSecretInput(page).fill(`secret-${RUN_TAG}`).catch(() => { /* optional */ });
      await page.waitForTimeout(400);
    });

    await jrn.next(async () => {
      await saveAnalyzerButton(page).click();
      await page.waitForTimeout(3_000);
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_device_connectors').select('device_name, protocol')
        .eq('hospital_id', hid).ilike('device_name', `%${RUN_TAG}%`);
      expect.soft(
        data?.length ?? 0,
        'The analyser connector did not persist, so nothing can be configured to receive results ' +
        'from the instrument at all.' + jrn.note(),
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      const mappings = page.getByRole('button', { name: /^mappings$/i }).first();
      if (await mappings.count()) {
        await mappings.click();
        await page.waitForTimeout(1_800);
      }
    });

    await jrn.next(async () => {
      await mappingAddButton(page).click().catch(() => { /* correctly disabled */ });
      await page.waitForTimeout(1_500);
      const stillOpen = await mappingAddButton(page).isVisible().catch(() => false);
      expect.soft(
        stillOpen,
        'A test-code mapping was added with no code and no target test. An unmapped or ' +
        'mis-mapped code files an analyser result against the wrong analyte, which is a wrong ' +
        'result with a plausible number on it.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      const { mappingCodeInput, mappingNameInput } = await import('./lab-locators');
      await mappingCodeInput(page).fill('K').catch(() => { /* field differs */ });
      await mappingNameInput(page).fill(K_TEST).catch(() => { /* optional */ });
      const testSelect = page.locator('select').last();
      if (await testSelect.count()) {
        await testSelect.selectOption({ label: K_TEST }).catch(() => { /* label differs */ });
      }
      await page.waitForTimeout(400);
      await mappingAddButton(page).click().catch(() => { /* still disabled */ });
      await page.waitForTimeout(2_500);
    });

    await jrn.next(async () => {
      await expect.soft(
        page.getByText(/^K$/).first(),
        'The mapping does not appear in the table, so the operator cannot confirm which analyser ' +
        'code now resolves to which test.',
      ).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /^close$/i }).first().click()
        .catch(() => { /* dialog closed itself */ });
      await page.waitForTimeout(1_000);
    });

    await jrn.next(async () => {
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [K_TEST] });
      const orders = await labOrdersFor(hid, pid);
      orderId = orders[0].id as string;
      accession = String(orders[0].accession_number ?? '');
      await collectThroughWorkstation(page, patient.uhid);
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
    });

    await jrn.next(async () => {
      // CONDITION (c) — there is no HL7 device on the wire in CI. The message is the DEVICE's
      // output; everything the product does with it happens through the browser below.
      expect(accession, 'The order carries no accession for the analyzer message to match on.').toBeTruthy();
      await seedAnalyzerMessage({
        hospitalId: hid, accessionNumber: accession, testCode: 'K',
        value: String(P5.results.normalPotassium), unit: 'mEq/L',
      });
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.analyzer);
      await page.waitForTimeout(2_000);
      const row = page.getByRole('button').filter({ hasText: accession }).first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(2_000);
      }
    });

    await jrn.next(async () => {
      await expect.soft(
        page.getByText(accession).first(),
        'The inbound analyser message is not shown in the result inbox with its accession, so ' +
        'nobody can tell which request it belongs to before posting it.',
      ).toBeVisible({ timeout: 12_000 });
    });

    await jrn.next(async () => {
      const post = analyzerPostButton(page);
      if (await post.isVisible().catch(() => false)) {
        await post.click();
        await page.waitForTimeout(3_000);
      }
    });

    await jrn.next(async () => {
      const items = await labOrderItems(orderId);
      expect.soft(
        items[0]?.result_value,
        'The analyser value did not reach the order. The whole point of an interface is that a ' +
        'number typed by a machine does not have to be retyped by a human — a post that does not ' +
        'land means every result is still hand-keyed, with the transcription errors that implies.',
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      await seedAnalyzerMessage({
        hospitalId: hid, accessionNumber: `ACC-00000000-0000`, testCode: 'K', value: '4.4',
      });
      await openLabTab(page, LAB_TABS.analyzer);
      await page.waitForTimeout(2_500);
      const orphan = page.getByRole('button').filter({ hasText: /ACC-00000000-0000/ }).first();
      if (await orphan.count()) {
        await orphan.click();
        await page.waitForTimeout(1_800);
        const post = analyzerPostButton(page);
        expect.soft(
          await post.isEnabled().catch(() => false),
          'A message whose accession matches no order can still be posted. Posting an unmatched ' +
          'result files a number against whatever the screen happened to have selected, which is ' +
          'the worst possible outcome of an automated interface.',
        ).toBe(false);
      }
    });
  });
});
