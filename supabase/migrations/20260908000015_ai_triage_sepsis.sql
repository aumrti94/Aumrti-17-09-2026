-- AI Triage Assist + Sepsis Early Warning infrastructure

-- 1. Extend nursing_vitals with NEWS2 score, supplemental O2 flag, qSOFA
ALTER TABLE nursing_vitals
  ADD COLUMN IF NOT EXISTS news2_score       NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS on_supplemental_o2 BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qsofa_score        SMALLINT;

CREATE INDEX IF NOT EXISTS idx_nursing_vitals_news2
  ON nursing_vitals(admission_id, news2_score DESC)
  WHERE news2_score IS NOT NULL;

-- 2. ai_feature_logs — general-purpose AI usage log (all modules)
CREATE TABLE IF NOT EXISTS ai_feature_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    UUID REFERENCES hospitals(id),
  patient_id     UUID REFERENCES patients(id),
  module         TEXT NOT NULL,
  feature_key    TEXT NOT NULL,
  success        BOOLEAN DEFAULT TRUE,
  input_summary  TEXT,
  output_summary TEXT,
  latency_ms     INTEGER,
  tokens_used    INTEGER,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_feature_logs_hospital
  ON ai_feature_logs(hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feature_logs_feature
  ON ai_feature_logs(feature_key);

ALTER TABLE ai_feature_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON ai_feature_logs
  USING  (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- 3. Extend ai_attestations CHECK constraint to include new features
ALTER TABLE ai_attestations
  DROP CONSTRAINT IF EXISTS ai_attestations_feature_check;

ALTER TABLE ai_attestations
  ADD CONSTRAINT ai_attestations_feature_check
  CHECK (feature IN (
    'clinical_note','discharge_summary','differential_dx',
    'icd_suggest','radiology_impression','voice_dictation',
    'executive_digest','triage_assist','sepsis_screening'
  ));

-- 4. Add new AI feature toggle flags to all hospitals
UPDATE hospitals
   SET ai_feature_flags =
       COALESCE(ai_feature_flags, '{}'::jsonb)
       || '{"triage_assist":true,"sepsis_screening":true}'::jsonb;
