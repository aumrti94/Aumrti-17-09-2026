-- Admission financial estimates: captures estimated cost and deposit at time of admission
CREATE TABLE public.admission_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id),
  estimated_days INT DEFAULT 3,
  estimated_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_required NUMERIC(12,2) NOT NULL DEFAULT 0,
  package_id UUID REFERENCES public.health_packages(id),
  remarks TEXT,
  is_estimate_given BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.admission_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation" ON public.admission_estimates
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE INDEX ON public.admission_estimates(admission_id);
CREATE INDEX ON public.admission_estimates(hospital_id);
