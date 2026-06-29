ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS abha_verified boolean DEFAULT false;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS abha_verified_at timestamptz;