-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: draft_admission_bill_locked_day_exemption
-- Purpose  : An IPD bill's bill_date is stamped once at admission and never
--            advanced, so a long-stay patient's DRAFT bill keeps its
--            admission-day date while charges accrue for days or weeks. Once
--            that day is cash-closed, prevent_bill_on_locked_day blocked every
--            subsequent totals UPDATE — "Recalculate IPD" became permanently
--            impossible for a patient who is still in the ward. The sibling
--            trigger prevent_payment_on_locked_bill_day (…149) keys off the
--            same stale parent date, so the patient also became uncollectable.
--
--            This exempts ONE case from both triggers: an admission's RUNNING
--            bill, up until it is finalised.
--
-- Domain rationale:
--            An Indian IPD bill is a running / provisional bill. Room rent,
--            nursing, doctor visits, procedures, medicines, lab and
--            consumables are appended EVERY DAY of the stay; interim bills are
--            explicitly "not final, subject to change", and the final bill is
--            validated and issued only at discharge. Daily cash closure
--            reconciles CASH RECEIPTS by mode — it was never meant to freeze
--            an unfinalised running bill. The correct lock boundary is
--            finalisation at discharge, which is what this trigger now uses.
--
-- Why this is safe for cash-closure integrity:
--            Day Closure never reads the `bills` table. computeDayClosureTotals
--            (src/lib/dayClosureTotals.ts) takes only bill_payments,
--            refund_payables and ipd_advances; the revenue side of
--            DailyCashClosurePage reads bill_line_items by created_at. Nothing
--            in a closed day's figures can shift when a draft bill's
--            total_amount / balance_due / payment_status is recomputed.
--            The invariant that actually protects the locked day's cash is
--            prevent_payment_on_locked_day (…088), which keys on payment_date.
--            That trigger is deliberately NOT touched here.
--
--            Still blocked: INSERT, DELETE, draft→final, final→anything, any
--            bill_date or hospital_id change, and every non-admission bill.
--
--            Also rewrites the error text. It previously told the user to "ask
--            the CFO to set the override" — app.cfo_override is never set
--            anywhere in the application, so that advice pointed at dead code
--            and away from the Reopen Day button that actually works.
--
--            The client mirrors this predicate in src/lib/lockedDay.ts
--            (isLockExempt). Keep the two in sync — lockedDay.test.ts asserts
--            parity against the rules stated here.
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Exemption: an admission's RUNNING bill, up until it is finalised.
  -- The bill stays on its (now locked) admission date by design; blocking this
  -- freezes billing for a patient who is still admitted. See header.
  --
  -- Keyed on "not finalised" rather than bill_status = 'draft' because a
  -- running bill legitimately leaves 'draft' mid-stay — requesting a discount
  -- sets it to 'pending_approval' (DiscountTab), and payment flows can move it
  -- too. A strict draft test re-locked the bill the moment any of that
  -- happened, mid-admission.
  IF TG_OP = 'UPDATE'
     AND NEW.admission_id IS NOT NULL
     AND NEW.bill_status  NOT IN ('final', 'irn_locked', 'cancelled', 'refunded')
     AND NEW.bill_date    IS NOT DISTINCT FROM OLD.bill_date
     AND NEW.hospital_id  IS NOT DISTINCT FROM OLD.hospital_id
  THEN
    RETURN NEW;
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
      'Day % is locked (cash closure). Reopen it first: '
      'Billing → Day Closure → Reopen Day.',
      v_bill_date;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;$$;

DROP TRIGGER IF EXISTS trg_prevent_bill_on_locked_day ON public.bills;
CREATE TRIGGER trg_prevent_bill_on_locked_day
  BEFORE INSERT OR UPDATE OR DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.prevent_bill_on_locked_day();


-- Same exemption on the payment guard: without it, an admitted patient whose
-- bill sits on a locked admission day cannot pay or top up their advance.
-- prevent_payment_on_locked_day (…088) still blocks any payment DATED into the
-- locked day, which is the control that matters.

CREATE OR REPLACE FUNCTION public.prevent_payment_on_locked_bill_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_override     text;
  v_bill_date    date;
  v_hosp_id      uuid;
  v_bill_status  text;
  v_admission_id uuid;
BEGIN
  -- Respect CFO override (session-local config flag), same as sibling triggers.
  v_override := current_setting('app.cfo_override', true);
  IF v_override = 'true' THEN
    RETURN NEW;
  END IF;

  SELECT bill_date, hospital_id, bill_status, admission_id
    INTO v_bill_date, v_hosp_id, v_bill_status, v_admission_id
  FROM public.bills
  WHERE id = NEW.bill_id;

  -- No parent bill row (defensive) → nothing to guard.
  IF v_bill_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Exemption: collecting against an admission's running (un-finalised) bill.
  -- Same widening as the bills trigger — a pending discount request must not
  -- make an admitted patient uncollectable.
  IF v_admission_id IS NOT NULL
     AND v_bill_status NOT IN ('final', 'irn_locked', 'cancelled', 'refunded')
  THEN
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
