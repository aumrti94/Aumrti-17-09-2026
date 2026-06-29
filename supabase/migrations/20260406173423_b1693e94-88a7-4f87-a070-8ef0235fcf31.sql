ALTER TABLE lab_test_master ADD COLUMN IF NOT EXISTS fee numeric DEFAULT 0;
ALTER TABLE radiology_modalities ADD COLUMN IF NOT EXISTS fee numeric DEFAULT 0;