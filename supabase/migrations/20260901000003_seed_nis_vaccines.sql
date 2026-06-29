-- Migration: Seed National Immunization Schedule (NIS) Data

-- 1. Allow hospital_id to be NULL for system-wide vaccines visible to all hospitals
ALTER TABLE public.vaccine_master ALTER COLUMN hospital_id DROP NOT NULL;

-- 2. Update RLS so system vaccines (hospital_id IS NULL) are visible to everyone
DROP POLICY IF EXISTS "tenant_isolation_vaccine_master" ON public.vaccine_master;
CREATE POLICY "tenant_isolation_vaccine_master"
ON public.vaccine_master
FOR ALL
TO authenticated
USING (hospital_id IS NULL OR hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()))
WITH CHECK (hospital_id IS NULL OR hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()));

-- 3. Create a unique constraint to avoid duplicates if migration runs multiple times
-- Using PostgreSQL 15+ NULLS NOT DISTINCT feature
ALTER TABLE public.vaccine_master DROP CONSTRAINT IF EXISTS uq_vaccine_master_code;
ALTER TABLE public.vaccine_master ADD CONSTRAINT uq_vaccine_master_code UNIQUE NULLS NOT DISTINCT (hospital_id, vaccine_code);

-- The seed INSERT below references a 'doses' column the base table (20260901000002) omitted; ensure it exists.
ALTER TABLE public.vaccine_master ADD COLUMN IF NOT EXISTS doses integer DEFAULT 1;

-- 4. Seed standard National Immunization Schedule (NIS) Data
INSERT INTO public.vaccine_master (hospital_id, vaccine_name, vaccine_code, nis_schedule, week_of_life, doses, site, is_active) VALUES
(NULL, 'BCG', 'BCG', TRUE, 0, 1, 'Intradermal', TRUE),
(NULL, 'OPV 0', 'OPV0', TRUE, 0, 1, 'Oral', TRUE),
(NULL, 'Hepatitis B (Birth Dose)', 'HEPB0', TRUE, 0, 1, 'Intramuscular', TRUE),

(NULL, 'OPV 1', 'OPV1', TRUE, 6, 1, 'Oral', TRUE),
(NULL, 'Pentavalent 1', 'PENTA1', TRUE, 6, 1, 'Intramuscular', TRUE),
(NULL, 'Rotavirus 1', 'ROTA1', TRUE, 6, 1, 'Oral', TRUE),
(NULL, 'fIPV 1', 'FIPV1', TRUE, 6, 1, 'Intradermal', TRUE),
(NULL, 'PCV 1', 'PCV1', TRUE, 6, 1, 'Intramuscular', TRUE),

(NULL, 'OPV 2', 'OPV2', TRUE, 10, 1, 'Oral', TRUE),
(NULL, 'Pentavalent 2', 'PENTA2', TRUE, 10, 1, 'Intramuscular', TRUE),
(NULL, 'Rotavirus 2', 'ROTA2', TRUE, 10, 1, 'Oral', TRUE),

(NULL, 'OPV 3', 'OPV3', TRUE, 14, 1, 'Oral', TRUE),
(NULL, 'Pentavalent 3', 'PENTA3', TRUE, 14, 1, 'Intramuscular', TRUE),
(NULL, 'fIPV 2', 'FIPV2', TRUE, 14, 1, 'Intradermal', TRUE),
(NULL, 'Rotavirus 3', 'ROTA3', TRUE, 14, 1, 'Oral', TRUE),
(NULL, 'PCV 2', 'PCV2', TRUE, 14, 1, 'Intramuscular', TRUE),

(NULL, 'Measles & Rubella (MR) 1', 'MR1', TRUE, 39, 1, 'Subcutaneous', TRUE),
(NULL, 'JE 1', 'JE1', TRUE, 39, 1, 'Subcutaneous', TRUE),
(NULL, 'PCV Booster', 'PCVB', TRUE, 39, 1, 'Intramuscular', TRUE)
ON CONFLICT (hospital_id, vaccine_code) DO NOTHING;