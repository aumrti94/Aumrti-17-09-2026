
-- admissions
CREATE TABLE IF NOT EXISTS public.admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  bed_id uuid REFERENCES public.beds(id) NOT NULL,
  ward_id uuid REFERENCES public.wards(id) NOT NULL,
  admission_number text UNIQUE,
  admission_type text DEFAULT 'elective' NOT NULL,
  admitted_at timestamptz DEFAULT now(),
  discharged_at timestamptz,
  expected_discharge_date date,
  admitting_doctor_id uuid REFERENCES public.users(id) NOT NULL,
  consultant_doctor_id uuid REFERENCES public.users(id),
  admitting_diagnosis text,
  department_id uuid REFERENCES public.departments(id),
  insurance_type text DEFAULT 'self_pay' NOT NULL,
  insurance_id text,
  status text DEFAULT 'active' NOT NULL,
  discharge_type text,
  discharge_summary_done boolean DEFAULT false,
  billing_cleared boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ward_round_notes
CREATE TABLE IF NOT EXISTS public.ward_round_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  doctor_id uuid REFERENCES public.users(id) NOT NULL,
  round_date date DEFAULT CURRENT_DATE,
  round_time time DEFAULT localtime,
  subjective text,
  objective text,
  assessment text,
  plan text,
  vitals_snapshot jsonb,
  orders jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- ipd_vitals
CREATE TABLE IF NOT EXISTS public.ipd_vitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id) NOT NULL,
  recorded_by uuid REFERENCES public.users(id) NOT NULL,
  bp_systolic integer,
  bp_diastolic integer,
  pulse integer,
  temperature numeric(4,1),
  spo2 integer,
  respiratory_rate integer,
  grbs integer,
  urine_output_ml integer,
  pain_score integer,
  news2_score integer,
  recorded_at timestamptz DEFAULT now()
);

-- ipd_medications
CREATE TABLE IF NOT EXISTS public.ipd_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id) NOT NULL,
  drug_name text NOT NULL,
  dose text,
  route text,
  frequency text,
  start_date date DEFAULT CURRENT_DATE,
  end_date date,
  is_active boolean DEFAULT true,
  ordered_by uuid REFERENCES public.users(id) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ward_round_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital admissions" ON public.admissions FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital admissions" ON public.admissions FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital ward_round_notes" ON public.ward_round_notes FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital ward_round_notes" ON public.ward_round_notes FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital ipd_vitals" ON public.ipd_vitals FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital ipd_vitals" ON public.ipd_vitals FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital ipd_medications" ON public.ipd_medications FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital ipd_medications" ON public.ipd_medications FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Enable realtime for admissions
ALTER PUBLICATION supabase_realtime ADD TABLE public.admissions;
