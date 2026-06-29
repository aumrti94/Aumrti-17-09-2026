-- ============================================================
-- STATUTORY PAYROLL ENGINE
-- PF, ESI, TDS, HRA, Professional Tax, Form 16, Payslips
-- ============================================================

-- Salary structure templates (CTC breakup)
CREATE TABLE IF NOT EXISTS salary_structures (
  id                    uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id           uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name                  text    NOT NULL,      -- "Staff Nurse Grade A", "Resident Doctor", etc.
  basic_pct             numeric NOT NULL DEFAULT 40,   -- % of gross
  hra_pct               numeric NOT NULL DEFAULT 20,   -- % of basic
  da_pct                numeric NOT NULL DEFAULT 0,    -- % of basic (Dearness Allowance)
  ta_fixed              numeric NOT NULL DEFAULT 0,    -- Fixed Transport Allowance ₹/month
  special_allowance_pct numeric NOT NULL DEFAULT 0,   -- % of gross (residual)
  medical_allowance     numeric NOT NULL DEFAULT 0,   -- fixed ₹/month (tax-exempt up to ₹15k/yr)
  lta_annual            numeric NOT NULL DEFAULT 0,   -- Leave Travel Allowance (annual, tax-exempt)
  pf_employee_pct       numeric NOT NULL DEFAULT 12,  -- % of basic (statutory min 12)
  pf_employer_pct       numeric NOT NULL DEFAULT 12,  -- % of basic (employer contribution)
  esi_employee_pct      numeric NOT NULL DEFAULT 0.75, -- % of gross (if gross ≤ ₹21k)
  esi_employer_pct      numeric NOT NULL DEFAULT 3.25, -- % of gross
  pt_state              text,                          -- "KA" | "MH" | "TN" etc. for Professional Tax slab
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

ALTER TABLE salary_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "salary_structures_hospital" ON salary_structures
  FOR ALL USING (hospital_id = get_user_hospital_id());

-- Link staff to a salary structure and set their CTC
CREATE TABLE IF NOT EXISTS staff_salary_assignments (
  id                uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id       uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  staff_id          uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  structure_id      uuid    NOT NULL REFERENCES salary_structures(id),
  gross_monthly     numeric NOT NULL,           -- CTC monthly gross ₹
  effective_from    date    NOT NULL,
  effective_to      date,                        -- null = current
  pan_number        text,                        -- required for TDS
  pf_account_number text,                       -- UAN
  esi_ip_number     text,                       -- ESI IP number
  bank_account      text,
  bank_ifsc         text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (staff_id, effective_from)
);

ALTER TABLE staff_salary_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_salary_assignments_hospital" ON staff_salary_assignments
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS ssa_staff_idx    ON staff_salary_assignments (staff_id);
CREATE INDEX IF NOT EXISTS ssa_hospital_idx ON staff_salary_assignments (hospital_id);

-- Monthly payroll run
CREATE TABLE IF NOT EXISTS payroll_runs (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id     uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  month           int     NOT NULL,    -- 1–12
  year            int     NOT NULL,
  status          text    NOT NULL DEFAULT 'draft',
    -- draft | processed | approved | disbursed
  processed_at    timestamptz,
  approved_by     uuid    REFERENCES users(id),
  approved_at     timestamptz,
  disbursed_at    timestamptz,
  total_gross     numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL DEFAULT 0,
  total_net       numeric NOT NULL DEFAULT 0,
  remarks         text,
  created_by      uuid    REFERENCES users(id),
  created_at      timestamptz DEFAULT now(),
  UNIQUE (hospital_id, month, year)
);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_runs_hospital" ON payroll_runs
  FOR ALL USING (hospital_id = get_user_hospital_id());

-- Individual payslip per staff per run
CREATE TABLE IF NOT EXISTS payslips (
  id                    uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id           uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  run_id                uuid    NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  staff_id              uuid    NOT NULL REFERENCES users(id),
  structure_id          uuid    REFERENCES salary_structures(id),

  -- Working days
  total_days            int     NOT NULL DEFAULT 26,   -- working days in month
  present_days          int     NOT NULL DEFAULT 26,
  paid_leaves           int     NOT NULL DEFAULT 0,
  lop_days              int     NOT NULL DEFAULT 0,    -- Loss of Pay days

  -- Earnings (₹)
  basic                 numeric NOT NULL DEFAULT 0,
  hra                   numeric NOT NULL DEFAULT 0,
  da                    numeric NOT NULL DEFAULT 0,
  ta                    numeric NOT NULL DEFAULT 0,
  special_allowance     numeric NOT NULL DEFAULT 0,
  medical_allowance     numeric NOT NULL DEFAULT 0,
  other_allowances      numeric NOT NULL DEFAULT 0,
  gross_earned          numeric NOT NULL DEFAULT 0,   -- after LOP proration

  -- Statutory deductions (₹)
  pf_employee           numeric NOT NULL DEFAULT 0,
  esi_employee          numeric NOT NULL DEFAULT 0,
  pt                    numeric NOT NULL DEFAULT 0,   -- Professional Tax
  tds_monthly           numeric NOT NULL DEFAULT 0,  -- TDS for this month
  advance_recovery      numeric NOT NULL DEFAULT 0,
  other_deductions      numeric NOT NULL DEFAULT 0,
  total_deductions      numeric NOT NULL DEFAULT 0,

  -- Employer contributions (₹) — cost to company, not deducted from salary
  pf_employer           numeric NOT NULL DEFAULT 0,
  esi_employer          numeric NOT NULL DEFAULT 0,

  -- Net
  net_pay               numeric NOT NULL DEFAULT 0,

  -- TDS annual accumulators (carried forward from prior months for Form 16)
  ytd_gross             numeric NOT NULL DEFAULT 0,
  ytd_tds               numeric NOT NULL DEFAULT 0,

  -- Payment
  payment_mode          text,    -- bank_transfer | cash | cheque
  payment_reference     text,    -- UTR / cheque number
  paid_at               timestamptz,

  created_at            timestamptz DEFAULT now(),
  UNIQUE (run_id, staff_id)
);

ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payslips_hospital" ON payslips
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS payslips_run_idx     ON payslips (run_id);
CREATE INDEX IF NOT EXISTS payslips_staff_idx   ON payslips (staff_id);
CREATE INDEX IF NOT EXISTS payslips_hospital_idx ON payslips (hospital_id);

-- Annual TDS / Form 16 summary
CREATE TABLE IF NOT EXISTS tds_annual_summary (
  id                    uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id           uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  staff_id              uuid    NOT NULL REFERENCES users(id),
  financial_year        text    NOT NULL,      -- "2025-26"
  pan_number            text,
  gross_salary          numeric NOT NULL DEFAULT 0,
  standard_deduction    numeric NOT NULL DEFAULT 50000,  -- Sec 16(ia) ₹50k
  professional_tax      numeric NOT NULL DEFAULT 0,
  gross_taxable         numeric NOT NULL DEFAULT 0,
  hra_exemption         numeric NOT NULL DEFAULT 0,
  lta_exemption         numeric NOT NULL DEFAULT 0,
  medical_exemption     numeric NOT NULL DEFAULT 0,
  section_80c           numeric NOT NULL DEFAULT 0,    -- PF employee + LIC etc.
  section_80d           numeric NOT NULL DEFAULT 0,    -- Medical insurance
  net_taxable_income    numeric NOT NULL DEFAULT 0,
  tax_payable           numeric NOT NULL DEFAULT 0,
  tds_deducted          numeric NOT NULL DEFAULT 0,
  tds_balance           numeric NOT NULL DEFAULT 0,   -- tax_payable - tds_deducted
  form16_generated_at   timestamptz,
  created_at            timestamptz DEFAULT now(),
  UNIQUE (hospital_id, staff_id, financial_year)
);

ALTER TABLE tds_annual_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tds_annual_summary_hospital" ON tds_annual_summary
  FOR ALL USING (hospital_id = get_user_hospital_id());
