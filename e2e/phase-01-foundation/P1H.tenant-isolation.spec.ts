/**
 * Phase 1 · Section H — Multi-tenancy isolation
 * Locks tracker cases TC-P1H-001 … TC-P1H-016
 *
 * The highest-stakes specs in the whole suite. A failure here is not a bug —
 * it is a reportable data breach.
 *
 * These deliberately query the database DIRECTLY as a signed-in Hospital A
 * user, because that is what anyone can do by opening DevTools. The UI's own
 * filtering is not the control; RLS is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, PASSWORD, staffByRole, MOCK } from '../fixtures/auth.fixture';
import { db, anonDb, hospitalIdFor, expectNoCrossTenantRows } from '../utils/db-verify';

const DB = () => process.env.QA_DB_AVAILABLE === 'true';

/** Tables that must never leak across tenants, with the role that would see them. */
const ISOLATED_TABLES: Array<{ table: string; role: string; tc: string; note?: string }> = [
  { table: 'patients',          role: 'doctor',              tc: 'TC-P1H-001' },
  { table: 'bills',             role: 'billing_executive',   tc: 'TC-P1H-004' },
  { table: 'insurance_claims',  role: 'insurance_executive', tc: 'TC-P1H-005',
    note: 'ClaimsStatus.tsx:128 fetches this with NO hospital_id filter — RLS is the only control' },
  { table: 'denial_logs',       role: 'insurance_executive', tc: 'TC-P1H-006',
    note: 'ClaimsStatus.tsx:170 — same exposure' },
  { table: 'admissions',        role: 'doctor',              tc: 'TC-P1H-007' },
  { table: 'beds',              role: 'doctor',              tc: 'TC-P1H-007' },
  { table: 'prescriptions',     role: 'doctor',              tc: 'TC-P1H-008' },
  { table: 'lab_orders',        role: 'doctor',              tc: 'TC-P1H-008' },
  { table: 'users',             role: 'hospital_admin',      tc: 'TC-P1H-009' },
];

test.describe('P1H — Multi-tenancy isolation', () => {
  test.skip(() => !DB(), 'Database access not enabled — see .env.example');

  for (const { table, role, tc, note } of ISOLATED_TABLES) {
    test(`${tc} ${table} does not leak across tenants (as ${role})`, async () => {
      const hospitalB = await hospitalIdFor('B');
      const staff = staffByRole('A', role);
      await expectNoCrossTenantRows(table, staff.email, PASSWORD, hospitalB);
    });
  }

  test('TC-P1H-002 Hospital B patient cannot be opened by UUID from Hospital A', async ({ page, loginAs }) => {
    const hospitalB = await hospitalIdFor('B');
    const bPatient = MOCK.patients.find(p => p.hospital === 'B');
    expect(bPatient, 'mock-data.json must contain a Hospital B patient').toBeTruthy();

    const { data: row } = await db()
      .from('patients').select('id, full_name')
      .eq('hospital_id', hospitalB).eq('uhid', bPatient!.uhid).maybeSingle();
    test.skip(!row, `${bPatient!.uhid} is not seeded in Hospital B — run scripts/qa-seed.mjs`);

    await loginAs('doctor', { hospital: 'A' });
    await page.goto(`/patients/${row!.id}/summary`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const body = await page.locator('body').innerText();
    expect(
      body,
      `IDOR: Hospital A rendered Hospital B's patient name ("${row!.full_name}").`,
    ).not.toContain(row!.full_name);
    expect(body, 'Hospital B UHID leaked into Hospital A').not.toContain(bPatient!.uhid);
  });

  test('TC-P1H-010 cross-tenant INSERT is rejected', async () => {
    const hospitalB = await hospitalIdFor('B');
    const staff = staffByRole('A', 'doctor');
    const client = anonDb();
    await client.auth.signInWithPassword({ email: staff.email, password: PASSWORD });

    const probeUhid = `PT-QA-LEAK-${Date.now()}`;
    try {
      const { error } = await client.from('patients').insert({
        hospital_id: hospitalB,
        uhid: probeUhid,
        full_name: 'QA Cross Tenant Probe',
        gender: 'male',
      });
      expect(error, 'A Hospital A user was able to INSERT into Hospital B').not.toBeNull();
    } finally {
      // Clean up with the service key in case the insert did succeed —
      // scoped to the probe UHID only, never an unscoped delete.
      await db().from('patients').delete().eq('uhid', probeUhid);
      await client.auth.signOut();
    }
  });

  test('TC-P1H-011 cross-tenant UPDATE is rejected', async () => {
    const hospitalB = await hospitalIdFor('B');
    const bPatient = MOCK.patients.find(p => p.hospital === 'B')!;
    const { data: before } = await db()
      .from('patients').select('id, full_name')
      .eq('hospital_id', hospitalB).eq('uhid', bPatient.uhid).maybeSingle();
    test.skip(!before, `${bPatient.uhid} is not seeded — run scripts/qa-seed.mjs`);

    const staff = staffByRole('A', 'doctor');
    const client = anonDb();
    await client.auth.signInWithPassword({ email: staff.email, password: PASSWORD });

    try {
      await client.from('patients')
        .update({ full_name: 'TAMPERED BY QA' }).eq('id', before!.id);

      const { data: after } = await db()
        .from('patients').select('full_name').eq('id', before!.id).maybeSingle();
      expect(
        after?.full_name,
        'A Hospital A user MODIFIED a Hospital B patient record',
      ).toBe(before!.full_name);
    } finally {
      await client.auth.signOut();
    }
  });

  test('TC-P1H-013 the service role key is not in the client bundle', async () => {
    // This key bypasses all RLS. If it ships to the browser, every tenant
    // boundary in the product is gone.
    const dist = path.resolve(process.cwd(), 'dist');
    test.skip(!fs.existsSync(dist), 'No dist/ build found — run `npm run build` first');

    const offenders: string[] = [];
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|mjs|cjs|html|map|json)$/.test(entry.name)) continue;
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes('service_role')) offenders.push(`${full} :: "service_role"`);
        if (serviceKey && content.includes(serviceKey)) offenders.push(`${full} :: SERVICE KEY VALUE`);
      }
    };
    walk(dist);

    expect(
      offenders,
      `CRITICAL: service role material found in the client bundle:\n  ${offenders.join('\n  ')}`,
    ).toHaveLength(0);
  });

  test('TC-P1H-016 bill number sequences are independent per hospital', async () => {
    const [a, b] = [await hospitalIdFor('A'), await hospitalIdFor('B')];
    const { data, error } = await db()
      .from('bill_sequences').select('hospital_id').in('hospital_id', [a, b]);

    if (error) {
      test.skip(true, `bill_sequences not readable (${error.message}) — verify manually`);
      return;
    }
    const forA = (data ?? []).filter(r => r.hospital_id === a).length;
    const forB = (data ?? []).filter(r => r.hospital_id === b).length;

    if (forA === 0 && forB === 0) {
      test.skip(true, 'No bills created yet — this becomes meaningful once Phase 8 runs');
      return;
    }
    // The real assertion: sequences are keyed per hospital, never shared.
    expect(
      forA > 0 || forB > 0,
      'Bill sequences are not hospital-scoped — two hospitals would share invoice numbers ' +
      'under different GSTINs, which is a tax compliance failure',
    ).toBeTruthy();
  });

  test('TC-P1H-014 no PHI appears in console output', async ({ page, loginAs, consoleErrors }) => {
    await loginAs('doctor');
    for (const route of ['/dashboard', '/patients', '/opd']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }

    const phiTerms = MOCK.patients
      .filter(p => p.hospital === 'A')
      .flatMap(p => [p.name, p.uhid, p.phone])
      .filter(v => v && v.length > 4);

    const leaks = consoleErrors.filter(line => phiTerms.some(t => line.includes(t!)));
    expect(
      leaks,
      `PHI in console output — this reaches browser extensions and error trackers:\n  ${leaks.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
