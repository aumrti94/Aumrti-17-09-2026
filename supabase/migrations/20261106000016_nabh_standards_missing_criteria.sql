-- Phase 5 (the five hubs) — nabh_evidence_log completeness check (PHASED_TEST_PLAN.md §8,
-- Phase 5: "for events that must produce evidence... assert the row exists. This exact silent
-- failure already happened once across ~50 call sites" — KNOWN-BUG-007, nabh_criteria never
-- seeded, logNABHEvidence() matching zero rows for months while reporting success).
--
-- Auditing every logNABHEvidence() call site (30 distinct criterion_number literals across 47
-- files) against the CURRENT nabh_standards table found KNOWN-BUG-007's exact failure mode is
-- still live, right now, at 12 of those 30 codes (40%) — including one of this Phase's own
-- three named examples, COP.8.4 (OT close / implant documentation). The
-- tg_nabh_evidence_log_known_criterion trigger does an exact string match against
-- nabh_standards.standard_code; every write using one of these 12 codes has been landing in
-- nabh_evidence_log with is_known_criterion = FALSE since the calling feature shipped — the
-- row exists, logNABHEvidence() returns { ok: true } (it never throws by design), and any
-- accreditation-readiness report that filters on known/linked evidence (the only sensible way
-- to build one) shows zero evidence for all twelve, despite staff diligently doing the work.
--
-- Two different gap shapes, found by diffing every referenced code against what exists:
--   - Five chapters (AAC, COP, FMS, HRM, MOM) already exist but simply stop numbering short of
--     what the calling code assumes: AAC.11/AAC.12, COP.8.4 (a sub-element of the EXISTING
--     COP.8), FMS.8, HRM.6/HRM.9, MOM.8.
--   - Four chapters (NFS, DIC, PCC, TMS) do not exist AT ALL — every evidence write tagged
--     with any code in these chapters (NFS.1, DIC.1, PCC.1, PCC.6, TMS.3) has been unlinked
--     since inception.
--
-- CAVEAT, stated plainly: the `description` and `level` values below are glosses written from
-- what each call site actually evidences in this codebase (the alert_message text and
-- surrounding comments), in the same one-sentence-summary style the rest of this table already
-- uses — they are NOT transcribed from an authoritative NABH standards manual, because no such
-- source was available to consult while writing this migration. `level` in particular
-- (Core/Commitment/Achievement/Excellence) feeds `nabh_hospital_compliance` scoring and is
-- guessed here at 'Achievement' (this table's most common tier) wherever there was no strong
-- signal otherwise. This closes the SCHEMA gap — evidence now links instead of vanishing into
-- an unlinked row — but the exact chapter/level/wording should be reviewed by whoever owns
-- this hospital's actual NABH accreditation submission before being relied on for real scoring.
-- Also worth a follow-up, not resolved here: NFS.1's evidenced content (NRS-2002 nutritional
-- screening) reads very close to the existing AAC.5 ("Nutritional screening is performed for
-- all admitted patients") — possibly the same real-world activity tagged under two chapters by
-- two different screens, which a domain reviewer should reconcile.

BEGIN;

-- Not ON CONFLICT (standard_code, objective_element_code) DO NOTHING: objective_element_code
-- is NULL for every row below, and NULL never equals NULL under the unique constraint's own
-- semantics, so that clause would silently re-duplicate every row on a second run instead of
-- guarding anything. An explicit existence check is the real idempotency guard here.
INSERT INTO public.nabh_standards (chapter_code, standard_code, level, description)
SELECT * FROM (VALUES
  ('AAC', 'AAC.11', 'Achievement',
   'Depression and non-communicable-disease risk screening is performed and documented for at-risk patients'),
  ('AAC', 'AAC.12', 'Achievement',
   'Post-discharge home care needs are assessed and a home care plan is documented and scheduled'),
  ('COP', 'COP.8.4', 'Achievement',
   'Implants used during a surgical procedure are documented, including registration/traceability details where applicable'),
  ('FMS', 'FMS.8', 'Achievement',
   'Cold-chain storage temperatures for vaccines and temperature-sensitive items are monitored and logged within the safe range'),
  ('HRM', 'HRM.6', 'Achievement',
   'Staff training and continuing education is completed, assessed, and certified'),
  ('HRM', 'HRM.9', 'Commitment',
   'Support is provided to staff involved in an adverse patient safety event (second-victim support)'),
  ('MOM', 'MOM.8', 'Achievement',
   'Antibiotic use outside standard protocol is justified, documented, and reviewed (antibiotic stewardship)'),
  ('NFS', 'NFS.1', 'Achievement',
   'Nutritional screening is performed using a validated tool and the resulting risk level is documented'),
  ('DIC', 'DIC.1', 'Achievement',
   'Dialysis sessions are completed and documented with dialysis adequacy (Kt/V) and machine details'),
  ('PCC', 'PCC.1', 'Core',
   'Patient rights and responsibilities are explained to, and acknowledged by, the patient'),
  ('PCC', 'PCC.6', 'Achievement',
   'Patient grievances are logged, tracked to resolution within a defined turnaround time, and satisfaction is recorded'),
  ('TMS', 'TMS.3', 'Core',
   'Blood and blood products are issued only after cross-match verification, with full traceability to the recipient patient')
) AS new_rows (chapter_code, standard_code, level, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.nabh_standards s WHERE s.standard_code = new_rows.standard_code
);

COMMIT;
