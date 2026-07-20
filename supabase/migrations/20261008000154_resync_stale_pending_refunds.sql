-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: resync_stale_pending_refunds
-- Purpose  : A refund request freezes the amount owed at the moment it is
--            raised. If the bill then changes, the pending request goes stale
--            and approving it pays the wrong figure.
--
--            Observed live on BILL-20260716-0004: a ₹14,000 refund was raised,
--            then services were added taking the bill from ₹6,000 to ₹6,618.
--            The true refund became ₹13,382, but the inbox still offered
--            ₹14,000 — approving it would have overpaid the patient by ₹618.
--
--            These triggers auto-reject a stale PENDING refund (recording what
--            changed) and re-raise it at the recomputed amount.
--
-- Scope    : Only status = 'pending_approval' is auto-replaced.
--            'approved' is deliberately left alone — a human authorised that
--            exact amount and money may be about to move; silently voiding
--            their sign-off would be worse than the staleness. Such rows are
--            flagged for attention instead (see resync_pending_refund).
--            Credit-note (pharmacy return) refunds are excluded throughout:
--            their amount comes from the credit note, not the bill balance.
--
-- Invalidating events: bill line items, payments, advances (ipd_advances and
--            advance_receipts), and bill-level discount / insurance changes.
--
-- NOTE     : compute_bill_refund_due is the SQL mirror of computeBillMoney()
--            in src/lib/billMoney.ts. If the refund formula changes there it
--            MUST change here — the two are asserted equivalent by
--            src/lib/billMoney.test.ts scenarios.
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Refund owed on a bill, right now ──────────────────────────────────────
-- Mirrors billMoney.computeBillMoney:
--   netCharges    = max(Σtaxable + Σgst − discount, 0)
--   patientPayable= max(netCharges − insurance, 0)        [GROSS of advance]
--   netAdvance    = ledger balance + already-debited + unmirrored receipts
--   directPaid    = Σ bill_payments where NOT is_advance
--   refundDue     = max(netAdvance + directPaid − patientPayable, 0)

CREATE OR REPLACE FUNCTION public.compute_bill_refund_due(p_bill_id uuid)
-- VOLATILE (not STABLE) on purpose: this runs inside AFTER-ROW triggers and
-- must always re-read the rows the current statement just wrote, with no
-- opportunity for the planner to cache or hoist the result.
RETURNS numeric LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_bill        public.bills%ROWTYPE;
  v_subtotal    numeric := 0;
  v_gst         numeric := 0;
  v_net_charges numeric := 0;
  v_payable     numeric := 0;
  v_net_advance numeric := 0;
  v_unmirrored  numeric := 0;
  v_direct_paid numeric := 0;
BEGIN
  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(taxable_amount), 0), COALESCE(SUM(gst_amount), 0)
    INTO v_subtotal, v_gst
  FROM public.bill_line_items
  WHERE bill_id = p_bill_id;

  v_net_charges := GREATEST(v_subtotal + v_gst - COALESCE(v_bill.discount_amount, 0), 0);
  v_payable     := GREATEST(v_net_charges - COALESCE(v_bill.insurance_amount, 0), 0);

  IF v_bill.admission_id IS NOT NULL THEN
    -- balance + total_debited: patientPayable is gross of advance, so advance
    -- already applied to the bill still counts as a credit.
    SELECT COALESCE(balance, 0) + COALESCE(total_debited, 0)
      INTO v_net_advance
    FROM public.ipd_advance_balances
    WHERE admission_id = v_bill.admission_id;

    -- Legacy advance_receipts not yet mirrored into ipd_advances, else the
    -- same deposit is counted twice. Admission-scoped: a patient's earlier
    -- stays must not leak into this one.
    SELECT COALESCE(SUM(ar.amount), 0)
      INTO v_unmirrored
    FROM public.advance_receipts ar
    WHERE ar.admission_id = v_bill.admission_id
      AND (
        ar.receipt_number IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.ipd_advances ia
          WHERE ia.admission_id = v_bill.admission_id
            AND ia.reference_no = ar.receipt_number
        )
      );

    v_net_advance := COALESCE(v_net_advance, 0) + COALESCE(v_unmirrored, 0);
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_direct_paid
  FROM public.bill_payments
  WHERE bill_id = p_bill_id
    AND COALESCE(is_advance, false) = false;

  RETURN ROUND(GREATEST(v_net_advance + v_direct_paid - v_payable, 0), 2);
END; $$;


-- ── 2. Replace a stale pending refund ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resync_pending_refund(p_bill_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_old public.refund_payables%ROWTYPE;
  v_new numeric;
BEGIN
  IF p_bill_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_old
  FROM public.refund_payables
  WHERE bill_id = p_bill_id
    AND credit_note_id IS NULL
    AND status = 'pending_approval'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  v_new := public.compute_bill_refund_due(p_bill_id);

  -- Unchanged (to the paisa) — nothing to do. This is also what makes a
  -- multi-row statement safe: the first row's trigger does the work, the
  -- rest recompute the same figure and no-op.
  IF ABS(v_new - COALESCE(v_old.amount, 0)) < 0.01 THEN RETURN; END IF;

  UPDATE public.refund_payables
     SET status           = 'rejected',
         rejection_reason = format(
           'Superseded automatically — %s. Requested amount %s is no longer correct; recomputed to %s.',
           p_reason, to_char(v_old.amount, 'FM999999990.00'), to_char(v_new, 'FM999999990.00')),
         notes = COALESCE(v_old.notes || ' — ', '')
                 || format('Auto-rejected %s: %s.', to_char(now(), 'YYYY-MM-DD HH24:MI'), p_reason)
   WHERE id = v_old.id;

  -- Re-raise at the corrected figure. If the change wiped the overpayment out
  -- entirely (v_new = 0) the refund is simply retired, not recreated.
  IF v_new > 0 THEN
    INSERT INTO public.refund_payables (
      hospital_id, patient_id, admission_id, bill_id, credit_note_id,
      amount, refund_mode, status, requested_by, notes
    ) VALUES (
      v_old.hospital_id, v_old.patient_id, v_old.admission_id, v_old.bill_id, NULL,
      v_new, v_old.refund_mode, 'pending_approval', v_old.requested_by,
      format('Auto-raised %s, replacing the %s request for %s (%s).',
             to_char(now(), 'YYYY-MM-DD HH24:MI'),
             to_char(v_old.created_at, 'YYYY-MM-DD HH24:MI'),
             to_char(v_old.amount, 'FM999999990.00'), p_reason)
    );
  END IF;
END; $$;


-- ── 2b. Let the resync run on a locked day ───────────────────────────────────
-- prevent_refund_on_locked_day guards refund_payables against writes dated
-- into a locked day. It checks COALESCE(processed_at, created_at)::date, so a
-- pending refund raised on a day that is later locked can no longer be
-- auto-rejected — and because that rejection happens inside an AFTER trigger
-- on bill_line_items, the refusal would abort the user's edit entirely.
-- Adding a service would start failing again, which is the bug we just fixed.
--
-- Safe to exempt: DailyCashClosurePage reads refund_payables with
-- `.eq("status","processed")` filtered on processed_at, so ONLY processed rows
-- ever reach a closure figure. A pending/approved/rejected row is invisible to
-- closure and cannot drift a locked day's total. Transitions INTO 'processed'
-- — the actual cash event — remain fully guarded.

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

  -- Exempt: nothing here is or was a disbursement, so closure cannot see it.
  IF TG_OP = 'INSERT' AND NEW.status <> 'processed' THEN
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> 'processed' AND OLD.status <> 'processed' THEN
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.status <> 'processed' THEN
    RETURN OLD;
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
      'Day % is locked (cash closure). Refunds cannot be disbursed on a locked '
      'day. Reopen it first: Billing → Day Closure → Reopen Day.',
      v_date;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;$$;


-- ── 3. Trigger wrappers, one per invalidating event ──────────────────────────

-- Line items: charges added, edited or removed.
CREATE OR REPLACE FUNCTION public.trg_resync_refund_line_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.resync_pending_refund(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.bill_id ELSE NEW.bill_id END,
    'bill charges changed');
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_resync_refund_on_line_items ON public.bill_line_items;
CREATE TRIGGER trg_resync_refund_on_line_items
  AFTER INSERT OR UPDATE OR DELETE ON public.bill_line_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_resync_refund_line_items();


-- Payments: cash collected or reversed against the bill.
CREATE OR REPLACE FUNCTION public.trg_resync_refund_payments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.resync_pending_refund(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.bill_id ELSE NEW.bill_id END,
    'a payment was recorded or changed');
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_resync_refund_on_payments ON public.bill_payments;
CREATE TRIGGER trg_resync_refund_on_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_resync_refund_payments();


-- Bill-level discount / insurance. Guarded by a WHEN clause so ordinary totals
-- recalculations (which fire constantly) do not run this.
CREATE OR REPLACE FUNCTION public.trg_resync_refund_bill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.resync_pending_refund(NEW.id, 'the bill discount or insurance share changed');
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_resync_refund_on_bill ON public.bills;
CREATE TRIGGER trg_resync_refund_on_bill
  AFTER UPDATE ON public.bills
  FOR EACH ROW
  WHEN (OLD.discount_amount  IS DISTINCT FROM NEW.discount_amount
     OR OLD.insurance_amount IS DISTINCT FROM NEW.insurance_amount)
  EXECUTE FUNCTION public.trg_resync_refund_bill();


-- Advances: deposits, applications and refunds shift the credit side.
-- Keyed by admission, so every bill on that admission holding a pending
-- refund is resynced.
CREATE OR REPLACE FUNCTION public.trg_resync_refund_advances()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admission uuid;
  v_bill      uuid;
BEGIN
  v_admission := CASE WHEN TG_OP = 'DELETE' THEN OLD.admission_id ELSE NEW.admission_id END;
  IF v_admission IS NULL THEN RETURN NULL; END IF;

  FOR v_bill IN
    SELECT DISTINCT rp.bill_id
    FROM public.refund_payables rp
    WHERE rp.admission_id = v_admission
      AND rp.bill_id IS NOT NULL
      AND rp.credit_note_id IS NULL
      AND rp.status = 'pending_approval'
  LOOP
    PERFORM public.resync_pending_refund(v_bill, 'the advance balance changed');
  END LOOP;

  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_resync_refund_on_ipd_advances ON public.ipd_advances;
CREATE TRIGGER trg_resync_refund_on_ipd_advances
  AFTER INSERT OR UPDATE OR DELETE ON public.ipd_advances
  FOR EACH ROW EXECUTE FUNCTION public.trg_resync_refund_advances();

DROP TRIGGER IF EXISTS trg_resync_refund_on_advance_receipts ON public.advance_receipts;
CREATE TRIGGER trg_resync_refund_on_advance_receipts
  AFTER INSERT OR UPDATE OR DELETE ON public.advance_receipts
  FOR EACH ROW EXECUTE FUNCTION public.trg_resync_refund_advances();
