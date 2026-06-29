-- CGHS / ECHS Beneficiary Registry

CREATE TABLE IF NOT EXISTS cghs_echs_beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  cghs_id text,
  echs_card_no text,
  beneficiary_name text NOT NULL,
  entitlement_group text,
  card_type text NOT NULL DEFAULT 'cghs' CHECK (card_type IN ('cghs', 'echs')),
  referral_hospital text,
  referral_date date,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cghs_echs_hospital ON cghs_echs_beneficiaries(hospital_id);
CREATE INDEX idx_cghs_id ON cghs_echs_beneficiaries(cghs_id) WHERE cghs_id IS NOT NULL;
CREATE INDEX idx_echs_card_no ON cghs_echs_beneficiaries(echs_card_no) WHERE echs_card_no IS NOT NULL;

ALTER TABLE cghs_echs_beneficiaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_cghs_echs" ON cghs_echs_beneficiaries
  USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));
