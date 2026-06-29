
-- Alter existing chart_of_accounts to add new columns
ALTER TABLE public.chart_of_accounts 
  ADD COLUMN IF NOT EXISTS account_subtype text,
  ADD COLUMN IF NOT EXISTS is_control boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS opening_balance numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description text;

-- Rename 'code' to 'account_code' and 'name' to 'account_name' for clarity
-- (keeping old columns as aliases isn't possible, so we add new cols and migrate)
-- Actually, let's just add account_code/account_name as computed references
-- The existing table already has code, name. Let's work with those.

-- Create journal_entries table
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  entry_number text UNIQUE NOT NULL,
  entry_date date NOT NULL DEFAULT current_date,
  description text NOT NULL,
  entry_type text DEFAULT 'manual' CHECK (entry_type IN (
    'auto_billing','auto_payment','auto_grn','auto_payroll',
    'auto_pharmacy','manual','opening_balance','adjustment'
  )),
  source_module text,
  source_id uuid,
  total_debit numeric(15,2) DEFAULT 0,
  total_credit numeric(15,2) DEFAULT 0,
  is_balanced boolean DEFAULT false,
  posted_by uuid REFERENCES public.users(id),
  narration text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "journal_entries_hospital_rls" ON public.journal_entries
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Create journal_line_items table
CREATE TABLE IF NOT EXISTS public.journal_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  journal_id uuid REFERENCES public.journal_entries(id) NOT NULL,
  account_id uuid REFERENCES public.chart_of_accounts(id) NOT NULL,
  account_code text NOT NULL,
  account_name text NOT NULL,
  debit_amount numeric(15,2) DEFAULT 0,
  credit_amount numeric(15,2) DEFAULT 0,
  description text,
  cost_centre_id uuid REFERENCES public.departments(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.journal_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "journal_line_items_hospital_rls" ON public.journal_line_items
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Create auto_posting_rules table
CREATE TABLE IF NOT EXISTS public.auto_posting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  rule_name text NOT NULL,
  trigger_event text NOT NULL CHECK (trigger_event IN (
    'bill_payment_cash','bill_payment_upi','bill_payment_card',
    'bill_payment_insurance','bill_payment_net_banking','bill_payment_cheque',
    'advance_received','grn_received','payroll_processed',
    'pharmacy_retail_sale','expense_recorded'
  )),
  debit_account_id uuid REFERENCES public.chart_of_accounts(id) NOT NULL,
  credit_account_id uuid REFERENCES public.chart_of_accounts(id) NOT NULL,
  description_template text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.auto_posting_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auto_posting_rules_hospital_rls" ON public.auto_posting_rules
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Create expense_records table
CREATE TABLE IF NOT EXISTS public.expense_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  expense_date date NOT NULL DEFAULT current_date,
  expense_category text NOT NULL CHECK (expense_category IN (
    'salary','rent','electricity','water','telephone',
    'internet','fuel','vehicle','maintenance','repair',
    'housekeeping','laundry','catering','insurance',
    'professional_fees','marketing','printing','stationery',
    'bank_charges','depreciation','miscellaneous','other'
  )),
  vendor_name text,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  gst_amount numeric(12,2) DEFAULT 0,
  total_amount numeric(12,2) NOT NULL,
  payment_mode text DEFAULT 'bank_transfer' CHECK (payment_mode IN (
    'cash','bank_transfer','cheque','upi','card'
  )),
  reference_number text,
  department_id uuid REFERENCES public.departments(id),
  journal_id uuid REFERENCES public.journal_entries(id),
  receipt_url text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.expense_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expense_records_hospital_rls" ON public.expense_records
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Create bank_accounts table
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  account_name text NOT NULL,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  ifsc_code text,
  opening_balance numeric(15,2) DEFAULT 0,
  coa_account_id uuid REFERENCES public.chart_of_accounts(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_accounts_hospital_rls" ON public.bank_accounts
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Create bank_transactions table
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  bank_account_id uuid REFERENCES public.bank_accounts(id) NOT NULL,
  transaction_date date NOT NULL,
  description text NOT NULL,
  debit_amount numeric(15,2) DEFAULT 0,
  credit_amount numeric(15,2) DEFAULT 0,
  balance numeric(15,2),
  reference text,
  is_reconciled boolean DEFAULT false,
  reconciled_with uuid REFERENCES public.journal_line_items(id),
  import_batch_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_transactions_hospital_rls" ON public.bank_transactions
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
