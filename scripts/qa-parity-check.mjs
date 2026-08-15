#!/usr/bin/env node
/**
 * CSV ↔ Playwright parity check.
 *
 * THE RULE THIS ENFORCES
 * ----------------------
 * Every test case in docs/qa/cases/*.csv has exactly ONE Playwright test, and every
 * Playwright test has exactly ONE case. Case count == test count.
 *
 * Without a check, that rule rots within a week: someone adds a row and forgets the spec, or
 * renames a test and orphans a tracker row that then silently never receives a result. The
 * tracker reporter cannot catch it either — it only reports on tests that ran, so a case with
 * no test simply stays blank forever and looks like "not tested yet" rather than "no longer
 * tested".
 *
 * WHAT IT CHECKS
 *   1. Every CSV TC# is claimed by exactly one test title
 *   2. Every test title's TC# exists as a CSV row
 *   3. No TC# is duplicated within the CSV
 *   4. Every row names the spec file that actually contains its test
 *   5. Quality bar — no blank mandatory author columns, no "None" where a write happens
 *
 * USAGE
 *   node scripts/qa-parity-check.mjs            every phase in STRICT_PHASES
 *   node scripts/qa-parity-check.mjs 02         one phase
 *   node scripts/qa-parity-check.mjs 01 --advisory   report without failing
 *
 * Exits non-zero on any violation, so it works as a CI gate.
 *
 * PHASE 1 IS NOT IN SCOPE. It was authored under the earlier contract, where 177 cases were
 * covered by 60 tests and the rest stayed manual. Retro-fitting 1:1 onto it would mean either
 * deleting real cases or inventing tests, so it is checked only in --advisory mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES_DIR = path.join(ROOT, 'docs', 'qa', 'cases');
const E2E_DIR = path.join(ROOT, 'e2e');

/**
 * Phases that have signed up to 1:1 parity and the full quality bar.
 * Add each new phase here as it is authored.
 */
const STRICT_PHASES = ['02'];

const c = {
  b: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  g: s => `\x1b[32m${s}\x1b[0m`,
  r: s => `\x1b[31m${s}\x1b[0m`,
  y: s => `\x1b[33m${s}\x1b[0m`,
};

/* ------------------------------------------------------------------ *
 * RFC-4180 CSV parser. Same behaviour as build-tracker.mjs's — the two
 * must agree or a file could pass here and break the tracker.
 * ------------------------------------------------------------------ */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

function readCases(phaseFilter) {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.csv'))
    .filter(f => !phaseFilter || f.startsWith(`phase-${phaseFilter}`))
    .map(file => {
      const rows = parseCsv(fs.readFileSync(path.join(CASES_DIR, file), 'utf8'));
      const header = rows[0];
      const records = rows.slice(1).map((r, i) => {
        const o = { __line: i + 2 };
        header.forEach((h, j) => { o[h] = (r[j] ?? '').trim(); });
        return o;
      });
      return { file, header, records };
    });
}

/** Every `TC-P2D-014` a test title claims. Mirrors parseCaseIds in the tracker reporter. */
function idsInTitle(title) {
  const m = title.match(/^\s*TC-P(\d+)([A-Z])-(\d{1,3}(?:\/\d{1,3})*)/);
  if (!m) return [];
  const [, phase, section, digits] = m;
  return digits.split('/').map(d => `TC-P${phase}${section}-${d.padStart(3, '0')}`);
}

function walkSpecs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSpecs(full, out);
    else if (entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * Collect `test('TC-… ', …)` titles.
 *
 * Deliberately does NOT match test.describe or test.skip-at-describe-level: a describe block
 * is not a case. `test.only` is matched so a stray .only still parity-checks — forbidOnly in
 * the Playwright config is what fails the CI run itself.
 */
function readSpecTitles(phaseFilter) {
  const found = [];
  for (const file of walkSpecs(E2E_DIR)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (phaseFilter && !rel.includes(`phase-${phaseFilter}`)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const re = /(?:^|\s)test(?:\.only|\.fixme|\.skip)?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
    for (const m of src.matchAll(re)) {
      found.push({ title: m[2], file: rel });
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * The quality bar. These are the columns the previously-rejected
 * Phase 2 CSV left blank — the whole reason this check exists.
 * ------------------------------------------------------------------ */
const REQUIRED_COLS = [
  'TC#', 'Section', 'Priority', 'Test Case', 'Steps', 'Expected Result',
  'mock data', 'Journey Scenario', 'Why This Exists', 'Test Type', 'Role/Login',
  'Supabase Verify', 'Playwright Spec',
];

/** Tester-owned columns must ship EMPTY — a pre-filled Status is a fabricated result. */
const MUST_BE_BLANK = [
  'Status(PASS/FAIL/BLOCKED)', 'Actual Result(What happened)',
  'Console Error(Copy-paste red text)', 'Screenshot(Y/N)', 'Defect ID',
];

const VALID_PRIORITY = new Set(['P1', 'P2', 'P3']);
const VALID_TYPE = new Set(['Positive', 'Negative', 'Boundary', 'RBAC', 'Cross-Module']);

/** Phrases that mean the author never actually filled the field in. */
const PLACEHOLDER = /^(none|n\/a|na|tbd|-|—|todo|test the .*|works correctly)$/i;

function checkQuality(records, file, problems) {
  for (const r of records) {
    const tc = r['TC#'] || `(row ${r.__line})`;
    const at = `${file}:${r.__line} ${tc}`;

    for (const col of REQUIRED_COLS) {
      if (!(col in r)) { problems.push(`${at} — CSV has no "${col}" column`); continue; }
      if (r[col] === '') problems.push(`${at} — "${col}" is empty`);
    }
    for (const col of MUST_BE_BLANK) {
      if (r[col]) problems.push(`${at} — "${col}" is tester-owned and must ship blank (found "${r[col]}")`);
    }

    if (!VALID_PRIORITY.has(r['Priority'])) problems.push(`${at} — Priority "${r['Priority']}" is not P1/P2/P3`);
    if (!VALID_TYPE.has(r['Test Type'])) problems.push(`${at} — Test Type "${r['Test Type']}" is not one of ${[...VALID_TYPE].join('/')}`);

    // The bar that the rejected CSV failed: "mock data: none" as a default.
    if (PLACEHOLDER.test(r['mock data']) && r['mock data'].toLowerCase() !== 'none') {
      problems.push(`${at} — "mock data" is a placeholder ("${r['mock data']}"). Name a MOCK_DATA_BOOK block.`);
    }
    if (PLACEHOLDER.test(r['Expected Result'])) {
      problems.push(`${at} — "Expected Result" is not falsifiable ("${r['Expected Result']}")`);
    }
    // Steps must name a concrete target: a route for a UI case, or a table for a case that talks
    // to PostgREST directly — tenant-isolation checks have no screen to open, and forcing a route
    // onto them would make the steps less accurate rather than more.
    if (r['Steps'] && !/\/[a-z]/.test(r['Steps']) && !/\bfrom [a-z_]{3,}\b/.test(r['Steps'])) {
      problems.push(`${at} — "Steps" names neither a route nor a table. Write "1) Open /settings/wards" or "2) Select every row from wards", not "go to wards".`);
    }
    if (r['Why This Exists'].length < 40) {
      problems.push(`${at} — "Why This Exists" is too thin to justify the case ("${r['Why This Exists']}")`);
    }
    // A case that writes must say where to look. This is what "trust the DB, not the UI" means.
    const writes = /\b(save|create|add|update|edit|delete|deactivate|persist|store)\b/i.test(r['Test Case']);
    if (writes && /^none$/i.test(r['Supabase Verify'])) {
      problems.push(`${at} — writes data but "Supabase Verify" is None. A green toast is not a pass.`);
    }
  }
}

/* ------------------------------------------------------------------ */
function main() {
  const args = process.argv.slice(2);
  const advisory = args.includes('--advisory');
  const requested = args.find(a => !a.startsWith('--'))?.padStart(2, '0');

  const phases = requested ? [requested] : STRICT_PHASES;
  if (requested && !STRICT_PHASES.includes(requested) && !advisory) {
    console.error(
      c.r(`Phase ${requested} has not adopted 1:1 parity.`) +
      `\n  Add it to STRICT_PHASES once its cases are authored to the contract, ` +
      `or re-run with --advisory to see the report without failing.\n`,
    );
    process.exit(2);
  }

  let bundles = [], titles = [];
  for (const p of phases) {
    bundles = bundles.concat(readCases(p));
    titles = titles.concat(readSpecTitles(p));
  }

  if (!bundles.length) {
    console.error(c.r(`No case CSVs found for phase(s) ${phases.join(', ')} in docs/qa/cases/`));
    process.exit(1);
  }

  const problems = [];
  const csvIds = new Map();          // TC# → { file, row }
  const specIds = new Map();         // TC# → [{ title, file }]

  for (const { file, records } of bundles) {
    for (const r of records) {
      const tc = r['TC#'];
      if (!tc) continue;
      if (csvIds.has(tc)) problems.push(`${file}:${r.__line} — duplicate TC# "${tc}"`);
      csvIds.set(tc, { file, row: r });
    }
    checkQuality(records, file, problems);
  }

  for (const t of titles) {
    const ids = idsInTitle(t.title);
    if (!ids.length) {
      problems.push(`${t.file} — test title carries no TC# and can never reach a tracker row: "${t.title}"`);
      continue;
    }
    if (ids.length > 1) {
      problems.push(`${t.file} — "${t.title}" claims ${ids.length} case IDs. Phase 2 is 1:1; split it.`);
    }
    for (const id of ids) {
      if (!specIds.has(id)) specIds.set(id, []);
      specIds.get(id).push(t);
    }
  }

  for (const [tc, { file, row }] of csvIds) {
    const claims = specIds.get(tc);
    if (!claims) {
      problems.push(`${file} ${tc} — no Playwright test claims this case (1:1 parity requires one)`);
      continue;
    }
    if (claims.length > 1) {
      problems.push(
        `${tc} — claimed by ${claims.length} tests: ${claims.map(x => `${x.file}`).join(', ')}. Parity requires exactly one.`,
      );
    }
    const declared = row['Playwright Spec'];
    if (declared && !claims.some(x => x.file === declared)) {
      problems.push(
        `${file} ${tc} — "Playwright Spec" says ${declared} but the test lives in ${claims.map(x => x.file).join(', ')}`,
      );
    }
  }

  for (const [tc, claims] of specIds) {
    if (!csvIds.has(tc)) {
      problems.push(`${claims[0].file} ${tc} — test exists but there is no CSV row for it`);
    }
  }

  console.log(`\n${c.b('QA parity check')}${c.dim(`  phase ${phases.join(', ')}${advisory ? ' (advisory)' : ''}`)}`);
  console.log(`  CSV cases             ${csvIds.size}`);
  console.log(`  Playwright tests      ${titles.length}`);
  console.log(`  Distinct IDs in specs ${specIds.size}`);

  if (csvIds.size !== titles.length) {
    problems.push(`Case count ${csvIds.size} != test count ${titles.length}`);
  }

  if (problems.length) {
    const grouped = new Map();
    for (const p of problems) {
      // Group by the message shape so 148 identical complaints read as one line.
      const shape = p
        .replace(/^\S+?(:\d+)?\s+/, '')      // file[:line]
        .replace(/TC-P\d+[A-Z]-\d+/g, 'TC-…') // the case ID itself
        .replace(/"[^"]*"/g, '"…"');          // quoted values
      if (!grouped.has(shape)) grouped.set(shape, []);
      grouped.get(shape).push(p);
    }
    const label = advisory ? c.y(`${problems.length} problem(s), advisory only:`) : c.r(`${problems.length} problem(s):`);
    console.log(`\n  ${label}\n`);
    for (const [shape, list] of grouped) {
      console.log(`    • ${list[0]}`);
      if (list.length > 1) console.log(c.dim(`      ×${list.length} occurrences of this shape`));
    }
    console.log('');
    process.exit(advisory ? 0 : 1);
  }

  console.log(`\n  ${c.g('✓')} 1:1 parity holds, and every row meets the quality bar.\n`);
}

main();
