ALTER TABLE public.insurance_pre_auth ADD COLUMN IF NOT EXISTS bundle_generated_at timestamptz;
ALTER TABLE public.insurance_claims ADD COLUMN IF NOT EXISTS bundle_generated_at timestamptz;
ALTER TABLE public.insurance_claims ADD COLUMN IF NOT EXISTS submitted_by uuid;