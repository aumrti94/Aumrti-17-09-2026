-- Add email to patients for Supabase Auth matching
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_patients_email
  ON public.patients (email)
  WHERE email IS NOT NULL;
