-- Capture the full walk-in registration details on appointments booked from the
-- scheduler (Book Appointment now reuses the Walk-in Quick Registration screen).
-- All columns are nullable / defaulted so existing rows and other booking paths are unaffected.
-- appointments already has hospital_id + RLS — no policy change required.

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS visit_purpose text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_mlc boolean DEFAULT false;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS police_station text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payer_type text DEFAULT 'cash';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payer_id uuid;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS referral_doctor_id uuid REFERENCES public.referral_doctors(id);
