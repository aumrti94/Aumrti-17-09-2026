-- Statutory fields for EPF ECR export and Form 16 generation
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS uan_number text;     -- EPF Universal Account Number
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS pan_number text;      -- PAN for Form 16 / TDS
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS esi_ip_number text;  -- ESI IP number for ESI scheme
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS employee_type text
  DEFAULT 'salaried'
  CHECK (employee_type IN ('salaried','consultant','visiting','intern','contract'));
