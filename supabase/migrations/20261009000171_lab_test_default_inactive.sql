-- Change default for new lab tests to be inactive
ALTER TABLE public.lab_test_master ALTER COLUMN is_active SET DEFAULT false;

-- Disable all existing tests to match the new default behavior requested by the user
UPDATE public.lab_test_master SET is_active = false;
