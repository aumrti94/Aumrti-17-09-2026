-- Doctor attestation log for all AI-generated clinical content
CREATE TABLE IF NOT EXISTS ai_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  feature TEXT NOT NULL CHECK (feature IN (
    'clinical_note','discharge_summary','differential_dx',
    'icd_suggest','radiology_impression','voice_dictation','executive_digest'
  )),
  source_id UUID,
  ai_output JSONB,
  attested_by UUID REFERENCES users(id),
  attested_at TIMESTAMPTZ DEFAULT now(),
  edited_before_save BOOLEAN DEFAULT FALSE,
  disclaimer_shown BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_ai_attestations_hospital ON ai_attestations(hospital_id);
CREATE INDEX IF NOT EXISTS idx_ai_attestations_feature ON ai_attestations(feature);
CREATE INDEX IF NOT EXISTS idx_ai_attestations_source ON ai_attestations(source_id);
CREATE INDEX IF NOT EXISTS idx_ai_attestations_attested_by ON ai_attestations(attested_by);

ALTER TABLE ai_attestations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON ai_attestations
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Per-feature AI toggle flags stored on the hospitals row
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS ai_feature_flags JSONB DEFAULT '{
  "clinical_note": true,
  "discharge_summary": true,
  "differential_dx": true,
  "icd_suggest": true,
  "radiology_impression": true,
  "voice_dictation": true,
  "executive_digest": true
}'::jsonb;
