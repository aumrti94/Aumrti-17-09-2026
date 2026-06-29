
-- Table: opd_visits
CREATE TABLE public.opd_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  token_number text,
  doctor_id uuid REFERENCES public.users(id),
  department_id uuid REFERENCES public.departments(id),
  visit_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','in_consultation','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table: bills
CREATE TABLE public.bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  bill_number text UNIQUE,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  paid_amount numeric(10,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','partial','paid','cancelled')),
  bill_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table: clinical_alerts
CREATE TABLE public.clinical_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  alert_message text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  patient_id uuid REFERENCES public.patients(id),
  ward_name text,
  bed_number text,
  is_acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_by uuid REFERENCES public.users(id),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table: staff_attendance
CREATE TABLE public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  attendance_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','leave','half_day')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, attendance_date)
);

-- RLS policies for opd_visits
ALTER TABLE public.opd_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own hospital opd_visits" ON public.opd_visits FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital opd_visits" ON public.opd_visits FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- RLS policies for bills
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own hospital bills" ON public.bills FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital bills" ON public.bills FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- RLS policies for clinical_alerts
ALTER TABLE public.clinical_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own hospital alerts" ON public.clinical_alerts FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital alerts" ON public.clinical_alerts FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- RLS policies for staff_attendance
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own hospital attendance" ON public.staff_attendance FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital attendance" ON public.staff_attendance FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Enable realtime for dashboard tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.opd_visits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.clinical_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.beds;
