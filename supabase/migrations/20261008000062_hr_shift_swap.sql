-- ============================================================
-- HR — Shift-Swap requests
-- On approval, the shift assignment is swapped between two duty_roster rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shift_swap_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  requester_id      uuid NOT NULL REFERENCES public.users(id),
  requester_date    date NOT NULL,
  counterparty_id   uuid NOT NULL REFERENCES public.users(id),
  counterparty_date date NOT NULL,
  reason            text,
  status            text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  reviewed_by       uuid REFERENCES public.users(id),
  reviewed_at       timestamptz,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_swap_hospital_idx ON public.shift_swap_requests (hospital_id, status);

ALTER TABLE public.shift_swap_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shift_swap_requests' AND policyname = 'shift_swap_requests_hospital') THEN
    CREATE POLICY "shift_swap_requests_hospital" ON public.shift_swap_requests
      FOR ALL TO authenticated
      USING (hospital_id = get_user_hospital_id())
      WITH CHECK (hospital_id = get_user_hospital_id());
  END IF;
END $$;
