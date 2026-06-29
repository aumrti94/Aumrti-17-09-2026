/**
 * apply-pending-migrations.mjs
 * Applies all pending Supabase migrations directly via the PostgreSQL pooler.
 * Handles individual migration failures gracefully — logs errors and continues.
 *
 * Usage: node scripts/apply-pending-migrations.mjs [--dry-run]
 */

import pg from 'pg';
const { Client: createClient } = pg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations');

// Load DB credentials from .env.local
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
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  const client = new createClient({ connectionString: POOLER_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to database\n');

  // Get already-applied migrations
  const { rows: appliedRows } = await client.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'
  );
  const applied = new Set(appliedRows.map(r => r.version));
  console.log(`Already applied: ${applied.size} migrations\n`);

  // Collect local migration files (timestamp_name.sql pattern only)
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{14}_/.test(f) && f.endsWith('.sql'))
    .sort();

  const pending = files.filter(f => {
    const version = f.replace(/^(\d{14})_.+$/, '$1');
    return !applied.has(version);
  });

  console.log(`Pending migrations: ${pending.length}\n`);
  if (pending.length === 0) { console.log('Nothing to apply.'); await client.end(); return; }

  let successCount = 0;
  let skipCount = 0;
  const failed = [];

  for (const file of pending) {
    const version = file.replace(/^(\d{14})_.+$/, '$1');
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would apply: ${file}`);
      continue;
    }

    process.stdout.write(`Applying ${file}... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      // Record in migration tracking table
      await client.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
         VALUES ($1, $2, ARRAY[$3])
         ON CONFLICT (version) DO NOTHING`,
        [version, file.replace('.sql', ''), sql.substring(0, 500)]
      );
      await client.query('COMMIT');
      console.log('OK');
      successCount++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const msg = err.message.replace(/\n/g, ' ').substring(0, 120);
      console.log(`SKIPPED — ${msg}`);
      failed.push({ file, error: err.message });
      skipCount++;
    }
  }

  await client.end();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Applied:  ${successCount}`);
  console.log(`Skipped:  ${skipCount}`);
  if (failed.length > 0) {
    console.log(`\nFailed migrations (may need manual review):`);
    for (const { file, error } of failed) {
      console.log(`  - ${file}`);
      console.log(`    ${error.split('\n')[0]}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
