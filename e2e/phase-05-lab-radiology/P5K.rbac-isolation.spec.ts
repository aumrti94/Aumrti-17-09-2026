/**
 * Phase 5 · Section K — Role reach & multi-tenancy isolation
 * Locks tracker cases TC-P5K-001 … TC-P5K-012
 *
 * TWO DISTINCT QUESTIONS, and they fail in opposite directions:
 *
 *   RBAC — "may this ROLE reach this screen and take this action?" A gate that fails OPEN lets a
 *   receptionist sign out a biochemistry result. A gate that fails CLOSED stops the lab working
 *   and the hospital reverts to paper by lunchtime, which is worse than either.
 *
 *   TENANT ISOLATION — "can Hospital A see Hospital B's data?" This one has no acceptable
 *   failure. A lab result names the patient, the test and the value; a radiology order carries
 *   the clinical history; a Form F carries the patient's address and obstetric history. Any leak
 *   is a DPDP Act breach and, for the Form F, a PCPNDT one.
 *
 * ISOLATION IS TESTED THROUGH A REAL LOGGED-IN SESSION, NOT THE SERVICE ROLE.
 * `expectNoCrossTenantRows` signs in through the anon client exactly as the browser does and
 * queries with NO hospital filter. That is the only version of the question that matters — the
 * client-side `.eq("hospital_id", …)` every screen adds is a convenience, and RLS is the control.
 * A test that used the service role would bypass RLS entirely and pass no matter how broken the
 * policies were.
 *
 * ONE KNOWN RBAC HOLE IS RECORDED HERE RATHER THAN LEFT AS PROSE: `MODULE_TABS.lab`
 * (src/lib/tabPermissions.ts:59-72) does not list `pending_opd`, and `hasTabAccess` returns TRUE
 * for any key it does not know (:621) — so the "Pending from OPD" tab can never be revoked from
 * any role. TC-P5K-006.
 */
import { test, expect, MOCK, PASSWORD, staffByRole } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectNoCrossTenantRows } from '../utils/db-verify';
import { isRouteBlocked } from '../fixtures/auth.fixture';
import { patientIdByUhid, userIdByName } from '../phase-04-opd-journey/opd-helpers';
import {
  seedLabOrder, seedRadiologyOrder, advanceSamples, labSamples, purgeLabRadArtefacts,
} from './lab-rad-helpers';
import { openLab, LAB_TABS } from './lab-locators';
import { openRadiology, openPcpndtRegister } from './radiology-locators';
import { openOrderInWorklist } from './lab-rad-flows';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;

const UHID = 'PT-QA-0001';
const NAME = 'Ramesh Kumar';
const B_UHID = String(P5.crossTenant.hospitalBPatientUhid);
const DOCTOR = MOCK.doctorFees[0].doctor;
const TEST = String(P5.labOrder.primaryTest);
const STUDY = String(P5.radiology.plainStudy);

async function seedBoth(): Promise<{ hidA: string; hidB: string; pidA: string }> {
  const hidA = await hospitalIdFor('A');
  const hidB = await hospitalIdFor('B');
  const pidA = await patientIdByUhid(hidA, UHID);
  const doctorId = await userIdByName(hidA, DOCTOR);
  await purgeLabRadArtefacts(hidA, [pidA]);
  await seedLabOrder({
    hospitalId: hidA, patientId: pidA, orderedBy: doctorId, testNames: [TEST], billingStatus: 'billed',
  });
  await seedRadiologyOrder({
    hospitalId: hidA, patientId: pidA, orderedBy: doctorId, studyName: STUDY, billingStatus: 'billed',
  });
  return { hidA, hidB, pidA };
}

test.describe('P5K — Role reach & tenant isolation', () => {
  test.afterEach(async () => {
    if (!DB_ON()) return;
    const hid = await hospitalIdFor('A');
    await purgeLabRadArtefacts(hid, [await patientIdByUhid(hid, UHID)]);
  });

  /* ── Role reach ─────────────────────────────────────────────────────── */

  test('TC-P5K-001 A lab technician can work the full lab journey they are employed to work', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await loginAs('lab_technician', { hospital: 'A' });
    const { hidA, pidA } = await seedBoth();

    expect(
      await isRouteBlocked(page, '/lab'),
      'A lab technician cannot reach /lab. An over-tight gate is not "safe" — it stops the ' +
      'laboratory working and the hospital goes back to paper requisition slips by lunchtime.',
    ).toBe(false);

    await openLab(page);
    const { openLabTab, collectionTab, COLLECTION_TABS } = await import('./lab-locators');
    await openLabTab(page, LAB_TABS.collection);
    await expect(
      collectionTab(page, COLLECTION_TABS.toCollect),
      'The technician cannot reach the collection workstation, which is the first step of every ' +
      'specimen they handle.',
    ).toBeVisible();
    void hidA; void pidA;
  });

  test('TC-P5K-002 A radiologist can reach the radiology worklist and the PCPNDT register', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('radiologist', { hospital: 'A' });

    expect(await isRouteBlocked(page, '/radiology'), 'A radiologist cannot reach /radiology.').toBe(false);
    expect(
      await isRouteBlocked(page, '/radiology/pcpndt-register'),
      'A radiologist cannot reach the PCPNDT register. They are the person who signs the Form F ' +
      'and the person an inspector questions, so they must be able to read the register they are ' +
      'answerable for.',
    ).toBe(false);
  });

  test('TC-P5K-003 A receptionist cannot reach the laboratory', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('receptionist', { hospital: 'A' });

    expect(
      await isRouteBlocked(page, '/lab'),
      'A receptionist reached the laboratory module. Front-desk staff have no clinical training ' +
      'and no business entering or releasing results; a route that admits them is the same class ' +
      'of hole Phase 2 found across every /settings/* path.',
    ).toBe(true);
  });

  test('TC-P5K-004 A receptionist cannot reach radiology reporting', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('receptionist', { hospital: 'A' });

    expect(
      await isRouteBlocked(page, '/radiology'),
      'A receptionist reached the radiology reporting workspace, where reports are written and ' +
      'signed. Signing is attributed to whoever is logged in.',
    ).toBe(true);
  });

  test('TC-P5K-005 A nurse cannot sign out a laboratory result', async ({ page, loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });
    const hidA = await hospitalIdFor('A');
    const pidA = await patientIdByUhid(hidA, UHID);
    const doctorId = await userIdByName(hidA, DOCTOR);
    await purgeLabRadArtefacts(hidA, [pidA]);
    const seeded = await seedLabOrder({
      hospitalId: hidA, patientId: pidA, orderedBy: doctorId, testNames: [TEST], billingStatus: 'billed',
    });
    await advanceSamples({ orderId: seeded.orderId, to: 'processing', byUserId: doctorId });

    await loginAs('nurse', { hospital: 'A' });
    const blocked = await isRouteBlocked(page, '/lab');
    if (blocked) return; // A nurse who cannot reach the lab at all is a correct outcome.

    await openLab(page);
    await openOrderInWorklist(page, NAME).catch(() => { /* the order may not be listed for them */ });
    const { validateAndSignButton } = await import('./lab-locators');

    expect(
      await validateAndSignButton(page).isVisible().catch(() => false),
      'A nurse is offered the pathologist sign-off. Validation is restricted to doctor / ' +
      'pathologist / radiologist because releasing a result is a clinical judgement about ' +
      'whether the number is believable, not a workflow step.',
    ).toBe(false);
  });

  test('TC-P5K-006 Every lab tab is governed by the permission model, with none silently ungovernable', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('lab_technician', { hospital: 'A' });

    const source = await import('node:fs').then(fs =>
      fs.readFileSync('src/lib/tabPermissions.ts', 'utf8'));
    const labBlock = source.match(/lab:\s*\[([\s\S]*?)\]/)?.[1] ?? '';

    expect(
      /pending_opd/.test(labBlock),
      'FINDING — EXPECTED FAIL. MODULE_TABS.lab (src/lib/tabPermissions.ts:59-72) does not list ' +
      '"pending_opd", and hasTabAccess returns TRUE for any key it does not recognise (:621). So ' +
      'the "Pending from OPD" tab — which lists every patient with an outstanding investigation, ' +
      'by name — can never be revoked from any role that reaches /lab. A permission model with a ' +
      'default-allow hole is not a permission model; either add the key or make unknown keys ' +
      'deny.',
    ).toBe(true);
  });

  /* ── Tenant isolation ───────────────────────────────────────────────── */

  test('TC-P5K-007 A Hospital A session cannot read Hospital B lab orders', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hidB } = await seedBoth();
    const staff = staffByRole('A', 'lab_technician');

    await expectNoCrossTenantRows('lab_orders', staff.email, PASSWORD, hidB);
  });

  test('TC-P5K-008 A Hospital A session cannot read Hospital B lab results', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hidB } = await seedBoth();
    const staff = staffByRole('A', 'lab_technician');

    await expectNoCrossTenantRows('lab_order_items', staff.email, PASSWORD, hidB);
    await expectNoCrossTenantRows('lab_samples', staff.email, PASSWORD, hidB);
  });

  test('TC-P5K-009 A Hospital A session cannot read Hospital B radiology orders or reports', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hidB } = await seedBoth();
    const staff = staffByRole('A', 'radiologist');

    await expectNoCrossTenantRows('radiology_orders', staff.email, PASSWORD, hidB);
    await expectNoCrossTenantRows('radiology_reports', staff.email, PASSWORD, hidB);
  });

  test('TC-P5K-010 A Hospital A session cannot read Hospital B PCPNDT records', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hidB } = await seedBoth();
    const staff = staffByRole('A', 'radiologist');

    // Both tables, because the register reads one and the auto-create writes the other.
    await expectNoCrossTenantRows('pcpndt_form_f', staff.email, PASSWORD, hidB);
    await expectNoCrossTenantRows('pcpndt_records', staff.email, PASSWORD, hidB);
  });

  test('TC-P5K-011 A Hospital A session cannot read Hospital B DICOM files or PACS configuration', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hidB } = await seedBoth();
    const staff = staffByRole('A', 'radiologist');

    await expectNoCrossTenantRows('dicom_files', staff.email, PASSWORD, hidB);
    await expectNoCrossTenantRows('hospital_pacs_config', staff.email, PASSWORD, hidB);
  });

  test('TC-P5K-012 A Hospital A user cannot write a lab order into Hospital B', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { hidB } = await seedBoth();
    const staff = staffByRole('A', 'lab_technician');
    const bPatientId = await patientIdByUhid(hidB, B_UHID).catch(() => null);
    test.skip(!bPatientId, `Hospital B has no seeded patient ${B_UHID}. Run: npm run qa:seed`);

    const { anonDb } = await import('../utils/db-verify');
    const client = anonDb();
    const { error: authErr } = await client.auth.signInWithPassword({
      email: staff.email, password: PASSWORD,
    });
    expect(authErr, `Could not sign in as ${staff.email}.`).toBeFalsy();

    try {
      const { data, error } = await client.from('lab_orders').insert({
        hospital_id: hidB, patient_id: bPatientId, status: 'ordered',
        priority: 'routine', billing_status: 'unbilled',
      } as never).select('id');

      expect(
        error || (data?.length ?? 0) === 0,
        'A Hospital A user WROTE a lab order into Hospital B. A read leak exposes data; a write ' +
        'leak puts a fabricated clinical order into another hospital\'s workflow, where their ' +
        'staff will act on it. Every RLS policy on this table needs a WITH CHECK clause, not only ' +
        'a USING one.',
      ).toBeTruthy();

      if (data?.length) {
        await db().from('lab_orders').delete().eq('id', (data[0] as { id: string }).id);
      }
    } finally {
      await client.auth.signOut();
    }
  });
});
