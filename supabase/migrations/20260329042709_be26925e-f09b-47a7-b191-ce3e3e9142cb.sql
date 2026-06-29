
-- Add unique indexes to prevent duplicate backfill
CREATE UNIQUE INDEX IF NOT EXISTS idx_medical_records_visit
  ON public.medical_records (hospital_id, patient_id, record_type, visit_id)
  WHERE visit_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_icd_codings_visit
  ON public.icd_codings (hospital_id, visit_type, visit_id)
  WHERE visit_id IS NOT NULL;

-- Backfill medical_records from opd_encounters
INSERT INTO public.medical_records (hospital_id, patient_id, record_type, visit_id, status, created_at)
SELECT
  e.hospital_id,
  e.patient_id,
  'opd',
  e.id,
  'active',
  e.created_at
FROM public.opd_encounters e
WHERE NOT EXISTS (
  SELECT 1 FROM public.medical_records mr
  WHERE mr.hospital_id = e.hospital_id AND mr.patient_id = e.patient_id
    AND mr.record_type = 'opd' AND mr.visit_id = e.id
)
ON CONFLICT DO NOTHING;

-- Backfill medical_records from admissions
INSERT INTO public.medical_records (hospital_id, patient_id, record_type, visit_id, status, created_at)
SELECT
  a.hospital_id,
  a.patient_id,
  'ipd',
  a.id,
  CASE WHEN a.status = 'discharged' THEN 'archived' ELSE 'active' END,
  a.created_at
FROM public.admissions a
WHERE NOT EXISTS (
  SELECT 1 FROM public.medical_records mr
  WHERE mr.hospital_id = a.hospital_id AND mr.patient_id = a.patient_id
    AND mr.record_type = 'ipd' AND mr.visit_id = a.id
)
ON CONFLICT DO NOTHING;

-- Backfill icd_codings from opd_encounters
INSERT INTO public.icd_codings (hospital_id, visit_type, visit_id, status, created_at)
SELECT
  e.hospital_id,
  'opd',
  e.id,
  CASE WHEN e.icd10_code IS NOT NULL AND e.icd10_code != '' THEN 'coded' ELSE 'pending' END,
  e.created_at
FROM public.opd_encounters e
WHERE NOT EXISTS (
  SELECT 1 FROM public.icd_codings ic
  WHERE ic.hospital_id = e.hospital_id AND ic.visit_type = 'opd' AND ic.visit_id = e.id
)
ON CONFLICT DO NOTHING;

-- Backfill icd_codings from admissions
INSERT INTO public.icd_codings (hospital_id, visit_type, visit_id, status, created_at)
SELECT
  a.hospital_id,
  'ipd',
  a.id,
  'pending',
  a.created_at
FROM public.admissions a
WHERE NOT EXISTS (
  SELECT 1 FROM public.icd_codings ic
  WHERE ic.hospital_id = a.hospital_id AND ic.visit_type = 'ipd' AND ic.visit_id = a.id
)
ON CONFLICT DO NOTHING;
