-- Phase 22 (P2) compliance gap migrations — FIXED

-- 22.2: Restraint documentation (NABH COP.11)
CREATE TABLE IF NOT EXISTS restraint_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id uuid REFERENCES admissions(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id),
  restraint_type text NOT NULL CHECK (restraint_type IN ('physical','chemical','environmental')),
  reason text NOT NULL,
  applied_at timestamptz DEFAULT now(),
  removed_at timestamptz,
  applied_by uuid REFERENCES users(id),
  monitoring_frequency_min int DEFAULT 15,
  patient_response text,
  family_informed boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE restraint_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON restraint_records;
CREATE POLICY "hospital_isolation" ON restraint_records
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_restraint_admission ON restraint_records(admission_id, applied_at DESC);

-- 22.4: Aadhaar ID on patients
ALTER TABLE patients ADD COLUMN IF NOT EXISTS aadhaar_id text;

-- 22.8: Radiology pregnancy flag + radiation dose tracking (AERB)
ALTER TABLE radiology_orders ADD COLUMN IF NOT EXISTS is_pregnant boolean DEFAULT false;
ALTER TABLE radiology_orders ADD COLUMN IF NOT EXISTS dose_mgy numeric;
ALTER TABLE radiology_orders ADD COLUMN IF NOT EXISTS pregnancy_status text
  CHECK (pregnancy_status IN ('not_pregnant','pregnant','unknown','lmp_provided'));
ALTER TABLE radiology_orders ADD COLUMN IF NOT EXISTS lmp_date date;

-- 22.11: Microbiology antibiogram fields on lab_results
-- lab_results did not exist; create minimal table first, then add antibiogram columns
CREATE TABLE IF NOT EXISTS lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  order_id uuid,
  patient_id uuid REFERENCES patients(id),
  result_value text,
  unit text,
  reference_range text,
  is_abnormal boolean DEFAULT false,
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON lab_results;
CREATE POLICY "hospital_isolation" ON lab_results
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS organism_identified text;
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS sensitivity_json jsonb;
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS colony_count text;
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS specimen_type text;

-- 22.12: External lab referrals
CREATE TABLE IF NOT EXISTS external_lab_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id),
  encounter_id uuid,
  lab_name text NOT NULL,
  lab_address text,
  lab_phone text,
  tests_ordered text[] DEFAULT '{}',
  referred_at timestamptz DEFAULT now(),
  referred_by uuid REFERENCES users(id),
  sample_collected_at timestamptz,
  report_expected_at date,
  report_received_at timestamptz,
  report_url text,
  report_notes text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','sample_sent','report_awaited','completed','cancelled')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE external_lab_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON external_lab_referrals;
CREATE POLICY "hospital_isolation" ON external_lab_referrals
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_ext_lab_hospital ON external_lab_referrals(hospital_id, status, referred_at DESC);

-- 22.13: NABL accreditation on hospitals
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS nabl_accreditation_number text;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS nabl_valid_upto date;

-- 22.14: NDPS patient signature reference
ALTER TABLE ndps_register ADD COLUMN IF NOT EXISTS patient_signature_ref text;

-- 22.15: Drug schedule classification (H / H1 / X / G / OTC)
ALTER TABLE drug_master ADD COLUMN IF NOT EXISTS schedule_type text
  CHECK (schedule_type IN ('H','H1','X','G','OTC','other'));

-- 22.18: Patient GSTIN for B2B invoicing
ALTER TABLE patients ADD COLUMN IF NOT EXISTS patient_gstin text;

-- 22.19: 80G / charitable trust fields on hospitals
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS registration_80g text;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS trust_pan text;

-- 22.23: TPA query-reply log
CREATE TABLE IF NOT EXISTS tpa_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES insurance_claims(id),
  admission_id uuid REFERENCES admissions(id),
  query_text text NOT NULL,
  raised_by_tpa text,
  raised_at timestamptz DEFAULT now(),
  replied_text text,
  replied_at timestamptz,
  replied_by uuid REFERENCES users(id),
  status text DEFAULT 'open' CHECK (status IN ('open','replied','escalated','closed')),
  priority text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  documents_requested text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE tpa_queries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON tpa_queries;
CREATE POLICY "hospital_isolation" ON tpa_queries
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_tpa_queries_hospital ON tpa_queries(hospital_id, status, raised_at DESC);
CREATE INDEX IF NOT EXISTS idx_tpa_queries_claim ON tpa_queries(claim_id);

-- 22.28: Maternity leave — children_count on staff_profiles
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS children_count int DEFAULT 0;

-- 22.31: Consignment stock flag
ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS is_consignment boolean DEFAULT false;
ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS consignment_vendor_id uuid REFERENCES vendors(id);

-- 22.32: 3-way PO match fields on purchase_orders
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_amount numeric;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS match_status text DEFAULT 'pending'
  CHECK (match_status IN ('pending','matched','discrepancy','override'));

-- 22.36: Staff accident/injury register (Factory Act Form 4)
CREATE TABLE IF NOT EXISTS staff_injuries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES users(id),
  incident_date date NOT NULL,
  incident_time time,
  location text,
  nature_of_injury text NOT NULL,
  body_part_affected text,
  cause_of_accident text,
  treatment_given text,
  days_lost int DEFAULT 0,
  reported_to_labour_officer boolean DEFAULT false,
  reported_at timestamptz,
  witness_name text,
  supervisor_name text,
  form4_submitted boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE staff_injuries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON staff_injuries;
CREATE POLICY "hospital_isolation" ON staff_injuries
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_staff_injuries_hospital ON staff_injuries(hospital_id, incident_date DESC);
