/**
 * Generate `docs/qa/cases/phase-05-lab-radiology.csv` from `e2e/phase-05-lab-radiology/p5-manifest.ts`.
 *
 * WHY THE CSV IS GENERATED AND NOT WRITTEN BY HAND
 * -----------------------------------------------
 * A Phase 5 case is now a 20–38 stage journey. The `Steps` column is what a HUMAN tester follows;
 * the `test.step()` titles are what the AUTOMATION walks. Typed out separately those two diverge
 * within a sprint — and when they do, the manual and automated runs stop testing the same journey
 * while the tracker merges their results onto one row as though they had. So the stages are
 * declared once in the manifest and rendered into both.
 *
 * The patient identity comes from `p5-personas.ts`, the same module the tests use, for the same
 * reason: a case that tells a tester to search `PT-QA-0001` while the automation creates
 * `PT-QA-5A001-<run>` is a case where the two runs are looking at different charts.
 *
 *     node docs/qa/tracker/build-p5-cases.mjs
 *     node docs/qa/tracker/build-p5-cases.mjs --check    # CI: fail if the CSV has drifted
 *
 * `<run>` stays a literal placeholder because the run tag changes every run. A tester finds the
 * actual patient by sorting `patients` by `uhid` descending, or by pinning `QA_P5_RUN_TAG` first.
 *
 * This supersedes `build-p5-patients.mjs`, which only rewrote the patient references inside a
 * hand-written CSV. There is no hand-written CSV any more.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const CSV = path.join(REPO, 'docs', 'qa', 'cases', 'phase-05-lab-radiology.csv');
const MANIFEST = path.join(REPO, 'e2e', 'phase-05-lab-radiology', 'p5-manifest.ts');
const PERSONAS = path.join(REPO, 'e2e', 'phase-05-lab-radiology', 'p5-personas.ts');

const DQ = String.fromCharCode(34);

/** The 21-column contract, verbatim from docs/qa/test-case-template.md. */
const COLUMNS = [
  'TC#', 'Section', 'Priority', 'Test Case', 'Steps', 'Expected Result',
  'Status(PASS/FAIL/BLOCKED)', 'mock data', 'Cross-Module Link',
  'Settings need to set before entering to the module', 'Actual Result(What happened)',
  'Console Error(Copy-paste red text)', 'Screenshot(Y/N)', 'Notes', 'Journey Scenario',
  'Why This Exists', 'Test Type', 'Role/Login', 'Supabase Verify', 'Playwright Spec', 'Defect ID',
];

const cell = v => DQ + String(v ?? '').split(DQ).join(DQ + DQ) + DQ;
const toCsv = rows => rows.map(r => r.map(cell).join(',')).join('\n') + '\n';

function parseCsv(s) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === DQ) { if (s[i + 1] === DQ) { f += DQ; i++; } else q = false; }
      else f += c;
    } else if (c === DQ) q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* ── Rendering one journey ────────────────────────────────────────────── */

/**
 * The `Steps` column: the manifest's stages, numbered, one line.
 *
 * The `NEGATIVE:` / `BOUNDARY:` markers are carried through verbatim because
 * `qa-parity-check.mjs` requires at least one of each per journey — which is what mechanically
 * stops a narrow case being re-introduced wearing a journey's name.
 */
function renderSteps(j) {
  return j.stages
    .map((s, i) => {
      const marked = /^(NEGATIVE|BOUNDARY):/.test(s.title)
        ? s.title
        : (s.kind === 'negative' ? `NEGATIVE: ${s.title}`
          : s.kind === 'boundary' ? `BOUNDARY: ${s.title}`
          : s.title);
      return `${i + 1}) [${s.actor}] ${marked}`;
    })
    .join(' ');
}

function renderExpected(j) {
  const negatives = j.stages.filter(s => s.kind === 'negative').length;
  const boundaries = j.stages.filter(s => s.kind === 'boundary').length;
  return (
    `The journey completes all ${j.stages.length} stages. ` +
    `${negatives} negative condition(s) are refused as described in the steps and ` +
    `${boundaries} boundary value(s) behave exactly as stated. ` +
    `Verify in Supabase: ${j.verify}`
  );
}

function renderMock(j, uhid, name, persona) {
  const seeded = j.seeded.length
    ? ` Seeded via the service role (see p5-seed-of-last-resort.ts): ${j.seeded.join('; ')}.`
    : ' Nothing is seeded — every stage goes through the browser.';
  const who = j.patient.kind === 'own'
    ? `Own patient ${uhid} "${name}" (${persona.age}${persona.sex === 'male' ? 'M' : 'F'}), created by the run and never deleted.`
    : `REUSES the seeded patient ${j.patient.uhid} — ${j.patient.why}.`;
  return `Phase 5 additions (mock-data.json phase5 block). ${who}${seeded}`;
}

/* ── Build ────────────────────────────────────────────────────────────── */

const manifest = await import(pathToFileURL(MANIFEST).href);
const personas = await import(pathToFileURL(PERSONAS).href);

const rows = [COLUMNS];
for (const j of manifest.JOURNEYS) {
  const uhid = personas.uhidFor(j.id, '<run>');
  const name = personas.nameFor(j.id, '<run>');
  const persona = personas.personaFor(j.id);

  const record = {
    'TC#': j.id,
    Section: j.section,
    Priority: j.priority,
    'Test Case': j.title,
    Steps: renderSteps(j),
    'Expected Result': renderExpected(j),
    'Status(PASS/FAIL/BLOCKED)': '',
    'mock data': renderMock(j, uhid, name, persona),
    'Cross-Module Link': j.crossModule,
    'Settings need to set before entering to the module': j.settings,
    'Actual Result(What happened)': '',
    'Console Error(Copy-paste red text)': '',
    'Screenshot(Y/N)': '',
    Notes: j.pending
      ? 'DECLARED, NOT YET AUTOMATED (Batch 2). The steps are followable by hand today; the spec is a test.fixme placeholder and reports N/A.'
      : '',
    'Journey Scenario': j.scenario,
    'Why This Exists': j.why,
    'Test Type': j.testType,
    'Role/Login': j.roles.map(r => `${r} (Hospital A)`).join(' then '),
    'Supabase Verify': j.verify,
    'Playwright Spec': j.spec,
    'Defect ID': '',
  };
  rows.push(COLUMNS.map(c => record[c] ?? ''));
}

const out = toCsv(rows);
const current = fs.existsSync(CSV) ? fs.readFileSync(CSV, 'utf8') : '';

if (process.argv.includes('--check')) {
  if (out !== current) {
    console.error(
      'docs/qa/cases/phase-05-lab-radiology.csv is out of date with p5-manifest.ts.\n' +
      'The steps a tester follows would differ from the stages the automation walks.\n' +
      'Run: node docs/qa/tracker/build-p5-cases.mjs',
    );
    process.exit(1);
  }
  console.log(`Phase 5 CSV is in sync with the manifest (${rows.length - 1} journeys).`);
  process.exit(0);
}

// Preserve the six tester-owned columns across a rebuild, keyed on TC#, exactly as
// build-tracker.mjs does for the workbook. Regenerating must never discard a recorded result.
const TESTER_COLUMNS = [
  'Status(PASS/FAIL/BLOCKED)', 'Actual Result(What happened)',
  'Console Error(Copy-paste red text)', 'Screenshot(Y/N)', 'Notes', 'Defect ID',
];
if (current) {
  const old = parseCsv(current);
  const oldHeader = old[0] ?? [];
  const byId = new Map(old.slice(1).map(r => [r[0], r]));
  for (let i = 1; i < rows.length; i++) {
    const prev = byId.get(rows[i][0]);
    if (!prev) continue;
    for (const col of TESTER_COLUMNS) {
      const from = oldHeader.indexOf(col);
      const to = COLUMNS.indexOf(col);
      // Never clobber the generated Batch-2 note with an empty old value.
      if (from >= 0 && to >= 0 && prev[from]) rows[i][to] = prev[from];
    }
  }
}

fs.writeFileSync(CSV, toCsv(rows));
const implemented = manifest.JOURNEYS.filter(j => !j.pending).length;
console.log(
  `Phase 5 CSV rebuilt from the manifest — ${rows.length - 1} journeys ` +
  `(${implemented} automated, ${rows.length - 1 - implemented} declared for Batch 2), ` +
  `${manifest.JOURNEYS.reduce((a, j) => a + j.stages.length, 0)} stages in total.`,
);
