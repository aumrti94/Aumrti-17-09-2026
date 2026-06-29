-- Add AI flag column to radiology_orders for worklist triage
ALTER TABLE radiology_orders
  ADD COLUMN IF NOT EXISTS ai_flag text
  CHECK (ai_flag IN ('critical', 'abnormal', 'normal'));

CREATE INDEX IF NOT EXISTS idx_rad_orders_ai_flag
  ON radiology_orders(hospital_id, ai_flag)
  WHERE ai_flag IS NOT NULL;
