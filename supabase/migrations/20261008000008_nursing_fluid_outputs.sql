-- nursing_fluid_outputs: persists non-IV fluid outputs (drain, vomitus, nasogastric, etc.)
-- previously IOChartTab only stored these in React state (lost on refresh).

CREATE TABLE IF NOT EXISTS public.nursing_fluid_outputs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id  uuid        NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  output_type   text        NOT NULL CHECK (output_type IN ('drain','vomitus','nasogastric','surgical','other')),
  volume_ml     integer     NOT NULL CHECK (volume_ml > 0),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  recorded_by   uuid        REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nursing_fluid_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_staff_rw" ON public.nursing_fluid_outputs
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS nursing_fluid_outputs_admission_idx
  ON public.nursing_fluid_outputs (admission_id, recorded_at DESC);
