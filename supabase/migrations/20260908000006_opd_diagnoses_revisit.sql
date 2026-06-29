-- Multiple diagnoses per OPD encounter with ICD-10 coding
CREATE TABLE IF NOT EXISTS opd_diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  encounter_id UUID REFERENCES opd_encounters(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id),
  diagnosis_text TEXT NOT NULL,
  icd10_code TEXT,
  icd10_description TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  diagnosis_type TEXT DEFAULT 'working' CHECK (diagnosis_type IN ('working','confirmed','differential','chronic','comorbid')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opd_diagnoses_encounter ON opd_diagnoses(encounter_id);
CREATE INDEX IF NOT EXISTS idx_opd_diagnoses_patient ON opd_diagnoses(patient_id);
CREATE INDEX IF NOT EXISTS idx_opd_diagnoses_hospital ON opd_diagnoses(hospital_id);

ALTER TABLE opd_diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON opd_diagnoses
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Revisit / follow-up linking on encounters and tokens
ALTER TABLE opd_encounters
  ADD COLUMN IF NOT EXISTS revisit_of_encounter_id UUID REFERENCES opd_encounters(id),
  ADD COLUMN IF NOT EXISTS visit_purpose TEXT DEFAULT 'new'
    CHECK (visit_purpose IN ('new','revisit','follow_up','emergency','procedure','review'));

ALTER TABLE opd_tokens
  ADD COLUMN IF NOT EXISTS visit_purpose TEXT DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS revisit_of_token_id UUID REFERENCES opd_tokens(id);

-- Generic key-value settings per hospital (revisit rules, future config)
CREATE TABLE IF NOT EXISTS hospital_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, key)
);

CREATE INDEX IF NOT EXISTS idx_hospital_settings_hospital ON hospital_settings(hospital_id);

ALTER TABLE hospital_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON hospital_settings
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
