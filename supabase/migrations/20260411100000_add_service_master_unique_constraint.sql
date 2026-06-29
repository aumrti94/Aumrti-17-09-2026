-- Add unique constraint for doctor consultation fee upsert
-- This enables upsert on (hospital_id, doctor_id, item_type) to work correctly
-- Only applies when doctor_id is NOT NULL (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_master_doctor_unique
  ON service_master(hospital_id, doctor_id, item_type)
  WHERE doctor_id IS NOT NULL;
