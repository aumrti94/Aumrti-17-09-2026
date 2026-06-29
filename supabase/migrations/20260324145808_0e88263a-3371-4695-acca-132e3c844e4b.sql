
CREATE TABLE public.staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employee_id text,
  designation text,
  employment_type text DEFAULT 'permanent',
  department_id uuid REFERENCES public.departments(id),
  basic_salary numeric DEFAULT 0,
  hra_percent numeric DEFAULT 20,
  da_percent numeric DEFAULT 10,
  conveyance numeric DEFAULT 1600,
  medical_allowance numeric DEFAULT 1250,
  pf_applicable boolean DEFAULT false,
  esic_applicable boolean DEFAULT false,
  license_expiry_date date,
  registration_number text,
  registration_body text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital staff_profiles"
  ON public.staff_profiles FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital staff_profiles"
  ON public.staff_profiles FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
