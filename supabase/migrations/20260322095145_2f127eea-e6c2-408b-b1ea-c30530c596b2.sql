
-- Add missing columns to patients (only if not exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='allergies') THEN
    ALTER TABLE public.patients ADD COLUMN allergies text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='chronic_conditions') THEN
    ALTER TABLE public.patients ADD COLUMN chronic_conditions text[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='insurance_id') THEN
    ALTER TABLE public.patients ADD COLUMN insurance_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='emergency_contact_name') THEN
    ALTER TABLE public.patients ADD COLUMN emergency_contact_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='emergency_contact_phone') THEN
    ALTER TABLE public.patients ADD COLUMN emergency_contact_phone text;
  END IF;
END $$;

-- opd_tokens
CREATE TABLE IF NOT EXISTS public.opd_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  doctor_id uuid REFERENCES public.users(id),
  department_id uuid REFERENCES public.departments(id),
  token_number text NOT NULL,
  token_prefix text DEFAULT 'A',
  visit_date date DEFAULT CURRENT_DATE NOT NULL,
  status text DEFAULT 'waiting' NOT NULL,
  priority text DEFAULT 'normal' NOT NULL,
  called_at timestamptz,
  consultation_start_at timestamptz,
  consultation_end_at timestamptz,
  wait_minutes integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- opd_encounters
CREATE TABLE IF NOT EXISTS public.opd_encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  token_id uuid REFERENCES public.opd_tokens(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  doctor_id uuid REFERENCES public.users(id) NOT NULL,
  visit_date date DEFAULT CURRENT_DATE,
  chief_complaint text,
  history_of_present_illness text,
  vitals jsonb DEFAULT '{}',
  examination_notes text,
  soap_subjective text,
  soap_objective text,
  soap_assessment text,
  soap_plan text,
  diagnosis text,
  icd10_code text,
  follow_up_date date,
  follow_up_notes text,
  is_admitted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- prescriptions
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  encounter_id uuid REFERENCES public.opd_encounters(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  doctor_id uuid REFERENCES public.users(id) NOT NULL,
  prescription_date date DEFAULT CURRENT_DATE,
  drugs jsonb DEFAULT '[]',
  lab_orders jsonb DEFAULT '[]',
  radiology_orders jsonb DEFAULT '[]',
  advice_notes text,
  review_date date,
  is_signed boolean DEFAULT false,
  signed_at timestamptz,
  whatsapp_sent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- drug_master
CREATE TABLE IF NOT EXISTS public.drug_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  drug_name text NOT NULL,
  generic_name text,
  category text,
  dosage_forms text[],
  standard_doses text[],
  routes text[],
  is_active boolean DEFAULT true,
  is_ndps boolean DEFAULT false
);

-- RLS policies
ALTER TABLE public.opd_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opd_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drug_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital opd_tokens" ON public.opd_tokens FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital opd_tokens" ON public.opd_tokens FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital opd_encounters" ON public.opd_encounters FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital opd_encounters" ON public.opd_encounters FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital prescriptions" ON public.prescriptions FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital prescriptions" ON public.prescriptions FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital drugs" ON public.drug_master FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital drugs" ON public.drug_master FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Enable realtime for opd_tokens
ALTER PUBLICATION supabase_realtime ADD TABLE public.opd_tokens;
