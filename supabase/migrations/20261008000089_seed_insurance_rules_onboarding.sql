-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: seed_insurance_rules_onboarding
-- Purpose  : Ensure NEW hospitals get the insurance GL-posting rules added in
--            20261008000087 (that migration only backfilled existing hospitals).
--            Rather than re-paste the ~280-line seed_hospital_defaults(), add a
--            small companion seeder and call it from the hospitals AFTER INSERT
--            trigger alongside seed_hospital_defaults().
--
-- Trigger events covered here (via autoPostJournalEntry):
--   insurance_claim_raised, insurance_payment_received, insurance_shortfall_writeoff
-- (expense_recorded posting now resolves accounts directly via postManualExpense/
--  postMultiLineJournal; depreciation & day-close post without a rule — so no
--  additional rules are required for those.)
--
-- Idempotent: CREATE OR REPLACE + NOT EXISTS guards.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_finance_extended_rules(p_hospital_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ins_ar uuid;
  v_pat_ar uuid;
  v_bank   uuid;
  v_misc   uuid;
BEGIN
  SELECT id INTO v_ins_ar FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1011';
  SELECT id INTO v_pat_ar FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1010';
  SELECT id INTO v_bank   FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1002';
  SELECT id INTO v_misc   FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '5060';

  IF v_ins_ar IS NULL OR v_pat_ar IS NULL THEN RETURN; END IF;

  INSERT INTO public.auto_posting_rules
    (hospital_id, rule_name, trigger_event, debit_account_id, credit_account_id, description_template, is_active)
  SELECT p_hospital_id, 'Insurance Claim Raised (AR reclass)', 'insurance_claim_raised', v_ins_ar, v_pat_ar, 'Claim raised - {description}', true
  WHERE NOT EXISTS (SELECT 1 FROM public.auto_posting_rules WHERE hospital_id = p_hospital_id AND trigger_event = 'insurance_claim_raised');

  INSERT INTO public.auto_posting_rules
    (hospital_id, rule_name, trigger_event, debit_account_id, credit_account_id, description_template, is_active)
  SELECT p_hospital_id, 'Insurance Payment Received', 'insurance_payment_received', COALESCE(v_bank, v_ins_ar), v_ins_ar, 'TPA payment - {description}', true
  WHERE NOT EXISTS (SELECT 1 FROM public.auto_posting_rules WHERE hospital_id = p_hospital_id AND trigger_event = 'insurance_payment_received');

  INSERT INTO public.auto_posting_rules
    (hospital_id, rule_name, trigger_event, debit_account_id, credit_account_id, description_template, is_active)
  SELECT p_hospital_id, 'Insurance Shortfall Write-off', 'insurance_shortfall_writeoff', COALESCE(v_misc, v_ins_ar), v_ins_ar, 'Claim shortfall write-off - {description}', true
  WHERE NOT EXISTS (SELECT 1 FROM public.auto_posting_rules WHERE hospital_id = p_hospital_id AND trigger_event = 'insurance_shortfall_writeoff');
END;
$$;

-- Extend the new-hospital seed trigger to also seed the extended finance rules.
CREATE OR REPLACE FUNCTION public.trg_seed_hospital_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.seed_hospital_defaults(NEW.id);
    PERFORM public.seed_finance_extended_rules(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed_hospital_defaults failed for hospital %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Backfill (idempotent) so every existing hospital is covered too.
DO $$
DECLARE h record;
BEGIN
  FOR h IN SELECT id FROM public.hospitals LOOP
    PERFORM public.seed_finance_extended_rules(h.id);
  END LOOP;
END$$;
