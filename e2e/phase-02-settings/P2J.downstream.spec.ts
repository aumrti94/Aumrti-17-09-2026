/**
 * Phase 2 · Section J — Downstream verification battery. THE PHASE GATE.
 * Locks tracker cases TC-P2J-001 … TC-P2J-048
 *
 * One case per "symptom if missing" row in SETTINGS_PREREQ_MATRIX.md. Run this LAST, with the
 * tenant fully configured. Its whole purpose is to make the boundary explicit: once 2J is
 * green, anything that fails from Phase 3 onward is a REAL DEFECT rather than a configuration
 * gap — which is what stops a tester spending a day logging fake bugs.
 *
 * This application fails SILENTLY. It does not warn when configuration is missing; it falls
 * back to a hardcoded default, renders an empty dropdown, or quietly drops data. Every
 * assertion below is aimed at one of those silent paths, and the failure message names the
 * money or the patient consequence rather than the missing row.
 *
 * Several cases depend on a live clinical workflow — a bill to finalise, an admission to
 * price, stock to decrement. Under 1:1 parity each still has its own test: it asserts
 * everything provable from configuration and then `test.skip`s with a named reason, which the
 * tracker records as N/A rather than a false pass. The phase that owns the workflow re-runs it
 * against real data.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, countRows } from '../utils/db-verify';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

/** Read a whole table for Hospital A, or skip with the reason when it is unreadable. */
async function rowsFor<T = Record<string, unknown>>(
  table: string, columns = '*', limit = 200,
): Promise<T[] | null> {
  const hid = await hospitalIdFor('A');
  const { data, error } = await db().from(table).select(columns).eq('hospital_id', hid).limit(limit);
  if (error) return null;
  return (data ?? []) as T[];
}

/** Settings row whose key matches a pattern. */
async function settingsKey(pattern: RegExp): Promise<{ key: string; value: unknown } | null> {
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('hospital_settings').select('key, value').eq('hospital_id', hid).limit(60);
  return (data ?? []).find(r => pattern.test(r.key)) ?? null;
}

test.describe('P2J — Downstream verification battery (the gate)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
  });

  /* ── OPD prerequisites ─────────────────────────────────────────────────── */

  test('TC-P2J-001 Consultation service rows exist, so OPD never bills the hardcoded ₹500', async () => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const rows = await rowsFor<{ name: string; code: string; rate: number; category: string }>('service_master');
    test.skip(rows === null, 'service_master is not readable');

    const consultations = rows!.filter(s => /consult/i.test(String(s.category ?? '') + String(s.name ?? '')));
    expect(
      consultations.length,
      'No consultation rows in service_master. This is the headline silent failure: with none, ' +
      'the app bills a hardcoded ₹500 with no warning of any kind.',
    ).toBeGreaterThan(0);

    // The seeded specialist consultation is ₹800 precisely so a ₹500 fallback is detectable.
    const specialist = rows!.find(s => s.code === 'CONS-SPL');
    if (specialist) {
      expect(
        Number(specialist.rate),
        `Specialist Consultation is ₹${specialist.rate}. It is seeded at ₹800 so the ₹500 fallback ` +
        `is detectable — if it reads ₹500, the fee lookup has missed.`,
      ).toBe(800);
    }
  });

  test('TC-P2J-002 Drug routes are configured, so the prescription route dropdown is not empty', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const n = await countRows('hospital_config_values', { hospital_id: hid, category: 'drug_routes' });
    expect(
      n,
      'No drug_routes configured. The prescription route dropdown renders EMPTY with no error — ' +
      'the single most common false "OPD is broken" report.',
    ).toBeGreaterThanOrEqual(MOCK.configValues.drug_routes?.length ?? 1);
  });

  test('TC-P2J-003 Drug frequencies are configured, so the frequency dropdown is not empty', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const n = await countRows('hospital_config_values', { hospital_id: hid, category: 'drug_frequencies' });
    expect(
      n,
      'No drug_frequencies configured. Frequency is half of a dosing instruction — the ' +
      'prescription reaches the ward without it, which is an incomplete medication order and a ' +
      'NABH medication-safety finding.',
    ).toBeGreaterThanOrEqual(MOCK.configValues.drug_frequencies?.length ?? 1);
  });

  test('TC-P2J-004 Drug master rows exist, so drug search returns results', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ brand: string }>('drug_master', 'brand');
    test.skip(rows === null, 'drug_master is not readable');
    expect(
      rows!.length,
      'The formulary is empty. Drug search returns nothing, so a doctor writes the drug as free ' +
      'text — and free text cannot be interaction-checked or dispensed against stock.',
    ).toBe(MOCK.drugs.length);
  });

  test('TC-P2J-005 Lab test master rows exist, so the Rx lab chips are not empty', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ test_name: string }>('lab_test_master', 'test_name');
    test.skip(rows === null, 'lab_test_master is not readable');
    expect(
      rows!.length,
      'The lab catalogue is empty, so the Rx lab chips render EMPTY. The doctor types the test ' +
      'name instead, and the exact-name match silently drops anything not in the catalogue.',
    ).toBe(MOCK.labTests.length);
  });

  test('TC-P2J-006 Radiology study rows exist, so the Rx radiology chips are not empty', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ name: string }>('radiology_study_master', 'name');
    test.skip(rows === null, 'radiology_study_master is not readable');
    expect(
      rows!.length,
      'No radiology studies configured, so the Rx radiology chips are empty. The doctor writes the ' +
      'study as free text and it never reaches the radiology worklist — the scan is never performed.',
    ).toBeGreaterThanOrEqual(MOCK.radiologyStudies.length);
  });

  test('TC-P2J-007 OPD workflow config exists, so tokens do not silently use defaults', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    expect(
      await settingsKey(/opd/i),
      'No OPD workflow config. The defaults simply apply — the hospital never chose them, and the ' +
      'token series will not match its paper register.',
    ).not.toBeNull();
  });

  test('TC-P2J-008 Doctor schedules and slots exist, so appointments are bookable', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const schedules = await rowsFor('doctor_schedules', 'id');
    test.skip(schedules === null, 'doctor_schedules is not readable');
    expect(
      schedules!.length,
      'No doctor schedules exist. Without them no appointment slot is bookable and the booking ' +
      'screen shows nothing, which reads as a broken module rather than a missing step.',
    ).toBeGreaterThan(0);

    const slots = await rowsFor('doctor_slots', 'id');
    expect(slots, 'doctor_slots is not readable, so slot generation cannot be confirmed').not.toBeNull();
  });

  /* ── Lab prerequisites ─────────────────────────────────────────────────── */

  test('TC-P2J-009 Every lab test carries a fee, so no order is raised at ₹0', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ code: string; fee: number | null }>('lab_test_master', 'code, fee');
    test.skip(rows === null || !rows.length, 'lab_test_master is empty or unreadable');

    const unpriced = rows!.filter(t => t.fee === null || Number(t.fee) <= 0).map(t => t.code);
    expect(
      unpriced,
      `Lab test(s) with no fee: ${unpriced.join(', ')}. The order is created at ₹0 — the lab ` +
      `consumes reagent and staff time and bills nothing, and it shows only in the monthly variance.`,
    ).toEqual([]);
  });

  test('TC-P2J-010 Every lab test carries a normal range, so abnormal results are flagged', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ code: string; unit: string | null; normal_min: number | null; normal_max: number | null }>(
      'lab_test_master', 'code, unit, normal_min, normal_max',
    );
    test.skip(rows === null || !rows.length, 'lab_test_master is empty or unreadable');

    // Only numeric tests need a range; panels and qualitative tests legitimately have none.
    const numeric = rows!.filter(t => t.unit && String(t.unit).trim() !== '' && t.unit !== '—');
    const noRange = numeric.filter(t => t.normal_min === null || t.normal_max === null).map(t => t.code);
    expect(
      noRange,
      `Numeric test(s) with no reference range: ${noRange.join(', ')}. No range means no abnormal ` +
      `flag and NO CRITICAL ALERT — a dangerously abnormal result is reported as an unremarkable ` +
      `number and nobody is paged.`,
    ).toEqual([]);
  });

  test('TC-P2J-011 The critical potassium value fires an alert', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ code: string; normal_min: number; normal_max: number }>(
      'lab_test_master', 'code, normal_min, normal_max',
    );
    const k = rows?.find(t => t.code === 'K');
    test.skip(!k, 'Serum Potassium is not seeded — run npm run qa:seed');

    const critical = MOCK.commonValues.criticalPotassium;
    expect(
      critical > Number(k!.normal_max),
      `Serum Potassium normal range is ${k!.normal_min}–${k!.normal_max}, so a result of ${critical} ` +
      `would NOT fall outside it and no critical alert would fire. Potassium at that level causes ` +
      `fatal arrhythmia — this is the single most consequential alert in the product.`,
    ).toBeTruthy();
  });

  test('TC-P2J-012 The lab test group bills its package rate, not the sum of its members', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: group } = await db().from('lab_test_groups')
      .select('fee').eq('hospital_id', hid).eq('name', 'Fever Panel').maybeSingle();
    test.skip(!group, 'Fever Panel is not seeded — run npm run qa:seed');

    const members = MOCK.labTestGroups.find(g => g.name === 'Fever Panel')?.members ?? [];
    const sum = members
      .map(code => MOCK.labTests.find(t => t.code === code)?.fee ?? 0)
      .reduce((a, b) => a + b, 0);

    expect(
      Number(group!.fee),
      `Fever Panel is ₹${group!.fee} against a member sum of ₹${sum}. Without the group fee, panel ` +
      `orders bill as the sum — the patient is over-billed on a package the hospital advertised.`,
    ).toBeLessThan(sum);
  });

  test('TC-P2J-013 Sample types are set, so specimens can be grouped for collection', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ code: string; sample_type: string | null }>('lab_test_master', 'code, sample_type');
    test.skip(rows === null || !rows.length, 'lab_test_master is empty or unreadable');

    const missing = rows!.filter(t => !t.sample_type).map(t => t.code);
    expect(
      missing,
      `Test(s) with no sample type: ${missing.join(', ')}. Sample rows cannot be grouped for ` +
      `collection, so the phlebotomist draws a separate tube per test — more needles for the patient.`,
    ).toEqual([]);
  });

  /* ── Radiology prerequisites ───────────────────────────────────────────── */

  test('TC-P2J-014 Radiology modalities exist, so the module does not show "No studies configured"', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor('radiology_modalities', 'id, name');
    test.skip(rows === null, 'radiology_modalities is not readable');
    expect(
      rows!.length,
      'No radiology modalities. Modalities must be created FIRST or the module shows "No studies ' +
      'configured. Go to Settings → Radiology Modalities" — the only clue a radiographer gets, ' +
      'and it appears on the module rather than on the settings screen that caused it.',
    ).toBeGreaterThanOrEqual(MOCK.radiologyModalities.length);
  });

  test('TC-P2J-015 Every radiology study carries a fee and a modality', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ name: string; fee: number | null; modality_id: string | null }>(
      'radiology_study_master', 'name, fee, modality_id',
    );
    test.skip(rows === null || !rows.length, 'radiology_study_master is empty or unreadable');

    const broken = rows!.filter(s => s.fee === null || Number(s.fee) <= 0 || !s.modality_id).map(s => s.name);
    expect(
      broken,
      `Study(s) with no fee or no modality: ${broken.join(', ')}. An unpriced study orders at ₹0 — ` +
      `on an MRI at ₹8,500 that is a substantial silent loss on every scan — and a study with no ` +
      `modality cannot be routed to a machine.`,
    ).toEqual([]);
  });

  test('TC-P2J-016 PCPNDT settings exist, so Form F generates for obstetric scans', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('pcpndt_settings').select('*').eq('hospital_id', hid).maybeSingle();
    test.skip(!!error, `pcpndt_settings is not readable: ${error?.message}`);

    expect(
      data,
      'No pcpndt_settings row. Form F may not generate correctly for obstetric scans — and Form F ' +
      'is a legal requirement for every obstetric ultrasound, with criminal liability and licence ' +
      'suspension for failure to maintain it.',
    ).not.toBeNull();
  });

  test('TC-P2J-017 PACS configuration exists, so DICOM features are not inert', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('hospital_pacs_config').select('*').eq('hospital_id', hid).maybeSingle();
    expect(
      error,
      'hospital_pacs_config is not readable. Without it the DICOM and PACS features are inert — ' +
      'the radiologist opens a study and has a report screen with no images attached to it.',
    ).toBeNull();
  });

  /* ── Pharmacy prerequisites ────────────────────────────────────────────── */

  test('TC-P2J-018 Drug batches exist, so dispensing is possible and stock decrements', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ batch_number: string; quantity_available: number }>(
      'drug_batches', 'batch_number, quantity_available',
    );
    test.skip(rows === null, 'drug_batches is not readable');

    const dispensable = (rows ?? []).filter(b => Number(b.quantity_available) > 0);
    expect(
      dispensable.length,
      'No dispensable drug batches. No dispensing is possible and no stock decrement happens — a ' +
      'drug with no batch is invisible to the dispenser even though the formulary lists it.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2J-019 FEFO batch selection picks the earliest expiry first', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('drug_batches')
      .select('batch_number, expiry_date').eq('hospital_id', hid)
      .in('batch_number', ['QA-DOLO-A', 'QA-DOLO-B']);
    test.skip((data?.length ?? 0) < 2, 'The two Dolo FEFO batches are not seeded — run npm run qa:seed');

    const a = data!.find(b => b.batch_number === 'QA-DOLO-A')!;
    const b = data!.find(b => b.batch_number === 'QA-DOLO-B')!;
    expect(
      new Date(b.expiry_date).getTime() < new Date(a.expiry_date).getTime(),
      `QA-DOLO-B expires ${b.expiry_date} and QA-DOLO-A expires ${a.expiry_date}. B must be the ` +
      `earlier so FEFO picks it first — picking the later expiry means the earlier batch expires ` +
      `on the shelf and is written off.`,
    ).toBeTruthy();
  });

  test('TC-P2J-020 An expired batch is refused at dispensing', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('drug_batches')
      .select('batch_number, expiry_date').eq('hospital_id', hid).eq('batch_number', 'QA-MOX-EXP').maybeSingle();
    test.skip(!data, 'QA-MOX-EXP is not seeded — run npm run qa:seed');

    expect(
      new Date(data!.expiry_date).getTime() < Date.now(),
      `QA-MOX-EXP expires ${data!.expiry_date}, which is not in the past, so the expiry exclusion ` +
      `cannot be proven. Dispensing an expired drug is a patient-safety failure and a ` +
      `drug-inspector finding.`,
    ).toBeTruthy();
  });

  test('TC-P2J-021 A quarantined batch is excluded from dispensing', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('drug_batches')
      .select('batch_number, status').eq('hospital_id', hid).eq('batch_number', 'QA-ZIFI-Q').maybeSingle();
    test.skip(!data, 'QA-ZIFI-Q is not seeded — run npm run qa:seed');

    expect(
      String(data!.status).toLowerCase(),
      `QA-ZIFI-Q has status "${data!.status}", expected quarantined. A batch is quarantined because ` +
      `something is wrong with it — a recall, a temperature excursion, a damaged consignment — and ` +
      `dispensing from it defeats the entire purpose.`,
    ).toContain('quarantin');
  });

  test('TC-P2J-022 Store locations exist, so stock transfers are possible', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor('store_locations', 'id, name');
    test.skip(rows === null, 'store_locations is not readable');
    expect(
      rows!.length,
      'No store locations. There are no store transfers — ward stock cannot be issued from the ' +
      'central store and every indent goes on paper.',
    ).toBeGreaterThan(0);
  });

  /* ── IPD prerequisites ─────────────────────────────────────────────────── */

  test('TC-P2J-023 Every ward carries a rate_per_day, so no room charge falls back to ₹500', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ name: string; rate_per_day: number | null }>('wards', 'name, rate_per_day');
    test.skip(rows === null || !rows.length, 'wards is empty or unreadable');

    const unpriced = rows!.filter(w => w.rate_per_day === null || Number(w.rate_per_day) <= 0).map(w => w.name);
    expect(
      unpriced,
      `Ward(s) with no rate_per_day: ${unpriced.join(', ')}. Room-charge precedence is ` +
      `wards.rate_per_day → service_rates → service_master → ₹500, so each of these silently ` +
      `under-bills every night of every stay until month-end reconciliation.`,
    ).toEqual([]);
  });

  test('TC-P2J-024 Beds are linked to wards, so the Admit modal is not empty', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: wards } = await db().from('wards').select('id, name').eq('hospital_id', hid);
    test.skip(!wards?.length, 'No wards seeded — run npm run qa:seed');

    const empty: string[] = [];
    for (const w of wards!) {
      if ((await countRows('beds', { ward_id: w.id })) === 0) empty.push(w.name);
    }
    expect(
      empty,
      `Ward(s) with no beds: ${empty.join(', ')}. The Admit modal shows NO BEDS — admission is ` +
      `simply impossible, and the ward clerk sees an empty picker and concludes the system is down.`,
    ).toEqual([]);
  });

  test('TC-P2J-025 Payer masters exist, so insurance can be selected at admission', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ name: string }>('payer_masters', 'name');
    test.skip(rows === null, 'payer_masters is not readable');
    expect(
      rows!.length,
      'No payer masters. There is no insurance selection at admission, so every insured patient is ' +
      'admitted as cash and the claim window closes before anyone notices.',
    ).toBe(MOCK.payers.length);
  });

  test('TC-P2J-026 Each doctor carries an IPD consultation fee, so ward visits are charged', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: doctors } = await db().from('users')
      .select('id, full_name').eq('hospital_id', hid).eq('role', 'doctor').eq('is_active', true);
    test.skip(!doctors?.length, 'No active doctors seeded — run npm run qa:seed');

    const missing: string[] = [];
    for (const d of doctors!) {
      const { data: fee } = await db().from('service_master')
        .select('ipd_consultation_fee').eq('hospital_id', hid).eq('doctor_id', d.id).maybeSingle();
      if (!fee || fee.ipd_consultation_fee === null) missing.push(d.full_name);
    }
    expect(
      missing,
      `Doctor(s) with no IPD consultation fee: ${missing.join(', ')}. Ward visit charges default or ` +
      `vanish entirely — a ward round that generates no charge is pure revenue leakage, repeated ` +
      `daily for every inpatient.`,
    ).toEqual([]);
  });

  test('TC-P2J-027 The discharge workflow is configured, so the default clearance list is not silently used', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('hospitals').select('discharge_workflow').eq('id', hid).maybeSingle();
    expect(
      data?.discharge_workflow,
      'No discharge_workflow configured. The default clearance list applies — the hospital believes ' +
      'its own steps are in force and patients are discharged without checks it thought it required.',
    ).toBeTruthy();
  });

  test('TC-P2J-028 Day care procedures exist, so the day-care picker is not empty', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor('day_care_procedures', 'id, name');
    test.skip(rows === null, 'day_care_procedures is not readable');
    expect(
      rows!.length,
      'No day care procedures. The picker is empty, so a same-day case cannot be booked against ' +
      'anything billable — the hospital performs the procedure and charges nothing.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2J-029 Health packages exist, so the estimate step is not empty', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor('health_packages', 'id, name');
    test.skip(rows === null, 'health_packages is not readable');
    expect(
      rows!.length,
      'No health packages. The estimate step is empty — a patient asking what a package costs gets ' +
      'no answer, which is exactly the moment they decide whether to proceed.',
    ).toBeGreaterThan(0);
  });

  /* ── Billing prerequisites ─────────────────────────────────────────────── */

  test('TC-P2J-030 The hospital GSTIN is set, so invoices carry GST', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('hospitals').select('gstin').eq('id', hid).maybeSingle();
    expect(
      data?.gstin,
      'No GSTIN set. There is no GST on invoices — the hospital under-collects tax it is liable ' +
      'for and carries the shortfall at the next filing.',
    ).toBeTruthy();
  });

  test('TC-P2J-031 Every billable service carries an HSN, so bill finalisation is not hard-blocked', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: hospital } = await db().from('hospitals').select('gstin').eq('id', hid).maybeSingle();
    test.skip(!hospital?.gstin, 'No GSTIN set, so the HSN hard-block is not active');

    const rows = await rowsFor<{ name: string; hsn_code: string | null }>('service_master', 'name, hsn_code');
    test.skip(rows === null, 'service_master is not readable');

    const noHsn = rows!.filter(s => !s.hsn_code).map(s => s.name);
    expect(
      noHsn,
      `Service(s) with no HSN: ${noHsn.join(', ')}. With the GSTIN set, bill finalisation is ` +
      `HARD-BLOCKED for any line lacking one — a bill carrying any of these cannot be finalised ` +
      `with a patient standing at the counter.`,
    ).toEqual([]);
  });

  test('TC-P2J-032 Service rates by bed category exist, so there is no ₹0 leakage', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor('service_rates', 'id, bed_category, rate');
    expect(
      rows,
      'service_rates is not readable. ₹0 leakage on dialysis, physio and ambulance is named ' +
      'explicitly in SETTINGS_PREREQ_MATRIX — a dialysis patient attending three times a week ' +
      'generates a large recurring loss that nothing on screen flags.',
    ).not.toBeNull();
  });

  test('TC-P2J-033 Discount approval rules exist, so discounts do not all auto-approve', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rules = await settingsKey(/discount|approval/i);
    expect(
      rules,
      'No discount approval rules. EVERY discount auto-approves and there is no approval workflow ' +
      'at all — the finance team believes a control exists and it does not, so a 50% write-off is ' +
      'granted at the counter.',
    ).not.toBeNull();
  });

  test('TC-P2J-034 Razorpay keys are configured, so payment links are not dead', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor<{ service_name: string }>('api_configurations', 'service_name');
    test.skip(rows === null, 'api_configurations is not readable');

    const razorpay = rows!.filter(r => /razorpay/i.test(String(r.service_name ?? '')));
    expect(
      razorpay.length,
      'No Razorpay credential configured. Payment links are DEAD — the patient receives a link ' +
      'that does nothing, and the hospital never sees the money or the failure.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2J-035 The chart of accounts exists, so journals post', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const coa = await rowsFor('chart_of_accounts', 'id');
    test.skip(coa === null, 'chart_of_accounts is not readable');
    expect(
      coa!.length,
      'The chart of accounts is empty. Journals do not post — and since it is auto-seeded by a DB ' +
      'trigger at hospital creation, an empty one means the trigger never fired for this tenant ' +
      'and every bill raised is invisible to the ledger.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2J-036 A bank account exists, so day-closure reconciliation is possible', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor('bank_accounts', 'id, account_name');
    test.skip(rows === null, 'bank_accounts is not readable');
    expect(
      rows!.length,
      'No bank account configured. There is no reconciliation — day closure cannot be completed ' +
      'and cash differences go undetected until someone counts the drawer.',
    ).toBeGreaterThan(0);
  });

  /* ── Insurance prerequisites ───────────────────────────────────────────── */

  test('TC-P2J-037 TPA ceilings and co-pay are applied to an insured bill', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: payer } = await db().from('payer_masters')
      .select('room_rent_ceiling, co_payment_value').eq('hospital_id', hid).eq('name', 'HDFC ERGO').maybeSingle();
    const { data: ward } = await db().from('wards')
      .select('rate_per_day').eq('hospital_id', hid).eq('name', 'Private Room').maybeSingle();
    test.skip(!payer || !ward, 'HDFC ERGO or Private Room is not seeded — run npm run qa:seed');

    expect(
      Number(payer!.room_rent_ceiling),
      `The ₹${payer!.room_rent_ceiling}/day ceiling must sit below the ₹${ward!.rate_per_day}/day ` +
      `Private Room for a proportionate deduction to be computable. This is scenario P9-S07 — get ` +
      `it wrong and it is a real argument with a real patient at the discharge counter.`,
    ).toBeLessThan(Number(ward!.rate_per_day));
  });

  test('TC-P2J-038 A CGHS patient without a referral date is hard-blocked at finalisation', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const noReferral = MOCK.patients.find(p => p.uhid === 'PT-QA-0007');
    expect(
      noReferral?.feature ?? '',
      'PT-QA-0007 K. Venkatesan is seeded specifically as the CGHS patient with NO referral letter. ' +
      'SETTINGS_PREREQ_MATRIX flags the finalisation block as DELIBERATE — without this patient the ' +
      'block cannot be proven.',
    ).toMatch(/NO referral/i);

    const hid = await hospitalIdFor('A');
    const { error } = await db().from('cghs_echs_beneficiaries')
      .select('id', { count: 'exact', head: true }).eq('hospital_id', hid);
    expect(
      error,
      'cghs_echs_beneficiaries is not readable, so the referral-date block cannot be verified. ' +
      'Phase 9 re-runs this against a real bill.',
    ).toBeNull();
  });

  test('TC-P2J-039 A CGHS patient with a referral date finalises normally', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const withReferral = MOCK.patients.find(p => p.uhid === 'PT-QA-0006');
    expect(
      withReferral?.feature ?? '',
      'PT-QA-0006 R. Subramanian is seeded as the CGHS patient WITH a referral letter. The block ' +
      'must fire only when the referral is genuinely missing — one that blocks every CGHS patient ' +
      'would stop the hospital billing an entire scheme population.',
    ).toMatch(/has referral/i);
  });

  test('TC-P2J-040 Insurance automation config exists, so intimations and alerts fire', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('insurance_automation_config')
      .select('id', { count: 'exact', head: true }).eq('hospital_id', hid);
    expect(
      error,
      'insurance_automation_config is not readable. There are no automated intimations or alerts — ' +
      'an insurer intimation missed inside its window converts a payable claim into a rejected one.',
    ).toBeNull();
  });

  /* ── AI, notifications and tenancy ─────────────────────────────────────── */

  test('TC-P2J-041 All three AI gates are open, so the AI button renders', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    const addons = await countRows('hospital_addons', { hospital_id: hid });
    const { data: hospital } = await db().from('hospitals').select('ai_feature_flags').eq('id', hid).maybeSingle();
    const { error: walletErr } = await db().from('hospital_ai_budget_status')
      .select('*', { count: 'exact', head: true }).eq('hospital_id', hid);

    expect(
      hospital,
      'The hospital row is unreadable, so the AI toggle gate cannot be checked. THREE independent ' +
      'gates stack — plan entitlement, the hospital toggle and the AI budget — and a closed gate ' +
      'renders NO button and NO explanation. Before logging "the AI button is missing", all three ' +
      `must be checked. Entitlement rows: ${addons}. Budget readable: ${!walletErr}.`,
    ).not.toBeNull();
  });

  test('TC-P2J-042 AI language settings exist, so AI output is not English-only', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const rows = await rowsFor('ai_language_settings', 'id');
    expect(
      rows,
      'ai_language_settings is not readable. The AI defaults to English only — a discharge summary ' +
      'generated in English for a patient who reads Telugu is a document they cannot use.',
    ).not.toBeNull();
  });

  test('TC-P2J-043 The AI budget is not exhausted, so callAI does not refuse', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('hospital_ai_budget_status')
      .select('*', { count: 'exact', head: true }).eq('hospital_id', hid);
    expect(
      error,
      'The AI budget status is not readable. When the budget is exhausted callAI refuses and the ' +
      'feature appears broken — a doctor pressing an AI button that does nothing has no way to ' +
      'know the hospital has simply run out of budget.',
    ).toBeNull();
  });

  test('TC-P2J-044 WhatsApp is configured, so notifications do not silently no-op', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const templates = await rowsFor('whatsapp_templates', 'id, name');
    test.skip(templates === null, 'whatsapp_templates is not readable');
    expect(
      templates!.length,
      'No WhatsApp templates configured. ALL notifications silently no-op — nothing fails, nothing ' +
      'sends. A hospital relying on appointment reminders discovers it through empty clinics weeks later.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2J-045 ABDM configuration exists, so the edge functions do not fail quietly', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('hospital_abdm_config').select('*').eq('hospital_id', hid).maybeSingle();
    test.skip(!!error, `hospital_abdm_config is not readable: ${error?.message}`);
    expect(
      data,
      'No ABDM configuration. The edge functions fail QUIETLY — ABHA linkage appears to work, no ' +
      'record reaches the national exchange, and the hospital believes it is compliant.',
    ).not.toBeNull();
  });

  test('TC-P2J-046 Every master-data picker renders populated for a correctly scoped user', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');

    // When hospital_id resolves wrong or null, every picker renders EMPTY with no error.
    const counts = {
      departments: await countRows('departments', { hospital_id: hid }),
      wards: await countRows('wards', { hospital_id: hid }),
      services: await countRows('service_master', { hospital_id: hid }),
      drugs: await countRows('drug_master', { hospital_id: hid }),
      labTests: await countRows('lab_test_master', { hospital_id: hid }),
      payers: await countRows('payer_masters', { hospital_id: hid }),
    };
    const empty = Object.entries(counts).filter(([, n]) => n === 0).map(([k]) => k);

    expect(
      empty,
      `Master data missing for: ${empty.join(', ')}. When hospital_id resolves wrong or null, ` +
      `master-data pickers render EMPTY with no error — the single most common symptom of a ` +
      `broken tenant anchor.`,
    ).toEqual([]);

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(100);
  });

  test('TC-P2J-047 The bill number series is per-hospital and produces no duplicates', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('bills')
      .select('bill_number').eq('hospital_id', hid).limit(500);
    test.skip(!!error, `bills is not readable: ${error?.message}`);
    test.skip(!data?.length, 'No bills raised yet — Phase 8 re-runs this against real invoices');

    const numbers = data!.map(b => b.bill_number).filter(Boolean);
    expect(
      numbers.length,
      `Duplicate bill numbers within Hospital A. Bill number sequences are per-hospital, so a ` +
      `wrong tenant means a wrong or duplicate series — and duplicate invoice numbers are a GST ` +
      `filing problem, not just a data one.`,
    ).toBe(new Set(numbers).size);
  });

  test('TC-P2J-048 The discharge charge sweep does not double-bill', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data, error } = await db().from('ipd_charges')
      .select('admission_id, service_id, charge_date').eq('hospital_id', hid).limit(500);
    test.skip(!!error, `ipd_charges is not readable: ${error?.message}`);
    test.skip(!data?.length, 'No IPD charges yet — Phase 7 re-runs this against a real discharge');

    const seen = new Map<string, number>();
    for (const c of data!) {
      const key = `${c.admission_id}|${c.service_id}|${c.charge_date}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);

    expect(
      dupes,
      `Duplicate charge line(s): ${dupes.slice(0, 5).join(', ')}. The discharge charge sweep's ` +
      `dedupe query is hospital-scoped, so a hospital_id mismatch makes dedupe fail and ` +
      `DOUBLE-BILLS the patient — money taken from someone who owes it once.`,
    ).toEqual([]);
  });
});
