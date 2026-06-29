-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fix_journal_sequence_sync
-- Purpose  : 1. Sync hospital_sequences.last_val to the highest existing
--               journal entry number so the trigger never generates a number
--               that already exists (fixes "duplicate key" on OPD registration).
--            2. Replace auto_post_bill_journal with a retry-safe version that
--               handles duplicate entry_number gracefully instead of aborting
--               the billing transaction.
-- Idempotent: Yes — uses ON CONFLICT, CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Sync sequences ────────────────────────────────────────────────────────
-- Re-calculates the max seq number from existing journal_entries and advances
-- hospital_sequences.last_val if it lags behind. Safe to run multiple times.
INSERT INTO public.hospital_sequences (hospital_id, seq_type, last_val)
SELECT
  hospital_id,
  'journal' AS seq_type,
  COALESCE(
    MAX(
      CASE
        WHEN entry_number ~ '^JE-\d{4}-\d+$'
        THEN CAST(SUBSTRING(entry_number FROM '\d+$') AS bigint)
        ELSE 0
      END
    ),
    0
  ) AS last_val
FROM public.journal_entries
GROUP BY hospital_id
ON CONFLICT (hospital_id, seq_type)
DO UPDATE SET last_val = GREATEST(
  hospital_sequences.last_val,
  EXCLUDED.last_val
);

-- ── 2. Retry-safe trigger function ──────────────────────────────────────────
-- Same logic as before, but wraps the INSERT in an exception handler so that
-- a stale sequence number (duplicate) causes a retry rather than aborting the
-- enclosing bills transaction.
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
      -- seq is behind existing entries; next iteration will call next_seq again
      v_entry := NULL;
      CONTINUE;
    END;
  END LOOP;

  -- If all retries exhausted, emit alert and do NOT block billing.
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
