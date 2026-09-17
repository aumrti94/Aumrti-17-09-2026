-- Phase 3.1 — recalculate_bill_totals: move bill arithmetic into the database.
--
-- ROOT CAUSE (C-06 / U-4): this RPC has never existed. src/lib/billTotals.ts is explicit about it
-- ("confirmed via pg_proc — every call errors and falls through") and implements a complete
-- client-side fallback, so every monetary total on every bill has been computed by browser
-- JavaScript and written back as untrusted input. Nothing in the database re-derived
-- bills.total_amount from bill_line_items, so a caller with a valid session could
-- UPDATE bills SET total_amount = 0, payment_status = 'paid' and RLS would allow it —
-- tenant isolation was enforced, arithmetic integrity was not.
--
-- This implementation mirrors computeBillTotals() in src/lib/billTotals.ts EXACTLY, including
-- two conventions that must not drift:
--   * total_amount is NET OF DISCOUNT (the comment in billTotals.ts warns that breaking this
--     lets a later line-item edit silently re-inflate an already-discounted bill);
--   * every intermediate is clamped at zero with max(x, 0), matching roundCurrency + Math.max.
-- UNGUARDED as of 2026-09-05 — src/lib/billTotals.test.ts, which specified and enforced both
-- conventions, was removed with the rest of the suite. This comment is now the only record
-- of the two conventions; nothing currently checks the SQL and TS implementations agree.
--
-- SECURITY INVOKER (the default — deliberately NOT security definer): the caller's own RLS
-- decides which bills they may touch, and the existing day-close triggers
-- (prevent_payment_on_locked_day, prevent_payment_on_locked_bill_day) still fire on the UPDATE.
-- A definer function here would bypass both.
--
-- The client fallback in billTotals.ts is intentionally left in place. It now becomes a genuine
-- fallback rather than the only implementation, and it already reports when it is used.

BEGIN;

CREATE OR REPLACE FUNCTION public.recalculate_bill_totals(p_bill_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_bill      record;
  v_subtotal  numeric(15,2);
  v_gst       numeric(15,2);
  v_discount  numeric(15,2);
  v_total     numeric(15,2);
  v_advance   numeric(15,2);
  v_insurance numeric(15,2);
  v_paid      numeric(15,2);
  v_payable   numeric(15,2);
  v_balance   numeric(15,2);
  v_status    text;
  v_line_count integer;
BEGIN
  SELECT discount_amount, advance_received, insurance_amount, paid_amount
    INTO v_bill
  FROM public.bills
  WHERE id = p_bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bill % not found', p_bill_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*),
         COALESCE(round(SUM(taxable_amount)::numeric, 2), 0),
         COALESCE(round(SUM(gst_amount)::numeric, 2), 0)
    INTO v_line_count, v_subtotal, v_gst
  FROM public.bill_line_items
  WHERE bill_id = p_bill_id;

  -- GUARD — do not zero a bill that has no line items.
  --
  -- Measured on live data: 14 of 138 bills carry a total_amount with NO corresponding
  -- bill_line_items rows (e.g. OPD-20260630-0001 stores 600.00 against 0 line items), because
  -- some charges were written straight onto the bill header. Deriving totals from line items
  -- would wipe that revenue to 0.00.
  --
  -- The client-side fallback in billTotals.ts has always had this behaviour, so this is not a
  -- regression introduced here — but there is no reason to carry the hazard into the database
  -- implementation. With no lines to derive from, the correct action is to leave the bill alone.
  -- Reconciling those 14 bills is a data task, tracked separately; it is not something a
  -- recalculation routine should do silently.
  IF v_line_count = 0 THEN
    RETURN;
  END IF;

  v_discount  := COALESCE(round(v_bill.discount_amount::numeric,  2), 0);
  v_advance   := COALESCE(round(v_bill.advance_received::numeric,  2), 0);
  v_insurance := COALESCE(round(v_bill.insurance_amount::numeric,  2), 0);
  v_paid      := COALESCE(round(v_bill.paid_amount::numeric,       2), 0);

  v_total   := round(GREATEST(v_subtotal + v_gst - v_discount, 0), 2);
  v_payable := round(GREATEST(v_total - v_advance - v_insurance, 0), 2);
  v_balance := round(GREATEST(v_payable - v_paid, 0), 2);

  v_status := CASE
                WHEN v_balance <= 0 AND v_paid > 0 THEN 'paid'
                WHEN v_paid > 0                    THEN 'partial'
                ELSE 'unpaid'
              END;

  UPDATE public.bills
     SET subtotal        = v_subtotal,
         taxable_amount  = v_subtotal,
         gst_amount      = v_gst,
         total_amount    = v_total,
         patient_payable = v_payable,
         balance_due     = v_balance,
         payment_status  = v_status,
         updated_at      = now()
   WHERE id = p_bill_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_bill_totals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_bill_totals(uuid) TO authenticated;

COMMIT;
