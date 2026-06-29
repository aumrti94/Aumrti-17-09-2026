-- ═══════════════════════════════════════════════════════════════════
-- Payment-First Workflow: Pay Before Service
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add payment_status to bill_line_items
--    'pending_payment' = charge created, awaiting cash counter payment
--    'paid'            = patient paid at counter
--    'advance_covered' = IPD patient (deducted from advance)
--    'waived'          = waived by authorised user
--    'insurance_auth'  = covered by insurance pre-auth
ALTER TABLE bill_line_items
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending_payment'
  CHECK (payment_status IN ('pending_payment','paid','advance_covered','waived','insurance_auth'));

ALTER TABLE bill_line_items
  ADD COLUMN IF NOT EXISTS payment_collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_collected_by uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_bli_payment_status
  ON bill_line_items(payment_status, hospital_id);

-- Back-fill: existing paid bills → mark items as paid
UPDATE bill_line_items bli
SET payment_status = 'paid'
FROM bills b
WHERE bli.bill_id = b.id
  AND b.payment_status IN ('paid','partial');

-- 2. IPD Advances table
CREATE TABLE IF NOT EXISTS ipd_advances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  admission_id    uuid REFERENCES admissions(id) ON DELETE CASCADE NOT NULL,
  patient_id      uuid REFERENCES patients(id) NOT NULL,
  amount          numeric(12,2) NOT NULL,
  transaction_type text NOT NULL DEFAULT 'deposit'
    CHECK (transaction_type IN ('deposit','refund','service_debit','adjustment')),
  payment_mode    text,
  reference_no    text,
  description     text,
  collected_by    uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipd_advances_admission
  ON ipd_advances(admission_id, hospital_id);

ALTER TABLE ipd_advances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_ipd_advances" ON ipd_advances
  USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

-- 3. Add payment_status to lab_orders (for payment gate in lab queue)
ALTER TABLE lab_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending_payment'
  CHECK (payment_status IN ('pending_payment','paid','advance_covered','waived','insurance_auth'));

-- Back-fill admitted patients' lab orders as advance_covered
UPDATE lab_orders SET payment_status = 'advance_covered'
WHERE admission_id IS NOT NULL;

-- 4. Add payment_status to radiology_orders
ALTER TABLE radiology_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending_payment'
  CHECK (payment_status IN ('pending_payment','paid','advance_covered','waived','insurance_auth'));

UPDATE radiology_orders SET payment_status = 'advance_covered'
WHERE admission_id IS NOT NULL;

-- 5. Computed advance balance view (used by PaymentGate and AdvanceManagement)
CREATE OR REPLACE VIEW ipd_advance_balances AS
SELECT
  admission_id,
  hospital_id,
  patient_id,
  SUM(CASE WHEN transaction_type IN ('deposit','adjustment') THEN amount
           WHEN transaction_type IN ('service_debit','refund') THEN -amount
           ELSE 0 END) AS balance,
  SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END) AS total_deposited,
  SUM(CASE WHEN transaction_type = 'service_debit' THEN amount ELSE 0 END) AS total_debited
FROM ipd_advances
GROUP BY admission_id, hospital_id, patient_id;
