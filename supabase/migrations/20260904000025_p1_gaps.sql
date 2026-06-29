-- Phase 21 P1 gap migrations

-- 21-F: visit_type on opd_tokens
ALTER TABLE opd_tokens ADD COLUMN IF NOT EXISTS visit_type text DEFAULT 'new'
  CHECK (visit_type IN ('new','revisit','followup','emergency'));

-- 21-M: MLC flagging on opd_tokens + admissions
ALTER TABLE opd_tokens ADD COLUMN IF NOT EXISTS is_mlc boolean DEFAULT false;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS is_mlc boolean DEFAULT false;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS mlc_number text;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS police_station text;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS police_informed_at timestamptz;

-- 21-H: Doctor credentialing table
CREATE TABLE IF NOT EXISTS staff_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  credential_type text NOT NULL
    CHECK (credential_type IN ('mci_nmc','state_medical_council','nursing_council','super_specialty','skill_competency','bls_acls','other')),
  credential_number text,
  issuing_body text,
  issued_date date,
  expiry_date date,
  document_url text,
  verified boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE staff_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation" ON staff_credentials
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_staff_credentials_user ON staff_credentials(user_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_staff_credentials_hospital ON staff_credentials(hospital_id, expiry_date);
