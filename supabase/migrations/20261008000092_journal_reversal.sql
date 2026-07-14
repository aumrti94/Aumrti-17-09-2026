-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: journal_reversal
-- Purpose  : A wrong MANUAL journal entry could never be corrected — only
--            deleted (losing the audit trail) or left wrong. Adds a proper
--            accounting reversal: a new balanced entry with every line's
--            debit/credit swapped, linked back to the original, which is
--            flagged so it can't be reversed twice or reversed again once
--            it's itself a reversal (preventing reversal chains — a fresh
--            correcting entry should be posted instead).
--
--            Manual entries only — auto-posted entries (bills, payments,
--            depreciation, ...) have their own dedicated reversal paths
--            already (e.g. refund_payout reverses a bill_payment_* posting).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE FUNCTION.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS reversal_of  uuid REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by  uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reversal_of
  ON public.journal_entries (reversal_of) WHERE reversal_of IS NOT NULL;

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
  v_orig      record;
  v_seq       bigint;
  v_entry_num text;
  v_new_id    uuid;
BEGIN
  SELECT * INTO v_orig FROM public.journal_entries
   WHERE id = p_journal_id AND hospital_id = p_hospital_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Journal entry not found');
  END IF;

  IF v_orig.entry_type <> 'manual' THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Only manual journal entries can be reversed here');
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

  RETURN jsonb_build_object(
    'status', 'reversed',
    'reversal_entry_id', v_new_id,
    'reversal_entry_number', v_entry_num
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(uuid, uuid, uuid, text) TO authenticated;
