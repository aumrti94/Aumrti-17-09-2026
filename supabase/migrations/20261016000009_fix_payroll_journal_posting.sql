-- Phase 1.1 — payroll GL posting: move it into the database, on the established pattern.
--
-- ROOT CAUSE (RC-4 + RC-5). PayrollTab.tsx built a journal entry client-side against a schema
-- that does not exist, and discarded every error, so the failure was invisible:
--
--   inserted column   | actual journal_entries column
--   ------------------+------------------------------
--   journal_number    | entry_number
--   status:'posted'   | (no such column — entry_type / is_balanced instead)
--   reference_type    | source_module
--   reference_id      | source_id
--   created_by        | posted_by
--   -> line table "journal_entry_lines" does not exist; it is journal_line_items
--   -> journal_line_items.account_id is NOT NULL and was never supplied
--
-- VERIFIED CONSEQUENCE (live): the header INSERT fails outright, so `journal` is null and the
-- `if (journal)` block never runs. Payroll has therefore NEVER reached the general ledger —
-- journal_entries.source_module contains no 'payroll' row. The GL itself is clean: 0 orphan
-- headers, 0 unbalanced entries, all 842 rows is_balanced = true.
--
-- (This corrects the audit's C-03, which predicted accumulating unbalanced headers. The failure
-- is total rather than partial: nothing was written at all.)
--
-- WHY NOT SIMPLY RENAME THE TABLE: the hardcoded account codes are wrong for this chart of
-- accounts, and would have posted plausible-looking but incorrect entries —
--   2101 -> expected "Salaries Payable", actually **Bank Loan**
--   2102 -> expected "TDS / PF Payable", actually **Equipment Finance Loan**
-- Correcting only the table name would have silently booked net salary as a bank loan.
--
-- THE FIX: this project already has the right mechanism. auto_post_bill_journal() posts billing
-- to the GL by resolving accounts from auto_posting_rules, generating entry_number via
-- next_seq() with a collision-retry loop, and writing header + lines in one statement pair. A
-- 'payroll_processed' rule is ALREADY configured for all 6 hospitals. This function mirrors that
-- pattern exactly, so payroll posts through configured accounts rather than invented codes.
--
-- Behaviour when no rule is configured: pg_notify and return NULL, exactly as the billing
-- trigger does. Payroll approval must never be blocked by an accounting misconfiguration.
--
-- Idempotent: a second call for the same run returns the existing journal id.

BEGIN;

-- Restores the RPC PayrollTab/OffboardingTab already call. Built on next_seq() so numbering
-- shares the 'journal' sequence with auto_post_bill_journal instead of forking a second scheme.
CREATE OR REPLACE FUNCTION public.get_next_journal_number(p_hospital_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_seq bigint;
BEGIN
  SELECT public.next_seq(p_hospital_id, 'journal') INTO v_seq;
  RETURN 'JE-' || extract(year FROM now())::text || '-' || lpad(v_seq::text, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_payroll_journal(p_run_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run       record;
  v_rule      record;
  v_entry     record;
  v_seq       bigint;
  v_entry_num text;
  v_attempt   int;
  v_existing  uuid;
BEGIN
  SELECT id, hospital_id, run_month, total_gross, approved_by, processed_by
    INTO v_run
  FROM public.payroll_runs
  WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll run % not found', p_run_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Caller must belong to the run's hospital (or be platform staff). SECURITY DEFINER bypasses
  -- RLS, so the tenant check has to be explicit here.
  IF NOT (v_run.hospital_id = public.get_user_hospital_id() OR public.is_aumrti_admin()) THEN
    RAISE EXCEPTION 'not authorised to post payroll for this hospital' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF COALESCE(v_run.total_gross, 0) <= 0 THEN
    RETURN NULL;   -- nothing to post
  END IF;

  -- Idempotency: never double-post a run.
  SELECT id INTO v_existing FROM public.journal_entries
   WHERE hospital_id = v_run.hospital_id AND source_module = 'payroll' AND source_id = p_run_id
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT apr.debit_account_id, apr.credit_account_id,
         da.code AS d_code, da.name AS d_name,
         ca.code AS c_code, ca.name AS c_name
    INTO v_rule
  FROM public.auto_posting_rules apr
  JOIN public.chart_of_accounts da ON da.id = apr.debit_account_id
  JOIN public.chart_of_accounts ca ON ca.id = apr.credit_account_id
  WHERE apr.hospital_id = v_run.hospital_id
    AND apr.trigger_event = 'payroll_processed'
    AND apr.is_active = true
  LIMIT 1;

  -- No rule configured: surface it, but never block payroll approval.
  IF NOT FOUND THEN
    PERFORM pg_notify('payroll_unposted_alert', json_build_object(
      'run_id', p_run_id, 'hospital_id', v_run.hospital_id,
      'reason', 'no_auto_posting_rule', 'trigger_event', 'payroll_processed',
      'event_time', now())::text);
    RETURN NULL;
  END IF;

  v_entry := NULL;
  FOR v_attempt IN 1..10 LOOP
    SELECT public.next_seq(v_run.hospital_id, 'journal') INTO v_seq;
    v_entry_num := 'JE-' || extract(year FROM now())::text || '-' || lpad(v_seq::text, 4, '0');
    BEGIN
      INSERT INTO public.journal_entries (
        hospital_id, entry_number, entry_date, description, entry_type,
        source_module, source_id, total_debit, total_credit, is_balanced, posted_by
      ) VALUES (
        v_run.hospital_id, v_entry_num, CURRENT_DATE,
        'Payroll: ' || COALESCE(v_run.run_month, 'Monthly'),
        'auto_payroll', 'payroll', p_run_id,
        v_run.total_gross, v_run.total_gross, true,
        COALESCE(v_run.approved_by, v_run.processed_by)
      ) RETURNING * INTO v_entry;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_entry := NULL; CONTINUE;
    END;
  END LOOP;

  IF v_entry IS NULL THEN
    PERFORM pg_notify('payroll_unposted_alert', json_build_object(
      'run_id', p_run_id, 'hospital_id', v_run.hospital_id,
      'reason', 'seq_retry_exhausted', 'event_time', now())::text);
    RETURN NULL;
  END IF;

  -- Two balanced lines through the CONFIGURED accounts. A finer split (net pay vs TDS vs PF)
  -- would need its own auto_posting_rules entries; inventing account codes here is exactly the
  -- defect this migration exists to remove, so the summary entry is posted instead.
  INSERT INTO public.journal_line_items
    (hospital_id, journal_id, account_id, account_code, account_name, debit_amount, credit_amount, description)
  VALUES
    (v_run.hospital_id, v_entry.id, v_rule.debit_account_id,  v_rule.d_code, v_rule.d_name,
     v_run.total_gross, 0, 'Gross salary for ' || COALESCE(v_run.run_month, 'month')),
    (v_run.hospital_id, v_entry.id, v_rule.credit_account_id, v_rule.c_code, v_rule.c_name,
     0, v_run.total_gross, 'Payroll liability for ' || COALESCE(v_run.run_month, 'month'));

  RETURN v_entry.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.post_payroll_journal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_payroll_journal(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_next_journal_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_journal_number(uuid) TO authenticated;

COMMIT;
