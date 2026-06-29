-- Add doctor_id, department_id, and validity_days to service_master
ALTER TABLE service_master
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS validity_days INTEGER DEFAULT 7;

-- Indexes for fast fee lookups
CREATE INDEX IF NOT EXISTS idx_service_master_doctor
  ON service_master(hospital_id, doctor_id, item_type)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_service_master_dept
  ON service_master(hospital_id, department_id, item_type)
  WHERE is_active = true;
