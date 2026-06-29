-- PCPNDT Form F records (PCPNDT Act 1994 mandatory documentation)
CREATE TABLE IF NOT EXISTS pcpndt_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  radiology_order_id UUID REFERENCES radiology_orders(id),
  patient_id UUID REFERENCES patients(id),
  form_number TEXT,

  -- Patient details
  patient_age INT,
  patient_address TEXT,
  husband_name TEXT,
  referred_by TEXT,
  referred_from TEXT,

  -- Obstetric details
  last_menstrual_period DATE,
  gestational_age_weeks INT,
  gravida INT,
  para INT,
  parity TEXT,

  -- Indication (mandatory — cannot be sex determination)
  indication TEXT NOT NULL,
  indication_category TEXT CHECK (indication_category IN (
    'confirm_pregnancy','fetal_anomaly_scan','placenta_assessment',
    'growth_monitoring','cervical_assessment','doppler','amniotic_fluid',
    'other_maternal','other_fetal'
  )),

  -- Consent
  consent_given BOOLEAN DEFAULT FALSE,
  consent_form_number TEXT,
  consent_obtained_by UUID REFERENCES users(id),
  consent_at TIMESTAMPTZ,

  -- Legal declaration
  no_sex_determination_declared BOOLEAN DEFAULT FALSE,
  declared_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pcpndt_records_hospital_id ON pcpndt_records(hospital_id);
CREATE INDEX IF NOT EXISTS idx_pcpndt_records_order_id ON pcpndt_records(radiology_order_id);
CREATE INDEX IF NOT EXISTS idx_pcpndt_records_patient_id ON pcpndt_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_pcpndt_records_created_at ON pcpndt_records(created_at DESC);

ALTER TABLE pcpndt_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON pcpndt_records
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- PCPNDT machine and doctor compliance settings per hospital
CREATE TABLE IF NOT EXISTS pcpndt_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id) UNIQUE,
  machine_name TEXT,
  machine_registration_number TEXT,
  doctor_pcpndt_registration TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pcpndt_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON pcpndt_settings
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
