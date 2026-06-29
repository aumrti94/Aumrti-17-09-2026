-- Payer masters: TPAs, corporate accounts, government schemes
CREATE TABLE IF NOT EXISTS payer_masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  payer_type TEXT NOT NULL CHECK (payer_type IN ('cash','credit','corporate','tpa','pmjay','cghs','esi','state_scheme','other')),
  payer_name TEXT NOT NULL,
  contact_person TEXT,
  contact_phone TEXT,
  credit_limit NUMERIC(12,2),
  payment_terms_days INT DEFAULT 30,
  tariff_class TEXT DEFAULT 'standard',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payer_masters_hospital_id ON payer_masters(hospital_id);
CREATE INDEX IF NOT EXISTS idx_payer_masters_payer_type ON payer_masters(payer_type);

ALTER TABLE payer_masters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON payer_masters
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Extend service_rates with payer-specific columns
ALTER TABLE service_rates ADD COLUMN IF NOT EXISTS payer_type TEXT DEFAULT 'all';
ALTER TABLE service_rates ADD COLUMN IF NOT EXISTS payer_id UUID REFERENCES payer_masters(id);
ALTER TABLE service_rates ADD COLUMN IF NOT EXISTS bed_category TEXT;
ALTER TABLE service_rates ADD COLUMN IF NOT EXISTS effective_from DATE DEFAULT CURRENT_DATE;
ALTER TABLE service_rates ADD COLUMN IF NOT EXISTS effective_to DATE;

CREATE INDEX IF NOT EXISTS idx_service_rates_payer_type ON service_rates(payer_type);

-- Extend opd_tokens with payer columns
ALTER TABLE opd_tokens ADD COLUMN IF NOT EXISTS payer_type TEXT DEFAULT 'cash';
ALTER TABLE opd_tokens ADD COLUMN IF NOT EXISTS payer_id UUID REFERENCES payer_masters(id);

-- Extend admissions with payer columns
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS payer_type TEXT DEFAULT 'cash';
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS payer_id UUID REFERENCES payer_masters(id);

-- Extend ed_visits with payer_type
ALTER TABLE ed_visits ADD COLUMN IF NOT EXISTS payer_type TEXT DEFAULT 'cash';
