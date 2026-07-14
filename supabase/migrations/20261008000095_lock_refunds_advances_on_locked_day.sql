-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: lock_refunds_advances_on_locked_day
-- Purpose  : migration 088 guarded bill_payments against a backdated write on a
--            locked cash-closure day, but DailyCashClosurePage's system total also
--            subtracts refund_payables and adds ipd_advances (unmirrored advance
--            deposits) — neither table had any lock-day guard, so a refund or
--            advance recorded/edited/deleted against a locked date could silently
--            drift the reconciled total after lock. Mirrors
--            prevent_payment_on_locked_day exactly, one function per table since
--            each has a different date column (processed_at / created_at).
--            CFO override: set_config('app.cfo_override','true',true) in-session.
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_refund_on_locked_day()
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
    v_date    := COALESCE((OLD.processed_at)::date, OLD.created_at::date);
    v_hosp_id := OLD.hospital_id;
  ELSE
    v_date    := COALESCE((NEW.processed_at)::date, NEW.created_at::date);
    v_hosp_id := NEW.hospital_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_cash_closure
    WHERE hospital_id  = v_hosp_id
      AND closure_date = v_date
      AND status       = 'locked'
  ) THEN
    RAISE EXCEPTION
      'Day % is locked (cash closure). Refunds cannot be recorded, modified, or '
      'deleted without CFO approval. Ask the CFO to set the override.',
      v_date;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;$$;

DROP TRIGGER IF EXISTS trg_prevent_refund_on_locked_day ON public.refund_payables;
CREATE TRIGGER trg_prevent_refund_on_locked_day
  BEFORE INSERT OR UPDATE OR DELETE ON public.refund_payables
  FOR EACH ROW EXECUTE FUNCTION public.prevent_refund_on_locked_day();

CREATE OR REPLACE FUNCTION public.prevent_advance_on_locked_day()
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
    v_date    := OLD.created_at::date;
    v_hosp_id := OLD.hospital_id;
  ELSE
    v_date    := NEW.created_at::date;
    v_hosp_id := NEW.hospital_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_cash_closure
    WHERE hospital_id  = v_hosp_id
      AND closure_date = v_date
      AND status       = 'locked'
  ) THEN
    RAISE EXCEPTION
      'Day % is locked (cash closure). Advances cannot be recorded, modified, or '
      'deleted without CFO approval. Ask the CFO to set the override.',
      v_date;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;$$;

DROP TRIGGER IF EXISTS trg_prevent_advance_on_locked_day ON public.ipd_advances;
CREATE TRIGGER trg_prevent_advance_on_locked_day
  BEFORE INSERT OR UPDATE OR DELETE ON public.ipd_advances
  FOR EACH ROW EXECUTE FUNCTION public.prevent_advance_on_locked_day();
