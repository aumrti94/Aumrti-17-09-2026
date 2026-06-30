-- Clinical Note Templates — per-user reusable templates for clinical notes.
-- Doctors: Ward Round SOAP templates (body = { s, o, a, p }).
-- Nurses:  Nursing note templates    (body = { text }).
-- Personal by default; is_shared = true makes a template visible hospital-wide
-- (read-only to everyone except its owner).

CREATE TABLE IF NOT EXISTS public.clinical_note_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  created_by  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  note_type   text        NOT NULL CHECK (note_type IN ('ward_round', 'nursing')),
  name        text        NOT NULL,
  body        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_shared   boolean     NOT NULL DEFAULT false,
  is_active   boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cnt_owner
  ON public.clinical_note_templates (created_by, note_type);
CREATE INDEX IF NOT EXISTS idx_cnt_shared
  ON public.clinical_note_templates (hospital_id, note_type, is_shared);

ALTER TABLE public.clinical_note_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cnt_select" ON public.clinical_note_templates;
DROP POLICY IF EXISTS "cnt_insert" ON public.clinical_note_templates;
DROP POLICY IF EXISTS "cnt_update" ON public.clinical_note_templates;
DROP POLICY IF EXISTS "cnt_delete" ON public.clinical_note_templates;

-- SELECT: my own templates OR any shared template within my hospital.
CREATE POLICY "cnt_select" ON public.clinical_note_templates
  FOR SELECT TO authenticated
  USING (
    hospital_id = public.get_user_hospital_id()
    AND (
      is_shared = true
      OR created_by = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );

-- INSERT / UPDATE / DELETE: owner only, within my hospital.
CREATE POLICY "cnt_insert" ON public.clinical_note_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by  = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND hospital_id = public.get_user_hospital_id()
  );

CREATE POLICY "cnt_update" ON public.clinical_note_templates
  FOR UPDATE TO authenticated
  USING (
    created_by  = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND hospital_id = public.get_user_hospital_id()
  )
  WITH CHECK (
    created_by  = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND hospital_id = public.get_user_hospital_id()
  );

CREATE POLICY "cnt_delete" ON public.clinical_note_templates
  FOR DELETE TO authenticated
  USING (
    created_by  = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND hospital_id = public.get_user_hospital_id()
  );
