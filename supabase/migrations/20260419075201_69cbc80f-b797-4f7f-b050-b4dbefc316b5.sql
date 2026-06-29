ALTER TABLE public.blood_units
  ADD COLUMN IF NOT EXISTS tti_hbsag text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tti_hcv text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tti_vdrl text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tti_hiv text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tti_malaria text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS quarantine_reason text,
  ADD COLUMN IF NOT EXISTS qr_code text;

CREATE UNIQUE INDEX IF NOT EXISTS blood_units_qr_code_unique
  ON public.blood_units (qr_code) WHERE qr_code IS NOT NULL;