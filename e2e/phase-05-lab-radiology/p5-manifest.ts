/**
 * Phase 5 — the journey manifest. One source for the specs, the tracker CSV and the parity check.
 *
 * WHY A MANIFEST AND NOT JUST 24 SPEC FILES
 * -----------------------------------------
 * A Phase 5 case is now a 25–45 stage journey rather than a one-field assertion. That creates a
 * drift problem the old narrow cases never had: the CSV `Steps` column is what a HUMAN tester
 * follows, and the `test.step()` titles are what the AUTOMATION walks. When those two are typed
 * out separately they diverge within a sprint, and the manual and automated runs quietly stop
 * testing the same journey while the tracker merges their results onto one row as if they had.
 *
 * So the stages are declared once, here. The spec imports them for its `test.step()` titles;
 * `docs/qa/tracker/build-p5-cases.mjs` writes the same list into the CSV. `qa-parity-check.mjs`
 * then enforces that every journey carries at least one NEGATIVE and one BOUNDARY stage and at
 * least ten stages in total — which is what mechanically stops a narrow case being re-introduced
 * wearing a journey's name.
 *
 * THE STAGE TITLE FORMAT IS LOAD-BEARING
 * --------------------------------------
 * `stageTitle()` renders `S09/38 · lab_technician · Draw the sample at the collection workstation`.
 * Playwright reports the innermost failing step, so that one line tells a reader the journey got
 * three-quarters of the way through payment and died at phlebotomy — without opening a trace. The
 * tracker reporter parses the same `S<n>/<total> · ` prefix to count stages passed.
 */

export type TimeoutClass = 'cross-module' | 'single-module' | 'short';

/** How a stage reads in the CSV, and what the parity check counts. */
export type StageKind = 'positive' | 'negative' | 'boundary' | 'verify' | 'rbac' | 'setup';

export interface JourneyStage {
  /** Who is doing this — a role name, or `verify` for a Supabase check. */
  actor: string;
  /** Imperative, one line. Must name a route or a table (the parity rule). */
  title: string;
  kind?: StageKind;
}

export interface Journey {
  id: string;
  section: string;
  title: string;
  priority: 'P1' | 'P2' | 'P3';
  testType: 'Positive' | 'Negative' | 'Boundary' | 'RBAC' | 'Cross-Module';
  /** In the ~25-minute `@smoke` tier. */
  smoke: boolean;
  timeoutClass: TimeoutClass;
  roles: string[];
  /** `own` = this case provisions its own patient. `seeded` = it reuses an existing record. */
  patient: { kind: 'own' } | { kind: 'seeded'; uhid: string; why: string };
  scenario: string;
  crossModule: string;
  settings: string;
  why: string;
  /** Declared service-role state, for the seed allow-list check. Empty = fully UI-driven. */
  seeded: string[];
  verify: string;
  spec: string;
  /** True while the journey is declared but not yet implemented (Batch 2). */
  pending?: boolean;
  stages: JourneyStage[];
}

export const TIMEOUTS: Record<TimeoutClass, number> = {
  'cross-module': 420_000,
  'single-module': 300_000,
  short: 180_000,
};

const PREREQ =
  'Tier 0 complete; lab_test_master active with fees, reference AND critical ranges; lab_test_groups ' +
  'with members; radiology modalities + studies with requires_form_f; pcpndt_settings; ' +
  'hospital_settings.ipd_ancillary_payment';

/** `S09/38 · lab_technician · Draw the sample` — parsed back out by the tracker reporter. */
export function stageTitle(index: number, total: number, stage: JourneyStage): string {
  const n = String(index + 1).padStart(2, '0');
  return `S${n}/${total} · ${stage.actor} · ${stage.title}`;
}

/** All stage titles for a journey, in order. */
export function stageTitles(j: Journey): string[] {
  return j.stages.map((s, i) => stageTitle(i, j.stages.length, s));
}

/* ── The journeys ─────────────────────────────────────────────────────── */

const A001: Journey = {
  id: 'TC-P5A-001',
  section: '5A Outpatient Lab',
  title: 'Cash OPD lab: consultation to the doctor\'s chart, with the money on the bill',
  priority: 'P1', testType: 'Cross-Module', smoke: true, timeoutClass: 'cross-module',
  roles: ['doctor', 'lab_technician', 'doctor'],
  patient: { kind: 'own' },
  scenario: 'P5-S01',
  crossModule: 'OPD, Lab, Billing',
  settings: PREREQ,
  why:
    'This is the journey a hospital actually buys. Every other case in the phase starts in the ' +
    'middle of it with a seeded order, which proves each stage works but never proves the stages ' +
    'hand off to each other — the only thing that matters on go-live day. It crosses four modules ' +
    'and three people in one sitting, so a broken hand-off has exactly one place to show up.',
  seeded: [],
  verify:
    'lab_orders where patient_id = the case patient -> 1 row, status ordered then sample_collected ' +
    'then completed, accession_number matching ACC-YYYYMMDD-NNNN; lab_samples -> collected_at and ' +
    'collected_by set; bills where bill_type = lab -> bill_status final, payment_status paid; ' +
    'bill_line_items where source_dedupe_key = lab:<item id> -> exactly 1',
  spec: 'e2e/phase-05-lab-radiology/P5A.outpatient-lab.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'doctor', title: 'Log in and open /opd', kind: 'positive' },
    { actor: 'doctor', title: 'Register the walk-in by UHID and issue a token', kind: 'positive' },
    { actor: 'verify', title: 'Read opd_tokens and confirm the token belongs to this patient', kind: 'verify' },
    { actor: 'doctor', title: 'Open the token and start the consultation', kind: 'positive' },
    { actor: 'doctor', title: 'NEGATIVE: complete the consultation with an empty chief complaint', kind: 'negative' },
    { actor: 'doctor', title: 'Record the chief complaint', kind: 'positive' },
    { actor: 'doctor', title: 'Prescribe Haemoglobin in the Rx & Orders tab', kind: 'positive' },
    { actor: 'doctor', title: 'Complete the consultation', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders and confirm the consultation raised NO order yet', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Log in and open /lab -> Pending from OPD', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open Create Order and confirm patient and test arrived preselected', kind: 'positive' },
    { actor: 'lab_technician', title: 'Proceed to payment and price every unpriced test', kind: 'positive' },
    { actor: 'lab_technician', title: 'Take the cash and create the order', kind: 'positive' },
    { actor: 'lab_technician', title: 'Read the receipt and close the wizard', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: one billed order at status ordered', kind: 'verify' },
    { actor: 'verify', title: 'BOUNDARY: accession_number matches ACC-YYYYMMDD-NNNN', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_order_items and lab_samples: items exist, sample is pending', kind: 'verify' },
    { actor: 'verify', title: 'Read bills: a final, paid lab bill with a non-zero total', kind: 'verify' },
    { actor: 'verify', title: 'BOUNDARY: exactly one bill_line_items row carries the lab dedupe key', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Open /lab -> Collection -> To Collect', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: Confirm & Collect stays disabled until identity is attested', kind: 'negative' },
    { actor: 'lab_technician', title: 'Tick the two-identifier check and collect the sample', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_samples: collected, with collected_at and collected_by', kind: 'verify' },
    { actor: 'verify', title: 'Read lab_orders: the order moved to sample_collected', kind: 'verify' },
    { actor: 'lab_technician', title: 'Receive the sample into the laboratory', kind: 'positive' },
    { actor: 'lab_technician', title: 'Start processing on the bench', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_samples and lab_orders: received_at stamped, order in_process', kind: 'verify' },
    { actor: 'lab_technician', title: 'Open the order in the worklist result workspace', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: enter Haemoglobin 14.5 and confirm it flags N, not H', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_order_items: the typed value persisted on blur', kind: 'verify' },
    { actor: 'lab_technician', title: 'Release the report', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: the order advanced to completed or pending_validation', kind: 'verify' },
    { actor: 'verify', title: 'Read clinical_alerts: a result-ready alert names the ordering doctor', kind: 'verify' },
    { actor: 'doctor', title: 'Log back in and open the patient on /opd', kind: 'positive' },
    { actor: 'doctor', title: 'Open the Reports tab and read the released Haemoglobin', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: billing_status is billed, so nothing leaks unbilled', kind: 'verify' },
    { actor: 'verify', title: 'BOUNDARY: still exactly one dedupe-keyed charge line after release', kind: 'boundary' },
  ],
};

const A002: Journey = {
  id: 'TC-P5A-002',
  section: '5A Outpatient Lab',
  title: 'Panel ordering: the group price wins, and the members ride on it',
  priority: 'P1', testType: 'Boundary', smoke: false, timeoutClass: 'cross-module',
  roles: ['doctor', 'lab_technician'],
  patient: { kind: 'own' },
  scenario: 'P5-S04',
  crossModule: 'OPD, Lab, Billing',
  settings: PREREQ,
  why:
    'A panel exists so a hospital can discount a bundle. Group rates are keyed by group_id while ' +
    'the bill-line loop looks them up by test_id, so every group-covered test can be written at ' +
    'a zero rate with the placeholder description "Lab: Test" while the bill header still carries ' +
    'the panel fee. The bill then does not add up, and nobody notices until reconciliation.',
  seeded: [],
  verify:
    'bills where bill_type = lab -> total_amount equals the group fee, not the member sum; ' +
    'bill_line_items for that bill -> no row with unit_rate = 0 or description "Lab: Test", and ' +
    'the sum of line totals equals the bill header',
  spec: 'e2e/phase-05-lab-radiology/P5A.outpatient-lab.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and confirm the panel has members', kind: 'setup' },
    { actor: 'verify', title: 'Read lab_test_groups and lab_test_group_items: the panel is complete', kind: 'verify' },
    { actor: 'doctor', title: 'Log in and open /opd', kind: 'positive' },
    { actor: 'doctor', title: 'Register the walk-in and start a consultation', kind: 'positive' },
    { actor: 'doctor', title: 'Prescribe all three Fever Panel members', kind: 'positive' },
    { actor: 'doctor', title: 'Complete the consultation', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open /lab -> Pending from OPD and create the order', kind: 'positive' },
    { actor: 'lab_technician', title: 'Confirm all three members arrived preselected', kind: 'positive' },
    { actor: 'lab_technician', title: 'Proceed to payment and read the quoted total', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: the quote is the group fee, not the member sum', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Take the cash and create the order', kind: 'positive' },
    { actor: 'verify', title: 'Read bills: the header total equals the group fee', kind: 'boundary' },
    { actor: 'verify', title: 'NEGATIVE: no bill_line_items row is written at a zero rate', kind: 'negative' },
    { actor: 'verify', title: 'NEGATIVE: no line carries the placeholder description "Lab: Test"', kind: 'negative' },
    { actor: 'verify', title: 'BOUNDARY: the sum of the line items equals the bill header', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Open /lab -> Collection and draw the panel sample', kind: 'positive' },
    { actor: 'lab_technician', title: 'Receive and process the sample', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open the order and enter a result for every member', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_order_items: all three members carry values', kind: 'verify' },
    { actor: 'lab_technician', title: 'Release the panel report', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: the panel completed as one order', kind: 'verify' },
    { actor: 'lab_technician', title: 'Order a single panel member on a second order', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: one of three members is billed the individual fee', kind: 'boundary' },
    { actor: 'verify', title: 'Read bills: the partial order did not take the group price', kind: 'boundary' },
  ],
};

const A003: Journey = {
  id: 'TC-P5A-003',
  section: '5A Outpatient Lab',
  title: 'Direct desk order: the New Lab Order modal end to end, and every way it refuses',
  priority: 'P1', testType: 'Negative', smoke: false, timeoutClass: 'single-module',
  roles: ['lab_technician'],
  patient: { kind: 'own' },
  scenario: 'P5-S01',
  crossModule: 'Lab, Billing',
  settings: PREREQ,
  why:
    'Not every test is prescribed in a consultation — a patient walks up to the counter and asks ' +
    'for one. That path has its own modal with its own validation, and it is where an order gets ' +
    'created against the wrong patient, at the wrong price, or for a test the catalogue does not ' +
    'have. Every field and every refusal in this wizard is money or identity.',
  seeded: [],
  verify:
    'lab_orders where patient_id = the case patient -> exactly 1 row after the valid submission and ' +
    'no rows after each refused attempt; bills where bill_type = lab -> 1 final paid bill',
  spec: 'e2e/phase-05-lab-radiology/P5A.outpatient-lab.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'lab_technician', title: 'Log in and open /lab -> Worklist', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open the New Lab Order modal', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: Proceed is disabled with no patient and no tests', kind: 'negative' },
    { actor: 'lab_technician', title: 'Search the patient by UHID and select them', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: Proceed is still disabled with a patient but no tests', kind: 'negative' },
    { actor: 'lab_technician', title: 'NEGATIVE: search an off-catalogue misspelling and find nothing to add', kind: 'negative' },
    { actor: 'lab_technician', title: 'Choose the referring doctor from the dropdown', kind: 'positive' },
    { actor: 'lab_technician', title: 'Set priority to Routine, then Urgent, then STAT', kind: 'positive' },
    { actor: 'lab_technician', title: 'Confirm the STAT banner warns the lab must be told verbally', kind: 'positive' },
    { actor: 'lab_technician', title: 'Add a test from the catalogue search', kind: 'positive' },
    { actor: 'lab_technician', title: 'Remove the test again with its chip, then re-add it', kind: 'positive' },
    { actor: 'lab_technician', title: 'Fill the clinical notes / indication', kind: 'positive' },
    { actor: 'lab_technician', title: 'Proceed to payment', kind: 'positive' },
    { actor: 'lab_technician', title: 'Read the subtotal, GST and total payable rows', kind: 'verify' },
    { actor: 'lab_technician', title: 'Go Back to the order step and confirm the selection survived', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Proceed to payment again and choose UPI', kind: 'positive' },
    { actor: 'lab_technician', title: 'Fill the UPI reference and take the payment', kind: 'positive' },
    { actor: 'lab_technician', title: 'Read the receipt: bill number, patient, tests, amount paid', kind: 'verify' },
    { actor: 'lab_technician', title: 'Close the wizard with Done', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: exactly one STAT order at status ordered', kind: 'verify' },
    { actor: 'verify', title: 'Read clinical_alerts: a stat_lab_order alert was raised', kind: 'verify' },
    { actor: 'verify', title: 'Read bills and bill_payments: the UPI reference was recorded', kind: 'verify' },
    { actor: 'verify', title: 'BOUNDARY: exactly one dedupe-keyed charge line, not two', kind: 'boundary' },
  ],
};

const B001: Journey = {
  id: 'TC-P5B-001',
  section: '5B Inpatient Lab & Ancillary Money',
  title: 'Post-paid ward round: the charge accrues to the admission and no cash step exists',
  priority: 'P1', testType: 'Cross-Module', smoke: false, timeoutClass: 'single-module',
  roles: ['hospital_admin', 'lab_technician'],
  patient: { kind: 'seeded', uhid: 'PT-QA-0018', why: 'the charge must accrue against a LIVE admission; a fresh patient has none' },
  scenario: 'P5-S02',
  crossModule: 'IPD, Lab, Billing',
  settings: PREREQ + '; ipd_ancillary_payment lab mode = post_paid',
  why:
    'A ward round cannot stop to send a relative to a counter. Under post-paid the order must be ' +
    'raised and the sample drawn immediately, with the charge accruing to the admission and ' +
    'settling once at discharge. A separate lab bill here sends a family to pay twice, and a ' +
    'charge that never accrues is an investigation the hospital performed for free.',
  seeded: ['seededPatient(PT-QA-0018) — an existing admission'],
  verify:
    'bills where patient_id = PT-QA-0018 and bill_type = lab -> 0 rows; bill_line_items where ' +
    'source_dedupe_key = lab:<item id> -> at most 1, attached to the admission bill; lab_orders -> ' +
    'admission_id set, billing_status not unbilled',
  spec: 'e2e/phase-05-lab-radiology/P5B.inpatient-lab-money.spec.ts',
  stages: [
    { actor: 'setup', title: 'Resolve the admitted patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'hospital_admin', title: 'Open /settings/approvals and read the IPD ancillary policy', kind: 'positive' },
    { actor: 'hospital_admin', title: 'Set the lab ancillary mode to post_paid', kind: 'positive' },
    { actor: 'verify', title: 'Read hospital_settings: ipd_ancillary_payment lab mode is post_paid', kind: 'verify' },
    { actor: 'lab_technician', title: 'Log in and open /lab -> Worklist', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open the New Lab Order modal and select the admitted patient', kind: 'positive' },
    { actor: 'lab_technician', title: 'Confirm the admission is linked in the order', kind: 'positive' },
    { actor: 'lab_technician', title: 'Add a routine test', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: the primary button offers Charge to Advance, not Proceed to Payment', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Create the order against the admission', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: admission_id is set and billing_status is not unbilled', kind: 'verify' },
    { actor: 'verify', title: 'NEGATIVE: read bills — no separate lab bill was raised', kind: 'negative' },
    { actor: 'verify', title: 'Read bill_line_items: the charge accrued under the lab dedupe key', kind: 'verify' },
    { actor: 'lab_technician', title: 'Open /lab -> Collection -> To Collect', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: no payment-pending dialog blocks a post-paid draw', kind: 'negative' },
    { actor: 'lab_technician', title: 'Collect the sample after the two-identifier check', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_samples: the ward sample was collected immediately', kind: 'verify' },
    { actor: 'lab_technician', title: 'Receive and process the sample', kind: 'positive' },
    { actor: 'lab_technician', title: 'Enter a result and release the report', kind: 'positive' },
    { actor: 'verify', title: 'BOUNDARY: still no separate lab bill after release', kind: 'boundary' },
    { actor: 'verify', title: 'BOUNDARY: exactly one dedupe-keyed charge line, not a second at release', kind: 'boundary' },
    { actor: 'hospital_admin', title: 'Restore the ancillary policy to its original value', kind: 'setup' },
  ],
};

const B002: Journey = {
  id: 'TC-P5B-002',
  section: '5B Inpatient Lab & Ancillary Money',
  title: 'Pre-paid gate: the four ways it holds, and the two ways it is bypassed',
  priority: 'P1', testType: 'Negative', smoke: true, timeoutClass: 'cross-module',
  roles: ['hospital_admin', 'lab_technician'],
  patient: { kind: 'seeded', uhid: 'PT-QA-0018', why: 'the gate only engages against a live admission' },
  scenario: 'P5-S03',
  crossModule: 'IPD, Lab, Billing',
  settings: PREREQ + '; ipd_ancillary_payment lab mode = pre_paid',
  why:
    'A hospital that has chosen pay-before-service is relying on this gate for its cash flow, and ' +
    'a hospital that has not must never see it. Both halves are one code path with seven rules, ' +
    'and two of them are safety valves: a STAT potassium on a ventilated patient must never wait ' +
    'at a billing counter, and an order whose charge failed must not strand the patient either.',
  seeded: ['seededPatient(PT-QA-0018) — an existing admission'],
  verify:
    'lab_samples for the blocked order -> status stays pending; clinical_alerts -> one ' +
    'ipd_ancillary_payment_override row naming the technician and carrying the reason; the STAT ' +
    'order -> sample collected without an override',
  spec: 'e2e/phase-05-lab-radiology/P5B.inpatient-lab-money.spec.ts',
  stages: [
    { actor: 'setup', title: 'Resolve the admitted patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'hospital_admin', title: 'Open /settings/approvals and set the lab ancillary mode to pre_paid', kind: 'positive' },
    { actor: 'verify', title: 'Read hospital_settings: the tenant is now pay-before-service', kind: 'verify' },
    { actor: 'lab_technician', title: 'Raise a routine ward order through the New Lab Order modal', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open /lab -> Collection -> To Collect and press Collect', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: the payment-pending dialog blocks the draw', kind: 'negative' },
    { actor: 'lab_technician', title: 'Read the amount due and the counter instruction', kind: 'verify' },
    { actor: 'verify', title: 'Read lab_samples: the sample is still pending, not collected', kind: 'negative' },
    { actor: 'lab_technician', title: 'NEGATIVE: Confirm override stays disabled with no reason typed', kind: 'negative' },
    { actor: 'lab_technician', title: 'Type a clinical override reason and confirm', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_samples: the override released the draw', kind: 'verify' },
    { actor: 'verify', title: 'Read clinical_alerts: the override is recorded with its reason and author', kind: 'verify' },
    { actor: 'lab_technician', title: 'Raise a second, STAT ward order', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: a STAT order collects with no gate and no override', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_samples: the STAT sample was collected', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Raise a third order and confirm no charge row was posted for it', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: with no charge posted the gate fails open', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Open the blocked order in the result workspace', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: Mark Collected in the workspace must not silently no-op', kind: 'negative' },
    { actor: 'lab_technician', title: 'NEGATIVE: an authenticated direct API write bypasses the gate entirely', kind: 'negative' },
    { actor: 'verify', title: 'Read lab_samples: the gate is client-side only, with no database trigger', kind: 'negative' },
    { actor: 'hospital_admin', title: 'Restore the ancillary policy to its original value', kind: 'setup' },
  ],
};

const C001: Journey = {
  id: 'TC-P5C-001',
  section: '5C Specimen Lifecycle',
  title: 'Rejection and recollection: eight reasons, and the two ways rejection is wrong',
  priority: 'P1', testType: 'Negative', smoke: true, timeoutClass: 'single-module',
  roles: ['lab_technician'],
  patient: { kind: 'own' },
  scenario: 'P5-S06',
  crossModule: 'Lab, Billing',
  settings: PREREQ,
  why:
    'A haemolysed tube is an ordinary morning in a laboratory. What must not be ordinary is ' +
    'charging the patient twice for it, losing the link between the spoiled tube and its ' +
    'replacement, or rewinding an order that still has a viable sample on the bench. The reason ' +
    'is also the quality record — a rejection with no reason cannot be trended and cannot be fixed.',
  seeded: [],
  verify:
    'lab_samples for the order -> the rejected row carries rejection_reason and the new pending row ' +
    'carries recollected_from_sample_id pointing at it, with a different barcode; bills -> the ' +
    'count is unchanged across the rejection',
  spec: 'e2e/phase-05-lab-radiology/P5C.specimen-lifecycle.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'lab_technician', title: 'Log in and raise a single-tube order through the New Lab Order modal', kind: 'positive' },
    { actor: 'verify', title: 'Read bills: record the bill count before any rejection', kind: 'verify' },
    { actor: 'lab_technician', title: 'Open /lab -> Collection -> To Collect', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: Reject is offered on a tube that has never been drawn', kind: 'negative' },
    { actor: 'lab_technician', title: 'Collect the sample properly after the identity check', kind: 'positive' },
    { actor: 'lab_technician', title: 'Move to the Collected tab and open the Reject dialog', kind: 'positive' },
    { actor: 'lab_technician', title: 'Read all eight rejection reasons offered as radio options', kind: 'verify' },
    { actor: 'lab_technician', title: 'BOUNDARY: select each of the eight reasons in turn in the dialog', kind: 'boundary' },
    { actor: 'lab_technician', title: 'NEGATIVE: cancel the dialog and confirm nothing was rejected', kind: 'negative' },
    { actor: 'verify', title: 'Read lab_samples: the sample is still collected, not rejected', kind: 'negative' },
    { actor: 'lab_technician', title: 'Re-open the dialog, choose Hemolyzed and add a note', kind: 'positive' },
    { actor: 'lab_technician', title: 'Confirm Reject & Queue Recollection', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_samples: the tube is rejected and carries its reason', kind: 'verify' },
    { actor: 'verify', title: 'Read lab_samples: a new pending recollection was queued', kind: 'verify' },
    { actor: 'verify', title: 'BOUNDARY: the recollection links to the tube it replaces and has a new barcode', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_orders: the order was rewound to ordered', kind: 'verify' },
    { actor: 'verify', title: 'NEGATIVE: read bills — the patient was NOT charged a second time', kind: 'negative' },
    { actor: 'lab_technician', title: 'Open the Rejected tab and read the Reason column', kind: 'positive' },
    { actor: 'lab_technician', title: 'Draw the recollection tube and take it through to a result', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_order_items: the replacement tube produced the result', kind: 'verify' },
    { actor: 'lab_technician', title: 'Raise a second, two-tube order for the multi-tube branch', kind: 'positive' },
    { actor: 'lab_technician', title: 'Collect both tubes, then reject only one', kind: 'positive' },
    { actor: 'verify', title: 'BOUNDARY: with one tube still viable the order is NOT rewound', kind: 'boundary' },
    { actor: 'verify', title: 'BOUNDARY: only the spoiled tube has a recollection queued', kind: 'boundary' },
    { actor: 'verify', title: 'NEGATIVE: read nabh_evidence_log — a rejection writes no quality evidence', kind: 'negative' },
  ],
};

const C002: Journey = {
  id: 'TC-P5C-002',
  section: '5C Specimen Lifecycle',
  title: 'Chain of custody: barcode, receipt, processing and the mix-up guard',
  priority: 'P1', testType: 'Positive', smoke: false, timeoutClass: 'single-module',
  roles: ['lab_technician'],
  patient: { kind: 'own' },
  scenario: 'P5-S05',
  crossModule: 'Lab',
  settings: PREREQ,
  why:
    'The accession number and the sample barcode are different identifiers and are routinely ' +
    'confused: the printed label carries one and the bench scans the other. A label that ' +
    'identifies a different thing from what the bench reads is how the wrong result reaches the ' +
    'wrong patient, and every state between the draw and the bench must be attributable when a ' +
    'mix-up is suspected.',
  seeded: [],
  verify:
    'lab_orders.accession_number matches ACC-YYYYMMDD-NNNN; lab_samples.barcode is non-empty, ' +
    'differs from the accession, and is unique across two orders on the same patient; each ' +
    'transition stamps its actor and timestamp',
  spec: 'e2e/phase-05-lab-radiology/P5C.specimen-lifecycle.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'lab_technician', title: 'Raise a first order through the New Lab Order modal', kind: 'positive' },
    { actor: 'lab_technician', title: 'Raise a second order on the same patient', kind: 'positive' },
    { actor: 'verify', title: 'BOUNDARY: read lab_orders — the accession matches ACC-YYYYMMDD-NNNN', kind: 'boundary' },
    { actor: 'verify', title: 'BOUNDARY: read lab_samples — the barcode is not the accession number', kind: 'boundary' },
    { actor: 'verify', title: 'BOUNDARY: the two orders carry different, unique barcodes', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Open /lab -> Collection and read the Accession column', kind: 'verify' },
    { actor: 'lab_technician', title: 'Print the barcode label and confirm the popup is dispatched', kind: 'positive' },
    { actor: 'lab_technician', title: 'Collect the first sample after the identity check', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_samples: collected_at and collected_by are both stamped', kind: 'verify' },
    { actor: 'verify', title: 'Read lab_order_items: the item-level collector agrees with the sample', kind: 'verify' },
    { actor: 'lab_technician', title: 'Receive the sample and confirm it leaves the Collected tab', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_samples: received_at is stamped', kind: 'verify' },
    { actor: 'lab_technician', title: 'Start processing and confirm it leaves the Received tab', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders and lab_order_items: both moved to in_process', kind: 'verify' },
    { actor: 'lab_technician', title: 'Open the order and switch to the Sample sub-tab', kind: 'positive' },
    { actor: 'lab_technician', title: 'Read the six-step custody stepper and the barcode chip', kind: 'verify' },
    { actor: 'lab_technician', title: 'NEGATIVE: the bench cannot skip a state — Receive is gone once received', kind: 'negative' },
    { actor: 'lab_technician', title: 'Enter a result and read the Sample tab banner change', kind: 'positive' },
    { actor: 'lab_technician', title: 'Check the sample-integrity panel for a mix-up indicator', kind: 'verify' },
    { actor: 'lab_technician', title: 'Release the report', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: the custody chain ends at a released order', kind: 'verify' },
  ],
};

const D001: Journey = {
  id: 'TC-P5D-001',
  section: '5D Result Correctness',
  title: 'Critical value: the boundary battery and the phone call',
  priority: 'P1', testType: 'Boundary', smoke: true, timeoutClass: 'cross-module',
  roles: ['lab_technician', 'doctor'],
  patient: { kind: 'own' },
  scenario: 'P5-S07',
  crossModule: 'Lab, OPD',
  settings: PREREQ,
  why:
    'A potassium of 7.2 is a cardiac arrest risk within hours, and the only thing that reaches the ' +
    'treating doctor is the alert row — a flag on a screen nobody is watching is not a ' +
    'notification. The boundaries matter just as much in the other direction: a range that flags ' +
    'its own upper bound produces a flagged result on every healthy patient, and alert fatigue is ' +
    'how a real critical value gets scrolled past.',
  seeded: [],
  verify:
    'lab_order_items -> result_flag CH at 7.2, H at critical_high exactly, N at normal_max, ' +
    'critical_acknowledged and critical_acknowledged_by set after the call; clinical_alerts -> one ' +
    'critical_lab_value row at severity critical, naming the test and the value, closed on ' +
    'acknowledgement',
  spec: 'e2e/phase-05-lab-radiology/P5D.result-correctness.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'verify', title: 'Read lab_test_master: the catalogue carries critical_low and critical_high', kind: 'verify' },
    { actor: 'verify', title: 'BOUNDARY: the mock boundary values straddle this tenant thresholds', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Open /lab and raise a potassium order, then take it to the bench', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open the order in the result workspace', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: enter the value equal to normal_max and read the flag', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_order_items: normal_max exactly must flag N, not H', kind: 'boundary' },
    { actor: 'lab_technician', title: 'BOUNDARY: enter the value just above normal_max', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_order_items: just above normal_max flags H', kind: 'boundary' },
    { actor: 'verify', title: 'NEGATIVE: read clinical_alerts — a merely high value raises NO critical alert', kind: 'negative' },
    { actor: 'lab_technician', title: 'BOUNDARY: enter the value exactly at critical_high', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_order_items: at the threshold exactly is H, not CH — the test is strict', kind: 'boundary' },
    { actor: 'lab_technician', title: 'BOUNDARY: enter the value one step over critical_high', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_order_items: one step over the threshold flags CH', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Enter the frankly critical potassium of 7.2', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_order_items: 7.2 flags CH', kind: 'verify' },
    { actor: 'verify', title: 'Read clinical_alerts: a critical_lab_value alert was raised at severity critical', kind: 'verify' },
    { actor: 'verify', title: 'Read clinical_alerts: the message names the test and carries the value', kind: 'verify' },
    { actor: 'verify', title: 'Read clinical_alerts: the alert links back to the result item', kind: 'verify' },
    { actor: 'lab_technician', title: 'Read the critical banner telling the technician to telephone', kind: 'verify' },
    { actor: 'lab_technician', title: 'NEGATIVE: release is refused while the critical is unacknowledged', kind: 'negative' },
    { actor: 'lab_technician', title: 'NEGATIVE: Acknowledge stays disabled until the notify box is ticked', kind: 'negative' },
    { actor: 'lab_technician', title: 'Tick the notification box and acknowledge the critical value', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_order_items: the acknowledgement records who and when', kind: 'verify' },
    { actor: 'verify', title: 'Read clinical_alerts: the alert closed when the item was acknowledged', kind: 'verify' },
    { actor: 'lab_technician', title: 'Release the report now that the doctor has been told', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: the released order advanced', kind: 'verify' },
    { actor: 'doctor', title: 'Log in and read the critical result on the patient chart', kind: 'positive' },
    { actor: 'verify', title: 'NEGATIVE: read nabh_evidence_log — the critical notification writes no evidence', kind: 'negative' },
  ],
};

const D002: Journey = {
  id: 'TC-P5D-002',
  section: '5D Result Correctness',
  title: 'Delta check: a 30-day-old baseline, a real swing, and the two false positives',
  priority: 'P1', testType: 'Boundary', smoke: false, timeoutClass: 'single-module',
  roles: ['lab_technician'],
  patient: { kind: 'own' },
  scenario: 'P5-S08',
  crossModule: 'Lab',
  settings: PREREQ,
  why:
    'The delta check catches the result that is individually plausible but impossible for THIS ' +
    'patient in this interval. A creatinine of 4.5 in a patient last seen at 0.9 is acute kidney ' +
    'injury; unflagged it is released as a routine abnormal and found when the patient ' +
    'deteriorates. The false-positive side matters equally — a check that fires on ordinary ' +
    'biological variation flags most of the day and the reviewer stops reading the flags.',
  seeded: ['seedPriorResult() — a validated creatinine dated 30 days ago, which cannot be created in real time'],
  verify:
    'lab_order_items -> result_value saved at all, delta_flag set, previous_value equal to the ' +
    'baseline; clinical_alerts -> a lab_trend row; the sub-50% and first-ever cases carry no ' +
    'delta_flag and no previous_value',
  spec: 'e2e/phase-05-lab-radiology/P5D.result-correctness.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the CKD case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'setup', title: 'Back-date a validated creatinine of 0.9 into lab_order_items, 30 days ago', kind: 'setup' },
    { actor: 'verify', title: 'Read lab_order_items: the baseline is visible to the delta lookup', kind: 'verify' },
    { actor: 'lab_technician', title: 'Open /lab and raise a creatinine order, then take it to the bench', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open the order and switch to the History sub-tab', kind: 'positive' },
    { actor: 'lab_technician', title: 'Confirm the 30-day-old baseline is visible to the technician', kind: 'verify' },
    { actor: 'lab_technician', title: 'Enter the new creatinine of 4.5', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_order_items: the result saved at all', kind: 'verify' },
    { actor: 'verify', title: 'Read lab_order_items: the swing raised delta_flag', kind: 'verify' },
    { actor: 'verify', title: 'Read lab_order_items: previous_value carries the baseline to compare against', kind: 'verify' },
    { actor: 'lab_technician', title: 'Read the delta badge shown beside the result', kind: 'verify' },
    { actor: 'verify', title: 'Read clinical_alerts: a lab_trend alert reached the treating team', kind: 'verify' },
    { actor: 'lab_technician', title: 'NEGATIVE: a delta-flagged result must not auto-verify', kind: 'negative' },
    { actor: 'lab_technician', title: 'Release the flagged result after review', kind: 'positive' },
    { actor: 'lab_technician', title: 'Raise a second creatinine order on the same patient', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: enter a value within 50% of the previous result', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_order_items: ordinary variation is NOT delta-flagged', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Raise a third order for a test this patient has never had', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: enter the first ever result for that test', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_order_items: a first result carries no delta_flag', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_order_items: a first result carries no previous_value', kind: 'boundary' },
  ],
};

const D003: Journey = {
  id: 'TC-P5D-003',
  section: '5D Result Correctness',
  title: 'The result workspace, exhaustively: every sub-tab, every button, every output',
  priority: 'P2', testType: 'Positive', smoke: false, timeoutClass: 'single-module',
  roles: ['lab_technician'],
  patient: { kind: 'own' },
  scenario: 'P5-S09',
  crossModule: 'Lab',
  settings: PREREQ,
  why:
    'The result workspace is where a technician spends the day, and most of it has never been ' +
    'clicked: four sub-tabs, Save All, the notes box that commits on blur, the antibiogram grid, ' +
    'the interpretive comment, the cumulative view, and the two delivery buttons. A control that ' +
    'is broken here is broken for every result the laboratory issues.',
  seeded: [],
  verify:
    'lab_order_items -> values persist from both the numeric and the qualitative input, and from ' +
    'Save All; lab_orders -> notes saved on blur; the antibiogram writes its organism and ' +
    'sensitivities; verification_method is auto for an eligible normal',
  spec: 'e2e/phase-05-lab-radiology/P5D.result-correctness.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'verify', title: 'Read lab_test_master: at least one test is opted into auto-verification', kind: 'verify' },
    { actor: 'lab_technician', title: 'Raise a multi-test order including a culture and take it to the bench', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open the order and read the Results table headers', kind: 'verify' },
    { actor: 'lab_technician', title: 'Read the order header: id, priority chip, ordering doctor and TAT target', kind: 'verify' },
    { actor: 'lab_technician', title: 'Enter a normal value on the auto-verify-eligible test', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_order_items: a normal result auto-verified without a technician', kind: 'verify' },
    { actor: 'verify', title: 'Read lab_order_items: the auto-verification recorded its reason', kind: 'verify' },
    { actor: 'lab_technician', title: 'NEGATIVE: enter an abnormal value and confirm it does NOT auto-verify', kind: 'negative' },
    { actor: 'lab_technician', title: 'Enter a qualitative result from the Positive/Negative dropdown', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_order_items: the qualitative value persisted', kind: 'verify' },
    { actor: 'lab_technician', title: 'Press Save All and read the saved-count toast', kind: 'positive' },
    { actor: 'lab_technician', title: 'Fill the antibiogram specimen type, organism and colony count', kind: 'positive' },
    { actor: 'lab_technician', title: 'Set sensitivities across the antibiogram drug grid', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: Save Antibiogram is refused with no organism named', kind: 'negative' },
    { actor: 'lab_technician', title: 'Save the antibiogram as preliminary, then as final', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_results: the organism and its sensitivities persisted', kind: 'verify' },
    { actor: 'lab_technician', title: 'Write and save an interpretive comment', kind: 'positive' },
    { actor: 'lab_technician', title: 'Switch to the Sample sub-tab and read the custody stepper', kind: 'positive' },
    { actor: 'lab_technician', title: 'Switch to the History sub-tab', kind: 'positive' },
    { actor: 'lab_technician', title: 'Switch to the Notes sub-tab and type lab notes', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: the notes committed on blur, not on change', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Open the Cumulative trend view', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: WhatsApp delivery is refused before the report is released', kind: 'negative' },
    { actor: 'lab_technician', title: 'Release the report', kind: 'positive' },
    { actor: 'lab_technician', title: 'Dispatch Print Report and confirm the popup is offered', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: a released result is read-only, not an editable box', kind: 'boundary' },
    { actor: 'verify', title: 'Read lab_orders: the order is completed with every value intact', kind: 'verify' },
  ],
};

const E001: Journey = {
  id: 'TC-P5E-001',
  section: '5E Validation & Pathology',
  title: 'Dual validation and amendment: two people, two signatures, one corrected record',
  priority: 'P1', testType: 'Negative', smoke: false, timeoutClass: 'cross-module',
  roles: ['lab_technician', 'doctor'],
  patient: { kind: 'own' },
  scenario: 'P5-S10',
  crossModule: 'Lab',
  settings: PREREQ + '; lab_dual_validation_config carries the Biochemistry category',
  why:
    'A two-person control that cannot tell the two people apart is not a control. The submit step ' +
    'must record who submitted, or nothing can compare submitter against validator, and one ' +
    'technician can sign both halves. Amendment is the same argument after the fact: a released ' +
    'result that turns out to be wrong must be correctable with the original retained, because ' +
    'silently overwriting a signed report destroys the record a clinician acted on.',
  seeded: [],
  verify:
    'lab_orders -> status pending_validation after submission, with a recorded submitter; ' +
    'validated_by and validated_at set on sign-off and different from the submitter; the amendment ' +
    'retains the original value alongside the correction',
  spec: 'e2e/phase-05-lab-radiology/P5E.validation-and-pathology.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'verify', title: 'Read lab_dual_validation_config: a dual-validation category is configured', kind: 'verify' },
    { actor: 'lab_technician', title: 'Raise an order mixing a dual-validation test with an ordinary one', kind: 'positive' },
    { actor: 'lab_technician', title: 'Take the sample through to the bench', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open the order and enter every result', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: one dual category flips the WHOLE order into two-person mode', kind: 'boundary' },
    { actor: 'lab_technician', title: 'NEGATIVE: single-step Validate & Release is not offered', kind: 'negative' },
    { actor: 'lab_technician', title: 'Submit the order for pathologist validation', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: the order moved to pending_validation', kind: 'verify' },
    { actor: 'verify', title: 'NEGATIVE: read lab_orders — nobody is recorded as the submitter', kind: 'negative' },
    { actor: 'lab_technician', title: 'NEGATIVE: the submitting technician is still offered the sign-off', kind: 'negative' },
    { actor: 'doctor', title: 'Log in as the pathologist and open the pending order', kind: 'positive' },
    { actor: 'doctor', title: 'Type pathologist notes alongside the sign-off', kind: 'positive' },
    { actor: 'doctor', title: 'Validate and sign the report', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: validated_by and validated_at are stamped', kind: 'verify' },
    { actor: 'verify', title: 'NEGATIVE: nothing proves the validator differed from the submitter', kind: 'negative' },
    { actor: 'lab_technician', title: 'Re-open the released order in the result workspace', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: no amend or reopen control is offered on a released result', kind: 'negative' },
    { actor: 'verify', title: 'NEGATIVE: read lab_order_items — no amendment or version column exists', kind: 'negative' },
    { actor: 'lab_technician', title: 'NEGATIVE: attempt to overwrite the released value in place', kind: 'negative' },
    { actor: 'verify', title: 'Read lab_order_items: whether the signed value can be silently rewritten', kind: 'negative' },
    { actor: 'verify', title: 'Read clinical_alerts: releasing notified the ordering doctor', kind: 'verify' },
  ],
};

const E002: Journey = {
  id: 'TC-P5E-002',
  section: '5E Validation & Pathology',
  title: 'Histopathology: specimen registration to a two-pathologist sign-off',
  priority: 'P1', testType: 'Positive', smoke: false, timeoutClass: 'single-module',
  roles: ['lab_technician', 'doctor'],
  patient: { kind: 'own' },
  scenario: 'P5-S11',
  crossModule: 'Lab',
  settings: PREREQ,
  why:
    'Histopathology is the one place in this product that gets the two-person control right — the ' +
    'first sign-off locks the report content and the second must be a different pathologist. That ' +
    'is the behaviour lab orders are missing, and it has never once been exercised: the ' +
    'Histopathology tab has never been opened by any test.',
  seeded: [],
  verify:
    'pathology_cases -> a registered case with its case number, gross and microscopic text and ' +
    'impression; first_signed_at set by one pathologist and final_signed_at by a different one; ' +
    'the report content is locked between the two',
  spec: 'e2e/phase-05-lab-radiology/P5E.validation-and-pathology.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'lab_technician', title: 'Log in and open /lab -> Histopathology', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open Register and search the patient by UHID', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: Register Specimen is disabled with no patient selected', kind: 'negative' },
    { actor: 'lab_technician', title: 'Select the patient and choose the case type', kind: 'positive' },
    { actor: 'lab_technician', title: 'Fill specimen type, site and clinical history', kind: 'positive' },
    { actor: 'lab_technician', title: 'Register the specimen', kind: 'positive' },
    { actor: 'verify', title: 'Read pathology_cases: the case exists with a case number', kind: 'verify' },
    { actor: 'lab_technician', title: 'Open the case in the pathology workspace', kind: 'positive' },
    { actor: 'lab_technician', title: 'Write the gross description', kind: 'positive' },
    { actor: 'lab_technician', title: 'Write the microscopic description', kind: 'positive' },
    { actor: 'lab_technician', title: 'Save the draft', kind: 'positive' },
    { actor: 'verify', title: 'Read pathology_cases: the draft persisted and is not signed', kind: 'verify' },
    { actor: 'lab_technician', title: 'NEGATIVE: a technician is told sign-off requires a pathologist role', kind: 'rbac' },
    { actor: 'doctor', title: 'Log in as the first pathologist and open the case', kind: 'positive' },
    { actor: 'doctor', title: 'NEGATIVE: signing is refused with an empty impression', kind: 'negative' },
    { actor: 'doctor', title: 'Write the impression and record the first sign-off', kind: 'positive' },
    { actor: 'verify', title: 'Read pathology_cases: first_signed_at is stamped', kind: 'verify' },
    { actor: 'doctor', title: 'BOUNDARY: the report content is locked pending the second signature', kind: 'boundary' },
    { actor: 'doctor', title: 'NEGATIVE: the same pathologist cannot record the final sign-off', kind: 'negative' },
    { actor: 'doctor', title: 'Log in as a second pathologist and record the final sign-off', kind: 'positive' },
    { actor: 'verify', title: 'Read pathology_cases: final_signed_at names a different pathologist', kind: 'verify' },
  ],
};

const F001: Journey = {
  id: 'TC-P5F-001',
  section: '5F External Referral',
  title: 'Referred out and back: five chips, three advances, and the gaps in the register',
  priority: 'P2', testType: 'Negative', smoke: false, timeoutClass: 'single-module',
  roles: ['lab_technician'],
  patient: { kind: 'own' },
  scenario: 'P5-S16',
  crossModule: 'Lab, Billing',
  settings: PREREQ,
  why:
    'A send-out is still the hospital\'s result — the patient was told it would come back here. ' +
    'The register tracks the courier but not the patient: there is no link to the order it ' +
    'replaces, nowhere to record the result when it returns, and no cost, so a referred-out test ' +
    'is a dead end that looks like a workflow.',
  seeded: [],
  verify:
    'external_lab_referrals -> the run-tagged row exists with its lab name, advances through ' +
    'sample_sent and report_awaited to completed, and stamps report_received_at; whether ' +
    'patient_id, an order link and a cost column are populated at all',
  spec: 'e2e/phase-05-lab-radiology/P5F.external-referral.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'lab_technician', title: 'Raise an in-house order for the test that will be sent out', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open /lab -> External Referrals', kind: 'positive' },
    { actor: 'lab_technician', title: 'Read the five status filter chips', kind: 'verify' },
    { actor: 'lab_technician', title: 'Open the New Referral modal', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: create the referral with no lab name and be refused', kind: 'negative' },
    { actor: 'lab_technician', title: 'Fill the lab name, phone, address and expected date', kind: 'positive' },
    { actor: 'lab_technician', title: 'Fill the comma-separated tests ordered', kind: 'positive' },
    { actor: 'lab_technician', title: 'Create the referral', kind: 'positive' },
    { actor: 'verify', title: 'Read external_lab_referrals: the run-tagged referral exists at pending', kind: 'verify' },
    { actor: 'verify', title: 'NEGATIVE: read external_lab_referrals — patient_id is null', kind: 'negative' },
    { actor: 'verify', title: 'NEGATIVE: no column links the referral to the in-house order it replaces', kind: 'negative' },
    { actor: 'verify', title: 'NEGATIVE: read lab_orders — the in-house order was left open', kind: 'negative' },
    { actor: 'lab_technician', title: 'Advance the referral to Sample Sent', kind: 'positive' },
    { actor: 'lab_technician', title: 'Advance the referral to Report Awaited', kind: 'positive' },
    { actor: 'lab_technician', title: 'Advance the referral to Completed', kind: 'positive' },
    { actor: 'verify', title: 'Read external_lab_referrals: report_received_at was stamped', kind: 'verify' },
    { actor: 'lab_technician', title: 'Filter the register by each of the five chips in turn', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: the run-tagged row appears under the right chip only', kind: 'boundary' },
    { actor: 'lab_technician', title: 'NEGATIVE: a completed referral offers nowhere to enter the result', kind: 'negative' },
    { actor: 'verify', title: 'NEGATIVE: the referral carries no cost, so the send-out is unpriced', kind: 'negative' },
    { actor: 'verify', title: 'BOUNDARY: the referral is scoped to the ordering tenant', kind: 'boundary' },
  ],
};

const G001: Journey = {
  id: 'TC-P5G-001',
  section: '5G Instrument Governance',
  title: 'QC: a Westgard violation stops a release, and only a supervisor restarts it',
  priority: 'P1', testType: 'Negative', smoke: false, timeoutClass: 'single-module',
  roles: ['lab_technician', 'doctor'],
  patient: { kind: 'own' },
  scenario: 'P5-S18',
  crossModule: 'Lab, Quality',
  settings: PREREQ,
  why:
    'Quality control is the difference between a number and a result. If the analyser is out of ' +
    'control the value is not trustworthy no matter how normal it looks, and releasing it anyway ' +
    'is how a laboratory issues confidently wrong reports for a whole shift. The override exists ' +
    'because a supervisor sometimes must release anyway — which is precisely why it has to be ' +
    'recorded, attributable and impossible for the bench technician alone.',
  seeded: ['nine prior lab_qc_entries — a Westgard multi-rule needs a run history; the violating tenth run is typed through the UI'],
  verify:
    'lab_qc_entries -> the tenth run is recorded and evaluates to a reject; the release control is ' +
    'blocked on an order for that analyte; the override writes its reason and author and is logged ' +
    'as NABH evidence under QPS.2',
  spec: 'e2e/phase-05-lab-radiology/P5G.instrument-governance.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'setup', title: 'Seed nine in-control prior runs into lab_qc_entries for the analyte', kind: 'setup' },
    { actor: 'lab_technician', title: 'Log in and open /lab -> QC Dashboard', kind: 'positive' },
    { actor: 'lab_technician', title: 'Read the Levey-Jennings chart and the pass badge', kind: 'verify' },
    { actor: 'lab_technician', title: 'Filter the dashboard by test and by analyzer', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open Record QC', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: save an empty QC run and be told to fill all fields', kind: 'negative' },
    { actor: 'lab_technician', title: 'Fill test, analyzer, level, value, mean and SD for an out-of-control run', kind: 'positive' },
    { actor: 'lab_technician', title: 'Save the QC entry', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_qc_entries: the tenth run was recorded', kind: 'verify' },
    { actor: 'lab_technician', title: 'BOUNDARY: the dashboard now shows a reject badge for that analyte', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Raise an order for the same analyte and take it to the bench', kind: 'positive' },
    { actor: 'lab_technician', title: 'Enter a result and read the QC release-gate banner', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: release is blocked while QC is in a reject state', kind: 'negative' },
    { actor: 'verify', title: 'Read lab_orders: the order was not released', kind: 'negative' },
    { actor: 'lab_technician', title: 'NEGATIVE: a bench technician is not offered the supervisor override', kind: 'rbac' },
    { actor: 'doctor', title: 'Log in as the supervising pathologist and open the order', kind: 'positive' },
    { actor: 'doctor', title: 'Open the Supervisor QC Override dialog', kind: 'positive' },
    { actor: 'doctor', title: 'NEGATIVE: the override is refused with no reason typed', kind: 'negative' },
    { actor: 'doctor', title: 'Record the override reason and permit release', kind: 'positive' },
    { actor: 'verify', title: 'Read the order: the override is recorded with its reason', kind: 'verify' },
    { actor: 'doctor', title: 'Release the report under the override', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_orders: the order released only after the override', kind: 'verify' },
    { actor: 'verify', title: 'Read nabh_evidence_log: the QC override was logged as quality evidence', kind: 'verify' },
  ],
};

const G002: Journey = {
  id: 'TC-P5G-002',
  section: '5G Instrument Governance',
  title: 'Calibration and the analyzer wire: NABL record, connector, mapping and an inbound message',
  priority: 'P2', testType: 'Positive', smoke: false, timeoutClass: 'single-module',
  roles: ['lab_technician'],
  patient: { kind: 'own' },
  scenario: 'P5-S19',
  crossModule: 'Lab',
  settings: PREREQ,
  why:
    'NABL wants to see that the analyser was calibrated and that the number on the report came ' +
    'from it. Both screens exist and neither has ever been opened by a test. The mapping is the ' +
    'sharp end: an analyser code that maps to the wrong test files a result against the wrong ' +
    'analyte, and an unmapped code strands the result in an inbox nobody watches.',
  seeded: ['one inbound lab_analyzer_messages row — there is no HL7/ASTM device on the wire in CI; acceptance of it goes through the UI'],
  verify:
    'lab_calibration_records -> the record exists with its dates, type, result and next-due; ' +
    'lab_analyzer_devices -> the connector was saved with its protocol; the test-code mapping ' +
    'exists; posting the inbound message writes the value onto the linked lab_order_items row',
  spec: 'e2e/phase-05-lab-radiology/P5G.instrument-governance.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'lab_technician', title: 'Log in and open /lab -> Calibration (NABL)', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open Add Calibration', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: save with no analyzer name and be refused', kind: 'negative' },
    { actor: 'lab_technician', title: 'Fill analyzer, calibration date, next due date and type', kind: 'positive' },
    { actor: 'lab_technician', title: 'Fill result, deviation, certificate number and calibrated-by', kind: 'positive' },
    { actor: 'lab_technician', title: 'Save the calibration record', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_calibration_records: the NABL record persisted', kind: 'verify' },
    { actor: 'lab_technician', title: 'Read the calibration table columns and the due badges', kind: 'verify' },
    { actor: 'lab_technician', title: 'BOUNDARY: a past next-due date is counted as overdue', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Open /lab -> Analyzer Interface', kind: 'positive' },
    { actor: 'lab_technician', title: 'Open Add Analyzer', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: save with no device name and be refused', kind: 'negative' },
    { actor: 'lab_technician', title: 'Fill device name, manufacturer, model and protocol', kind: 'positive' },
    { actor: 'lab_technician', title: 'Fill host, port and the device secret', kind: 'positive' },
    { actor: 'lab_technician', title: 'Save the analyzer connector', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_analyzer_devices: the connector persisted with its protocol', kind: 'verify' },
    { actor: 'lab_technician', title: 'Open the test-code mappings for the device', kind: 'positive' },
    { actor: 'lab_technician', title: 'NEGATIVE: add a mapping with no code and be refused', kind: 'negative' },
    { actor: 'lab_technician', title: 'Map an analyzer code to a catalogue test', kind: 'positive' },
    { actor: 'verify', title: 'Read the mapping table: the code resolves to the right test', kind: 'verify' },
    { actor: 'lab_technician', title: 'Raise an order for the mapped test and take it to the bench', kind: 'positive' },
    { actor: 'setup', title: 'Deliver an inbound analyzer message carrying that accession', kind: 'setup' },
    { actor: 'lab_technician', title: 'Open the result inbox and select the message', kind: 'positive' },
    { actor: 'lab_technician', title: 'Read the parsed results table and the match status', kind: 'verify' },
    { actor: 'lab_technician', title: 'Post the parsed result onto the order', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_order_items: the analyzer value reached the result', kind: 'verify' },
    { actor: 'lab_technician', title: 'BOUNDARY: an unmatched message cannot be posted', kind: 'boundary' },
  ],
};

const H001: Journey = {
  id: 'TC-P5H-001',
  section: '5H Turnaround',
  title: 'The TAT clock: when it starts, when it breaches, and what the dashboard shows',
  priority: 'P2', testType: 'Boundary', smoke: false, timeoutClass: 'single-module',
  roles: ['lab_technician'],
  patient: { kind: 'own' },
  scenario: 'P5-S20',
  crossModule: 'Lab, Radiology',
  settings: PREREQ,
  why:
    'Turnaround time is the number a hospital advertises to its clinicians and the one an NABH ' +
    'assessor asks to see. It is derived from the collection stamp, so a draw that does not stamp ' +
    'its time makes every TAT figure fiction — and the dashboard that would reveal that has never ' +
    'been opened.',
  seeded: [],
  verify:
    'lab_orders -> tat target read from lab_test_master.tat_minutes; lab_samples.collected_at is ' +
    'what starts the clock; the TAT panel counts the pending order and classes it correctly',
  spec: 'e2e/phase-05-lab-radiology/P5H.turnaround.spec.ts',
  stages: [
    { actor: 'setup', title: 'Provision the case patient and repair any missing lab masters', kind: 'setup' },
    { actor: 'verify', title: 'Read lab_test_master: every test carries a tat_minutes target', kind: 'verify' },
    { actor: 'lab_technician', title: 'Log in and open /lab -> TAT', kind: 'positive' },
    { actor: 'lab_technician', title: 'Load the dashboard and read the four KPI cards', kind: 'positive' },
    { actor: 'lab_technician', title: 'Record the pending count before the journey adds to it', kind: 'verify' },
    { actor: 'lab_technician', title: 'Raise a routine order through the New Lab Order modal', kind: 'positive' },
    { actor: 'lab_technician', title: 'Return to the TAT tab and refresh', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: the new order appears in the pending list', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Read the order target against the catalogue TAT', kind: 'verify' },
    { actor: 'lab_technician', title: 'Collect the sample and stamp the collection time', kind: 'positive' },
    { actor: 'verify', title: 'Read lab_samples: collected_at is what starts the clock', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Open the order and read the TAT chip in the workspace header', kind: 'verify' },
    { actor: 'lab_technician', title: 'Raise a STAT order and confirm its shorter target', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: the STAT order is flagged in the pending list', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Take the routine order through to release', kind: 'positive' },
    { actor: 'lab_technician', title: 'BOUNDARY: a released order leaves the pending TAT list', kind: 'boundary' },
    { actor: 'lab_technician', title: 'Read the released TAT figure in the workspace header', kind: 'verify' },
    { actor: 'lab_technician', title: 'NEGATIVE: an order with no collection stamp has no started clock', kind: 'negative' },
    { actor: 'lab_technician', title: 'Open /radiology -> TAT Dashboard', kind: 'positive' },
    { actor: 'lab_technician', title: 'Read the radiology turnaround panel or record that it is gated', kind: 'verify' },
    { actor: 'verify', title: 'Read lab_orders: the completed order carries both ends of its clock', kind: 'verify' },
  ],
};

/* ── Batch 2 — declared now so the tracker and parity check stay whole ── */

function pending(
  id: string, section: string, title: string, spec: string, scenario: string,
  priority: Journey['priority'], testType: Journey['testType'], smoke: boolean,
  roles: string[], why: string, stages: JourneyStage[],
): Journey {
  return {
    id, section, title, priority, testType, smoke, timeoutClass: 'single-module',
    roles, patient: { kind: 'own' }, scenario, crossModule: 'Radiology', settings: PREREQ,
    why, seeded: [], verify: 'See the stage list — written with the journey in Batch 2.',
    spec, pending: true, stages,
  };
}

const BATCH_2: Journey[] = [
  pending(
    'TC-P5I-001', '5I Radiology Reporting',
    'OPD radiology: the order modal, the viewer, the report and the chart',
    'e2e/phase-05-lab-radiology/P5I.radiology-reporting.spec.ts', 'P5-S12',
    'P1', 'Cross-Module', true, ['doctor', 'radiologist', 'doctor'],
    'Every radiology order in the previous suite was a database insert — NewRadiologyOrderModal ' +
    'has never once been completed by a test, so the path a hospital actually uses to raise a scan ' +
    'is entirely unproven.',
    [
      { actor: 'doctor', title: 'Consult on /opd and prescribe a chest X-ray', kind: 'positive' },
      { actor: 'radiologist', title: 'Open /radiology -> Pending from OPD and raise the order', kind: 'positive' },
      { actor: 'radiologist', title: 'Take payment through the radiology order modal', kind: 'positive' },
      { actor: 'verify', title: 'Read radiology_orders: a billed order with a report shell', kind: 'verify' },
      { actor: 'radiologist', title: 'Start the study and mark images acquired', kind: 'positive' },
      { actor: 'radiologist', title: 'Open the DICOM viewer and exercise the toolbar', kind: 'positive' },
      { actor: 'radiologist', title: 'NEGATIVE: sign the report with an empty impression', kind: 'negative' },
      { actor: 'radiologist', title: 'Write findings and impression, then save a draft', kind: 'positive' },
      { actor: 'radiologist', title: 'Validate and sign the report', kind: 'positive' },
      { actor: 'verify', title: 'Read radiology_reports: signed, with validator and timestamp', kind: 'verify' },
      { actor: 'verify', title: 'BOUNDARY: exactly one radiology charge line, not a second at signing', kind: 'boundary' },
      { actor: 'doctor', title: 'Read the signed report on the patient chart', kind: 'positive' },
    ],
  ),
  pending(
    'TC-P5I-002', '5I Radiology Reporting',
    'Critical imaging finding: the radiologist picks up the phone',
    'e2e/phase-05-lab-radiology/P5I.radiology-reporting.spec.ts', 'P5-S12',
    'P1', 'Positive', false, ['radiologist', 'doctor'],
    'A tension pneumothorax read at 2am reaches the ward only if signing it raises something. ' +
    'A critical imaging finding delivered like a routine chest film is a delay measured in lives.',
    [
      { actor: 'radiologist', title: 'Raise and perform a chest study on /radiology', kind: 'positive' },
      { actor: 'radiologist', title: 'Write an impression describing a tension pneumothorax', kind: 'positive' },
      { actor: 'radiologist', title: 'Mark the finding critical and sign', kind: 'positive' },
      { actor: 'verify', title: 'Read radiology_reports: the report is flagged critical', kind: 'verify' },
      { actor: 'verify', title: 'Read clinical_alerts: a critical_radiology alert reached the team', kind: 'verify' },
      { actor: 'doctor', title: 'Read the critical finding on the patient chart', kind: 'positive' },
      { actor: 'verify', title: 'NEGATIVE: an ordinary report raises no critical alert', kind: 'negative' },
      { actor: 'verify', title: 'BOUNDARY: the alert names the referring doctor', kind: 'boundary' },
      { actor: 'verify', title: 'Read radiology_orders: the study completed after signing', kind: 'verify' },
      { actor: 'verify', title: 'Read nabh_evidence_log: the critical notification is evidenced', kind: 'verify' },
    ],
  ),
  pending(
    'TC-P5I-003', '5I Radiology Reporting',
    'AI impression: the draft is a draft, and the radiologist owns the words',
    'e2e/phase-05-lab-radiology/P5I.radiology-reporting.spec.ts', 'P5-S15',
    'P1', 'Negative', false, ['radiologist'],
    'An AI impression a radiologist did not write, attest and edit is an unsigned opinion on a ' +
    'signed report. What is saved must be the radiologist\'s words, and the attestation must exist.',
    [
      { actor: 'radiologist', title: 'Open /radiology, raise and perform a study, then open the report', kind: 'positive' },
      { actor: 'radiologist', title: 'NEGATIVE: AI Suggest is refused with the findings box empty', kind: 'negative' },
      { actor: 'radiologist', title: 'Write findings and request the AI impression', kind: 'positive' },
      { actor: 'radiologist', title: 'NEGATIVE: Accept is disabled while the attestation is unticked', kind: 'negative' },
      { actor: 'radiologist', title: 'Edit the drafted impression before accepting it', kind: 'positive' },
      { actor: 'radiologist', title: 'Tick the attestation and accept', kind: 'positive' },
      { actor: 'verify', title: 'Read radiology_reports: the saved text is the edited text', kind: 'verify' },
      { actor: 'verify', title: 'Read ai_attestations: edited_before_save and the attester recorded', kind: 'verify' },
      { actor: 'radiologist', title: 'NEGATIVE: dismissing a suggestion leaves the radiologist text intact', kind: 'negative' },
      { actor: 'verify', title: 'NEGATIVE: no raw AI draft is persisted before human review', kind: 'negative' },
      { actor: 'radiologist', title: 'BOUNDARY: with the AI flag off the report still signs', kind: 'boundary' },
    ],
  ),
  pending(
    'TC-P5J-001', '5J PCPNDT',
    'Obstetric USG: Form F, the gate, and the statutory register',
    'e2e/phase-05-lab-radiology/P5J.pcpndt.spec.ts', 'P5-S13',
    'P1', 'Cross-Module', true, ['doctor', 'radiologist'],
    'Form F is statutory. A scan performed without it is an offence under the PCPNDT Act, and the ' +
    'register is what an inspector reads — not the order table.',
    [
      { actor: 'doctor', title: 'Consult on /opd and order an obstetric ultrasound', kind: 'positive' },
      { actor: 'radiologist', title: 'Raise the order and read the PCPNDT warning banner', kind: 'positive' },
      { actor: 'verify', title: 'Read radiology_orders: the study is flagged is_pcpndt', kind: 'verify' },
      { actor: 'radiologist', title: 'NEGATIVE: the study cannot be started before Form F is complete', kind: 'negative' },
      { actor: 'radiologist', title: 'Open the Form F modal and fill every statutory field', kind: 'positive' },
      { actor: 'radiologist', title: 'NEGATIVE: saving is refused without the declaration and consent', kind: 'negative' },
      { actor: 'radiologist', title: 'Tick the no-sex-determination declaration and patient consent', kind: 'positive' },
      { actor: 'radiologist', title: 'Save Form F', kind: 'positive' },
      { actor: 'verify', title: 'Read pcpndt_records: the form number matches PCPNDT-YYYY-NNNN', kind: 'boundary' },
      { actor: 'radiologist', title: 'The gate releases and the study can be started', kind: 'positive' },
      { actor: 'radiologist', title: 'Report and sign the study', kind: 'positive' },
      { actor: 'radiologist', title: 'Open /radiology/pcpndt-register and find the run-tagged entry', kind: 'positive' },
    ],
  ),
  pending(
    'TC-P5J-002', '5J PCPNDT',
    'Non-obstetric USG: the false positive that must not happen',
    'e2e/phase-05-lab-radiology/P5J.pcpndt.spec.ts', 'P5-S14',
    'P1', 'Negative', false, ['radiologist'],
    'A Form F raised on an abdominal scan is a false positive that teaches a centre to click ' +
    'through the statutory form without reading it — which is worse than not having the gate.',
    [
      { actor: 'radiologist', title: 'Raise a non-obstetric abdominal ultrasound', kind: 'positive' },
      { actor: 'verify', title: 'NEGATIVE: read radiology_orders — is_pcpndt is not set', kind: 'negative' },
      { actor: 'verify', title: 'NEGATIVE: read pcpndt_records — no statutory record was created', kind: 'negative' },
      { actor: 'radiologist', title: 'NEGATIVE: no Form F gate blocks the study from starting', kind: 'negative' },
      { actor: 'radiologist', title: 'Start, report and sign the study unimpeded', kind: 'positive' },
      { actor: 'verify', title: 'Read radiology_reports: the study signed without a Form F', kind: 'verify' },
      { actor: 'radiologist', title: 'BOUNDARY: an obstetric study whose name omits "obstetric" IS caught', kind: 'boundary' },
      { actor: 'verify', title: 'Read radiology_study_master: requires_form_f is authoritative', kind: 'boundary' },
      { actor: 'radiologist', title: 'Open /radiology/pcpndt-register and confirm the scan is absent', kind: 'negative' },
      { actor: 'verify', title: 'Read pcpndt_records: the register holds only obstetric studies', kind: 'verify' },
    ],
  ),
  pending(
    'TC-P5K-001', '5K RBAC & Isolation',
    'The role matrix walked as a journey: who gets through which door',
    'e2e/phase-05-lab-radiology/P5K.rbac-and-tenant-isolation.spec.ts', 'P5-Setup',
    'P1', 'RBAC', false, ['lab_technician', 'radiologist', 'nurse', 'receptionist', 'doctor'],
    'A permission gate that fails open is not noticed until somebody sees a chart they should ' +
    'not have. Every role that can reach the module must be able to do its job, and every role ' +
    'that cannot must be stopped at the door rather than at the button.',
    [
      { actor: 'lab_technician', title: 'Reach /lab and work the collection tab', kind: 'rbac' },
      { actor: 'radiologist', title: 'Reach /radiology and the PCPNDT register', kind: 'rbac' },
      { actor: 'receptionist', title: 'NEGATIVE: be blocked from /lab', kind: 'rbac' },
      { actor: 'receptionist', title: 'NEGATIVE: be blocked from /radiology', kind: 'rbac' },
      { actor: 'nurse', title: 'NEGATIVE: not be offered the pathologist sign-off', kind: 'rbac' },
      { actor: 'doctor', title: 'Reach the result workspace and sign off', kind: 'rbac' },
      { actor: 'verify', title: 'Read the lab tab permission map for an ungovernable tab', kind: 'negative' },
      { actor: 'lab_technician', title: 'BOUNDARY: a tab withheld by plan entitlement is not rendered', kind: 'boundary' },
      { actor: 'verify', title: 'Read users: every role under test belongs to Hospital A', kind: 'verify' },
      { actor: 'verify', title: 'Confirm no role reached a route its permission map denies', kind: 'rbac' },
    ],
  ),
  pending(
    'TC-P5K-002', '5K RBAC & Isolation',
    'Tenant isolation: nine tables, one write attempt, one tenant',
    'e2e/phase-05-lab-radiology/P5K.rbac-and-tenant-isolation.spec.ts', 'P5-Setup',
    'P1', 'Cross-Module', false, ['lab_technician'],
    'One leaked row across tenants is a reportable breach under the DPDP Act. RLS is the only ' +
    'thing standing between two hospitals sharing a database, and it has to be proven through a ' +
    'real authenticated session, not a service-role read that bypasses it.',
    [
      { actor: 'setup', title: 'Resolve the Hospital B control patient without creating anything', kind: 'setup' },
      { actor: 'lab_technician', title: 'Sign in as a Hospital A technician and select from lab_orders through the anon client', kind: 'positive' },
      { actor: 'verify', title: 'NEGATIVE: read lab_orders — no Hospital B rows are visible', kind: 'negative' },
      { actor: 'verify', title: 'NEGATIVE: read lab_order_items and lab_samples across tenants', kind: 'negative' },
      { actor: 'verify', title: 'NEGATIVE: read radiology_orders and radiology_reports across tenants', kind: 'negative' },
      { actor: 'verify', title: 'NEGATIVE: read pcpndt_form_f and pcpndt_records across tenants', kind: 'negative' },
      { actor: 'verify', title: 'NEGATIVE: read dicom_files and hospital_pacs_config across tenants', kind: 'negative' },
      { actor: 'lab_technician', title: 'NEGATIVE: attempt to write a lab order into Hospital B', kind: 'negative' },
      { actor: 'verify', title: 'BOUNDARY: every row this run created carries Hospital A hospital_id', kind: 'boundary' },
      { actor: 'verify', title: 'Read lab_orders: the tenant scoping held for the whole journey', kind: 'verify' },
    ],
  ),
  pending(
    'TC-P5L-001', '5L Prerequisites',
    'The gate: the phase cannot be run against a hospital that is not configured for it',
    'e2e/phase-05-lab-radiology/P5L.prerequisites.spec.ts', 'P5-Setup',
    'P1', 'Cross-Module', false, ['hospital_admin'],
    'Migration 20261009000171 deactivates every lab test, and every lookup in the app filters on ' +
    'is_active. On a tenant migrated after seeding, that one state turns into forty red cases ' +
    'across the phase with no common cause visible from any of them. This case is the common cause.',
    [
      { actor: 'setup', title: 'Run the prerequisite provisioner and capture what it had to repair', kind: 'setup' },
      { actor: 'verify', title: 'BOUNDARY: on a seeded tenant the provisioner repairs nothing', kind: 'boundary' },
      { actor: 'verify', title: 'Read lab_test_master: every test has a fee, sample type and TAT', kind: 'verify' },
      { actor: 'verify', title: 'NEGATIVE: no lab test is left inactive and therefore unorderable', kind: 'negative' },
      { actor: 'verify', title: 'Read lab_test_master: critical ranges exist where they are needed', kind: 'verify' },
      { actor: 'verify', title: 'Read lab_test_group_items: the panel has its members linked', kind: 'verify' },
      { actor: 'verify', title: 'Read radiology_study_master: every study has a fee and a modality', kind: 'verify' },
      { actor: 'verify', title: 'Read pcpndt_settings: the machine and doctor registrations are on file', kind: 'verify' },
      { actor: 'verify', title: 'Read hospital_settings: the ancillary policy is set explicitly', kind: 'verify' },
      { actor: 'hospital_admin', title: 'Open /settings/lab and confirm the catalogue is reachable', kind: 'positive' },
      { actor: 'verify', title: 'Read drug_master: Phase 6 has the catalogue its scenarios need', kind: 'verify' },
    ],
  ),
];

export const JOURNEYS: Journey[] = [
  A001, A002, A003,
  B001, B002,
  C001, C002,
  D001, D002, D003,
  E001, E002,
  F001,
  G001, G002,
  H001,
  ...BATCH_2,
];

export function journey(id: string): Journey {
  const j = JOURNEYS.find(x => x.id === id);
  if (!j) throw new Error(`No journey "${id}" in p5-manifest.ts. Case IDs are declared there first.`);
  return j;
}

/**
 * The full test title: `TC-P5A-001 Cash OPD lab: … @smoke`.
 *
 * The case ID leads, because that is what `tracker-reporter.ts` and `qa-parity-check.mjs` both
 * parse off the front. The `@smoke` tag trails, and is appended from the manifest rather than typed
 * into the spec so the tier cannot drift from the tier this file declares — `npm run qa:phase5:smoke`
 * greps for it.
 *
 * The six smoke journeys are the ones that would stop a go-live: the money, the pre-payment gate,
 * the specimen, the critical value, the radiology report and the statutory Form F. About 25
 * minutes, against roughly two hours for the full phase.
 */
export function testTitle(id: string): string {
  const j = journey(id);
  return `${j.id} ${j.title}${j.smoke ? ' @smoke' : ''}`;
}
