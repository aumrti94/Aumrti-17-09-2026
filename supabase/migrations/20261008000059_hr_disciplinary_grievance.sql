-- ============================================================
-- HR — Disciplinary Actions & Grievance Management
-- ============================================================

CREATE TABLE IF NOT EXISTS public.disciplinary_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id),
  action_type   text NOT NULL DEFAULT 'verbal_warning',
    -- verbal_warning | written_warning | counselling | suspension | termination
  severity      text NOT NULL DEFAULT 'minor',   -- minor | major | critical
  incident_date date,
  description   text NOT NULL,
  action_taken  text,
  status        text NOT NULL DEFAULT 'open',     -- open | under_review | closed
  raised_by     uuid REFERENCES public.users(id),
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.grievances (
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

CREATE INDEX IF NOT EXISTS disciplinary_user_idx ON public.disciplinary_actions (user_id);
CREATE INDEX IF NOT EXISTS grievances_hospital_idx ON public.grievances (hospital_id);

ALTER TABLE public.disciplinary_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grievances           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['disciplinary_actions','grievances'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_hospital') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());',
        t || '_hospital', t);
    END IF;
  END LOOP;
END $$;
