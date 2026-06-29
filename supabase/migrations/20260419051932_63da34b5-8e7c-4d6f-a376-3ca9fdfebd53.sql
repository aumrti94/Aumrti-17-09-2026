CREATE TABLE IF NOT EXISTS public.pacu_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  ot_schedule_id uuid NOT NULL,
  assessed_at timestamptz DEFAULT now(),
  activity integer CHECK (activity IN (0,1,2)),
  respiration integer CHECK (respiration IN (0,1,2)),
  circulation integer CHECK (circulation IN (0,1,2)),
  consciousness integer CHECK (consciousness IN (0,1,2)),
  spo2_score integer CHECK (spo2_score IN (0,1,2)),
  total_score integer GENERATED ALWAYS AS (
    COALESCE(activity,0) + COALESCE(respiration,0) + COALESCE(circulation,0) + COALESCE(consciousness,0) + COALESCE(spo2_score,0)
  ) STORED,
  recorded_by uuid,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.pacu_assessments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pacu_assessments_ot_schedule ON public.pacu_assessments(ot_schedule_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pacu_assessments_hospital ON public.pacu_assessments(hospital_id);

CREATE POLICY "Hospital members can view PACU assessments"
  ON public.pacu_assessments FOR SELECT
  USING (hospital_id IN (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Hospital members can insert PACU assessments"
  ON public.pacu_assessments FOR INSERT
  WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Hospital members can update PACU assessments"
  ON public.pacu_assessments FOR UPDATE
  USING (hospital_id IN (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Hospital members can delete PACU assessments"
  ON public.pacu_assessments FOR DELETE
  USING (hospital_id IN (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()));