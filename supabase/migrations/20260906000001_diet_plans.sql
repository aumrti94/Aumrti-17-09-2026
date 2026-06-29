-- Diet plans migration file
-- Applied: 2026-05-08
-- Table: diet_plans
-- Purpose: Stores AI-generated 7-day therapeutic meal plans

CREATE TABLE IF NOT EXISTS diet_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  admission_id uuid REFERENCES admissions(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id),
  diagnosis text,
  plan_for_days int DEFAULT 7,
  plan_content text NOT NULL,
  ai_generated boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE diet_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_diet_plans"
  ON diet_plans
  FOR ALL
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_diet_plans_hospital_admission
  ON diet_plans(hospital_id, admission_id);
