#!/usr/bin/env node
// Aumrti security audit — CI guard against the recurring pattern this codebase's migration
// history shows: a table ships in a CREATE TABLE migration, RLS gets forgotten, and it's
// only caught later by a manual audit (see 20260510000001_enable_rls_missing_tables.sql,
// 20260518000006_rls_missing_tables.sql, 20260518000007_rls_open_access_fixes.sql — three
// separate "we found tables without RLS" retrofits). This is a heuristic text scan across all
// migrations, not a live-DB check: it confirms every table CREATEd anywhere in
// supabase/migrations/ has an ENABLE ROW LEVEL SECURITY statement SOMEWHERE (not necessarily
// the same file — retrofitting in a later migration is fine), so a new table can never merge
// silently unprotected the way the ones above did.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

// Tables that are deliberately not RLS-protected. Keep this list short and justify every
// entry — it is the one place this check can be silently defeated.
const ALLOWLIST = new Set([
  // (none yet)
]);

const CREATE_TABLE_RE = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?public\.["']?(\w+)["']?/gi;
// public. prefix is optional — some migrations rely on search_path and just write
// `ALTER TABLE foo ENABLE ROW LEVEL SECURITY` with no schema qualifier.
const ENABLE_RLS_RE = /ALTER TABLE\s+(?:ONLY\s+)?(?:public\.)?["']?(\w+)["']?\s+ENABLE ROW LEVEL SECURITY/gi;
const DROP_TABLE_RE = /DROP TABLE\s+(?:IF EXISTS\s+)?public\.["']?(\w+)["']?/gi;
// A handful of migrations enable RLS on a list of tables via a PL/pgSQL loop:
//   FOR t IN SELECT unnest(ARRAY['a','b','c']) LOOP
//     EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
// A static regex can't see through the dynamic identifier, so when a file contains that
// EXECUTE pattern, every table named in any unnest(ARRAY[...]) in that same file counts.
const DYNAMIC_RLS_LOOP_RE = /EXECUTE\s+format\(\s*['"]ALTER TABLE public\.%I\s+ENABLE ROW LEVEL SECURITY['"]/i;
const UNNEST_ARRAY_RE = /unnest\(\s*ARRAY\s*\[([^\]]+)\]/gi;
const QUOTED_ITEM_RE = /'([^']+)'/g;

function extractNames(text, re) {
  const names = new Set();
  for (const m of text.matchAll(re)) names.add(m[1].toLowerCase());
  return names;
}

function extractDynamicRlsNames(text) {
  const names = new Set();
  if (!DYNAMIC_RLS_LOOP_RE.test(text)) return names;
  for (const arrMatch of text.matchAll(UNNEST_ARRAY_RE)) {
    for (const itemMatch of arrMatch[1].matchAll(QUOTED_ITEM_RE)) {
      names.add(itemMatch[1].toLowerCase());
    }
  }
  return names;
}

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

const created = new Set();
const rlsEnabled = new Set();
const dropped = new Set();

for (const file of files) {
  const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  for (const n of extractNames(text, CREATE_TABLE_RE)) created.add(n);
  for (const n of extractNames(text, ENABLE_RLS_RE)) rlsEnabled.add(n);
  for (const n of extractDynamicRlsNames(text)) rlsEnabled.add(n);
  for (const n of extractNames(text, DROP_TABLE_RE)) dropped.add(n);
}

const missing = [...created]
  .filter((t) => !rlsEnabled.has(t) && !dropped.has(t) && !ALLOWLIST.has(t))
  .sort();

if (missing.length > 0) {
  console.error("RLS coverage check FAILED — tables created without ENABLE ROW LEVEL SECURITY anywhere in supabase/migrations/:");
  for (const t of missing) console.error(`  - ${t}`);
  console.error("\nEvery table storing hospital data needs RLS. If a table is deliberately public/reference-only, add it to ALLOWLIST in scripts/check-rls-coverage.mjs with a comment explaining why.");
  process.exit(1);
}

console.log(`RLS coverage check passed — ${created.size} tables created, all have ENABLE ROW LEVEL SECURITY somewhere in the migration history.`);
