-- Chronic Disease Management — restore the missing relational wiring.
--
-- 20260521000004_chronic_disease.sql created care_plans / care_plan_tasks /
-- medication_adherence with hospital_id and patient_id as bare uuid columns and
-- NO foreign keys. Without an FK, PostgREST cannot resolve the embed
--   .select("*, patients(full_name, uhid, dob)")
-- and returns PGRST200, so /chronic-disease listed zero plans no matter how many
-- rows existed. This migration adds the constraints, brings the tables in line
-- with the rest of the clinical schema, and bridges to chronic_disease_programs.
--
-- Safety: chronic_disease_programs is NOT modified. Every FK is added NOT VALID
-- then validated separately, so a pre-existing orphan row cannot fail the
-- migration or block writes. Every statement is idempotent and re-runnable.
-- New columns are nullable or defaulted — no NOT NULL added to populated tables.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: add a FK only if a constraint of that name does not already exist
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.__add_fk_if_absent(
  p_table       text,
  p_constraint  text,
  p_column      text,
  p_ref_table   text
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = p_constraint
      AND conrelid = format('public.%I', p_table)::regclass
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) NOT VALID',
      p_table, p_constraint, p_column, p_ref_table
    );
  END IF;
END;
$$;

-- ── care_plans ───────────────────────────────────────────────────────────────
SELECT public.__add_fk_if_absent('care_plans', 'care_plans_hospital_id_fkey',       'hospital_id',       'hospitals');
SELECT public.__add_fk_if_absent('care_plans', 'care_plans_patient_id_fkey',        'patient_id',        'patients');
SELECT public.__add_fk_if_absent('care_plans', 'care_plans_assigned_doctor_id_fkey','assigned_doctor_id','users');
SELECT public.__add_fk_if_absent('care_plans', 'care_plans_assigned_nurse_id_fkey', 'assigned_nurse_id', 'users');

-- ── care_plan_tasks (care_plan_id FK already exists from the original migration)
SELECT public.__add_fk_if_absent('care_plan_tasks', 'care_plan_tasks_hospital_id_fkey', 'hospital_id', 'hospitals');
SELECT public.__add_fk_if_absent('care_plan_tasks', 'care_plan_tasks_patient_id_fkey',  'patient_id',  'patients');
SELECT public.__add_fk_if_absent('care_plan_tasks', 'care_plan_tasks_assigned_to_fkey', 'assigned_to', 'users');

-- ── medication_adherence ─────────────────────────────────────────────────────
SELECT public.__add_fk_if_absent('medication_adherence', 'medication_adherence_hospital_id_fkey', 'hospital_id', 'hospitals');
SELECT public.__add_fk_if_absent('medication_adherence', 'medication_adherence_patient_id_fkey',  'patient_id',  'patients');

-- ─────────────────────────────────────────────────────────────────────────────
-- Columns to match the conventions every other clinical table follows
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.care_plans
  ADD COLUMN IF NOT EXISTS is_deleted  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by  uuid,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now();

SELECT public.__add_fk_if_absent('care_plans', 'care_plans_created_by_fkey', 'created_by', 'users');

ALTER TABLE public.care_plan_tasks
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Bridge to the OPD chronic enrolment model.
--
-- chronic_disease_programs (OPD Consultation → ChronicDiseaseSection, the
-- dashboard follow-up alert, CRM) and care_plans (the /chronic-disease module)
-- have been two islands. program_id links a care plan back to the enrolment it
-- came from. Nullable — plans created without an enrolment stay valid, and
-- chronic_disease_programs itself is untouched.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.care_plans
  ADD COLUMN IF NOT EXISTS program_id uuid;

SELECT public.__add_fk_if_absent('care_plans', 'care_plans_program_id_fkey', 'program_id', 'chronic_disease_programs');

CREATE INDEX IF NOT EXISTS idx_care_plans_program
  ON public.care_plans(program_id) WHERE program_id IS NOT NULL;

-- Supports the "enrolled but no care plan" cohort query on the dashboard
CREATE INDEX IF NOT EXISTS idx_care_plans_hospital_patient_status
  ON public.care_plans(hospital_id, patient_id, status);

-- Supports the hospital-wide "tasks due today / overdue" KPIs
CREATE INDEX IF NOT EXISTS idx_care_plan_tasks_hospital_status_due
  ON public.care_plan_tasks(hospital_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_medication_adherence_plan
  ON public.medication_adherence(hospital_id, care_plan_id, scheduled_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- care_plan_reviews — one row per completed chronic review.
--
-- A chronic care plan is reviewed repeatedly (every ~3 months). Billing the
-- review against care_plans directly would be wrong twice over: care_plans has
-- no billing_status column for autoChargeService's duplicate guard to read, and
-- marking the PLAN as billed would block every subsequent review's charge.
-- The review is the billable event, so it gets its own record — which also
-- gives NABH a dated, attributable review trail instead of an overwritten
-- review_date column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.care_plan_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id),
  care_plan_id     uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  patient_id       uuid NOT NULL REFERENCES public.patients(id),
  reviewed_by      uuid REFERENCES public.users(id),
  review_date      date NOT NULL DEFAULT current_date,
  next_review_date date,
  findings         text,
  billing_status   text NOT NULL DEFAULT 'unbilled'
                     CHECK (billing_status IN ('unbilled','billed','waived')),
  bill_id          uuid REFERENCES public.bills(id),
  billed_at        timestamptz,
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_care_plan_reviews_plan
  ON public.care_plan_reviews(hospital_id, care_plan_id, review_date DESC);
CREATE INDEX IF NOT EXISTS idx_care_plan_reviews_billing
  ON public.care_plan_reviews(hospital_id, billing_status);

ALTER TABLE public.care_plan_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'care_plan_reviews'
      AND policyname = 'care_plan_reviews_hospital_isolation'
  ) THEN
    -- Uses the hardened SECURITY DEFINER helper, matching the rest of the schema
    -- (see the note at the foot of this file about the older chronic policies).
    CREATE POLICY "care_plan_reviews_hospital_isolation" ON public.care_plan_reviews
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'care_plan_reviews'
      AND policyname = 'care_plan_reviews_service_role'
  ) THEN
    CREATE POLICY "care_plan_reviews_service_role" ON public.care_plan_reviews
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Validate the constraints. Separated from ADD so the write lock is brief and
-- an orphan row surfaces as a clear validation error rather than a failed DDL.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND NOT convalidated
      AND conrelid IN (
        'public.care_plans'::regclass,
        'public.care_plan_tasks'::regclass,
        'public.medication_adherence'::regclass
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN foreign_key_violation THEN
      -- Leave it NOT VALID: it still enforces on all NEW rows, which is what the
      -- PostgREST embed needs. Pre-existing orphans are reported, not deleted.
      RAISE WARNING 'Constraint % on % left NOT VALID — orphan rows exist. Reconcile before validating.', c.conname, c.tbl;
    END;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.__add_fk_if_absent(text, text, text, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE for @ananya (security review): the RLS policies created in
-- 20260521000004_chronic_disease.sql use an inline
--   (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
-- subquery, whereas every other table uses public.get_user_hospital_id().
-- Functionally equivalent but it bypasses that helper's SECURITY DEFINER /
-- search_path hardening. Deliberately NOT changed here — altering a live RLS
-- policy is out of scope for this migration. Track separately.
-- ─────────────────────────────────────────────────────────────────────────────
