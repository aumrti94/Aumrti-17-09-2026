#!/usr/bin/env node
/**
 * Aumrti HMS — QA tenant seeder
 * =============================
 * Creates / refreshes the two QA hospitals and all their master data to
 * exactly the values in e2e/fixtures/mock-data.json (documented for humans in
 * docs/qa/MOCK_DATA_BOOK.md).
 *
 *   node scripts/qa-seed.mjs --dry-run     print the plan, touch nothing
 *   node scripts/qa-seed.mjs               seed / refresh the QA tenants
 *   node scripts/qa-seed.mjs --only=A      just Hospital A
 *   node scripts/qa-seed.mjs --verify      report what exists, write nothing
 *
 * SAFETY
 * ------
 * This script uses the service role key, which bypasses RLS. It therefore
 * enforces its own guard rails:
 *
 *   1. It will only ever write to a hospital whose NAME starts with one of the
 *      QA prefixes in mock-data.json (guard.hospitalNamePrefixes).
 *   2. It NEVER issues an unscoped delete or update — every write is filtered
 *      by a resolved QA hospital_id.
 *   3. It refuses to run if a hospital matching a QA name cannot be
 *      distinguished from a real tenant.
 *   4. --dry-run performs no network calls at all, so the plan and the guard
 *      can be inspected safely before anything touches the database.
 *
 * Idempotent: safe to re-run between phases to reset drift.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MOCK_PATH = path.join(ROOT, 'e2e', 'fixtures', 'mock-data.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERIFY_ONLY = argv.includes('--verify');
const ONLY = (argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;

/* Console helpers --------------------------------------------------- */
const c = {
  b: s => `\x1b[1m${s}\x1b[0m`,   dim: s => `\x1b[2m${s}\x1b[0m`,
  g: s => `\x1b[32m${s}\x1b[0m`,  r: s => `\x1b[31m${s}\x1b[0m`,
  y: s => `\x1b[33m${s}\x1b[0m`,  cy: s => `\x1b[36m${s}\x1b[0m`,
};
const ok   = m => console.log(`  ${c.g('✓')} ${m}`);
const info = m => console.log(`  ${c.cy('·')} ${m}`);
const warn = m => console.log(`  ${c.y('!')} ${m}`);
const fail = m => console.log(`  ${c.r('✗')} ${m}`);
function die(msg, detail) {
  console.error(`\n${c.r('ABORTED')} — ${msg}\n`);
  if (detail) console.error(`${detail}\n`);
  process.exit(1);
}

const MOCK = JSON.parse(fs.readFileSync(MOCK_PATH, 'utf8'));
const GUARD = MOCK.guard;

/* ------------------------------------------------------------------ *
 * Guard: is this hospital one of ours to touch?
 * ------------------------------------------------------------------ */
function isQaHospitalName(name) {
  if (!name || typeof name !== 'string') return false;
  return GUARD.hospitalNamePrefixes.some(p => name.startsWith(p));
}

/**
 * Every single write goes through this. If a hospital row does not look like
 * a QA tenant we stop the entire run rather than skipping quietly — a seeder
 * that silently declines to write is indistinguishable from one that worked.
 */
function assertQaHospital(row, context) {
  if (!row) die(`No hospital row resolved while ${context}.`);
  if (!isQaHospitalName(row.name)) {
    die(
      `REFUSING TO WRITE to a non-QA hospital while ${context}.`,
      `  Hospital id   : ${row.id}\n` +
      `  Hospital name : ${row.name}\n\n` +
      `  This script only writes to hospitals whose name starts with:\n` +
      GUARD.hospitalNamePrefixes.map(p => `    - "${p}"`).join('\n') +
      `\n\n  If you genuinely intend to seed a differently-named tenant, change\n` +
      `  guard.hospitalNamePrefixes in e2e/fixtures/mock-data.json first.`,
    );
  }
  return row;
}

/* ------------------------------------------------------------------ *
 * Environment
 * ------------------------------------------------------------------ */
function loadEnvFile(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function resolveEnv() {
  const env = { ...loadEnvFile('.env.local'), ...loadEnvFile('.env.test'), ...process.env };
  return {
    url: env.SUPABASE_TEST_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL || '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    anonKey: env.SUPABASE_TEST_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '',
  };
}

/* ------------------------------------------------------------------ *
 * The plan — printed by --dry-run, executed otherwise
 * ------------------------------------------------------------------ */
function buildPlan() {
  const keys = ONLY ? [ONLY.toUpperCase()] : ['A', 'B'];
  const plan = [];

  for (const k of keys) {
    const h = MOCK.hospitals[k];
    if (!h) die(`Unknown hospital key "${k}". Use --only=A or --only=B.`);

    const staff = MOCK.staff[k] ?? [];
    const patients = MOCK.patients.filter(p => p.hospital === k);
    const isFull = k === 'A';

    const steps = [
      { table: 'hospitals',              n: 1,                       what: `${h.name} (${h.city}, ${h.state}) — plan ${h.plan}` },
      { table: 'auth.users + users',     n: staff.length,            what: `staff logins (${[...new Set(staff.map(s => s.role))].length} distinct roles)` },
      { table: 'departments',            n: isFull ? MOCK.departments.length : 2,        what: 'clinical / diagnostic / support' },
      { table: 'wards',                  n: isFull ? MOCK.wards.length : 1,              what: 'each WITH rate_per_day set' },
      { table: 'beds',                   n: isFull ? MOCK.wards.reduce((a, w) => a + w.bedCount, 0) : 4, what: 'linked to wards, status available' },
      { table: 'shift_master',           n: isFull ? MOCK.shifts.length : 0,             what: 'morning / evening / night' },
      { table: 'service_master',         n: isFull ? MOCK.services.length + MOCK.doctorFees.length : 1, what: 'services + per-doctor consultation fees' },
      { table: 'drug_master',            n: isFull ? MOCK.drugs.length : 0,              what: 'incl. 2 NDPS and 1 Schedule H1' },
      { table: 'drug_batches',           n: isFull ? MOCK.drugBatches.length + (MOCK.drugs.length - new Set(MOCK.drugBatches.map(b => b.drug)).size) : 0, what: 'incl. 1 expired + 1 quarantined + FEFO pair' },
      { table: 'lab_test_master',        n: isFull ? MOCK.labTests.length : 0,           what: 'with fee, sample type and normal ranges' },
      { table: 'lab_test_groups',        n: isFull ? MOCK.labTestGroups.length : 0,      what: 'Fever Panel at a group price' },
      { table: 'radiology_modalities',   n: isFull ? MOCK.radiologyModalities.length : 0,what: 'created BEFORE studies' },
      { table: 'radiology_study_master', n: isFull ? MOCK.radiologyStudies.length : 0,   what: 'incl. 2 obstetric variants for the PCPNDT test' },
      { table: 'payer_masters',          n: isFull ? MOCK.payers.length : 0,             what: 'self / TPA / govt / corporate with ceilings' },
      { table: 'hospital_config_values', n: isFull ? Object.values(MOCK.configValues).reduce((a, v) => a + v.length, 0) : 0, what: 'drug routes + frequencies, one row per value' },
      { table: 'hospital_settings',      n: isFull ? 2 : 0,                              what: 'discount approval rules + IPD ancillary payment' },
      { table: 'patients',               n: patients.length,         what: `${GUARD.uhidPrefix}NNNN synthetic records` },
    ].filter(s => s.n > 0);

    plan.push({ key: k, hospital: h, steps, patients });
  }
  return plan;
}

function printPlan(plan, env) {
  console.log(`\n${c.b('Aumrti HMS — QA tenant seeder')}${DRY_RUN ? c.y('   [DRY RUN — nothing will be written]') : ''}\n`);

  console.log(c.b('  Target'));
  info(`Supabase URL     ${env.url || c.r('(not set)')}`);
  info(`Service role key ${env.serviceKey ? c.g('present') : c.r('(not set)')}`);
  console.log('');

  console.log(c.b('  Guard rails'));
  info('Will ONLY write to hospitals whose name starts with:');
  GUARD.hospitalNamePrefixes.forEach(p => console.log(`      ${c.g('•')} "${p}"`));
  info(`Patients seeded with UHID prefix  ${GUARD.uhidPrefix}`);
  info(`Logins seeded with email prefix   ${GUARD.emailPrefixes.join(', ')}`);
  info('No unscoped delete or update is ever issued.');
  console.log('');

  let grand = 0;
  for (const { key, hospital, steps } of plan) {
    console.log(c.b(`  Hospital ${key} — ${hospital.name}`));
    for (const s of steps) {
      grand += s.n;
      console.log(`      ${String(s.n).padStart(4)}  ${s.table.padEnd(26)} ${c.dim(s.what)}`);
    }
    console.log('');
  }
  console.log(`  ${c.b('Total rows to create/refresh:')} ${grand}\n`);
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */
async function getClient(env) {
  if (!env.url)        die('No Supabase URL.', '  Set SUPABASE_TEST_URL in .env.test (see .env.example).');
  if (!env.serviceKey) die('No service role key.', '  Set SUPABASE_SERVICE_ROLE_KEY in .env.test (see .env.example).');

  let createClient;
  try {
    ({ createClient } = await import('@supabase/supabase-js'));
  } catch {
    die('@supabase/supabase-js could not be imported.', '  Run: npm install');
  }
  return createClient(env.url, env.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Resolve a QA hospital by name. Never creates one silently in --verify. */
async function resolveHospital(db, h, { create }) {
  const { data, error } = await db
    .from('hospitals').select('id, name').eq('name', h.name).maybeSingle();
  if (error) die(`Could not query hospitals: ${error.message}`);

  if (data) return assertQaHospital(data, `resolving Hospital ${h.key}`);
  if (!create) return null;

  // Creating is itself guarded — the name we are about to insert must be a QA name.
  if (!isQaHospitalName(h.name)) {
    die(`Refusing to create a hospital named "${h.name}" — it is not a QA name.`);
  }
  const { data: made, error: insErr } = await db
    .from('hospitals')
    .insert({
      name: h.name, address: [h.address1, h.address2].filter(Boolean).join(', '),
      city: h.city, state: h.state, pincode: h.pincode,
      phone: h.phone, gstin: h.gstin || null, email: h.adminEmail,
    })
    .select('id, name').single();
  if (insErr) die(`Could not create Hospital ${h.key}: ${insErr.message}`);
  return assertQaHospital(made, `creating Hospital ${h.key}`);
}

/**
 * Insert-or-update helper, keyed by natural columns rather than a real DB
 * unique constraint. Several QA target tables (lab_test_master,
 * radiology_modalities, beds, ...) have no unique constraint PostgREST can
 * use as an ON CONFLICT target, so a genuine upsert() 400s with "no unique or
 * exclusion constraint matching the ON CONFLICT specification". Reading the
 * existing rows first and branching insert vs. update sidesteps that
 * entirely and needs nothing more than hospital_id scoping to stay safe.
 *
 * Every call is hospital-scoped by construction: `rows` must already carry
 * hospital_id, and we assert that before sending.
 */
async function upsertByKey(db, table, rows, keyCols, hospitalId) {
  if (!rows.length) return 0;
  const stray = rows.filter(r => r.hospital_id !== hospitalId);
  if (stray.length) {
    die(`Internal guard tripped: ${stray.length} row(s) for "${table}" carry the wrong hospital_id.`);
  }

  const { data: existing, error: selErr } = await db
    .from(table).select(['id', ...keyCols].join(',')).eq('hospital_id', hospitalId);
  if (selErr) { warn(`${table}: ${selErr.message}`); return 0; }

  const keyOf = row => keyCols.map(k => String(row[k])).join('');
  const existingId = new Map((existing ?? []).map(r => [keyOf(r), r.id]));

  const toInsert = [];
  const toUpdate = [];
  for (const row of rows) {
    const id = existingId.get(keyOf(row));
    if (id) toUpdate.push({ id, ...row });
    else toInsert.push(row);
  }

  let n = 0;
  if (toInsert.length) {
    const { data, error } = await db.from(table).insert(toInsert).select('id');
    if (error) warn(`${table} insert: ${error.message}`);
    else n += data.length;
  }
  for (const { id, ...rest } of toUpdate) {
    const { error } = await db.from(table).update(rest).eq('id', id);
    if (error) warn(`${table} update ${id}: ${error.message}`);
    else n++;
  }
  return n;
}

// mock-data.json's own vocabulary doesn't match these DB-level CHECK/ENUM constraints
// (verified live: department_type = clinical|administrative|support, ward_type has no
// "deluxe", drug_master.schedule_type has no "NDPS" — NDPS drugs are Schedule X under the
// Drugs and Cosmetics Rules, payer_masters.payer_type has no "self"/"govt"). Map at the
// seed boundary rather than touching the fixture file, which is the human-readable source
// of truth other docs already cite by these exact values.
const DEPARTMENT_TYPE = { clinical: 'clinical', diagnostic: 'clinical', support: 'support' };
const WARD_TYPE = { general: 'general', semi_private: 'semi_private', private: 'private', deluxe: 'private', icu: 'icu' };
const DRUG_SCHEDULE_TYPE = { OTC: 'OTC', H: 'H', H1: 'H1', NDPS: 'X' };
function payerType(p) {
  if (p.type === 'tpa') return 'tpa';
  if (p.type === 'corporate') return 'corporate';
  if (p.type === 'self') return 'cash';
  if (/pmjay/i.test(p.name)) return 'pmjay';
  if (/cghs/i.test(p.name)) return 'cghs';
  return 'other'; // ECHS and anything else govt-but-unclassified
}

/** 22:00 -> 06:00 must read as 8h, not -16h. */
function shiftDurationHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

async function seedHospital(db, key) {
  const h = MOCK.hospitals[key];
  const isFull = key === 'A';
  console.log(c.b(`\n  Hospital ${key} — ${h.name}`));

  const hospital = await resolveHospital(db, h, { create: true });
  const hid = hospital.id;
  ok(`hospital resolved  ${c.dim(hid)}`);

  const departments = isFull ? MOCK.departments : MOCK.departments.slice(0, 2);
  const wards = isFull ? MOCK.wards : MOCK.wards.slice(0, 1);

  let n;
  n = await upsertByKey(db, 'departments',
    departments.map(d => ({ hospital_id: hid, name: d.name, type: DEPARTMENT_TYPE[d.type] ?? 'clinical', is_active: true })),
    ['name'], hid);
  if (n) ok(`departments        ${n}`);

  const { data: deptRows } = await db
    .from('departments').select('id, name').eq('hospital_id', hid);
  const deptId = Object.fromEntries((deptRows ?? []).map(d => [d.name, d.id]));

  n = await upsertByKey(db, 'wards',
    wards.map(w => ({
      hospital_id: hid, name: w.name, type: WARD_TYPE[w.category] ?? 'general',
      rate_per_day: w.ratePerDay, total_beds: isFull ? w.bedCount : 4, is_active: true,
    })),
    ['name'], hid);
  if (n) ok(`wards              ${n}  ${c.dim('(all with rate_per_day)')}`);

  const { data: wardRows } = await db
    .from('wards').select('id, name').eq('hospital_id', hid);
  const wardId = Object.fromEntries((wardRows ?? []).map(w => [w.name, w.id]));

  const beds = [];
  for (const w of wards) {
    for (let i = 1; i <= (isFull ? w.bedCount : 4); i++) {
      beds.push({
        hospital_id: hid, ward_id: wardId[w.name] ?? null,
        bed_number: `${w.bedPrefix}-${String(i).padStart(2, '0')}`,
        bed_category: WARD_TYPE[w.category] ?? 'general', status: 'available', is_active: true,
      });
    }
  }
  n = await upsertByKey(db, 'beds', beds, ['bed_number'], hid);
  if (n) ok(`beds               ${n}`);

  if (!isFull) {
    n = await upsertByKey(db, 'patients',
      MOCK.patients.filter(p => p.hospital === key).map(p => patientRow(p, hid)),
      ['uhid'], hid);
    if (n) ok(`patients           ${n}`);
    info('Hospital B is deliberately minimal — it exists to prove isolation.');
    return;
  }

  n = await upsertByKey(db, 'shift_master',
    MOCK.shifts.map(s => ({
      hospital_id: hid, shift_name: s.name, shift_code: s.name.slice(0, 3).toUpperCase(),
      start_time: s.start, end_time: s.end,
      duration_hours: shiftDurationHours(s.start, s.end),
      shift_type: s.name.toLowerCase(), is_active: true,
    })),
    ['shift_name'], hid);
  if (n) ok(`shift_master       ${n}`);

  n = await upsertByKey(db, 'service_master',
    MOCK.services.map(s => ({
      hospital_id: hid, name: s.name, category: s.category,
      fee: s.rate, gst_applicable: s.gstApplicable, gst_percent: s.gstPercent,
      hsn_code: s.hsn, is_active: true,
    })),
    ['name'], hid);
  if (n) ok(`service_master     ${n}  ${c.dim('(all with HSN)')}`);

  // Per-doctor consultation fees. Needs the doctor's users.id and the
  // department's id, both resolved by name against what was just seeded.
  const { data: userRows } = await db
    .from('users').select('id, full_name').eq('hospital_id', hid);
  const doctorId = Object.fromEntries((userRows ?? []).map(u => [u.full_name, u.id]));

  const feeRows = MOCK.doctorFees
    .filter(f => doctorId[f.doctor])
    .map(f => ({
      hospital_id: hid, name: `${f.doctor} Consultation`, category: 'consultation',
      fee: f.consultation, follow_up_fee: f.followUp, emergency_fee: f.emergency,
      ipd_consultation_fee: f.ipdVisit, validity_days: f.validityDays,
      doctor_id: doctorId[f.doctor], department_id: deptId[f.department] ?? null,
      gst_applicable: false, gst_percent: 0, is_active: true,
    }));
  const skippedDoctors = MOCK.doctorFees.filter(f => !doctorId[f.doctor]).map(f => f.doctor);
  n = await upsertByKey(db, 'service_master', feeRows, ['doctor_id'], hid);
  if (n) ok(`service_master     ${n}  ${c.dim('(per-doctor consultation fees)')}`);
  if (skippedDoctors.length) {
    warn(`per-doctor fees skipped — no users row for: ${skippedDoctors.join(', ')} ` +
      `(staff logins are created separately; see the note at the end of this run)`);
  }

  n = await upsertByKey(db, 'drug_master',
    MOCK.drugs.map(d => ({
      hospital_id: hid, drug_name: d.brand, generic_name: d.generic,
      dosage_forms: [d.form], standard_doses: [d.strength],
      drug_schedule: d.schedule, schedule_type: DRUG_SCHEDULE_TYPE[d.schedule] ?? 'other',
      is_ndps: d.schedule === 'NDPS', gst_percent: d.gst, is_active: true,
    })),
    ['drug_name'], hid);
  if (n) ok(`drug_master        ${n}  ${c.dim('(2 NDPS, 1 Schedule H1)')}`);

  const { data: drugRows } = await db
    .from('drug_master').select('id, drug_name').eq('hospital_id', hid);
  const drugId = Object.fromEntries((drugRows ?? []).map(d => [d.drug_name, d.id]));

  const explicit = new Set(MOCK.drugBatches.map(b => b.drug));
  const batches = [
    ...MOCK.drugBatches,
    ...MOCK.drugs.filter(d => !explicit.has(d.brand)).map(d => ({
      drug: d.brand,
      batch: `${GUARD.batchPrefix}${d.brand.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}-A`,
      qty: MOCK.defaultBatch.qty, expiry: MOCK.defaultBatch.expiry, status: MOCK.defaultBatch.status,
    })),
  ].filter(b => drugId[b.drug]);

  n = await upsertByKey(db, 'drug_batches',
    batches.map(b => {
      const d = MOCK.drugs.find(x => x.brand === b.drug);
      return {
        hospital_id: hid, drug_id: drugId[b.drug], batch_number: b.batch,
        quantity_received: b.qty, quantity_available: b.qty,
        expiry_date: b.expiry, status: b.status,
        cost_price: Math.round((d?.mrp ?? 0) * 0.7 * 100) / 100,
        mrp: d?.mrp ?? 0, sale_price: d?.mrp ?? 0, gst_percent: d?.gst ?? 12,
        is_active: true,
      };
    }),
    ['batch_number'], hid);
  if (n) ok(`drug_batches       ${n}  ${c.dim('(1 expired, 1 quarantined, FEFO pair)')}`);

  n = await upsertByKey(db, 'lab_test_master',
    MOCK.labTests.map(t => ({
      hospital_id: hid, test_name: t.name, test_code: t.code,
      sample_type: t.sampleType, fee: t.fee, unit: t.unit || null,
      normal_min: t.normalMin, normal_max: t.normalMax,
      tat_minutes: t.tatMinutes, is_active: true,
    })),
    ['test_name'], hid);
  if (n) ok(`lab_test_master    ${n}  ${c.dim('(with fees + normal ranges)')}`);

  n = await upsertByKey(db, 'lab_test_groups',
    MOCK.labTestGroups.map(g => ({
      hospital_id: hid, group_name: g.name,
      group_code: g.name.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase(),
      category: 'panel', fee: g.fee,
      tat_minutes: Math.max(...g.members.map(code =>
        MOCK.labTests.find(t => t.code === code)?.tatMinutes ?? 0)),
      is_active: true,
    })),
    ['group_code'], hid);
  if (n) ok(`lab_test_groups    ${n}  ${c.dim('(Fever Panel at a group price)')}`);

  n = await upsertByKey(db, 'radiology_modalities',
    MOCK.radiologyModalities.map(m => ({
      hospital_id: hid, name: m.name, modality_type: m.type, is_active: true,
    })),
    ['name'], hid);
  if (n) ok(`radiology_modalities ${n}`);

  const { data: modRows } = await db
    .from('radiology_modalities').select('id, name, modality_type').eq('hospital_id', hid);
  const modId = Object.fromEntries((modRows ?? []).map(m => [m.name, m.id]));
  const modType = Object.fromEntries((modRows ?? []).map(m => [m.name, m.modality_type]));

  n = await upsertByKey(db, 'radiology_study_master',
    MOCK.radiologyStudies.map(s => ({
      hospital_id: hid, study_name: s.name, modality_id: modId[s.modality] ?? null,
      modality_type: modType[s.modality] ?? null,
      fee: s.fee, sort_order: s.sortOrder, is_active: true,
    })),
    ['study_name'], hid);
  if (n) ok(`radiology_studies  ${n}  ${c.dim('(2 obstetric variants for PCPNDT)')}`);

  n = await upsertByKey(db, 'payer_masters',
    MOCK.payers.map(p => ({
      hospital_id: hid, payer_name: p.name, payer_type: payerType(p), is_active: true,
    })),
    ['payer_name'], hid);
  if (n) ok(`payer_masters      ${n}`);
  warn(
    'payer_masters has no room_rent_ceiling / co_payment_value / deductible columns in the ' +
    'live schema — MOCK.payers.roomCeiling/coPayPercent/deductible are NOT written anywhere. ' +
    'Any case asserting a payer ceiling from the database (e.g. the HDFC ERGO ₹4,000/day ' +
    'ceiling) needs that finding resolved before it can pass.',
  );

  const configRows = [];
  for (const [category, values] of Object.entries(MOCK.configValues)) {
    values.forEach((value, i) => configRows.push({
      hospital_id: hid, category, value, label: value, sort_order: i, is_active: true,
    }));
  }
  n = await upsertByKey(db, 'hospital_config_values', configRows, ['category', 'value'], hid);
  if (n) ok(`hospital_config_values ${n}  ${c.dim('(drug routes + frequencies, one row per value)')}`);

  // Matches the shape SettingsApprovalsPage / IPD_ANCILLARY_POLICY_KEY actually read/write.
  n = await upsertByKey(db, 'hospital_settings',
    [
      {
        hospital_id: hid, key: 'discount_approval_rules',
        value: JSON.stringify({
          t1_amount: 500, t1_pct: 5, t2_amount: 2000, t2_pct: 15,
          t2_roles: ['billing_executive'], t3_roles: ['cfo'],
        }),
      },
      {
        hospital_id: hid, key: 'ipd_ancillary_payment',
        value: JSON.stringify({
          pharmacy: { mode: 'post_paid', receipt: 'consolidated' },
          lab: { mode: 'post_paid', receipt: 'consolidated' },
          radiology: { mode: 'post_paid', receipt: 'consolidated' },
        }),
      },
    ],
    ['key'], hid);
  if (n) ok(`hospital_settings  ${n}  ${c.dim('(discount approval rules + IPD ancillary payment)')}`);

  n = await upsertByKey(db, 'patients',
    MOCK.patients.filter(p => p.hospital === key).map(p => patientRow(p, hid)),
    ['uhid'], hid);
  if (n) ok(`patients           ${n}  ${c.dim('(incl. allergy, CGHS, obstetric, duplicate)')}`);
}

function patientRow(p, hid) {
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - p.age);
  return {
    hospital_id: hid, uhid: p.uhid, full_name: p.name,
    gender: p.sex, dob: dob.toISOString().slice(0, 10),
    phone: p.phone || null,
    allergies: p.allergies?.length ? p.allergies.join(', ') : null,
    is_active: true,
  };
}

async function verify(db) {
  console.log(c.b('\n  Verify — reporting only, nothing written\n'));
  for (const key of (ONLY ? [ONLY.toUpperCase()] : ['A', 'B'])) {
    const h = MOCK.hospitals[key];
    const row = await resolveHospital(db, h, { create: false });
    if (!row) { fail(`Hospital ${key} "${h.name}" — not found. Run without --verify to create it.`); continue; }
    ok(`Hospital ${key} "${h.name}"  ${c.dim(row.id)}`);
    for (const t of ['departments', 'wards', 'beds', 'shift_master', 'service_master',
                     'drug_master', 'drug_batches', 'lab_test_master', 'lab_test_groups',
                     'radiology_modalities', 'radiology_study_master',
                     'payer_masters', 'hospital_config_values', 'hospital_settings', 'patients']) {
      const { count, error } = await db
        .from(t).select('*', { count: 'exact', head: true }).eq('hospital_id', row.id);
      if (error) warn(`${t.padEnd(24)} ${error.message}`);
      else info(`${t.padEnd(24)} ${count ?? 0}`);
    }
    console.log('');
  }
}

/* ------------------------------------------------------------------ */
async function main() {
  const env = resolveEnv();
  const plan = buildPlan();

  printPlan(plan, env);

  if (DRY_RUN) {
    console.log(`  ${c.y('Dry run — no connection was opened and nothing was written.')}`);
    console.log(`  ${c.dim('Re-run without --dry-run to apply.')}\n`);
    return;
  }

  const db = await getClient(env);

  if (VERIFY_ONLY) { await verify(db); return; }

  console.log(c.b('  Seeding'));
  for (const { key } of plan) await seedHospital(db, key);

  console.log(`\n  ${c.g('Done.')}`);
  console.log(`  ${c.dim('Staff logins are NOT created by this script — create them through')}`);
  console.log(`  ${c.dim('Settings → Staff → Enable Login, which is itself Phase 1 section 1D.')}`);
  console.log(`  ${c.dim('Run with --verify to see row counts.')}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
