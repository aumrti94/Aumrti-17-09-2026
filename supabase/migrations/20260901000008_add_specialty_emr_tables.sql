-- Partograph entries table for WHO labour progress charting

CREATE TABLE IF NOT EXISTS partograph_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  admission_id uuid REFERENCES admissions(id) ON DELETE SET NULL,
  time_hour int NOT NULL,                          -- hours since labour onset
  cervical_dilation numeric(3,1),                  -- 0–10 cm
  head_station int,                                -- -5 to +5
  fhr int,                                         -- fetal heart rate bpm
  contractions_in_10min int,                       -- 0–5
  contraction_duration text,                       -- < 20s | 20–40s | > 40s
  liquor text,                                     -- C | M | B | A | CS
  systolic_bp int,
  diastolic_bp int,
  pulse int,
  temperature numeric(4,1),
  urine_output text,
  oxytocin_units text,
  drugs text,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partograph_patient ON partograph_entries(patient_id, hospital_id, time_hour);
CREATE INDEX idx_partograph_admission ON partograph_entries(admission_id) WHERE admission_id IS NOT NULL;

ALTER TABLE partograph_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_partograph" ON partograph_entries
  USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));
