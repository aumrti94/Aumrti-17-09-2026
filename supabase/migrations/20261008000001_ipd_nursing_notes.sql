-- IPD Nursing Notes — free-text nursing/progress notes recorded against an admission.
-- The app (src/components/ipd/tabs/IPDNotesTab.tsx) already reads/writes this table, but it
-- had no source-controlled schema. This migration is idempotent: where the table already
-- exists in an environment it is a no-op for the table, and policies are re-created safely.
-- Hospital-scoped isolation (any authenticated staff of the hospital), per multi-tenant rules.

CREATE TABLE IF NOT EXISTS public.ipd_nursing_notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id uuid        NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  patient_id   uuid        REFERENCES public.patients(id) ON DELETE SET NULL,
  recorded_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  note_text    text        NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inn_admission
  ON public.ipd_nursing_notes (admission_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_inn_hospital
  ON public.ipd_nursing_notes (hospital_id);

ALTER TABLE public.ipd_nursing_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inn_select" ON public.ipd_nursing_notes;
DROP POLICY IF EXISTS "inn_insert" ON public.ipd_nursing_notes;
DROP POLICY IF EXISTS "inn_update" ON public.ipd_nursing_notes;
DROP POLICY IF EXISTS "inn_delete" ON public.ipd_nursing_notes;

CREATE POLICY "inn_select" ON public.ipd_nursing_notes
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "inn_insert" ON public.ipd_nursing_notes
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "inn_update" ON public.ipd_nursing_notes
  FOR UPDATE TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "inn_delete" ON public.ipd_nursing_notes
  FOR DELETE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());
