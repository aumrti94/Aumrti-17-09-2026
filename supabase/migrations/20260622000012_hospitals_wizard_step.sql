-- Add wizard_step to hospitals so OnboardingWizard can persist and resume progress.
-- Column was missing, causing PostgREST to return an error on the wizard SELECT,
-- which made hospital=null → navigate("/") → loop back through dashboard.
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS wizard_step integer DEFAULT 0;
