-- Add new columns to drug_master
ALTER TABLE drug_master 
  ADD COLUMN IF NOT EXISTS drug_schedule text DEFAULT 'OTC',
  ADD COLUMN IF NOT EXISTS reorder_level integer DEFAULT 10,
  ADD COLUMN IF NOT EXISTS hsn_code text,
  ADD COLUMN IF NOT EXISTS gst_percent numeric(4,2) DEFAULT 12;

-- TABLE: drug_batches
CREATE TABLE IF NOT EXISTS drug_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  drug_id uuid REFERENCES drug_master(id) NOT NULL,
  batch_number text NOT NULL,
  manufacturer text,
  supplier_name text,
  purchase_date date DEFAULT current_date,
  expiry_date date NOT NULL,
  quantity_received integer NOT NULL,
  quantity_available integer NOT NULL,
  cost_price numeric(10,2) NOT NULL,
  mrp numeric(10,2) NOT NULL,
  sale_price numeric(10,2) NOT NULL,
  gst_percent numeric(4,2) DEFAULT 12,
  hsn_code text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- TABLE: pharmacy_dispensing
CREATE TABLE IF NOT EXISTS pharmacy_dispensing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  dispensing_number text UNIQUE,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  admission_id uuid REFERENCES admissions(id),
  encounter_id uuid REFERENCES opd_encounters(id),
  prescription_id uuid REFERENCES prescriptions(id),
  dispensed_by uuid REFERENCES users(id) NOT NULL,
  dispensing_type text DEFAULT 'ip',
  status text DEFAULT 'pending',
  total_amount numeric(10,2) DEFAULT 0,
  discount_percent numeric(4,2) DEFAULT 0,
  discount_amount numeric(10,2) DEFAULT 0,
  gst_amount numeric(10,2) DEFAULT 0,
  net_amount numeric(10,2) DEFAULT 0,
  payment_mode text,
  whatsapp_sent boolean DEFAULT false,
  bill_linked boolean DEFAULT false,
  dispensed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- TABLE: pharmacy_dispensing_items
CREATE TABLE IF NOT EXISTS pharmacy_dispensing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  dispensing_id uuid REFERENCES pharmacy_dispensing(id) NOT NULL,
  drug_id uuid REFERENCES drug_master(id) NOT NULL,
  batch_id uuid REFERENCES drug_batches(id) NOT NULL,
  drug_name text NOT NULL,
  batch_number text NOT NULL,
  expiry_date date NOT NULL,
  quantity_requested integer NOT NULL,
  quantity_dispensed integer NOT NULL DEFAULT 0,
  unit_price numeric(10,2) NOT NULL,
  gst_percent numeric(4,2) DEFAULT 12,
  total_price numeric(10,2) NOT NULL,
  five_rights_verified boolean DEFAULT false,
  is_ndps boolean DEFAULT false,
  ndps_second_pharmacist_id uuid REFERENCES users(id),
  return_quantity integer DEFAULT 0,
  return_reason text,
  created_at timestamptz DEFAULT now()
);

-- TABLE: ndps_register
CREATE TABLE IF NOT EXISTS ndps_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  drug_id uuid REFERENCES drug_master(id) NOT NULL,
  drug_name text NOT NULL,
  drug_schedule text NOT NULL,
  transaction_type text NOT NULL,
  quantity numeric(10,3) NOT NULL,
  balance_after numeric(10,3) NOT NULL,
  transaction_date date DEFAULT current_date,
  dispensing_id uuid REFERENCES pharmacy_dispensing(id),
  prescription_number text,
  prescriber_name text,
  prescriber_reg_no text,
  patient_name text,
  patient_address text,
  pharmacist_id uuid REFERENCES users(id) NOT NULL,
  second_pharmacist_id uuid REFERENCES users(id),
  supplier_name text,
  invoice_number text,
  remarks text,
  created_at timestamptz DEFAULT now()
);

-- TABLE: pharmacy_stock_alerts
CREATE TABLE IF NOT EXISTS pharmacy_stock_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  drug_id uuid REFERENCES drug_master(id) NOT NULL,
  alert_type text NOT NULL,
  batch_id uuid REFERENCES drug_batches(id),
  quantity integer,
  expiry_date date,
  is_acknowledged boolean DEFAULT false,
  acknowledged_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- RLS policies
CREATE POLICY "Users can manage own hospital drug_batches" ON drug_batches FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital drug_batches" ON drug_batches FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital pharmacy_dispensing" ON pharmacy_dispensing FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital pharmacy_dispensing" ON pharmacy_dispensing FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital pharmacy_dispensing_items" ON pharmacy_dispensing_items FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital pharmacy_dispensing_items" ON pharmacy_dispensing_items FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital ndps_register" ON ndps_register FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital ndps_register" ON ndps_register FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital pharmacy_stock_alerts" ON pharmacy_stock_alerts FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can view own hospital pharmacy_stock_alerts" ON pharmacy_stock_alerts FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());