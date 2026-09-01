/**
 * Phase 4 · Section A — OPD queue & token creation (P4-S01, P4-S24)
 * Locks tracker cases TC-P4A-001 … TC-P4A-026
 *
 * This is the first step of every hospital morning: a patient arrives, the front desk creates
 * a token, and the queue orders the day. Everything else in Phase 4 depends on a token
 * existing, so the negatives here matter as much as the positives — a token created without a
 * doctor or without consent is a record that cannot be billed or defended later.
 *
 * Token numbers come from the `generate_token_number` RPC (WalkInModal.tsx), with the
 * previewed value as a fallback. TC-P4A-010 is the case that would catch the fallback being
 * used for real: two patients registered moments apart must never share a token.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { hospitalIdFor, expectRow, countRows } from '../utils/db-verify';
import {
  openOpd, registerWalkInButton, queueSearch, walkInSearch, field, optionTexts,
  proceedToPaymentButton, mlcCheckbox, dpdpConsentCheckbox, previewedToken, toggle,
} from './opd-locators';
import {
  openWalkIn, fillWalkInDetails, proceedToPayment, payAndIssue, registerWalkIn, opdQueueVisible,
} from './opd-flows';
import { patientIdByUhid, purgeOpdArtefacts, tokensToday } from './opd-helpers';

const ROUTE = '/opd';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const BASELINE_UHID = 'PT-QA-0001';
const BASELINE_NAME = 'Ramesh Kumar';

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  const ids: string[] = [];
  for (const uhid of [BASELINE_UHID, 'PT-QA-0003']) {
    const { data } = await (await import('../utils/db-verify')).db()
      .from('patients').select('id').eq('hospital_id', hid).eq('uhid', uhid).maybeSingle();
    if (data) ids.push((data as { id: string }).id);
  }
  await purgeOpdArtefacts(hid, ids);
  // The new-patient cases create their own record; remove it and everything hanging off it.
  const { data: created } = await (await import('../utils/db-verify')).db()
    .from('patients').select('id').eq('hospital_id', hid).eq('full_name', P4.walkIn.newPatientName);
  const newIds = (created ?? []).map((r: { id: string }) => r.id);
  if (newIds.length) {
    await purgeOpdArtefacts(hid, newIds);
    const dbc = (await import('../utils/db-verify')).db();
    await dbc.from('patient_consents').delete().in('patient_id', newIds);
    await dbc.from('patients').delete().in('id', newIds);
  }
}

test.describe('P4A — OPD queue & token creation', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await openOpd(page);
  });

  test('TC-P4A-001 The OPD queue screen loads without console errors', async ({ page, consoleErrors }) => {
    expect(await opdQueueVisible(page), 'The OPD queue did not render at /opd.').toBeTruthy();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver|Download the React DevTools/i.test(e));
    expect(real, `Console errors on ${ROUTE}:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P4A-002 Register Walk-in is offered to a hospital_admin', async ({ page }) => {
    await expect(
      registerWalkInButton(page),
      'No Register Walk-in control on /opd — the front desk has no way to start a patient visit.',
    ).toBeVisible();
  });

  test('TC-P4A-003 The walk-in modal opens with an empty details form', async ({ page }) => {
    await openWalkIn(page);
    await expect(walkInSearch(page)).toBeVisible();
    const name = await field(page, 'Full Name');
    expect(await name.inputValue(), 'Full Name carried a value from a previous session.').toBe('');
  });

  test('TC-P4A-004 The Department dropdown is populated from the departments master', async ({ page }) => {
    await openWalkIn(page);
    const options = (await optionTexts(page, 'Department')).filter(o => !/^select/i.test(o));
    expect(
      options.length,
      'The Department dropdown is empty. SETTINGS_PREREQ_MATRIX.md: no departments means no ' +
      'OPD token can be created at all — this is a configuration gap, not a code defect.',
    ).toBeGreaterThan(0);
    expect(options.join(' | ')).toContain(P4.walkIn.department);
  });

  test('TC-P4A-005 Choosing a department filters the Doctor dropdown to that department', async ({ page }) => {
    await openWalkIn(page);
    const { selectOption } = await import('./opd-locators');
    await selectOption(page, 'Department', P4.walkIn.department);
    await page.waitForTimeout(900);
    const doctors = (await optionTexts(page, 'Doctor')).filter(o => !/^select/i.test(o));
    expect(
      doctors.join(' | '),
      `The Doctor list for "${P4.walkIn.department}" does not include ${P4.walkIn.doctor}. ` +
      `Front desk cannot book the patient with the doctor they are actually seeing.`,
    ).toContain(P4.walkIn.doctor.replace(/^Dr\.\s*/, ''));
  });

  test('TC-P4A-006 A doctor from another department is not offered once a department is chosen', async ({ page }) => {
    await openWalkIn(page);
    const { selectOption } = await import('./opd-locators');
    await selectOption(page, 'Department', P4.walkIn.department);
    await page.waitForTimeout(900);
    const doctors = (await optionTexts(page, 'Doctor')).join(' | ');
    expect(
      doctors,
      `The Obstetrics doctor is offered under ${P4.walkIn.department}. A token raised against ` +
      `the wrong specialty bills the wrong fee and lands in the wrong doctor's queue.`,
    ).not.toContain(P4.walkIn.obgyDoctor.replace(/^Dr\.\s*/, ''));
  });

  test('TC-P4A-007 The token to be issued is previewed before any payment is taken', async ({ page }) => {
    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: BASELINE_UHID,
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });
    const token = await previewedToken(page);
    expect(token, 'No token was previewed before payment — the desk cannot tell the patient their number.').toBeTruthy();
  });

  test('TC-P4A-008 A walk-in for an existing patient creates an opd_tokens row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID,
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    const token = await expectRow<{ token_number: string; status: string; visit_date: string }>(
      'opd_tokens', { hospital_id: hid, patient_id: pid },
      'No opd_tokens row after a walk-in that showed a receipt. The receipt is not the record.',
    );
    expect(token.status).toBe('waiting');
    expect(token.visit_date).toBe(new Date().toISOString().split('T')[0]);
  });

  test('TC-P4A-009 The issued token number is non-blank and carries the queue prefix', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID,
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    const token = await expectRow<{ token_number: string; token_prefix: string }>(
      'opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(
      token.token_number?.trim(),
      'The token was issued with a blank number — the display board and the queue have nothing to call.',
    ).toBeTruthy();
    expect(token.token_number).toContain(token.token_prefix ?? '');
  });

  test('TC-P4A-010 Two walk-ins registered moments apart receive different token numbers', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const first = await patientIdByUhid(hid, BASELINE_UHID);
    const second = await patientIdByUhid(hid, 'PT-QA-0003');
    await purgeOpdArtefacts(hid, [first, second]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID,
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });
    await registerWalkIn(page, {
      existingPatientQuery: 'PT-QA-0003',
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    const a = await tokensToday(hid, first);
    const b = await tokensToday(hid, second);
    expect(a.length, 'The first walk-in produced no token.').toBeGreaterThan(0);
    expect(b.length, 'The second walk-in produced no token.').toBeGreaterThan(0);
    expect(
      a[0].token_number,
      `Both patients were issued token "${a[0].token_number}". Two people answering to the same ` +
      `number is a queue collision — the opd_tokens BEFORE INSERT trigger ` +
      `(20261015000001_opd_token_sequence.sql) should have allocated distinct numbers from the ` +
      `per-hospital/doctor/day sequence.`,
    ).not.toBe(b[0].token_number);

    // Distinct is necessary but not sufficient: the numbers must also be a real sequence.
    // The old client-side allocator could hand out A-1 then A-1 (duplicate) or reset the
    // series mid-day when a kiosk/portal token landed in the same prefix bucket.
    const numOf = (t: string) => {
      const m = /^[A-Za-z]+-(\d+)$/.exec(t);
      expect(m, `Token "${t}" is not in the PREFIX-N form the sequence generator produces.`).not.toBeNull();
      return Number(m![1]);
    };
    const [n1, n2] = [numOf(a[0].token_number as string), numOf(b[0].token_number as string)];
    expect(
      Math.abs(n2 - n1),
      `Tokens "${a[0].token_number}" and "${b[0].token_number}" are not consecutive. Two ` +
      `back-to-back walk-ins for the same doctor must take adjacent numbers.`,
    ).toBe(1);
  });

  test('TC-P4A-011 A brand-new patient registered at the OPD desk is saved and given a token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await purge();

    await registerWalkIn(page, {
      newPatient: {
        fullName: P4.walkIn.newPatientName, age: P4.walkIn.newPatientAge,
        address: P4.walkIn.newPatientAddress, allergies: P4.walkIn.newPatientAllergies,
      },
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    const patient = await expectRow<{ id: string; uhid: string }>(
      'patients', { hospital_id: hid, full_name: P4.walkIn.newPatientName },
      'The walk-in reported success but no patients row was written.',
    );
    expect(patient.uhid, 'The new patient was saved without a UHID.').toBeTruthy();
    await expectRow('opd_tokens', { hospital_id: hid, patient_id: patient.id },
      'The patient was created but no token was issued — they are registered and invisible to the queue.');
  });

  test('TC-P4A-012 A new patient cannot be registered at OPD without DPDP consent', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await purge();

    await openWalkIn(page);
    const { fillField, selectOption } = await import('./opd-locators');
    await fillField(page, 'Full Name', P4.walkIn.newPatientName);
    await selectOption(page, 'Department', P4.walkIn.department);
    await page.waitForTimeout(600);
    await selectOption(page, 'Doctor', P4.walkIn.doctor);
    await page.waitForTimeout(600);
    // Deliberately leave the DPDP checkbox unticked.
    await expect(dpdpConsentCheckbox(page)).not.toBeChecked();
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(1500);

    await expect(
      page.getByText(/DPDP consent required/i),
      'The walk-in proceeded past the details step with DPDP consent unticked.',
    ).toBeVisible();
    expect(
      await countRows('patients', { hospital_id: hid, full_name: P4.walkIn.newPatientName }),
      'A patient row was created without recorded DPDP consent — an unfixable compliance breach.',
    ).toBe(0);
  });

  test('TC-P4A-013 A walk-in with no patient name is refused', async ({ page }) => {
    await openWalkIn(page);
    const { selectOption } = await import('./opd-locators');
    await selectOption(page, 'Department', P4.walkIn.department);
    await page.waitForTimeout(600);
    await selectOption(page, 'Doctor', P4.walkIn.doctor);
    await page.waitForTimeout(600);
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(1200);
    await expect(
      page.getByText(/patient name is required/i),
      'An unnamed patient was accepted — nothing downstream (bill, lab order, chart) can be raised against a blank name.',
    ).toBeVisible();
  });

  test('TC-P4A-014 A walk-in with no department is refused', async ({ page }) => {
    await openWalkIn(page);
    const { fillField } = await import('./opd-locators');
    await fillField(page, 'Full Name', P4.walkIn.newPatientName);
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(1200);
    await expect(
      page.getByText(/department is required/i),
      'A token was accepted with no department — it lands in no queue and prices against no rate card.',
    ).toBeVisible();
  });

  test('TC-P4A-015 A walk-in with no doctor is refused', async ({ page }) => {
    await openWalkIn(page);
    const { fillField, selectOption } = await import('./opd-locators');
    await fillField(page, 'Full Name', P4.walkIn.newPatientName);
    await selectOption(page, 'Department', P4.walkIn.department);
    await page.waitForTimeout(700);
    await proceedToPaymentButton(page).click();
    await page.waitForTimeout(1200);
    await expect(
      page.getByText(/doctor is required/i),
      'A token was accepted with no doctor — the consultation fee lookup has no doctor tier to read and falls to the ₹500 default.',
    ).toBeVisible();
  });

  test('TC-P4A-016 Priority "urgent" is stored on the token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID, priority: 'urgent',
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    const token = await expectRow<{ priority: string }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(
      token.priority,
      'Priority was not persisted. An urgent patient sorted as routine waits behind the whole morning queue.',
    ).toBe('urgent');
  });

  test('TC-P4A-017 Priority "emergency" is stored on the token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID, priority: 'emergency',
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    const token = await expectRow<{ priority: string }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(token.priority).toBe('emergency');
  });

  test('TC-P4A-018 Visit type "Emergency" is stored as visit_type on the token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID, visitType: 'Emergency',
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    const token = await expectRow<{ visit_type: string }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(
      token.visit_type,
      'visit_type did not record the emergency visit — the emergency consultation rate can never be justified on audit.',
    ).toBe('emergency');
  });

  test('TC-P4A-019 Visit purpose "Follow-Up" is stored as visit_purpose on the token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID, visitPurpose: 'Follow-Up',
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    const token = await expectRow<{ visit_purpose: string }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(token.visit_purpose).toBe('follow_up');
  });

  test('TC-P4A-020 Payer type defaults to cash and is stored on the token', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID,
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    const token = await expectRow<{ payer_type: string }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(
      token.payer_type,
      'payer_type was not stored. Continuity into a later admission depends on the payer captured at the very first visit.',
    ).toBe('cash');
  });

  test('TC-P4A-021 Ticking Medico-Legal Case sets is_mlc and shows the 24-hour police notice', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, P4.mlc.patientUhid);
    await purgeOpdArtefacts(hid, [pid]);

    await openWalkIn(page);
    await fillWalkInDetails(page, {
      existingPatientQuery: P4.mlc.patientUhid,
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
      isMlc: true, policeStation: P4.mlc.policeStation,
    });
    await expect(
      page.getByText(/Inform police within 24 hours/i),
      'No MLC notice was shown. Staff have no on-screen prompt of the statutory 24-hour reporting duty.',
    ).toBeVisible();
    await proceedToPayment(page);
    await payAndIssue(page);

    const token = await expectRow<{ is_mlc: boolean }>('opd_tokens', { hospital_id: hid, patient_id: pid });
    expect(token.is_mlc, 'is_mlc was not persisted — the MLC register has no source record.').toBe(true);
  });

  test('TC-P4A-022 A newly issued token appears in the queue straight away', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID,
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });
    await openOpd(page);
    await expect(
      page.getByText(BASELINE_NAME).first(),
      'The token was created but the queue did not show it. The doctor has no one to call.',
    ).toBeVisible();
  });

  test('TC-P4A-023 The queue search finds a waiting patient by UHID', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID,
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });
    await openOpd(page);
    await queueSearch(page).fill(BASELINE_UHID);
    await page.waitForTimeout(1200);
    await expect(page.getByText(BASELINE_NAME).first()).toBeVisible();
  });

  test('TC-P4A-024 A queue search that matches nothing shows an empty state rather than the full list', async ({ page }) => {
    await openOpd(page);
    await queueSearch(page).fill('ZZZ-NO-SUCH-PATIENT-9999');
    await page.waitForTimeout(1200);
    await expect(
      page.getByText(/no patients/i).first(),
      'A search with no matches did not narrow the queue — the desk cannot tell a missing patient from an unfiltered list.',
    ).toBeVisible();
  });

  test('TC-P4A-025 A receptionist can register a walk-in end to end', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const pid = await patientIdByUhid(hid, BASELINE_UHID);
    await purgeOpdArtefacts(hid, [pid]);

    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    await registerWalkIn(page, {
      existingPatientQuery: BASELINE_UHID,
      department: P4.walkIn.department, doctor: P4.walkIn.doctor,
    });

    await expectRow('opd_tokens', { hospital_id: hid, patient_id: pid },
      'The receptionist — the role that actually does this all day — could not issue a token. The OPD day cannot start.');
  });

  test('TC-P4A-026 A nurse is not offered the Register Walk-in action', async ({ page, loginAs, logout }) => {
    await logout();
    await loginAs('nurse', { hospital: 'A' });
    await openOpd(page);
    await page.waitForTimeout(1500);
    expect(
      await registerWalkInButton(page).count(),
      'A nurse can register walk-ins. Token creation carries a payment step, so this role gate is also a cash-handling control.',
    ).toBe(0);
  });
});

// Keep the imports honest — these are used by the flows above via re-export.
void mlcCheckbox; void toggle;
