/**
 * Writes Playwright results back into the QA tracker, keyed by tracker case ID.
 *
 * WHY
 * ---
 * docs/qa/cases/*.csv authors every case with its result columns blank, for a human to
 * type in: Status, Actual Result, Console Error, Screenshot, Notes, Defect ID. Filling
 * 400+ rows by hand after every run is not something anyone will keep doing, so this
 * reporter emits docs/qa/results/latest.json and build-tracker.mjs merges it into
 * AUMRTI_QA_TRACKER.xlsx.
 *
 * Column ownership is deliberately split:
 *   MACHINE writes Status / Actual Result / Console Error / Screenshot.
 *   HUMAN owns Notes and Defect ID — a person triages what a failure means and which
 *   bug number it belongs to. This reporter never invents a defect ID.
 *
 * MANY TESTS → ONE CASE
 * ---------------------
 * Phase 2 is authored to strict 1:1 parity — one case, one test — enforced by
 * scripts/qa-parity-check.mjs. Phase 1 predates that rule and still has titles claiming two
 * IDs (`TC-P1B-008/009`), so the aggregation below stays: results are collected per case,
 * worst status wins, and Actual Result records how many checks contributed. Collapsing them
 * any other way would report "3 of 25 values are broken" as an indistinguishable single FAIL.
 *
 * KNOWN PHASE 1 GAP: three tests in P1E/P1F build their titles with template literals, so
 * they carry no parseable TC# and land in `unmappedTests` — roughly 40 TC-P1E-* rows can
 * never receive an automated result until they are renamed to literal titles. Phase 2
 * forbids this outright; the parity check rejects any template-literal test title.
 */
import type {
  Reporter, TestCase, TestResult, TestStep, FullConfig, Suite, FullResult,
} from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';

type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'N/A';

/** Worst wins: one broken sub-check makes the whole tracker row a FAIL. */
const SEVERITY: Record<Verdict, number> = { FAIL: 3, BLOCKED: 2, PASS: 1, 'N/A': 0 };

interface CaseAgg {
  tc: string;
  verdict: Verdict;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** First failure only — the rest are noise once the first is fixed. */
  firstFailureTitle?: string;
  firstFailureMessage?: string;
  screenshot?: string;
  consoleError?: string;
  flaky: boolean;
  /** Phase 5 journey stages, in order. Empty for the atomic cases in phases 1–4. */
  stages: StageResult[];
  /** `S09/38 · lab_technician · Draw the sample` — the stage a journey actually died at. */
  firstFailingStage?: string;
  /** Soft-assertion failures, which do not abort the journey but must still be reported. */
  softFailures: string[];
}

export interface StageResult {
  title: string;
  ok: boolean;
  ms: number;
  error?: string;
}

/**
 * A Phase 5 journey stage: `S09/38 · lab_technician · Draw the sample at the collection workstation`.
 *
 * Only steps matching this shape are recorded. Playwright emits a step for every `expect` and every
 * fixture as well, and keeping those would bury the journey's own structure under a few hundred
 * assertions — the stage list is meant to be readable as the story the case tells.
 */
const STAGE_TITLE = /^S\d+\/\d+ · /;

/**
 * Walk the step tree and pull out the journey stages.
 *
 * A 38-stage journey that dies at stage 9 reports one error at the top level, and without this the
 * tracker records "FAILED" and nothing about how far it got. The whole argument for collapsing 154
 * narrow cases into 24 journeys depends on being able to say *where* — otherwise the rewrite trades
 * breadth of signal for narrative and comes out behind.
 */
function collectStages(steps: readonly TestStep[], out: StageResult[]): void {
  for (const step of steps) {
    if (STAGE_TITLE.test(step.title)) {
      out.push({
        title: step.title,
        ok: !step.error,
        ms: step.duration,
        error: step.error ? tidy(stripAnsi(step.error.message ?? ''), 400) : undefined,
      });
    }
    if (step.steps?.length) collectStages(step.steps, out);
  }
}

/** Playwright colourises error messages; raw ANSI in a spreadsheet cell is unreadable. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

function tidy(s: string, max = 900): string {
  const clean = stripAnsi(s).replace(/\r/g, '').split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '')
    .join('\n')
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}\n…(truncated)` : clean;
}

/**
 * Pull every tracker ID a test title claims.
 *
 * Four title shapes exist in this suite:
 *   TC-P1C-001 valid login succeeds              → one ID
 *   TC-P2L-010 · Wards & Beds · Ward Type = "x"  → one ID, loop-generated
 *   TC-P1B-008/009 every seeded ward has …       → TWO IDs, both must be filled
 *   TC-P1E hospital_admin reaches its routes     → section only, no number → unmapped
 */
export function parseCaseIds(title: string): string[] {
  const m = title.match(/^\s*TC-P(\d+)([A-Z])-(\d{1,3}(?:\/\d{1,3})*)/);
  if (!m) return [];
  const [, phase, section, digits] = m;
  return digits.split('/').map(d => `TC-P${phase}${section}-${d.padStart(3, '0')}`);
}

function verdictOf(result: TestResult): Verdict {
  switch (result.status) {
    case 'passed': return 'PASS';
    case 'skipped': return 'N/A';
    case 'failed':
    case 'timedOut':
    case 'interrupted': return 'FAIL';
    default: return 'FAIL';
  }
}

export default class TrackerReporter implements Reporter {
  private cases = new Map<string, CaseAgg>();
  private unmapped = new Set<string>();
  /** Repo root. NOT config.rootDir — that is testDir (./e2e), which would bury the
   *  results under e2e/docs/qa/ where build-tracker.mjs never looks. */
  private projectRoot = process.cwd();
  private outFile: string;
  private startedAt = new Date().toISOString();

  constructor(options: { outputFile?: string } = {}) {
    this.outFile = options.outputFile
      ?? path.join('docs', 'qa', 'results', 'latest.json');
  }

  onBegin(config: FullConfig, _suite: Suite): void {
    this.projectRoot = config.configFile
      ? path.dirname(config.configFile)
      : process.cwd();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const ids = parseCaseIds(test.title);
    if (ids.length === 0) {
      this.unmapped.add(test.title);
      return;
    }

    const verdict = verdictOf(result);
    const screenshot = result.attachments.find(a => a.name === 'screenshot' && a.path);
    const consoleAtt = result.attachments.find(a => a.name === 'console-errors');

    // The fixture attaches console output as a body, which serialises to base64.
    let consoleText: string | undefined;
    if (consoleAtt?.body) consoleText = consoleAtt.body.toString('utf8');
    else if (consoleAtt?.path && fs.existsSync(consoleAtt.path)) {
      consoleText = fs.readFileSync(consoleAtt.path, 'utf8');
    }

    // Journey stages, for the Phase 5 cases. Phases 1–4 emit none and are unaffected.
    const stages: StageResult[] = [];
    collectStages(result.steps ?? [], stages);

    // Soft assertions do not abort the journey, so they never surface as `result.error` — but each
    // one is a real condition that failed and must reach the tracker, or a journey reports PASS
    // while quietly having proven six things wrong.
    const softFailures = (result.errors ?? [])
      .map(e => tidy(stripAnsi(e.message ?? ''), 300))
      .filter(Boolean);

    for (const tc of ids) {
      const agg = this.cases.get(tc) ?? {
        tc, verdict: 'N/A', total: 0, passed: 0, failed: 0, skipped: 0, flaky: false,
        stages: [], softFailures: [],
      };

      if (stages.length) {
        agg.stages = stages;
        agg.firstFailingStage = stages.find(s => !s.ok)?.title;
      }
      if (softFailures.length && !agg.softFailures.length) agg.softFailures = softFailures;

      agg.total += 1;
      if (verdict === 'PASS') agg.passed += 1;
      else if (verdict === 'FAIL') agg.failed += 1;
      else agg.skipped += 1;

      if (SEVERITY[verdict] > SEVERITY[agg.verdict]) agg.verdict = verdict;
      if (test.outcome() === 'flaky') agg.flaky = true;

      if (verdict === 'FAIL' && !agg.firstFailureTitle) {
        agg.firstFailureTitle = test.title;
        agg.firstFailureMessage = tidy(result.error?.message ?? 'No error message captured.');
        if (screenshot?.path) {
          agg.screenshot = path.relative(this.projectRoot, screenshot.path).replace(/\\/g, '/');
        }
      }
      // Console output is worth keeping even on a pass — it is a column in the tracker.
      if (consoleText && !agg.consoleError) agg.consoleError = tidy(consoleText, 600);

      this.cases.set(tc, agg);
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    /*
     * `playwright test --list` (and any grep that matches nothing) reaches onEnd having
     * executed no tests. Writing then would replace a real run's results with an empty
     * file, silently wiping every Status the tracker was about to merge. Never let a
     * no-op run destroy the last real one.
     */
    if (this.cases.size === 0 && this.unmapped.size === 0) {
      return;
    }

    const cases: Record<string, unknown> = {};
    /** Per-stage detail, written alongside as `latest-steps.json` so the 21-column CSV is untouched. */
    const stageDetail: Record<string, StageResult[]> = {};

    for (const [tc, a] of [...this.cases].sort(([x], [y]) => x.localeCompare(y))) {
      // Only say "N of M" when a case really is backed by several tests — on a 1:1
      // case that phrasing reads like a bug.
      const scope = a.total > 1 ? ` (${a.passed}/${a.total} checks passed)` : '';

      // For a journey, "how far did it get" is most of the diagnosis. `S09/38 · lab_technician ·
      // Draw the sample` tells a reader the case cleared payment and died at phlebotomy without
      // them opening a trace — which is what a 24-row tracker has to buy back from a 154-row one.
      const stagesDone = a.stages.filter(s => s.ok).length;
      const stageScope = a.stages.length ? ` ${stagesDone} of ${a.stages.length} stages passed.` : '';
      const softNote = a.softFailures.length
        ? `\n${a.softFailures.length} soft assertion(s) also failed:\n` +
          a.softFailures.slice(0, 5).map(s => `  · ${s.split('\n')[0]}`).join('\n')
        : '';

      let actual: string;
      if (a.verdict === 'PASS') {
        actual = `Automated: passed${scope}.${stageScope}${softNote}`;
      } else if (a.verdict === 'N/A') {
        actual = `Automated: skipped${scope} — precondition not met (see spec skip reason).`;
      } else {
        actual =
          `Automated: FAILED${scope}` +
          (a.firstFailingStage ? ` at ${a.firstFailingStage}` : '') + '.' +
          stageScope + '\n' +
          (a.total > 1 && a.firstFailureTitle ? `First failing check: ${a.firstFailureTitle}\n` : '') +
          (a.firstFailureMessage ?? '') + softNote;
      }

      cases[tc] = {
        status: a.verdict,
        actual: tidy(actual, 1200),
        consoleError: a.consoleError ?? '',
        screenshot: a.screenshot ? 'Y' : 'N',
        screenshotPath: a.screenshot ?? '',
        // Only ever a hint; build-tracker will not overwrite a human's Notes.
        notes: a.flaky ? 'Flaky: passed only on retry. Quarantining is not a fix — root-cause it.' : '',
        totalChecks: a.total,
        passedChecks: a.passed,
        failedChecks: a.failed,
        // Feeds the tracker's "Stages Passed / Total" column.
        stagesPassed: stagesDone,
        stagesTotal: a.stages.length,
        firstFailingStage: a.firstFailingStage ?? '',
        softFailureCount: a.softFailures.length,
      };
      stageDetail[tc] = a.stages;
    }

    const payload = {
      generatedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      runStatus: result.status,
      caseCount: Object.keys(cases).length,
      // Tests whose titles carry no numeric case ID cannot reach a tracker row. Surfaced
      // rather than swallowed: today this is P1E's 30 role-matrix tests, which means 40
      // TC-P1E-* rows can never receive an automated result until they are renamed.
      unmappedTests: [...this.unmapped].sort(),
      cases,
    };

    const abs = path.isAbsolute(this.outFile) ? this.outFile : path.join(this.projectRoot, this.outFile);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

    /*
     * The stage tree goes in a SIBLING file rather than into `latest.json`.
     *
     * A 38-stage journey carries 38 titles, durations and error strings; folding that into the
     * results file every phase reads would bloat it for the four phases that have no stages at
     * all, and would tempt someone to widen the 21-column CSV contract to carry it. Keeping it
     * separate means `build-tracker.mjs` can render a "Stages Passed / Total" column and a future
     * dashboard can render the whole grid, while the contract stays exactly as it was.
     */
    const withStages = Object.entries(stageDetail).filter(([, s]) => s.length);
    if (withStages.length) {
      const stepsFile = abs.replace(/latest\.json$/, 'latest-steps.json');
      fs.writeFileSync(
        stepsFile,
        `${JSON.stringify({
          generatedAt: this.startedAt,
          finishedAt: new Date().toISOString(),
          cases: Object.fromEntries(withStages),
        }, null, 2)}\n`,
        'utf8',
      );
    }

    const failed = Object.values(cases).filter(c => (c as { status: Verdict }).status === 'FAIL').length;
    console.log(
      `\n  Tracker results → ${path.relative(this.projectRoot, abs).replace(/\\/g, '/')}\n` +
      `  ${payload.caseCount} case(s) recorded, ${failed} failing` +
      (withStages.length ? `, ${withStages.length} journey(s) with stage detail` : '') +
      (this.unmapped.size ? `, ${this.unmapped.size} test(s) with no case ID (see unmappedTests)` : '') +
      `\n  Merge into the workbook with: npm run qa:tracker\n`,
    );
  }
}
