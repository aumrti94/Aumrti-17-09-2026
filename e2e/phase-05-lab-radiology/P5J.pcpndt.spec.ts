/**
 * Phase 5 · Section 5J PCPNDT
 *
 * DECLARED, NOT YET IMPLEMENTED — Batch 2.
 *
 * These journeys are fully specified in `p5-manifest.ts`: stages, roles, patient, timeout class
 * and Supabase-verify targets are all written, and `docs/qa/cases/phase-05-lab-radiology.csv`
 * carries them as tracker rows so a tester can walk them manually today. What is missing is the
 * automation.
 *
 * They are `test.fixme` rather than absent on purpose. An absent test would break the 1:1
 * CSV-to-spec parity the phase gate depends on and — worse — would let the radiology half of the
 * phase quietly vanish from the tracker while a 16-for-16 run looked clean. As fixme they report
 * N/A, which is the honest answer: not run, not passed, not forgotten.
 *
 * Batch 1 (sections A–H, the lab chain) is implemented and runnable. Replace each fixme below with
 * a real journey in the same `jrn.next()` shape as `P5A.outpatient-lab.spec.ts`.
 */
import { test } from './p5-journey.fixture';
import { testTitle } from './p5-manifest';

test.describe('5J PCPNDT', () => {
  test.fixme(testTitle('TC-P5J-001'), async () => {
    // 12 stages are declared for this journey in p5-manifest.ts, and the CSV
    // row carries them as numbered steps a tester can follow by hand today.
  });

  test.fixme(testTitle('TC-P5J-002'), async () => {
    // 10 stages are declared for this journey in p5-manifest.ts, and the CSV
    // row carries them as numbered steps a tester can follow by hand today.
  });
});
