-- Phase 7: Patient-Facing Multilingual Voice AI

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS preferred_language text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS voice_registration_used boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS patient_voice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  session_type text,          -- registration | complaint | appointment_booking | general
  language_code text,
  transcript text,
  structured_output jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patient_voice_patient ON patient_voice_sessions(patient_id, created_at DESC);

ALTER TABLE patient_voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_voice_isolation" ON patient_voice_sessions
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "patient_voice_service_role" ON patient_voice_sessions TO service_role USING (true) WITH CHECK (true);
