
-- Table: chronic_disease_programs
CREATE TABLE public.chronic_disease_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  condition text NOT NULL,
  condition_label text NOT NULL,
  diagnosed_date date,
  treating_doctor uuid REFERENCES public.users(id),
  next_followup date,
  followup_interval_days integer DEFAULT 90,
  followup_tests text[],
  last_hba1c numeric(4,1),
  last_creatinine numeric(5,2),
  last_bp_systolic integer,
  is_active boolean DEFAULT true,
  enrolled_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Validation trigger for condition values
CREATE OR REPLACE FUNCTION public.validate_chronic_disease_condition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.condition NOT IN ('dm','htn','ckd','cad','copd','asthma','hypothyroid','epilepsy','other') THEN
    RAISE EXCEPTION 'Invalid condition: %', NEW.condition;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_chronic_disease_condition
  BEFORE INSERT OR UPDATE ON public.chronic_disease_programs
  FOR EACH ROW EXECUTE FUNCTION public.validate_chronic_disease_condition();

-- RLS policies
ALTER TABLE public.chronic_disease_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view chronic programs for their hospital"
  ON public.chronic_disease_programs FOR SELECT
  TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can insert chronic programs for their hospital"
  ON public.chronic_disease_programs FOR INSERT
  TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can update chronic programs for their hospital"
  ON public.chronic_disease_programs FOR UPDATE
  TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

-- Indexes
CREATE INDEX idx_cdp_hospital_patient ON public.chronic_disease_programs(hospital_id, patient_id);
CREATE INDEX idx_cdp_next_followup ON public.chronic_disease_programs(hospital_id, next_followup) WHERE is_active = true;
