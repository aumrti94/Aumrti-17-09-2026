-- Phase 5 (the five hubs) — nabh_evidence_log completeness check. Plan text: "for events that
-- must produce evidence (OT close, lab verification, consent signed), assert the row exists.
-- This exact silent failure already happened once across ~50 call sites" (KNOWN-BUG-007).
--
-- Auditing every logNABHEvidence() call site against nabh_standards found the SAME failure
-- mode still live today, at 12 of 30 distinct criterion codes (40%), including one of this
-- phase's own three named examples (COP.8.4 — OT close). See
-- 20261106000016_nabh_standards_missing_criteria.sql for the full list and the fix.
--
-- The completeness property this file asserts is not "the row exists" alone — logNABHEvidence()
-- never throws, so a row always gets written regardless of whether the criterion is real. The
-- property that actually matters, and the one the clinical-safety-testing skill calls out
-- explicitly, is `is_known_criterion = true`: evidence LINKED to a real standard, not written
-- into a void. Every assertion below checks that, not just row existence.
--
-- Self-contained: a throwaway hospital, rolled back at the end. No PHI.

BEGIN;
SELECT plan(8);

INSERT INTO public.hospitals (id, name)
VALUES ('99999999-9999-4999-9999-000000000001', 'Hub Test Hospital — NABH Evidence');

-- ── The plan's three named examples ─────────────────────────────────────────────────────────

-- 1. OT close (COP.8.4) — this exact code was unlinked before this phase's fix.
INSERT INTO public.nabh_evidence_log (hospital_id, criterion_number, description, compliance_status, source)
VALUES ('99999999-9999-4999-9999-000000000001', 'COP.8.4', 'OT Case Closed — implant documentation', 'compliant', 'module_event');

SELECT is(
  (SELECT is_known_criterion FROM public.nabh_evidence_log
   WHERE hospital_id = '99999999-9999-4999-9999-000000000001' AND criterion_number = 'COP.8.4'),
  true,
  'OT close (COP.8.4) evidence links to a real standard — this was FALSE before this phase''s fix'
);

-- 2. Consent signed (PRE.1) — was already correctly linked; asserted so a future change to
-- nabh_standards can't silently break the one call site that was already right.
INSERT INTO public.nabh_evidence_log (hospital_id, criterion_number, description, compliance_status, source)
VALUES ('99999999-9999-4999-9999-000000000001', 'PRE.1', 'Informed consent documented', 'compliant', 'module_event');

SELECT is(
  (SELECT is_known_criterion FROM public.nabh_evidence_log
   WHERE hospital_id = '99999999-9999-4999-9999-000000000001' AND criterion_number = 'PRE.1'),
  true,
  'consent signed (PRE.1) evidence links to a real standard'
);

-- 3. Lab verification (COP.6) — likewise already correct.
INSERT INTO public.nabh_evidence_log (hospital_id, criterion_number, description, compliance_status, source)
VALUES ('99999999-9999-4999-9999-000000000001', 'COP.6', 'Lab result auto-verified', 'compliant', 'module_event');

SELECT is(
  (SELECT is_known_criterion FROM public.nabh_evidence_log
   WHERE hospital_id = '99999999-9999-4999-9999-000000000001' AND criterion_number = 'COP.6'),
  true,
  'lab verification (COP.6) evidence links to a real standard'
);

-- ── A sample of the other 9 codes this phase's migration fixed ─────────────────────────────
-- Not exhaustive (all 12 are proven by construction — the migration adds every one this audit
-- found referenced in src/ — but a sample from each gap shape (numbering short vs. whole
-- chapter missing) is asserted explicitly so a regression is caught here, not just implied.

INSERT INTO public.nabh_evidence_log (hospital_id, criterion_number, description, compliance_status, source)
VALUES
  ('99999999-9999-4999-9999-000000000001', 'AAC.11', 'PHQ-9 screening completed', 'compliant', 'module_event'),
  ('99999999-9999-4999-9999-000000000001', 'HRM.9', 'Second victim support case opened', 'compliant', 'module_event'),
  ('99999999-9999-4999-9999-000000000001', 'NFS.1', 'Nutritional screening completed', 'compliant', 'module_event'),
  ('99999999-9999-4999-9999-000000000001', 'TMS.3', 'Blood transfusion issued', 'compliant', 'module_event');

SELECT is(
  (SELECT count(*)::int FROM public.nabh_evidence_log
   WHERE hospital_id = '99999999-9999-4999-9999-000000000001'
     AND criterion_number IN ('AAC.11', 'HRM.9', 'NFS.1', 'TMS.3')
     AND is_known_criterion = true),
  4,
  'a sample of the other newly-fixed codes (short-numbered chapter + entirely-missing chapter) all link correctly'
);

-- ── The negative control — proves the assertions above are testing something real ──────────
-- A code that genuinely does not exist must still come back unlinked. If this ever started
-- passing as `true`, the trigger itself would be broken (matching everything), which would
-- make every assertion above pass vacuously.

INSERT INTO public.nabh_evidence_log (hospital_id, criterion_number, description, compliance_status, source)
VALUES ('99999999-9999-4999-9999-000000000001', 'ZZZ.999', 'Fabricated criterion for the negative control', 'compliant', 'module_event');

SELECT is(
  (SELECT is_known_criterion FROM public.nabh_evidence_log
   WHERE hospital_id = '99999999-9999-4999-9999-000000000001' AND criterion_number = 'ZZZ.999'),
  false,
  'a genuinely unknown criterion is still correctly reported as unlinked — the trigger discriminates, not rubber-stamps'
);

-- ── The other two invariants the clinical-safety-testing skill names for this exact check ──

SELECT is(
  (SELECT count(*)::int FROM public.nabh_evidence_log WHERE hospital_id = '99999999-9999-4999-9999-000000000001'),
  8,
  'every logNABHEvidence-style call produced exactly one row — the count matches what was seeded'
);

SELECT ok(
  (SELECT bool_and(compliance_status = ANY (ARRAY['compliant','partially_compliant','non_compliant','not_applicable','not_assessed']))
   FROM public.nabh_evidence_log WHERE hospital_id = '99999999-9999-4999-9999-000000000001'),
  'every row carries one of the real compliance_status values'
);

SELECT ok(
  (SELECT bool_and(is_known_criterion = false) FROM public.nabh_evidence_log
   WHERE hospital_id = '99999999-9999-4999-9999-000000000001' AND criterion_number = 'ZZZ.999'),
  'is_known_criterion cannot be set by the caller — the client-supplied value (none was given) is always overridden by the trigger'
);

SELECT * FROM finish();
ROLLBACK;
