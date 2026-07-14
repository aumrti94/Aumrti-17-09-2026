-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: bill_posting_generic_fallback
-- Purpose  : auto_post_bill_journal() derives trigger_event as
--            'bill_finalized_' || bill_type and looks up an EXACT match in
--            auto_posting_rules. Only 6 bill types were ever seeded with a
--            specific rule (opd, ipd, ot, lab, radiology, pharmacy) plus a
--            'bill_finalized_generic' rule that nothing ever actually routes
--            to (bill_type is never literally the string 'generic'). Every
--            other clinical module's bill_type — emergency, daycare,
--            dialysis, dental, ivf, blood_bank, ambulance, home_care,
--            mental_health, chronic_disease, oncology, physio, ayush,
--            vaccination, packages (when not aliased to 'opd') — has NO rule,
--            so the trigger's "no rule" branch fires: it pg_notifies and
--            returns, silently dropping that bill's revenue from the GL
--            forever. Confirmed live: hospital ca48d968's one finalized
--            Emergency bill never posted.
--
--            Fix: if no bill-type-specific rule exists, retry once against
--            'bill_finalized_generic' before giving up. Every bill's revenue
--            now lands somewhere (Dr AR / Cr OPD Revenue by default) instead
--            of vanishing; a hospital can still add a specific rule later for
--            per-category reporting.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Preserves the entry-number retry
--             loop introduced by 20260520000001_fix_journal_sequence_sync.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_post_bill_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rule      record;
  v_entry     record;
  v_seq       bigint;
  v_entry_num text;
  v_event     text;
  v_attempt   int;
BEGIN
  -- Only act when a bill becomes final for the first time.
  IF NEW.bill_status <> 'final' OR NEW.posted_to_journal THEN
    RETURN NEW;
  END IF;

  v_event := 'bill_finalized_' || COALESCE(NEW.bill_type, 'opd');

  SELECT
    apr.debit_account_id,
    apr.credit_account_id,
    da.code AS d_code,  da.name AS d_name,
    ca.code AS c_code,  ca.name AS c_name
  INTO v_rule
  FROM  public.auto_posting_rules    apr
  JOIN  public.chart_of_accounts     da ON da.id = apr.debit_account_id
  JOIN  public.chart_of_accounts     ca ON ca.id = apr.credit_account_id
  WHERE apr.hospital_id   = NEW.hospital_id
    AND apr.trigger_event = v_event
    AND apr.is_active     = true
  LIMIT 1;

  -- No bill-type-specific rule -> fall back to the generic revenue rule
  -- rather than silently dropping this bill's revenue from the GL.
  IF NOT FOUND THEN
    SELECT
      apr.debit_account_id,
      apr.credit_account_id,
      da.code AS d_code,  da.name AS d_name,
      ca.code AS c_code,  ca.name AS c_name
    INTO v_rule
    FROM  public.auto_posting_rules    apr
    JOIN  public.chart_of_accounts     da ON da.id = apr.debit_account_id
    JOIN  public.chart_of_accounts     ca ON ca.id = apr.credit_account_id
    WHERE apr.hospital_id   = NEW.hospital_id
      AND apr.trigger_event = 'bill_finalized_generic'
      AND apr.is_active     = true
    LIMIT 1;
  END IF;

  -- Still no rule configured at all (not even generic) — do NOT block billing.
  IF NOT FOUND THEN
    PERFORM pg_notify(
      'bill_unposted_alert',
      json_build_object(
        'bill_id',       NEW.id,
        'hospital_id',   NEW.hospital_id,
        'bill_number',   NEW.bill_number,
        'amount',        NEW.total_amount,
        'trigger_event', v_event,
        'reason',        'no_auto_posting_rule',
        'event_time',    now()
      )::text
    );
    RETURN NEW;
  END IF;

  -- Retry loop: if the generated entry_number collides with an existing row
  -- (sequence was behind) keep calling next_seq until a free slot is found.
  v_entry := NULL;
  FOR v_attempt IN 1..10 LOOP
    SELECT public.next_seq(NEW.hospital_id, 'journal') INTO v_seq;
    v_entry_num := 'JE-' || extract(year FROM now())::text
                   || '-' || lpad(v_seq::text, 4, '0');

    BEGIN
      INSERT INTO public.journal_entries (
        hospital_id,   entry_number,  entry_date,
        description,   entry_type,    source_module,
        source_id,     total_debit,   total_credit,
        is_balanced,   posted_by
      ) VALUES (
        NEW.hospital_id,
        v_entry_num,
        CURRENT_DATE,
        'Auto: Bill ' || COALESCE(NEW.bill_number, NEW.id::text),
        'auto_billing',
        COALESCE(NEW.bill_type, 'billing'),
        NEW.id,
        NEW.total_amount,
        NEW.total_amount,
        true,
        NEW.created_by
      ) RETURNING * INTO v_entry;

      EXIT; -- success
    EXCEPTION WHEN unique_violation THEN
      v_entry := NULL;
      CONTINUE;
    END;
  END LOOP;

  IF v_entry IS NULL THEN
    PERFORM pg_notify(
      'bill_unposted_alert',
      json_build_object(
        'bill_id',     NEW.id,
        'hospital_id', NEW.hospital_id,
        'reason',      'seq_retry_exhausted',
        'event_time',  now()
      )::text
    );
    RETURN NEW;
  END IF;

  INSERT INTO public.journal_line_items
    (hospital_id, journal_id,
     account_id,              account_code,   account_name,
     debit_amount,            credit_amount,  description)
  VALUES
    (NEW.hospital_id, v_entry.id,
     v_rule.debit_account_id,  v_rule.d_code, v_rule.d_name,
     NEW.total_amount, 0,
     'Bill ' || COALESCE(NEW.bill_number, '')),
    (NEW.hospital_id, v_entry.id,
     v_rule.credit_account_id, v_rule.c_code, v_rule.c_name,
     0, NEW.total_amount,
     'Bill ' || COALESCE(NEW.bill_number, ''));

  UPDATE public.bills
  SET    posted_to_journal = true
  WHERE  id = NEW.id;

  RETURN NEW;
END;
$$;
