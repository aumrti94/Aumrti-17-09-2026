-- Phase 3: Pharmacy Advanced Features — expiry control and reorder management

-- Add reorder/expiry fields to drug_master
ALTER TABLE drug_master
  ADD COLUMN IF NOT EXISTS reorder_qty integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock_level integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_reorder_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS expiry_alert_days integer DEFAULT 90;

-- Add last alert tracking to drug_batches
ALTER TABLE drug_batches
  ADD COLUMN IF NOT EXISTS last_expiry_alert_at timestamptz;

-- Stock reorder trigger log
CREATE TABLE IF NOT EXISTS stock_reorder_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  drug_id uuid REFERENCES drug_master(id) ON DELETE CASCADE,
  trigger_reason text CHECK (trigger_reason IN ('low_stock', 'expiring_soon', 'manual')),
  current_qty integer,
  reorder_qty integer,
  batch_info text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'ordered', 'cancelled')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reorder_triggers_hospital ON stock_reorder_triggers(hospital_id, status, created_at DESC);

ALTER TABLE stock_reorder_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reorder_triggers_hospital_isolation" ON stock_reorder_triggers
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "reorder_triggers_service_role" ON stock_reorder_triggers
  TO service_role USING (true) WITH CHECK (true);
