
-- Insurance Pre-Auth table
CREATE TABLE IF NOT EXISTS insurance_pre_auth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  admission_id uuid REFERENCES admissions(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  tpa_name text NOT NULL,
  policy_number text,
  pre_auth_number text,
  estimated_amount numeric(12,2),
  approved_amount numeric(12,2),
  procedure_codes text[] DEFAULT '{}',
  diagnosis_codes text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  submitted_at timestamptz,
  approved_at timestamptz,
  valid_until date,
  rejection_reason text,
  documents_checklist jsonb DEFAULT '{}',
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- Insurance Claims table
CREATE TABLE IF NOT EXISTS insurance_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  bill_id uuid REFERENCES bills(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  pre_auth_id uuid REFERENCES insurance_pre_auth(id),
  tpa_name text NOT NULL,
  claim_number text,
  claimed_amount numeric(12,2) NOT NULL,
  approved_amount numeric(12,2),
  settled_amount numeric(12,2),
  settlement_date date,
  status text NOT NULL DEFAULT 'draft',
  denial_reason text,
  denial_code text,
  submitted_at timestamptz,
  documents_submitted jsonb DEFAULT '{}',
  ai_denial_risk_score integer,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- TPA Configuration table
CREATE TABLE IF NOT EXISTS tpa_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  tpa_name text NOT NULL,
  tpa_code text,
  coordinator_name text,
  coordinator_phone text,
  claims_email text,
  credit_days integer DEFAULT 45,
  submission_method text DEFAULT 'portal',
  required_documents text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- RLS policies
CREATE POLICY "Users can manage own hospital insurance_pre_auth" ON insurance_pre_auth FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital insurance_pre_auth" ON insurance_pre_auth FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital insurance_claims" ON insurance_claims FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital insurance_claims" ON insurance_claims FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital tpa_config" ON tpa_config FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital tpa_config" ON tpa_config FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

-- Seed default TPA configurations
INSERT INTO tpa_config (hospital_id, tpa_name, tpa_code, credit_days, required_documents)
SELECT h.id, t.name, t.code, t.days, t.docs::text[]
FROM hospitals h
CROSS JOIN (VALUES
  ('Star Health Insurance', 'STAR', 45, ARRAY['Admission letter','Investigation reports','Pre-auth form','Policy card copy']),
  ('New India Assurance', 'NIA', 60, ARRAY['Admission letter','Investigation reports','Claim form','Discharge summary']),
  ('United India Insurance', 'UII', 60, ARRAY['Admission letter','Investigation reports','Claim form']),
  ('ICICI Lombard', 'ICICI', 45, ARRAY['Admission letter','Investigation reports','Pre-auth form']),
  ('HDFC ERGO', 'HDFC', 45, ARRAY['Admission letter','Investigation reports','Pre-auth form']),
  ('Bajaj Allianz', 'BAJAJ', 45, ARRAY['Admission letter','Investigation reports','Pre-auth form','Policy card copy']),
  ('Medi Assist TPA', 'MEDASSIST', 30, ARRAY['Admission letter','Investigation reports','Pre-auth form']),
  ('MD India', 'MDINDIA', 30, ARRAY['Admission letter','Investigation reports','Pre-auth form']),
  ('Vidal Health TPA', 'VIDAL', 45, ARRAY['Admission letter','Investigation reports','Pre-auth form']),
  ('PMJAY / Ayushman Bharat', 'PMJAY', 21, ARRAY['Admission letter','PMJAY card','Pre-auth form','Aadhar copy']),
  ('CGHS', 'CGHS', 30, ARRAY['Admission letter','CGHS card','Investigation reports','Referral letter']),
  ('ECHS', 'ECHS', 30, ARRAY['Admission letter','ECHS card','Investigation reports','Referral letter'])
) AS t(name, code, days, docs)
WHERE NOT EXISTS (
  SELECT 1 FROM tpa_config tc WHERE tc.hospital_id = h.id
);
