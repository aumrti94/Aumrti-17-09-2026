-- Remove all pre-seeded global vaccines (hospital_id IS NULL) from vaccine_master.
-- Must delete child rows first to satisfy foreign key constraints.

-- 1. Delete dependent rows referencing the seeded (global) vaccines
DELETE FROM public.vaccination_due
  WHERE vaccine_id IN (SELECT id FROM public.vaccine_master WHERE hospital_id IS NULL);

DELETE FROM public.vaccination_records
  WHERE vaccine_id IN (SELECT id FROM public.vaccine_master WHERE hospital_id IS NULL);

DELETE FROM public.vaccine_stock
  WHERE vaccine_id IN (SELECT id FROM public.vaccine_master WHERE hospital_id IS NULL);

-- 2. Now safe to delete the seeded global vaccines
DELETE FROM public.vaccine_master WHERE hospital_id IS NULL;
