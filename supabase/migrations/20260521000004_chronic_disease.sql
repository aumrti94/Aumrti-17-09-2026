-- Phase 5: Chronic Disease & Care Plan Management

CREATE TABLE IF NOT EXISTS care_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  condition text NOT NULL,
  icd10_code text,
  plan_type text DEFAULT 'standard' CHECK (plan_type IN ('standard', 'intensive', 'palliative')),
  start_date date DEFAULT current_date,
  review_date date,
  goals jsonb DEFAULT '{}'::jsonb,
  assigned_doctor_id uuid,
  assigned_nurse_id uuid,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS care_plan_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  care_plan_id uuid REFERENCES care_plans(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('lab_test', 'appointment', 'medication_refill', 'vitals_check', 'education', 'referral')),
  task_description text,
  due_date date,
  assigned_to uuid,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'overdue', 'cancelled')),
  completed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS medication_adherence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  care_plan_id uuid REFERENCES care_plans(id) ON DELETE SET NULL,
  drug_name text NOT NULL,
  scheduled_date date NOT NULL,
  dispensed_at timestamptz,
  adherence_status text DEFAULT 'unknown' CHECK (adherence_status IN ('taken', 'missed', 'unknown')),
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_care_plans_hospital ON care_plans(hospital_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_care_plans_patient ON care_plans(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_care_plan_tasks_due ON care_plan_tasks(hospital_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_care_plan_tasks_patient ON care_plan_tasks(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_medication_adherence_patient ON medication_adherence(patient_id, scheduled_date DESC);

-- RLS
ALTER TABLE care_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_plan_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_adherence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "care_plans_isolation" ON care_plans
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "care_plan_tasks_isolation" ON care_plan_tasks
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "medication_adherence_isolation" ON medication_adherence
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "care_plans_service_role" ON care_plans TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "care_plan_tasks_service_role" ON care_plan_tasks TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "medication_adherence_service_role" ON medication_adherence TO service_role USING (true) WITH CHECK (true);
