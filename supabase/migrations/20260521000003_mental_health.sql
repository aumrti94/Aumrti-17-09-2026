-- Phase 4: Mental Health / Psychiatry Module

CREATE TABLE IF NOT EXISTS mental_health_encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid,
  encounter_date date NOT NULL DEFAULT current_date,
  chief_complaint text,
  mental_status_exam jsonb DEFAULT '{}'::jsonb,
  diagnosis text,
  icd10_code text,
  risk_level text CHECK (risk_level IN ('low', 'moderate', 'high', 'crisis')),
  treatment_plan text,
  next_appointment date,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS psychometric_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  encounter_id uuid REFERENCES mental_health_encounters(id) ON DELETE SET NULL,
  assessment_type text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_score integer,
  severity text,
  risk_flag boolean DEFAULT false,
  administered_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS therapy_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  therapy_type text NOT NULL,
  start_date date,
  planned_sessions integer DEFAULT 10,
  completed_sessions integer DEFAULT 0,
  goals jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  therapist_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS therapy_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  plan_id uuid REFERENCES therapy_plans(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  session_date date NOT NULL DEFAULT current_date,
  session_notes text,
  techniques_used text[] DEFAULT '{}',
  patient_response text,
  homework_assigned text,
  next_session_goals text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mh_encounters_hospital ON mental_health_encounters(hospital_id, encounter_date DESC);
CREATE INDEX IF NOT EXISTS idx_mh_encounters_patient ON mental_health_encounters(patient_id, encounter_date DESC);
CREATE INDEX IF NOT EXISTS idx_psychometric_patient ON psychometric_assessments(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_therapy_plans_patient ON therapy_plans(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_therapy_sessions_plan ON therapy_sessions(plan_id, session_date DESC);

-- RLS
ALTER TABLE mental_health_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE psychometric_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapy_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapy_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mh_encounters_isolation" ON mental_health_encounters
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "psychometric_isolation" ON psychometric_assessments
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "therapy_plans_isolation" ON therapy_plans
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "therapy_sessions_isolation" ON therapy_sessions
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

-- Service role policies for edge functions
CREATE POLICY "mh_encounters_service_role" ON mental_health_encounters TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "psychometric_service_role" ON psychometric_assessments TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "therapy_plans_service_role" ON therapy_plans TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "therapy_sessions_service_role" ON therapy_sessions TO service_role USING (true) WITH CHECK (true);
