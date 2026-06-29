-- Doctor-Level Quick-Pick Personalization
-- One row per doctor per category. Items stored as JSONB array.
-- complaints / exam_findings / diagnoses: items is string[]
-- rx_templates: items is RxQuickPickTemplate[]

CREATE TABLE IF NOT EXISTS public.doctor_quick_picks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  doctor_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category    text        NOT NULL
    CHECK (category IN ('complaints', 'exam_findings', 'diagnoses', 'rx_templates')),
  items       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, category)
);

CREATE INDEX IF NOT EXISTS idx_doctor_quick_picks_doctor
  ON public.doctor_quick_picks (doctor_id, category);
CREATE INDEX IF NOT EXISTS idx_doctor_quick_picks_hospital
  ON public.doctor_quick_picks (hospital_id);

ALTER TABLE public.doctor_quick_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dqp_select" ON public.doctor_quick_picks;
DROP POLICY IF EXISTS "dqp_insert" ON public.doctor_quick_picks;
DROP POLICY IF EXISTS "dqp_update" ON public.doctor_quick_picks;
DROP POLICY IF EXISTS "dqp_delete" ON public.doctor_quick_picks;

CREATE POLICY "dqp_select" ON public.doctor_quick_picks
  FOR SELECT TO authenticated
  USING (
    doctor_id   = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND hospital_id = public.get_user_hospital_id()
  );

CREATE POLICY "dqp_insert" ON public.doctor_quick_picks
  FOR INSERT TO authenticated
  WITH CHECK (
    doctor_id   = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND hospital_id = public.get_user_hospital_id()
  );

CREATE POLICY "dqp_update" ON public.doctor_quick_picks
  FOR UPDATE TO authenticated
  USING (
    doctor_id   = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND hospital_id = public.get_user_hospital_id()
  )
  WITH CHECK (
    doctor_id   = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND hospital_id = public.get_user_hospital_id()
  );

CREATE POLICY "dqp_delete" ON public.doctor_quick_picks
  FOR DELETE TO authenticated
  USING (
    doctor_id   = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND hospital_id = public.get_user_hospital_id()
  );
