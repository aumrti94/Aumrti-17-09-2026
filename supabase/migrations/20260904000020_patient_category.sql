-- Add patient_category to patients table for scheme routing and billing
ALTER TABLE patients ADD COLUMN IF NOT EXISTS patient_category text
  DEFAULT 'general'
  CHECK (patient_category IN ('general','bpl','cghs','echs','pmjay','esi','insurance','medicalaid'));

-- Add Aadhaar ID (masked storage) while we're at it
ALTER TABLE patients ADD COLUMN IF NOT EXISTS aadhaar_id text;
