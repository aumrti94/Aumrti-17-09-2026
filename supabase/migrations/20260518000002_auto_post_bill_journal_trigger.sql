-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: auto_post_bill_journal_trigger
-- Purpose  : Atomically create a journal entry inside the same DB transaction
--            as the bill finalisation. If journal creation fails the bill INSERT
--            or UPDATE is rolled back — satisfying the "no bill without journal"
--            requirement.
--
-- Design decisions:
--   • AFTER trigger: exception inside an AFTER trigger rolls back the whole txn.
--   • Fires on INSERT and UPDATE OF bill_status only — updating other columns
--     (e.g. posted_to_journal, total_amount) does NOT re-fire the trigger.
--   • No rule configured → pg_notify alert, pass through silently. Accounts not
--     being configured must never block billing operations.
--   • UPDATE bills SET posted_to_journal = true inside the trigger body does NOT
--     recurse because it modifies posted_to_journal, not bill_status.
--
-- Idempotent: Yes — CREATE OR REPLACE + DROP IF EXISTS.
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
BEGIN
  -- ── Guard ────────────────────────────────────────────────────────────────────
  -- Only act when a bill becomes final for the first time.
  IF NEW.bill_status <> 'final' OR NEW.posted_to_journal THEN
    RETURN NEW;
  END IF;

  -- ── Derive trigger_event from bill_type ──────────────────────────────────────
  -- Convention: bill_type = 'lab' → trigger_event = 'bill_finalized_lab'
  -- Covers: lab, radiology, pharmacy, dialysis, ot, ipd, blood_bank, opd, etc.
  -- Modules that use bill_type = 'opd' (dental, IVF, packages, nursing) fall back
  -- to the 'bill_finalized_opd' rule, which is the correct revenue account for
  -- all outpatient-type charges unless the hospital configures a separate rule.
  v_event := 'bill_finalized_' || COALESCE(NEW.bill_type, 'opd');

  -- ── Find matching auto_posting_rule ──────────────────────────────────────────
  SELECT
    apr.debit_account_id,
    apr.credit_account_id,
    da.code  AS d_code,  da.name  AS d_name,
    ca.code  AS c_code,  ca.name  AS c_name
  INTO v_rule
  FROM  public.auto_posting_rules    apr
  JOIN  public.chart_of_accounts     da  ON da.id = apr.debit_account_id
  JOIN  public.chart_of_accounts     ca  ON ca.id = apr.credit_account_id
  WHERE apr.hospital_id   = NEW.hospital_id
    AND apr.trigger_event = v_event
    AND apr.is_active     = true
  LIMIT 1;

  -- ── No rule configured ───────────────────────────────────────────────────────
  -- Do NOT block billing. Emit a pg_notify alert instead so the reconciliation
  -- Edge Function and any LISTEN client can pick it up.
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

  -- ── Generate atomic journal entry number ─────────────────────────────────────
  SELECT public.next_seq(NEW.hospital_id, 'journal') INTO v_seq;
  v_entry_num := 'JE-' || extract(year FROM now())::text
                 || '-' || lpad(v_seq::text, 4, '0');

  -- ── Insert journal entry ─────────────────────────────────────────────────────
  -- Any exception here propagates out of the trigger and rolls back the bill.
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
  )
  RETURNING * INTO v_entry;

  -- ── Insert debit + credit line items ────────────────────────────────────────
  INSERT INTO public.journal_line_items
    (hospital_id, journal_id,
     account_id,             account_code,   account_name,
     debit_amount,           credit_amount,  description)
  VALUES
    (NEW.hospital_id, v_entry.id,
     v_rule.debit_account_id,  v_rule.d_code, v_rule.d_name,
     NEW.total_amount, 0,
     'Bill ' || COALESCE(NEW.bill_number, '')),
    (NEW.hospital_id, v_entry.id,
     v_rule.credit_account_id, v_rule.c_code, v_rule.c_name,
     0, NEW.total_amount,
     'Bill ' || COALESCE(NEW.bill_number, ''));

  -- ── Mark bill posted ─────────────────────────────────────────────────────────
  -- This UPDATE modifies posted_to_journal, NOT bill_status, so the trigger
  -- (which fires on INSERT OR UPDATE OF bill_status) will NOT recurse.
  UPDATE public.bills
  SET    posted_to_journal = true
  WHERE  id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_post_bill_journal ON public.bills;
CREATE TRIGGER trg_auto_post_bill_journal
  AFTER INSERT OR UPDATE OF bill_status ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.auto_post_bill_journal();
