-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fix_reverse_journal_entry_uuid_compare
-- Purpose  : reverse_journal_entry() compared bills.id::text to journal_entries.source_id,
--            which is a uuid column. `text = uuid` has no operator, so the function raised
--
--              ERROR 42883: operator does not exist: text = uuid
--
--            for EVERY auto-posted, bill-anchored entry — i.e. exactly the case the
--            reversal was extended to support. Manual entries were unaffected (they skip
--            the bill-anchored branch entirely), which is why this went unnoticed: the
--            Reverse button in Accounts → Journal works on manual entries and throws a raw
--            Postgres error on auto-posted bill entries.
--
--            Found while reversing a phantom revenue posting from a duplicate day care bill.
--
-- Fix      : compare uuid to uuid (drop the ::text casts). Two sites: the v_bill_anchored
--            EXISTS test, and the posted_to_journal reset.
--
-- Idempotent: CREATE OR REPLACE.
-- Behaviour : No logic change beyond the comparison — a path that previously always threw
--             now runs as designed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_hospital_id uuid,
  p_journal_id uuid,
  p_reversed_by uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orig          record;
  v_seq           bigint;
  v_entry_num     text;
  v_new_id        uuid;
  v_bill_anchored boolean := false;
BEGIN
  SELECT * INTO v_orig FROM public.journal_entries
   WHERE id = p_journal_id AND hospital_id = p_hospital_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Journal entry not found');
  END IF;

  IF v_orig.entry_type <> 'manual' THEN
    IF v_orig.entry_type NOT LIKE 'auto_%' THEN
      RETURN jsonb_build_object('status', 'error', 'message', 'Only manual entries, or auto-posted entries linked to a bill, can be reversed here');
    END IF;

    -- journal_entries.source_id is uuid; comparing bills.id::text to it raised
    -- "operator does not exist: text = uuid" and made this whole branch unreachable.
    v_bill_anchored := EXISTS (
      SELECT 1 FROM public.bills WHERE id = v_orig.source_id AND hospital_id = p_hospital_id
    );
    IF NOT v_bill_anchored THEN
      RETURN jsonb_build_object(
        'status', 'error',
        'message', 'This entry posts to a subledger (fixed assets, depreciation, inventory, payroll, ...) this reversal cannot safely undo. Post a new correcting entry instead.'
      );
    END IF;
  END IF;

  IF v_orig.reversed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'This entry has already been reversed');
  END IF;

  IF v_orig.reversal_of IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'A reversal entry cannot itself be reversed — post a new correcting entry instead');
  END IF;

  SELECT public.next_seq(p_hospital_id, 'journal') INTO v_seq;
  v_entry_num := 'JE-' || extract(year FROM now())::text || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.journal_entries
    (hospital_id, entry_number, entry_date, description, entry_type,
     source_module, source_id, total_debit, total_credit, is_balanced,
     posted_by, reversal_of)
  VALUES
    (p_hospital_id, v_entry_num, CURRENT_DATE,
     'Reversal of ' || v_orig.entry_number || CASE WHEN p_reason IS NOT NULL THEN ' — ' || p_reason ELSE '' END,
     'reversal', v_orig.source_module, v_orig.source_id,
     v_orig.total_debit, v_orig.total_credit, true, p_reversed_by, v_orig.id)
  RETURNING id INTO v_new_id;

  -- Swap debit/credit on every line from the original entry.
  INSERT INTO public.journal_line_items
    (hospital_id, journal_id, account_id, account_code, account_name,
     debit_amount, credit_amount, description, cost_centre_id)
  SELECT p_hospital_id, v_new_id, account_id, account_code, account_name,
         credit_amount, debit_amount,
         'Reversal — ' || COALESCE(description, ''), cost_centre_id
    FROM public.journal_line_items
   WHERE journal_id = v_orig.id;

  UPDATE public.journal_entries
  SET    reversed_at = now(), reversed_by = p_reversed_by
  WHERE  id = v_orig.id;

  -- Undo the one side effect autoPostJournalEntry() itself applied, so the
  -- bill can legitimately be re-posted (e.g. after fixing a bad posting rule).
  IF v_bill_anchored THEN
    UPDATE public.bills SET posted_to_journal = false
    WHERE id = v_orig.source_id AND hospital_id = p_hospital_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'reversed',
    'reversal_entry_id', v_new_id,
    'reversal_entry_number', v_entry_num
  );
END;
$function$;
