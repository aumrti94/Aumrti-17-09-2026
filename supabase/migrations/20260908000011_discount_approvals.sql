-- Bill discount approvals workflow
CREATE TABLE IF NOT EXISTS bill_discount_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  bill_id UUID REFERENCES bills(id) ON DELETE CASCADE,
  discount_amount NUMERIC(12,2) NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  required_approver_role TEXT DEFAULT 'billing_supervisor',
  requested_by UUID REFERENCES users(id),
  requested_at TIMESTAMPTZ DEFAULT now(),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_bill_discount_approvals_bill ON bill_discount_approvals(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_discount_approvals_hospital ON bill_discount_approvals(hospital_id);
CREATE INDEX IF NOT EXISTS idx_bill_discount_approvals_status ON bill_discount_approvals(status);

ALTER TABLE bill_discount_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON bill_discount_approvals
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Add pending_approval to bills.bill_status if not already constrained
-- (bills.bill_status is TEXT so no migration needed for the value itself)

-- Ensure hospital_settings key for discount rules can be inserted
-- (hospital_settings table already exists with UNIQUE(hospital_id, key))
