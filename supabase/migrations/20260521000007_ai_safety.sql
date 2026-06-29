-- Phase 9: AI Safety / Hallucination Guard

CREATE TABLE IF NOT EXISTS ai_safety_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid,
  feature_key text NOT NULL,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  was_overridden boolean DEFAULT false,
  overridden_by uuid,
  override_reason text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_safety_hospital ON ai_safety_flags(hospital_id, feature_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_safety_patient ON ai_safety_flags(patient_id) WHERE patient_id IS NOT NULL;

ALTER TABLE ai_safety_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_safety_isolation" ON ai_safety_flags
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "ai_safety_service_role" ON ai_safety_flags TO service_role USING (true) WITH CHECK (true);
