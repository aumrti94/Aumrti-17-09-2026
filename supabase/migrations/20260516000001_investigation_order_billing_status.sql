-- Add billing_status and ordered_at to lab_orders and radiology_orders.
-- Every investigation order must declare whether it has been billed.
-- billing_status = 'unbilled' → created by prescription sync, not yet billed
-- billing_status = 'billed'   → created or confirmed by Lab/Radiology billing modal
-- billing_status = 'waived'   → explicitly waived (free patient, charity case, etc.)

ALTER TABLE lab_orders
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled', 'billed', 'waived')),
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE radiology_orders
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled', 'billed', 'waived')),
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz NOT NULL DEFAULT now();

-- Backfill: existing rows that already have a bill linked are billed.
-- lab_orders: if there is a bill_line_items row pointing source_record_id → this order
UPDATE lab_orders lo
SET billing_status = 'billed'
WHERE EXISTS (
  SELECT 1 FROM bill_line_items bli
  WHERE bli.source_record_id = lo.id
    AND bli.source_module = 'lab'
    AND bli.hospital_id = lo.hospital_id
);

UPDATE radiology_orders ro
SET billing_status = 'billed'
WHERE EXISTS (
  SELECT 1 FROM bill_line_items bli
  WHERE bli.source_record_id = ro.id
    AND bli.source_module = 'radiology'
    AND bli.hospital_id = ro.hospital_id
);

-- Indexes for LeakageScanner and revenue protection check performance
CREATE INDEX IF NOT EXISTS idx_lab_orders_billing_status
  ON lab_orders (hospital_id, billing_status, order_date);

CREATE INDEX IF NOT EXISTS idx_radiology_orders_billing_status
  ON radiology_orders (hospital_id, billing_status, order_date);

-- RLS: billing_status follows the same policy as the parent row.
-- lab_orders and radiology_orders already have RLS enabled; new columns inherit automatically.
-- No new RLS policies needed — column access is governed by table-level policy.
