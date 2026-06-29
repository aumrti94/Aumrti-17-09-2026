-- Payroll runs table
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  run_month text NOT NULL,
  run_date date DEFAULT CURRENT_DATE,
  total_gross numeric(12,2) DEFAULT 0,
  total_deductions numeric(12,2) DEFAULT 0,
  total_net numeric(12,2) DEFAULT 0,
  staff_count integer DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft','processed','approved','paid')),
  processed_by uuid REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payroll_runs' AND policyname = 'Users can manage own hospital payroll_runs') THEN
    CREATE POLICY "Users can manage own hospital payroll_runs" ON public.payroll_runs FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payroll_runs' AND policyname = 'Users can view own hospital payroll_runs') THEN
    CREATE POLICY "Users can view own hospital payroll_runs" ON public.payroll_runs FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
  END IF;
END $$;

-- Payroll items table
CREATE TABLE IF NOT EXISTS public.payroll_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  payroll_run_id uuid REFERENCES public.payroll_runs(id) NOT NULL,
  user_id uuid REFERENCES public.users(id) NOT NULL,
  present_days integer DEFAULT 0,
  absent_days integer DEFAULT 0,
  leave_days integer DEFAULT 0,
  overtime_hours numeric(4,2) DEFAULT 0,
  basic numeric(12,2) DEFAULT 0,
  hra numeric(12,2) DEFAULT 0,
  da numeric(12,2) DEFAULT 0,
  conveyance numeric(12,2) DEFAULT 0,
  medical_allowance numeric(12,2) DEFAULT 0,
  overtime_amount numeric(12,2) DEFAULT 0,
  gross_salary numeric(12,2) DEFAULT 0,
  pf_employee numeric(12,2) DEFAULT 0,
  pf_employer numeric(12,2) DEFAULT 0,
  esic_employee numeric(12,2) DEFAULT 0,
  esic_employer numeric(12,2) DEFAULT 0,
  tds numeric(12,2) DEFAULT 0,
  advance_deduction numeric(12,2) DEFAULT 0,
  other_deductions numeric(12,2) DEFAULT 0,
  total_deductions numeric(12,2) DEFAULT 0,
  net_salary numeric(12,2) DEFAULT 0,
  payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','hold')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payroll_items' AND policyname = 'Users can manage own hospital payroll_items') THEN
    CREATE POLICY "Users can manage own hospital payroll_items" ON public.payroll_items FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payroll_items' AND policyname = 'Users can view own hospital payroll_items') THEN
    CREATE POLICY "Users can view own hospital payroll_items" ON public.payroll_items FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
  END IF;
END $$;