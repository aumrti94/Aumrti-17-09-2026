-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: insurance_gl_posting_rules
-- Purpose  : Put insurance/TPA receivables on the books. Previously raising a
--            claim, receiving a TPA payment, or writing off a shortfall touched
--            no ledger account, so insurance AR never appeared in the GL.
--
--   insurance_claim_raised        Dr AR-Insurance/TPA (1011) / Cr AR-Patients (1010)
--   insurance_payment_received    Dr Bank (1002)            / Cr AR-Insurance (1011)
--   insurance_shortfall_writeoff  Dr Misc Expense (5060)    / Cr AR-Insurance (1011)
--
-- Backfills every existing hospital. New hospitals get these via the updated
-- seed_hospital_defaults (see the onboarding-seed migration). Idempotent —
-- guarded by NOT EXISTS on (hospital_id, trigger_event).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  h        record;
  v_ins_ar uuid;
  v_pat_ar uuid;
  v_bank   uuid;
  v_misc   uuid;
BEGIN
  FOR h IN SELECT id FROM public.hospitals LOOP
    SELECT id INTO v_ins_ar FROM public.chart_of_accounts WHERE hospital_id = h.id AND code = '1011';
    SELECT id INTO v_pat_ar FROM public.chart_of_accounts WHERE hospital_id = h.id AND code = '1010';
    SELECT id INTO v_bank   FROM public.chart_of_accounts WHERE hospital_id = h.id AND code = '1002';
    SELECT id INTO v_misc   FROM public.chart_of_accounts WHERE hospital_id = h.id AND code = '5060';

    -- Skip hospitals whose COA isn't seeded yet.
    IF v_ins_ar IS NULL OR v_pat_ar IS NULL THEN CONTINUE; END IF;

    INSERT INTO public.auto_posting_rules
      (hospital_id, rule_name, trigger_event, debit_account_id, credit_account_id, description_template, is_active)
    SELECT h.id, 'Insurance Claim Raised (AR reclass)', 'insurance_claim_raised', v_ins_ar, v_pat_ar, 'Claim raised - {description}', true
    WHERE NOT EXISTS (SELECT 1 FROM public.auto_posting_rules WHERE hospital_id = h.id AND trigger_event = 'insurance_claim_raised');

    INSERT INTO public.auto_posting_rules
      (hospital_id, rule_name, trigger_event, debit_account_id, credit_account_id, description_template, is_active)
    SELECT h.id, 'Insurance Payment Received', 'insurance_payment_received', COALESCE(v_bank, v_ins_ar), v_ins_ar, 'TPA payment - {description}', true
    WHERE NOT EXISTS (SELECT 1 FROM public.auto_posting_rules WHERE hospital_id = h.id AND trigger_event = 'insurance_payment_received');

    INSERT INTO public.auto_posting_rules
      (hospital_id, rule_name, trigger_event, debit_account_id, credit_account_id, description_template, is_active)
    SELECT h.id, 'Insurance Shortfall Write-off', 'insurance_shortfall_writeoff', COALESCE(v_misc, v_ins_ar), v_ins_ar, 'Claim shortfall write-off - {description}', true
    WHERE NOT EXISTS (SELECT 1 FROM public.auto_posting_rules WHERE hospital_id = h.id AND trigger_event = 'insurance_shortfall_writeoff');
  END LOOP;
END$$;
