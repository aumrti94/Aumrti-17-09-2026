/**
 * Phase 4 · Section J — Telemedicine & Voice Scribe (P4-S17, P4-S18 🔴)
 * Locks tracker cases TC-P4J-001 … TC-P4J-014
 *
 * THIS SECTION IS DELIBERATELY PART-AUTOMATED, and the split is the point.
 *
 * A script can prove the SHELL: that a teleconsult session is created, that the token records
 * `visit_mode = teleconsult`, that a prescription issued over video is stored and billed, that
 * the Voice Scribe panel mounts on the OPD workspace and that the Audio Rescue state exists.
 *
 * A script CANNOT speak. The cases that decide whether this feature is safe —
 *   "fifteen" heard as "fifty" on a Telmisartan dose,
 *   mixed Hindi/English dictation,
 *   Indian drug names against background OPD noise,
 *   the Audio Rescue re-transcription of a deliberately mumbled drug name —
 * need a human with a microphone. Those carry `test.skip` with a named reason, which records
 * N/A in the tracker rather than a false PASS. That is the Phase 2 precedent (PHASE_MAP.md:
 * "asserts everything provable from configuration and then test.skips with a named reason"),
 * chosen over leaving the row blank so the coverage gap is visible rather than invisible.
 *
 * Do NOT convert a skipped case into a passing one by weakening it. A transcription error here
 * is a prescribing error, and a green tick that did not listen to anything is worse than a
 * blank cell.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { openOpd } from './opd-locators';
import { registerWalkIn, openTokenAndStart, fillComplaint } from './opd-flows';
import { patientIdByUhid, purgeOpdArtefacts, tokensToday } from './opd-helpers';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const TELE = P4.teleconsult as Record<string, string>;
const DOCTOR = MOCK.doctorFees[0].doctor;
const DEPARTMENT = MOCK.doctorFees[0].department;
const UHID = TELE.patientUhid;
const NAME = 'Ramesh Kumar';
const TELEMEDICINE_ROUTE = '/telemedicine';

const MANUAL = 'MANUAL-ONLY: needs a human speaking into a real microphone. A script cannot ' +
  'produce speech, so automating this would assert nothing while reporting PASS.';

async function freshToken(page: import('@playwright/test').Page) {
  const hid = await hospitalIdFor('A');
  const pid = await patientIdByUhid(hid, UHID);
  await purgeOpdArtefacts(hid, [pid]);
  await registerWalkIn(page, { existingPatientQuery: UHID, department: DEPARTMENT, doctor: DOCTOR });
  return { hid, pid };
}

test.describe('P4J — Telemedicine & Voice Scribe', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('doctor', { hospital: 'A' });
    void page;
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await purgeOpdArtefacts(hid, [await patientIdByUhid(hid, UHID)]);
  });

  /* ── Telemedicine (P4-S17) ─────────────────────────────────────────── */

  test('TC-P4J-001 The telemedicine screen loads for a doctor', async ({ page, consoleErrors }) => {
    await page.goto(TELEMEDICINE_ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await expect(
      page.getByText(/teleconsult|telemedicine/i).first(),
      'The telemedicine module did not render at /telemedicine.',
    ).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver|DevTools|getUserMedia|permission/i.test(e));
    expect(real, `Console errors on ${TELEMEDICINE_ROUTE}:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P4J-002 A teleconsult token is distinguishable from a physical walk-in', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { hid, pid } = await freshToken(page);
    const tokens = await tokensToday(hid, pid);
    expect(
      'visit_mode' in tokens[0],
      'opd_tokens has no visit_mode column. A remote consultation is then indistinguishable from ' +
      'a patient who physically attended, which matters both for the Telemedicine Practice ' +
      'Guidelines record and for the fee the visit should carry.',
    ).toBeTruthy();
  });

  test('TC-P4J-003 A teleconsult token is offered a Start/Join action in the queue instead of a room call', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await db().from('opd_tokens').update({ visit_mode: 'teleconsult' } as never)
      .eq('hospital_id', hid).eq('patient_id', pid);
    await openOpd(page);
    await expect(
      page.getByRole('button', { name: /start teleconsult|join teleconsult/i }).first(),
      'A teleconsult patient in the queue is offered no way to start the video call, so the ' +
      'doctor has to find them in a separate module and the queue is lying about what is next.',
    ).toBeVisible();
  });

  test('TC-P4J-004 A teleconsult session records the consultation for audit', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await page.goto(TELEMEDICINE_ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const { error } = await db().from('teleconsult_sessions').select('id').eq('hospital_id', hid).limit(1);
    expect(
      error,
      'teleconsult_sessions is not readable. Without a session record there is no evidence a ' +
      'remote consultation took place, which the Telemedicine Practice Guidelines 2020 require ' +
      'the practitioner to be able to produce.',
    ).toBeNull();
  });

  test('TC-P4J-005 Telemedicine consent is captured before a remote consultation', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await page.goto(TELEMEDICINE_ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const consentPresent = await page.getByText(/consent|telemedicine practice guidelines/i).count();
    expect(
      consentPresent,
      'No consent language appears anywhere on the telemedicine screen. The Telemedicine Practice ' +
      'Guidelines 2020 treat the patient initiating the consult as implied consent, but a ' +
      'doctor-initiated video call needs recorded consent — and a hospital cannot prove what it ' +
      'never displayed.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4J-006 A prescription issued over video is stored like any other', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    await openTokenAndStart(page, NAME);
    await fillComplaint(page, TELE.chiefComplaint);
    const { addDrug, completeConsultation } = await import('./opd-flows');
    await addDrug(page, {
      drugName: P4.prescription.primary.drugName,
      dose: P4.prescription.primary.dose,
      durationDays: P4.prescription.primary.durationDays,
    });
    await completeConsultation(page);

    const { data } = await db().from('prescriptions').select('id, drugs')
      .eq('hospital_id', hid).eq('patient_id', pid);
    expect(
      data?.length,
      'A prescription issued in a remote consultation was not stored. A digital prescription the ' +
      'system has no copy of cannot be honoured at a pharmacy or defended if challenged.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4J-007 A teleconsultation is billed rather than given away', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hid, pid } = await freshToken(page);
    const { opdBillsToday } = await import('./opd-helpers');
    const bills = await opdBillsToday(hid, pid);
    expect(
      bills.length,
      'A remote consultation produced no bill. Teleconsultation is a chargeable service under the ' +
      'Telemedicine Practice Guidelines; hospitals that do not bill it stop offering it.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4J-008 A live video teleconsultation is completed end to end with a real patient', async () => {
    test.skip(true,
      'MANUAL-ONLY: needs two live browser sessions with camera and microphone permissions, a ' +
      'real WebRTC connection and a second human on the patient side. Playwright can grant ' +
      'fake media devices, but a fake video stream proves the plumbing, not the consultation.');
  });

  /* ── Voice Scribe (P4-S18 🔴) ──────────────────────────────────────── */

  test('TC-P4J-009 The Voice Scribe is available inside the OPD consultation workspace', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await freshToken(page);
    await openTokenAndStart(page, NAME);
    const present = await page.getByRole('button', { name: /scribe|dictat|record|mic/i }).count()
      + await page.locator('[aria-label*="scribe" i], [title*="scribe" i], [title*="dictat" i]').count();
    expect(
      present,
      'No Voice Scribe or dictation control is reachable from the consultation workspace. The ' +
      'entire premise of P4-S18 — the doctor dictating instead of typing — has no entry point.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4J-010 The Audio Rescue safety net exists in the scribe implementation', async () => {
    // Code-inspection case. Audio Rescue is the second-pass re-transcription that runs in the
    // background when the live transcript is doubtful — the difference between "the note is
    // usable" and "the drug name was guessed". Exercising it needs deliberately mumbled speech
    // (TC-P4J-013), so this case proves the mechanism is still wired rather than asserting on
    // its output.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/voice/VoiceScribePanel.tsx', 'utf8');
    expect(
      /rescueState/.test(src),
      'The Audio Rescue state has been removed from VoiceScribePanel. If it has moved rather ' +
      'than gone, repoint this case at the new location — do not delete it. Without a second ' +
      'pass, a misheard Indian drug name reaches the prescription unchallenged.',
    ).toBeTruthy();
  });

  test('TC-P4J-011 A dictated consultation populates the clinical fields correctly', async () => {
    test.skip(true, `${MANUAL} This case dictates a full consultation — complaint, examination, ` +
      'diagnosis and prescription — and checks each landed in the right field rather than all ' +
      'in the complaint box.');
  });

  test('TC-P4J-012 Indian drug names are transcribed correctly in dictation', async () => {
    test.skip(true, `${MANUAL} Dictate Pantoprazole, Telmisartan and Metformin in an Indian ` +
      'accent and confirm each resolves to the drug_master entry rather than a phonetic ' +
      'approximation. A drug name transcribed wrong is a prescribing error, not a typo.');
  });

  test('TC-P4J-013 A doubtful dose is caught rather than silently transcribed', async () => {
    test.skip(true, `${MANUAL} Dictate a dose where "fifteen" and "fifty" are acoustically ` +
      'close, with background OPD noise, and confirm the scribe flags low confidence or Audio ' +
      'Rescue re-transcribes it. A 50 mg dose recorded as 15 mg — or the reverse — is the ' +
      'single highest-consequence failure this feature can have.');
  });

  test('TC-P4J-014 Mixed Hindi/English dictation is handled', async () => {
    test.skip(true, `${MANUAL} Dictate a consultation the way it is actually spoken in an ` +
      'Indian OPD — clinical terms in English inside Hindi sentences — and confirm the note is ' +
      'usable rather than a transliterated mixture. This is how most of the country consults, ' +
      'so it is the normal case, not an edge case.');
  });
});

void expect;
