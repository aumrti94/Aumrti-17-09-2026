-- =============================================================================
-- Fall Risk Assessment (Morse Fall Scale)
-- Required for NABH COP.4 — patient safety / risk assessment on every admission
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fall_risk_assessments (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id               uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id                uuid        NOT NULL REFERENCES public.patients(id),
  admission_id              uuid        REFERENCES public.admissions(id),
  assessed_by               uuid        REFERENCES public.users(id),

  -- Morse Fall Scale 6 criteria
  fall_history              integer     NOT NULL DEFAULT 0 CHECK (fall_history IN (0, 25)),
  secondary_diagnosis       integer     NOT NULL DEFAULT 0 CHECK (secondary_diagnosis IN (0, 15)),
  ambulatory_aid            integer     NOT NULL DEFAULT 0 CHECK (ambulatory_aid IN (0, 15, 30)),
  iv_therapy                integer     NOT NULL DEFAULT 0 CHECK (iv_therapy IN (0, 20)),
  gait                      integer     NOT NULL DEFAULT 0 CHECK (gait IN (0, 10, 20)),
  mental_status             integer     NOT NULL DEFAULT 0 CHECK (mental_status IN (0, 15)),

  morse_score               integer     GENERATED ALWAYS AS (
    fall_history + secondary_diagnosis + ambulatory_aid + iv_therapy + gait + mental_status
  ) STORED,

  risk_level                text        GENERATED ALWAYS AS (
    CASE
      WHEN (fall_history + secondary_diagnosis + ambulatory_aid + iv_therapy + gait + mental_status) >= 45 THEN 'high'
      WHEN (fall_history + secondary_diagnosis + ambulatory_aid + iv_therapy + gait + mental_status) >= 25 THEN 'medium'
      ELSE 'low'
    END
  ) STORED,

  assessment_date           date        NOT NULL DEFAULT CURRENT_DATE,
  reassessment_due          date,
  fall_precautions_initiated boolean    NOT NULL DEFAULT false,
  precautions_notes         text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fall_risk_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.fall_risk_assessments
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE INDEX IF NOT EXISTS idx_fall_risk_hospital_patient
  ON public.fall_risk_assessments(hospital_id, patient_id, assessment_date DESC);

CREATE INDEX IF NOT EXISTS idx_fall_risk_admission
  ON public.fall_risk_assessments(admission_id) WHERE admission_id IS NOT NULL;
