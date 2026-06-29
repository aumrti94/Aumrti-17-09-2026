-- Shift-wise nursing vitals (NABH nursing kardex)
CREATE TABLE IF NOT EXISTS nursing_vitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  admission_id UUID REFERENCES admissions(id),
  patient_id UUID REFERENCES patients(id),
  recorded_by UUID REFERENCES users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shift TEXT CHECK (shift IN ('morning','afternoon','evening','night')),
  temperature NUMERIC(4,1),
  pulse INT,
  bp_systolic INT,
  bp_diastolic INT,
  spo2 INT,
  respiratory_rate INT,
  weight NUMERIC(5,1),
  pain_score INT CHECK (pain_score BETWEEN 0 AND 10),
  urine_output_ml INT,
  intake_oral_ml INT,
  intake_iv_ml INT,
  gcs_total INT,
  mews_score INT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_nursing_vitals_admission_id ON nursing_vitals(admission_id);
CREATE INDEX IF NOT EXISTS idx_nursing_vitals_hospital_id ON nursing_vitals(hospital_id);
CREATE INDEX IF NOT EXISTS idx_nursing_vitals_recorded_at ON nursing_vitals(recorded_at DESC);

ALTER TABLE nursing_vitals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON nursing_vitals
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Medication Administration Record (MAR)
CREATE TABLE IF NOT EXISTS med_admin_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  admission_id UUID REFERENCES admissions(id),
  patient_id UUID REFERENCES patients(id),
  drug_name TEXT NOT NULL,
  dose TEXT NOT NULL,
  route TEXT CHECK (route IN ('oral','iv','im','sc','topical','inhalation','rectal','other')),
  frequency TEXT,
  scheduled_time TIMESTAMPTZ NOT NULL,
  administered_at TIMESTAMPTZ,
  administered_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','given','omitted','held','refused')),
  omission_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_med_admin_records_admission_id ON med_admin_records(admission_id);
CREATE INDEX IF NOT EXISTS idx_med_admin_records_hospital_id ON med_admin_records(hospital_id);
CREATE INDEX IF NOT EXISTS idx_med_admin_records_scheduled_time ON med_admin_records(scheduled_time);
CREATE INDEX IF NOT EXISTS idx_med_admin_records_status ON med_admin_records(status);

ALTER TABLE med_admin_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON med_admin_records
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
