-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: block_payment_on_locked_bill_day
-- Purpose  : Close the orphan-payment hole. Previously a payment could be
--            INSERTed against a bill whose day is locked (the payment row is
--            dated *today*, so the existing payment-date lock never caught it),
--            while the corresponding bills UPDATE was blocked by
--            prevent_bill_on_locked_day — leaving an orphan payment that inflated
--            the cash closure with phantom money on every "Pay" click.
--
--            This guards bill_payments at INSERT: if the PARENT bill's bill_date
--            falls on a locked cash-closure day, the payment is refused. The day
--            must be reopened (Billing → Day Closure → Reopen Day) first.
--            Honours the same session-local CFO override as the sibling triggers.
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_payment_on_locked_bill_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_override   text;
  v_bill_date  date;
  v_hosp_id    uuid;
BEGIN
  -- Respect CFO override (session-local config flag), same as sibling triggers.
  v_override := current_setting('app.cfo_override', true);
  IF v_override = 'true' THEN
    RETURN NEW;
  END IF;

  SELECT bill_date, hospital_id
    INTO v_bill_date, v_hosp_id
  FROM public.bills
  WHERE id = NEW.bill_id;

  -- No parent bill row (defensive) → nothing to guard.
  IF v_bill_date IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_cash_closure
    WHERE hospital_id  = COALESCE(NEW.hospital_id, v_hosp_id)
      AND closure_date = v_bill_date
      AND status       = 'locked'
  ) THEN
    RAISE EXCEPTION
      'Day % is locked (cash closure). Reopen the day before collecting a payment '
      'against this bill.', v_bill_date
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_prevent_payment_on_locked_bill_day ON public.bill_payments;
CREATE TRIGGER trg_prevent_payment_on_locked_bill_day
  BEFORE INSERT ON public.bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_on_locked_bill_day();
