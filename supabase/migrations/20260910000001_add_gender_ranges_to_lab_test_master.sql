-- Add gender-specific reference ranges to lab_test_master
-- Needed for tests like Haemoglobin where normal ranges differ by sex

ALTER TABLE lab_test_master
  ADD COLUMN IF NOT EXISTS male_normal_min   numeric,
  ADD COLUMN IF NOT EXISTS male_normal_max   numeric,
  ADD COLUMN IF NOT EXISTS female_normal_min numeric,
  ADD COLUMN IF NOT EXISTS female_normal_max numeric;

COMMENT ON COLUMN lab_test_master.male_normal_min   IS 'Reference range lower bound for male patients';
COMMENT ON COLUMN lab_test_master.male_normal_max   IS 'Reference range upper bound for male patients';
COMMENT ON COLUMN lab_test_master.female_normal_min IS 'Reference range lower bound for female patients';
COMMENT ON COLUMN lab_test_master.female_normal_max IS 'Reference range upper bound for female patients';
