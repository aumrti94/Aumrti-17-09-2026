-- Capture the last two registration fields that were being dropped.
-- These are descriptive/attribution metadata (no PHI).

-- Referral code entered by the admin at signup (Step 2 — Admin Account).
-- Used for partner/consultant attribution and growth tracking.
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS referral_code text;

-- Admin's designation selected at signup (Medical Director / CEO / etc.).
-- The wizard collected it but it was never persisted to the user record.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS designation text;

COMMENT ON COLUMN public.hospitals.referral_code IS 'Referral/partner attribution code entered at registration (Step 2).';
COMMENT ON COLUMN public.users.designation IS 'Job designation selected at signup (e.g. Medical Director, CEO/MD, Hospital Administrator).';
