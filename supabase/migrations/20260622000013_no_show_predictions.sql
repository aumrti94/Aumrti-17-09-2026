-- no_show_predictions: stores AI-generated no-show risk scores for OPD tokens
CREATE TABLE IF NOT EXISTS public.no_show_predictions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id    UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  token_id      UUID REFERENCES public.opd_tokens(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.opd_tokens(id) ON DELETE SET NULL,
  risk_score    INTEGER CHECK (risk_score BETWEEN 0 AND 100),
  risk_level    TEXT CHECK (risk_level IN ('low', 'medium', 'high')),
  risk_factors  JSONB DEFAULT '[]'::jsonb,
  outcome       TEXT CHECK (outcome IN ('attended', 'no_show')),
  reminder_sent BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_no_show_predictions_patient ON public.no_show_predictions(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_no_show_predictions_token  ON public.no_show_predictions(token_id);
CREATE INDEX IF NOT EXISTS idx_no_show_predictions_appt   ON public.no_show_predictions(appointment_id);

ALTER TABLE public.no_show_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no_show_predictions_all" ON public.no_show_predictions;

CREATE POLICY "no_show_predictions_all" ON public.no_show_predictions
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
