-- ABDM consent and ABHA linking audit trail
CREATE TABLE IF NOT EXISTS abdm_consent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  patient_id UUID REFERENCES patients(id),
  abha_id TEXT,
  consent_type TEXT CHECK (consent_type IN ('linking','data_access','hip_sharing')),
  consent_given BOOLEAN DEFAULT FALSE,
  consent_at TIMESTAMPTZ DEFAULT now(),
  consent_given_by UUID REFERENCES users(id),
  ip_address TEXT,
  remarks TEXT
);

CREATE INDEX IF NOT EXISTS idx_abdm_consent_logs_patient ON abdm_consent_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_abdm_consent_logs_hospital ON abdm_consent_logs(hospital_id);

ALTER TABLE abdm_consent_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON abdm_consent_logs
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
