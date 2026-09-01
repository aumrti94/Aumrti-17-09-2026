/**
 * Phase 5 — the prerequisite engine, and the reads every Lab/Radiology spec asserts against.
 *
 * WHY THIS FILE IS MOSTLY *SETUP* RATHER THAN ASSERTIONS
 * ------------------------------------------------------
 * Phase 5's workflows start in the middle of a chain. "A haemolysed sample is rejected and
 * recollected" needs an order that has already been raised, billed and collected before the
 * case's first click. Driving those preceding steps through the UI in every one of ~145 cases
 * would make each test a twenty-minute journey whose failure tells you nothing about the thing
 * it names, and would make a single flaky click in the order modal fail forty unrelated cases.
 *
 * So the PRECONDITION is seeded through the service role and the THING UNDER TEST goes through
 * the browser — the same split `opd-helpers.ts` documents for `seedPriorVisit()`. Where a case's
 * whole point IS the creation path (5A), it uses the UI and does not call these.
 *
 * TWO PLACES THIS FILE DELIBERATELY WORKS AROUND A DEFECT, AND SAYS SO
 * -------------------------------------------------------------------
 *   1. `seedRadiologyReportShell()` exists because `syncRadiologyOrders` never creates the
 *      `radiology_reports` row that `NewRadiologyOrderModal.tsx:453` does, so an OPD-raised
 *      order can never be reported at all (finding R1). The reporting workflows would otherwise
 *      all fail for that one upstream reason and prove nothing about reporting. The R1 case
 *      itself does NOT call this helper — it asserts the raw behaviour and is expected to fail
 *      until R1 is fixed. Delete this helper when it is.
 *   2. `seedPriorResult()` back-dates a previous validated result so the delta check has
 *      something to compare against. A test cannot wait a week between two creatinines.
 *
 * PURGE ORDERING IS NOT NEGOTIABLE — see `purgeLabRadArtefacts` at the bottom. Nothing in this
 * chain declares ON DELETE CASCADE, so children must go first, and a failed delete must be
 * SURFACED. A purge that swallows its error leaves rows behind that poison every later run,
 * which is exactly the class of bug Phase 3 documents.
 */
import { db, hospitalIdFor } from '../utils/db-verify';
import { MOCK } from '../fixtures/mock-data';

/* ── Lookups ──────────────────────────────────────────────────────────── */

export async function labTestIdByName(hospitalId: string, testName: string): Promise<string> {
  const { data, error } = await db()
    .from('lab_test_master').select('id, is_active')
    .eq('hospital_id', hospitalId).eq('test_name', testName).maybeSingle();
  if (error) throw new Error(`Looking up lab test "${testName}": ${error.message}`);
  if (!data) {
    throw new Error(
      `No lab test "${testName}" in this tenant. Run: npm run qa:seed — Phase 5 reuses the ` +
      `seeded lab_test_master catalogue rather than creating its own.`,
    );
  }
  // The single most common false failure in this phase. Migration 20261009000171 runs
  // `UPDATE lab_test_master SET is_active = false`, and every lookup in the app filters on
  // is_active = true, so a tenant migrated after seeding has no orderable tests at all — which
  // would read as dozens of unrelated product defects rather than one configuration state.
  if ((data as { is_active?: boolean }).is_active === false) {
    throw new Error(
      `Lab test "${testName}" exists but is_active = false, so the app cannot see it at all. ` +
      `Migration 20261009000171 deactivates every test; re-run npm run qa:seed. This is a ` +
      `PREREQUISITE state, not a product defect.`,
    );
  }
  return (data as { id: string }).id;
}

export async function labTestGroupIdByName(hospitalId: string, groupName: string): Promise<string> {
  const { data, error } = await db()
    .from('lab_test_groups').select('id')
    .eq('hospital_id', hospitalId).eq('group_name', groupName).maybeSingle();
  if (error) throw new Error(`Looking up lab test group "${groupName}": ${error.message}`);
  if (!data) throw new Error(`No lab test group "${groupName}". Run: npm run qa:seed`);
  return (data as { id: string }).id;
}

/** Members of a group. An EMPTY result is itself the finding — see the seeder's comment. */
export async function labTestGroupMemberIds(groupId: string): Promise<string[]> {
  const { data, error } = await db()
    .from('lab_test_group_items').select('test_id').eq('group_id', groupId);
  if (error) throw new Error(`Reading lab_test_group_items: ${error.message}`);
  return (data ?? []).map(r => (r as { test_id: string }).test_id);
}

export async function radiologyStudyByName(
  hospitalId: string, studyName: string,
): Promise<{ id: string; modality_id: string | null; modality_type: string | null; fee: number; requires_form_f: boolean }> {
  const { data, error } = await db()
    .from('radiology_study_master')
    .select('id, modality_id, modality_type, fee, requires_form_f')
    .eq('hospital_id', hospitalId).eq('study_name', studyName).maybeSingle();
  if (error) throw new Error(`Looking up radiology study "${studyName}": ${error.message}`);
  if (!data) throw new Error(`No radiology study "${studyName}". Run: npm run qa:seed`);
  return data as never;
}

/* ── Lab fixtures ─────────────────────────────────────────────────────── */

export interface SeededLabOrder {
  orderId: string;
  accessionNumber: string | null;
  itemIds: string[];
  sampleIds: string[];
}

/**
 * Create a lab order the way the application does — through `create_lab_order_with_items`.
 *
 * Using the RPC rather than three hand-rolled inserts matters: it is what assigns the accession
 * number from `next_lab_accession()` inside the transaction, so a seeded order carries the same
 * `ACC-YYYYMMDD-NNNN` identity a real one does. A fixture that invented its own accession would
 * quietly make the uniqueness and barcode cases test nothing.
 *
 * Called with the SERVICE ROLE, so the RPC's SECURITY INVOKER RLS check (`ordered_by` must be
 * the caller's `users.id`) does not apply — which is why `orderedBy` must be passed explicitly
 * and must be a real `users.id`, or the order will be orphaned from every "who ordered this"
 * assertion.
 */
export async function seedLabOrder(opts: {
  hospitalId: string;
  patientId: string;
  orderedBy: string;
  testNames: string[];
  encounterId?: string | null;
  admissionId?: string | null;
  priority?: 'routine' | 'urgent' | 'stat';
  clinicalNotes?: string;
  billingStatus?: 'unbilled' | 'billed' | 'waived';
}): Promise<SeededLabOrder> {
  const tests = await Promise.all(
    opts.testNames.map(async name => {
      const master = MOCK.labTests.find(t => t.name === name);
      return {
        test_id: await labTestIdByName(opts.hospitalId, name),
        result_unit: master?.unit || '',
        reference_range:
          master?.normalMin != null && master?.normalMax != null
            ? `${master.normalMin} - ${master.normalMax}`
            : '',
        sample_type: master?.sampleType || 'blood',
      };
    }),
  );

  const sampleTypes = [...new Set(tests.map(t => t.sample_type))];

  const { data: orderId, error } = await db().rpc('create_lab_order_with_items', {
    p_hospital_id: opts.hospitalId,
    p_patient_id: opts.patientId,
    p_ordered_by: opts.orderedBy,
    p_encounter_id: opts.encounterId ?? null,
    p_admission_id: opts.admissionId ?? null,
    p_priority: opts.priority ?? 'routine',
    p_clinical_notes: opts.clinicalNotes ?? MOCK.phase5.labOrder.clinicalNotes,
    p_billing_status: opts.billingStatus ?? 'billed',
    p_items: tests.map(t => ({
      test_id: t.test_id, result_unit: t.result_unit, reference_range: t.reference_range,
    })),
    p_samples: sampleTypes.map(st => ({ sample_type: st, barcode: '' })),
  } as never);

  if (error) throw new Error(`Seeding a lab order (${opts.testNames.join(', ')}): ${error.message}`);

  const id = orderId as unknown as string;
  const [{ data: order }, { data: items }, { data: samples }] = await Promise.all([
    db().from('lab_orders').select('accession_number').eq('id', id).maybeSingle(),
    db().from('lab_order_items').select('id').eq('lab_order_id', id),
    db().from('lab_samples').select('id').eq('lab_order_id', id),
  ]);

  return {
    orderId: id,
    accessionNumber: (order as { accession_number: string | null } | null)?.accession_number ?? null,
    itemIds: (items ?? []).map(r => (r as { id: string }).id),
    sampleIds: (samples ?? []).map(r => (r as { id: string }).id),
  };
}

/**
 * Advance a seeded order's samples to `collected` / `received` / `processing` without going
 * through the collection screen, for cases that begin after collection.
 *
 * Mirrors what `src/lib/labSamples.ts` writes at each step, including the order- and item-level
 * status changes — a fixture that moved only `lab_samples.status` would leave the order at
 * `ordered` and the result workspace would refuse to accept a value.
 */
export async function advanceSamples(opts: {
  orderId: string;
  to: 'collected' | 'received' | 'processing';
  byUserId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const samplePatch: Record<string, unknown> = { status: opts.to };
  if (opts.to === 'collected') { samplePatch.collected_at = now; samplePatch.collected_by = opts.byUserId; }
  if (opts.to === 'received') { samplePatch.received_at = now; samplePatch.received_by = opts.byUserId; }

  const { error: sErr } = await db().from('lab_samples')
    .update(samplePatch as never).eq('lab_order_id', opts.orderId);
  if (sErr) throw new Error(`Advancing samples to ${opts.to}: ${sErr.message}`);

  const orderStatus = opts.to === 'processing' ? 'in_process' : 'sample_collected';
  const itemStatus = opts.to === 'processing' ? 'in_process' : 'sample_collected';

  const { error: oErr } = await db().from('lab_orders')
    .update({ status: orderStatus, sample_collected_at: now } as never).eq('id', opts.orderId);
  if (oErr) throw new Error(`Advancing the order to ${orderStatus}: ${oErr.message}`);

  const { error: iErr } = await db().from('lab_order_items')
    .update({ status: itemStatus, sample_collected_at: now, sample_collected_by: opts.byUserId } as never)
    .eq('lab_order_id', opts.orderId);
  if (iErr) throw new Error(`Advancing items to ${itemStatus}: ${iErr.message}`);
}

/**
 * Back-date a previously validated result so the delta check has a baseline to compare against.
 *
 * `LabResultWorkspace` finds the prior value with: same `test_id`, same patient, a DIFFERENT
 * `lab_order_id`, `status IN ('reported','validated')`, `result_numeric NOT NULL`, ordered by
 * `result_entered_at` descending. Every one of those conditions has to hold or the lookup
 * returns nothing and the delta silently never fires — which would look like a passing negative
 * case. This is TEST FIXTURE, not the thing under test.
 */
export async function seedPriorResult(opts: {
  hospitalId: string;
  patientId: string;
  orderedBy: string;
  testName: string;
  value: string;
  daysAgo?: number;
}): Promise<{ orderId: string; itemId: string }> {
  const daysAgo = opts.daysAgo ?? 30;
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();

  const seeded = await seedLabOrder({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    orderedBy: opts.orderedBy,
    testNames: [opts.testName],
    billingStatus: 'billed',
    clinicalNotes: `QA fixture — baseline ${opts.testName} for the delta check`,
  });

  const { error: oErr } = await db().from('lab_orders')
    .update({
      status: 'completed',
      order_date: at.split('T')[0],
      ordered_at: at,
      validated_at: at,
      validated_by: opts.orderedBy,
    } as never)
    .eq('id', seeded.orderId);
  if (oErr) throw new Error(`Back-dating the prior order: ${oErr.message}`);

  const itemId = seeded.itemIds[0];
  const { error: iErr } = await db().from('lab_order_items')
    .update({
      result_value: opts.value,
      result_numeric: Number(opts.value),
      result_flag: 'N',
      status: 'reported',
      result_entered_at: at,
      result_entered_by: opts.orderedBy,
      validated_at: at,
      validated_by: opts.orderedBy,
    } as never)
    .eq('id', itemId);
  if (iErr) throw new Error(`Back-dating the prior result: ${iErr.message}`);

  return { orderId: seeded.orderId, itemId };
}

/* ── Lab reads ────────────────────────────────────────────────────────── */

export async function labOrderById(orderId: string): Promise<Record<string, unknown> | null> {
  const { data } = await db().from('lab_orders').select('*').eq('id', orderId).maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

export async function labOrdersFor(hospitalId: string, patientId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('lab_orders').select('*')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Reading lab_orders: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function labOrderItems(orderId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('lab_order_items')
    .select('*, lab_test_master:test_id(test_name, critical_low, critical_high, normal_min, normal_max)')
    .eq('lab_order_id', orderId);
  if (error) throw new Error(`Reading lab_order_items: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function labSamples(orderId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('lab_samples').select('*')
    .eq('lab_order_id', orderId).order('created_at', { ascending: true });
  if (error) throw new Error(`Reading lab_samples: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/**
 * The item row for one named test inside an order.
 *
 * Joins through `lab_test_master` rather than trusting item order, because the RPC inserts items
 * in the order they were passed and a reordered call would silently assert on the wrong test.
 */
export async function labItemForTest(orderId: string, testName: string): Promise<Record<string, unknown> | null> {
  const items = await labOrderItems(orderId);
  return items.find(i => {
    const master = i.lab_test_master as { test_name?: string } | null;
    return master?.test_name === testName;
  }) ?? null;
}

/* ── Radiology fixtures ───────────────────────────────────────────────── */

export interface SeededRadiologyOrder {
  orderId: string;
  accessionNumber: string | null;
  isPcpndt: boolean;
}

/**
 * Create a radiology order directly.
 *
 * There is no RPC for radiology, so this mirrors the column set
 * `NewRadiologyOrderModal.batchCreateRadiologyOrders` writes (`:427-449`) — including
 * `billing_status: 'billed'`, WITHOUT which the order is invisible in the worklist, because
 * `RadiologyPage.tsx:103` filters `.neq("billing_status", "unbilled")`. A fixture that left the
 * default `unbilled` would produce a row in the database that no test could ever see on screen.
 *
 * `is_pcpndt` is resolved here the same way `src/lib/pcpndt.ts` does, so a seeded obstetric
 * order carries the flag a real one would. It does NOT create the Form F row — whether that
 * happens is the thing 5G tests.
 */
export async function seedRadiologyOrder(opts: {
  hospitalId: string;
  patientId: string;
  orderedBy: string;
  studyName: string;
  encounterId?: string | null;
  admissionId?: string | null;
  priority?: 'routine' | 'urgent' | 'stat';
  clinicalHistory?: string;
  billingStatus?: 'unbilled' | 'billed' | 'waived';
  withReportShell?: boolean;
}): Promise<SeededRadiologyOrder> {
  const study = await radiologyStudyByName(opts.hospitalId, opts.studyName);
  const isPcpndt = requiresFormF({
    studyName: opts.studyName,
    modalityType: study.modality_type,
    requiresFormF: study.requires_form_f,
  });

  const now = new Date();
  const { data, error } = await db().from('radiology_orders').insert({
    hospital_id: opts.hospitalId,
    patient_id: opts.patientId,
    ordered_by: opts.orderedBy,
    encounter_id: opts.encounterId ?? null,
    admission_id: opts.admissionId ?? null,
    modality_id: study.modality_id,
    modality_type: study.modality_type,
    study_name: opts.studyName,
    clinical_history: opts.clinicalHistory ?? MOCK.phase5.radiology.clinicalHistory,
    priority: opts.priority ?? 'routine',
    status: 'ordered',
    billing_status: opts.billingStatus ?? 'billed',
    payment_status: 'paid',
    is_pcpndt: isPcpndt,
    ordered_at: now.toISOString(),
    order_date: now.toISOString().split('T')[0],
    order_time: now.toTimeString().slice(0, 8),
  } as never).select('id, accession_number').maybeSingle();

  if (error) throw new Error(`Seeding a radiology order (${opts.studyName}): ${error.message}`);
  const row = data as { id: string; accession_number: string | null };

  if (opts.withReportShell !== false) await seedRadiologyReportShell(opts.hospitalId, row.id, opts.patientId);

  return { orderId: row.id, accessionNumber: row.accession_number, isPcpndt };
}

/**
 * Create the `radiology_reports` shell row.
 *
 * FINDING R1 IS FIXED — this helper is now a convenience, not a workaround.
 *
 * R1 was: only `NewRadiologyOrderModal.tsx` created this row, while `syncRadiologyOrders` —
 * the function an OPD consultation actually calls — did not. Both `saveDraft` and
 * `validateAndSign` opened with `if (!report …) return;`, so on an OPD-raised order the
 * "Validate & Sign" button was enabled, did nothing when clicked, and raised no toast.
 *
 * Fixed in three places, so the bug cannot come back through a different door:
 *   1. `syncRadiologyOrders` creates the shell alongside the order;
 *   2. migration 20261018000002 backfilled the orders already stranded without one;
 *   3. `RadiologyReportingWorkspace.ensureReport()` creates one on demand and reports the
 *      failure loudly if it cannot — so no future insert path can strand a study again.
 *
 * `TC-P5F-013…015` still seed the shell-less state deliberately to prove (3) holds. Do not
 * "fix" them by calling this helper.
 */
export async function seedRadiologyReportShell(
  hospitalId: string, orderId: string, patientId: string,
): Promise<string> {
  const { data: existing } = await db()
    .from('radiology_reports').select('id').eq('order_id', orderId).maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data, error } = await db().from('radiology_reports').insert({
    hospital_id: hospitalId, order_id: orderId, patient_id: patientId,
  } as never).select('id').maybeSingle();
  if (error) throw new Error(`Seeding the radiology_reports shell: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * The Form F determination, re-derived independently of `src/lib/pcpndt.ts`.
 *
 * WHY NOT IMPORT THE REAL ONE: `src/lib/pcpndt.ts` is pure and would import cleanly, but a test
 * that asks the implementation whether the implementation is right cannot fail. This restates
 * the rule from the PCPNDT Act's shape — an obstetric ultrasound needs a Form F — so a change
 * to the app's keyword list shows up as a disagreement rather than being silently adopted.
 */
export function requiresFormF(subject: {
  studyName: string | null; modalityType: string | null; requiresFormF?: boolean | null;
}): boolean {
  if (subject.requiresFormF === true) return true;
  const modality = (subject.modalityType ?? '').toLowerCase();
  const isUltrasound = ['usg', 'ultrasound', 'ultrasonography', 'sonography', 'doppler']
    .some(u => modality.includes(u));
  if (!isUltrasound) return false;
  const name = (subject.studyName ?? '').toLowerCase();
  return [
    /\bobstetric(s|al)?\b/, /\bpregnan(cy|t)\b/, /\bante[\s-]?natal\b/, /\bfoetal\b|\bfetal\b/,
    /\banomaly\s*scan\b/, /\btiffa\b/, /\bnuchal\b/, /\bgrowth\s*scan\b/, /\bgestation/,
    /\blevel\s*(ii|2)\b/,
  ].some(rx => rx.test(name));
}

/* ── Radiology reads ──────────────────────────────────────────────────── */

export async function radiologyOrderById(orderId: string): Promise<Record<string, unknown> | null> {
  const { data } = await db().from('radiology_orders').select('*').eq('id', orderId).maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

export async function radiologyOrdersFor(hospitalId: string, patientId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('radiology_orders').select('*')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Reading radiology_orders: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function radiologyReportFor(orderId: string): Promise<Record<string, unknown> | null> {
  const { data } = await db().from('radiology_reports').select('*')
    .eq('order_id', orderId).maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

/** Rows in the auto-created statutory register (`pcpndt_form_f`). */
export async function formFRowsFor(orderId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('pcpndt_form_f').select('*').eq('order_id', orderId);
  if (error) throw new Error(`Reading pcpndt_form_f: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/**
 * Rows in the table the REGISTER SCREEN and both gates actually read (`pcpndt_records`).
 *
 * These are a different table from `formFRowsFor()` above, and that split is finding R2: an
 * auto-created Form F satisfies neither the "Start Study" gate nor the sign gate and never
 * appears in the register. Any case touching PCPNDT should check BOTH and say which it means.
 */
export async function pcpndtRecordsFor(orderId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('pcpndt_records').select('*')
    .eq('radiology_order_id', orderId);
  if (error) throw new Error(`Reading pcpndt_records: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/* ── Shared reads ─────────────────────────────────────────────────────── */

export async function clinicalAlertsFor(opts: {
  hospitalId: string; patientId?: string; alertType?: string; labOrderItemId?: string;
}): Promise<Array<Record<string, unknown>>> {
  let q = db().from('clinical_alerts').select('*').eq('hospital_id', opts.hospitalId);
  if (opts.patientId) q = q.eq('patient_id', opts.patientId);
  if (opts.alertType) q = q.eq('alert_type', opts.alertType);
  if (opts.labOrderItemId) q = q.eq('lab_order_item_id', opts.labOrderItemId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw new Error(`Reading clinical_alerts: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function billLineItemsByDedupeKey(hospitalId: string, dedupeKey: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('bill_line_items').select('*')
    .eq('hospital_id', hospitalId).eq('source_dedupe_key', dedupeKey);
  if (error) throw new Error(`Reading bill_line_items by dedupe key: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/**
 * Post a charge line for an order, the way `postAncillaryOrderCharges` does.
 *
 * The pre-payment gate clears when it finds NO charge at all (rule 5, "no_charge_found"), so a
 * pre-paid case that seeded an order and nothing else would be cleared for the wrong reason and
 * would prove the opposite of what it claims. This gives the gate something unpaid to find.
 *
 * The dedupe key format is not decorative — `checkAncillaryClearance` looks the charge up BY that
 * key, so `lab:<item id>` / `radiology:<order id>` must match exactly what the app writes.
 */
export async function seedUnpaidCharge(opts: {
  hospitalId: string;
  dedupeKey: string;
  itemType: 'lab' | 'radiology';
  description: string;
  amount: number;
}): Promise<void> {
  const { error } = await db().from('bill_line_items').insert({
    hospital_id: opts.hospitalId,
    source_dedupe_key: opts.dedupeKey,
    source_module: opts.itemType,
    item_type: opts.itemType,
    description: opts.description,
    quantity: 1,
    unit_rate: opts.amount,
    taxable_amount: opts.amount,
    gst_amount: 0,
    total_amount: opts.amount,
  } as never);
  if (error) {
    throw new Error(
      `Seeding an unpaid ${opts.itemType} charge (${opts.dedupeKey}): ${error.message}. ` +
      'bill_line_items may now require a bill_id — if so, the pre-payment cases need a draft ' +
      'bill seeded first rather than a bare line.',
    );
  }
}

export async function billsFor(hospitalId: string, patientId: string, billType?: string): Promise<Array<Record<string, unknown>>> {
  let q = db().from('bills').select('*').eq('hospital_id', hospitalId).eq('patient_id', patientId);
  if (billType) q = q.eq('bill_type', billType);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw new Error(`Reading bills: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function nabhEvidenceFor(hospitalId: string, since: Date): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('nabh_evidence_log').select('*')
    .eq('hospital_id', hospitalId).gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });
  // The evidence table is named differently on some branches; a missing table is a finding for
  // the case to report, not a crash inside a helper.
  if (error) return [];
  return (data ?? []) as Array<Record<string, unknown>>;
}

/* ── The IPD ancillary payment policy (P5-S02 vs P5-S03) ──────────────── */

export type AncillaryMode = 'pre_paid' | 'post_paid';

/**
 * Read the tenant's live ancillary policy.
 *
 * Read rather than assumed, because the DEFAULT when the key is absent is `post_paid` for every
 * service (`ipdAncillaryGate.ts:80-90`) — so a test that hardcoded "the tenant is pre-paid"
 * would pass for the wrong reason on a tenant that had never saved the setting.
 */
export async function ancillaryPolicy(hospitalId: string): Promise<Record<string, unknown>> {
  const fallback = {
    pharmacy: { mode: 'post_paid', receipt: 'consolidated' },
    lab: { mode: 'post_paid', receipt: 'consolidated' },
    radiology: { mode: 'post_paid', receipt: 'consolidated' },
  };
  const { data } = await db().from('hospital_settings').select('value')
    .eq('hospital_id', hospitalId).eq('key', 'ipd_ancillary_payment').maybeSingle();
  const raw = (data as { value?: string } | null)?.value;
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) };
  } catch {
    return fallback;
  }
}

/**
 * Flip one service's payment mode and return a restore function.
 *
 * ALWAYS call the returned restore in an `afterEach`/`finally`. `pre_paid` blocks sample
 * collection and study start across the whole tenant, so a test that left it set would silently
 * change the meaning of every case that ran after it — the phase runs `workers: 1` against
 * shared tenant state precisely because this kind of coupling exists.
 */
export async function setAncillaryMode(
  hospitalId: string, service: 'lab' | 'radiology' | 'pharmacy', mode: AncillaryMode,
): Promise<() => Promise<void>> {
  const before = await ancillaryPolicy(hospitalId);
  const next = { ...before, [service]: { ...(before[service] as object), mode } };

  const write = async (value: Record<string, unknown>): Promise<void> => {
    const { error } = await db().from('hospital_settings')
      .upsert({ hospital_id: hospitalId, key: 'ipd_ancillary_payment', value: JSON.stringify(value) } as never,
        { onConflict: 'hospital_id,key' });
    if (error) throw new Error(`Setting ${service} ancillary mode to ${mode}: ${error.message}`);
  };

  await write(next);
  return () => write(before);
}

/* ── Cleanup ──────────────────────────────────────────────────────────── */

/**
 * Delete everything Phase 5 can create for a set of patients, children first.
 *
 * ORDER MATTERS AND IS NOT NEGOTIABLE. Nothing in this chain declares ON DELETE CASCADE, so:
 *   - `lab_samples` and `lab_order_items` reference `lab_orders` and must precede it;
 *     `lab_samples.recollected_from_sample_id` is self-referential, so a rejected sample's
 *     recollection must not outlive it — the whole set for the order goes in one delete.
 *   - `lab_results` references `lab_order_items` (microbiology antibiograms only, but a culture
 *     case creates them).
 *   - `pcpndt_form_f` and `pcpndt_records` key on the ORDER, not the patient — neither table has
 *     a `patient_id` that would be caught by a patient-scoped delete, and `pcpndt_form_f`
 *     additionally carries a `no_delete_pcpndt` policy, so a failure here is expected under the
 *     anon role and must not be swallowed under the service role.
 *   - `clinical_alerts` rows reference `lab_order_item_id`; they go before the items.
 *
 * Errors are SURFACED, never swallowed. A purge that hides its failure leaves rows that poison
 * every later run and produces the stale-row class of bug Phase 3 documents at length.
 */
export async function purgeLabRadArtefacts(hospitalId: string, patientIds: string[]): Promise<void> {
  if (!patientIds.length) return;

  const D = db() as unknown as {
    from: (t: string) => {
      select: (c: string) => { in: (c: string, v: string[]) => Promise<{ data: Array<{ id: string }> | null }> };
      delete: () => { in: (c: string, v: string[]) => Promise<{ error: { message: string } | null }> };
    };
  };

  const idsOf = async (table: string, col: string, values: string[]): Promise<string[]> => {
    if (!values.length) return [];
    const { data } = await D.from(table).select('id').in(col, values);
    return (data ?? []).map(r => r.id);
  };

  const del = async (table: string, col: string, values: string[]): Promise<void> => {
    if (!values.length) return;
    const { error } = await D.from(table).delete().in(col, values);
    if (error) {
      throw new Error(
        `Purging "${table}" by ${col} failed: ${error.message}. Either a child table now ` +
        `references it without ON DELETE CASCADE — add it to purgeLabRadArtefacts() ABOVE this ` +
        `line — or a delete-blocking policy applies (pcpndt_form_f carries no_delete_pcpndt).`,
      );
    }
  };

  const labOrderIds = await idsOf('lab_orders', 'patient_id', patientIds);
  const radOrderIds = await idsOf('radiology_orders', 'patient_id', patientIds);
  const labItemIds = await idsOf('lab_order_items', 'lab_order_id', labOrderIds);

  // Alerts reference the item; they must go before it.
  await del('clinical_alerts', 'lab_order_item_id', labItemIds);
  await del('clinical_alerts', 'patient_id', patientIds);

  // Lab: results -> samples -> items -> order.
  await del('lab_results', 'order_item_id', labItemIds);
  await del('lab_samples', 'lab_order_id', labOrderIds);
  await del('lab_order_items', 'lab_order_id', labOrderIds);
  await del('lab_orders', 'patient_id', patientIds);

  // Radiology: BOTH PCPNDT tables and the report key on order_id, not patient_id.
  await del('pcpndt_records', 'radiology_order_id', radOrderIds);
  await del('pcpndt_form_f', 'order_id', radOrderIds);
  await del('radiology_reports', 'order_id', radOrderIds);
  await del('radiology_orders', 'patient_id', patientIds);

  await del('external_lab_referrals', 'patient_id', patientIds);
}

/** Convenience: resolve a hospital and purge a list of UHIDs in one call. */
export async function purgeByUhid(hospitalKey: 'A' | 'B', uhids: string[]): Promise<void> {
  const hid = await hospitalIdFor(hospitalKey);
  const ids: string[] = [];
  for (const uhid of uhids) {
    const { data } = await db().from('patients').select('id')
      .eq('hospital_id', hid).eq('uhid', uhid).maybeSingle();
    if (data) ids.push((data as { id: string }).id);
  }
  await purgeLabRadArtefacts(hid, ids);
}
