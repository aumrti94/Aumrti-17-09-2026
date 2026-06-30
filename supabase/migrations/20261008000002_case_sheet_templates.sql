-- Case Sheet Templates — hospital-wide reusable ward-round/case-sheet templates.
-- The app (src/components/ipd/tabs/IPDWardRoundTab.tsx) already reads this table, but it
-- had no source-controlled schema. Idempotent: no-op where the table already exists.
-- `fields` holds the template structure as a jsonb array of { label, value } objects.
-- Hospital-scoped (shared across all staff of the hospital).

CREATE TABLE IF NOT EXISTS public.case_sheet_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  fields      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  is_active   boolean     NOT NULL DEFAULT true,
  created_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cst_hospital
  ON public.case_sheet_templates (hospital_id, is_active);

ALTER TABLE public.case_sheet_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cst_select" ON public.case_sheet_templates;
DROP POLICY IF EXISTS "cst_insert" ON public.case_sheet_templates;
DROP POLICY IF EXISTS "cst_update" ON public.case_sheet_templates;
DROP POLICY IF EXISTS "cst_delete" ON public.case_sheet_templates;

CREATE POLICY "cst_select" ON public.case_sheet_templates
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "cst_insert" ON public.case_sheet_templates
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "cst_update" ON public.case_sheet_templates
  FOR UPDATE TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "cst_delete" ON public.case_sheet_templates
  FOR DELETE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());
