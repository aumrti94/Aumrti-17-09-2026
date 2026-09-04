/**
 * Phase 5 — the only place a journey may write with the service role.
 *
 * THE RULE
 * --------
 * > A service-role write is permitted only for state that (a) **predates the test's clock**,
 * > (b) belongs to a **tenant the test cannot log into**, or (c) **originates outside the
 * > product** — a device, a PACS, a reference lab. Everything a user of this hospital could have
 * > done today, the test does through the browser.
 *
 * WHY THE RULE NEEDED A FILE OF ITS OWN
 * ------------------------------------
 * The previous Phase 5 called `seedLabOrder()` in 78 cases and `advanceSamples()` in 40. Between
 * them they skipped the entire order-intake wizard, the payment step, the accession assignment, the
 * bill, the two-identifier check, the collection, the receipt and the processing — which is to say
 * they skipped the product. Every one of those cases still described itself as a workflow.
 *
 * Nothing stops that happening again except making it visibly harder. So the writers live here,
 * apart from the read helpers, each with the condition that justifies it named in its own doc
 * comment, and `scripts/qa-parity-check.mjs` fails any Phase 5 spec that imports from this module
 * without declaring the seed in `p5-manifest.ts`. If you find yourself wanting to add an export
 * here, the question to answer first is which of (a), (b) or (c) it satisfies. "It would be
 * quicker" is not one of them.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * `seedLabOrder`, `advanceSamples`, `seedRadiologyOrder`, `seedRadiologyReportShell` and
 * `seedUnpaidCharge`. Every one of them fabricates something a user does through the browser, and
 * the journeys now do exactly that: `orderLabThroughModal()`, `collectThroughWorkstation()`,
 * `receiveSample()`, `processSample()`, `Begin Report`.
 */
import { db } from '../utils/db-verify';
import { MOCK } from '../fixtures/mock-data';

/* ── (a) State that predates the test's clock ─────────────────────────── */

/**
 * Back-date a validated result so the delta check has a baseline to compare against.
 *
 * CONDITION (a). A test cannot wait a month between two creatinines, and no screen in the product
 * writes a back-dated `result_entered_at` — mutating one after the fact would be a different test
 * with a different subject.
 *
 * `LabResultWorkspace` finds the prior value with: same `test_id`, same patient, a DIFFERENT
 * `lab_order_id`, `status IN ('reported','validated')`, `result_numeric NOT NULL`, ordered by
 * `result_entered_at` descending. Every one of those conditions has to hold or the lookup returns
 * nothing, the delta silently never fires, and the case passes as a false negative.
 */
export async function seedPriorResult(opts: {
  hospitalId: string;
  patientId: string;
  orderedBy: string;
  testName: string;
  value: string;
  daysAgo: number;
}): Promise<string> {
  const when = new Date(Date.now() - opts.daysAgo * 86_400_000).toISOString();
  const master = MOCK.labTests.find(t => t.name === opts.testName);

  const { data: testRow, error: tErr } = await db()
    .from('lab_test_master').select('id')
    .eq('hospital_id', opts.hospitalId).eq('test_name', opts.testName).maybeSingle();
  if (tErr) throw new Error(`Looking up "${opts.testName}" for the delta baseline: ${tErr.message}`);
  if (!testRow) throw new Error(`No lab test "${opts.testName}" to back-date a baseline against.`);

  const { data: order, error: oErr } = await db().from('lab_orders').insert({
    hospital_id: opts.hospitalId,
    patient_id: opts.patientId,
    ordered_by: opts.orderedBy,
    status: 'completed',
    billing_status: 'billed',
    payment_status: 'paid',
    priority: 'routine',
    order_date: when.slice(0, 10),
    order_time: when,
    ordered_at: when,
    created_at: when,
  } as never).select('id').maybeSingle();
  if (oErr) throw new Error(`Seeding the delta baseline order: ${oErr.message}`);

  const orderId = (order as { id: string }).id;

  const { data: item, error: iErr } = await db().from('lab_order_items').insert({
    // `lab_order_items.hospital_id` is NOT NULL. Omitting it made every delta journey die at its
    // second stage with `null value in column "hospital_id" violates not-null constraint` — the
    // baseline was never written, so the entire delta check was unreachable.
    hospital_id: opts.hospitalId,
    lab_order_id: orderId,
    test_id: (testRow as { id: string }).id,
    status: 'validated',
    result_value: opts.value,
    result_numeric: Number(opts.value),
    result_unit: master?.unit ?? '',
    reference_range: master?.normalMin != null && master?.normalMax != null
      ? `${master.normalMin} - ${master.normalMax}` : '',
    result_entered_at: when,
    created_at: when,
  } as never).select('id').maybeSingle();
  if (iErr) throw new Error(`Seeding the delta baseline result: ${iErr.message}`);

  return (item as { id: string }).id;
}

/**
 * A run history for an analyte, so a Westgard multi-rule has something to evaluate against.
 *
 * CONDITION (a). Westgard 2-2s, 4-1s and 10x are all rules ABOUT A SEQUENCE — a single run cannot
 * violate them, and typing ten runs through the dialog would spend four minutes proving the dialog
 * works rather than proving the rule fires. The runs seeded here are all in control; the run that
 * BREAKS control is typed through the UI by the journey, so the violation is UI-triggered.
 */
export async function seedQcHistory(opts: {
  hospitalId: string;
  testName: string;
  analyzer: string;
  mean: number;
  sd: number;
  runs?: number;
  recordedBy?: string;
}): Promise<number> {
  const runs = opts.runs ?? 9;
  const rows = Array.from({ length: runs }, (_, i) => {
    // Alternating ±0.4 SD — comfortably in control, and deliberately not a monotonic run that
    // would itself trip the 10x rule before the journey's own entry does.
    const drift = (i % 2 === 0 ? 0.4 : -0.4) * opts.sd;
    return {
      hospital_id: opts.hospitalId,
      test_name: opts.testName,
      analyzer: opts.analyzer,
      level: 'L1',
      value: opts.mean + drift,
      mean: opts.mean,
      sd: opts.sd,
      recorded_at: new Date(Date.now() - (runs - i) * 3_600_000).toISOString(),
      recorded_by: opts.recordedBy ?? null,
    };
  });

  const { error } = await db().from('lab_qc_entries').insert(rows as never);
  if (error) throw new Error(`Seeding QC history for "${opts.testName}": ${error.message}`);
  return rows.length;
}

/**
 * Make sure the ancillary journeys have a patient who is actually ADMITTED.
 *
 * CONDITION (a). An inpatient stay predates the lab order that accrues to it — Phase 7 owns
 * admitting a patient, not Phase 5. `qa-seed.mjs` seeds `PT-QA-0018 Sharma Ji` as a patient but
 * creates **no `admissions` row at all** (the tenant has zero), which is not a product defect and
 * not a locator bug: it is a missing prerequisite, and it made both B journeys fail in ways that
 * looked like defects. `AdmissionLinker` returns null with no active admission, so "the order modal
 * does not show that this patient is admitted" was true and meaningless; and the
 * "Create Orders (Charge to Advance)" button never renders, so the pre-paid journey timed out
 * waiting for a control that cannot exist.
 *
 * Idempotent: returns the existing active admission when there is one.
 */
export async function ensureActiveAdmission(opts: {
  hospitalId: string;
  patientId: string;
  admittingDoctorId: string;
}): Promise<string> {
  const existing = await db().from('admissions').select('id')
    .eq('hospital_id', opts.hospitalId).eq('patient_id', opts.patientId)
    .eq('status', 'active').maybeSingle();
  const found = (existing.data as { id: string } | null)?.id;
  if (found) return found;

  // `bed_id` and `ward_id` are NOT NULL, so an admission needs a real bed to sit in.
  const { data: bed } = await db().from('beds').select('id, ward_id')
    .eq('hospital_id', opts.hospitalId).limit(1).maybeSingle();
  if (!bed) {
    throw new Error(
      'Cannot admit the ancillary-journey patient: this tenant has no beds. Wards and beds are a ' +
      'Phase 2 prerequisite (SETTINGS_PREREQ_MATRIX) — run: npm run qa:seed',
    );
  }
  const bedRow = bed as { id: string; ward_id: string };

  const { data, error } = await db().from('admissions').insert({
    hospital_id: opts.hospitalId,
    patient_id: opts.patientId,
    bed_id: bedRow.id,
    ward_id: bedRow.ward_id,
    admission_number: `ADM-QA-${Date.now().toString(36).toUpperCase()}`,
    admission_type: 'elective',
    admitting_doctor_id: opts.admittingDoctorId,
    status: 'active',
    admitted_at: new Date(Date.now() - 86_400_000).toISOString(),
  } as never).select('id').maybeSingle();

  if (error) throw new Error(`Admitting the ancillary-journey patient: ${error.message}`);
  return (data as { id: string }).id;
}

/* ── (c) State that originates outside the product ────────────────────── */

/**
 * An inbound analyser message, as if a device had pushed it over HL7.
 *
 * CONDITION (c). There is no analyser on the wire in CI, and the message is the DEVICE's output,
 * not the product's. What the journey tests is everything the product does with it: the inbox, the
 * parse, the accession match and the post onto the order — all through the browser.
 */
export async function seedAnalyzerMessage(opts: {
  hospitalId: string;
  accessionNumber: string;
  testCode: string;
  value: string;
  unit?: string;
  protocol?: string;
}): Promise<string> {
  const raw =
    `MSH|^~\\&|ANALYZER|LAB|HMS|HOSP|${new Date().toISOString()}||ORU^R01|MSGQA|P|2.5\r` +
    `OBR|1|${opts.accessionNumber}||${opts.testCode}\r` +
    `OBX|1|NM|${opts.testCode}||${opts.value}|${opts.unit ?? ''}|||||F\r`;

  const { data, error } = await db().from('lab_analyzer_messages').insert({
    hospital_id: opts.hospitalId,
    protocol: opts.protocol ?? 'hl7_mllp',
    raw_message: raw,
    message_type: 'ORU^R01',
    accession_number: opts.accessionNumber,
    status: 'pending',
    match_confidence: 'high',
  } as never).select('id').maybeSingle();

  if (error) throw new Error(`Seeding an inbound analyzer message: ${error.message}`);
  return (data as { id: string }).id;
}

/* ── Restoring tenant-wide state ──────────────────────────────────────── */

/**
 * Read and write `hospital_settings.ipd_ancillary_payment` directly.
 *
 * NOT a seed — a SAFETY NET. The ancillary policy is tenant-wide, so a journey that flips it
 * through the settings screen must put it back even if it fails halfway; a `finally` that depends
 * on the browser still working is not a `finally`. `readAncillaryPolicy` is also what
 * `p5Prerequisites()` uses to catch a policy leaked by an earlier case, which otherwise shows up
 * three journeys later as a product defect that is not one.
 */
export async function readAncillaryPolicy(hospitalId: string): Promise<Record<string, unknown>> {
  const { data } = await db().from('hospital_settings').select('value')
    .eq('hospital_id', hospitalId).eq('key', 'ipd_ancillary_payment').maybeSingle();
  const raw = (data as { value?: string } | null)?.value;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function restoreAncillaryPolicy(
  hospitalId: string,
  policy: Record<string, unknown>,
): Promise<void> {
  const { error } = await db().from('hospital_settings').upsert({
    hospital_id: hospitalId,
    key: 'ipd_ancillary_payment',
    value: JSON.stringify(policy),
  } as never, { onConflict: 'hospital_id,key' });
  if (error) throw new Error(`Restoring the ancillary policy: ${error.message}`);
}
