-- Asset Management: asset_register + depreciation_ledger tables

CREATE TABLE IF NOT EXISTS public.asset_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES public.equipment_master(id) ON DELETE SET NULL,
  asset_code text NOT NULL,
  asset_name text NOT NULL,
  category text DEFAULT 'equipment',
  acquisition_date date NOT NULL,
  acquisition_cost numeric NOT NULL,
  useful_life_years int NOT NULL DEFAULT 5,
  residual_value numeric NOT NULL DEFAULT 0,
  depreciation_method text NOT NULL DEFAULT 'slm',
  accumulated_depreciation numeric NOT NULL DEFAULT 0,
  net_book_value numeric GENERATED ALWAYS AS (acquisition_cost - accumulated_depreciation) STORED,
  insurance_policy_no text,
  insurance_provider text,
  insurance_expiry date,
  insurance_premium numeric,
  disposal_date date,
  disposal_amount numeric,
  disposal_reason text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.depreciation_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.asset_register(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  depreciation_amount numeric NOT NULL,
  journal_entry_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.asset_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depreciation_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asset_register_hospital_isolation"
  ON public.asset_register FOR ALL
  USING (hospital_id IN (
    SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "depreciation_ledger_hospital_isolation"
  ON public.depreciation_ledger FOR ALL
  USING (hospital_id IN (
    SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
  ));

-- Index for fast hospital lookups
CREATE INDEX IF NOT EXISTS idx_asset_register_hospital ON public.asset_register(hospital_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_ledger_asset ON public.depreciation_ledger(asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_ledger_hospital_period ON public.depreciation_ledger(hospital_id, period_year, period_month);
