-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: lock_payments_on_locked_day
-- Purpose  : The day-close lock previously guarded only the `bills` table, so a
--            payment (bill_payments row) dated to a locked closure day could still
--            be inserted/edited/deleted — retroactively invalidating a reconciled,
--            locked day. This mirrors prevent_bill_on_locked_day for bill_payments.
--            CFO override: set_config('app.cfo_override','true',true) in-session.
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_payment_on_locked_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_date     date;
  v_hosp_id  uuid;
  v_override text;
BEGIN
  v_override := current_setting('app.cfo_override', true);
  IF v_override = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_date    := COALESCE(OLD.payment_date, OLD.created_at::date);
    v_hosp_id := OLD.hospital_id;
  ELSE
    v_date    := COALESCE(NEW.payment_date, NEW.created_at::date);
    v_hosp_id := NEW.hospital_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_cash_closure
    WHERE hospital_id  = v_hosp_id
      AND closure_date = v_date
      AND status       = 'locked'
  ) THEN
    RAISE EXCEPTION
      'Day % is locked (cash closure). Payments cannot be recorded, modified, or '
      'deleted without CFO approval. Ask the CFO to set the override.',
      v_date;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;$$;

DROP TRIGGER IF EXISTS trg_prevent_payment_on_locked_day ON public.bill_payments;
CREATE TRIGGER trg_prevent_payment_on_locked_day
  BEFORE INSERT OR UPDATE OR DELETE ON public.bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_on_locked_day();
