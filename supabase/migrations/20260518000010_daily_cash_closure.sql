-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: daily_cash_closure
-- Purpose  : End-of-day cash reconciliation table, locked-day bill guard
--            trigger, and RLS policies.
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER/POLICY IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. daily_cash_closure table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.daily_cash_closure (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid          NOT NULL REFERENCES public.hospitals(id),
  closure_date        date          NOT NULL,

  -- System totals (computed from bill_payments, stored at closure time)
  sys_cash            numeric(12,2) NOT NULL DEFAULT 0,
  sys_upi             numeric(12,2) NOT NULL DEFAULT 0,
  sys_card            numeric(12,2) NOT NULL DEFAULT 0,
  sys_cheque          numeric(12,2) NOT NULL DEFAULT 0,
  sys_net_banking     numeric(12,2) NOT NULL DEFAULT 0,
  sys_insurance       numeric(12,2) NOT NULL DEFAULT 0,
  sys_other           numeric(12,2) NOT NULL DEFAULT 0,
  system_total        numeric(12,2) NOT NULL DEFAULT 0,

  -- Manual counts entered by billing supervisor
  manual_cash         numeric(12,2),
  manual_upi          numeric(12,2),
  manual_card         numeric(12,2),
  manual_cheque       numeric(12,2),
  manual_net_banking  numeric(12,2),
  manual_count        numeric(12,2),  -- supervisor's grand total

  -- Reconciliation
  variance            numeric(12,2),  -- manual_count − system_total
  variance_reason     text,           -- required when variance != 0

  -- Workflow status
  status              text          NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'reconciled', 'locked')),

  -- Actors
  closed_by           uuid          REFERENCES public.users(id),
  closed_at           timestamptz,
  approved_by         uuid          REFERENCES public.users(id),  -- CFO approval for variance
  approved_at         timestamptz,

  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT daily_cash_closure_unique UNIQUE (hospital_id, closure_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_cash_closure_hospital_date
  ON public.daily_cash_closure (hospital_id, closure_date DESC);

-- ── 2. updated_at trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_daily_cash_closure()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_touch_daily_cash_closure ON public.daily_cash_closure;
CREATE TRIGGER trg_touch_daily_cash_closure
  BEFORE UPDATE ON public.daily_cash_closure
  FOR EACH ROW EXECUTE FUNCTION public.touch_daily_cash_closure();

-- ── 3. RLS on daily_cash_closure ─────────────────────────────────────────────

ALTER TABLE public.daily_cash_closure ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_cash_closure_select" ON public.daily_cash_closure;
DROP POLICY IF EXISTS "daily_cash_closure_all"    ON public.daily_cash_closure;

CREATE POLICY "daily_cash_closure_select" ON public.daily_cash_closure
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "daily_cash_closure_all" ON public.daily_cash_closure
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 4. Trigger: prevent bill modification on a locked day ─────────────────────
-- Bills cannot be created, modified, or cancelled on a locked closure date.
-- CFO override: set_config('app.cfo_override', 'true', true) in the session.

CREATE OR REPLACE FUNCTION public.prevent_bill_on_locked_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_bill_date  date;
  v_hosp_id    uuid;
  v_override   text;
BEGIN
  -- Respect CFO override (session-local config flag)
  v_override := current_setting('app.cfo_override', true);
  IF v_override = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Determine the bill_date and hospital_id to check
  IF TG_OP = 'DELETE' THEN
    v_bill_date := OLD.bill_date;
    v_hosp_id   := OLD.hospital_id;
  ELSE
    v_bill_date := NEW.bill_date;
    v_hosp_id   := NEW.hospital_id;
  END IF;

  -- If that date has a locked closure, block the operation
  IF EXISTS (
    SELECT 1 FROM public.daily_cash_closure
    WHERE hospital_id  = v_hosp_id
      AND closure_date = v_bill_date
      AND status       = 'locked'
  ) THEN
    RAISE EXCEPTION
      'Day % is locked (cash closure). Bill cannot be created, modified, or '
      'cancelled without CFO approval. Ask the CFO to set the override.',
      v_bill_date;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;$$;

DROP TRIGGER IF EXISTS trg_prevent_bill_on_locked_day ON public.bills;
CREATE TRIGGER trg_prevent_bill_on_locked_day
  BEFORE INSERT OR UPDATE OR DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.prevent_bill_on_locked_day();

-- ── 5. RPC: get_day_previous_status ──────────────────────────────────────────
-- Returns the closure status of (p_date - 1) for the current user's hospital.
-- Used by BillingPage to decide whether to show the "day not closed" banner.

CREATE OR REPLACE FUNCTION public.get_previous_day_closure_status(p_date date DEFAULT CURRENT_DATE)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (
      SELECT status FROM public.daily_cash_closure
      WHERE hospital_id  = public.get_user_hospital_id()
        AND closure_date = p_date - 1
    ),
    'open'   -- no row means the day was never closed
  )
$$;
