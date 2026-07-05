-- ============================================================
-- HR — Staff grievances (corrective)
-- The prior migration used the name "grievances", which already exists as a
-- PATIENT-complaints table (migration 20260329152029). CREATE TABLE IF NOT
-- EXISTS silently skipped it, so staff grievances had no table. Use a distinct
-- table name here. Also drop the redundant policy the prior migration added to
-- the patient grievances table (its original "Hospital isolation" policy stays).
-- ============================================================

DROP POLICY IF EXISTS "grievances_hospital" ON public.grievances;

CREATE TABLE IF NOT EXISTS public.staff_grievances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  raised_by    uuid REFERENCES public.users(id),
  against_text text,
  category     text NOT NULL DEFAULT 'workplace',
    -- workplace | harassment | payroll | facilities | other
  description  text NOT NULL,
  status       text NOT NULL DEFAULT 'open',       -- open | under_review | resolved | closed
  resolution   text,
  resolved_by  uuid REFERENCES public.users(id),
  is_confidential boolean DEFAULT true,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_grievances_hospital_idx ON public.staff_grievances (hospital_id);

ALTER TABLE public.staff_grievances ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff_grievances' AND policyname = 'staff_grievances_hospital') THEN
    CREATE POLICY "staff_grievances_hospital" ON public.staff_grievances
      FOR ALL TO authenticated
      USING (hospital_id = get_user_hospital_id())
      WITH CHECK (hospital_id = get_user_hospital_id());
  END IF;
END $$;
