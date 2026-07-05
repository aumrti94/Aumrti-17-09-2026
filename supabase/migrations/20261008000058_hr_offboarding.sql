-- ============================================================
-- HR — Exit / Offboarding & Full-and-Final Settlement
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_exits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id),
  exit_type        text NOT NULL DEFAULT 'resignation',
    -- resignation | termination | retirement | end_of_contract
  reason           text,
  notice_date      date,
  last_working_day date,
  clearance        jsonb DEFAULT '{}'::jsonb,   -- {it:true, pharmacy:false, ...}
  status           text NOT NULL DEFAULT 'initiated',
    -- initiated | clearance | settled | completed
  created_by       uuid REFERENCES public.users(id),
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.full_final_settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  staff_exit_id    uuid NOT NULL REFERENCES public.staff_exits(id) ON DELETE CASCADE,
  years_of_service numeric,
  last_basic       numeric DEFAULT 0,
  gratuity         numeric DEFAULT 0,
  leave_encashment numeric DEFAULT 0,
  pending_salary   numeric DEFAULT 0,
  bonus            numeric DEFAULT 0,
  deductions       numeric DEFAULT 0,   -- recoveries, notice-pay shortfall, advances
  net_payable      numeric DEFAULT 0,
  notes            text,
  settled_by       uuid REFERENCES public.users(id),
  settled_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_exits_user_idx ON public.staff_exits (user_id);
CREATE INDEX IF NOT EXISTS ffs_exit_idx ON public.full_final_settlements (staff_exit_id);

ALTER TABLE public.staff_exits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.full_final_settlements ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_exits','full_final_settlements'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_hospital') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());',
        t || '_hospital', t);
    END IF;
  END LOOP;
END $$;
