/**
 * Phase 4 — shared setup and cleanup for the OPD specs.
 *
 * WHY A PURGE HELPER EXISTS AT ALL (same root cause as Phase 3's purge-helpers.ts):
 * nothing in the OPD chain declares ON DELETE CASCADE. `opd_encounters.token_id` references
 * `opd_tokens(id)`, `prescriptions.encounter_id` references `opd_encounters(id)`,
 * `bill_line_items.bill_id` references `bills(id)`, and `bills.encounter_id` references
 * `opd_encounters(id)` — so deleting in the wrong order always fails with an FK violation,
 * and a purge that swallows the error leaves rows behind that poison every later run. This
 * module deletes children first and SURFACES errors instead of hiding them.
 *
 * WHY SOME SETUP IS DONE THROUGH THE SERVICE ROLE RATHER THAN THE UI:
 * the follow-up pricing rules key off a prior visit N days ago (WalkInModal.tsx's
 * `revisitSuggestion` query looks back 30 days for a token with visit_date < today). A test
 * cannot wait seven days, and back-dating through the UI is impossible because visit_date is
 * always `today`. `seedPriorVisit()` inserts that history directly — it is TEST FIXTURE, not
 * the thing under test. Everything the case actually asserts still goes through the browser.
 */
import { db, hospitalIdFor } from '../utils/db-verify';

/* ── Lookups ──────────────────────────────────────────────────────────── */

export async function patientIdByUhid(hospitalId: string, uhid: string): Promise<string> {
  const { data, error } = await db()
    .from('patients').select('id').eq('hospital_id', hospitalId).eq('uhid', uhid).maybeSingle();
  if (error) throw new Error(`Looking up patient ${uhid}: ${error.message}`);
  if (!data) {
    throw new Error(
      `No patient with UHID "${uhid}" in this tenant. Run: npm run qa:seed — ` +
      `Phase 4 reuses the seeded PT-QA-NNNN records rather than creating its own.`,
    );
  }
  return (data as { id: string }).id;
}

export async function userIdByName(hospitalId: string, fullName: string): Promise<string> {
  const { data, error } = await db()
    .from('users').select('id').eq('hospital_id', hospitalId).eq('full_name', fullName).limit(1);
  if (error) throw new Error(`Looking up user "${fullName}": ${error.message}`);
  if (!data?.length) {
    throw new Error(
      `No user named "${fullName}" in this tenant. The doctor names live in ` +
      `mock-data.json's staff array; run npm run qa:seed if the logins were never created.`,
    );
  }
  return (data[0] as { id: string }).id;
}

export async function departmentIdByName(hospitalId: string, name: string): Promise<string> {
  const { data, error } = await db()
    .from('departments').select('id').eq('hospital_id', hospitalId).eq('name', name).limit(1);
  if (error) throw new Error(`Looking up department "${name}": ${error.message}`);
  if (!data?.length) {
    throw new Error(
      `No department "${name}". SETTINGS_PREREQ_MATRIX.md: no departments → no OPD token ` +
      `can be created at all.`,
    );
  }
  return (data[0] as { id: string }).id;
}

/**
 * The fee the app SHOULD charge, resolved the same way ConsultationWorkspace.handleComplete
 * does it: doctor → department → global → the hardcoded ₹500.
 *
 * Returns the tier that won as well as the amount, so a test can assert the app did not
 * silently fall through to the ₹500 default.
 */
export async function expectedConsultationFee(
  hospitalId: string,
  doctorId: string | null,
  departmentId: string | null,
): Promise<{ fee: number; source: 'doctor' | 'dept' | 'global' | 'default' }> {
  const base = () => db().from('service_master').select('fee')
    .eq('hospital_id', hospitalId).eq('item_type', 'consultation').eq('is_active', true);

  if (doctorId) {
    const { data } = await base().eq('doctor_id', doctorId).limit(1);
    if (data?.length && (data[0] as { fee: number }).fee) {
      return { fee: Number((data[0] as { fee: number }).fee), source: 'doctor' };
    }
  }
  if (departmentId) {
    const { data } = await base().eq('department_id', departmentId).is('doctor_id', null).limit(1);
    if (data?.length && (data[0] as { fee: number }).fee) {
      return { fee: Number((data[0] as { fee: number }).fee), source: 'dept' };
    }
  }
  const { data } = await base().is('doctor_id', null).is('department_id', null).limit(1);
  if (data?.length && (data[0] as { fee: number }).fee) {
    return { fee: Number((data[0] as { fee: number }).fee), source: 'global' };
  }
  return { fee: 500, source: 'default' };
}

/* ── Reads a spec asserts against ─────────────────────────────────────── */

export interface BillRow {
  id: string; bill_number: string | null; encounter_id: string | null;
  bill_status: string; payment_status: string;
  total_amount: number; patient_payable: number; balance_due: number;
  discount_amount: number | null; discount_percent: number | null;
  /** Bills carry far more columns than the specs read; keep the rest addressable. */
  [column: string]: unknown;
}

/** Today's OPD bills for a patient, newest first. */
export async function opdBillsToday(hospitalId: string, patientId: string): Promise<BillRow[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await db().from('bills').select('*')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId)
    .eq('bill_type', 'opd').eq('bill_date', today)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Reading today's OPD bills: ${error.message}`);
  return (data ?? []) as BillRow[];
}

export async function lineItems(billId: string, itemType?: string): Promise<Array<Record<string, unknown>>> {
  let q = db().from('bill_line_items').select('*').eq('bill_id', billId);
  if (itemType) q = q.eq('item_type', itemType);
  const { data, error } = await q;
  if (error) throw new Error(`Reading bill_line_items: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function tokensToday(hospitalId: string, patientId: string): Promise<Array<Record<string, unknown>>> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await db().from('opd_tokens').select('*')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId).eq('visit_date', today)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading today's tokens: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function encountersFor(hospitalId: string, patientId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('opd_encounters').select('*')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading opd_encounters: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/* ── Fixture setup ────────────────────────────────────────────────────── */

/**
 * Back-date a completed visit so the follow-up / revisit pricing has history to read.
 *
 * `daysAgo` is measured exactly the way WalkInModal does it —
 * `Math.floor((Date.now() - visit_date) / 86400000)` — so `daysAgo: 7` against a doctor with
 * `validity_days: 7` lands precisely on the inclusive boundary (`daysSince <= validityDays`).
 */
export async function seedPriorVisit(opts: {
  hospitalId: string; patientId: string; doctorId: string; departmentId: string;
  daysAgo: number; status?: string;
}): Promise<string> {
  const visitDate = new Date(Date.now() - opts.daysAgo * 86_400_000).toISOString().split('T')[0];
  const { data, error } = await db().from('opd_tokens').insert({
    hospital_id: opts.hospitalId,
    patient_id: opts.patientId,
    doctor_id: opts.doctorId,
    department_id: opts.departmentId,
    token_number: `QA${Math.floor(Math.random() * 9000) + 1000}`,
    token_prefix: 'QA',
    visit_date: visitDate,
    status: opts.status ?? 'completed',
    priority: 'normal',
    visit_type: 'new',
    visit_purpose: 'new',
    payer_type: 'cash',
  } as never).select('id').maybeSingle();
  if (error) throw new Error(`Seeding a prior visit ${opts.daysAgo} days ago: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Create an OPD slot for a doctor.
 *
 * `qa:seed` does not seed `doctor_slots` — they are generated from Settings → Doctor Schedules,
 * which is Phase 2's territory (SETTINGS_PREREQ_MATRIX.md lists it as an OPD prerequisite).
 * Section 4C creates its own so the appointment cases are self-contained rather than dependent
 * on whoever last configured the tenant.
 */
export async function seedDoctorSlot(opts: {
  hospitalId: string; doctorId: string; departmentId: string;
  slotDate?: string; slotTime: string; maxPatients?: number;
  isBlocked?: boolean; blockReason?: string; slotType?: string;
}): Promise<{ id: string; slot_time: string }> {
  const slotDate = opts.slotDate ?? new Date().toISOString().split('T')[0];
  const { data, error } = await db().from('doctor_slots').insert({
    hospital_id: opts.hospitalId,
    doctor_id: opts.doctorId,
    department_id: opts.departmentId,
    slot_date: slotDate,
    slot_time: opts.slotTime,
    slot_duration_mins: 15,
    max_patients: opts.maxPatients ?? 1,
    booked_count: 0,
    slot_type: opts.slotType ?? 'opd',
    is_blocked: opts.isBlocked ?? false,
    block_reason: opts.blockReason ?? null,
  } as never).select('id, slot_time').maybeSingle();
  if (error) throw new Error(`Seeding a doctor slot at ${opts.slotTime}: ${error.message}`);
  return data as { id: string; slot_time: string };
}

export async function purgeDoctorSlots(hospitalId: string, doctorId: string, slotDate?: string): Promise<void> {
  const date = slotDate ?? new Date().toISOString().split('T')[0];
  const { error } = await db().from('doctor_slots').delete()
    .eq('hospital_id', hospitalId).eq('doctor_id', doctorId).eq('slot_date', date);
  if (error) throw new Error(`Purging doctor slots: ${error.message}`);
}

export async function slotById(slotId: string): Promise<Record<string, unknown> | null> {
  const { data } = await db().from('doctor_slots').select('*').eq('id', slotId).maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

export async function appointmentsFor(hospitalId: string, patientId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('appointments').select('*')
    .eq('hospital_id', hospitalId).eq('patient_id', patientId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading appointments: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/**
 * Give a CGHS/ECHS beneficiary a referral, or take it away. Drives BillEditor's hard block.
 *
 * NOTE ON `patient_id`: BillEditor.handleFinalize looks the beneficiary up by
 * `.eq("patient_id", bill.patient_id)`, but `patient_id` is NOT in the table's CREATE
 * statement (20260901000010) — it is added by a guarded ALTER in 20260521000005, which runs
 * FIRST and therefore skips itself on a database migrated in filename order. `cghsPatientIdColumnExists()`
 * below is what TC-P4D-009 uses to tell "the block correctly fired" apart from "the lookup
 * could not run at all, so the block fires for everyone including patients who DO have a
 * referral".
 */
export async function setCghsReferral(opts: {
  hospitalId: string; patientId: string; beneficiaryName: string; cghsId: string;
  referralDate: string | null; referralHospital?: string;
}): Promise<void> {
  const hasPatientId = await cghsPatientIdColumnExists();
  const payload: Record<string, unknown> = {
    hospital_id: opts.hospitalId,
    cghs_id: opts.cghsId,
    beneficiary_name: opts.beneficiaryName,
    card_type: 'cghs',
    referral_date: opts.referralDate,
    referral_hospital: opts.referralHospital ?? null,
    is_active: true,
  };
  if (hasPatientId) payload.patient_id = opts.patientId;

  const { data } = await db().from('cghs_echs_beneficiaries').select('id')
    .eq('hospital_id', opts.hospitalId).eq('cghs_id', opts.cghsId).limit(1);

  if (data?.length) {
    const { error } = await db().from('cghs_echs_beneficiaries')
      .update(payload as never).eq('id', (data[0] as { id: string }).id);
    if (error) throw new Error(`Updating the CGHS referral: ${error.message}`);
  } else {
    const { error } = await db().from('cghs_echs_beneficiaries').insert(payload as never);
    if (error) throw new Error(`Creating the CGHS beneficiary: ${error.message}`);
  }
}

/** True when `cghs_echs_beneficiaries.patient_id` actually exists on this database. */
export async function cghsPatientIdColumnExists(): Promise<boolean> {
  const { error } = await db().from('cghs_echs_beneficiaries').select('patient_id').limit(1);
  return !error;
}

export async function clearCghsBeneficiaries(hospitalId: string, cghsIds: string[]): Promise<void> {
  if (!cghsIds.length) return;
  const { error } = await db().from('cghs_echs_beneficiaries').delete()
    .eq('hospital_id', hospitalId).in('cghs_id', cghsIds);
  if (error) throw new Error(`Clearing CGHS beneficiaries: ${error.message}`);
}

export interface DiscountRules {
  t1_amount: number; t1_pct: number; t2_amount: number; t2_pct: number;
  t2_roles: string[]; t3_roles: string[];
}

/**
 * The tenant's live discount-approval thresholds.
 *
 * Read from `hospital_settings` rather than hardcoded, because DiscountTab decides the tier
 * with TWO conditions ANDed — `amount <= t1_amount && pct <= t1_pct` — so a percentage alone
 * does not tell you which tier a discount lands in. A test that assumed "15% is below the
 * threshold" would be asserting against MOCK_DATA_BOOK's prose rather than the rules the
 * seeder actually writes.
 */
export async function discountRules(hospitalId: string): Promise<DiscountRules> {
  const fallback: DiscountRules = {
    t1_amount: 500, t1_pct: 5, t2_amount: 2000, t2_pct: 15,
    t2_roles: ['billing_executive'], t3_roles: ['cfo'],
  };
  const { data } = await db().from('hospital_settings').select('value')
    .eq('hospital_id', hospitalId).eq('key', 'discount_approval_rules').maybeSingle();
  const raw = (data as { value?: string } | null)?.value;
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) };
  } catch {
    return fallback;
  }
}

export async function discountApprovalsFor(billId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('bill_discount_approvals').select('*')
    .eq('bill_id', billId).order('created_at', { ascending: false });
  if (error) throw new Error(`Reading bill_discount_approvals: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function paymentsFor(billId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db().from('bill_payments').select('*').eq('bill_id', billId);
  if (error) throw new Error(`Reading bill_payments: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/** Set a patient's category so the CGHS/ECHS branch in BillEditor.handleFinalize is reached. */
export async function setPatientCategory(patientId: string, category: string): Promise<void> {
  const { error } = await db().from('patients').update({ patient_category: category } as never).eq('id', patientId);
  if (error) throw new Error(`Setting patient_category=${category}: ${error.message}`);
}

/* ── Cleanup ──────────────────────────────────────────────────────────── */

/**
 * Delete everything Phase 4 can create for a set of patients, children first.
 *
 * Order matters and is not negotiable — see this file's header. If a NEW table starts
 * referencing opd_encounters / bills / opd_tokens without ON DELETE CASCADE, add it here
 * rather than wrapping the delete in a try/catch: a silent purge failure is exactly what
 * produced the stale-row bugs Phase 3 documents.
 *
 * NOT every child keys on patient_id, and assuming so is what broke the first run:
 *   - `icd_codings` has no patient_id — it keys on `visit_id` (the encounter).
 *   - `pcpndt_form_f` has no patient_id — it keys on `order_id` (the radiology order).
 *   - `lab_samples` / `radiology_reports` reference their order and must precede it.
 * Verify a new pair with a `select` before adding it here rather than after a two-hour run.
 */
export async function purgeOpdArtefacts(hospitalId: string, patientIds: string[]): Promise<void> {
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
        `Purging "${table}" by ${col} failed: ${error.message}. A child table may now ` +
        `reference it without ON DELETE CASCADE — add it to purgeOpdArtefacts() in order.`,
      );
    }
  };

  const encounterIds = await idsOf('opd_encounters', 'patient_id', patientIds);
  const tokenIds = await idsOf('opd_tokens', 'patient_id', patientIds);
  const billIds = await idsOf('bills', 'patient_id', patientIds);
  const labOrderIds = await idsOf('lab_orders', 'patient_id', patientIds);
  const radOrderIds = await idsOf('radiology_orders', 'patient_id', patientIds);

  // Bill children
  await del('bill_discount_approvals', 'bill_id', billIds);
  await del('bill_payments', 'bill_id', billIds);
  await del('bill_line_items', 'bill_id', billIds);

  // Lab: samples and items both reference the order, so both go before it.
  await del('lab_samples', 'lab_order_id', labOrderIds);
  await del('lab_order_items', 'lab_order_id', labOrderIds);
  await del('lab_orders', 'patient_id', patientIds);

  // Radiology: the Form F register and the report both key on order_id — NOT on patient_id,
  // which pcpndt_form_f does not have. Both must go before the order they reference.
  await del('pcpndt_form_f', 'order_id', radOrderIds);
  await del('radiology_reports', 'order_id', radOrderIds);
  await del('radiology_orders', 'patient_id', patientIds);

  // Clinical children of the encounter
  await del('prescriptions', 'patient_id', patientIds);
  // icd_codings keys on the VISIT (the encounter id), not on the patient — it has no
  // patient_id column at all.
  await del('icd_codings', 'visit_id', encounterIds);
  await del('medical_records', 'patient_id', patientIds);
  await del('physio_referrals', 'patient_id', patientIds);
  await del('clinical_alerts', 'patient_id', patientIds);
  await del('patient_acquisition', 'patient_id', patientIds);

  // Bills reference encounters, so they must go before the encounters do.
  await del('bills', 'patient_id', patientIds);
  await del('opd_encounters', 'patient_id', patientIds);
  await del('appointments', 'patient_id', patientIds);
  await del('opd_tokens', 'patient_id', patientIds);
  void tokenIds;
  void hospitalId;
}

/** Convenience: resolve Hospital A and purge a list of UHIDs in one call. */
export async function purgeByUhid(hospitalKey: 'A' | 'B', uhids: string[]): Promise<void> {
  const hid = await hospitalIdFor(hospitalKey);
  const ids: string[] = [];
  for (const uhid of uhids) {
    const { data } = await db().from('patients').select('id')
      .eq('hospital_id', hid).eq('uhid', uhid).maybeSingle();
    if (data) ids.push((data as { id: string }).id);
  }
  await purgeOpdArtefacts(hid, ids);
}
