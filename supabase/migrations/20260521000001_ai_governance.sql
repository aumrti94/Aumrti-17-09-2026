-- AI Governance: audit trail for all AI suggestions and clinician decisions
-- Phase 1 of Gap-Filling Plan

CREATE TABLE IF NOT EXISTS ai_suggestions_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid,
  feature_key text NOT NULL,
  ai_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reasoning text,
  user_action text CHECK (user_action IN ('accepted','overridden','rejected','flagged')),
  override_value jsonb,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_hospital_feature
  ON ai_suggestions_audit(hospital_id, feature_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_patient
  ON ai_suggestions_audit(patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;

ALTER TABLE ai_suggestions_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_audit_hospital_isolation" ON ai_suggestions_audit
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

-- Allow service role full access (for edge functions)
CREATE POLICY "ai_audit_service_role" ON ai_suggestions_audit
  TO service_role USING (true) WITH CHECK (true);
