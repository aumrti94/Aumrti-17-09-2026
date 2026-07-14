-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: backfill_orphaned_expenses
-- Purpose  : One-time backfill for expense_records rows whose GL posting
--            attempt silently failed under the pre-fix journal_entries
--            entry_type CHECK constraint (see
--            20261008000091_fix_entry_type_check_constraint.sql) — the
--            GST-split branch posted entry_type='auto_accounts', which
--            violated the old narrow allow-list. postMultiLineJournal()
--            swallows that failure (`return null`) with no
--            accounting_posting_failures row logged, so these are otherwise
--            untraceable. Confirmed live: hospital ca48d968's one catering
--            expense (₹5,018, GST ₹18) has zero matching journal entry.
--
--            Posts the exact same entry the app would have posted:
--            category -> debit expense account (mirrors
--            EXPENSE_CATEGORY_ACCOUNT in src/lib/accounting.ts), GST (if any)
--            -> Dr 1050 GST Input Tax Credit, payment_mode -> credit
--            cash/bank account.
--
-- Idempotent: only processes expense_records with no journal_entries row at
--             source_module='accounts' + matching source_id — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r             record;
  v_debit_code  text;
  v_debit_id    uuid;
  v_debit_name  text;
  v_credit_code text;
  v_credit_id   uuid;
  v_credit_name text;
  v_gst_id      uuid;
  v_seq         bigint;
  v_entry_num   text;
  v_entry_id    uuid;
  v_desc        text;
BEGIN
  FOR r IN
    SELECT er.*
    FROM public.expense_records er
    WHERE NOT EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.source_module = 'accounts' AND je.source_id = er.id
    )
  LOOP
    v_debit_code := CASE r.expense_category::text
      WHEN 'salary' THEN '5001' WHEN 'rent' THEN '5020' WHEN 'electricity' THEN '5021'
      WHEN 'water' THEN '5022' WHEN 'telephone' THEN '5023' WHEN 'internet' THEN '5023'
      WHEN 'fuel' THEN '5060' WHEN 'vehicle' THEN '5060' WHEN 'maintenance' THEN '5030'
      WHEN 'repair' THEN '5030' WHEN 'housekeeping' THEN '5032' WHEN 'laundry' THEN '5060'
      WHEN 'catering' THEN '5060' WHEN 'insurance' THEN '5051' WHEN 'professional_fees' THEN '5040'
      WHEN 'marketing' THEN '5041' WHEN 'printing' THEN '5042' WHEN 'stationery' THEN '5042'
      WHEN 'bank_charges' THEN '5043' WHEN 'depreciation' THEN '5050' WHEN 'miscellaneous' THEN '5060'
      ELSE '5060' END;
    v_credit_code := CASE r.payment_mode::text
      WHEN 'cash' THEN '1001' WHEN 'bank_transfer' THEN '1002' WHEN 'upi' THEN '1002'
      WHEN 'cheque' THEN '1002' WHEN 'card' THEN '1002' ELSE '1001' END;
    v_desc := 'Expense: ' || COALESCE(r.description, r.expense_category::text);

    SELECT id, name INTO v_debit_id, v_debit_name  FROM public.chart_of_accounts WHERE hospital_id = r.hospital_id AND code = v_debit_code;
    SELECT id, name INTO v_credit_id, v_credit_name FROM public.chart_of_accounts WHERE hospital_id = r.hospital_id AND code = v_credit_code;
    IF v_debit_id IS NULL OR v_credit_id IS NULL THEN CONTINUE; END IF;

    SELECT public.next_seq(r.hospital_id, 'journal') INTO v_seq;
    v_entry_num := 'JE-' || extract(year FROM r.expense_date)::text || '-' || lpad(v_seq::text, 4, '0');

    INSERT INTO public.journal_entries
      (hospital_id, entry_number, entry_date, description, entry_type,
       source_module, source_id, total_debit, total_credit, is_balanced, posted_by)
    VALUES
      (r.hospital_id, v_entry_num, r.expense_date, v_desc, 'manual', 'accounts', r.id,
       r.total_amount, r.total_amount, true, r.created_by)
    RETURNING id INTO v_entry_id;

    IF COALESCE(r.gst_amount, 0) > 0 THEN
      SELECT id INTO v_gst_id FROM public.chart_of_accounts WHERE hospital_id = r.hospital_id AND code = '1050';
      INSERT INTO public.journal_line_items
        (hospital_id, journal_id, account_id, account_code, account_name, debit_amount, credit_amount, description)
      VALUES
        (r.hospital_id, v_entry_id, v_debit_id, v_debit_code, v_debit_name, r.amount, 0, v_desc),
        (r.hospital_id, v_entry_id, COALESCE(v_gst_id, v_debit_id), '1050', 'GST Input Tax Credit', r.gst_amount, 0, 'GST Input Tax Credit'),
        (r.hospital_id, v_entry_id, v_credit_id, v_credit_code, v_credit_name, 0, r.total_amount, v_desc);
    ELSE
      INSERT INTO public.journal_line_items
        (hospital_id, journal_id, account_id, account_code, account_name, debit_amount, credit_amount, description)
      VALUES
        (r.hospital_id, v_entry_id, v_debit_id, v_debit_code, v_debit_name, r.total_amount, 0, v_desc),
        (r.hospital_id, v_entry_id, v_credit_id, v_credit_code, v_credit_name, 0, r.total_amount, v_desc);
    END IF;
  END LOOP;
END $$;
