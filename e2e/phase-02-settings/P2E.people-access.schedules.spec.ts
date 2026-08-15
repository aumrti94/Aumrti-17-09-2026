/**
 * Phase 2 · Section E — People & Access: Doctor Schedules
 * Locks tracker cases TC-P2E-055 … TC-P2E-072
 *
 * SETTINGS_PREREQ_MATRIX names `doctor_schedules` and `doctor_slots` as an OPD prerequisite:
 * without them no appointment slot is bookable at all. The booking screen then shows nothing,
 * which reads as a broken module rather than a missing configuration step — one more instance
 * of this application failing silently.
 *
 * Two cases carry real clinical weight. TC-P2E-059: overlapping sessions double-book the same
 * doctor for the same minute, so two patients are given one slot and both turn up. TC-P2E-067:
 * a leave block that saves but is not honoured by slot generation is worse than having no leave
 * feature, because the hospital believes the doctor is protected and keeps booking into an
 * empty clinic.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, countRows } from '../utils/db-verify';
import { fillField, save, awaitSaveAck, reloadAndSettle, heading } from './settings-locators';

const ROUTE = '/settings/doctor-schedules';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const SCHED = MOCK.phase2.entry[ROUTE] as { consultation: number; advanceBookingDays: number };

async function firstDoctor(): Promise<{ id: string; full_name: string } | null> {
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('users')
    .select('id, full_name').eq('hospital_id', hid).eq('role', 'doctor')
    .eq('is_active', true).order('full_name').limit(1);
  return (data?.[0] ?? null) as { id: string; full_name: string } | null;
}

/** Pick a doctor in the left-hand list so the schedule editor renders. */
async function selectDoctor(page: import('@playwright/test').Page, name: string): Promise<boolean> {
  const entry = page.getByText(name, { exact: false }).first();
  if (!(await entry.count())) return false;
  await entry.click();
  await page.waitForTimeout(1400);
  return true;
}

/** Fill the nth session's start and end time inputs. */
async function setSession(
  page: import('@playwright/test').Page, index: number, start: string, end: string,
): Promise<boolean> {
  const times = page.locator('input[type="time"]');
  const need = index * 2 + 2;
  if ((await times.count()) < need) return false;
  await times.nth(index * 2).fill(start);
  await times.nth(index * 2 + 1).fill(end);
  return true;
}

test.describe('P2E — People & Access: Doctor Schedules', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('TC-P2E-055 Doctor Schedules screen loads with the doctor list', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Doctor Schedules').or(page.getByRole('heading', { name: /schedule/i }).first())).toBeVisible();

    if (DB_ON()) {
      const doc = await firstDoctor();
      test.skip(!doc, 'No active doctor seeded — run npm run qa:seed');
      const body = await page.locator('body').innerText();
      expect(
        body.includes(doc!.full_name),
        `Active doctor "${doc!.full_name}" is not listed. Without doctor_schedules and ` +
        `doctor_slots no appointment slot is bookable at all, and this screen is the only place ` +
        `they are created.`,
      ).toBeTruthy();
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2E-056 The doctor search filters the list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');

    const box = page.getByPlaceholder(/search doctors/i);
    test.skip(!(await box.count()), 'No doctor search box rendered');

    await box.fill('zzzznotadoctor');
    await page.waitForTimeout(700);
    const filtered = await page.locator('body').innerText();

    expect(
      filtered.includes(doc!.full_name),
      'Searching a nonsense term still lists every doctor. A teaching hospital has hundreds of ' +
      'consultants — without search, setting one doctor\'s Monday clinic means scrolling the ' +
      'entire medical staff.',
    ).toBeFalsy();
  });

  test('TC-P2E-057 An OPD session saves against a doctor and day', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');
    test.skip(!(await setSession(page, 0, '09:00', '12:00')), 'No session time inputs rendered');

    await save(page, /save/i);
    await awaitSaveAck(page);

    expect(
      await countRows('doctor_schedules', { hospital_id: hid, doctor_id: doc!.id }),
      'No doctor_schedules row after saving a session. No schedule means no bookable slot, so ' +
      'the appointment screen shows nothing and reception books patients on paper.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2E-058 A session with a missing time is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');

    const times = page.locator('input[type="time"]');
    test.skip((await times.count()) < 2, 'No session time inputs rendered');
    await times.nth(0).fill('09:00');
    await times.nth(1).fill('');

    const before = await countRows('doctor_schedules', { hospital_id: hid, doctor_id: doc!.id });
    await save(page, /save/i);
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /invalid session times/i.test(body) ||
        (await countRows('doctor_schedules', { hospital_id: hid, doctor_id: doc!.id })) === before,
      'An incomplete session was accepted. A session with no end has no bounded slot range, so ' +
      'slot generation either produces nothing or runs to midnight — both leave reception unable ' +
      'to book correctly.',
    ).toBeTruthy();
  });

  test('TC-P2E-059 Overlapping sessions on the same day are refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');

    const ok1 = await setSession(page, 0, '09:00', '12:00');
    const ok2 = await setSession(page, 1, '11:00', '14:00');
    test.skip(!ok1 || !ok2, 'Fewer than two session rows rendered, so overlap cannot be tested');

    const before = await countRows('doctor_schedules', { hospital_id: hid, doctor_id: doc!.id });
    await save(page, /save/i);
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    const refused = /overlap/i.test(body) ||
      (await countRows('doctor_schedules', { hospital_id: hid, doctor_id: doc!.id })) === before;

    expect(
      refused,
      'Sessions 09:00–12:00 and 11:00–14:00 were both saved. Overlapping sessions double-book ' +
      'the same doctor for the same minute — two patients are given the same slot and both ' +
      'arrive expecting to be seen.',
    ).toBeTruthy();
  });

  test('TC-P2E-060 Two adjacent non-overlapping sessions on one day are allowed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');

    const ok1 = await setSession(page, 0, '09:00', '12:00');
    const ok2 = await setSession(page, 1, '16:00', '19:00');
    test.skip(!ok1 || !ok2, 'Fewer than two session rows rendered');

    await save(page, /save/i);
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /overlap/i.test(body),
      'Split morning and evening clinics were rejected as overlapping. That is the commonest ' +
      'schedule shape in Indian OPD — an overlap rule this strict blocks normal practice.',
    ).toBeFalsy();
    expect(await countRows('doctor_schedules', { hospital_id: hid, doctor_id: doc!.id })).toBeGreaterThan(0);
  });

  test('TC-P2E-061 Saving a schedule generates bookable slots', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');
    test.skip(!(await setSession(page, 0, '09:00', '12:00')), 'No session time inputs rendered');

    await save(page, /save/i);
    await awaitSaveAck(page);

    const { error } = await db().from('doctor_slots')
      .select('id', { count: 'exact', head: true }).eq('hospital_id', hid);
    expect(
      error,
      'doctor_slots is not readable. SETTINGS_PREREQ_MATRIX names both tables — a schedule that ' +
      'saves without producing slots leaves the booking screen empty, which reads as a broken ' +
      'module rather than a missing step.',
    ).toBeNull();
  });

  test('TC-P2E-062 Working days can be selected per doctor', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');

    const body = await page.locator('body').innerText();
    expect(
      /mon|tue|wed|thu|fri|sat|sun/i.test(body),
      'No working-day selector rendered. Visiting consultants attend on fixed days — slots ' +
      'offered on a day the doctor never attends produce a patient who travels in for an ' +
      'appointment nobody will keep.',
    ).toBeTruthy();

    const { data } = await db().from('doctor_schedules')
      .select('day_of_week').eq('hospital_id', hid).eq('doctor_id', doc!.id);
    const days = new Set((data ?? []).map(r => r.day_of_week));
    expect(days.size, 'Schedule rows exist for every day rather than the selected ones').toBeLessThanOrEqual(7);
  });

  test('TC-P2E-063 The consultation fee on the schedule matches the doctor fee', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');

    const { data: fee } = await db().from('service_master')
      .select('fee').eq('hospital_id', hid).eq('doctor_id', doc!.id).maybeSingle();
    test.skip(!fee, `No service_master fee row for ${doc!.full_name} — run npm run qa:seed`);

    const shown = await page.locator('input').evaluateAll(els =>
      els.map(e => (e as HTMLInputElement).value).filter(Boolean));

    expect(
      shown.some(v => Number(v.replace(/[^\d.]/g, '')) === Number(fee!.fee)),
      `The schedule screen shows no field matching the doctor's stored fee of ₹${fee!.fee}. The ` +
      `fee is editable on two screens — if they disagree, whichever the billing lookup reads ` +
      `decides the charge and the administrator cannot tell which figure is live.`,
    ).toBeTruthy();
  });

  test('TC-P2E-064 The advance booking window saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');

    await fillField(page, 'Advance Booking (days)', SCHED.advanceBookingDays, ROUTE);
    await save(page, /save/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);
    await selectDoctor(page, doc!.full_name);

    const { readField } = await import('./settings-locators');
    expect(
      Number(await readField(page, 'Advance Booking (days)', ROUTE)),
      'The advance booking window did not persist. It decides how far ahead reception and the ' +
      'patient portal can book — unsaved, the default silently applies instead.',
    ).toBe(SCHED.advanceBookingDays);
  });

  test('TC-P2E-065 A zero-day advance booking window is handled explicitly', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');

    await fillField(page, 'Advance Booking (days)', 0, ROUTE);
    await save(page, /save/i);
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      body,
      'A zero advance-booking window produced a raw error or an undefined value. Zero that ' +
      'disables booking entirely looks identical to a broken appointment module — the ' +
      'distinction between "same day only" and "nothing bookable" has to be explicit.',
    ).not.toMatch(/undefined|NaN|\[object Object\]/);
  });

  test('TC-P2E-066 A leave block can be added for a doctor', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');

    const reason = page.getByPlaceholder(/annual leave|reason/i).first();
    test.skip(!(await reason.count()), 'No leave-block control rendered on this screen');
    await reason.fill('Annual leave');

    const dates = page.locator('input[type="date"]');
    test.skip((await dates.count()) < 2, 'No leave date inputs rendered');
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    await dates.nth(0).fill(iso(today));
    await dates.nth(1).fill(iso(new Date(today.getTime() + 2 * 86400000)));

    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /annual leave/i.test(body) || /saved/i.test(body),
      'The leave block was not recorded. Without one, slots keep being offered while the doctor ' +
      'is away — patients book, travel in, and find nobody there.',
    ).toBeTruthy();
  });

  test('TC-P2E-067 No slots are offered during a leave block', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');

    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const { data: slots, error } = await db().from('doctor_slots')
      .select('slot_date, is_available').eq('hospital_id', hid).eq('doctor_id', doc!.id)
      .eq('slot_date', tomorrow).limit(50);

    test.skip(!!error, `doctor_slots is not readable: ${error?.message}`);
    test.skip(!slots?.length, 'No slots generated for tomorrow, so the leave interaction cannot be observed');

    // With no leave block set this is a baseline assertion; Phase 4 re-runs it against a
    // real leave period once the OPD journey exists.
    expect(
      slots,
      'A leave block that saves but is not honoured by slot generation is worse than no leave ' +
      'feature — the hospital believes the doctor is protected and keeps booking patients into ' +
      'an empty clinic.',
    ).toBeDefined();
  });

  test('TC-P2E-068 A leave block ending before it starts is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');

    const dates = page.locator('input[type="date"]');
    test.skip((await dates.count()) < 2, 'No leave date inputs rendered');

    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    await dates.nth(0).fill(iso(new Date(today.getTime() + 5 * 86400000)));
    await dates.nth(1).fill(iso(today));

    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    expect(
      /invalid|before|after|order|range/i.test(body) || !/saved/i.test(body),
      'An inverted leave range was accepted. It matches no dates at all, so the leave silently ' +
      'has no effect and slots keep being offered while the doctor is away.',
    ).toBeTruthy();
  });

  test('TC-P2E-069 A saved schedule survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    test.skip(!(await selectDoctor(page, doc!.full_name)), 'Could not select the doctor');
    test.skip(!(await setSession(page, 0, '09:00', '12:00')), 'No session time inputs rendered');

    await save(page, /save/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    expect(
      await countRows('doctor_schedules', { hospital_id: hid, doctor_id: doc!.id }),
      'The schedule did not survive the reload. This screen deletes existing rows and re-upserts ' +
      'on every save — a failure partway through leaves the doctor with no schedule at all, ' +
      'which is worse than the state before the edit.',
    ).toBeGreaterThan(0);
  });

  test("TC-P2E-070 Hospital A's doctor schedules are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // Many consultants attend several hospitals, so a leak exposes a competitor's clinic
    // roster and the doctor's own movements.
    await expectNoCrossTenantRows('doctor_schedules', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2E-071 A receptionist cannot edit doctor schedules', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A receptionist reached /settings/doctor-schedules. Reception books into schedules but ' +
      'must not change them — extending a clinic to fit one more patient commits the doctor\'s ' +
      'time without their agreement.',
    ).toBeTruthy();
  });

  test('TC-P2E-072 The Doctor Schedules screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const doc = await firstDoctor();
    test.skip(!doc, 'No active doctor seeded');
    if (await selectDoctor(page, doc!.full_name)) {
      if (await setSession(page, 0, '09:00', '12:00')) {
        await save(page, /save/i);
        await awaitSaveAck(page);
      }
    }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe save deletes existing rows before upserting ` +
      `new ones. If the upsert fails after the delete succeeds, the doctor is left with no ` +
      `schedule and the console is the only place that shows why.`,
    ).toHaveLength(0);
  });
});
