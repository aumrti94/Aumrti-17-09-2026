-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: extend_reversal_to_bill_anchored_auto_entries
-- Purpose  : reverse_journal_entry (migration 092) only reversed entry_type =
--            'manual'. Every other auto-posted entry (lab, insurance, billing,
--            telemediciine, physio, dialysis, opd, ...) had no correction path
--            at all once migration 091 made auto-posting actually work
--            everywhere. Extending this to ALL auto_* types is unsafe — some
--            (auto_fixed_assets, auto_depreciation, auto_inventory) mutate a
--            subledger this function knows nothing about (asset register,
--            depreciation idempotency keys, stock quantities) and reversing
--            just the journal would desync them from the GL.
--
--            The one side effect autoPostJournalEntry() itself applies outside
--            journal_entries is well understood and mechanical: it sets
--            bills.posted_to_journal = true when source_id is a bills row
--            (src/lib/accounting.ts). So instead of hand-maintaining a list of
--            "safe" module names (which drifts as modules are added), this
--            checks the actual source_id against the real bills table at
--            reversal time — mechanically correct for every bill-anchored
--            module at once, and automatically excludes fixed_assets/
--            depreciation/inventory/hr-payroll/etc. since their source_id
--            never resolves to a bills row. Reversal also resets
--            posted_to_journal = false so the bill can legitimately be
--            re-posted afterward.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_hospital_id uuid,
  p_journal_id  uuid,
  p_reversed_by uuid,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    v_bill_anchored := EXISTS (
      SELECT 1 FROM public.bills WHERE id::text = v_orig.source_id AND hospital_id = p_hospital_id
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
    WHERE id::text = v_orig.source_id AND hospital_id = p_hospital_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'reversed',
    'reversal_entry_id', v_new_id,
    'reversal_entry_number', v_entry_num
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(uuid, uuid, uuid, text) TO authenticated;
