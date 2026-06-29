-- Asset Management Module: asset_register + depreciation_ledger

CREATE TABLE IF NOT EXISTS asset_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  equipment_id uuid REFERENCES equipment_master(id) ON DELETE SET NULL,
  asset_code text NOT NULL,
  asset_name text NOT NULL,
  category text NOT NULL DEFAULT 'equipment', -- land | building | equipment | vehicle | it
  acquisition_date date NOT NULL,
  acquisition_cost numeric(15,2) NOT NULL,
  useful_life_years int NOT NULL DEFAULT 5,
  residual_value numeric(15,2) NOT NULL DEFAULT 0,
  depreciation_method text NOT NULL DEFAULT 'slm', -- slm (straight-line) | wdv (written-down value)
  accumulated_depreciation numeric(15,2) NOT NULL DEFAULT 0,
  insurance_policy_no text,
  insurance_provider text,
  insurance_expiry date,
  insurance_premium numeric(12,2),
  disposal_date date,
  disposal_amount numeric(15,2),
  disposal_reason text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS depreciation_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  asset_id uuid REFERENCES asset_register(id) ON DELETE CASCADE NOT NULL,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  depreciation_amount numeric(15,2) NOT NULL,
  net_book_value_after numeric(15,2),
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_year, period_month)
);

-- Indexes
CREATE INDEX idx_asset_register_hospital ON asset_register(hospital_id) WHERE is_active = true;
CREATE INDEX idx_asset_register_insurance_expiry ON asset_register(hospital_id, insurance_expiry) WHERE is_active = true AND insurance_expiry IS NOT NULL;
CREATE INDEX idx_depreciation_ledger_asset ON depreciation_ledger(asset_id, period_year, period_month);

-- RLS
ALTER TABLE asset_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_asset_register" ON asset_register
  USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

CREATE POLICY "hospital_isolation_depreciation_ledger" ON depreciation_ledger
  USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

-- Updated_at trigger for asset_register
CREATE OR REPLACE FUNCTION update_asset_register_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asset_register_updated_at
  BEFORE UPDATE ON asset_register
  FOR EACH ROW EXECUTE FUNCTION update_asset_register_updated_at();
