-- ═══════════════════════════════════════════════════════════════════
-- EMI Plans, Installments, and Payment Links
-- Backs the Collections tab in the Billing module
-- ═══════════════════════════════════════════════════════════════════

-- 1. EMI Plans
CREATE TABLE IF NOT EXISTS emi_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  bill_id             uuid REFERENCES bills(id) ON DELETE CASCADE NOT NULL,
  patient_id          uuid REFERENCES patients(id) NOT NULL,
  total_amount        numeric(12,2) NOT NULL,
  installments        integer NOT NULL CHECK (installments > 0),
  installment_amount  numeric(12,2) NOT NULL,
  amount_collected    numeric(12,2) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','completed','defaulted','cancelled')),
  frequency           text NOT NULL DEFAULT 'monthly'
                        CHECK (frequency IN ('weekly','fortnightly','monthly')),
  first_payment_date  date,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emi_plans_hospital ON emi_plans(hospital_id, status);
CREATE INDEX IF NOT EXISTS idx_emi_plans_patient  ON emi_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_emi_plans_bill     ON emi_plans(bill_id);

ALTER TABLE emi_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_emi_plans" ON emi_plans
  USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

-- 2. EMI Installments
CREATE TABLE IF NOT EXISTS emi_installments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  plan_id              uuid REFERENCES emi_plans(id) ON DELETE CASCADE NOT NULL,
  installment_number   integer NOT NULL,
  due_date             date NOT NULL,
  amount               numeric(12,2) NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','paid','overdue','waived')),
  paid_at              timestamptz,
  reminder_sent_count  integer NOT NULL DEFAULT 0,
  last_reminder_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emi_inst_plan    ON emi_installments(plan_id);
CREATE INDEX IF NOT EXISTS idx_emi_inst_due     ON emi_installments(hospital_id, due_date, status);

ALTER TABLE emi_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_emi_installments" ON emi_installments
  USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

-- Mark overdue installments automatically (used by scheduled job or trigger)
CREATE OR REPLACE FUNCTION mark_emi_overdue() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE emi_installments
  SET status = 'overdue'
  WHERE status = 'pending' AND due_date < CURRENT_DATE;
END;
$$;

-- 3. Payment Links
CREATE TABLE IF NOT EXISTS payment_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  bill_id      uuid REFERENCES bills(id) ON DELETE CASCADE NOT NULL,
  patient_id   uuid REFERENCES patients(id) NOT NULL,
  link_token   text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  amount       numeric(12,2) NOT NULL,
  expires_at   timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','paid','expired','cancelled')),
  sent_via     text[] NOT NULL DEFAULT '{}',
  short_url    text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_links_hospital ON payment_links(hospital_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_links_token    ON payment_links(link_token);
CREATE INDEX IF NOT EXISTS idx_payment_links_patient  ON payment_links(patient_id);

ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_payment_links" ON payment_links
  USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

-- Public read for the patient payment portal (unauthenticated)
CREATE POLICY "public_read_payment_links" ON payment_links
  FOR SELECT USING (status = 'active' AND expires_at > now());
