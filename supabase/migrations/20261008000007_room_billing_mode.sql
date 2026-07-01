-- Opt-in IPD room billing mode.
-- 'calendar_day' (default) = legacy whole-day billing (Math.ceil) — NO change for existing
-- hospitals. 'prorata_hourly' = fractional-day billing from admission time.
-- Enabling pro-rata for a hospital is a deliberate finance decision (Kavitha sign-off).
-- Additive + idempotent; hospitals already has RLS.

ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS room_billing_mode text NOT NULL DEFAULT 'calendar_day';

DO $$ BEGIN
  ALTER TABLE public.hospitals
    ADD CONSTRAINT hospitals_room_billing_mode_check
    CHECK (room_billing_mode IN ('calendar_day', 'prorata_hourly'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
