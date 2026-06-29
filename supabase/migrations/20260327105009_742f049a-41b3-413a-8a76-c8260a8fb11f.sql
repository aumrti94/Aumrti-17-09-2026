
-- Seed Chart of Accounts for all hospitals
INSERT INTO chart_of_accounts (hospital_id, code, name, account_type, account_subtype, is_control)
SELECT h.id, a.code, a.name, a.type, a.subtype, a.ctrl
FROM hospitals h
CROSS JOIN (VALUES
  ('1000','Current Assets','asset','current_asset',true),
  ('1001','Cash in Hand','asset','current_asset',false),
  ('1002','Cash in Bank - Main Account','asset','current_asset',false),
  ('1003','Cash in Bank - Savings','asset','current_asset',false),
  ('1010','Accounts Receivable - Patients','asset','current_asset',false),
  ('1011','Accounts Receivable - Insurance/TPA','asset','current_asset',false),
  ('1012','Accounts Receivable - PMJAY/CGHS','asset','current_asset',false),
  ('1020','Advance Payments Received','asset','current_asset',false),
  ('1030','Pharmacy Stock','asset','inventory',false),
  ('1031','Medical Consumables Stock','asset','inventory',false),
  ('1032','Surgical Items Stock','asset','inventory',false),
  ('1040','Prepaid Expenses','asset','current_asset',false),
  ('1050','GST Input Tax Credit','asset','current_asset',false),
  ('1100','Fixed Assets','asset','fixed_asset',true),
  ('1101','Medical Equipment','asset','fixed_asset',false),
  ('1102','Furniture & Fixtures','asset','fixed_asset',false),
  ('1103','Computers & IT Equipment','asset','fixed_asset',false),
  ('1104','Vehicles','asset','fixed_asset',false),
  ('1105','Building / Leasehold Improvements','asset','fixed_asset',false),
  ('1110','Accumulated Depreciation','asset','fixed_asset',false),
  ('2000','Current Liabilities','liability','current_liability',true),
  ('2001','Accounts Payable - Vendors','liability','current_liability',false),
  ('2002','Accounts Payable - Drug Suppliers','liability','current_liability',false),
  ('2010','Salaries Payable','liability','current_liability',false),
  ('2011','PF Payable','liability','current_liability',false),
  ('2012','ESIC Payable','liability','current_liability',false),
  ('2013','TDS Payable','liability','current_liability',false),
  ('2020','GST Payable (CGST)','liability','current_liability',false),
  ('2021','GST Payable (SGST)','liability','current_liability',false),
  ('2030','Advance from Patients','liability','current_liability',false),
  ('2031','Security Deposits Received','liability','current_liability',false),
  ('2100','Long Term Liabilities','liability','long_term_liability',true),
  ('2101','Bank Loan','liability','long_term_liability',false),
  ('2102','Equipment Finance Loan','liability','long_term_liability',false),
  ('3000','Owner Equity','equity','equity',true),
  ('3001','Capital Account','equity','equity',false),
  ('3002','Retained Earnings','equity','equity',false),
  ('3003','Current Year Profit / Loss','equity','equity',false),
  ('4000','Revenue','revenue','operating_revenue',true),
  ('4001','OPD Consultation Revenue','revenue','operating_revenue',false),
  ('4002','IPD Room & Nursing Revenue','revenue','operating_revenue',false),
  ('4003','Surgical / OT Revenue','revenue','operating_revenue',false),
  ('4004','Laboratory Revenue','revenue','operating_revenue',false),
  ('4005','Radiology Revenue','revenue','operating_revenue',false),
  ('4006','Pharmacy Revenue - IP','revenue','operating_revenue',false),
  ('4007','Pharmacy Revenue - Retail','revenue','operating_revenue',false),
  ('4008','Procedure Revenue','revenue','operating_revenue',false),
  ('4009','Emergency Revenue','revenue','operating_revenue',false),
  ('4010','Insurance / TPA Revenue','revenue','operating_revenue',false),
  ('4011','PMJAY / CGHS Revenue','revenue','operating_revenue',false),
  ('4020','Other Income','revenue','other_revenue',false),
  ('5000','Expenses','expense','operating_expense',true),
  ('5001','Salaries - Doctors','expense','operating_expense',false),
  ('5002','Salaries - Nurses','expense','operating_expense',false),
  ('5003','Salaries - Administrative','expense','operating_expense',false),
  ('5004','Salaries - Support Staff','expense','operating_expense',false),
  ('5005','PF Employer Contribution','expense','operating_expense',false),
  ('5006','ESIC Employer Contribution','expense','operating_expense',false),
  ('5010','Pharmacy Purchase - Drugs','expense','cost_of_goods',false),
  ('5011','Medical Consumables Purchase','expense','cost_of_goods',false),
  ('5012','Surgical Items Purchase','expense','cost_of_goods',false),
  ('5020','Rent','expense','operating_expense',false),
  ('5021','Electricity & Power','expense','operating_expense',false),
  ('5022','Water Charges','expense','operating_expense',false),
  ('5023','Telephone & Internet','expense','operating_expense',false),
  ('5030','Equipment Maintenance','expense','operating_expense',false),
  ('5031','Building Maintenance','expense','operating_expense',false),
  ('5032','Housekeeping Expenses','expense','operating_expense',false),
  ('5040','Professional Fees (CA/Legal)','expense','operating_expense',false),
  ('5041','Marketing & Advertising','expense','operating_expense',false),
  ('5042','Printing & Stationery','expense','operating_expense',false),
  ('5043','Bank Charges','expense','operating_expense',false),
  ('5050','Depreciation','expense','non_cash_expense',false),
  ('5051','Insurance Premium','expense','operating_expense',false),
  ('5060','Miscellaneous Expenses','expense','operating_expense',false)
) AS a(code, name, type, subtype, ctrl)
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts coa WHERE coa.hospital_id = h.id AND coa.code = a.code
);

-- Seed auto-posting rules
INSERT INTO auto_posting_rules (hospital_id, rule_name, trigger_event, debit_account_id, credit_account_id, description_template)
SELECT 
  h.id, r.rule_name, r.trigger_event,
  (SELECT id FROM chart_of_accounts WHERE hospital_id = h.id AND code = r.debit_code LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE hospital_id = h.id AND code = r.credit_code LIMIT 1),
  r.description_template
FROM hospitals h
CROSS JOIN (VALUES
  ('OPD Cash Payment','bill_payment_cash','1001','4001','Cash received - {bill_number}'),
  ('UPI/Digital Payment','bill_payment_upi','1002','4001','UPI payment - {bill_number}'),
  ('Card Payment','bill_payment_card','1002','4001','Card payment - {bill_number}'),
  ('Insurance Payment','bill_payment_insurance','1011','4010','Insurance claim - {bill_number}'),
  ('Patient Advance','advance_received','1001','2030','Advance received'),
  ('Stock GRN Received','grn_received','5010','2001','Stock received - {vendor_name}'),
  ('Payroll Processed','payroll_processed','5001','2010','Payroll - {month_year}'),
  ('Pharmacy Retail Sale','pharmacy_retail_sale','1001','4007','Retail sale - {receipt_number}'),
  ('Expense Recorded','expense_recorded','5060','1001','Expense recorded')
) AS r(rule_name, trigger_event, debit_code, credit_code, description_template)
WHERE NOT EXISTS (
  SELECT 1 FROM auto_posting_rules apr WHERE apr.hospital_id = h.id AND apr.trigger_event = r.trigger_event
);
