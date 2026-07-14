-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: record_online_bill_payment
-- Purpose  : Give the Razorpay webhook (a Deno edge function that cannot import
--            the browser-side recordBillPayment()/autoPostJournalEntry() TS lib)
--            an atomic, GL-correct way to reconcile an online patient payment.
--
--            Previously razorpay-webhook and PaymentLandingPage's non-Razorpay
--            fallback each hand-rolled their own bill_payments insert + bills
--            update, bypassing the shared collection path entirely — neither
--            posted a journal entry, so every online-captured payment was
--            invisible to the ledger. This RPC is the single, DB-side mirror
--            of recordBillPayment's write path (bill_payments row, GL posting
--            via auto_posting_rules, bills update, admission billing_cleared),
--            callable with the service-role key from any edge function.
--
-- Idempotent: transaction_id uniqueness check (mirrors razorpay-webhook's own
--             existing duplicate guard, now enforced at the data layer too).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_online_bill_payment(
  p_hospital_id       uuid,
  p_bill_id           uuid,
  p_amount            numeric,
  p_payment_mode      text DEFAULT 'upi',
  p_transaction_id    text DEFAULT NULL,
  p_gateway_reference text DEFAULT NULL,
  p_notes             text DEFAULT 'Online payment'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bill        record;
  v_new_paid    numeric(12,2);
  v_new_balance numeric(12,2);
  v_new_status  text;
  v_rule        record;
  v_seq         bigint;
  v_entry_num   text;
  v_entry_id    uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'amount must be positive');
  END IF;

  -- Idempotency: never record the same gateway transaction twice.
  IF p_transaction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bill_payments WHERE transaction_id = p_transaction_id
  ) THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  SELECT id, hospital_id, paid_amount, balance_due, total_amount, admission_id
    INTO v_bill
    FROM public.bills
   WHERE id = p_bill_id AND hospital_id = p_hospital_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Bill not found');
  END IF;

  INSERT INTO public.bill_payments
    (hospital_id, bill_id, payment_mode, amount, transaction_id, gateway_reference, notes)
  VALUES
    (p_hospital_id, p_bill_id, p_payment_mode, p_amount, p_transaction_id, p_gateway_reference, p_notes);

  v_new_paid    := COALESCE(v_bill.paid_amount, 0) + p_amount;
  v_new_balance := GREATEST(COALESCE(v_bill.total_amount, 0) - v_new_paid, 0);
  v_new_status  := CASE WHEN v_new_balance <= 0 THEN 'paid'
                        WHEN v_new_paid > 0    THEN 'partial'
                        ELSE 'unpaid' END;

  UPDATE public.bills
  SET    paid_amount = v_new_paid, balance_due = v_new_balance, payment_status = v_new_status
  WHERE  id = p_bill_id;

  IF v_new_status = 'paid' AND v_bill.admission_id IS NOT NULL THEN
    UPDATE public.admissions SET billing_cleared = true WHERE id = v_bill.admission_id;
  END IF;

  -- GL posting — same auto_posting_rules convention as the browser-side
  -- autoPostJournalEntry() (bill_payment_{mode} trigger event: Dr Cash/Bank / Cr AR).
  SELECT apr.debit_account_id, apr.credit_account_id,
         da.code AS d_code, da.name AS d_name, ca.code AS c_code, ca.name AS c_name
    INTO v_rule
    FROM public.auto_posting_rules apr
    JOIN public.chart_of_accounts  da ON da.id = apr.debit_account_id
    JOIN public.chart_of_accounts  ca ON ca.id = apr.credit_account_id
   WHERE apr.hospital_id   = p_hospital_id
     AND apr.trigger_event = 'bill_payment_' || p_payment_mode
     AND apr.is_active     = true
   LIMIT 1;

  IF FOUND THEN
    SELECT public.next_seq(p_hospital_id, 'journal') INTO v_seq;
    v_entry_num := 'JE-' || extract(year FROM now())::text || '-' || lpad(v_seq::text, 4, '0');

    INSERT INTO public.journal_entries
      (hospital_id, entry_number, entry_date, description, entry_type,
       source_module, source_id, total_debit, total_credit, is_balanced, posted_by)
    VALUES
      (p_hospital_id, v_entry_num, CURRENT_DATE,
       'Online payment (' || p_payment_mode || ') - Bill ' || p_bill_id::text,
       'auto_billing', 'billing', p_bill_id, p_amount, p_amount, true, NULL)
    RETURNING id INTO v_entry_id;

    INSERT INTO public.journal_line_items
      (hospital_id, journal_id, account_id, account_code, account_name, debit_amount, credit_amount, description)
    VALUES
      (p_hospital_id, v_entry_id, v_rule.debit_account_id,  v_rule.d_code, v_rule.d_name, p_amount, 0, 'Online payment received'),
      (p_hospital_id, v_entry_id, v_rule.credit_account_id, v_rule.c_code, v_rule.c_name, 0, p_amount, 'Online payment received');
  ELSE
    INSERT INTO public.accounting_posting_failures
      (hospital_id, trigger_event, source_module, source_id, amount, description)
    VALUES
      (p_hospital_id, 'bill_payment_' || p_payment_mode, 'billing', p_bill_id::text, p_amount,
       'Online payment — no auto_posting_rules row for bill_payment_' || p_payment_mode);
  END IF;

  RETURN jsonb_build_object(
    'status', 'reconciled',
    'amount', p_amount,
    'new_paid_amount', v_new_paid,
    'new_balance', v_new_balance,
    'payment_status', v_new_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_online_bill_payment(uuid, uuid, numeric, text, text, text, text)
  TO authenticated, service_role;
