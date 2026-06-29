-- MLC Cases table for medico-legal case documentation
CREATE TABLE IF NOT EXISTS mlc_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  mlc_number TEXT NOT NULL,
  ed_visit_id UUID REFERENCES ed_visits(id),
  admission_id UUID REFERENCES admissions(id),
  patient_id UUID NOT NULL REFERENCES patients(id),

  -- Case classification
  case_type TEXT NOT NULL, -- road_accident | assault | poisoning | burns | fall | sexual_assault | other
  incident_date DATE,
  incident_time TIME,
  incident_place TEXT,
  incident_description TEXT,

  -- Injury details
  injury_type TEXT, -- blunt | sharp | firearm | chemical | mixed | other
  body_parts_injured TEXT[],
  alleged_history TEXT,

  -- Police information
  police_station TEXT,
  police_officer_name TEXT,
  police_officer_designation TEXT,
  fir_number TEXT,
  police_informed BOOLEAN DEFAULT FALSE,
  police_informed_at TIMESTAMPTZ,

  -- Intimation record
  intimation_to_police_at TIMESTAMPTZ,
  intimation_sent_by TEXT,
  intimation_mode TEXT, -- phone | in_person | written

  -- Legal disposition
  medicolegal_opinion TEXT,
  forwarded_to_court BOOLEAN DEFAULT FALSE,
  court_case_number TEXT,

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlc_cases_hospital_id ON mlc_cases(hospital_id);
CREATE INDEX IF NOT EXISTS idx_mlc_cases_patient_id ON mlc_cases(patient_id);
CREATE INDEX IF NOT EXISTS idx_mlc_cases_ed_visit_id ON mlc_cases(ed_visit_id);
CREATE INDEX IF NOT EXISTS idx_mlc_cases_admission_id ON mlc_cases(admission_id);

ALTER TABLE mlc_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON mlc_cases
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
