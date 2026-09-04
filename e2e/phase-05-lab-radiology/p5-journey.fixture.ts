/**
 * Phase 5 — the journey fixture. Everything a 25–45 stage case needs before its first click.
 *
 * WHAT THIS REMOVES FROM EVERY SPEC
 * ---------------------------------
 * A journey is long enough that the setup which used to be copied into each narrow case now costs
 * real money in duplication and, worse, in *omission* — a journey that forgets to stub
 * `window.print()` hangs on a native dialog and reports a timeout at a stage that actually worked.
 * So the fixture owns all of it: the timeout for the journey's class, the case's own patient, the
 * prerequisite repair, the API-failure recorder, the popup and print stubs, and the onboarding
 * tour that intercepts the first click on the Lab module.
 *
 * THE STAGE TREE IS THE DIAGNOSTIC
 * --------------------------------
 * `jrn.next(fn)` takes the next stage title from `p5-manifest.ts` and wraps `fn` in
 * `test.step(title, fn, { box: true })`. Three consequences, all deliberate:
 *
 *   1. **The spec cannot drift from the CSV.** The titles a human tester follows and the titles the
 *      automation walks are the same array. There is no second place to edit.
 *   2. **`box: true` reports the SPEC line, not the helper line.** Without it every journey fails
 *      "at p5-stages.ts:281" and the report tells you nothing about which journey or which stage.
 *   3. **The stage number is in the title** — `S09/38 · lab_technician · Draw the sample` — so one
 *      line of a failure report says the journey got three-quarters through payment and died at
 *      phlebotomy. The tracker reporter parses the same prefix to count stages passed.
 *
 * HARD vs SOFT, WHICH IS THE WHOLE GAME AT THIS LENGTH
 * ----------------------------------------------------
 * An aborting assertion at stage 12 of 38 silently un-reports 26 conditions — not as failures, as
 * *nothing*. So: hard `expect` only for state the next stage physically depends on (the order
 * exists, the sample is collected, the report is signed). Everything else is `expect.soft`, which
 * goes red and lets the journey carry on proving the rest. Playwright reports every soft failure on
 * the test, so one run lists every condition that broke rather than only the first.
 */
import { expect, type Page, type BrowserContext } from '@playwright/test';
import { test as authTest } from '../fixtures/auth.fixture';
import { journey, stageTitles, TIMEOUTS, type Journey } from './p5-manifest';
import { patientForTest, seededPatient, type P5Patient } from './p5-patients';
import { p5Prerequisites } from './p5-prereqs';
import { recordApiFailures, apiFailureNote, type ApiFailure } from './p5-stages';

export interface JourneyContext {
  /** The manifest entry for this case. */
  spec: Journey;
  /** The patient this case owns (or the seeded record it deliberately reuses). */
  patient: P5Patient;
  hospitalId: string;
  /** Failed PostgREST/Edge calls, for `jrn.note()`. */
  apiFailures: ApiFailure[];

  /**
   * Run the next stage in the manifest's order.
   *
   * Stages are consumed in sequence, so the spec's structure and the CSV's `Steps` column are the
   * same list by construction. If a spec runs fewer stages than the manifest declares, the fixture
   * reports it at teardown rather than letting the journey quietly shrink.
   */
  next<T>(fn: () => Promise<T>): Promise<T>;

  /** Run a specific stage by its 1-based number, for a branch that skips one. */
  at<T>(n: number, fn: () => Promise<T>): Promise<T>;

  /** Append the run's failed API calls to an assertion message. A stalled wizard never says why. */
  note(): string;

  /** How many stages have been run, and how many the manifest declares. */
  progress(): { done: number; total: number };
}

interface P5Fixtures {
  jrn: JourneyContext;
}

/**
 * Silence the two things that hang a long journey.
 *
 * `Label`, `Print Report`, `Cumulative` and the pathology print all call `window.open()` then
 * `window.print()`. A real print dialog blocks the page for the rest of the test budget, and the
 * failure is reported against whatever stage happened to be running — never against the print.
 */
async function stubPrintAndPopups(context: BrowserContext, page: Page): Promise<Page[]> {
  const popups: Page[] = [];

  await context.addInitScript(() => {
    // Keep a record so a stage can assert the print WAS dispatched, without a dialog opening.
    (window as unknown as { __printCalls: number }).__printCalls = 0;
    window.print = () => { (window as unknown as { __printCalls: number }).__printCalls += 1; };
  });

  // RECORD popups; do not close them here.
  //
  // The first version closed each popup on its `load` event, and that broke the very first
  // navigation of every journey: `page.goto('/login')` waits for `load`, and closing a page out
  // from under the context while the app was booting left that event never firing. The login
  // screen rendered perfectly and the test still timed out after 30s — a failure that looks like a
  // slow app and is entirely the harness's doing. Popups are closed at teardown instead, when
  // nothing is waiting on them.
  context.on('page', p => { popups.push(p); });

  void page;
  return popups;
}

/**
 * The onboarding tour mounts over the Lab module and swallows the first click
 * (`CollectionWorkstation.tsx:251`). Dismiss it once per journey rather than per spec.
 */
async function dismissOnboardingTour(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: /skip|got it|dismiss|close tour|finish/i }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click().catch(() => { /* the tour closed itself */ });
  }
}

/**
 * Built on the auth fixture, not on `base` — `loginAs`, `logout` and the automatic console-error
 * capture the tracker reads all come from there, and redeclaring them would fork the login path.
 */
export const test = authTest.extend<P5Fixtures>({
  jrn: async ({ page, context }, use, testInfo) => {
    const id = testInfo.title.match(/^\s*(TC-P5[A-Z]-\d{3})/)?.[1];
    if (!id) {
      throw new Error(
        `Test title "${testInfo.title}" does not start with a Phase 5 case ID. Every journey is ` +
        `declared in p5-manifest.ts and its title comes from testTitle(id) — a hand-typed title ` +
        `is a result the tracker will drop into unmappedTests.`,
      );
    }

    const spec = journey(id);
    testInfo.setTimeout(TIMEOUTS[spec.timeoutClass]);

    const patient = spec.patient.kind === 'own'
      ? await patientForTest(testInfo)
      : await asP5Patient(spec.patient.uhid);

    await p5Prerequisites(patient.hospitalId);

    const apiFailures = recordApiFailures(page);
    const popups = await stubPrintAndPopups(context, page);

    const titles = stageTitles(spec);
    let cursor = 0;

    const runStage = async <T>(index: number, fn: () => Promise<T>): Promise<T> => {
      const title = titles[index];
      if (!title) {
        throw new Error(
          `${id} ran stage ${index + 1} but p5-manifest.ts declares only ${titles.length}. Add the ` +
          `stage to the manifest first — the CSV a tester follows is generated from it.`,
        );
      }
      return test.step(title, fn, { box: true });
    };

    const ctx: JourneyContext = {
      spec,
      patient,
      hospitalId: patient.hospitalId,
      apiFailures,
      next: fn => runStage(cursor++, fn),
      at: (n, fn) => { cursor = n; return runStage(n - 1, fn); },
      note: () => apiFailureNote(apiFailures),
      progress: () => ({ done: cursor, total: titles.length }),
    };

    // The tour only exists on the Lab module, and only for a fresh user — cheap to try, expensive
    // to forget.
    await dismissOnboardingTour(page).catch(() => { /* not on a tour-bearing page yet */ });

    await use(ctx);

    // Close any print popups the journey opened, now that nothing is waiting on a load event.
    for (const p of popups) await p.close().catch(() => { /* already gone */ });

    if (cursor < titles.length) {
      // Not a failure — a journey may legitimately stop early on a branch — but it must be visible,
      // because a journey that silently runs half its stages is a narrow case again.
      testInfo.annotations.push({
        type: 'stages-not-run',
        description: `${cursor} of ${titles.length} stages ran. Unrun: ${titles.slice(cursor).join(' | ')}`,
      });
    }
  },
});

/** Adapt a seeded `PT-QA-NNNN` record to the `P5Patient` shape the stages expect. */
async function asP5Patient(uhid: string): Promise<P5Patient> {
  const row = await seededPatient(uhid, 'A');
  return {
    caseId: `seeded:${uhid}`,
    uhid: row.uhid,
    name: row.name,
    age: 0, sex: 'male', phone: '', allergies: [],
    hospital: 'A',
    id: row.id,
    hospitalId: row.hospitalId,
  };
}

export { expect };
export { MOCK, PASSWORD, staffByRole, TEST_ENV } from '../fixtures/auth.fixture';
