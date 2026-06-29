-- Insurance Claims Pack: extend insurance_claims for wizard workflow

-- 1. Make bill_id nullable (wizard creates claims before billing is finalised)
ALTER TABLE insurance_claims ALTER COLUMN bill_id DROP NOT NULL;

-- 2. Admission link (primary driver of wizard workflow)
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS admission_id UUID REFERENCES admissions(id);

-- 3. Payer system integration
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS payer_id   UUID REFERENCES payer_masters(id);
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS payer_type TEXT;

-- 4. Pre-auth quick-reference (avoid join every time)
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS pre_auth_number TEXT;
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS pre_auth_date    DATE;

-- 5. Submission tracking (date-only companion to submitted_at timestamptz)
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS submission_date DATE;

-- 6. Document checklist (payer-type-aware JSON object: { key: boolean })
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS documents_checklist JSONB DEFAULT '{}';

-- 7. AI claims narrative
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS claim_narrative          TEXT;
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS claim_narrative_attested BOOLEAN DEFAULT FALSE;

-- 8. Eligibility check results
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS eligibility_verified  BOOLEAN DEFAULT FALSE;
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS eligibility_response  JSONB;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_insurance_claims_admission
  ON insurance_claims(admission_id)
  WHERE admission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insurance_claims_payer
  ON insurance_claims(hospital_id, payer_type, status);
