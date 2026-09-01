-- ═══════════════════════════════════════════════════════════════════════════
-- Lab test catalogue v2 — GENERATED FILE, DO NOT EDIT BY HAND.
--
-- Source of truth:  src/lib/labTestCatalog.ts
-- Regenerate with:  node scripts/generate-lab-catalog.mjs
-- CI guard:         npm run check:lab-catalog
--
-- Hand-editing this file will be reverted by the next generation and will fail CI.
--
-- What this migration does:
--   1. Extends lab_test_categories and sample_types with the values the catalogue
--      uses. The old seed wrote categories ('hematology', 'urine', 'cardiology')
--      that were not in the dropdown at all, so the category filter matched nothing
--      and the dual-validation gate — which compares test_category exactly — could
--      never fire.
--   2. Creates lab_test_catalog_default, the platform-level reference catalogue.
--      Same hospital_id IS NULL pattern hospital_config_values already uses for
--      system defaults.
--   3. Repoints seed_hospital_defaults() at that table so a new hospital and the QA
--      seeder cannot drift apart again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Config vocabulary ───────────────────────────────────────────────────
-- Idempotent: system defaults are unique on (category, value) where hospital_id IS
-- NULL. ON CONFLICT DO UPDATE so a relabelled value is corrected on re-run.
INSERT INTO public.hospital_config_values
  (hospital_id, category, value, label, sort_order, is_active, is_system)
VALUES
  (NULL, 'lab_test_categories', 'Haematology', 'Haematology', 10, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Coagulation', 'Coagulation', 20, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Biochemistry', 'Biochemistry', 30, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Endocrinology', 'Endocrinology', 40, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Cardiac Markers', 'Cardiac Markers', 50, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Serology', 'Serology', 60, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Immunology', 'Immunology', 70, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Microbiology', 'Microbiology', 80, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Clinical Pathology', 'Clinical Pathology', 90, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Histopathology', 'Histopathology', 100, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Cytology', 'Cytology', 110, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Genetics', 'Genetics', 120, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Other', 'Other', 130, TRUE, TRUE),
  (NULL, 'sample_types', 'Blood', 'Blood', 10, TRUE, TRUE),
  (NULL, 'sample_types', 'EDTA Blood', 'EDTA Blood', 20, TRUE, TRUE),
  (NULL, 'sample_types', 'Fluoride Blood', 'Fluoride Blood', 30, TRUE, TRUE),
  (NULL, 'sample_types', 'Citrate Blood', 'Citrate Blood', 40, TRUE, TRUE),
  (NULL, 'sample_types', 'Serum', 'Serum', 50, TRUE, TRUE),
  (NULL, 'sample_types', 'Urine', 'Urine', 60, TRUE, TRUE),
  (NULL, 'sample_types', 'Stool', 'Stool', 70, TRUE, TRUE),
  (NULL, 'sample_types', 'Swab', 'Swab', 80, TRUE, TRUE),
  (NULL, 'sample_types', 'Sputum', 'Sputum', 90, TRUE, TRUE),
  (NULL, 'sample_types', 'CSF', 'CSF', 100, TRUE, TRUE),
  (NULL, 'sample_types', 'Fluid', 'Fluid', 110, TRUE, TRUE),
  (NULL, 'sample_types', 'Biopsy', 'Biopsy', 120, TRUE, TRUE),
  (NULL, 'sample_types', 'Semen', 'Semen', 130, TRUE, TRUE),
  (NULL, 'sample_types', 'Culture Bottle', 'Culture Bottle', 140, TRUE, TRUE),
  (NULL, 'sample_types', 'Other', 'Other', 150, TRUE, TRUE)
ON CONFLICT (category, value) WHERE hospital_id IS NULL
DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, is_active = TRUE;

-- ── 2. Platform reference catalogue ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_test_catalog_default (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name         TEXT NOT NULL UNIQUE,
  test_code         TEXT NOT NULL,
  category          TEXT NOT NULL,
  sample_type       TEXT NOT NULL,
  unit              TEXT,
  normal_min        NUMERIC(12,3),
  normal_max        NUMERIC(12,3),
  critical_low      NUMERIC(12,3),
  critical_high     NUMERIC(12,3),
  male_normal_min   NUMERIC(12,3),
  male_normal_max   NUMERIC(12,3),
  female_normal_min NUMERIC(12,3),
  female_normal_max NUMERIC(12,3),
  method            TEXT,
  tat_minutes       INTEGER NOT NULL,
  fee               NUMERIC(12,2) NOT NULL,
  autoverify_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform reference data, not tenant data: no hospital_id, therefore no isolation
-- policy to write. RLS is still enabled and SELECT is open to authenticated users so
-- the settings page can offer the catalogue; nobody but a migration writes to it.
ALTER TABLE public.lab_test_catalog_default ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_catalog_default_read ON public.lab_test_catalog_default;
CREATE POLICY lab_catalog_default_read ON public.lab_test_catalog_default
  FOR SELECT TO authenticated USING (TRUE);

CREATE TABLE IF NOT EXISTS public.lab_test_group_catalog_default (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name   TEXT NOT NULL UNIQUE,
  group_code   TEXT NOT NULL,
  category     TEXT NOT NULL,
  fee          NUMERIC(12,2) NOT NULL,
  tat_minutes  INTEGER NOT NULL,
  members      TEXT[] NOT NULL
);

ALTER TABLE public.lab_test_group_catalog_default ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_group_catalog_default_read ON public.lab_test_group_catalog_default;
CREATE POLICY lab_group_catalog_default_read ON public.lab_test_group_catalog_default
  FOR SELECT TO authenticated USING (TRUE);

-- Full refresh. This table holds no tenant data and no foreign keys point at it, so
-- replacing its contents is safe and makes the migration re-runnable after a
-- catalogue edit without accumulating stale rows.
TRUNCATE public.lab_test_catalog_default;
INSERT INTO public.lab_test_catalog_default
  (test_name, test_code, category, sample_type, unit,
   normal_min, normal_max, critical_low, critical_high,
   male_normal_min, male_normal_max, female_normal_min, female_normal_max,
   method, tat_minutes, fee, autoverify_eligible)
VALUES
  ('Complete Blood Count', 'CBC', 'Haematology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Automated Cell Counter', 120, 350, FALSE),
  ('Haemoglobin', 'HB', 'Haematology', 'EDTA Blood', 'g/dL', 12, 17, 7, 20, 13, 17, 12, 15, 'Photometric', 60, 120, TRUE),
  ('Total Leucocyte Count', 'TLC', 'Haematology', 'EDTA Blood', 'x10^3/µL', 4, 11, 2, 30, NULL, NULL, NULL, NULL, 'Impedance', 60, 120, TRUE),
  ('Differential Leucocyte Count', 'DLC', 'Haematology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Microscopy / Flow', 60, 130, FALSE),
  ('Absolute Neutrophil Count', 'ANC', 'Haematology', 'EDTA Blood', '/µL', 2000, 7000, 500, NULL, NULL, NULL, NULL, NULL, 'Calculated', 60, 150, FALSE),
  ('Platelet Count', 'PLT', 'Haematology', 'EDTA Blood', 'x10^3/µL', 150, 400, 50, 1000, NULL, NULL, NULL, NULL, 'Impedance', 60, 130, TRUE),
  ('RBC Count', 'RBC', 'Haematology', 'EDTA Blood', 'x10^6/µL', 3.8, 5.9, 2, 7, 4.5, 5.9, 3.8, 5.2, 'Impedance', 60, 120, FALSE),
  ('PCV / Haematocrit', 'PCV', 'Haematology', 'EDTA Blood', '%', 36, 50, 20, 60, 40, 50, 36, 46, 'Calculated', 60, 120, FALSE),
  ('MCV', 'MCV', 'Haematology', 'EDTA Blood', 'fL', 80, 100, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 60, 100, FALSE),
  ('MCH', 'MCH', 'Haematology', 'EDTA Blood', 'pg', 27, 33, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 60, 100, FALSE),
  ('MCHC', 'MCHC', 'Haematology', 'EDTA Blood', 'g/dL', 32, 36, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 60, 100, FALSE),
  ('RDW', 'RDW', 'Haematology', 'EDTA Blood', '%', 11.5, 14.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 60, 100, FALSE),
  ('ESR', 'ESR', 'Haematology', 'EDTA Blood', 'mm/hr', 0, 20, NULL, NULL, 0, 15, 0, 20, 'Westergren', 60, 120, FALSE),
  ('Reticulocyte Count', 'RETIC', 'Haematology', 'EDTA Blood', '%', 0.5, 2.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Supravital Stain', 120, 200, FALSE),
  ('Peripheral Smear Examination', 'PS', 'Haematology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Leishman Stain Microscopy', 240, 250, FALSE),
  ('Blood Group & Rh Typing', 'ABORH', 'Haematology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Slide / Tube Agglutination', 60, 150, FALSE),
  ('Malaria Parasite (Smear)', 'MPS', 'Haematology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Thick & Thin Smear', 60, 150, FALSE),
  ('Malaria Antigen (Rapid)', 'MPRDT', 'Haematology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochromatography', 60, 300, FALSE),
  ('Prothrombin Time', 'PT', 'Coagulation', 'Citrate Blood', 'seconds', 11, 13.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Coagulometry', 120, 250, FALSE),
  ('INR', 'INR', 'Coagulation', 'Citrate Blood', 'ratio', 0.8, 1.2, NULL, 5, NULL, NULL, NULL, NULL, 'Calculated', 120, 200, FALSE),
  ('aPTT', 'APTT', 'Coagulation', 'Citrate Blood', 'seconds', 25, 35, NULL, 100, NULL, NULL, NULL, NULL, 'Coagulometry', 120, 300, FALSE),
  ('D-Dimer', 'DDIM', 'Coagulation', 'Citrate Blood', 'µg/mL FEU', 0, 0.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 240, 900, FALSE),
  ('Fibrinogen', 'FIB', 'Coagulation', 'Citrate Blood', 'mg/dL', 200, 400, 100, NULL, NULL, NULL, NULL, NULL, 'Clauss', 240, 700, FALSE),
  ('Bleeding Time', 'BT', 'Coagulation', 'Blood', 'minutes', 2, 7, NULL, NULL, NULL, NULL, NULL, NULL, 'Duke', 60, 100, FALSE),
  ('Clotting Time', 'CT', 'Coagulation', 'Blood', 'minutes', 4, 9, NULL, NULL, NULL, NULL, NULL, NULL, 'Capillary Tube', 60, 100, FALSE),
  ('Liver Function Test', 'LFT', 'Biochemistry', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 120, 700, FALSE),
  ('SGOT (AST)', 'SGOT', 'Biochemistry', 'Serum', 'U/L', 0, 40, NULL, 500, NULL, NULL, NULL, NULL, 'IFCC Kinetic', 120, 150, FALSE),
  ('SGPT (ALT)', 'SGPT', 'Biochemistry', 'Serum', 'U/L', 0, 40, NULL, 500, NULL, NULL, NULL, NULL, 'IFCC Kinetic', 120, 150, FALSE),
  ('Alkaline Phosphatase', 'ALP', 'Biochemistry', 'Serum', 'U/L', 44, 147, NULL, NULL, NULL, NULL, NULL, NULL, 'PNPP Kinetic', 120, 150, FALSE),
  ('GGT', 'GGT', 'Biochemistry', 'Serum', 'U/L', 6, 71, NULL, NULL, 10, 71, 6, 42, 'Kinetic', 120, 200, FALSE),
  ('Bilirubin Total', 'TBIL', 'Biochemistry', 'Serum', 'mg/dL', 0.2, 1.2, NULL, 15, NULL, NULL, NULL, NULL, 'Diazo', 120, 120, FALSE),
  ('Bilirubin Direct', 'DBIL', 'Biochemistry', 'Serum', 'mg/dL', 0, 0.3, NULL, NULL, NULL, NULL, NULL, NULL, 'Diazo', 120, 120, FALSE),
  ('Bilirubin Indirect', 'IBIL', 'Biochemistry', 'Serum', 'mg/dL', 0.1, 0.9, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 120, 120, FALSE),
  ('Total Protein', 'TP', 'Biochemistry', 'Serum', 'g/dL', 6, 8.3, NULL, NULL, NULL, NULL, NULL, NULL, 'Biuret', 120, 120, FALSE),
  ('Albumin', 'ALB', 'Biochemistry', 'Serum', 'g/dL', 3.5, 5, 2, NULL, NULL, NULL, NULL, NULL, 'BCG', 120, 120, FALSE),
  ('Globulin', 'GLOB', 'Biochemistry', 'Serum', 'g/dL', 2, 3.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 120, 120, FALSE),
  ('A:G Ratio', 'AGR', 'Biochemistry', 'Serum', 'ratio', 1, 2.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 120, 100, FALSE),
  ('Kidney Function Test', 'KFT', 'Biochemistry', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 120, 700, FALSE),
  ('Serum Creatinine', 'CREAT', 'Biochemistry', 'Serum', 'mg/dL', 0.6, 1.3, NULL, 5, 0.7, 1.3, 0.6, 1.1, 'Jaffe Kinetic', 120, 150, FALSE),
  ('Blood Urea', 'BU', 'Biochemistry', 'Serum', 'mg/dL', 15, 40, NULL, 200, NULL, NULL, NULL, NULL, 'Urease GLDH', 120, 130, FALSE),
  ('Blood Urea Nitrogen', 'BUN', 'Biochemistry', 'Serum', 'mg/dL', 7, 20, NULL, 100, NULL, NULL, NULL, NULL, 'Calculated', 120, 130, FALSE),
  ('Uric Acid', 'UA', 'Biochemistry', 'Serum', 'mg/dL', 2.4, 7, NULL, 13, 3.4, 7, 2.4, 6, 'Uricase', 120, 150, FALSE),
  ('eGFR', 'EGFR', 'Biochemistry', 'Serum', 'mL/min/1.73m^2', 90, NULL, 15, NULL, NULL, NULL, NULL, NULL, 'CKD-EPI Calculated', 120, 100, FALSE),
  ('Serum Calcium', 'CA', 'Biochemistry', 'Serum', 'mg/dL', 8.5, 10.5, 6.5, 13, NULL, NULL, NULL, NULL, 'Arsenazo III', 120, 150, FALSE),
  ('Ionised Calcium', 'ICA', 'Biochemistry', 'Serum', 'mmol/L', 1.12, 1.32, 0.8, 1.6, NULL, NULL, NULL, NULL, 'ISE', 120, 400, FALSE),
  ('Serum Phosphorus', 'PHOS', 'Biochemistry', 'Serum', 'mg/dL', 2.5, 4.5, 1, NULL, NULL, NULL, NULL, NULL, 'Phosphomolybdate', 120, 150, FALSE),
  ('Serum Magnesium', 'MG', 'Biochemistry', 'Serum', 'mg/dL', 1.7, 2.2, 1, 4.9, NULL, NULL, NULL, NULL, 'Xylidyl Blue', 120, 250, FALSE),
  ('Serum Electrolytes', 'ELEC', 'Biochemistry', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 60, 400, FALSE),
  ('Serum Sodium', 'NA', 'Biochemistry', 'Serum', 'mEq/L', 136, 145, 120, 160, NULL, NULL, NULL, NULL, 'ISE', 60, 150, FALSE),
  ('Serum Potassium', 'K', 'Biochemistry', 'Serum', 'mEq/L', 3.5, 5, 2.5, 6.5, NULL, NULL, NULL, NULL, 'ISE', 60, 150, FALSE),
  ('Serum Chloride', 'CL', 'Biochemistry', 'Serum', 'mEq/L', 98, 107, 80, 120, NULL, NULL, NULL, NULL, 'ISE', 60, 150, FALSE),
  ('Serum Bicarbonate', 'HCO3', 'Biochemistry', 'Serum', 'mEq/L', 22, 28, 10, 40, NULL, NULL, NULL, NULL, 'Enzymatic', 60, 200, FALSE),
  ('Lipid Profile', 'LIPID', 'Biochemistry', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 120, 600, FALSE),
  ('Total Cholesterol', 'CHOL', 'Biochemistry', 'Serum', 'mg/dL', 0, 200, NULL, 400, NULL, NULL, NULL, NULL, 'CHOD-PAP', 120, 150, FALSE),
  ('HDL Cholesterol', 'HDL', 'Biochemistry', 'Serum', 'mg/dL', 40, NULL, 20, NULL, NULL, NULL, NULL, NULL, 'Direct Enzymatic', 120, 150, FALSE),
  ('LDL Cholesterol', 'LDL', 'Biochemistry', 'Serum', 'mg/dL', 0, 130, NULL, 300, NULL, NULL, NULL, NULL, 'Direct Enzymatic', 120, 150, FALSE),
  ('VLDL Cholesterol', 'VLDL', 'Biochemistry', 'Serum', 'mg/dL', 5, 40, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 120, 120, FALSE),
  ('Triglycerides', 'TG', 'Biochemistry', 'Serum', 'mg/dL', 0, 150, NULL, 500, NULL, NULL, NULL, NULL, 'GPO-PAP', 120, 150, FALSE),
  ('HbA1c', 'HBA1C', 'Biochemistry', 'EDTA Blood', '%', 4, 5.7, NULL, NULL, NULL, NULL, NULL, NULL, 'HPLC', 240, 500, FALSE),
  ('Blood Sugar Fasting', 'BSF', 'Biochemistry', 'Fluoride Blood', 'mg/dL', 70, 100, 40, 500, NULL, NULL, NULL, NULL, 'GOD-POD', 60, 80, TRUE),
  ('Blood Sugar Post Prandial', 'BSPP', 'Biochemistry', 'Fluoride Blood', 'mg/dL', 70, 140, 40, 600, NULL, NULL, NULL, NULL, 'GOD-POD', 60, 80, TRUE),
  ('Blood Sugar Random', 'BSR', 'Biochemistry', 'Fluoride Blood', 'mg/dL', 70, 140, 40, 600, NULL, NULL, NULL, NULL, 'GOD-POD', 60, 80, FALSE),
  ('Oral Glucose Tolerance Test', 'OGTT', 'Biochemistry', 'Fluoride Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'GOD-POD Serial', 240, 400, FALSE),
  ('Fasting Insulin', 'INS', 'Biochemistry', 'Serum', 'µIU/mL', 2.6, 24.9, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 480, 700, FALSE),
  ('Serum Amylase', 'AMY', 'Biochemistry', 'Serum', 'U/L', 25, 125, NULL, 500, NULL, NULL, NULL, NULL, 'CNPG3 Kinetic', 120, 400, FALSE),
  ('Serum Lipase', 'LIP', 'Biochemistry', 'Serum', 'U/L', 13, 60, NULL, 500, NULL, NULL, NULL, NULL, 'Enzymatic Colorimetric', 120, 500, FALSE),
  ('LDH', 'LDH', 'Biochemistry', 'Serum', 'U/L', 140, 280, NULL, NULL, NULL, NULL, NULL, NULL, 'Kinetic', 120, 350, FALSE),
  ('CPK Total', 'CPK', 'Biochemistry', 'Serum', 'U/L', 26, 308, NULL, NULL, 39, 308, 26, 192, 'IFCC Kinetic', 120, 400, FALSE),
  ('CRP (C-Reactive Protein)', 'CRP', 'Biochemistry', 'Serum', 'mg/L', 0, 5, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 120, 400, FALSE),
  ('Procalcitonin', 'PCT', 'Biochemistry', 'Serum', 'ng/mL', 0, 0.5, NULL, 2, NULL, NULL, NULL, NULL, 'CLIA', 240, 2200, FALSE),
  ('Serum Iron', 'FE', 'Biochemistry', 'Serum', 'µg/dL', 50, 175, NULL, NULL, 65, 175, 50, 170, 'Ferrozine', 240, 400, FALSE),
  ('TIBC', 'TIBC', 'Biochemistry', 'Serum', 'µg/dL', 240, 450, NULL, NULL, NULL, NULL, NULL, NULL, 'Ferrozine', 240, 400, FALSE),
  ('Serum Ferritin', 'FERR', 'Biochemistry', 'Serum', 'ng/mL', 13, 400, NULL, NULL, 30, 400, 13, 150, 'CLIA', 240, 800, FALSE),
  ('TSH', 'TSH', 'Endocrinology', 'Serum', 'µIU/mL', 0.4, 4, 0.1, 100, NULL, NULL, NULL, NULL, 'CLIA', 240, 300, FALSE),
  ('T3 (Total)', 'T3', 'Endocrinology', 'Serum', 'ng/dL', 80, 200, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 250, FALSE),
  ('T4 (Total)', 'T4', 'Endocrinology', 'Serum', 'µg/dL', 5, 12, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 250, FALSE),
  ('Free T3', 'FT3', 'Endocrinology', 'Serum', 'pg/mL', 2.3, 4.2, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 400, FALSE),
  ('Free T4', 'FT4', 'Endocrinology', 'Serum', 'ng/dL', 0.8, 1.8, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 400, FALSE),
  ('Anti-TPO Antibody', 'ATPO', 'Endocrinology', 'Serum', 'IU/mL', 0, 34, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 800, FALSE),
  ('Vitamin D (25-OH)', 'VITD', 'Endocrinology', 'Serum', 'ng/mL', 30, 100, 10, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 1200, FALSE),
  ('Vitamin B12', 'VITB12', 'Endocrinology', 'Serum', 'pg/mL', 200, 900, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 1000, FALSE),
  ('Folate', 'FOL', 'Endocrinology', 'Serum', 'ng/mL', 3, 17, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 900, FALSE),
  ('Serum Cortisol (Morning)', 'CORT', 'Endocrinology', 'Serum', 'µg/dL', 6, 23, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 800, FALSE),
  ('Prolactin', 'PRL', 'Endocrinology', 'Serum', 'ng/mL', 4, 25, NULL, NULL, 4, 15, 5, 25, 'CLIA', 1440, 600, FALSE),
  ('Beta hCG', 'BHCG', 'Endocrinology', 'Serum', 'mIU/mL', 0, 5, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 700, FALSE),
  ('PSA (Total)', 'PSA', 'Endocrinology', 'Serum', 'ng/mL', 0, 4, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 700, FALSE),
  ('Troponin I', 'TROPI', 'Cardiac Markers', 'Serum', 'ng/mL', 0, 0.04, NULL, 0.04, NULL, NULL, NULL, NULL, 'CLIA', 60, 900, FALSE),
  ('CK-MB', 'CKMB', 'Cardiac Markers', 'Serum', 'ng/mL', 0, 5, NULL, 10, NULL, NULL, NULL, NULL, 'CLIA', 120, 600, FALSE),
  ('NT-proBNP', 'NTBNP', 'Cardiac Markers', 'Serum', 'pg/mL', 0, 125, NULL, 900, NULL, NULL, NULL, NULL, 'CLIA', 240, 1800, FALSE),
  ('HIV I & II', 'HIV', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA / Rapid', 240, 400, FALSE),
  ('HBsAg', 'HBSAG', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA / Rapid', 240, 400, FALSE),
  ('Anti-HCV', 'HCV', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 240, 600, FALSE),
  ('VDRL / RPR', 'VDRL', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Flocculation', 240, 300, FALSE),
  ('Dengue NS1 Antigen', 'DNS1', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochromatography', 240, 800, FALSE),
  ('Dengue IgM', 'DIGM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 240, 700, FALSE),
  ('Dengue IgG', 'DIGG', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 240, 700, FALSE),
  ('Widal Test', 'WIDAL', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Tube Agglutination', 240, 300, FALSE),
  ('Typhoid IgM (Typhidot)', 'TYPHM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochromatography', 240, 600, FALSE),
  ('Chikungunya IgM', 'CHIKM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 1440, 900, FALSE),
  ('Scrub Typhus IgM', 'SCRUBM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 1440, 1000, FALSE),
  ('Leptospira IgM', 'LEPTOM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 1440, 900, FALSE),
  ('COVID-19 Rapid Antigen', 'COVAG', 'Serology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochromatography', 60, 400, FALSE),
  ('ASO Titre', 'ASO', 'Immunology', 'Serum', 'IU/mL', 0, 200, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 240, 400, FALSE),
  ('Rheumatoid Factor', 'RA', 'Immunology', 'Serum', 'IU/mL', 0, 14, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 240, 400, FALSE),
  ('ANA (IF)', 'ANA', 'Immunology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Indirect Immunofluorescence', 1440, 1200, FALSE),
  ('Blood Culture & Sensitivity', 'BCUL', 'Microbiology', 'Culture Bottle', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Automated BacT/ALERT', 4320, 1200, FALSE),
  ('Urine Culture & Sensitivity', 'UCUL', 'Microbiology', 'Urine', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Semi-quantitative Culture', 2880, 800, FALSE),
  ('Sputum Culture & Sensitivity', 'SCUL', 'Microbiology', 'Sputum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Culture', 2880, 800, FALSE),
  ('Pus / Wound Swab C&S', 'PSCUL', 'Microbiology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Culture', 2880, 800, FALSE),
  ('Stool Culture & Sensitivity', 'STCUL', 'Microbiology', 'Stool', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Culture', 2880, 800, FALSE),
  ('Gram Stain', 'GRAM', 'Microbiology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Gram Stain Microscopy', 120, 200, FALSE),
  ('Sputum AFB (ZN Stain)', 'AFB', 'Microbiology', 'Sputum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Ziehl-Neelsen', 240, 250, FALSE),
  ('GeneXpert MTB/RIF', 'XPERT', 'Microbiology', 'Sputum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Cartridge PCR', 1440, 2000, FALSE),
  ('KOH Mount', 'KOH', 'Microbiology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'KOH Wet Mount', 120, 250, FALSE),
  ('Urine Routine & Microscopy', 'URM', 'Clinical Pathology', 'Urine', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Dipstick + Microscopy', 60, 150, FALSE),
  ('Urine Pregnancy Test', 'UPT', 'Clinical Pathology', 'Urine', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochromatography', 30, 200, FALSE),
  ('Urine Ketones', 'UKET', 'Clinical Pathology', 'Urine', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Dipstick', 60, 100, FALSE),
  ('Urine Microalbumin', 'UMALB', 'Clinical Pathology', 'Urine', 'mg/L', 0, 30, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 240, 600, FALSE),
  ('Urine Protein/Creatinine Ratio', 'UPCR', 'Clinical Pathology', 'Urine', 'mg/g', 0, 150, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 240, 600, FALSE),
  ('24 Hour Urine Protein', 'U24P', 'Clinical Pathology', 'Urine', 'mg/24h', 0, 150, NULL, NULL, NULL, NULL, NULL, NULL, 'Pyrogallol Red', 1440, 600, FALSE),
  ('Stool Routine Examination', 'STRM', 'Clinical Pathology', 'Stool', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Microscopy', 120, 200, FALSE),
  ('Stool Occult Blood', 'SOB', 'Clinical Pathology', 'Stool', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochemical', 120, 250, FALSE),
  ('CSF Analysis', 'CSFA', 'Clinical Pathology', 'CSF', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Cytology + Biochemistry', 120, 800, FALSE),
  ('Body Fluid Analysis', 'BFA', 'Clinical Pathology', 'Fluid', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Cytology + Biochemistry', 120, 700, FALSE),
  ('Semen Analysis', 'SEMEN', 'Clinical Pathology', 'Semen', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'WHO 2021 Manual', 240, 600, FALSE),
  ('Histopathology - Small Specimen', 'HPES', 'Histopathology', 'Biopsy', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'H&E Microscopy', 4320, 1500, FALSE),
  ('Histopathology - Large Specimen', 'HPEL', 'Histopathology', 'Biopsy', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'H&E Microscopy', 7200, 3000, FALSE),
  ('Frozen Section', 'FROZEN', 'Histopathology', 'Biopsy', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Cryostat Section', 60, 3500, FALSE),
  ('Immunohistochemistry (per marker)', 'IHC', 'Histopathology', 'Biopsy', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'IHC', 7200, 2500, FALSE),
  ('FNAC', 'FNAC', 'Cytology', 'Biopsy', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Fine Needle Aspiration Cytology', 2880, 1200, FALSE),
  ('Pap Smear', 'PAP', 'Cytology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Papanicolaou Stain', 4320, 900, FALSE),
  ('Fluid Cytology', 'FCYT', 'Cytology', 'Fluid', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Cytospin', 2880, 1000, FALSE),
  ('COVID-19 RT-PCR', 'COVPCR', 'Genetics', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Real-Time PCR', 1440, 500, FALSE);

TRUNCATE public.lab_test_group_catalog_default;
INSERT INTO public.lab_test_group_catalog_default
  (group_name, group_code, category, fee, tat_minutes, members)
VALUES
  ('Complete Blood Count Panel', 'CBCP', 'Haematology', 350, 120, ARRAY['Haemoglobin', 'Total Leucocyte Count', 'Differential Leucocyte Count', 'Platelet Count', 'RBC Count', 'PCV / Haematocrit', 'MCV', 'MCH', 'MCHC', 'RDW']::text[]),
  ('Liver Function Panel', 'LFTP', 'Biochemistry', 700, 120, ARRAY['SGOT (AST)', 'SGPT (ALT)', 'Alkaline Phosphatase', 'GGT', 'Bilirubin Total', 'Bilirubin Direct', 'Bilirubin Indirect', 'Total Protein', 'Albumin', 'Globulin', 'A:G Ratio']::text[]),
  ('Kidney Function Panel', 'KFTP', 'Biochemistry', 700, 120, ARRAY['Serum Creatinine', 'Blood Urea', 'Blood Urea Nitrogen', 'Uric Acid', 'eGFR', 'Serum Sodium', 'Serum Potassium', 'Serum Chloride']::text[]),
  ('Lipid Profile Panel', 'LIPIDP', 'Biochemistry', 600, 120, ARRAY['Total Cholesterol', 'HDL Cholesterol', 'LDL Cholesterol', 'VLDL Cholesterol', 'Triglycerides']::text[]),
  ('Thyroid Profile', 'TFT', 'Endocrinology', 600, 240, ARRAY['TSH', 'T3 (Total)', 'T4 (Total)']::text[]),
  ('Pre-Operative Screening', 'PREOP', 'Serology', 1400, 240, ARRAY['HIV I & II', 'HBsAg', 'Anti-HCV', 'VDRL / RPR']::text[]),
  ('Fever Panel', 'FEVER', 'Serology', 1500, 240, ARRAY['Complete Blood Count', 'Malaria Antigen (Rapid)', 'Dengue NS1 Antigen', 'Widal Test', 'Blood Sugar Random']::text[]);

-- ── 3. Seed a hospital from the reference catalogue ────────────────────────
-- Replaces the literal VALUES list that used to live inside seed_hospital_defaults.
-- Both this and the QA seeder now read the same rows.
CREATE OR REPLACE FUNCTION public.seed_lab_catalog_for_hospital(p_hospital_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  INSERT INTO public.lab_test_master
    (hospital_id, test_name, test_code, category, sample_type, unit,
     normal_min, normal_max, critical_low, critical_high,
     male_normal_min, male_normal_max, female_normal_min, female_normal_max,
     method, tat_minutes, fee, autoverify_eligible, is_active)
  SELECT
    p_hospital_id, c.test_name, c.test_code, c.category, c.sample_type, c.unit,
    c.normal_min, c.normal_max, c.critical_low, c.critical_high,
    c.male_normal_min, c.male_normal_max, c.female_normal_min, c.female_normal_max,
    c.method, c.tat_minutes, c.fee, c.autoverify_eligible,
    -- Active on arrival. Migration 20261009000171 flipped the column default to
    -- false and deactivated every existing row; because syncLabOrders and the order
    -- search both filter is_active = true, a hospital seeded under that default has
    -- no orderable tests at all and the whole Lab module looks broken.
    TRUE
  FROM public.lab_test_catalog_default c
  ON CONFLICT ON CONSTRAINT lab_test_master_hospital_id_test_name_key DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.seed_lab_catalog_for_hospital(UUID) IS
  'Seeds lab_test_master for one hospital from lab_test_catalog_default. Idempotent: '
  'existing tests are left untouched, so a hospital never loses a tuned reference range.';
