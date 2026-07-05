-- ============================================================
-- HR — Recruitment & Onboarding (ATS-lite)
-- Job openings, applicant pipeline, and onboarding checklist.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_openings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  title           text NOT NULL,
  department_id   uuid REFERENCES public.departments(id),
  positions_count int  NOT NULL DEFAULT 1,
  employment_type text DEFAULT 'permanent',
  status          text NOT NULL DEFAULT 'open',   -- open | closed
  description     text,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_applicants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  job_opening_id uuid REFERENCES public.job_openings(id) ON DELETE SET NULL,
  full_name      text NOT NULL,
  email          text,
  phone          text,
  resume_url     text,
  stage          text NOT NULL DEFAULT 'applied',
    -- applied | screened | interviewed | offered | hired | rejected
  rating         int,
  notes          text,
  hired_user_id  uuid REFERENCES public.users(id),
  applied_at     timestamptz DEFAULT now(),
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  applicant_id uuid REFERENCES public.job_applicants(id) ON DELETE CASCADE,
  task_label   text NOT NULL,
  category     text DEFAULT 'general',
  is_done      boolean DEFAULT false,
  done_at      timestamptz,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_applicants_opening_idx ON public.job_applicants (job_opening_id);
CREATE INDEX IF NOT EXISTS job_applicants_hospital_idx ON public.job_applicants (hospital_id);
CREATE INDEX IF NOT EXISTS onboarding_tasks_applicant_idx ON public.onboarding_tasks (applicant_id);

ALTER TABLE public.job_openings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applicants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_tasks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_openings','job_applicants','onboarding_tasks'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_hospital') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());',
        t || '_hospital', t);
    END IF;
  END LOOP;
END $$;
