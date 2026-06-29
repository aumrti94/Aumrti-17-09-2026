-- NABL Lab Calibration Records

CREATE TABLE IF NOT EXISTS lab_calibration_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  analyzer_name text NOT NULL,
  calibration_date date NOT NULL,
  next_calibration_date date NOT NULL,
  calibrated_by text,
  calibration_type text NOT NULL DEFAULT 'internal', -- internal | external | manufacturer | iqc
  pass_fail text NOT NULL DEFAULT 'pass' CHECK (pass_fail IN ('pass', 'fail', 'acceptable')),
  deviation_percent numeric(6,2),
  certificate_number text,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lab_calibration_hospital ON lab_calibration_records(hospital_id, next_calibration_date);

ALTER TABLE lab_calibration_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_lab_calibration" ON lab_calibration_records
  USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));
