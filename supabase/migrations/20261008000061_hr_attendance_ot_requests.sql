-- ============================================================
-- HR — Attendance Regularization & Overtime request workflows
-- Requests are raised (by staff or HR) and, on approval, written back
-- into staff_attendance so they flow into payroll.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_regularization_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id),
  attendance_date  date NOT NULL,
  requested_status text NOT NULL DEFAULT 'present',   -- present | half_day | on_leave
  reason           text,
  status           text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  reviewed_by      uuid REFERENCES public.users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.overtime_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id),
  ot_date      date NOT NULL,
  hours        numeric(4,2) NOT NULL DEFAULT 0,
  reason       text,
  status       text NOT NULL DEFAULT 'pending',       -- pending | approved | rejected
  reviewed_by  uuid REFERENCES public.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reg_req_hospital_idx ON public.attendance_regularization_requests (hospital_id, status);
CREATE INDEX IF NOT EXISTS ot_req_hospital_idx  ON public.overtime_requests (hospital_id, status);

ALTER TABLE public.attendance_regularization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_requests                  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_regularization_requests','overtime_requests'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_hospital') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());',
        t || '_hospital', t);
    END IF;
  END LOOP;
END $$;
