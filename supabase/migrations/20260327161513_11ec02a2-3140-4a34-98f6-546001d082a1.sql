
-- Backfill journal entries for finalized bills without entries
DO $$
DECLARE
  b record; v_ar_id uuid; v_rev_id uuid; v_entry_id uuid;
  v_entry_number text; v_count bigint; v_rev_code text;
BEGIN
  FOR b IN
    SELECT bills.*
    FROM bills
    LEFT JOIN journal_entries je ON je.source_id = bills.id AND je.source_module = 'billing'
    WHERE bills.bill_status IN ('final', 'irn_locked')
      AND COALESCE(bills.total_amount, 0) > 0
      AND je.id IS NULL
  LOOP
    v_rev_code := CASE b.bill_type
      WHEN 'opd' THEN '4001' WHEN 'ipd' THEN '4002' WHEN 'ot' THEN '4003'
      WHEN 'lab' THEN '4004' WHEN 'radiology' THEN '4005' WHEN 'pharmacy' THEN '4006'
      ELSE '4001' END;

    SELECT id INTO v_ar_id FROM chart_of_accounts WHERE hospital_id = b.hospital_id AND code = '1010';
    SELECT id INTO v_rev_id FROM chart_of_accounts WHERE hospital_id = b.hospital_id AND code = v_rev_code;
    IF v_ar_id IS NULL OR v_rev_id IS NULL THEN CONTINUE; END IF;

    SELECT COUNT(*) INTO v_count FROM journal_entries WHERE hospital_id = b.hospital_id;
    v_entry_number := 'JE-' || LPAD((v_count + 1)::text, 6, '0');

    INSERT INTO journal_entries (hospital_id, entry_number, entry_date, description, entry_type, source_module, source_id, total_debit, total_credit, is_balanced, posted_by)
    VALUES (b.hospital_id, v_entry_number, b.bill_date, 'Revenue: Bill #' || b.bill_number || ' (' || UPPER(b.bill_type) || ') — backfill', 'auto_billing', 'billing', b.id, b.total_amount, b.total_amount, true, COALESCE(b.created_by, '00000000-0000-0000-0000-000000000000'))
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_line_items (hospital_id, journal_id, account_id, account_code, account_name, debit_amount, credit_amount, description)
    SELECT b.hospital_id, v_entry_id, v_ar_id, '1010', 'Accounts Receivable', b.total_amount, 0, 'Revenue: Bill #' || b.bill_number
    UNION ALL
    SELECT b.hospital_id, v_entry_id, v_rev_id, v_rev_code, c.name, 0, b.total_amount, 'Revenue: Bill #' || b.bill_number
    FROM chart_of_accounts c WHERE c.id = v_rev_id;
  END LOOP;
END;
$$;
