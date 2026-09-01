/**
 * Phase 4 · Section C — Appointments & slots (P4-S04, P4-S24)
 * Locks tracker cases TC-P4C-001 … TC-P4C-018
 *
 * A pre-booked patient is not a walk-in with a nicer arrival time. The slot must be consumed,
 * the same slot must not be sold twice, and when the patient arrives the token must reflect
 * the appointment rather than dropping them at the back of the walk-in queue.
 *
 * TWO PROTECTIONS EXIST, AND THEY ARE NOT EQUAL:
 *   - `appointments_unique_slot UNIQUE (hospital_id, doctor_id, appointment_date, slot_time)`
 *     is a real database constraint and cannot be raced.
 *   - `doctor_slots.booked_count` is incremented by a READ-then-WRITE in WalkInModal.tsx:735,
 *     inside a try/catch that only `console.warn`s on failure. Two receptionists booking at the
 *     same second both read 0 and both write 1. TC-P4C-013 documents that; the unique constraint
 *     is what actually saves the hospital, and booked_count is only a display counter.
 *
 * These specs create their own slots (`seedDoctorSlot`) because `qa:seed` does not seed
 * `doctor_slots` — they come from Settings → Doctor Schedules, which belongs to Phase 2.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { hospitalIdFor, expectRow } from '../utils/db-verify';
import {
  patientIdByUhid, userIdByName, departmentIdByName, purgeOpdArtefacts,
  seedDoctorSlot, purgeDoctorSlots, slotById, appointmentsFor, tokensToday,
} from './opd-helpers';
import { fillWalkInDetails, proceedToPayment, payAndIssue } from './opd-flows';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';
const P4 = MOCK.phase4;
const APPT_UHID = 'PT-QA-0003';
const APPT_NAME = 'Anitha Menon';
const OTHER_UHID = 'PT-QA-0001';
const DOCTOR = MOCK.doctorFees[0].doctor;
const DEPARTMENT = MOCK.doctorFees[0].department;
const SCHEDULE_ROUTE = '/schedule';

const SLOT_A = '16:00:00';
const SLOT_B = '16:15:00';
const SLOT_BLOCKED = '16:30:00';

async function context() {
  const hid = await hospitalIdFor('A');
  const doctorId = await userIdByName(hid, DOCTOR);
  const departmentId = await departmentIdByName(hid, DEPARTMENT);
  const apptPid = await patientIdByUhid(hid, APPT_UHID);
  const otherPid = await patientIdByUhid(hid, OTHER_UHID);
  return { hid, doctorId, departmentId, apptPid, otherPid };
}

async function reset(): Promise<Awaited<ReturnType<typeof context>>> {
  const ctx = await context();
  await purgeOpdArtefacts(ctx.hid, [ctx.apptPid, ctx.otherPid]);
  await purgeDoctorSlots(ctx.hid, ctx.doctorId);
  return ctx;
}

async function openSchedule(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(SCHEDULE_ROUTE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

/** Click the slot cell rendered for a `HH:MM` time. */
/**
 * SchedulingPage.tsx's fmtTime() renders every slot as 12-hour "h:mm AM/PM" (e.g.
 * "16:00:00" -> "4:00 PM") — no leading zero on the hour, a space before AM/PM. clickSlot()
 * used to search for the raw 24h "HH:MM" string, which never appears in the DOM. Mirror
 * fmtTime() exactly rather than guessing at a format.
 */
function to12h(hhmmss: string): string {
  const [hStr, mStr] = hhmmss.split(':');
  const h = Number(hStr);
  const m = Number(mStr) || 0;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${m.toString().padStart(2, '0')} ${ampm}`;
}

async function clickSlot(page: import('@playwright/test').Page, hhmm: string): Promise<void> {
  const cell = page.getByText(to12h(hhmm), { exact: false }).first();
  await cell.waitFor({ state: 'visible', timeout: 12_000 });
  await cell.click();
  await page.waitForTimeout(1400);
}

test.describe('P4C — Appointments & slots', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    void page;
  });

  test.afterAll(async () => {
    if (!DB_ON()) return;
    await reset();
  });

  test('TC-P4C-001 The scheduling screen loads the slot board for the selected day', async ({ page, consoleErrors }) => {
    await openSchedule(page);
    await expect(
      page.getByText(/slots?|appointments?|schedule/i).first(),
      'The scheduling board did not render at /schedule.',
    ).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver|DevTools/i.test(e));
    expect(real, `Console errors on ${SCHEDULE_ROUTE}:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P4C-002 With no slots generated the board says so and names the screen that fixes it', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await reset();
    await openSchedule(page);
    await expect(
      page.getByText(/no slots for this date/i).first(),
      'An unconfigured day rendered no empty state. Front desk cannot tell "no slots exist" ' +
      'from "the page failed to load", and logs a false bug either way.',
    ).toBeVisible();
    await expect(
      page.getByText(/doctor schedules/i).first(),
      'The empty state does not name Settings → Doctor Schedules, so the reader has no next step.',
    ).toBeVisible();
  });

  test('TC-P4C-003 Booking an open slot creates an appointments row for that slot time', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, {
      existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR,
    });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    const appt = await expectRow<{ slot_time: string; status: string }>(
      'appointments', { hospital_id: ctx.hid, patient_id: ctx.apptPid },
      'The booking reported success but no appointments row exists. The patient has been promised ' +
      'a time the hospital has no record of.',
    );
    expect(appt.slot_time.slice(0, 5)).toBe(SLOT_A.slice(0, 5));
  });

  test('TC-P4C-004 A booked appointment is linked to the slot it consumed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    const slot = await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    const appts = await appointmentsFor(ctx.hid, ctx.apptPid);
    expect(appts.length, 'No appointment was created.').toBeGreaterThan(0);
    expect(
      appts[0].slot_id,
      'The appointment carries no slot_id. Nothing ties the booking back to the slot, so the ' +
      'board can show a free slot that is already sold.',
    ).toBe(slot.id);
  });

  test('TC-P4C-005 Booking a slot increments its booked_count', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    const slot = await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    const row = await slotById(slot.id);
    expect(
      Number(row?.booked_count ?? 0),
      'booked_count stayed at 0 after a successful booking, so the board keeps offering a slot ' +
      'that is already taken.',
    ).toBe(1);
  });

  test('TC-P4C-006 The same slot cannot be sold to a second patient', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    // Second patient, same slot time, same doctor, same day.
    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5)).catch(() => { /* a full slot may no longer be clickable — also a pass */ });
    const modalOpen = await page.getByRole('button', { name: /book appointment/i }).count();
    if (modalOpen) {
      await fillWalkInDetails(page, { existingPatientQuery: OTHER_UHID, department: DEPARTMENT, doctor: DOCTOR });
      await page.getByRole('button', { name: /book appointment/i }).click();
      await page.waitForTimeout(3000);
    }

    const second = await appointmentsFor(ctx.hid, ctx.otherPid);
    expect(
      second.filter(a => String(a.slot_time).slice(0, 5) === SLOT_A.slice(0, 5)).length,
      'Two patients hold the same 15-minute slot with the same doctor. Both were told to arrive ' +
      'at the same time and one of them will be turned away at the desk.',
    ).toBe(0);
  });

  test('TC-P4C-007 The double-booking refusal is shown as a message, not a raw database error', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5)).catch(() => { /* slot correctly no longer bookable */ });
    if (await page.getByRole('button', { name: /book appointment/i }).count()) {
      await fillWalkInDetails(page, { existingPatientQuery: OTHER_UHID, department: DEPARTMENT, doctor: DOCTOR });
      await page.getByRole('button', { name: /book appointment/i }).click();
      await page.waitForTimeout(2500);
      const raw = await page.getByText(/duplicate key value|violates unique constraint|23505/i).count();
      expect(
        raw,
        'A Postgres constraint name was shown to the receptionist. It leaks the schema and tells ' +
        'the user nothing about what to do next.',
      ).toBe(0);
    }
  });

  test('TC-P4C-008 The same patient cannot hold two appointments with one doctor on one day', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_B });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    await openSchedule(page);
    await clickSlot(page, SLOT_B.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(2500);

    await expect(
      page.getByText(/already booked/i),
      'The same patient was allowed two slots with one doctor on one day. One of them will be a ' +
      'no-show that blocks a genuinely waiting patient.',
    ).toBeVisible();
  });

  test('TC-P4C-009 Checking an appointment in issues a token linked to that appointment', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    await openSchedule(page);
    await page.getByRole('button', { name: /check.?in/i }).first().click();
    await page.waitForTimeout(1800);
    await proceedToPayment(page);
    await payAndIssue(page);

    const tokens = await tokensToday(ctx.hid, ctx.apptPid);
    expect(tokens.length, 'Check-in issued no token — the patient is in the building and not in the queue.').toBeGreaterThan(0);
    expect(
      tokens[0].appointment_id,
      'The token has no appointment_id. A pre-booked patient is indistinguishable from a walk-in, ' +
      'so the slot they paid to reserve buys them nothing at the desk.',
    ).toBeTruthy();
  });

  test('TC-P4C-010 A checked-in appointment leaves the actionable queue', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    await openSchedule(page);
    await page.getByRole('button', { name: /check.?in/i }).first().click();
    await page.waitForTimeout(1800);
    await proceedToPayment(page);
    await payAndIssue(page);

    const appts = await appointmentsFor(ctx.hid, ctx.apptPid);
    expect(
      appts[0].status,
      `The appointment is still "${appts[0].status}" after check-in. It stays on the arrivals ` +
      `list and the desk keeps calling a patient who is already with the doctor.`,
    ).not.toBe('scheduled');
  });

  test('TC-P4C-011 A blocked slot is not offered for booking', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({
      hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId,
      slotTime: SLOT_BLOCKED, isBlocked: true, blockReason: 'Theatre list',
    });

    await openSchedule(page);
    await clickSlot(page, SLOT_BLOCKED.slice(0, 5)).catch(() => { /* correctly not clickable */ });
    expect(
      await page.getByRole('button', { name: /book appointment/i }).count(),
      'A slot blocked for theatre was still bookable. The doctor is double-committed and the ' +
      'patient waits through an operating list.',
    ).toBe(0);
  });

  test('TC-P4C-012 A slot already at its patient limit is not offered again', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    const slot = await seedDoctorSlot({
      hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId,
      slotTime: SLOT_A, maxPatients: 1,
    });
    const { db } = await import('../utils/db-verify');
    await db().from('doctor_slots').update({ booked_count: 1 } as never).eq('id', slot.id);

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5)).catch(() => { /* correctly not clickable */ });
    expect(
      await page.getByRole('button', { name: /book appointment/i }).count(),
      'A full slot was offered for booking. booked_count >= max_patients is the only thing ' +
      'stopping over-subscription on multi-patient slots.',
    ).toBe(0);
  });

  test('TC-P4C-013 booked_count is incremented by a read-then-write with no atomic guard', async () => {
    // Code-inspection case. WalkInModal.tsx:735 reads booked_count, adds one, and writes it
    // back, inside a try/catch that only console.warns. Two receptionists booking a
    // multi-patient slot in the same second both read the same value and both write the same
    // increment, so the counter under-reports. Proving that by racing two browsers is not
    // something this suite can do deterministically, so the case documents the shape of the
    // risk and points at the constraint that actually protects the hospital.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/opd/WalkInModal.tsx', 'utf8');
    const nonAtomic = /select\("booked_count"\)[\s\S]{0,400}booked_count:\s*\(slotRow\?\.booked_count \|\| 0\) \+ 1/.test(src);
    expect(
      nonAtomic,
      'The non-atomic booked_count increment has been replaced — if it is now an RPC or a ' +
      'database trigger, this case should be rewritten to assert the new mechanism rather than ' +
      'deleted, and PHASE_MAP.md\'s finding list updated.',
    ).toBeTruthy();
  });

  test('TC-P4C-014 A single-patient slot is protected by the database, not only by the UI', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });
    const { db } = await import('../utils/db-verify');
    const today = new Date().toISOString().split('T')[0];

    const row = {
      hospital_id: ctx.hid, doctor_id: ctx.doctorId,
      appointment_date: today, slot_time: SLOT_A, slot_end_time: SLOT_B,
      status: 'scheduled', visit_type: 'new',
    };
    const first = await db().from('appointments').insert({ ...row, patient_id: ctx.apptPid } as never);
    expect(first.error, `The first direct insert failed: ${first.error?.message}`).toBeNull();

    const second = await db().from('appointments').insert({ ...row, patient_id: ctx.otherPid } as never);
    expect(
      second.error,
      'A second appointment for the same doctor, date and slot_time was accepted straight into ' +
      'the database. appointments_unique_slot is the only thing standing between two ' +
      'receptionists and a double-booked slot — a UI check alone cannot be raced safely.',
    ).not.toBeNull();
  });

  test('TC-P4C-015 An appointment records the fee agreed at booking time', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    const appts = await appointmentsFor(ctx.hid, ctx.apptPid);
    expect(appts.length).toBeGreaterThan(0);
    expect(
      Number(appts[0].consultation_fee ?? 0),
      'The appointment stored a ₹0 fee. A patient quoted a price on the phone and charged a ' +
      'different one at the desk is a complaint the hospital always loses.',
    ).toBeGreaterThan(0);
  });

  test('TC-P4C-016 A cancelled appointment is excluded from the day\'s board', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    const { db } = await import('../utils/db-verify');
    const appts = await appointmentsFor(ctx.hid, ctx.apptPid);
    await db().from('appointments').update({ status: 'cancelled' } as never).eq('id', appts[0].id as string);

    await openSchedule(page);
    expect(
      await page.getByText(APPT_NAME).count(),
      'A cancelled appointment is still shown on the board. The doctor believes the slot is taken ' +
      'and it is sold to nobody.',
    ).toBe(0);
  });

  test('TC-P4C-017 Cancelling an appointment does not release the slot back to booked_count', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    const slot = await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    const { db } = await import('../utils/db-verify');
    const appts = await appointmentsFor(ctx.hid, ctx.apptPid);
    await db().from('appointments').update({ status: 'cancelled' } as never).eq('id', appts[0].id as string);
    await page.waitForTimeout(1200);

    const row = await slotById(slot.id);
    expect(
      Number(row?.booked_count ?? 0),
      'CURRENT BEHAVIOUR (documented gap): booked_count is expected to stay at 1 after a ' +
      'cancellation, because nothing decrements it. If this now reads 0 the release has been ' +
      'implemented — update the case rather than deleting it. A slot that never frees up is ' +
      'capacity the hospital paid for and cannot sell.',
    ).toBe(1);
  });

  test('TC-P4C-018 A receptionist can book an appointment into an open slot', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const ctx = await reset();
    await seedDoctorSlot({ hospitalId: ctx.hid, doctorId: ctx.doctorId, departmentId: ctx.departmentId, slotTime: SLOT_A });

    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    await openSchedule(page);
    await clickSlot(page, SLOT_A.slice(0, 5));
    await fillWalkInDetails(page, { existingPatientQuery: APPT_UHID, department: DEPARTMENT, doctor: DOCTOR });
    await page.getByRole('button', { name: /book appointment/i }).click();
    await page.waitForTimeout(3000);

    await expectRow('appointments', { hospital_id: ctx.hid, patient_id: ctx.apptPid },
      'The receptionist — the role that takes every appointment call — could not book one.');
  });
});

void P4;
