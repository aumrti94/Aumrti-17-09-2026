
-- Enums
CREATE TYPE public.hospital_type AS ENUM ('general', 'specialty', 'clinic', 'nursing_home');
CREATE TYPE public.subscription_tier AS ENUM ('basic', 'professional', 'enterprise');
CREATE TYPE public.department_type AS ENUM ('clinical', 'administrative', 'support');
CREATE TYPE public.app_role AS ENUM ('super_admin', 'hospital_admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_tech', 'accountant');
CREATE TYPE public.gender_type AS ENUM ('male', 'female', 'other');

-- hospitals
CREATE TABLE public.hospitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type public.hospital_type NOT NULL DEFAULT 'general',
  address text,
  state text,
  pincode text,
  country text DEFAULT 'India',
  gstin text,
  nabh_number text,
  beds_count integer DEFAULT 0,
  logo_url text,
  primary_color text DEFAULT '#0EA5E9',
  subscription_tier public.subscription_tier NOT NULL DEFAULT 'basic',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- branches
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  is_main_branch boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- departments
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  type public.department_type NOT NULL DEFAULT 'clinical',
  head_doctor_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- users (profiles linked to auth.users)
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  role public.app_role NOT NULL DEFAULT 'receptionist',
  department_id uuid REFERENCES public.departments(id),
  employee_id text,
  is_active boolean NOT NULL DEFAULT true,
  last_login timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- patients
CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  uhid text NOT NULL,
  full_name text NOT NULL,
  dob date,
  gender public.gender_type,
  phone text,
  address text,
  blood_group text,
  abha_id text,
  emergency_contact jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, uhid)
);

-- Security definer function to get current user's hospital_id
CREATE OR REPLACE FUNCTION public.get_user_hospital_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hospital_id FROM public.users WHERE id = auth.uid()
$$;

-- Security definer function to check role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = _user_id AND role = _role
  )
$$;

-- RLS Policies

-- hospitals: users can only access their own hospital
CREATE POLICY "Users can view own hospital" ON public.hospitals
  FOR SELECT TO authenticated
  USING (id = public.get_user_hospital_id());

CREATE POLICY "Hospital admins can update own hospital" ON public.hospitals
  FOR UPDATE TO authenticated
  USING (id = public.get_user_hospital_id())
  WITH CHECK (id = public.get_user_hospital_id());

-- branches
CREATE POLICY "Users can view own hospital branches" ON public.branches
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Admins can manage branches" ON public.branches
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- departments
CREATE POLICY "Users can view own hospital departments" ON public.departments
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Admins can manage departments" ON public.departments
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- users
CREATE POLICY "Users can view own hospital users" ON public.users
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Admins can manage users" ON public.users
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- patients
CREATE POLICY "Users can view own hospital patients" ON public.patients
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can manage own hospital patients" ON public.patients
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Enable realtime on hospitals
ALTER PUBLICATION supabase_realtime ADD TABLE public.hospitals;
