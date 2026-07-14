/**
 * gl-audit-2026-07-10.mjs — READ-ONLY historical GL audit (Phase 3 of the Finance
 * gap-fix plan). No writes. Reports orphan counts per module so targeted backfill
 * migrations (following the 20261008000094_backfill_orphaned_expenses.sql pattern)
 * can be scoped to whatever this actually finds — see the plan for why a blind
 * backfill is not safe to run without review first.
 *
 * Background: migration 20261008000091 fixed a journal_entries.entry_type CHECK
 * constraint that had silently rejected any entry_type outside a fixed 8-value
 * list — every `auto_${module}` insert from autoPostJournalEntry()/
 * postMultiLineJournal() for a module outside that list failed with NO trace
 * (no accounting_posting_failures row — that table only logs the separate
 * "no matching rule" failure mode, not a raw insert failure). This script finds
 * source records that should have posted but have neither a journal_entries row
 * nor an accounting_posting_failures row — the exact signature of that bug.
 *
 * Scope covered here:
 *   1. Bills-anchored modules (the majority — lab, radiology, pharmacy, nursing,
 *      dialysis, dental, oncology, ivf, vaccination, blood_bank, ayush, opd,
 *      packages, ot, physio, telemedicine, insurance-billing) — one general query
 *      against `bills`, since they all set posted_to_journal via the same helper.
 *   2. HR payroll summary postings (autoPostJournalEntry sourceModule='hr').
 *   3. Inventory GRN postings (postMultiLineJournal/autoPostJournalEntry
 *      sourceModule='inventory').
 *
 * Explicitly NOT covered (zero exposure or already handled — see plan):
 *   - accounts (expense_records) — already backfilled, migration 094.
 *   - fixed_assets / depreciation — both built today, same day as the constraint
 *     fix; live-verified to have zero rows, nothing to backfill.
 *
 * Separately flagged, NOT part of this audit's query set: PayrollRunTab.tsx's
 * second "detailed" journal_entries insert (src/components/hr/PayrollRunTab.tsx
 * ~line 334) writes to columns that do not exist on journal_entries
 * (journal_number/status/reference_type/reference_id/created_by — the real
 * columns are entry_number/entry_type/source_module/source_id/posted_by) and to
 * a journal_entry_lines table that does not exist (real: journal_line_items).
 * That insert has likely never succeeded, ever — a different, deeper bug than
 * the constraint issue this script audits. Needs its own fix, not a backfill.
 *
 * Usage: node scripts/gl-audit-2026-07-10.mjs
 */

import pg from 'pg';
const { Client: createClient } = pg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, '../.env.local');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const POOLER_URL = `postgresql://postgres.${env.SUPABASE_PROJECT_REF}:${env.SUPABASE_DB_PASSWORD}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`;

async function main() {
  const client = new createClient({ connectionString: POOLER_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to database\n');
  console.log('='.repeat(70));
  console.log('GL AUDIT — orphaned auto-postings (read-only, no writes)');
  console.log('='.repeat(70));

  // ── 1. Bills-anchored modules ──────────────────────────────────────────────
  console.log('\n[1] Finalized bills with no journal entry and no logged failure\n');
  const billsOrphans = await client.query(`
    SELECT b.hospital_id, b.bill_type, count(*) AS orphan_bills,
           sum(b.total_amount)::numeric(14,2) AS orphan_value,
           min(b.created_at)::date AS earliest, max(b.created_at)::date AS latest
    FROM bills b
    WHERE b.bill_status = 'final'
      AND b.posted_to_journal = false
      AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id::text = b.id::text)
      AND NOT EXISTS (SELECT 1 FROM accounting_posting_failures apf WHERE apf.source_id::text = b.id::text)
    GROUP BY b.hospital_id, b.bill_type
    ORDER BY orphan_value DESC;
  `);
  if (billsOrphans.rows.length === 0) {
    console.log('  None found — every finalized bill either posted or has a logged reason why not.');
  } else {
    console.table(billsOrphans.rows);
  }

  // ── 2. HR payroll summary postings ─────────────────────────────────────────
  console.log('\n[2] Approved payroll runs missing an auto_hr journal entry\n');
  const hrOrphans = await client.query(`
    SELECT pr.hospital_id, pr.id AS payroll_run_id, pr.month, pr.year,
           pr.total_net, pr.approved_at
    FROM payroll_runs pr
    WHERE pr.status IN ('approved', 'disbursed')
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.source_id::text = pr.id::text AND je.source_module = 'hr'
      )
      AND NOT EXISTS (SELECT 1 FROM accounting_posting_failures apf WHERE apf.source_id::text = pr.id::text)
    ORDER BY pr.approved_at DESC NULLS LAST;
  `);
  if (hrOrphans.rows.length === 0) {
    console.log('  None found.');
  } else {
    console.table(hrOrphans.rows);
  }

  // ── 3. Inventory GRN postings ───────────────────────────────────────────────
  console.log('\n[3] GRNs missing an auto_inventory journal entry\n');
  const grnOrphans = await client.query(`
    SELECT g.hospital_id, g.id AS grn_id, g.grn_number, g.created_at,
           g.total_amount
    FROM grn_records g
    WHERE NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.source_id::text = g.id::text AND je.source_module = 'inventory'
      )
      AND NOT EXISTS (SELECT 1 FROM accounting_posting_failures apf WHERE apf.source_id::text = g.id::text)
    ORDER BY g.created_at DESC;
  `);
  if (grnOrphans.rows.length === 0) {
    console.log('  None found.');
  } else {
    console.table(grnOrphans.rows);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Reminder: PayrollRunTab.tsx\'s second "detailed" journal insert writes to');
  console.log('columns/tables that do not exist on journal_entries — separate bug, not');
  console.log('covered by this audit. See file header comment for detail.');
  console.log('='.repeat(70));
  console.log('\nReview these results with Ashok before writing any backfill migration —');
  console.log('do not auto-backfill from this script.');

  await client.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
