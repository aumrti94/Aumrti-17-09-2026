-- Phase 6: Government Scheme Integrations (CGHS / ECHS / ESI / Arogyasri)

-- cghs_echs_beneficiaries may be created later (20260901000010) — guard the ALTER
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cghs_echs_beneficiaries') THEN
    ALTER TABLE cghs_echs_beneficiaries
      ADD COLUMN IF NOT EXISTS patient_id uuid,
      ADD COLUMN IF NOT EXISTS scheme_type text,
      ADD COLUMN IF NOT EXISTS beneficiary_id text,
      ADD COLUMN IF NOT EXISTS card_number text,
      ADD COLUMN IF NOT EXISTS dispensary_name text,
      ADD COLUMN IF NOT EXISTS employee_name text,
      ADD COLUMN IF NOT EXISTS relationship text DEFAULT 'self',
      ADD COLUMN IF NOT EXISTS ward_entitlement text,
      ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS valid_till date;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'cghs_echs_beneficiaries' AND policyname = 'cghs_echs_service_role'
    ) THEN
      EXECUTE 'CREATE POLICY "cghs_echs_service_role" ON cghs_echs_beneficiaries TO service_role USING (true) WITH CHECK (true)';
    END IF;

    CREATE INDEX IF NOT EXISTS idx_cghs_echs_patient ON cghs_echs_beneficiaries(patient_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS esi_beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  esi_number text NOT NULL,
  employee_name text,
  employer_name text,
  dispensary_code text,
  ip_number text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'expired', 'suspended')),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS arogyasri_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  enrollment_id text NOT NULL,
  scheme_name text,
  district text,
  state text DEFAULT 'Telangana',
  aadhar_linked boolean DEFAULT false,
  family_unit_id text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'expired', 'suspended')),
  valid_till date,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS govt_scheme_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  admission_id uuid,
  scheme_type text NOT NULL CHECK (scheme_type IN ('CGHS', 'ECHS', 'ESI', 'Arogyasri', 'PMJAY', 'RSBY', 'state_scheme')),
  claim_number text,
  procedure_codes text[],
  claimed_amount numeric(12,2) DEFAULT 0,
  approved_amount numeric(12,2),
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'partially_approved', 'settled')),
  submitted_at timestamptz,
  settled_at timestamptz,
  rejection_reason text,
  remarks text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_esi_patient ON esi_beneficiaries(patient_id);
CREATE INDEX IF NOT EXISTS idx_esi_hospital ON esi_beneficiaries(hospital_id);
CREATE INDEX IF NOT EXISTS idx_arogyasri_patient ON arogyasri_enrollments(patient_id);
CREATE INDEX IF NOT EXISTS idx_arogyasri_hospital ON arogyasri_enrollments(hospital_id);
CREATE INDEX IF NOT EXISTS idx_govt_claims_hospital ON govt_scheme_claims(hospital_id, scheme_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_govt_claims_patient ON govt_scheme_claims(patient_id);

-- RLS on new tables
ALTER TABLE esi_beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE arogyasri_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE govt_scheme_claims ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'esi_beneficiaries' AND policyname = 'esi_isolation') THEN
    CREATE POLICY "esi_isolation" ON esi_beneficiaries
      USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
      WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'arogyasri_enrollments' AND policyname = 'arogyasri_isolation') THEN
    CREATE POLICY "arogyasri_isolation" ON arogyasri_enrollments
      USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
      WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'govt_scheme_claims' AND policyname = 'govt_claims_isolation') THEN
    CREATE POLICY "govt_claims_isolation" ON govt_scheme_claims
      USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
      WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'esi_beneficiaries' AND policyname = 'esi_service_role') THEN
    CREATE POLICY "esi_service_role" ON esi_beneficiaries TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'arogyasri_enrollments' AND policyname = 'arogyasri_service_role') THEN
    CREATE POLICY "arogyasri_service_role" ON arogyasri_enrollments TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'govt_scheme_claims' AND policyname = 'govt_scheme_claims_service_role') THEN
    CREATE POLICY "govt_scheme_claims_service_role" ON govt_scheme_claims TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
