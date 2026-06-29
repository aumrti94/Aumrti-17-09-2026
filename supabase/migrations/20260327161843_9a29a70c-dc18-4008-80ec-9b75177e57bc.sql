
-- Fix bill_payment_insurance rules to credit AR (1010) instead of 4010
UPDATE auto_posting_rules 
SET credit_account_id = (SELECT id FROM chart_of_accounts WHERE hospital_id = auto_posting_rules.hospital_id AND code = '1010' LIMIT 1)
WHERE trigger_event = 'bill_payment_insurance'
  AND credit_account_id != (SELECT id FROM chart_of_accounts WHERE hospital_id = auto_posting_rules.hospital_id AND code = '1010' LIMIT 1);

-- Also update the ensure function to fix insurance payment rules too
CREATE OR REPLACE FUNCTION public.ensure_billing_posting_rules(p_hospital_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ar_id uuid; v_ins_ar_id uuid; v_cash_id uuid; v_bank_id uuid;
  v_opd_rev uuid; v_ipd_rev uuid; v_ot_rev uuid;
  v_lab_rev uuid; v_rad_rev uuid; v_pharm_rev uuid;
BEGIN
  INSERT INTO chart_of_accounts (hospital_id, code, name, account_type, account_subtype, is_system)
  VALUES (p_hospital_id, '1010', 'Accounts Receivable', 'asset', 'current_asset', true)
  ON CONFLICT ON CONSTRAINT chart_of_accounts_hospital_id_code_key DO NOTHING;

  INSERT INTO chart_of_accounts (hospital_id, code, name, account_type, account_subtype, is_system)
  VALUES (p_hospital_id, '1011', 'Insurance Receivable', 'asset', 'current_asset', true)
  ON CONFLICT ON CONSTRAINT chart_of_accounts_hospital_id_code_key DO NOTHING;

  SELECT id INTO v_ar_id FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1010';
  SELECT id INTO v_ins_ar_id FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1011';
  SELECT id INTO v_cash_id FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1001';
  SELECT id INTO v_bank_id FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1002';
  SELECT id INTO v_opd_rev FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4001';
  SELECT id INTO v_ipd_rev FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4002';
  SELECT id INTO v_ot_rev FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4003';
  SELECT id INTO v_lab_rev FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4004';
  SELECT id INTO v_rad_rev FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4005';
  SELECT id INTO v_pharm_rev FROM chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4006';

  IF v_ar_id IS NULL OR v_cash_id IS NULL OR v_opd_rev IS NULL THEN RETURN; END IF;

  INSERT INTO auto_posting_rules (hospital_id, trigger_event, rule_name, debit_account_id, credit_account_id, is_active)
  VALUES
    (p_hospital_id, 'bill_finalized_opd', 'OPD Revenue Recognition', v_ar_id, v_opd_rev, true),
    (p_hospital_id, 'bill_finalized_ipd', 'IPD Revenue Recognition', v_ar_id, COALESCE(v_ipd_rev, v_opd_rev), true),
    (p_hospital_id, 'bill_finalized_ot', 'OT Revenue Recognition', v_ar_id, COALESCE(v_ot_rev, v_opd_rev), true),
    (p_hospital_id, 'bill_finalized_lab', 'Lab Revenue Recognition', v_ar_id, COALESCE(v_lab_rev, v_opd_rev), true),
    (p_hospital_id, 'bill_finalized_radiology', 'Radiology Revenue Recognition', v_ar_id, COALESCE(v_rad_rev, v_opd_rev), true),
    (p_hospital_id, 'bill_finalized_pharmacy', 'Pharmacy Revenue Recognition', v_ar_id, COALESCE(v_pharm_rev, v_opd_rev), true),
    (p_hospital_id, 'bill_finalized_generic', 'Generic Revenue Recognition', v_ar_id, v_opd_rev, true),
    (p_hospital_id, 'bill_insurance_reclassify', 'Insurance Receivable Reclassification', v_ins_ar_id, v_ar_id, true)
  ON CONFLICT ON CONSTRAINT auto_posting_rules_hospital_trigger_unique DO NOTHING;

  -- Fix ALL payment rules to credit AR
  UPDATE auto_posting_rules SET credit_account_id = v_ar_id
  WHERE hospital_id = p_hospital_id
    AND trigger_event IN ('bill_payment_cash','bill_payment_upi','bill_payment_card','bill_payment_cheque','bill_payment_insurance')
    AND credit_account_id != v_ar_id;

  INSERT INTO auto_posting_rules (hospital_id, trigger_event, rule_name, debit_account_id, credit_account_id, is_active)
  VALUES
    (p_hospital_id, 'bill_payment_cash', 'Cash Payment Collection', v_cash_id, v_ar_id, true),
    (p_hospital_id, 'bill_payment_upi', 'UPI Payment Collection', v_bank_id, v_ar_id, true),
    (p_hospital_id, 'bill_payment_card', 'Card Payment Collection', v_bank_id, v_ar_id, true),
    (p_hospital_id, 'bill_payment_cheque', 'Cheque Payment Collection', v_bank_id, v_ar_id, true),
    (p_hospital_id, 'bill_payment_insurance', 'Insurance Payment', v_ins_ar_id, v_ar_id, true)
  ON CONFLICT ON CONSTRAINT auto_posting_rules_hospital_trigger_unique DO NOTHING;
END;
$function$;
