-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104000002_lab_test_catalog_v3 — GENERATED FILE, DO NOT EDIT BY HAND.
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
  (NULL, 'lab_test_categories', 'Tumour Markers', 'Tumour Markers', 60, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Serology', 'Serology', 70, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Immunology', 'Immunology', 80, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Microbiology', 'Microbiology', 90, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Molecular Biology', 'Molecular Biology', 100, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Clinical Pathology', 'Clinical Pathology', 110, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Histopathology', 'Histopathology', 120, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Cytology', 'Cytology', 130, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Genetics', 'Genetics', 140, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Therapeutic Drug Monitoring', 'Therapeutic Drug Monitoring', 150, TRUE, TRUE),
  (NULL, 'lab_test_categories', 'Other', 'Other', 160, TRUE, TRUE),
  (NULL, 'sample_types', 'Blood', 'Blood', 10, TRUE, TRUE),
  (NULL, 'sample_types', 'EDTA Blood', 'EDTA Blood', 20, TRUE, TRUE),
  (NULL, 'sample_types', 'Fluoride Blood', 'Fluoride Blood', 30, TRUE, TRUE),
  (NULL, 'sample_types', 'Citrate Blood', 'Citrate Blood', 40, TRUE, TRUE),
  (NULL, 'sample_types', 'Arterial Blood', 'Arterial Blood', 50, TRUE, TRUE),
  (NULL, 'sample_types', 'Serum', 'Serum', 60, TRUE, TRUE),
  (NULL, 'sample_types', 'Urine', 'Urine', 70, TRUE, TRUE),
  (NULL, 'sample_types', 'Stool', 'Stool', 80, TRUE, TRUE),
  (NULL, 'sample_types', 'Swab', 'Swab', 90, TRUE, TRUE),
  (NULL, 'sample_types', 'Sputum', 'Sputum', 100, TRUE, TRUE),
  (NULL, 'sample_types', 'CSF', 'CSF', 110, TRUE, TRUE),
  (NULL, 'sample_types', 'Fluid', 'Fluid', 120, TRUE, TRUE),
  (NULL, 'sample_types', 'Biopsy', 'Biopsy', 130, TRUE, TRUE),
  (NULL, 'sample_types', 'Semen', 'Semen', 140, TRUE, TRUE),
  (NULL, 'sample_types', 'Culture Bottle', 'Culture Bottle', 150, TRUE, TRUE),
  (NULL, 'sample_types', 'Other', 'Other', 160, TRUE, TRUE)
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
  ('Absolute Eosinophil Count', 'AEC', 'Haematology', 'EDTA Blood', '/µL', 40, 440, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 60, 150, FALSE),
  ('Haemoglobin Electrophoresis (HPLC)', 'HBELP', 'Haematology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Cation-Exchange HPLC', 2880, 1500, FALSE),
  ('Sickling / Solubility Test', 'SICKL', 'Haematology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Sodium Metabisulphite', 120, 250, FALSE),
  ('G6PD (Quantitative)', 'G6PD', 'Haematology', 'EDTA Blood', 'U/g Hb', 6.8, 13.9, NULL, NULL, NULL, NULL, NULL, NULL, 'Enzymatic Kinetic', 1440, 900, FALSE),
  ('Coombs Test Direct (DCT)', 'DCT', 'Haematology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Column Agglutination', 120, 400, FALSE),
  ('Coombs Test Indirect (ICT)', 'ICT', 'Haematology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Column Agglutination', 120, 400, FALSE),
  ('Prothrombin Time', 'PT', 'Coagulation', 'Citrate Blood', 'seconds', 11, 13.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Coagulometry', 120, 250, FALSE),
  ('INR', 'INR', 'Coagulation', 'Citrate Blood', 'ratio', 0.8, 1.2, NULL, 5, NULL, NULL, NULL, NULL, 'Calculated', 120, 200, FALSE),
  ('aPTT', 'APTT', 'Coagulation', 'Citrate Blood', 'seconds', 25, 35, NULL, 100, NULL, NULL, NULL, NULL, 'Coagulometry', 120, 300, FALSE),
  ('D-Dimer', 'DDIM', 'Coagulation', 'Citrate Blood', 'µg/mL FEU', 0, 0.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 240, 900, FALSE),
  ('Fibrinogen', 'FIB', 'Coagulation', 'Citrate Blood', 'mg/dL', 200, 400, 100, NULL, NULL, NULL, NULL, NULL, 'Clauss', 240, 700, FALSE),
  ('Bleeding Time', 'BT', 'Coagulation', 'Blood', 'minutes', 2, 7, NULL, NULL, NULL, NULL, NULL, NULL, 'Duke', 60, 100, FALSE),
  ('Clotting Time', 'CT', 'Coagulation', 'Blood', 'minutes', 4, 9, NULL, NULL, NULL, NULL, NULL, NULL, 'Capillary Tube', 60, 100, FALSE),
  ('SGOT (AST)', 'SGOT', 'Biochemistry', 'Serum', 'U/L', 0, 40, NULL, 500, 0, 40, 0, 32, 'IFCC Kinetic', 120, 150, FALSE),
  ('SGPT (ALT)', 'SGPT', 'Biochemistry', 'Serum', 'U/L', 0, 41, NULL, 500, 0, 41, 0, 33, 'IFCC Kinetic', 120, 150, FALSE),
  ('Alkaline Phosphatase', 'ALP', 'Biochemistry', 'Serum', 'U/L', 35, 129, NULL, NULL, 40, 129, 35, 104, 'IFCC PNPP Kinetic', 120, 150, FALSE),
  ('GGT', 'GGT', 'Biochemistry', 'Serum', 'U/L', 6, 71, NULL, NULL, 10, 71, 6, 42, 'Kinetic', 120, 200, FALSE),
  ('Bilirubin Total', 'TBIL', 'Biochemistry', 'Serum', 'mg/dL', 0.2, 1.2, NULL, 15, NULL, NULL, NULL, NULL, 'Diazo', 120, 120, FALSE),
  ('Bilirubin Direct', 'DBIL', 'Biochemistry', 'Serum', 'mg/dL', 0, 0.3, NULL, NULL, NULL, NULL, NULL, NULL, 'Diazo', 120, 120, FALSE),
  ('Bilirubin Indirect', 'IBIL', 'Biochemistry', 'Serum', 'mg/dL', 0.1, 0.9, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 120, 120, FALSE),
  ('Total Protein', 'TP', 'Biochemistry', 'Serum', 'g/dL', 6, 8.3, NULL, NULL, NULL, NULL, NULL, NULL, 'Biuret', 120, 120, FALSE),
  ('Albumin', 'ALB', 'Biochemistry', 'Serum', 'g/dL', 3.5, 5, NULL, NULL, NULL, NULL, NULL, NULL, 'BCG', 120, 120, FALSE),
  ('Globulin', 'GLOB', 'Biochemistry', 'Serum', 'g/dL', 2, 3.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 120, 120, FALSE),
  ('A:G Ratio', 'AGR', 'Biochemistry', 'Serum', 'ratio', 1, 2.5, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 120, 100, FALSE),
  ('Serum Creatinine', 'CREAT', 'Biochemistry', 'Serum', 'mg/dL', 0.6, 1.3, NULL, 5, 0.7, 1.3, 0.6, 1.1, 'Jaffe Kinetic', 120, 150, FALSE),
  ('Blood Urea', 'BU', 'Biochemistry', 'Serum', 'mg/dL', 15, 40, NULL, 200, NULL, NULL, NULL, NULL, 'Urease GLDH', 120, 130, FALSE),
  ('Blood Urea Nitrogen', 'BUN', 'Biochemistry', 'Serum', 'mg/dL', 7, 20, NULL, 100, NULL, NULL, NULL, NULL, 'Calculated', 120, 130, FALSE),
  ('Uric Acid', 'UA', 'Biochemistry', 'Serum', 'mg/dL', 2.4, 7, NULL, 13, 3.4, 7, 2.4, 6, 'Uricase', 120, 150, FALSE),
  ('eGFR', 'EGFR', 'Biochemistry', 'Serum', 'mL/min/1.73m^2', 90, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'CKD-EPI Calculated', 120, 100, FALSE),
  ('Serum Calcium', 'CA', 'Biochemistry', 'Serum', 'mg/dL', 8.5, 10.5, 6.5, 13, NULL, NULL, NULL, NULL, 'Arsenazo III', 120, 150, FALSE),
  ('Ionised Calcium', 'ICA', 'Biochemistry', 'Serum', 'mmol/L', 1.12, 1.32, 0.8, 1.6, NULL, NULL, NULL, NULL, 'ISE', 120, 400, FALSE),
  ('Serum Phosphorus', 'PHOS', 'Biochemistry', 'Serum', 'mg/dL', 2.5, 4.5, 1, NULL, NULL, NULL, NULL, NULL, 'Phosphomolybdate', 120, 150, FALSE),
  ('Serum Magnesium', 'MG', 'Biochemistry', 'Serum', 'mg/dL', 1.7, 2.2, 1, 4.9, NULL, NULL, NULL, NULL, 'Xylidyl Blue', 120, 250, FALSE),
  ('Serum Sodium', 'NA', 'Biochemistry', 'Serum', 'mEq/L', 136, 145, 120, 160, NULL, NULL, NULL, NULL, 'ISE', 60, 150, FALSE),
  ('Serum Potassium', 'K', 'Biochemistry', 'Serum', 'mEq/L', 3.5, 5, 2.5, 6.5, NULL, NULL, NULL, NULL, 'ISE', 60, 150, FALSE),
  ('Serum Chloride', 'CL', 'Biochemistry', 'Serum', 'mEq/L', 98, 107, 80, 120, NULL, NULL, NULL, NULL, 'ISE', 60, 150, FALSE),
  ('Serum Bicarbonate', 'HCO3', 'Biochemistry', 'Serum', 'mEq/L', 22, 28, 10, 40, NULL, NULL, NULL, NULL, 'Enzymatic', 60, 200, FALSE),
  ('Arterial Blood Gas', 'ABG', 'Biochemistry', 'Arterial Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Blood Gas Analyser', 30, 800, FALSE),
  ('Serum Lactate', 'LACT', 'Biochemistry', 'Fluoride Blood', 'mmol/L', 0.5, 2.2, NULL, 4, NULL, NULL, NULL, NULL, 'Enzymatic', 60, 600, FALSE),
  ('Serum Ammonia', 'NH3', 'Biochemistry', 'EDTA Blood', 'µmol/L', 15, 45, NULL, 100, NULL, NULL, NULL, NULL, 'Enzymatic UV', 120, 900, FALSE),
  ('Blood Ketone (Beta-Hydroxybutyrate)', 'BHB', 'Biochemistry', 'Serum', 'mmol/L', 0, 0.6, NULL, 3, NULL, NULL, NULL, NULL, 'Enzymatic', 60, 400, FALSE),
  ('Serum Osmolality', 'OSMO', 'Biochemistry', 'Serum', 'mOsm/kg', 275, 295, 250, 320, NULL, NULL, NULL, NULL, 'Freezing Point Depression', 120, 500, FALSE),
  ('Cystatin C', 'CYSC', 'Biochemistry', 'Serum', 'mg/L', 0.62, 1.15, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 240, 1200, FALSE),
  ('Total Cholesterol', 'CHOL', 'Biochemistry', 'Serum', 'mg/dL', 0, 200, NULL, NULL, NULL, NULL, NULL, NULL, 'CHOD-PAP', 120, 150, FALSE),
  ('HDL Cholesterol', 'HDL', 'Biochemistry', 'Serum', 'mg/dL', 40, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Direct Enzymatic', 120, 150, FALSE),
  ('LDL Cholesterol', 'LDL', 'Biochemistry', 'Serum', 'mg/dL', 0, 130, NULL, NULL, NULL, NULL, NULL, NULL, 'Direct Enzymatic', 120, 150, FALSE),
  ('VLDL Cholesterol', 'VLDL', 'Biochemistry', 'Serum', 'mg/dL', 5, 40, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 120, 120, FALSE),
  ('Triglycerides', 'TG', 'Biochemistry', 'Serum', 'mg/dL', 0, 150, NULL, 1000, NULL, NULL, NULL, NULL, 'GPO-PAP', 120, 150, FALSE),
  ('HbA1c', 'HBA1C', 'Biochemistry', 'EDTA Blood', '%', 4, 5.7, NULL, NULL, NULL, NULL, NULL, NULL, 'HPLC', 240, 500, FALSE),
  ('Blood Sugar Fasting', 'BSF', 'Biochemistry', 'Fluoride Blood', 'mg/dL', 70, 100, 40, 500, NULL, NULL, NULL, NULL, 'GOD-POD', 60, 80, TRUE),
  ('Blood Sugar Post Prandial', 'BSPP', 'Biochemistry', 'Fluoride Blood', 'mg/dL', 70, 140, 40, 500, NULL, NULL, NULL, NULL, 'GOD-POD', 60, 80, TRUE),
  ('Blood Sugar Random', 'BSR', 'Biochemistry', 'Fluoride Blood', 'mg/dL', 70, 140, 40, 500, NULL, NULL, NULL, NULL, 'GOD-POD', 60, 80, FALSE),
  ('Oral Glucose Tolerance Test', 'OGTT', 'Biochemistry', 'Fluoride Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'GOD-POD Serial', 240, 400, FALSE),
  ('Glucose Challenge Test (DIPSI 75g)', 'GCT', 'Biochemistry', 'Fluoride Blood', 'mg/dL', 70, 140, 40, 500, NULL, NULL, NULL, NULL, 'GOD-POD', 180, 250, FALSE),
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
  ('Vitamin B12', 'VITB12', 'Biochemistry', 'Serum', 'pg/mL', 200, 900, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 1000, FALSE),
  ('Folate', 'FOL', 'Biochemistry', 'Serum', 'ng/mL', 3, 17, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 900, FALSE),
  ('TSH', 'TSH', 'Endocrinology', 'Serum', 'µIU/mL', 0.4, 4, 0.1, 100, NULL, NULL, NULL, NULL, 'CLIA', 240, 300, FALSE),
  ('T3 (Total)', 'T3', 'Endocrinology', 'Serum', 'ng/dL', 80, 200, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 250, FALSE),
  ('T4 (Total)', 'T4', 'Endocrinology', 'Serum', 'µg/dL', 5, 12, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 250, FALSE),
  ('Free T3', 'FT3', 'Endocrinology', 'Serum', 'pg/mL', 2.3, 4.2, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 400, FALSE),
  ('Free T4', 'FT4', 'Endocrinology', 'Serum', 'ng/dL', 0.8, 1.8, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 400, FALSE),
  ('Anti-TPO Antibody', 'ATPO', 'Endocrinology', 'Serum', 'IU/mL', 0, 34, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 800, FALSE),
  ('Vitamin D (25-OH)', 'VITD', 'Endocrinology', 'Serum', 'ng/mL', 30, 100, 10, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 1200, FALSE),
  ('Serum Cortisol (Morning)', 'CORT', 'Endocrinology', 'Serum', 'µg/dL', 6, 23, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 800, FALSE),
  ('Prolactin', 'PRL', 'Endocrinology', 'Serum', 'ng/mL', 4, 25, NULL, NULL, 4, 15, 5, 25, 'CLIA', 1440, 600, FALSE),
  ('Beta hCG', 'BHCG', 'Endocrinology', 'Serum', 'mIU/mL', 0, 5, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 700, FALSE),
  ('PTH (Intact)', 'PTH', 'Endocrinology', 'Serum', 'pg/mL', 15, 65, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 1200, FALSE),
  ('FSH', 'FSH', 'Endocrinology', 'Serum', 'mIU/mL', 1.5, 12.5, NULL, NULL, 1.5, 12.4, 3.5, 12.5, 'CLIA', 1440, 500, FALSE),
  ('LH', 'LH', 'Endocrinology', 'Serum', 'mIU/mL', 1.7, 12.6, NULL, NULL, 1.7, 8.6, 2.4, 12.6, 'CLIA', 1440, 500, FALSE),
  ('Estradiol (E2)', 'E2', 'Endocrinology', 'Serum', 'pg/mL', 11, 123, NULL, NULL, 11, 44, 27, 123, 'CLIA', 1440, 600, FALSE),
  ('Progesterone', 'PROG', 'Endocrinology', 'Serum', 'ng/mL', 0.1, 0.9, NULL, NULL, 0.1, 0.8, 0.1, 0.9, 'CLIA', 1440, 600, FALSE),
  ('Testosterone (Total)', 'TESTO', 'Endocrinology', 'Serum', 'ng/dL', 8, 871, NULL, NULL, 240, 871, 8, 60, 'CLIA', 1440, 700, FALSE),
  ('DHEA-S', 'DHEAS', 'Endocrinology', 'Serum', 'µg/dL', 35, 560, NULL, NULL, 80, 560, 35, 430, 'CLIA', 1440, 900, FALSE),
  ('Anti-Mullerian Hormone (AMH)', 'AMH', 'Endocrinology', 'Serum', 'ng/mL', 1, 4, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 2880, 2000, FALSE),
  ('PSA (Total)', 'PSA', 'Tumour Markers', 'Serum', 'ng/mL', 0, 4, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 700, FALSE),
  ('PSA (Free)', 'FPSA', 'Tumour Markers', 'Serum', 'ng/mL', 0, 0.9, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 900, FALSE),
  ('Alpha Fetoprotein (AFP)', 'AFP', 'Tumour Markers', 'Serum', 'ng/mL', 0, 10, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 900, FALSE),
  ('CEA', 'CEA', 'Tumour Markers', 'Serum', 'ng/mL', 0, 5, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 900, FALSE),
  ('CA-125', 'CA125', 'Tumour Markers', 'Serum', 'U/mL', 0, 35, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 1200, FALSE),
  ('CA 19-9', 'CA199', 'Tumour Markers', 'Serum', 'U/mL', 0, 37, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 1400, FALSE),
  ('CA 15-3', 'CA153', 'Tumour Markers', 'Serum', 'U/mL', 0, 31.3, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 1400, FALSE),
  ('Troponin I', 'TROPI', 'Cardiac Markers', 'Serum', 'ng/mL', 0, 0.04, NULL, 0.04, NULL, NULL, NULL, NULL, 'CLIA', 60, 900, FALSE),
  ('CK-MB', 'CKMB', 'Cardiac Markers', 'Serum', 'ng/mL', 0, 5, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 120, 600, FALSE),
  ('NT-proBNP', 'NTBNP', 'Cardiac Markers', 'Serum', 'pg/mL', 0, 125, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 240, 1800, FALSE),
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
  ('Malaria Antigen (Rapid)', 'MPRDT', 'Serology', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochromatography', 60, 300, FALSE),
  ('Filaria Antigen', 'FILAG', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ICT Card', 240, 800, FALSE),
  ('Influenza A/B Rapid Antigen', 'FLUAG', 'Serology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochromatography', 60, 800, FALSE),
  ('Hepatitis A IgM', 'HAVM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 1440, 900, FALSE),
  ('Hepatitis E IgM', 'HEVM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 1440, 1200, FALSE),
  ('HBeAg', 'HBEAG', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 1440, 900, FALSE),
  ('Anti-HBs Titre', 'ANTIHBS', 'Serology', 'Serum', 'mIU/mL', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 800, FALSE),
  ('H. pylori Antibody', 'HPYLAB', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 1440, 700, FALSE),
  ('Toxoplasma IgM', 'TOXOM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 800, FALSE),
  ('Toxoplasma IgG', 'TOXOG', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 800, FALSE),
  ('Rubella IgG', 'RUBG', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 800, FALSE),
  ('CMV IgM', 'CMVM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 900, FALSE),
  ('Double Marker (First Trimester)', 'DUALM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA + Risk Algorithm', 2880, 2500, FALSE),
  ('Quadruple Marker', 'QUADM', 'Serology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA + Risk Algorithm', 2880, 3500, FALSE),
  ('ASO Titre', 'ASO', 'Immunology', 'Serum', 'IU/mL', 0, 200, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 240, 400, FALSE),
  ('Rheumatoid Factor', 'RA', 'Immunology', 'Serum', 'IU/mL', 0, 14, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 240, 400, FALSE),
  ('ANA (IF)', 'ANA', 'Immunology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Indirect Immunofluorescence', 1440, 1200, FALSE),
  ('Anti-CCP', 'ACCP', 'Immunology', 'Serum', 'U/mL', 0, 20, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 1500, FALSE),
  ('Anti-dsDNA', 'DSDNA', 'Immunology', 'Serum', 'IU/mL', 0, 30, NULL, NULL, NULL, NULL, NULL, NULL, 'ELISA', 1440, 1200, FALSE),
  ('Complement C3', 'C3', 'Immunology', 'Serum', 'mg/dL', 90, 180, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 1440, 800, FALSE),
  ('Complement C4', 'C4', 'Immunology', 'Serum', 'mg/dL', 10, 40, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 1440, 800, FALSE),
  ('ANCA (p-ANCA / c-ANCA)', 'ANCA', 'Immunology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Indirect Immunofluorescence', 2880, 1800, FALSE),
  ('Serum IgE (Total)', 'IGE', 'Immunology', 'Serum', 'IU/mL', 0, 100, NULL, NULL, NULL, NULL, NULL, NULL, 'CLIA', 1440, 900, FALSE),
  ('Blood Culture & Sensitivity', 'BCUL', 'Microbiology', 'Culture Bottle', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Automated BacT/ALERT', 4320, 1200, FALSE),
  ('Urine Culture & Sensitivity', 'UCUL', 'Microbiology', 'Urine', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Semi-quantitative Culture', 2880, 800, FALSE),
  ('Sputum Culture & Sensitivity', 'SCUL', 'Microbiology', 'Sputum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Culture', 2880, 800, FALSE),
  ('Pus / Wound Swab C&S', 'PSCUL', 'Microbiology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Culture', 2880, 800, FALSE),
  ('Stool Culture & Sensitivity', 'STCUL', 'Microbiology', 'Stool', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Culture', 2880, 800, FALSE),
  ('Gram Stain', 'GRAM', 'Microbiology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Gram Stain Microscopy', 120, 200, FALSE),
  ('Sputum AFB (ZN Stain)', 'AFB', 'Microbiology', 'Sputum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Ziehl-Neelsen', 240, 250, FALSE),
  ('GeneXpert MTB/RIF', 'XPERT', 'Microbiology', 'Sputum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Cartridge PCR', 1440, 2000, FALSE),
  ('KOH Mount', 'KOH', 'Microbiology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'KOH Wet Mount', 120, 250, FALSE),
  ('CSF Culture & Sensitivity', 'CSFCUL', 'Microbiology', 'CSF', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Culture', 2880, 900, FALSE),
  ('ET / Tracheal Aspirate C&S', 'ETCUL', 'Microbiology', 'Fluid', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Semi-quantitative Culture', 2880, 900, FALSE),
  ('Body Fluid Culture & Sensitivity', 'BFCUL', 'Microbiology', 'Fluid', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Culture', 2880, 900, FALSE),
  ('Throat Swab C&S', 'THRCUL', 'Microbiology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Culture', 2880, 700, FALSE),
  ('Fungal Culture', 'FUNCUL', 'Microbiology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'SDA Culture', 10080, 900, FALSE),
  ('COVID-19 Rapid Antigen', 'COVAG', 'Microbiology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochromatography', 60, 400, FALSE),
  ('Urine Routine & Microscopy', 'URM', 'Clinical Pathology', 'Urine', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Dipstick + Microscopy', 60, 150, FALSE),
  ('Urine Pregnancy Test', 'UPT', 'Clinical Pathology', 'Urine', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunochromatography', 30, 200, FALSE),
  ('Urine Ketones', 'UKET', 'Clinical Pathology', 'Urine', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Dipstick', 60, 100, FALSE),
  ('Urine Microalbumin', 'UMALB', 'Clinical Pathology', 'Urine', 'mg/L', 0, 30, NULL, NULL, NULL, NULL, NULL, NULL, 'Immunoturbidimetry', 240, 600, FALSE),
  ('Urine Protein/Creatinine Ratio', 'UPCR', 'Clinical Pathology', 'Urine', 'mg/g', 0, 150, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 240, 600, FALSE),
  ('24 Hour Urine Protein', 'U24P', 'Clinical Pathology', 'Urine', 'mg/24h', 0, 150, NULL, NULL, NULL, NULL, NULL, NULL, 'Pyrogallol Red', 1440, 600, FALSE),
  ('Urine Albumin/Creatinine Ratio', 'UACR', 'Clinical Pathology', 'Urine', 'mg/g', 0, 30, NULL, NULL, NULL, NULL, NULL, NULL, 'Calculated', 240, 700, FALSE),
  ('Spot Urine Sodium', 'USNA', 'Clinical Pathology', 'Urine', 'mEq/L', 20, 220, NULL, NULL, NULL, NULL, NULL, NULL, 'ISE', 240, 250, FALSE),
  ('Spot Urine Creatinine', 'USCR', 'Clinical Pathology', 'Urine', 'mg/dL', 20, 320, NULL, NULL, NULL, NULL, NULL, NULL, 'Jaffe Kinetic', 240, 200, FALSE),
  ('Stool Routine Examination', 'STRM', 'Clinical Pathology', 'Stool', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Microscopy', 120, 200, FALSE),
  ('Stool for Ova & Cyst', 'STOC', 'Clinical Pathology', 'Stool', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Saline & Iodine Mount', 120, 250, FALSE),
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
  ('COVID-19 RT-PCR', 'COVPCR', 'Molecular Biology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Real-Time PCR', 1440, 500, FALSE),
  ('HBV DNA Viral Load', 'HBVVL', 'Molecular Biology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Real-Time PCR', 4320, 4000, FALSE),
  ('HCV RNA Viral Load', 'HCVVL', 'Molecular Biology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Real-Time PCR', 4320, 4500, FALSE),
  ('HIV-1 RNA Viral Load', 'HIVVL', 'Molecular Biology', 'Serum', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Real-Time PCR', 4320, 4500, FALSE),
  ('HPV DNA (High Risk)', 'HPVDNA', 'Molecular Biology', 'Swab', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Real-Time PCR', 4320, 3000, FALSE),
  ('Karyotyping', 'KARYO', 'Genetics', 'Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'G-Banding', 20160, 5000, FALSE),
  ('Thalassaemia Mutation Panel', 'THALMUT', 'Genetics', 'EDTA Blood', 'report', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'PCR-ARMS / Sequencing', 20160, 6000, FALSE),
  ('Serum Lithium', 'LI', 'Therapeutic Drug Monitoring', 'Serum', 'mEq/L', 0.6, 1.2, NULL, 1.5, NULL, NULL, NULL, NULL, 'ISE', 240, 800, FALSE),
  ('Serum Phenytoin', 'PHT', 'Therapeutic Drug Monitoring', 'Serum', 'µg/mL', 10, 20, NULL, 30, NULL, NULL, NULL, NULL, 'CLIA', 480, 900, FALSE),
  ('Serum Valproate', 'VPA', 'Therapeutic Drug Monitoring', 'Serum', 'µg/mL', 50, 100, NULL, 150, NULL, NULL, NULL, NULL, 'CLIA', 480, 900, FALSE),
  ('Vancomycin (Trough)', 'VANCO', 'Therapeutic Drug Monitoring', 'Serum', 'µg/mL', 10, 20, NULL, 30, NULL, NULL, NULL, NULL, 'CLIA', 480, 1200, FALSE),
  ('Serum Digoxin', 'DIGX', 'Therapeutic Drug Monitoring', 'Serum', 'ng/mL', 0.8, 2, NULL, 2.5, NULL, NULL, NULL, NULL, 'CLIA', 480, 900, FALSE);

TRUNCATE public.lab_test_group_catalog_default;
INSERT INTO public.lab_test_group_catalog_default
  (group_name, group_code, category, fee, tat_minutes, members)
VALUES
  ('Complete Blood Count', 'CBCP', 'Haematology', 350, 120, ARRAY['Haemoglobin', 'Total Leucocyte Count', 'Differential Leucocyte Count', 'Platelet Count', 'RBC Count', 'PCV / Haematocrit', 'MCV', 'MCH', 'MCHC', 'RDW']::text[]),
  ('Liver Function Test', 'LFTP', 'Biochemistry', 700, 120, ARRAY['SGOT (AST)', 'SGPT (ALT)', 'Alkaline Phosphatase', 'GGT', 'Bilirubin Total', 'Bilirubin Direct', 'Bilirubin Indirect', 'Total Protein', 'Albumin', 'Globulin', 'A:G Ratio']::text[]),
  ('Kidney Function Test', 'KFTP', 'Biochemistry', 700, 120, ARRAY['Serum Creatinine', 'Blood Urea', 'Blood Urea Nitrogen', 'Uric Acid', 'eGFR', 'Serum Sodium', 'Serum Potassium', 'Serum Chloride']::text[]),
  ('Lipid Profile', 'LIPIDP', 'Biochemistry', 600, 120, ARRAY['Total Cholesterol', 'HDL Cholesterol', 'LDL Cholesterol', 'VLDL Cholesterol', 'Triglycerides']::text[]),
  ('Serum Electrolytes', 'ELECP', 'Biochemistry', 400, 60, ARRAY['Serum Sodium', 'Serum Potassium', 'Serum Chloride', 'Serum Bicarbonate']::text[]),
  ('Thyroid Profile', 'TFT', 'Endocrinology', 600, 240, ARRAY['TSH', 'T3 (Total)', 'T4 (Total)']::text[]),
  ('Pre-Operative Screening', 'PREOP', 'Serology', 1400, 240, ARRAY['HIV I & II', 'HBsAg', 'Anti-HCV', 'VDRL / RPR']::text[]),
  ('Fever Panel', 'FEVER', 'Serology', 1500, 240, ARRAY['Haemoglobin', 'Total Leucocyte Count', 'Differential Leucocyte Count', 'Platelet Count', 'Malaria Antigen (Rapid)', 'Dengue NS1 Antigen', 'Widal Test', 'Blood Sugar Random']::text[]);

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

-- ── 4. Legacy lowercase sample types ───────────────────────────────────────
-- MUST run before repair_lab_catalog_for_hospital() below, or that function raises:
--
--   ERROR: Lab test "ECG": sample type "other" is not a configured sample type
--
-- The repair updates ONLY `category` on the ECG row, but trg_validate_lab_test_vocabulary
-- is BEFORE UPDATE OF category, sample_type and validates the WHOLE new row — so it also
-- checks sample_type. The legacy seed wrote lowercase 'other'/'blood'/'urine', none of
-- which is in the sample_types list (which holds Title Case). A row that was ALREADY
-- invalid therefore blocks an update to a different column.
--
-- Latent, not new. The estate-wide ECG update in 20261102000002 ran at its step 3, BEFORE
-- that migration created the trigger at step 6; and the only other caller of the repair,
-- trg_seed_hospital_defaults, invokes it under the skip_lab_vocab_check bypass. This
-- migration is simply the first to call the repair on an existing legacy tenant with the
-- trigger live.
--
-- This lives HERE rather than in the companion prep migration deliberately: a failed
-- push may have already applied and recorded the prep migration, and Supabase never
-- re-runs a recorded version. The fix has to sit in the migration that actually fails.
--
-- Categories are deliberately NOT normalised here. The repair identifies a row the
-- hospital has never curated BY its lowercase category, so canonicalising categories now
-- would make the repair skip every legacy row and leave the wrong reference ranges in
-- place. They are normalised afterwards, in the tenant-repair companion.
DO $$
DECLARE
  v_fixed  INTEGER;
  v_orphan RECORD;
BEGIN
  -- Same transaction-local escape hatch trg_seed_hospital_defaults uses, and for the same
  -- reason: these rows are mid-repair and their category is still legacy on purpose.
  -- Every value written below IS in the sample_types list, so nothing invalid gets in.
  PERFORM set_config('aumrti.skip_lab_vocab_check', 'on', TRUE);

  UPDATE public.lab_test_master m
     SET sample_type = v.canonical
    FROM (VALUES
      ('blood','Blood'), ('edta blood','EDTA Blood'), ('fluoride blood','Fluoride Blood'),
      ('citrate blood','Citrate Blood'), ('arterial blood','Arterial Blood'),
      ('serum','Serum'), ('plasma','Serum'), ('urine','Urine'), ('stool','Stool'),
      ('swab','Swab'), ('sputum','Sputum'), ('csf','CSF'), ('fluid','Fluid'),
      ('biopsy','Biopsy'), ('tissue','Biopsy'), ('semen','Semen'),
      ('culture bottle','Culture Bottle'), ('other','Other')
    ) AS v(legacy, canonical)
   WHERE LOWER(TRIM(m.sample_type)) = v.legacy
     AND m.sample_type <> v.canonical;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  PERFORM set_config('aumrti.skip_lab_vocab_check', 'off', TRUE);
  RAISE NOTICE 'lab catalogue: normalised sample_type on % legacy row(s).', v_fixed;

  -- Anything still outside the list would fail the trigger on the next edit to that row,
  -- so name it now rather than let it surface as a migration error months from now.
  FOR v_orphan IN
    SELECT DISTINCT m.sample_type
      FROM public.lab_test_master m
     WHERE NOT EXISTS (
       SELECT 1 FROM public.hospital_config_values c
        WHERE c.category = 'sample_types' AND c.value = m.sample_type
          AND (c.hospital_id IS NULL OR c.hospital_id = m.hospital_id)
     )
  LOOP
    RAISE WARNING 'lab catalogue: sample type "%" is not in the sample_types list — any '
      'future edit to that row''s category or sample type will be rejected.', v_orphan.sample_type;
  END LOOP;
END$$;

-- ── 5. Apply the catalogue to every existing hospital ──────────────────────
-- Without this loop the migration would only refresh lab_test_catalog_default — the
-- platform reference table — and no tenant would ever see the change. All three
-- functions are idempotent, so re-running is safe.
--
-- repair BEFORE seed: repair renames legacy rows ('CBC' -> 'Complete Blood Count')
-- onto canonical names, and seed's ON CONFLICT (hospital_id, test_name) then skips
-- them instead of inserting a duplicate under the canonical name.
DO $$
DECLARE
  v_hosp    RECORD;
  v_seeded  INTEGER := 0;
  v_groups  INTEGER := 0;
BEGIN
  FOR v_hosp IN SELECT id FROM public.hospitals LOOP
    PERFORM public.repair_lab_catalog_for_hospital(v_hosp.id);
    v_seeded := v_seeded + public.seed_lab_catalog_for_hospital(v_hosp.id);
    v_groups := v_groups + public.seed_lab_groups_for_hospital(v_hosp.id);
  END LOOP;
  RAISE NOTICE 'lab catalogue 20261104000002_lab_test_catalog_v3: added % test(s), % group(s).', v_seeded, v_groups;
END$$;

-- ── 6. Retire tests that do not belong in a laboratory catalogue ───────────
-- Deactivated, never deleted: historical lab_order_items reference these rows, and
-- dropping tenant data in a production migration is forbidden.
--
-- Runs AFTER the repair loop above, which is what makes it effective on legacy
-- tenants: a row still named 'CBC' is renamed to 'Complete Blood Count' by the repair
-- and only then matches the retirement below. Retiring first would miss it entirely.
-- A cardiac diagnostic procedure, not a laboratory test. Ordering it through the lab pipeline made investigationSync mint an "other" specimen and print a barcode for a patient from whom nothing is ever drawn. Belongs in the procedure/service master.
UPDATE public.lab_test_master SET is_active = FALSE WHERE test_name = 'ECG';

-- Replaced by the identically named group, which expands into its ten analytes so each one carries its own reference interval and flag.
UPDATE public.lab_test_master SET is_active = FALSE WHERE test_name = 'Complete Blood Count';

-- Replaced by the identically named group (11 analytes).
UPDATE public.lab_test_master SET is_active = FALSE WHERE test_name = 'Liver Function Test';

-- Replaced by the identically named group (8 analytes).
UPDATE public.lab_test_master SET is_active = FALSE WHERE test_name = 'Kidney Function Test';

-- Replaced by the identically named group (5 analytes).
UPDATE public.lab_test_master SET is_active = FALSE WHERE test_name = 'Lipid Profile';

-- Replaced by the identically named group (Na, K, Cl, HCO3).
UPDATE public.lab_test_master SET is_active = FALSE WHERE test_name = 'Serum Electrolytes';
