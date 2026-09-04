/**
 * Phase 5 — one patient per test case, and nothing is ever deleted.
 *
 * WHY THIS FILE REPLACED THE PURGE MODEL
 * --------------------------------------
 * Every Phase 5 spec used to run against `PT-QA-0001` and call `purgeLabRadArtefacts()` in
 * `afterEach` to wipe the chart before the next case reused the same patient. That model has
 * three problems a hospital would recognise immediately:
 *
 *   1. **It destroys the evidence.** When TC-P5C-010 fails, the first question is "what did the
 *      chart actually look like?" — and the purge has already answered it with nothing. A failing
 *      lab result you cannot open is a failing lab result you cannot diagnose.
 *   2. **One patient cannot hold 146 contradictory histories.** TC-P5C-014 asserts a patient's
 *      FIRST ever result has no previous value to compare against; TC-P5C-011 asserts the SAME
 *      patient has a 30-day-old creatinine. Both are true only because a purge ran between them,
 *      which means the tests are coupled to their own cleanup rather than to the product.
 *   3. **It is not how a real lab looks.** A ward round opens a patient with one order in flight
 *      and eleven in history. A test that only ever sees a chart of exactly one order never
 *      exercises the "which of these is the current one" logic that breaks in production.
 *
 * So: **every case gets its own patient, and no patient, order, sample, result or report is ever
 * deleted.** The chart each case leaves behind is the artefact you open when it goes red.
 *
 * IDENTITY, AND WHY IT CARRIES A RUN TAG
 * --------------------------------------
 * A case's patient is `PT-QA-<case>-<runTag>` — e.g. `TC-P5C-002` on run `MKQ3X1` becomes
 * `PT-QA-5C002-MKQ3X1`, "Ramesh Kumar 5C002-MKQ3X1". Two properties matter and they pull in
 * opposite directions:
 *
 *   - **Unique per case**, so no case can see another's orders. The Lab worklist row is matched
 *     on the text it renders — `LabQueuePanel.tsx:197,204` render `full_name` and `uhid`, not the
 *     accession number — so the UHID is what makes `openOrderInWorklist()` unambiguous.
 *   - **Unique per run**, because nothing is deleted. Without a run tag the second run of
 *     TC-P5C-014 would open a patient who already has yesterday's result, and "the first ever
 *     result for this patient" would be a lie the test cannot detect.
 *
 * Set `QA_P5_RUN_TAG` to pin the tag and deliberately re-enter a previous run's patients — useful
 * when you want to re-open the exact chart a failing run left behind, or to watch a longitudinal
 * history build up across runs.
 *
 * WHAT IS REUSED RATHER THAN CREATED
 * ----------------------------------
 * Cases whose whole point is a patient who already existed before the test — the admitted IPD
 * patient, the Hospital B isolation control — call `seededPatient()` and reuse the `PT-QA-NNNN`
 * record `scripts/qa-seed.mjs` created. Those are never created here and never modified.
 */
import { db, hospitalIdFor } from '../utils/db-verify';
import { MOCK } from '../fixtures/mock-data';
import { personaFor, phoneFor, uhidFor, nameFor } from './p5-personas';

/* ── Run identity ─────────────────────────────────────────────────────── */

/**
 * One tag per `playwright test` process, so every case in a run gets a fresh chart while two
 * cases in the SAME run can still be pointed at the same patient on purpose (5M does this to
 * prove a result reaches the doctor who ordered it).
 *
 * Base36 minutes-since-epoch: six characters, monotonic, and sorts chronologically in the
 * Supabase Table Editor — which is where you go when a case fails and you want its patient.
 */
export const RUN_TAG: string =
  (process.env.QA_P5_RUN_TAG || Math.floor(Date.now() / 60_000).toString(36)).toUpperCase();

/* ── Personas ─────────────────────────────────────────────────────────── */

export interface P5Patient {
  /** The case that owns this patient — `TC-P5C-002`. */
  caseId: string;
  /** `PT-QA-5C002-MKQ3X1`. Unique per case per run; always carries the `PT-QA-` guard prefix. */
  uhid: string;
  /**
   * `Ramesh Kumar 5C002-MKQ3X1` — what the worklist row renders.
   *
   * The run tag is in the NAME as well as the UHID on purpose. Several screens in this phase are
   * matched on the patient name alone — the collection workstation, the radiology worklist, the
   * chart view — and nothing is ever deleted, so a name that carried only the case number would
   * match this case's order from *last* run just as happily as this one's.
   */
  name: string;
  age: number;
  sex: 'male' | 'female';
  phone: string;
  allergies: string[];
  hospital: 'A' | 'B';
  /** `patients.id`, resolved after the row exists. */
  id: string;
  /** `patients.hospital_id`. */
  hospitalId: string;
}

/**
 * Personas come from `p5-personas.ts`, which has no database or fixture imports so that the
 * tracker documentation can derive the SAME identity from the SAME source. When these drift, a
 * tester reads "search PT-QA-0001" in the case steps while the automation searches something
 * else, and the manual and automated runs stop testing the same thing.
 */
export {
  caseSlug, personaFor, poolIndex, uhidFor, nameFor, phoneFor,
  PERSONA_OVERRIDES, GIVEN_NAMES, SURNAMES,
} from './p5-personas';

/* ── Provisioning ─────────────────────────────────────────────────────── */

const cache = new Map<string, P5Patient>();

/**
 * The patient for one test case, created if this run has not created it yet.
 *
 * Idempotent within a run and safe to call from `beforeEach` and again mid-test — the second
 * call is a cache hit, not a second insert. **Never deletes anything.**
 */
export async function ensureCasePatient(
  caseId: string,
  opts: { hospital?: 'A' | 'B' } = {},
): Promise<P5Patient> {
  const hospital = opts.hospital ?? 'A';
  const key = `${hospital}:${caseId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const persona = personaFor(caseId);
  const hospitalId = await hospitalIdFor(hospital);
  const uhid = uhidFor(caseId, RUN_TAG, MOCK.guard.uhidPrefix);
  const name = nameFor(caseId, RUN_TAG);

  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - persona.age);

  // Idempotent by (hospital_id, uhid) — the table's own unique key. A re-run with a pinned
  // QA_P5_RUN_TAG re-enters the same chart instead of failing on the constraint.
  const existing = await db()
    .from('patients').select('id')
    .eq('hospital_id', hospitalId).eq('uhid', uhid).maybeSingle();

  let id = (existing.data as { id: string } | null)?.id ?? '';

  if (!id) {
    const { data, error } = await db().from('patients').insert({
      hospital_id: hospitalId,
      uhid,
      full_name: name,
      gender: persona.sex,
      dob: dob.toISOString().slice(0, 10),
      phone: phoneFor(caseId),
      allergies: persona.allergies?.length ? persona.allergies.join(', ') : null,
      is_active: true,
    } as never).select('id').maybeSingle();

    if (error) {
      throw new Error(
        `Creating the patient for ${caseId} (${uhid}): ${error.message}\n` +
        `Phase 5 provisions its own patient per case rather than sharing PT-QA-0001, so this ` +
        `insert is a PREREQUISITE, not the thing under test. Check that the service role key is ` +
        `set and that hospital ${hospital} exists (npm run qa:seed).`,
      );
    }
    id = (data as { id: string }).id;
  }

  const patient: P5Patient = {
    caseId, uhid, name,
    age: persona.age, sex: persona.sex,
    phone: phoneFor(caseId),
    allergies: persona.allergies ?? [],
    hospital, id, hospitalId,
  };
  cache.set(key, patient);
  return patient;
}

/**
 * Resolve a patient the seeder already created, WITHOUT creating or modifying anything.
 *
 * For the handful of cases whose premise is a patient who existed before the test opened —
 * the admitted IPD patient whose ancillary charges accrue to a running bill, the Hospital B
 * record that must stay invisible to Hospital A. Creating a fresh patient for those would make
 * the test prove something else.
 */
export async function seededPatient(
  uhid: string,
  hospital: 'A' | 'B' = 'A',
): Promise<{ id: string; hospitalId: string; uhid: string; name: string }> {
  const hospitalId = await hospitalIdFor(hospital);
  const { data, error } = await db()
    .from('patients').select('id, full_name')
    .eq('hospital_id', hospitalId).eq('uhid', uhid).maybeSingle();

  if (error) throw new Error(`Looking up seeded patient ${uhid}: ${error.message}`);
  if (!data) {
    throw new Error(
      `Seeded patient ${uhid} is not in hospital ${hospital}. Run: npm run qa:seed — this case ` +
      `deliberately reuses an existing record rather than creating one, because its premise is a ` +
      `patient who was already there.`,
    );
  }
  return {
    id: (data as { id: string }).id,
    hospitalId,
    uhid,
    name: (data as { full_name: string }).full_name,
  };
}

/**
 * Read the case ID off a Playwright test title, so a spec never repeats it as a constant.
 *
 * Mirrors `parseCaseIds()` in `e2e/reporters/tracker-reporter.ts` — the tracker maps results onto
 * cases with the same convention, so a title this cannot parse is also a result the tracker will
 * drop into `unmappedTests`. Failing loudly here catches that at authoring time.
 */
export function caseIdOf(title: string): string {
  const m = title.match(/^\s*(TC-P\d+[A-Z]-\d{1,3})/);
  if (!m) {
    throw new Error(
      `Test title "${title}" does not start with a case ID. Phase 5 derives each case's patient ` +
      `from its title, and the tracker maps results the same way — a title without an ID is a ` +
      `test whose result goes nowhere.`,
    );
  }
  const [, id] = m;
  const parts = id.match(/^TC-P(\d+)([A-Z])-(\d+)$/)!;
  return `TC-P${parts[1]}${parts[2]}-${parts[3].padStart(3, '0')}`;
}

/** The patient for the currently-running test, derived from its title. */
export async function patientForTest(
  testInfo: { title: string },
  opts: { hospital?: 'A' | 'B' } = {},
): Promise<P5Patient> {
  return ensureCasePatient(caseIdOf(testInfo.title), opts);
}
