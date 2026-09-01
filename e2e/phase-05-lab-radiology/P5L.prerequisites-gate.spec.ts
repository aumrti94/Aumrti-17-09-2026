/**
 * Phase 5 · Section L — Prerequisites & the Phase 6 gate
 * Locks tracker cases TC-P5L-001 … TC-P5L-008
 *
 * RUN THIS SECTION FIRST, THEN AGAIN LAST. It re-proves every "symptom if missing" that
 * SETTINGS_PREREQ_MATRIX.md lists for Lab and Radiology, so that anything failing elsewhere in
 * the phase is a real defect rather than a configuration gap. This is the same role Section 2J
 * plays for Phase 2, and it exists because this application fails SILENTLY: an unconfigured
 * catalogue does not raise an error, it produces an order at ₹0 with no critical range and no
 * abnormal flag, and every downstream case then fails for a reason that has nothing to do with
 * the code being tested.
 *
 * THE ENVIRONMENT TRAP THIS SECTION EXISTS TO CATCH.
 * Migration `20261009000171_lab_test_default_inactive.sql` runs `UPDATE lab_test_master SET
 * is_active = false` and flips the column default, while every lookup in the application filters
 * `is_active = true`. A tenant that was seeded and THEN migrated has no orderable tests at all —
 * which surfaces as roughly forty unrelated red cases across 5A–5D unless it is caught here in
 * one. TC-P5L-002.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { labTestGroupIdByName, labTestGroupMemberIds, ancillaryPolicy } from './lab-rad-helpers';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;

test.describe('P5L — Prerequisites & the Phase 6 gate', () => {
  test('TC-P5L-001 Every lab test in the catalogue carries a fee, a sample type and a turnaround', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await loginAs('hospital_admin', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const { data } = await db().from('lab_test_master')
      .select('test_name, fee, sample_type, tat_minutes').eq('hospital_id', hid);

    expect((data ?? []).length, 'The lab catalogue is empty. Run: npm run qa:seed').toBeGreaterThan(0);

    const broken = (data ?? []).filter(t => {
      const row = t as { fee?: number; sample_type?: string; tat_minutes?: number };
      return !Number(row.fee) || !row.sample_type || !Number(row.tat_minutes);
    });

    expect(
      broken.map(t => (t as { test_name: string }).test_name),
      'SETTINGS_PREREQ_MATRIX.md: a lab test with no fee produces an order at ₹0 — revenue that ' +
      'leaks with no error anywhere. No sample_type means samples cannot be grouped for ' +
      'collection, and no tat_minutes means the TAT dashboard cannot tell a late result from an ' +
      'on-time one.',
    ).toEqual([]);
  });

  test('TC-P5L-002 Every lab test is active, so the ordering search can actually find it', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const { count } = await db().from('lab_test_master')
      .select('*', { count: 'exact', head: true })
      .eq('hospital_id', hid).eq('is_active', false);

    expect(
      count ?? 0,
      'THE SINGLE MOST EXPENSIVE FALSE FAILURE IN THIS PHASE. Migration ' +
      '20261009000171_lab_test_default_inactive.sql runs `UPDATE lab_test_master SET is_active = ' +
      'false` and changes the column default, and BOTH syncLabOrders and the order-modal search ' +
      'filter on is_active = true. On a tenant seeded before that migration ran, nothing is ' +
      'orderable at all — every prescribed test lands in `unmatched`, no order is ever created, ' +
      'and roughly forty cases across 5A-5D go red for a reason that has nothing to do with any ' +
      'of them. Re-run npm run qa:seed before triaging anything else in this phase.',
    ).toBe(0);
  });

  test('TC-P5L-003 Critical ranges are configured, so critical-value alerting can function', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const expectCritical = MOCK.labTests
      .filter(t => t.criticalLow != null || t.criticalHigh != null)
      .map(t => t.name);
    expect(expectCritical.length, 'The mock catalogue defines no critical ranges to check.').toBeGreaterThan(0);

    const { data } = await db().from('lab_test_master')
      .select('test_name, critical_low, critical_high')
      .eq('hospital_id', hid).in('test_name', expectCritical);

    const missing = expectCritical.filter(name => {
      const row = (data ?? []).find(r => (r as { test_name: string }).test_name === name) as
        { critical_low: number | null; critical_high: number | null } | undefined;
      return !row || (row.critical_low == null && row.critical_high == null);
    });

    expect(
      missing,
      'FINDING L3. calcFlag derives CH/CL from critical_low/critical_high ALONE, and only a CH/CL ' +
      'flag writes a clinical_alerts row or blocks release. Tests configured with a normal range ' +
      'but no critical range therefore have NO critical-value alerting whatsoever, while every ' +
      'screen looks entirely normal — a potassium of 7.2 flags a harmless "H" and is released ' +
      'unchallenged. This is the prerequisite that makes P5-S07 testable at all.',
    ).toEqual([]);
  });

  test('TC-P5L-004 The Fever Panel has its members linked, so the group price can apply', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const groupId = await labTestGroupIdByName(hid, String(P5.labOrder.group));
    const members = await labTestGroupMemberIds(groupId);

    expect(
      members.length,
      'SETTINGS_PREREQ_MATRIX.md: a group with no lab_test_group_items rows is a price with no ' +
      'contents. fetchRates() detects a covered group by checking every member is in the ' +
      'selection, so with zero members the group is never applied and every panel silently bills ' +
      'as the sum of its parts — the hospital publishes a package rate and charges the itemised ' +
      'total.',
    ).toBe(MOCK.labTestGroups[0].members.length);
  });

  test('TC-P5L-005 Radiology modalities exist and every study is linked to one with a fee', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const { data: modalities } = await db().from('radiology_modalities')
      .select('id, name').eq('hospital_id', hid);
    expect(
      (modalities ?? []).length,
      'SETTINGS_PREREQ_MATRIX.md: with no modalities the studies screen renders "No studies ' +
      'configured. Go to Settings → Radiology Modalities" and nothing can be ordered. Modalities ' +
      'must be created BEFORE studies.',
    ).toBeGreaterThan(0);

    const { data: studies } = await db().from('radiology_study_master')
      .select('study_name, fee, modality_id, sort_order').eq('hospital_id', hid);
    expect((studies ?? []).length, 'No radiology studies are configured.').toBeGreaterThan(0);

    const broken = (studies ?? []).filter(s => {
      const row = s as { fee?: number; modality_id?: string | null };
      return !Number(row.fee) || !row.modality_id;
    });
    expect(
      broken.map(s => (s as { study_name: string }).study_name),
      'A study with no fee is ordered at ₹0; a study with no modality falls back to the first ' +
      'modality in the list (investigationSync.ts:242), which silently sends a CT request to the ' +
      'X-ray room.',
    ).toEqual([]);
  });

  test('TC-P5L-006 The PCPNDT machine and doctor registrations are on file', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const { data } = await db().from('pcpndt_settings')
      .select('machine_name, machine_registration_number, doctor_pcpndt_registration')
      .eq('hospital_id', hid).maybeSingle();

    expect(
      data,
      'SETTINGS_PREREQ_MATRIX.md lists pcpndt_settings as a Phase 5 prerequisite: "Form F may ' +
      'not generate correctly for obstetric scans". The machine registration number and the ' +
      'sonologist\'s PCPNDT registration are the first two things an inspector checks on a ' +
      'printed register, and a Form F without them is not a valid statutory record.',
    ).toBeTruthy();
  });

  test('TC-P5L-007 The IPD ancillary payment policy is set explicitly rather than left to a default', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const { data } = await db().from('hospital_settings').select('value')
      .eq('hospital_id', hid).eq('key', 'ipd_ancillary_payment').maybeSingle();

    expect(
      data,
      'SETTINGS_PREREQ_MATRIX.md: with no hospital_settings row the policy falls back to ' +
      'post_paid for every service. That default is safe but INVISIBLE — a hospital that believes ' +
      'it configured pre-paid, and never saved the screen, extends credit on every ward ' +
      'investigation without knowing it. Both values need a full test run, so the QA tenant ' +
      'states the policy rather than inheriting it.',
    ).toBeTruthy();

    const policy = await ancillaryPolicy(hid);
    for (const service of ['lab', 'radiology'] as const) {
      expect(
        ['pre_paid', 'post_paid'],
        `The ${service} ancillary mode is not one of the two permitted values.`,
      ).toContain(String((policy[service] as { mode?: string })?.mode));
    }
  });

  test('TC-P5L-008 Phase 6 gate: pharmacy has the drug catalogue and batches its own scenarios need', async ({ loginAs }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await loginAs('hospital_admin', { hospital: 'A' });
    const hid = await hospitalIdFor('A');

    const { count: drugs } = await db().from('drug_master')
      .select('*', { count: 'exact', head: true }).eq('hospital_id', hid);
    expect(
      drugs ?? 0,
      'GATE TO PHASE 6. SETTINGS_PREREQ_MATRIX.md: with no drug_master rows there is nothing to ' +
      'dispense and every Pharmacy scenario fails at its first step. Confirm it here, at the end ' +
      'of Phase 5, so Phase 6 starts on a configured tenant rather than discovering the gap ' +
      'fourteen scenarios in.',
    ).toBeGreaterThan(0);

    const { data: batches } = await db().from('drug_batches')
      .select('batch_number, quantity_available, expiry_date, status').eq('hospital_id', hid);
    expect(
      (batches ?? []).length,
      'No drug_batches exist. A drug with no batch is INVISIBLE to the dispenser — no dispensing ' +
      'is possible and no stock decrements, which is P6-S02 through P6-S06 in their entirety.',
    ).toBeGreaterThan(0);

    const expired = (batches ?? []).filter(b =>
      new Date(String((b as { expiry_date: string }).expiry_date)) < new Date());
    const quarantined = (batches ?? []).filter(b =>
      String((b as { status: string }).status) === 'quarantined');

    expect(
      expired.length,
      'Phase 6 needs a deliberately EXPIRED batch to prove dispensing refuses it (P6-S05). ' +
      'Without one the FEFO exclusions are untestable and would be signed off untested.',
    ).toBeGreaterThan(0);
    expect(
      quarantined.length,
      'Phase 6 needs a deliberately QUARANTINED batch to prove it is excluded from selection ' +
      '(P6-S06).',
    ).toBeGreaterThan(0);
  });
});
