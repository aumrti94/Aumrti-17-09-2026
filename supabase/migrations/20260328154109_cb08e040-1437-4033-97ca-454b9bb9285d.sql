ALTER TABLE public.admissions 
  ADD COLUMN IF NOT EXISTS medical_cleared boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pharmacy_cleared boolean DEFAULT false;