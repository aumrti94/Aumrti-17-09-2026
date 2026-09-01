#!/usr/bin/env node
// Aumrti CI guard — application <-> database contract.
//
// Exists because of the defect class documented in docs/db-audit/13_AI_CODE_DRIFT_FINDINGS.md:
// twenty `.from("...")` calls and six `.rpc("...")` calls named objects that did not exist. They
// survived review because Supabase returns errors as VALUES rather than throwing, so an
// uninspected `await` fails silently, and because types.ts was stale (98 live tables missing),
// so TypeScript could not contradict the wrong names.
//
// Concrete failures that reached production undetected:
//   * payroll wrote GL lines to "journal_entry_lines" (real table: journal_line_items) and
//     reported success, so payroll never reached the ledger at all;
//   * the sepsis 4-hour de-duplication guard read a table that did not exist, so it never
//     suppressed anything and duplicate critical alerts fired on every vitals entry;
//   * HCX claims were submitted with an empty item list because "bill_items" is bill_line_items.
//
// This check is purely static: it compares identifiers used in application code against the
// generated types.ts. It needs no database connection, so it runs anywhere CI runs. Keeping
// types.ts regenerated is therefore load-bearing — see check 3 below.

// Check 1 has one blind spot: it cannot tell a typo from a table that is real but whose migration
// has not been applied yet. Both look identical — a name types.ts has never heard of. Since a
// migration and the code that uses it normally land in the same change, that made every such pull
// request fail with advice ("regenerate types.ts") that cannot be followed until after the
// migration is pushed.
//
// So the migration history is parsed too, the same way check-rls-coverage.mjs already does it. A
// name that appears in a CREATE TABLE is PENDING — reported, not fatal. A name that appears
// nowhere is still a hard failure, which is the case this check was built for.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const TYPES = join(ROOT, "src", "integrations", "supabase", "types.ts");
const SCAN_DIRS = ["src", "supabase/functions", "e2e", "scripts"];

// Names that are NOT postgres relations and must not be reported as missing tables.
// `supabase.storage.from("<bucket>")` shares the `.from(` shape with the query builder.
const STORAGE_BUCKETS = new Set(["dicom", "avatars", "documents", "reports", "logos", "attachments"]);

// ── parse types.ts ────────────────────────────────────────────────────────────────────────────
const types = readFileSync(TYPES, "utf8");
const publicStart = types.indexOf("\n  public: {");
if (publicStart < 0) {
  console.error("check-db-contract: could not locate the `public` schema block in types.ts");
  process.exit(1);
}
const sectionBounds = (label) => {
  const open = types.indexOf(`\n    ${label}: {`, publicStart);
  return open < 0 ? null : open;
};
const tablesAt = sectionBounds("Tables");
const viewsAt = sectionBounds("Views");
const fnsAt = sectionBounds("Functions");
const enumsAt = sectionBounds("Enums");

const namesIn = (from, to) =>
  new Set([...types.slice(from, to).matchAll(/^ {6}([a-z0-9_]+): \{/gm)].map((m) => m[1]));

const knownTables = namesIn(tablesAt, viewsAt);
const knownViews = namesIn(viewsAt, fnsAt);
const knownFns = namesIn(fnsAt, enumsAt);
const relations = new Set([...knownTables, ...knownViews]);

// ── parse the migration history ───────────────────────────────────────────────────────────────
// Comments are stripped first for the same reason check-rls-coverage.mjs strips them: an
// unqualified pattern otherwise matches prose, and "-- CREATE TABLE silently fails when ..."
// would register a table named "silently".
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const stripSqlComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const migratedTables = new Set();
const migratedFns = new Set();
try {
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?["']?(\w+)["']?/gi)) {
      migratedTables.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/CREATE (?:OR REPLACE )?(?:VIEW|MATERIALIZED VIEW)\s+(?:IF NOT EXISTS\s+)?(?:public\.)?["']?(\w+)["']?/gi)) {
      migratedTables.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?["']?(\w+)["']?/gi)) {
      migratedFns.add(m[1].toLowerCase());
    }
  }
} catch {
  // No migrations directory is not this check's problem to report.
}

// ── scan application code ─────────────────────────────────────────────────────────────────────
function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/^(node_modules|dist|coverage|\.git|_shared)$/.test(e.name)) walk(p, acc);
    } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

const badTables = [];
const badFns = [];
// Real, but the migration has not reached a database yet, so types.ts cannot know about it.
const pendingTables = [];
const pendingFns = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  // Strip comments so prose describing a historical bug ("used to write to journal_entry_lines")
  // is not mistaken for a live call site.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");

  for (const m of code.matchAll(/(\.storage)?\s*\.from\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g)) {
    const isStorage = Boolean(m[1]) || STORAGE_BUCKETS.has(m[2]);
    if (isStorage) continue;
    if (!relations.has(m[2])) {
      const line = code.slice(0, m.index).split("\n").length;
      const where = `${rel}:${line}  .from("${m[2]}")`;
      if (migratedTables.has(m[2].toLowerCase())) pendingTables.push(where);
      else badTables.push(where);
    }
  }
  for (const m of code.matchAll(/\.rpc\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g)) {
    if (!knownFns.has(m[1])) {
      const line = code.slice(0, m.index).split("\n").length;
      const where = `${rel}:${line}  .rpc("${m[1]}")`;
      if (migratedFns.has(m[1].toLowerCase())) pendingFns.push(where);
      else badFns.push(where);
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────────────────────────
let failed = false;

if (badTables.length) {
  failed = true;
  console.error(`\ncheck-db-contract FAILED — ${badTables.length} reference(s) to a table/view that does not exist:`);
  for (const b of badTables) console.error(`  - ${b}`);
  console.error(
    "\nSupabase returns errors as values, so these do NOT throw — they fail silently at runtime.\n" +
    "Either the name is wrong (check docs/db-audit/12_APPLICATION_DATABASE_CONTRACT.csv for the\n" +
    "intended target), the table still needs a migration, or types.ts is stale — regenerate with\n" +
    "`npx supabase gen types typescript --db-url <url> > src/integrations/supabase/types.ts`.",
  );
}

if (badFns.length) {
  failed = true;
  console.error(`\ncheck-db-contract FAILED — ${badFns.length} RPC call(s) with no matching function:`);
  for (const b of badFns) console.error(`  - ${b}`);
}

// Check 3 — types.ts must actually describe a schema, not a truncated/failed generation.
if (knownTables.size < 100) {
  failed = true;
  console.error(
    `\ncheck-db-contract FAILED — types.ts declares only ${knownTables.size} tables, which looks ` +
    "like a truncated or failed generation. Every other check here trusts this file.",
  );
}

// Not a failure: the name resolves against a migration, so it is a real relation whose migration
// has not been applied yet. Surfaced loudly anyway — if it is still here after the migration is
// pushed, types.ts was never regenerated and check 1 is running blind on those names.
if (pendingTables.length || pendingFns.length) {
  console.warn(
    `\ncheck-db-contract — ${pendingTables.length + pendingFns.length} reference(s) resolve against ` +
    "a migration but not against types.ts:",
  );
  for (const p of [...pendingTables, ...pendingFns]) console.warn(`  ~ ${p}`);
  console.warn(
    "\nThese are pending, not wrong: the migration exists but has not been applied, so the\n" +
    "generated types cannot describe them yet. After `npm run supabase:push`, regenerate with\n" +
    "`npx supabase gen types typescript --db-url <url> > src/integrations/supabase/types.ts`\n" +
    "and this notice clears.",
  );
}

if (failed) process.exit(1);

console.log(
  `check-db-contract passed — ${knownTables.size} tables, ${knownViews.size} views, ` +
  `${knownFns.size} functions declared; every .from()/.rpc() in ${files.length} files resolves.`,
);
