-- =============================================================
-- Part A: seed_hospital_defaults(p_hospital_id uuid)
--   Seeds chart_of_accounts, auto_posting_rules, lab_test_master
--   for any hospital. Fully idempotent (ON CONFLICT DO NOTHING).
-- Part B: AFTER INSERT trigger on public.hospitals
-- =============================================================

-- 1. Widen (or remove) the too-narrow CHECK constraint on trigger_event
--    so bill_finalized_* and bill_insurance_reclassify events are allowed.
ALTER TABLE public.auto_posting_rules
  DROP CONSTRAINT IF EXISTS auto_posting_rules_trigger_event_check;

-- 2. Add fee column to lab_test_master (safe if already present)
ALTER TABLE public.lab_test_master
  ADD COLUMN IF NOT EXISTS fee numeric(10,2) DEFAULT 0;

-- 3. Unique constraint on lab_test_master(hospital_id, test_name)
--    Enables ON CONFLICT DO NOTHING in seed inserts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lab_test_master_hospital_id_test_name_key'
  ) THEN
    ALTER TABLE public.lab_test_master
      ADD CONSTRAINT lab_test_master_hospital_id_test_name_key
        UNIQUE (hospital_id, test_name);
  END IF;
END$$;

-- =============================================================
-- 4. The seed function
-- =============================================================
CREATE OR REPLACE FUNCTION public.seed_hospital_defaults(p_hospital_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Account ID variables (resolved after chart_of_accounts insert)
  v_cash      uuid;
  v_bank      uuid;
  v_ar        uuid;
  v_ins_ar    uuid;
  v_adv_lp    uuid;
  v_ap_vend   uuid;
  v_sal_pay   uuid;
  v_opd_rev   uuid;
  v_ipd_rev   uuid;
  v_ot_rev    uuid;
  v_lab_rev   uuid;
  v_rad_rev   uuid;
  v_pharm_ip  uuid;
  v_pharm_rt  uuid;
  v_sal_dr    uuid;
  v_drug_pur  uuid;
  v_misc_exp  uuid;
BEGIN

  -- ── STEP 1: Chart of Accounts ─────────────────────────────
  INSERT INTO public.chart_of_accounts
    (hospital_id, code, name, account_type, account_subtype, is_control)
  VALUES
    -- ─ Current Assets ─
    (p_hospital_id,'1000','Current Assets',              'asset','current_asset',    true),
    (p_hospital_id,'1001','Cash in Hand',                'asset','current_asset',    false),
    (p_hospital_id,'1002','Cash in Bank - Main Account', 'asset','current_asset',    false),
    (p_hospital_id,'1003','Cash in Bank - Savings',      'asset','current_asset',    false),
    (p_hospital_id,'1010','Accounts Receivable - Patients',      'asset','current_asset',false),
    (p_hospital_id,'1011','Accounts Receivable - Insurance/TPA', 'asset','current_asset',false),
    (p_hospital_id,'1012','Accounts Receivable - PMJAY/CGHS',    'asset','current_asset',false),
    (p_hospital_id,'1020','Advance Payments Received',   'asset','current_asset',    false),
    (p_hospital_id,'1030','Pharmacy Stock',              'asset','inventory',        false),
    (p_hospital_id,'1031','Medical Consumables Stock',   'asset','inventory',        false),
    (p_hospital_id,'1032','Surgical Items Stock',        'asset','inventory',        false),
    (p_hospital_id,'1040','Prepaid Expenses',            'asset','current_asset',    false),
    (p_hospital_id,'1050','GST Input Tax Credit',        'asset','current_asset',    false),
    -- ─ Fixed Assets ─
    (p_hospital_id,'1100','Fixed Assets',                    'asset','fixed_asset',  true),
    (p_hospital_id,'1101','Medical Equipment',               'asset','fixed_asset',  false),
    (p_hospital_id,'1102','Furniture & Fixtures',            'asset','fixed_asset',  false),
    (p_hospital_id,'1103','Computers & IT Equipment',        'asset','fixed_asset',  false),
    (p_hospital_id,'1104','Vehicles',                        'asset','fixed_asset',  false),
    (p_hospital_id,'1105','Building / Leasehold Improvements','asset','fixed_asset', false),
    (p_hospital_id,'1110','Accumulated Depreciation',        'asset','fixed_asset',  false),
    -- ─ Current Liabilities ─
    (p_hospital_id,'2000','Current Liabilities',         'liability','current_liability',    true),
    (p_hospital_id,'2001','Accounts Payable - Vendors',  'liability','current_liability',    false),
    (p_hospital_id,'2002','Accounts Payable - Drug Suppliers','liability','current_liability',false),
    (p_hospital_id,'2010','Salaries Payable',            'liability','current_liability',    false),
    (p_hospital_id,'2011','PF Payable',                  'liability','current_liability',    false),
    (p_hospital_id,'2012','ESIC Payable',                'liability','current_liability',    false),
    (p_hospital_id,'2013','TDS Payable',                 'liability','current_liability',    false),
    (p_hospital_id,'2020','GST Payable (CGST)',          'liability','current_liability',    false),
    (p_hospital_id,'2021','GST Payable (SGST)',          'liability','current_liability',    false),
    (p_hospital_id,'2030','Advance from Patients',       'liability','current_liability',    false),
    (p_hospital_id,'2031','Security Deposits Received',  'liability','current_liability',    false),
    -- ─ Long-term Liabilities ─
    (p_hospital_id,'2100','Long Term Liabilities', 'liability','long_term_liability', true),
    (p_hospital_id,'2101','Bank Loan',             'liability','long_term_liability', false),
    (p_hospital_id,'2102','Equipment Finance Loan','liability','long_term_liability', false),
    -- ─ Equity ─
    (p_hospital_id,'3000','Owner Equity',           'equity','equity', true),
    (p_hospital_id,'3001','Capital Account',        'equity','equity', false),
    (p_hospital_id,'3002','Retained Earnings',      'equity','equity', false),
    (p_hospital_id,'3003','Current Year Profit / Loss','equity','equity',false),
    -- ─ Revenue ─
    (p_hospital_id,'4000','Revenue',                      'revenue','operating_revenue', true),
    (p_hospital_id,'4001','OPD Consultation Revenue',     'revenue','operating_revenue', false),
    (p_hospital_id,'4002','IPD Room & Nursing Revenue',   'revenue','operating_revenue', false),
    (p_hospital_id,'4003','Surgical / OT Revenue',        'revenue','operating_revenue', false),
    (p_hospital_id,'4004','Laboratory Revenue',           'revenue','operating_revenue', false),
    (p_hospital_id,'4005','Radiology Revenue',            'revenue','operating_revenue', false),
    (p_hospital_id,'4006','Pharmacy Revenue - IP',        'revenue','operating_revenue', false),
    (p_hospital_id,'4007','Pharmacy Revenue - Retail',    'revenue','operating_revenue', false),
    (p_hospital_id,'4008','Procedure Revenue',            'revenue','operating_revenue', false),
    (p_hospital_id,'4009','Emergency Revenue',            'revenue','operating_revenue', false),
    (p_hospital_id,'4010','Insurance / TPA Revenue',      'revenue','operating_revenue', false),
    (p_hospital_id,'4011','PMJAY / CGHS Revenue',         'revenue','operating_revenue', false),
    (p_hospital_id,'4020','Other Income',                 'revenue','other_revenue',     false),
    -- ─ Expenses ─
    (p_hospital_id,'5000','Expenses',                         'expense','operating_expense',  true),
    (p_hospital_id,'5001','Salaries - Doctors',               'expense','operating_expense',  false),
    (p_hospital_id,'5002','Salaries - Nurses',                'expense','operating_expense',  false),
    (p_hospital_id,'5003','Salaries - Administrative',        'expense','operating_expense',  false),
    (p_hospital_id,'5004','Salaries - Support Staff',         'expense','operating_expense',  false),
    (p_hospital_id,'5005','PF Employer Contribution',         'expense','operating_expense',  false),
    (p_hospital_id,'5006','ESIC Employer Contribution',       'expense','operating_expense',  false),
    (p_hospital_id,'5010','Pharmacy Purchase - Drugs',        'expense','cost_of_goods',      false),
    (p_hospital_id,'5011','Medical Consumables Purchase',     'expense','cost_of_goods',      false),
    (p_hospital_id,'5012','Surgical Items Purchase',          'expense','cost_of_goods',      false),
    (p_hospital_id,'5020','Rent',                             'expense','operating_expense',  false),
    (p_hospital_id,'5021','Electricity & Power',              'expense','operating_expense',  false),
    (p_hospital_id,'5022','Water Charges',                    'expense','operating_expense',  false),
    (p_hospital_id,'5023','Telephone & Internet',             'expense','operating_expense',  false),
    (p_hospital_id,'5030','Equipment Maintenance',            'expense','operating_expense',  false),
    (p_hospital_id,'5031','Building Maintenance',             'expense','operating_expense',  false),
    (p_hospital_id,'5032','Housekeeping Expenses',            'expense','operating_expense',  false),
    (p_hospital_id,'5040','Professional Fees (CA/Legal)',     'expense','operating_expense',  false),
    (p_hospital_id,'5041','Marketing & Advertising',          'expense','operating_expense',  false),
    (p_hospital_id,'5042','Printing & Stationery',            'expense','operating_expense',  false),
    (p_hospital_id,'5043','Bank Charges',                     'expense','operating_expense',  false),
    (p_hospital_id,'5050','Depreciation',                     'expense','non_cash_expense',   false),
    (p_hospital_id,'5051','Insurance Premium',                'expense','operating_expense',  false),
    (p_hospital_id,'5060','Miscellaneous Expenses',           'expense','operating_expense',  false)
  ON CONFLICT ON CONSTRAINT chart_of_accounts_hospital_id_code_key DO NOTHING;

  -- ── STEP 2: Resolve account IDs ───────────────────────────
  SELECT id INTO v_cash     FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1001';
  SELECT id INTO v_bank     FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1002';
  SELECT id INTO v_ar       FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1010';
  SELECT id INTO v_ins_ar   FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '1011';
  SELECT id INTO v_adv_lp   FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '2030';
  SELECT id INTO v_ap_vend  FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '2001';
  SELECT id INTO v_sal_pay  FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '2010';
  SELECT id INTO v_opd_rev  FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4001';
  SELECT id INTO v_ipd_rev  FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4002';
  SELECT id INTO v_ot_rev   FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4003';
  SELECT id INTO v_lab_rev  FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4004';
  SELECT id INTO v_rad_rev  FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4005';
  SELECT id INTO v_pharm_ip FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4006';
  SELECT id INTO v_pharm_rt FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '4007';
  SELECT id INTO v_sal_dr   FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '5001';
  SELECT id INTO v_drug_pur FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '5010';
  SELECT id INTO v_misc_exp FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = '5060';

  -- Only seed posting rules if the key accounts resolved
  IF v_ar IS NOT NULL AND v_cash IS NOT NULL AND v_opd_rev IS NOT NULL THEN

    -- ── STEP 3: Auto-posting rules ───────────────────────────
    INSERT INTO public.auto_posting_rules
      (hospital_id, rule_name, trigger_event,
       debit_account_id, credit_account_id,
       description_template, is_active)
    VALUES
      -- Revenue recognition (Dr AR / Cr Revenue)
      (p_hospital_id,'OPD Revenue Recognition',      'bill_finalized_opd',
         v_ar, v_opd_rev, 'OPD - {description}', true),
      (p_hospital_id,'IPD Revenue Recognition',      'bill_finalized_ipd',
         v_ar, COALESCE(v_ipd_rev, v_opd_rev), 'IPD - {description}', true),
      (p_hospital_id,'OT Revenue Recognition',       'bill_finalized_ot',
         v_ar, COALESCE(v_ot_rev, v_opd_rev), 'OT/Surgery - {description}', true),
      (p_hospital_id,'Lab Revenue Recognition',      'bill_finalized_lab',
         v_ar, COALESCE(v_lab_rev, v_opd_rev), 'Lab - {description}', true),
      (p_hospital_id,'Radiology Revenue Recognition','bill_finalized_radiology',
         v_ar, COALESCE(v_rad_rev, v_opd_rev), 'Radiology - {description}', true),
      (p_hospital_id,'Pharmacy Revenue Recognition', 'bill_finalized_pharmacy',
         v_ar, COALESCE(v_pharm_ip, v_opd_rev), 'Pharmacy - {description}', true),
      (p_hospital_id,'Generic Bill Revenue',         'bill_finalized_generic',
         v_ar, v_opd_rev, 'Bill finalized - {description}', true),
      -- Insurance reclassification (Dr Ins AR / Cr Patient AR)
      (p_hospital_id,'Insurance Receivable Reclassification','bill_insurance_reclassify',
         COALESCE(v_ins_ar, v_ar), v_ar, 'Insurance reclassification', true),
      -- Payment collection (Dr Cash/Bank / Cr Patient AR)
      (p_hospital_id,'Cash Payment Collection',      'bill_payment_cash',
         v_cash, v_ar, 'Cash received - {bill_number}', true),
      (p_hospital_id,'UPI Payment Collection',       'bill_payment_upi',
         COALESCE(v_bank, v_cash), v_ar, 'UPI payment - {bill_number}', true),
      (p_hospital_id,'Card Payment Collection',      'bill_payment_card',
         COALESCE(v_bank, v_cash), v_ar, 'Card payment - {bill_number}', true),
      (p_hospital_id,'Cheque Payment Collection',    'bill_payment_cheque',
         COALESCE(v_bank, v_cash), v_ar, 'Cheque payment - {bill_number}', true),
      (p_hospital_id,'Net Banking Payment',          'bill_payment_net_banking',
         COALESCE(v_bank, v_cash), v_ar, 'Net banking - {bill_number}', true),
      (p_hospital_id,'Insurance Payment',            'bill_payment_insurance',
         COALESCE(v_ins_ar, v_ar), v_ar, 'Insurance claim - {bill_number}', true),
      -- Other operational events
      (p_hospital_id,'Patient Advance Received',     'advance_received',
         v_cash, COALESCE(v_adv_lp, v_ar), 'Advance received', true),
      (p_hospital_id,'Stock GRN Received',           'grn_received',
         COALESCE(v_drug_pur, v_misc_exp), COALESCE(v_ap_vend, v_cash),
         'Stock received - {vendor_name}', true),
      (p_hospital_id,'Payroll Processed',            'payroll_processed',
         COALESCE(v_sal_dr, v_misc_exp), COALESCE(v_sal_pay, v_cash),
         'Payroll - {month_year}', true),
      (p_hospital_id,'Pharmacy Retail Sale',         'pharmacy_retail_sale',
         v_cash, COALESCE(v_pharm_rt, v_opd_rev),
         'Retail sale - {receipt_number}', true),
      (p_hospital_id,'Expense Recorded',             'expense_recorded',
         COALESCE(v_misc_exp, v_opd_rev), v_cash,
         'Expense recorded', true)
    ON CONFLICT ON CONSTRAINT auto_posting_rules_hospital_trigger_unique DO NOTHING;

  END IF;

  -- ── STEP 4: Lab test master catalog (45 common Indian tests) ─
  INSERT INTO public.lab_test_master
    (hospital_id, test_name, test_code, category, sample_type, unit,
     normal_min, normal_max, critical_low, critical_high,
     tat_minutes, fee, is_active)
  VALUES
    -- ─ Haematology ─
    (p_hospital_id,'CBC',                      'CBC',   'hematology',   'blood',NULL,    NULL, NULL,  NULL,  NULL,  60,  0, false),
    (p_hospital_id,'Haemoglobin',              'HB',    'hematology',   'blood','g/dL',  12.0, 17.5,   7.0,  20.0,  60,  0, false),
    (p_hospital_id,'WBC (Total Leukocyte Count)','TLC', 'hematology',   'blood','x10³/μL',4.0, 11.0,   2.0,  30.0,  60,  0, false),
    (p_hospital_id,'Platelet Count',           'PLT',   'hematology',   'blood','x10³/μL',150, 400,   50.0,1000.0,  60,  0, false),
    (p_hospital_id,'RBC Count',                'RBC',   'hematology',   'blood','x10⁶/μL',4.0, 5.5,   2.0,   7.0,  60,  0, false),
    (p_hospital_id,'PCV / Haematocrit',        'PCV',   'hematology',   'blood','%',     36.0, 50.0,  20.0,  60.0,  60,  0, false),
    (p_hospital_id,'MCV',                      'MCV',   'hematology',   'blood','fL',    80.0,100.0,  60.0, 120.0,  60,  0, false),
    (p_hospital_id,'MCH',                      'MCH',   'hematology',   'blood','pg',    27.0, 33.0,  15.0,  45.0,  60,  0, false),
    (p_hospital_id,'MCHC',                     'MCHC',  'hematology',   'blood','g/dL',  32.0, 36.0,  20.0,  40.0,  60,  0, false),
    (p_hospital_id,'ESR',                      'ESR',   'hematology',   'blood','mm/hr',  0.0, 15.0,  NULL, 100.0,  60,  0, false),
    (p_hospital_id,'PT / INR',                 'INR',   'hematology',   'blood','INR',    0.9,  1.1,  NULL,   5.0, 120,  0, false),
    -- ─ Liver Function ─
    (p_hospital_id,'LFT',                      'LFT',   'biochemistry', 'blood',NULL,    NULL, NULL,  NULL,  NULL, 120,  0, false),
    (p_hospital_id,'SGOT (AST)',               'SGOT',  'biochemistry', 'blood','U/L',    0.0, 40.0,  NULL, 500.0, 120,  0, false),
    (p_hospital_id,'SGPT (ALT)',               'SGPT',  'biochemistry', 'blood','U/L',    0.0, 40.0,  NULL, 500.0, 120,  0, false),
    (p_hospital_id,'Alkaline Phosphatase',     'ALP',   'biochemistry', 'blood','U/L',   44.0,147.0,  NULL,1000.0, 120,  0, false),
    (p_hospital_id,'Bilirubin Total',          'TBIL',  'biochemistry', 'blood','mg/dL',  0.2,  1.2,  NULL,  15.0, 120,  0, false),
    (p_hospital_id,'Bilirubin Direct',         'DBIL',  'biochemistry', 'blood','mg/dL',  0.0,  0.3,  NULL,  10.0, 120,  0, false),
    (p_hospital_id,'Total Protein',            'TP',    'biochemistry', 'blood','g/dL',   6.0,  8.3,   3.0,  12.0, 120,  0, false),
    (p_hospital_id,'Albumin',                  'ALB',   'biochemistry', 'blood','g/dL',   3.5,  5.0,   2.0,   6.0, 120,  0, false),
    -- ─ Kidney Function ─
    (p_hospital_id,'KFT',                      'KFT',   'biochemistry', 'blood',NULL,    NULL, NULL,  NULL,  NULL, 120,  0, false),
    (p_hospital_id,'Serum Creatinine',         'CREAT', 'biochemistry', 'blood','mg/dL',  0.6,  1.2,  NULL,  10.0, 120,  0, false),
    (p_hospital_id,'Blood Urea',               'BU',    'biochemistry', 'blood','mg/dL',  7.0, 25.0,  NULL, 100.0, 120,  0, false),
    (p_hospital_id,'Uric Acid',                'UA',    'biochemistry', 'blood','mg/dL',  2.5,  7.0,  NULL,  13.0, 120,  0, false),
    -- ─ Lipid Profile ─
    (p_hospital_id,'Lipid Profile',            'LIPID', 'biochemistry', 'blood',NULL,    NULL, NULL,  NULL,  NULL, 120,  0, false),
    (p_hospital_id,'Total Cholesterol',        'CHOL',  'biochemistry', 'blood','mg/dL',  0.0,200.0,  NULL, 400.0, 120,  0, false),
    (p_hospital_id,'HDL Cholesterol',          'HDL',   'biochemistry', 'blood','mg/dL', 40.0, 60.0,  20.0,  NULL, 120,  0, false),
    (p_hospital_id,'LDL Cholesterol',          'LDL',   'biochemistry', 'blood','mg/dL',  0.0,130.0,  NULL, 300.0, 120,  0, false),
    (p_hospital_id,'Triglycerides',            'TG',    'biochemistry', 'blood','mg/dL',  0.0,150.0,  NULL, 500.0, 120,  0, false),
    -- ─ Diabetes ─
    (p_hospital_id,'HbA1c',                    'HBA1C', 'biochemistry', 'blood','%',      4.0,  5.7,  NULL,  15.0, 120,  0, false),
    (p_hospital_id,'Blood Sugar Fasting',      'BSF',   'biochemistry', 'blood','mg/dL', 70.0,100.0,  40.0, 500.0,  60,  0, false),
    (p_hospital_id,'Blood Sugar PP',           'BSPP',  'biochemistry', 'blood','mg/dL', 70.0,140.0,  40.0, 600.0,  60,  0, false),
    (p_hospital_id,'Blood Sugar Random',       'BSR',   'biochemistry', 'blood','mg/dL', 70.0,140.0,  40.0, 600.0,  60,  0, false),
    -- ─ Thyroid ─
    (p_hospital_id,'TSH',                      'TSH',   'biochemistry', 'blood','mIU/L',  0.5,  5.0,   0.1, 100.0, 240,  0, false),
    (p_hospital_id,'T3 (Total)',               'T3',    'biochemistry', 'blood','ng/dL', 80.0,200.0,  NULL, 500.0, 240,  0, false),
    (p_hospital_id,'T4 (Total)',               'T4',    'biochemistry', 'blood','µg/dL',  5.0, 12.0,  NULL,  20.0, 240,  0, false),
    -- ─ Electrolytes ─
    (p_hospital_id,'Serum Electrolytes',       'ELEC',  'biochemistry', 'blood',NULL,    NULL, NULL,  NULL,  NULL, 120,  0, false),
    (p_hospital_id,'Serum Sodium (Na)',        'NA',    'biochemistry', 'blood','mEq/L', 136.0,145.0, 120.0, 160.0,  60,  0, false),
    (p_hospital_id,'Serum Potassium (K)',      'K',     'biochemistry', 'blood','mEq/L',  3.5,  5.0,   2.5,   6.5,  60,  0, false),
    (p_hospital_id,'Serum Chloride (Cl)',      'CL',    'biochemistry', 'blood','mEq/L', 98.0,107.0,  80.0, 120.0, 120,  0, false),
    -- ─ Inflammation / Infection ─
    (p_hospital_id,'CRP (C-Reactive Protein)', 'CRP',   'biochemistry', 'blood','mg/L',   0.0,  5.0,  NULL, 100.0, 120,  0, false),
    (p_hospital_id,'Dengue NS1 Antigen',       'DNS1',  'microbiology', 'blood',NULL,    NULL, NULL,  NULL,  NULL, 240,  0, false),
    (p_hospital_id,'Widal Test',               'WIDAL', 'microbiology', 'blood',NULL,    NULL, NULL,  NULL,  NULL, 240,  0, false),
    -- ─ Urine ─
    (p_hospital_id,'Urine R/M',               'URM',   'urine',        'urine',NULL,    NULL, NULL,  NULL,  NULL,  60,  0, false),
    (p_hospital_id,'Urine Culture',           'UCUL',  'microbiology', 'urine',NULL,    NULL, NULL,  NULL,  NULL,2880,  0, false),
    -- ─ Cardiology ─
    (p_hospital_id,'ECG',                     'ECG',   'cardiology',   'other',NULL,    NULL, NULL,  NULL,  NULL,  15,  0, false)
  ON CONFLICT ON CONSTRAINT lab_test_master_hospital_id_test_name_key DO NOTHING;

END;
$$;

-- =============================================================
-- Part B: Trigger — run seed on every new hospital row
-- =============================================================
CREATE OR REPLACE FUNCTION public.trg_seed_hospital_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Wrapped so a seed failure never prevents the hospital INSERT from committing.
  BEGIN
    PERFORM public.seed_hospital_defaults(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed_hospital_defaults failed for hospital %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_hospital_insert ON public.hospitals;
CREATE TRIGGER trg_after_hospital_insert
  AFTER INSERT ON public.hospitals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seed_hospital_defaults();
