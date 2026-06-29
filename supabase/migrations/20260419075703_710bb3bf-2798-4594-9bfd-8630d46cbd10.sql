-- Nursing care plans table
CREATE TABLE IF NOT EXISTS public.nursing_care_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  nursing_diagnosis text NOT NULL,
  goal text NOT NULL,
  interventions jsonb DEFAULT '[]'::jsonb,
  evaluation text,
  status text DEFAULT 'active',
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.nursing_care_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hospital isolation" ON public.nursing_care_plans;
CREATE POLICY "Hospital isolation" ON public.nursing_care_plans
  FOR ALL
  USING (hospital_id = (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_ncp_admission ON public.nursing_care_plans(admission_id);
CREATE INDEX IF NOT EXISTS idx_ncp_hospital ON public.nursing_care_plans(hospital_id);

-- Status validation trigger
CREATE OR REPLACE FUNCTION public.validate_nursing_care_plan()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('active','achieved','revised','discontinued') THEN
    RAISE EXCEPTION 'Invalid care plan status: %', NEW.status;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_nursing_care_plan ON public.nursing_care_plans;
CREATE TRIGGER trg_validate_nursing_care_plan
  BEFORE INSERT OR UPDATE ON public.nursing_care_plans
  FOR EACH ROW EXECUTE FUNCTION public.validate_nursing_care_plan();

-- MAR records table (separate from existing nursing_mar)
CREATE TABLE IF NOT EXISTS public.mar_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  admission_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  drug_name text NOT NULL,
  dose text,
  route text,
  scheduled_time timestamptz,
  administered_at timestamptz DEFAULT now(),
  administered_by uuid,
  status text DEFAULT 'given',
  notes text
);

ALTER TABLE public.mar_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hospital isolation" ON public.mar_records;
CREATE POLICY "Hospital isolation" ON public.mar_records
  FOR ALL
  USING (hospital_id = (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_mar_records_admission ON public.mar_records(admission_id);
CREATE INDEX IF NOT EXISTS idx_mar_records_hospital ON public.mar_records(hospital_id);