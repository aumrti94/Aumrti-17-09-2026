
-- staff_attendance already exists, add missing tables only
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  user_id uuid REFERENCES users(id) NOT NULL,
  leave_type text NOT NULL CHECK (leave_type IN ('casual','sick','earned','maternity','paternity','compensatory','unpaid','study','emergency')),
  from_date date NOT NULL,
  to_date date NOT NULL,
  days_count numeric(4,1) NOT NULL,
  reason text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  applied_at timestamptz DEFAULT now(),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  reviewer_notes text
);

CREATE TABLE IF NOT EXISTS public.leave_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  user_id uuid REFERENCES users(id) NOT NULL,
  year integer NOT NULL,
  casual_total numeric(4,1) DEFAULT 12,
  casual_used numeric(4,1) DEFAULT 0,
  sick_total numeric(4,1) DEFAULT 12,
  sick_used numeric(4,1) DEFAULT 0,
  earned_total numeric(4,1) DEFAULT 15,
  earned_used numeric(4,1) DEFAULT 0,
  comp_off_balance numeric(4,1) DEFAULT 0,
  UNIQUE(hospital_id, user_id, year)
);

-- RLS for tables that may not have it yet
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leave_requests') THEN
    EXECUTE 'CREATE POLICY "Users can view own hospital leave_requests" ON public.leave_requests FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id())';
    EXECUTE 'CREATE POLICY "Users can manage own hospital leave_requests" ON public.leave_requests FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leave_balance') THEN
    EXECUTE 'CREATE POLICY "Users can view own hospital leave_balance" ON public.leave_balance FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id())';
    EXECUTE 'CREATE POLICY "Users can manage own hospital leave_balance" ON public.leave_balance FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id())';
  END IF;
END $$;
