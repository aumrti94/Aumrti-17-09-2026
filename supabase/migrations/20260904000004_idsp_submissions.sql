-- IDSP disease alert submission tracking
CREATE TABLE IF NOT EXISTS idsp_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id),
  disease_code text NOT NULL,
  disease_name text,
  submitted_at timestamptz DEFAULT now(),
  acknowledgment_ref text,
  status text DEFAULT 'submitted' CHECK (status IN ('submitted', 'acknowledged', 'failed')),
  raw_response jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idsp_submissions_hospital
  ON idsp_submissions(hospital_id, submitted_at DESC);

ALTER TABLE idsp_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_staff_idsp" ON idsp_submissions
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );
