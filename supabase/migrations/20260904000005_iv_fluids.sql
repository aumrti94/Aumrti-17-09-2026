-- IV fluid infusion tracking table
CREATE TABLE IF NOT EXISTS iv_fluids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id uuid REFERENCES admissions(id) ON DELETE CASCADE,
  fluid_name text NOT NULL,
  fluid_type text DEFAULT 'maintenance' CHECK (fluid_type IN ('maintenance', 'replacement', 'medication', 'blood_product', 'tpn')),
  rate_ml_per_hour int,
  total_volume_ml int,
  volume_infused_ml int DEFAULT 0,
  started_at timestamptz,
  expected_end_at timestamptz,
  status text DEFAULT 'running' CHECK (status IN ('running', 'completed', 'on_hold', 'discontinued')),
  recorded_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iv_fluids_admission ON iv_fluids(admission_id, status);
CREATE INDEX IF NOT EXISTS idx_iv_fluids_hospital ON iv_fluids(hospital_id, status);

ALTER TABLE iv_fluids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_staff_iv_fluids" ON iv_fluids
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );
