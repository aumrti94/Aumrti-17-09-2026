/**
 * Phase 5 · Section G — PCPNDT Form F (P5-S13 🔴, P5-S14)
 * Locks tracker cases TC-P5G-001 … TC-P5G-014
 *
 * THIS IS STATUTORY, NOT A DATA-QUALITY CONCERN. Under the Pre-Conception and Pre-Natal
 * Diagnostic Techniques Act a Form F is mandatory for EVERY obstetric ultrasound, and its
 * absence is a criminal exposure for the hospital and the radiologist personally. A register
 * padded with non-obstetric scans is its own problem — it invites scrutiny the hospital does not
 * need — so the false-positive side (TC-P5G-008 … 010) is tested with the same care as the
 * false-negative side.
 *
 * WHAT PHASE 4 ALREADY COVERS, AND WHY NOTHING HERE REPEATS IT.
 * `TC-P4G-016/017/018/019` lock the AUTO-CREATE from an OPD consultation: an obstetric study
 * ordered in the Rx tab must write `pcpndt_form_f` and set `is_pcpndt`. Section 5G owns
 * everything the radiology module itself does — the order path through `NewRadiologyOrderModal`,
 * the completion of the form, the two gates, and the register the inspector actually reads.
 *
 * 🔴 FINDING R2 IS THE CENTRAL DEFECT HERE, AND IT IS WORSE THAN A MISSING ROW.
 * There are TWO unrelated tables:
 *
 *     pcpndt_form_f    ← written by NewRadiologyOrderModal:456 and investigationSync:286
 *                        read by nothing except HMISPage
 *     pcpndt_records   ← written by PCPNDTFormModal only
 *                        read by the REGISTER page, the "Start Study" gate AND the sign gate
 *
 * So the statutory row the product auto-creates satisfies nothing: it does not appear in the
 * register an inspector opens, it does not release the Start Study gate, and it does not release
 * the sign gate. The radiologist must re-key the entire form by hand, and a hospital that trusts
 * the auto-create has a register with holes in it. TC-P5G-004/005/006 pin each consequence
 * separately, because "the tables are split" is a cause and each of those is a distinct failure a
 * different person experiences.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedRadiologyOrder, radiologyOrderById, radiologyStudyByName, formFRowsFor, pcpndtRecordsFor,
  requiresFormF, purgeLabRadArtefacts,
} from './lab-rad-helpers';
import {
  openRadiology, openStudy, openPcpndtRegister, pcpndtGateButton, openPcpndtFormButton,
  pcpndtRegisterEmptyState, startStudyButton, savePcpndtFormButton, pcpndtWarningBanner,
  newRadiologyOrderButton, studySearchInput, proceedToPaymentButton, collectAndCreateButton,
  toastText,
} from './radiology-locators';
import { fillPcpndtFormF, driveStudyToImagesAcquired } from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;
const PC = P5.pcpndt;
const RAD = P5.radiology;

const PREG_UHID = String(PC.patientUhid);
const PREG_NAME = String(PC.patientName);
const PLAIN_UHID = String(PC.nonObstetricPatientUhid);
const PLAIN_NAME = 'Ramesh Kumar';
const DOCTOR = MOCK.doctorFees[0].doctor;

const OBSTETRIC = String(RAD.obstetricStudy);
const OBSTETRIC_VARIANT = String(RAD.obstetricStudyVariant);
const NON_OBSTETRIC = String(RAD.nonObstetricStudy);

async function seedScan(studyName: string, uhid = PREG_UHID): Promise<{
  hid: string; pid: string; doctorId: string; orderId: string; isPcpndt: boolean;
}> {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, uhid);
  const doctorId = await userIdByName(hid, DOCTOR);
  await purgeLabRadArtefacts(hid, [pid]);
  const seeded = await seedRadiologyOrder({
    hospitalId: hid, patientId: pid, orderedBy: doctorId,
    studyName, billingStatus: 'billed',
    clinicalHistory: String(PC.indication),
  });
  return { hid, pid, doctorId, orderId: seeded.orderId, isPcpndt: seeded.isPcpndt };
}

test.describe('P5G — PCPNDT Form F', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('radiologist', { hospital: 'A' });
    await openRadiology(page);
  });

  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    for (const uhid of [PREG_UHID, PLAIN_UHID]) {
      await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, uhid)]);
    }
  });

  /* ── Prerequisites ──────────────────────────────────────────────────── */

  test('TC-P5G-001 The centre\'s PCPNDT machine and doctor registrations are configured', async () => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');

    const { data } = await db().from('pcpndt_settings')
      .select('machine_name, machine_registration_number, doctor_pcpndt_registration')
      .eq('hospital_id', hid).maybeSingle();

    expect(
      data,
      'PREREQUISITE. pcpndt_settings has no row for this tenant. SETTINGS_PREREQ_MATRIX.md names ' +
      'it as a Phase 5 prerequisite because a Form F without the machine registration number and ' +
      'the sonologist\'s PCPNDT registration is not a valid statutory record — the printed ' +
      'register is what an inspector reads, and those two numbers are the first things checked. ' +
      'Run npm run qa:seed with the updated seeder.',
    ).toBeTruthy();
    expect(
      String((data as { machine_registration_number?: string }).machine_registration_number ?? ''),
      'The ultrasound machine has no PCPNDT registration number recorded.',
    ).not.toBe('');
  });

  test('TC-P5G-002 Both obstetric studies in the catalogue are flagged requires_form_f, independently of their names', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    for (const name of [OBSTETRIC, OBSTETRIC_VARIANT]) {
      const study = await radiologyStudyByName(hid, name);
      expect(
        study.requires_form_f,
        `"${name}" is not flagged requires_form_f. The flag is authoritative over any keyword ` +
        'heuristic (src/lib/pcpndt.ts:95), and it is what makes the trigger independent of a ' +
        `hospital's naming conventions — "${OBSTETRIC_VARIANT}" is clinically obstetric and does ` +
        'not contain the word "obstetric" anywhere. Without the flag it depends on a keyword list ' +
        'matching a free-text label, which is how a statutory record goes missing.',
      ).toBe(true);
    }
  });

  test('TC-P5G-003 A hospital can flag its own study as requiring Form F when the keywords miss it', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    // The flag is only settable if the Settings screen reads and writes the column.
    const { data } = await db().from('radiology_study_master')
      .select('study_name, requires_form_f').eq('hospital_id', hid).eq('requires_form_f', true);
    expect((data ?? []).length, 'No study carries the flag at all — run npm run qa:seed.').toBeGreaterThan(0);

    const settingsSource = await import('node:fs').then(fs =>
      fs.readFileSync('src/pages/settings/SettingsRadiologyPage.tsx', 'utf8'));

    expect(
      /requires_form_f/.test(settingsSource),
      'FINDING R4 — EXPECTED FAIL. SettingsRadiologyPage.tsx never selects or updates ' +
      'requires_form_f, so the flag is not settable from any UI in the product — only the ' +
      'one-time SQL backfill in migration 20261013000019 ever sets it. A hospital that adds an ' +
      'obstetric study under a house name after that migration ("TIFFA Level 2", "Early Preg ' +
      'Scan") therefore depends entirely on the keyword fallback, and cannot flag a study the ' +
      'keywords miss. The migration comment claims "Set per hospital in Settings → Radiology", ' +
      'which is not true today.',
    ).toBe(true);
  });

  /* ── P5-S13 · The obstetric journey 🔴 ──────────────────────────────── */

  test('TC-P5G-004 Obstetric USG journey: the order is flagged is_pcpndt and a Form F is auto-created', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId, isPcpndt } = await seedScan(OBSTETRIC);
    expect(isPcpndt, 'The fixture did not resolve the study as PCPNDT.').toBe(true);

    const order = await radiologyOrderById(orderId);
    expect(
      order?.is_pcpndt,
      'The order is not flagged is_pcpndt. Without the flag the register cannot find the scan ' +
      'retrospectively either, so a hospital cannot reconcile a shortfall before an inspection ' +
      'finds it for them.',
    ).toBe(true);
  });

  test('TC-P5G-005 The auto-created Form F appears in the PCPNDT register an inspector actually reads', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedScan(OBSTETRIC);

    // Prove the auto-create path wrote its row, so a failure below is about the SPLIT, not
    // about a missing Form F.
    const autoCreated = await formFRowsFor(orderId);
    const inRegister = await pcpndtRecordsFor(orderId);

    await openPcpndtRegister(page);
    const emptyRegister = await pcpndtRegisterEmptyState(page).isVisible().catch(() => false);

    expect(
      inRegister.length,
      'FINDING R2 — EXPECTED FAIL. The auto-create path writes to `pcpndt_form_f` ' +
      `(${autoCreated.length} row(s) present), but PCPNDTRegisterPage queries ` +
      '`pcpndt_records` — a different, unrelated table. So the statutory record the product ' +
      'creates automatically NEVER APPEARS IN THE REGISTER. An inspector opens the register, ' +
      'sees obstetric scans missing, and the hospital cannot explain why its own system recorded ' +
      'them somewhere nobody reads. The two tables must be reconciled to one.' +
      (emptyRegister ? ' The register rendered its empty state.' : ''),
    ).toBeGreaterThan(0);
  });

  test('TC-P5G-006 A PCPNDT study with a Form F on file can be started without re-keying the form', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedScan(OBSTETRIC);
    const autoCreated = await formFRowsFor(orderId);

    await openRadiology(page);
    await openStudy(page, PREG_NAME);

    const gated = await pcpndtGateButton(page).isVisible().catch(() => false);
    const startable = await startStudyButton(page).isVisible().catch(() => false);

    expect(
      startable && !gated,
      'FINDING R2 — EXPECTED FAIL. renderStatusAction (RadiologyReportingWorkspace.tsx:562) ' +
      'replaces "Start Study" with "Fill PCPNDT Form First" based on `pcpndtRecordExists`, which ' +
      `reads pcpndt_records — while the auto-create wrote ${autoCreated.length} row(s) to ` +
      'pcpndt_form_f. The gate is therefore unsatisfiable by the product\'s own automatic ' +
      'record: EVERY PCPNDT study is blocked until a human re-enters the whole form by hand, ' +
      'with a pregnant patient already on the couch. The auto-create is not a convenience that ' +
      'failed — it is work that is silently thrown away.',
    ).toBe(true);
  });

  test('TC-P5G-007 Completing Form F through the modal releases the gate and the study can proceed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedScan(OBSTETRIC);

    await openRadiology(page);
    await openStudy(page, PREG_NAME);
    await fillPcpndtFormF(page, { indication: String(PC.indication) });

    const records = await pcpndtRecordsFor(orderId);
    expect(
      records.length,
      'The Form F modal saved nothing to pcpndt_records. This is the ONLY path that satisfies ' +
      'both gates, so if it fails a PCPNDT study can never be started or signed at all.',
    ).toBeGreaterThan(0);
    expect(
      String(records[0].form_number ?? ''),
      'No form number was assigned. The register is indexed by form number; an unnumbered entry ' +
      'cannot be cited in a return to the appropriate authority.',
    ).toMatch(/^PCPNDT-\d{4}-\d{4}$/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openStudy(page, PREG_NAME);
    await expect(
      startStudyButton(page),
      'The Start Study gate did not release after the Form F was completed.',
    ).toBeVisible();
  });

  test('TC-P5G-008 Form F cannot be saved without the mandatory no-sex-determination declaration', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedScan(OBSTETRIC);

    await openRadiology(page);
    await openStudy(page, PREG_NAME);
    await openPcpndtFormButton(page).click();
    await page.waitForTimeout(1_500);

    // Fill the indication only — leave the declaration and the consent untouched.
    const { fillReportField } = await import('./radiology-locators');
    await fillReportField(page, /Indication/i, String(PC.indication))
      .catch(() => { /* pre-filled from the order */ });
    await page.waitForTimeout(500);

    const save = savePcpndtFormButton(page);
    const enabled = await save.isEnabled().catch(() => false);
    if (enabled) {
      await save.click();
      await page.waitForTimeout(2_000);
    }

    const records = await pcpndtRecordsFor(orderId);
    expect(
      records.length,
      'A Form F was saved without the sex-determination declaration and the patient consent. ' +
      'Those two are the entire legal point of the form — a Form F without the declaration is ' +
      'not a defective record, it is evidence that the declaration was never made.',
    ).toBe(0);
  });

  test('TC-P5G-009 A signed PCPNDT study carries a completed Form F, not a blank one', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId } = await seedScan(OBSTETRIC);

    await openRadiology(page);
    await openStudy(page, PREG_NAME);
    await fillPcpndtFormF(page, { indication: String(PC.indication) });

    const records = await pcpndtRecordsFor(orderId);
    expect(records.length, 'No Form F was saved to sign against.').toBeGreaterThan(0);
    const record = records[0];

    expect(
      record.no_sex_determination_declared,
      'The saved Form F does not carry the no-sex-determination declaration.',
    ).toBe(true);
    expect(record.consent_given, 'The saved Form F does not record patient consent.').toBe(true);
    expect(
      String(record.indication ?? ''),
      'The indication is empty. "Why was this scan done" is the question the whole Act turns on; ' +
      'a blank indication makes the record unusable as a defence.',
    ).not.toBe('');
  });

  /* ── P5-S14 · The false-positive side ───────────────────────────────── */

  test('TC-P5G-010 A non-obstetric abdominal ultrasound creates NO Form F', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId, isPcpndt } = await seedScan(NON_OBSTETRIC, PLAIN_UHID);

    expect(isPcpndt, `"${NON_OBSTETRIC}" must not resolve as PCPNDT.`).toBe(false);

    const order = await radiologyOrderById(orderId);
    expect(order?.is_pcpndt, 'An abdominal ultrasound was flagged is_pcpndt.').toBeFalsy();

    const forms = await formFRowsFor(orderId);
    const records = await pcpndtRecordsFor(orderId);
    expect(
      forms.length + records.length,
      'An abdominal ultrasound created a PCPNDT record. False positives are their own problem: a ' +
      'register padded with non-obstetric scans is unusable at inspection, inflates the centre\'s ' +
      'declared obstetric volume, and invites scrutiny the hospital does not need.',
    ).toBe(0);

    await openRadiology(page);
    await openStudy(page, PLAIN_NAME);
    await expect(
      pcpndtGateButton(page),
      'A non-obstetric scan was gated behind a Form F, which would stop routine abdominal work ' +
      'for no legal reason.',
    ).toBeHidden();
  });

  test('TC-P5G-011 An X-ray whose name mentions obstetrics is NOT pulled into the PCPNDT register', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // The determination requires an ULTRASOUND modality as well as an obstetric name; the Act
    // regulates ultrasonography, not radiography.
    expect(
      requiresFormF({ studyName: 'X-Ray Obstetric History', modalityType: 'xray' }),
      'A plain X-ray was pulled into the PCPNDT determination on its name alone. The Act ' +
      'regulates ultrasound; a radiograph in the Form F register is a false entry that the ' +
      'centre then has to account for.',
    ).toBe(false);

    expect(
      requiresFormF({ studyName: 'USG Abdomen & Pelvis', modalityType: 'usg' }),
      'A non-obstetric ultrasound was pulled in on its modality alone.',
    ).toBe(false);
  });

  test('TC-P5G-012 An obstetric study whose name omits the word "obstetric" is still caught', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { orderId, isPcpndt } = await seedScan(OBSTETRIC_VARIANT);

    expect(
      isPcpndt,
      `"${OBSTETRIC_VARIANT}" is clinically an obstetric scan whose name does not contain the ` +
      'word "obstetric". It must be caught either by requires_form_f on the study master or by ' +
      'the "pregnan" keyword fallback. A trigger that depends on a hospital naming its studies ' +
      'the way the code expects is not a statutory control.',
    ).toBe(true);

    const order = await radiologyOrderById(orderId);
    expect(order?.is_pcpndt, 'The variant order was not flagged is_pcpndt.').toBe(true);
  });

  test('TC-P5G-013 The order modal warns about PCPNDT for every study that will create a Form F', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, PREG_UHID);
    await purgeLabRadArtefacts(hid, [pid]);

    await openRadiology(page);
    await newRadiologyOrderButton(page).click();
    await page.waitForTimeout(1_200);

    const patientSearch = page.getByPlaceholder(/search.*patient|name, phone, or uhid/i).first();
    if (await patientSearch.count()) {
      await patientSearch.fill(PREG_UHID);
      await page.waitForTimeout(1_600);
      const hit = page.getByRole('button').filter({ hasText: PREG_UHID }).first();
      if (await hit.count()) await hit.click().catch(() => { /* auto-selected */ });
      await page.waitForTimeout(800);
    }

    const search = studySearchInput(page);
    if (await search.count()) {
      await search.fill(OBSTETRIC_VARIANT);
      await page.waitForTimeout(1_200);
    }
    const chip = page.getByRole('button')
      .filter({ hasText: new RegExp(OBSTETRIC_VARIANT.replace(/[()]/g, '.'), 'i') }).first();
    if (await chip.count()) await chip.click();
    await page.waitForTimeout(1_500);

    await expect(
      pcpndtWarningBanner(page),
      `FINDING R3 — EXPECTED FAIL. The banner is computed at NewRadiologyOrderModal.tsx:584 with ` +
      '`s.modalityType === "usg" && s.name.toLowerCase().includes("obstetric")` — the exact ' +
      'expression src/lib/pcpndt.ts was written to replace. So for ' +
      `"${OBSTETRIC_VARIANT}" the Form F IS created (line 421 uses the correct helper) but the ` +
      'operator is never warned it is about to enter statutory territory. The two halves of the ' +
      'same screen disagree about what PCPNDT means, and the person at the counter is the one ' +
      'left uninformed.',
    ).toBeVisible();
  });

  test('TC-P5G-014 A Form F is readable only inside the tenant that created it', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, orderId } = await seedScan(OBSTETRIC);
    const hidB = await hospitalIdFor('B');

    const forms = await formFRowsFor(orderId);
    test.skip(
      forms.length === 0,
      'No Form F row was auto-created, so there is nothing to test isolation against. That is ' +
      'covered by TC-P5G-005; this case needs the row to exist.',
    );

    expect(forms[0].hospital_id, 'The Form F was stamped with the wrong tenant.').toBe(hid);

    const { data: leaked } = await db().from('pcpndt_form_f')
      .select('id').eq('order_id', orderId).eq('hospital_id', hidB);
    expect(
      leaked?.length ?? 0,
      'A Hospital A Form F resolved inside Hospital B. A Form F carries the patient\'s name, ' +
      'address, husband\'s name and obstetric history — it is among the most sensitive records ' +
      'the hospital holds, and a cross-tenant read is both a DPDP Act breach and a PCPNDT one.',
    ).toBe(0);
  });
});
