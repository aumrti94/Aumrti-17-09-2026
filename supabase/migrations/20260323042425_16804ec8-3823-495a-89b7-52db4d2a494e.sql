
-- Drop existing minimal bills table and recreate with full schema
DROP TABLE IF EXISTS bills CASCADE;

-- Create bills table with full schema
CREATE TABLE public.bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  bill_number text UNIQUE NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  encounter_id uuid REFERENCES opd_encounters(id),
  admission_id uuid REFERENCES admissions(id),
  bill_type text NOT NULL DEFAULT 'opd' CHECK (bill_type IN ('opd','ipd','emergency','daycare','package')),
  bill_date date NOT NULL DEFAULT CURRENT_DATE,
  bill_status text NOT NULL DEFAULT 'draft' CHECK (bill_status IN ('draft','final','partially_paid','paid','cancelled','refunded','insurance_pending')),
  subtotal numeric(12,2) DEFAULT 0,
  discount_percent numeric(5,2) DEFAULT 0,
  discount_amount numeric(12,2) DEFAULT 0,
  discount_approved_by uuid REFERENCES users(id),
  discount_reason text,
  taxable_amount numeric(12,2) DEFAULT 0,
  gst_amount numeric(12,2) DEFAULT 0,
  total_amount numeric(12,2) DEFAULT 0,
  advance_received numeric(12,2) DEFAULT 0,
  insurance_amount numeric(12,2) DEFAULT 0,
  patient_payable numeric(12,2) DEFAULT 0,
  paid_amount numeric(12,2) DEFAULT 0,
  balance_due numeric(12,2) DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refund_pending','refunded')),
  gstin_hospital text,
  gstin_patient text,
  irn text,
  irn_generated_at timestamptz,
  qr_code_url text,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create bill_line_items
CREATE TABLE public.bill_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  bill_id uuid REFERENCES bills(id) ON DELETE CASCADE NOT NULL,
  service_id uuid REFERENCES service_master(id),
  item_type text NOT NULL DEFAULT 'service' CHECK (item_type IN ('consultation','procedure','room_charge','lab','radiology','pharmacy','surgery','package','nursing','consumable','blood','oxygen','other')),
  description text NOT NULL,
  quantity numeric(10,3) DEFAULT 1,
  unit text DEFAULT 'nos',
  unit_rate numeric(12,2) NOT NULL,
  discount_percent numeric(5,2) DEFAULT 0,
  discount_amount numeric(12,2) DEFAULT 0,
  taxable_amount numeric(12,2) DEFAULT 0,
  gst_percent numeric(5,2) DEFAULT 0,
  gst_amount numeric(12,2) DEFAULT 0,
  total_amount numeric(12,2) NOT NULL,
  hsn_code text,
  service_date date DEFAULT CURRENT_DATE,
  department text,
  ordered_by uuid REFERENCES users(id),
  source_module text,
  source_record_id uuid,
  is_insurance_covered boolean DEFAULT false,
  insurance_rate numeric(12,2),
  created_at timestamptz DEFAULT now()
);

-- Create bill_payments
CREATE TABLE public.bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  bill_id uuid REFERENCES bills(id) ON DELETE CASCADE NOT NULL,
  payment_mode text NOT NULL CHECK (payment_mode IN ('cash','upi','card','net_banking','cheque','insurance','pmjay','cghs','echs','credit','advance_adjust')),
  amount numeric(12,2) NOT NULL,
  payment_date date DEFAULT CURRENT_DATE,
  payment_time timestamptz DEFAULT now(),
  transaction_id text,
  gateway_reference text,
  bank_reference text,
  received_by uuid REFERENCES users(id),
  notes text,
  is_advance boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create advance_receipts
CREATE TABLE public.advance_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  admission_id uuid REFERENCES admissions(id),
  receipt_number text UNIQUE NOT NULL,
  amount numeric(12,2) NOT NULL,
  payment_mode text NOT NULL,
  payment_date date DEFAULT CURRENT_DATE,
  received_by uuid REFERENCES users(id),
  adjusted_in_bill_id uuid REFERENCES bills(id),
  is_adjusted boolean DEFAULT false,
  refund_amount numeric(12,2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create discount_approvals
CREATE TABLE public.discount_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  bill_id uuid REFERENCES bills(id) ON DELETE CASCADE NOT NULL,
  requested_by uuid REFERENCES users(id) NOT NULL,
  approved_by uuid REFERENCES users(id),
  discount_percent numeric(5,2) NOT NULL,
  discount_amount numeric(12,2) NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  remarks text
);

-- ALTER service_master
ALTER TABLE service_master ADD COLUMN IF NOT EXISTS hsn_code text;
ALTER TABLE service_master ADD COLUMN IF NOT EXISTS gst_percent numeric(5,2) DEFAULT 0;
ALTER TABLE service_master ADD COLUMN IF NOT EXISTS item_type text DEFAULT 'service';

-- RLS policies
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own hospital bills" ON public.bills FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital bills" ON public.bills FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital bill_line_items" ON public.bill_line_items FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital bill_line_items" ON public.bill_line_items FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital bill_payments" ON public.bill_payments FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital bill_payments" ON public.bill_payments FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital advance_receipts" ON public.advance_receipts FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital advance_receipts" ON public.advance_receipts FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital discount_approvals" ON public.discount_approvals FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital discount_approvals" ON public.discount_approvals FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
