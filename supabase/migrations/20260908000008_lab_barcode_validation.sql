-- Barcode and dual-validation columns on lab_orders
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS barcode_printed_at TIMESTAMPTZ;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS barcode_printed_by UUID REFERENCES users(id);
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES users(id);
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS validation_notes TEXT;
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS sample_collected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lab_orders_barcode ON lab_orders(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_orders_validated_by ON lab_orders(validated_by);

-- Per-category dual-validation config (e.g. histopathology requires pathologist sign-off)
CREATE TABLE IF NOT EXISTS lab_dual_validation_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  test_category TEXT NOT NULL,
  requires_dual_validation BOOLEAN DEFAULT TRUE,
  validator_role TEXT DEFAULT 'doctor',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (hospital_id, test_category)
);

CREATE INDEX IF NOT EXISTS idx_lab_dual_val_hospital ON lab_dual_validation_config(hospital_id);

ALTER TABLE lab_dual_validation_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON lab_dual_validation_config
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Seed sensible defaults: histopathology, cytology, microbiology require dual validation
-- (will be ignored silently if hospital_id FK doesn't exist — hospitals must configure)
