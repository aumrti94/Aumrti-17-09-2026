-- Phase 10: Persistent Patient AI Memory

CREATE TABLE IF NOT EXISTS patient_ai_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  chronic_conditions text[] DEFAULT '{}',
  known_allergies text[] DEFAULT '{}',
  current_medications text[] DEFAULT '{}',
  recent_diagnoses text[] DEFAULT '{}',
  past_surgeries text[] DEFAULT '{}',
  risk_flags text[] DEFAULT '{}',
  context_summary text,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (hospital_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_ai_context_patient ON patient_ai_context(patient_id);

ALTER TABLE patient_ai_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_ai_context_isolation" ON patient_ai_context
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "patient_ai_context_service_role" ON patient_ai_context TO service_role USING (true) WITH CHECK (true);
