-- Phase 5 (the five hubs) — patients.id, "the hub with no analysis yet: a record whose
-- patient_id no longer resolves — merged/deduplicated patients, records created before a
-- merge and never repointed" (PHASED_TEST_PLAN.md §8, Phase 5).
--
-- There is no patient-merge feature anywhere in this codebase (confirmed by search) — the
-- theoretical "merge left a dangling patient_id" risk the plan names does not exist yet in
-- practice. What DOES exist, found doing this hub's actual analysis: 16 tables carry a
-- `patient_id uuid` column with NO foreign key to `patients(id)` at all, so nothing has ever
-- stopped a `patient_id` in these tables from pointing at a patient that never existed, a typo,
-- or (once a merge tool is ever built) a patient later merged away. This is the identical risk
-- the plan describes, just reachable today by a much more ordinary path than a merge feature.
--
-- Confirmed table-by-table by reading each CREATE TABLE statement directly (not a heuristic
-- guess): care_plans, care_plan_tasks, medication_adherence (chronic-disease module),
-- mental_health_encounters, psychometric_assessments, therapy_plans, therapy_sessions (mental
-- health module), patient_ai_context, patient_voice_sessions, guideline_adherence_log,
-- ai_safety_flags, ai_suggestions_audit, mar_records, esi_beneficiaries,
-- arogyasri_enrollments, govt_scheme_claims (government scheme integrations).
--
-- `ai_suggestions_audit.user_id REFERENCES auth.users(id)` was also noticed in the same file —
-- the same auth.users-vs-public.users FK bug as KNOWN-BUG-122/125, evading `check:user-fk`
-- because the column is named `user_id`, not `*_by`. Logged separately, not fixed here — this
-- migration's scope is the patients.id hub.
--
-- NOT VALID, not validated here, and deliberately so: a live cloud database this old, with
-- zero enforcement on these columns since each table's own creation, may already hold rows
-- with a patient_id that doesn't exist. Adding the constraint NOT VALID closes the gap for
-- every future write immediately (fast, low-lock, matches 20260607000003's precedent) without
-- risking a failed deploy if such rows already exist. Running VALIDATE CONSTRAINT — and fixing
-- whatever it finds — is separate follow-up work once someone can inspect the live data.

BEGIN;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('care_plans'),
    ('care_plan_tasks'),
    ('medication_adherence'),
    ('mental_health_encounters'),
    ('psychometric_assessments'),
    ('therapy_plans'),
    ('therapy_sessions'),
    ('patient_ai_context'),
    ('patient_voice_sessions'),
    ('guideline_adherence_log'),
    ('ai_safety_flags'),
    ('ai_suggestions_audit'),
    ('mar_records'),
    ('esi_beneficiaries'),
    ('arogyasri_enrollments'),
    ('govt_scheme_claims')
  ) AS x(table_name)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t.table_name)
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE cl.relname = t.table_name AND c.contype = 'f' AND a.attname = 'patient_id'
       )
    THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE NOT VALID',
        t.table_name, t.table_name || '_patient_id_fkey'
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
