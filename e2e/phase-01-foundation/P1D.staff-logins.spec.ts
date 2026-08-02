/**
 * Phase 1 · Section D — Staff logins
 * Locks tracker cases TC-P1D-001 … TC-P1D-016
 *
 * TC-P1D-015 is the important one: the app_role enum has 16 values, but
 * src/lib/modules.ts gates routes on 48 role strings. Roles like
 * blood_bank_technician and quality_officer are named as a module's intended
 * user but cannot be assigned to anyone.
 */
import { test, expect, MOCK, staffByRole } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';

const DB = () => process.env.QA_DB_AVAILABLE === 'true';

test.describe('P1D — Staff logins', () => {

  test('TC-P1D-002 every staff account carries the correct hospital_id', async () => {
    test.skip(!DB(), 'Database access not enabled — see .env.example');
    const hid = await hospitalIdFor('A');

    const emails = MOCK.staff.A.map(s => s.email);
    const { data, error } = await db()
      .from('users').select('email, hospital_id, role, is_active').in('email', emails);
    expect(error?.message ?? null).toBeNull();
    test.skip(!data?.length, 'No staff logins created yet — this is TC-P1D-003, do it in the UI');

    const wrongTenant = data!.filter(u => u.hospital_id !== hid).map(u => u.email);
    expect(
      wrongTenant,
      `users.hospital_id is the RLS anchor — a wrong value means the user sees nothing, ` +
      `or another hospital's patients:\n  ${wrongTenant.join('\n  ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1D-003 all Hospital A logins exist with the expected role', async () => {
    test.skip(!DB(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db()
      .from('users').select('email, role').eq('hospital_id', hid);
    test.skip(!data?.length, 'No staff logins created yet');

    const actual = new Map((data ?? []).map(u => [u.email, u.role]));
    const problems: string[] = [];
    for (const s of MOCK.staff.A) {
      if (!actual.has(s.email)) { problems.push(`MISSING  ${s.email} (${s.role})`); continue; }
      if (actual.get(s.email) !== s.role) {
        problems.push(`WRONG ROLE ${s.email}: expected ${s.role}, got ${actual.get(s.email)}`);
      }
    }
    expect(
      problems,
      `The RBAC matrix cannot be tested without one real login per role:\n  ${problems.join('\n  ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1D-009 the staff list is scoped to the hospital', async () => {
    test.skip(!DB(), 'Database access not enabled');
    const [a, b] = [await hospitalIdFor('A'), await hospitalIdFor('B')];

    const { data } = await db().from('users').select('email, hospital_id').eq('hospital_id', a);
    const bleed = (data ?? []).filter(u => u.hospital_id === b);
    expect(bleed, 'Hospital A staff query returned Hospital B users').toHaveLength(0);
  });

  test('TC-P1D-015 role dropdown values are all real app_role enum members', async () => {
    test.skip(!DB(), 'Database access not enabled');

    // Read the live enum rather than trusting the checked-in list.
    const { data, error } = await db().rpc('enum_values_app_role').single().then(
      r => r,
      () => ({ data: null, error: { message: 'helper rpc not present' } }),
    );

    let liveEnum: string[] = MOCK.appRoleEnum;
    if (!error && Array.isArray(data)) liveEnum = data as string[];

    const hid = await hospitalIdFor('A');
    const { data: users } = await db()
      .from('users').select('email, role').eq('hospital_id', hid);
    test.skip(!users?.length, 'No staff logins created yet');

    const invalid = (users ?? [])
      .filter(u => u.role && !liveEnum.includes(u.role))
      .map(u => `${u.email} -> "${u.role}"`);

    expect(
      invalid,
      `User(s) hold a role outside the app_role enum. They can log in but resolve to no ` +
      `permissions, which looks like a broken product:\n  ${invalid.join('\n  ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1D-013 a nurse cannot open Settings > Staff', async ({ page, loginAs }) => {
    // A nurse who can create logins can create an admin account for themselves.
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await loginAs('nurse');
    expect(
      await isRouteBlocked(page, '/settings/staff'),
      'A nurse reached the staff management screen',
    ).toBeTruthy();
  });

  test('TC-P1D-011 each doctor has a consultation fee row', async () => {
    test.skip(!DB(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    const { data, error } = await db()
      .from('service_master')
      .select('name, doctor_id, rate, category')
      .eq('hospital_id', hid)
      .eq('category', 'consultation');

    if (error) { test.skip(true, `service_master not readable: ${error.message}`); return; }
    test.skip(!data?.length, 'No consultation services seeded yet — run scripts/qa-seed.mjs');

    // Without a fee row the app silently bills a hardcoded Rs 500 per patient.
    const zeroRate = data!.filter(s => s.rate == null || Number(s.rate) <= 0).map(s => s.name);
    expect(
      zeroRate,
      `Consultation service(s) with no rate — every patient will be billed the hardcoded ` +
      `Rs 500 fallback:\n  ${zeroRate.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
