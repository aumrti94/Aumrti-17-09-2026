// ─────────────────────────────────────────────────────────────────────────────
// Canonical lab test catalogue — the SINGLE source of truth.
//
// Before this file existed there were three catalogues that disagreed with each
// other: the hospital seed inside 20260613110000_seed_hospital_defaults.sql, the
// QA fixture in e2e/fixtures/mock-data.json, and a hardcoded category/sample list
// inside BulkLabTestImportModal.tsx. Blood Urea was 7-25 in one and 15-40 in
// another; TSH was 0.5-5.0 in one and 0.4-4.0 in another. A QA suite that is green
// against the wrong numbers is worse than no suite at all.
//
// Everything downstream now derives from THIS array:
//   • supabase/migrations/*_lab_test_catalog_v*.sql   (generated — do not hand-edit)
//   • e2e/fixtures/mock-data.json → labTests          (generated — do not hand-edit)
// Regenerate both with:  node scripts/generate-lab-catalog.mjs
// CI verifies they are in sync with:  npm run check:lab-catalog
//
// ⚠ CHANGING THIS FILE REQUIRES BUMPING CATALOG_VERSION in generate-lab-catalog.mjs.
// The generator used to overwrite an ALREADY-APPLIED migration. Supabase skips applied
// versions, so a corrected reference range was written to disk, passed CI, and never
// reached a live database. A new version is what makes the edit land.
//
// ── Rules this catalogue enforces (see labTestCatalog.test.ts) ────────────────
//  1. `category` and `sampleType` MUST be members of the unions below, which
//     mirror the hospital_config_values lists. The old seed used lowercase values
//     ('hematology', 'urine', 'cardiology') that were not in the dropdown at all,
//     so the category filter matched nothing and the dual-validation gate in
//     LabResultWorkspace — which compares test_category exactly — could never fire.
//  2. A critical value is a PANIC value: a result that means someone must be
//     telephoned. Red-cell indices (MCV/MCH/MCHC/RDW), ESR, CRP and HbA1c do not
//     have one. Inventing thresholds for them is pure alert fatigue, and Dr.
//     Ramesh's rule is explicit — more alerts is NOT better.
//  3. Where an interval genuinely differs by sex (Hb, RBC, PCV, creatinine, uric
//     acid, ESR, GGT, ferritin, iron, CPK, prolactin), the sex-specific columns
//     are populated. `normalMin/Max` stays as the sex-unknown fallback ONLY.
//     Merging both sexes into one wide band is how a male at 12.5 g/dL — anaemic —
//     reads as Normal.
//  4. Every test carries a non-zero fee, a sample type and a TAT. A test at ₹0
//     produces an order that bills nothing and leaks revenue with no error
//     anywhere (asserted by TC-P5L-001).
//  5. Qualitative tests carry unit 'report' and no ranges, matching the Unit Field
//     Guide the settings page itself shows the user. This also covers analytes that are
//     quantitative but have no reference INTERVAL — a viral load's target is "not
//     detected", and inventing a band would flag every suppressed patient.
//  6. A PANEL IS A GROUP, NEVER A ROW. CBC, LFT, KFT, Lipid Profile and Electrolytes
//     used to be both, at the same price: two billable paths to identical work, and the
//     row version returned one unitless blob so no analyte inside it could carry a flag,
//     a delta check or an autoverify decision. See LAB_TEST_RETIRED.
//
// Reference intervals are adult values as reported by Indian hospital labs
// (NABL / ISO 15189 practice). Paediatric and pregnancy-specific intervals are
// deliberately NOT modelled here — a hospital tunes those per test, and the
// repair migration preserves any row a hospital has already edited.
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors hospital_config_values.category = 'lab_test_categories'. */
export const LAB_TEST_CATEGORIES = [
  'Haematology',
  'Coagulation',
  'Biochemistry',
  'Endocrinology',
  'Cardiac Markers',
  'Tumour Markers',
  'Serology',
  'Immunology',
  'Microbiology',
  // 'Genetics' is human genetic testing — karyotype, thalassaemia mutation panel.
  // An infectious PCR (COVID, HBV viral load) is not genetics, and filing it there put
  // a swab result in the same reporting bucket as a hereditary disease diagnosis.
  'Molecular Biology',
  'Clinical Pathology',
  'Histopathology',
  'Cytology',
  'Genetics',
  'Therapeutic Drug Monitoring',
  'Other',
] as const;

/**
 * Mirrors hospital_config_values.category = 'sample_types'.
 *
 * Deliberately tube-level, not just 'Blood'. investigationSync.ts creates ONE
 * specimen per distinct sample_type on an order — that is correct, but only if the
 * values distinguish tubes. A CBC (EDTA) and a fasting sugar (fluoride) are two
 * separate draws; collapsing both to 'Blood' would print one barcode for two tubes
 * and the phlebotomist would be a tube short at the bedside.
 */
export const LAB_SAMPLE_TYPES = [
  'Blood',
  'EDTA Blood',
  'Fluoride Blood',
  'Citrate Blood',
  // An ABG is a heparinised arterial syringe drawn by a different person, from a
  // different site, and it must reach the analyser within minutes. Collapsing it into
  // 'Blood' would group it with the venous draw and print one barcode for two
  // specimens — the phlebotomist arrives at the bedside a tube short.
  'Arterial Blood',
  'Serum',
  'Urine',
  'Stool',
  'Swab',
  'Sputum',
  'CSF',
  'Fluid',
  'Biopsy',
  'Semen',
  'Culture Bottle',
  'Other',
] as const;

export type LabTestCategory = (typeof LAB_TEST_CATEGORIES)[number];
export type LabSampleType = (typeof LAB_SAMPLE_TYPES)[number];

export interface LabTestCatalogEntry {
  name: string;
  code: string;
  category: LabTestCategory;
  sampleType: LabSampleType;
  /** 'report' for qualitative tests. Micro sign is always U+00B5 (µ), never Greek mu. */
  unit: string;
  /** Sex-unknown fallback interval. null/null = qualitative. */
  normalMin: number | null;
  normalMax: number | null;
  /** Panic values. null unless a result at this level means someone gets telephoned. */
  criticalLow: number | null;
  criticalHigh: number | null;
  maleNormalMin?: number;
  maleNormalMax?: number;
  femaleNormalMin?: number;
  femaleNormalMax?: number;
  method?: string;
  tatMinutes: number;
  /** Indicative Tier-2 Indian hospital rate in ₹. Hospitals re-price on go-live. */
  fee: number;
  /** Only stable, well-validated analytes. Abnormal/critical/delta always need a human. */
  autoverifyEligible?: boolean;
}

const R = 'report';

export const LAB_TEST_CATALOG: LabTestCatalogEntry[] = [
  // ── Haematology ────────────────────────────────────────────────────────────
  // 'Complete Blood Count' is NOT a row here — it is a GROUP (see LAB_TEST_GROUP_CATALOG)
  // that expands into the ten analytes below. As a single row it carried unit 'report'
  // and one value field, so a CBC produced one unitless blob: no per-analyte H/L flag,
  // no delta check, no autoverify, no trend graph. See LAB_TEST_RETIRED.
  // Sex-specific: a male at 12.5 g/dL is anaemic. The old merged 12.0-17.5 band called him normal.
  { name: 'Haemoglobin', code: 'HB', category: 'Haematology', sampleType: 'EDTA Blood', unit: 'g/dL', normalMin: 12.0, normalMax: 17.0, criticalLow: 7.0, criticalHigh: 20.0, maleNormalMin: 13.0, maleNormalMax: 17.0, femaleNormalMin: 12.0, femaleNormalMax: 15.0, method: 'Photometric', tatMinutes: 60, fee: 120, autoverifyEligible: true },
  { name: 'Total Leucocyte Count', code: 'TLC', category: 'Haematology', sampleType: 'EDTA Blood', unit: 'x10^3/µL', normalMin: 4.0, normalMax: 11.0, criticalLow: 2.0, criticalHigh: 30.0, method: 'Impedance', tatMinutes: 60, fee: 120, autoverifyEligible: true },
  { name: 'Differential Leucocyte Count', code: 'DLC', category: 'Haematology', sampleType: 'EDTA Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Microscopy / Flow', tatMinutes: 60, fee: 130 },
  // ANC < 500 is severe neutropenia — a genuine panic value, and the trigger for
  // neutropenic-sepsis protocol. This is the one differential-derived number that earns an alert.
  { name: 'Absolute Neutrophil Count', code: 'ANC', category: 'Haematology', sampleType: 'EDTA Blood', unit: '/µL', normalMin: 2000, normalMax: 7000, criticalLow: 500, criticalHigh: null, method: 'Calculated', tatMinutes: 60, fee: 150 },
  { name: 'Platelet Count', code: 'PLT', category: 'Haematology', sampleType: 'EDTA Blood', unit: 'x10^3/µL', normalMin: 150, normalMax: 400, criticalLow: 50, criticalHigh: 1000, method: 'Impedance', tatMinutes: 60, fee: 130, autoverifyEligible: true },
  { name: 'RBC Count', code: 'RBC', category: 'Haematology', sampleType: 'EDTA Blood', unit: 'x10^6/µL', normalMin: 3.8, normalMax: 5.9, criticalLow: 2.0, criticalHigh: 7.0, maleNormalMin: 4.5, maleNormalMax: 5.9, femaleNormalMin: 3.8, femaleNormalMax: 5.2, method: 'Impedance', tatMinutes: 60, fee: 120 },
  { name: 'PCV / Haematocrit', code: 'PCV', category: 'Haematology', sampleType: 'EDTA Blood', unit: '%', normalMin: 36.0, normalMax: 50.0, criticalLow: 20.0, criticalHigh: 60.0, maleNormalMin: 40.0, maleNormalMax: 50.0, femaleNormalMin: 36.0, femaleNormalMax: 46.0, method: 'Calculated', tatMinutes: 60, fee: 120 },
  // Red-cell indices: no panic value exists. The old seed invented 60/120, 15/45 and
  // 20/40 — every microcytic anaemia fired a phone-the-doctor alert.
  { name: 'MCV', code: 'MCV', category: 'Haematology', sampleType: 'EDTA Blood', unit: 'fL', normalMin: 80.0, normalMax: 100.0, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 60, fee: 100 },
  { name: 'MCH', code: 'MCH', category: 'Haematology', sampleType: 'EDTA Blood', unit: 'pg', normalMin: 27.0, normalMax: 33.0, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 60, fee: 100 },
  { name: 'MCHC', code: 'MCHC', category: 'Haematology', sampleType: 'EDTA Blood', unit: 'g/dL', normalMin: 32.0, normalMax: 36.0, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 60, fee: 100 },
  { name: 'RDW', code: 'RDW', category: 'Haematology', sampleType: 'EDTA Blood', unit: '%', normalMin: 11.5, normalMax: 14.5, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 60, fee: 100 },
  // Westergren ESR is sex-specific and has no panic value.
  { name: 'ESR', code: 'ESR', category: 'Haematology', sampleType: 'EDTA Blood', unit: 'mm/hr', normalMin: 0, normalMax: 20, criticalLow: null, criticalHigh: null, maleNormalMin: 0, maleNormalMax: 15, femaleNormalMin: 0, femaleNormalMax: 20, method: 'Westergren', tatMinutes: 60, fee: 120 },
  { name: 'Reticulocyte Count', code: 'RETIC', category: 'Haematology', sampleType: 'EDTA Blood', unit: '%', normalMin: 0.5, normalMax: 2.5, criticalLow: null, criticalHigh: null, method: 'Supravital Stain', tatMinutes: 120, fee: 200 },
  { name: 'Peripheral Smear Examination', code: 'PS', category: 'Haematology', sampleType: 'EDTA Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Leishman Stain Microscopy', tatMinutes: 240, fee: 250 },
  // labSampleIntegrity.ts has a BLOOD_GROUP_TEST regex for wrong-blood-in-tube
  // detection that had nothing to match — this row is what switches that check on.
  { name: 'Blood Group & Rh Typing', code: 'ABORH', category: 'Haematology', sampleType: 'EDTA Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Slide / Tube Agglutination', tatMinutes: 60, fee: 150 },
  // The SMEAR stays in haematology — it is a stained slide read down a microscope.
  // The rapid ANTIGEN test moved to Serology: it is the same immunochromatographic
  // strip as Dengue NS1, which was already filed there.
  { name: 'Malaria Parasite (Smear)', code: 'MPS', category: 'Haematology', sampleType: 'EDTA Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Thick & Thin Smear', tatMinutes: 60, fee: 150 },
  { name: 'Absolute Eosinophil Count', code: 'AEC', category: 'Haematology', sampleType: 'EDTA Blood', unit: '/µL', normalMin: 40, normalMax: 440, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 60, fee: 150 },
  // Sickle-cell and thalassaemia screening is an NHM national programme (Sickle Cell
  // Elimination Mission 2047) and a routine antenatal screen. Their absence was the
  // single largest coverage gap in the catalogue for a district hospital.
  { name: 'Haemoglobin Electrophoresis (HPLC)', code: 'HBELP', category: 'Haematology', sampleType: 'EDTA Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Cation-Exchange HPLC', tatMinutes: 2880, fee: 1500 },
  { name: 'Sickling / Solubility Test', code: 'SICKL', category: 'Haematology', sampleType: 'EDTA Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Sodium Metabisulphite', tatMinutes: 120, fee: 250 },
  { name: 'G6PD (Quantitative)', code: 'G6PD', category: 'Haematology', sampleType: 'EDTA Blood', unit: 'U/g Hb', normalMin: 6.8, normalMax: 13.9, criticalLow: null, criticalHigh: null, method: 'Enzymatic Kinetic', tatMinutes: 1440, fee: 900 },
  // Coombs stays in the LAB, not the Blood Bank module: DCT is ordered to work up a
  // haemolytic anaemia and ICT for antenatal Rh antibody screening — neither involves
  // issuing a unit. Cross-match and antibody identification remain with Blood Bank so
  // a transfusion has exactly one system of record.
  { name: 'Coombs Test Direct (DCT)', code: 'DCT', category: 'Haematology', sampleType: 'EDTA Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Column Agglutination', tatMinutes: 120, fee: 400 },
  { name: 'Coombs Test Indirect (ICT)', code: 'ICT', category: 'Haematology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Column Agglutination', tatMinutes: 120, fee: 400 },

  // ── Coagulation ────────────────────────────────────────────────────────────
  // PT and INR were one row ('PT / INR', unit 'INR') in the old seed — two different
  // results in seconds and as a ratio, sharing one value field. Split.
  { name: 'Prothrombin Time', code: 'PT', category: 'Coagulation', sampleType: 'Citrate Blood', unit: 'seconds', normalMin: 11.0, normalMax: 13.5, criticalLow: null, criticalHigh: null, method: 'Coagulometry', tatMinutes: 120, fee: 250 },
  { name: 'INR', code: 'INR', category: 'Coagulation', sampleType: 'Citrate Blood', unit: 'ratio', normalMin: 0.8, normalMax: 1.2, criticalLow: null, criticalHigh: 5.0, method: 'Calculated', tatMinutes: 120, fee: 200 },
  { name: 'aPTT', code: 'APTT', category: 'Coagulation', sampleType: 'Citrate Blood', unit: 'seconds', normalMin: 25.0, normalMax: 35.0, criticalLow: null, criticalHigh: 100.0, method: 'Coagulometry', tatMinutes: 120, fee: 300 },
  { name: 'D-Dimer', code: 'DDIM', category: 'Coagulation', sampleType: 'Citrate Blood', unit: 'µg/mL FEU', normalMin: 0.0, normalMax: 0.5, criticalLow: null, criticalHigh: null, method: 'Immunoturbidimetry', tatMinutes: 240, fee: 900 },
  { name: 'Fibrinogen', code: 'FIB', category: 'Coagulation', sampleType: 'Citrate Blood', unit: 'mg/dL', normalMin: 200, normalMax: 400, criticalLow: 100, criticalHigh: null, method: 'Clauss', tatMinutes: 240, fee: 700 },
  { name: 'Bleeding Time', code: 'BT', category: 'Coagulation', sampleType: 'Blood', unit: 'minutes', normalMin: 2.0, normalMax: 7.0, criticalLow: null, criticalHigh: null, method: 'Duke', tatMinutes: 60, fee: 100 },
  { name: 'Clotting Time', code: 'CT', category: 'Coagulation', sampleType: 'Blood', unit: 'minutes', normalMin: 4.0, normalMax: 9.0, criticalLow: null, criticalHigh: null, method: 'Capillary Tube', tatMinutes: 60, fee: 100 },

  // ── Biochemistry — Liver ───────────────────────────────────────────────────
  // 'Liver Function Test' is a GROUP, not a row — same reason as CBC. See LAB_TEST_RETIRED.
  // Transaminase ULN is sex-specific — a woman at 38 U/L is abnormal and was reading
  // Normal against the merged 0-40 band, the same defect already fixed on haemoglobin.
  { name: 'SGOT (AST)', code: 'SGOT', category: 'Biochemistry', sampleType: 'Serum', unit: 'U/L', normalMin: 0, normalMax: 40, criticalLow: null, criticalHigh: 500, maleNormalMin: 0, maleNormalMax: 40, femaleNormalMin: 0, femaleNormalMax: 32, method: 'IFCC Kinetic', tatMinutes: 120, fee: 150 },
  { name: 'SGPT (ALT)', code: 'SGPT', category: 'Biochemistry', sampleType: 'Serum', unit: 'U/L', normalMin: 0, normalMax: 41, criticalLow: null, criticalHigh: 500, maleNormalMin: 0, maleNormalMax: 41, femaleNormalMin: 0, femaleNormalMax: 33, method: 'IFCC Kinetic', tatMinutes: 120, fee: 150 },
  // 44-147 is a US reference range. Indian NABL labs running IFCC report 40-129 (M) and
  // 35-104 (F); the old ceiling let a raised ALP in a woman pass as normal.
  { name: 'Alkaline Phosphatase', code: 'ALP', category: 'Biochemistry', sampleType: 'Serum', unit: 'U/L', normalMin: 35, normalMax: 129, criticalLow: null, criticalHigh: null, maleNormalMin: 40, maleNormalMax: 129, femaleNormalMin: 35, femaleNormalMax: 104, method: 'IFCC PNPP Kinetic', tatMinutes: 120, fee: 150 },
  { name: 'GGT', code: 'GGT', category: 'Biochemistry', sampleType: 'Serum', unit: 'U/L', normalMin: 6, normalMax: 71, criticalLow: null, criticalHigh: null, maleNormalMin: 10, maleNormalMax: 71, femaleNormalMin: 6, femaleNormalMax: 42, method: 'Kinetic', tatMinutes: 120, fee: 200 },
  { name: 'Bilirubin Total', code: 'TBIL', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 0.2, normalMax: 1.2, criticalLow: null, criticalHigh: 15.0, method: 'Diazo', tatMinutes: 120, fee: 120 },
  { name: 'Bilirubin Direct', code: 'DBIL', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 0.0, normalMax: 0.3, criticalLow: null, criticalHigh: null, method: 'Diazo', tatMinutes: 120, fee: 120 },
  { name: 'Bilirubin Indirect', code: 'IBIL', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 0.1, normalMax: 0.9, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 120, fee: 120 },
  { name: 'Total Protein', code: 'TP', category: 'Biochemistry', sampleType: 'Serum', unit: 'g/dL', normalMin: 6.0, normalMax: 8.3, criticalLow: null, criticalHigh: null, method: 'Biuret', tatMinutes: 120, fee: 120 },
  // Albumin is not on the standard panic list. A chronic liver or nephrotic patient
  // lives at 2.0 g/dL for months; it is managed in clinic, not telephoned at night.
  { name: 'Albumin', code: 'ALB', category: 'Biochemistry', sampleType: 'Serum', unit: 'g/dL', normalMin: 3.5, normalMax: 5.0, criticalLow: null, criticalHigh: null, method: 'BCG', tatMinutes: 120, fee: 120 },
  { name: 'Globulin', code: 'GLOB', category: 'Biochemistry', sampleType: 'Serum', unit: 'g/dL', normalMin: 2.0, normalMax: 3.5, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 120, fee: 120 },
  { name: 'A:G Ratio', code: 'AGR', category: 'Biochemistry', sampleType: 'Serum', unit: 'ratio', normalMin: 1.0, normalMax: 2.5, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 120, fee: 100 },

  // ── Biochemistry — Kidney & minerals ───────────────────────────────────────
  // 'Kidney Function Test' is a GROUP, not a row. See LAB_TEST_RETIRED.
  // Critical high was 10.0 — a creatinine of 8 mg/dL is dialysis territory and fired
  // no alert at all. 5.0 is the conventional panic threshold.
  { name: 'Serum Creatinine', code: 'CREAT', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 0.6, normalMax: 1.3, criticalLow: null, criticalHigh: 5.0, maleNormalMin: 0.7, maleNormalMax: 1.3, femaleNormalMin: 0.6, femaleNormalMax: 1.1, method: 'Jaffe Kinetic', tatMinutes: 120, fee: 150 },
  // 7-25 was the BUN interval mislabelled as urea (BUN x 2.14 = urea). Indian labs
  // report urea, so every normal Indian result was flagging High.
  { name: 'Blood Urea', code: 'BU', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 15, normalMax: 40, criticalLow: null, criticalHigh: 200, method: 'Urease GLDH', tatMinutes: 120, fee: 130 },
  { name: 'Blood Urea Nitrogen', code: 'BUN', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 7, normalMax: 20, criticalLow: null, criticalHigh: 100, method: 'Calculated', tatMinutes: 120, fee: 130 },
  { name: 'Uric Acid', code: 'UA', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 2.4, normalMax: 7.0, criticalLow: null, criticalHigh: 13.0, maleNormalMin: 3.4, maleNormalMax: 7.0, femaleNormalMin: 2.4, femaleNormalMax: 6.0, method: 'Uricase', tatMinutes: 120, fee: 150 },
  // eGFR is CALCULATED FROM the creatinine on the same draw, which already pages at
  // 5.0 mg/dL. A panic value here is the same phone call placed twice.
  { name: 'eGFR', code: 'EGFR', category: 'Biochemistry', sampleType: 'Serum', unit: 'mL/min/1.73m^2', normalMin: 90, normalMax: null, criticalLow: null, criticalHigh: null, method: 'CKD-EPI Calculated', tatMinutes: 120, fee: 100 },
  { name: 'Serum Calcium', code: 'CA', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 8.5, normalMax: 10.5, criticalLow: 6.5, criticalHigh: 13.0, method: 'Arsenazo III', tatMinutes: 120, fee: 150 },
  { name: 'Ionised Calcium', code: 'ICA', category: 'Biochemistry', sampleType: 'Serum', unit: 'mmol/L', normalMin: 1.12, normalMax: 1.32, criticalLow: 0.8, criticalHigh: 1.6, method: 'ISE', tatMinutes: 120, fee: 400 },
  { name: 'Serum Phosphorus', code: 'PHOS', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 2.5, normalMax: 4.5, criticalLow: 1.0, criticalHigh: null, method: 'Phosphomolybdate', tatMinutes: 120, fee: 150 },
  { name: 'Serum Magnesium', code: 'MG', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 1.7, normalMax: 2.2, criticalLow: 1.0, criticalHigh: 4.9, method: 'Xylidyl Blue', tatMinutes: 120, fee: 250 },

  // ── Biochemistry — Electrolytes ────────────────────────────────────────────
  // 'Serum Electrolytes' is a GROUP, not a row. See LAB_TEST_RETIRED.
  { name: 'Serum Sodium', code: 'NA', category: 'Biochemistry', sampleType: 'Serum', unit: 'mEq/L', normalMin: 136, normalMax: 145, criticalLow: 120, criticalHigh: 160, method: 'ISE', tatMinutes: 60, fee: 150 },
  { name: 'Serum Potassium', code: 'K', category: 'Biochemistry', sampleType: 'Serum', unit: 'mEq/L', normalMin: 3.5, normalMax: 5.0, criticalLow: 2.5, criticalHigh: 6.5, method: 'ISE', tatMinutes: 60, fee: 150 },
  { name: 'Serum Chloride', code: 'CL', category: 'Biochemistry', sampleType: 'Serum', unit: 'mEq/L', normalMin: 98, normalMax: 107, criticalLow: 80, criticalHigh: 120, method: 'ISE', tatMinutes: 60, fee: 150 },
  { name: 'Serum Bicarbonate', code: 'HCO3', category: 'Biochemistry', sampleType: 'Serum', unit: 'mEq/L', normalMin: 22, normalMax: 28, criticalLow: 10, criticalHigh: 40, method: 'Enzymatic', tatMinutes: 60, fee: 200 },

  // ── Biochemistry — Critical care ───────────────────────────────────────────
  // The whole of this block was missing, which is why an ICU could not order a gas or a
  // lactate through the system at all.
  { name: 'Arterial Blood Gas', code: 'ABG', category: 'Biochemistry', sampleType: 'Arterial Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Blood Gas Analyser', tatMinutes: 30, fee: 800 },
  // Lactate >= 4 mmol/L is the Surviving Sepsis fluid-resuscitation trigger and the
  // number the sepsis bundle is timed from. The system has sepsis detection and had no
  // lactate row to detect it with. Fluoride tube: glycolysis in a plain tube raises
  // lactate by ~20% in 30 minutes, which would manufacture the alert on its own.
  { name: 'Serum Lactate', code: 'LACT', category: 'Biochemistry', sampleType: 'Fluoride Blood', unit: 'mmol/L', normalMin: 0.5, normalMax: 2.2, criticalLow: null, criticalHigh: 4.0, method: 'Enzymatic', tatMinutes: 60, fee: 600 },
  // EDTA on ice — ammonia rises in a standing sample and a spurious result sends a
  // cirrhotic to the ICU for encephalopathy they do not have.
  { name: 'Serum Ammonia', code: 'NH3', category: 'Biochemistry', sampleType: 'EDTA Blood', unit: 'µmol/L', normalMin: 15, normalMax: 45, criticalLow: null, criticalHigh: 100, method: 'Enzymatic UV', tatMinutes: 120, fee: 900 },
  { name: 'Blood Ketone (Beta-Hydroxybutyrate)', code: 'BHB', category: 'Biochemistry', sampleType: 'Serum', unit: 'mmol/L', normalMin: 0.0, normalMax: 0.6, criticalLow: null, criticalHigh: 3.0, method: 'Enzymatic', tatMinutes: 60, fee: 400 },
  { name: 'Serum Osmolality', code: 'OSMO', category: 'Biochemistry', sampleType: 'Serum', unit: 'mOsm/kg', normalMin: 275, normalMax: 295, criticalLow: 250, criticalHigh: 320, method: 'Freezing Point Depression', tatMinutes: 120, fee: 500 },
  { name: 'Cystatin C', code: 'CYSC', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/L', normalMin: 0.62, normalMax: 1.15, criticalLow: null, criticalHigh: null, method: 'Immunoturbidimetry', tatMinutes: 240, fee: 1200 },

  // ── Biochemistry — Lipids ──────────────────────────────────────────────────
  // 'Lipid Profile' is a GROUP, not a row. See LAB_TEST_RETIRED.
  // No lipid except triglyceride has a panic value. A cholesterol of 410 or an LDL of
  // 310 is a clinic conversation about a statin, not a telephone call — and a low HDL
  // is the most ordinary abnormal result in the whole profile. These three thresholds
  // were paging clinicians about lipid profiles, which is Rule 2 exactly.
  { name: 'Total Cholesterol', code: 'CHOL', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 0, normalMax: 200, criticalLow: null, criticalHigh: null, method: 'CHOD-PAP', tatMinutes: 120, fee: 150 },
  // Was 40-60: an HDL of 75 is protective, and the old upper bound flagged every good
  // result as High. High HDL is not an abnormality — there is no upper bound.
  { name: 'HDL Cholesterol', code: 'HDL', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 40, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Direct Enzymatic', tatMinutes: 120, fee: 150 },
  { name: 'LDL Cholesterol', code: 'LDL', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 0, normalMax: 130, criticalLow: null, criticalHigh: null, method: 'Direct Enzymatic', tatMinutes: 120, fee: 150 },
  { name: 'VLDL Cholesterol', code: 'VLDL', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 5, normalMax: 40, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 120, fee: 120 },
  // Triglyceride is the one lipid that DOES earn a call, but at 1000 mg/dL — the
  // acute-pancreatitis threshold, where the patient needs an apheresis decision today.
  // At the old 500 it fired on routine metabolic syndrome, several times a clinic.
  { name: 'Triglycerides', code: 'TG', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/dL', normalMin: 0, normalMax: 150, criticalLow: null, criticalHigh: 1000, method: 'GPO-PAP', tatMinutes: 120, fee: 150 },

  // ── Biochemistry — Diabetes ────────────────────────────────────────────────
  { name: 'HbA1c', code: 'HBA1C', category: 'Biochemistry', sampleType: 'EDTA Blood', unit: '%', normalMin: 4.0, normalMax: 5.7, criticalLow: null, criticalHigh: null, method: 'HPLC', tatMinutes: 240, fee: 500 },
  { name: 'Blood Sugar Fasting', code: 'BSF', category: 'Biochemistry', sampleType: 'Fluoride Blood', unit: 'mg/dL', normalMin: 70, normalMax: 100, criticalLow: 40, criticalHigh: 500, method: 'GOD-POD', tatMinutes: 60, fee: 80, autoverifyEligible: true },
  // Same analyte, same assay, same clinical meaning — so one pair of panic thresholds.
  // Fasting paged at 500 while post-prandial and random paged at 600, meaning a glucose
  // of 550 was a phone call or not depending only on which box the doctor ticked.
  { name: 'Blood Sugar Post Prandial', code: 'BSPP', category: 'Biochemistry', sampleType: 'Fluoride Blood', unit: 'mg/dL', normalMin: 70, normalMax: 140, criticalLow: 40, criticalHigh: 500, method: 'GOD-POD', tatMinutes: 60, fee: 80, autoverifyEligible: true },
  { name: 'Blood Sugar Random', code: 'BSR', category: 'Biochemistry', sampleType: 'Fluoride Blood', unit: 'mg/dL', normalMin: 70, normalMax: 140, criticalLow: 40, criticalHigh: 500, method: 'GOD-POD', tatMinutes: 60, fee: 80 },
  { name: 'Oral Glucose Tolerance Test', code: 'OGTT', category: 'Biochemistry', sampleType: 'Fluoride Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'GOD-POD Serial', tatMinutes: 240, fee: 400 },
  // DIPSI is the Indian GDM protocol — 75 g irrespective of fasting state, single
  // 2-hour draw, diagnostic at >= 140 mg/dL. It is what MoHFW's antenatal guideline
  // mandates, and it is not the same test as the OGTT above.
  // Floor is 70, not 0: this is still a glucose, and a pregnant woman at 55 mg/dL two
  // hours after a 75 g load is hypoglycaemic, not "normal because it is under 140".
  // The 140 ceiling is the DIPSI diagnostic threshold for GDM.
  { name: 'Glucose Challenge Test (DIPSI 75g)', code: 'GCT', category: 'Biochemistry', sampleType: 'Fluoride Blood', unit: 'mg/dL', normalMin: 70, normalMax: 140, criticalLow: 40, criticalHigh: 500, method: 'GOD-POD', tatMinutes: 180, fee: 250 },
  { name: 'Fasting Insulin', code: 'INS', category: 'Biochemistry', sampleType: 'Serum', unit: 'µIU/mL', normalMin: 2.6, normalMax: 24.9, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 480, fee: 700 },

  // ── Biochemistry — Enzymes, inflammation, iron ─────────────────────────────
  { name: 'Serum Amylase', code: 'AMY', category: 'Biochemistry', sampleType: 'Serum', unit: 'U/L', normalMin: 25, normalMax: 125, criticalLow: null, criticalHigh: 500, method: 'CNPG3 Kinetic', tatMinutes: 120, fee: 400 },
  { name: 'Serum Lipase', code: 'LIP', category: 'Biochemistry', sampleType: 'Serum', unit: 'U/L', normalMin: 13, normalMax: 60, criticalLow: null, criticalHigh: 500, method: 'Enzymatic Colorimetric', tatMinutes: 120, fee: 500 },
  { name: 'LDH', code: 'LDH', category: 'Biochemistry', sampleType: 'Serum', unit: 'U/L', normalMin: 140, normalMax: 280, criticalLow: null, criticalHigh: null, method: 'Kinetic', tatMinutes: 120, fee: 350 },
  { name: 'CPK Total', code: 'CPK', category: 'Biochemistry', sampleType: 'Serum', unit: 'U/L', normalMin: 26, normalMax: 308, criticalLow: null, criticalHigh: null, maleNormalMin: 39, maleNormalMax: 308, femaleNormalMin: 26, femaleNormalMax: 192, method: 'IFCC Kinetic', tatMinutes: 120, fee: 400 },
  // CRP has no panic value — the old critical high of 100 mg/L fired on every serious
  // infection, which the clinician already knows about from the patient.
  { name: 'CRP (C-Reactive Protein)', code: 'CRP', category: 'Biochemistry', sampleType: 'Serum', unit: 'mg/L', normalMin: 0.0, normalMax: 5.0, criticalLow: null, criticalHigh: null, method: 'Immunoturbidimetry', tatMinutes: 120, fee: 400 },
  // Procalcitonin DOES earn an alert: > 2 ng/mL is the antibiotic-escalation trigger
  // in the AMS protocol, and it is the number the stewardship round acts on.
  { name: 'Procalcitonin', code: 'PCT', category: 'Biochemistry', sampleType: 'Serum', unit: 'ng/mL', normalMin: 0.0, normalMax: 0.5, criticalLow: null, criticalHigh: 2.0, method: 'CLIA', tatMinutes: 240, fee: 2200 },
  { name: 'Serum Iron', code: 'FE', category: 'Biochemistry', sampleType: 'Serum', unit: 'µg/dL', normalMin: 50, normalMax: 175, criticalLow: null, criticalHigh: null, maleNormalMin: 65, maleNormalMax: 175, femaleNormalMin: 50, femaleNormalMax: 170, method: 'Ferrozine', tatMinutes: 240, fee: 400 },
  { name: 'TIBC', code: 'TIBC', category: 'Biochemistry', sampleType: 'Serum', unit: 'µg/dL', normalMin: 240, normalMax: 450, criticalLow: null, criticalHigh: null, method: 'Ferrozine', tatMinutes: 240, fee: 400 },
  { name: 'Serum Ferritin', code: 'FERR', category: 'Biochemistry', sampleType: 'Serum', unit: 'ng/mL', normalMin: 13, normalMax: 400, criticalLow: null, criticalHigh: null, maleNormalMin: 30, maleNormalMax: 400, femaleNormalMin: 13, femaleNormalMax: 150, method: 'CLIA', tatMinutes: 240, fee: 800 },
  // B12 and folate were filed under Endocrinology. They are nutritional analytes, not
  // hormones, and they belong beside the iron studies they are ordered with — a
  // macrocytic anaemia workup requests ferritin, B12 and folate on one form.
  { name: 'Vitamin B12', code: 'VITB12', category: 'Biochemistry', sampleType: 'Serum', unit: 'pg/mL', normalMin: 200, normalMax: 900, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 1000 },
  { name: 'Folate', code: 'FOL', category: 'Biochemistry', sampleType: 'Serum', unit: 'ng/mL', normalMin: 3.0, normalMax: 17.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 900 },

  // ── Endocrinology ──────────────────────────────────────────────────────────
  { name: 'TSH', code: 'TSH', category: 'Endocrinology', sampleType: 'Serum', unit: 'µIU/mL', normalMin: 0.4, normalMax: 4.0, criticalLow: 0.1, criticalHigh: 100.0, method: 'CLIA', tatMinutes: 240, fee: 300 },
  { name: 'T3 (Total)', code: 'T3', category: 'Endocrinology', sampleType: 'Serum', unit: 'ng/dL', normalMin: 80, normalMax: 200, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 240, fee: 250 },
  { name: 'T4 (Total)', code: 'T4', category: 'Endocrinology', sampleType: 'Serum', unit: 'µg/dL', normalMin: 5.0, normalMax: 12.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 240, fee: 250 },
  // labReflexTests.ts prompts the AI to suggest Free T4 on an abnormal TSH. Until
  // now that suggestion pointed at a test that did not exist in the catalogue.
  { name: 'Free T3', code: 'FT3', category: 'Endocrinology', sampleType: 'Serum', unit: 'pg/mL', normalMin: 2.3, normalMax: 4.2, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 240, fee: 400 },
  { name: 'Free T4', code: 'FT4', category: 'Endocrinology', sampleType: 'Serum', unit: 'ng/dL', normalMin: 0.8, normalMax: 1.8, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 240, fee: 400 },
  { name: 'Anti-TPO Antibody', code: 'ATPO', category: 'Endocrinology', sampleType: 'Serum', unit: 'IU/mL', normalMin: 0, normalMax: 34, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 800 },
  { name: 'Vitamin D (25-OH)', code: 'VITD', category: 'Endocrinology', sampleType: 'Serum', unit: 'ng/mL', normalMin: 30, normalMax: 100, criticalLow: 10, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 1200 },
  { name: 'Serum Cortisol (Morning)', code: 'CORT', category: 'Endocrinology', sampleType: 'Serum', unit: 'µg/dL', normalMin: 6.0, normalMax: 23.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 800 },
  { name: 'Prolactin', code: 'PRL', category: 'Endocrinology', sampleType: 'Serum', unit: 'ng/mL', normalMin: 4.0, normalMax: 25.0, criticalLow: null, criticalHigh: null, maleNormalMin: 4.0, maleNormalMax: 15.0, femaleNormalMin: 5.0, femaleNormalMax: 25.0, method: 'CLIA', tatMinutes: 1440, fee: 600 },
  { name: 'Beta hCG', code: 'BHCG', category: 'Endocrinology', sampleType: 'Serum', unit: 'mIU/mL', normalMin: 0.0, normalMax: 5.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 240, fee: 700 },
  // PTH belongs beside calcium and phosphorus: it is what a raised calcium or a CKD-MBD
  // workup actually turns on, and neither could be ordered without it.
  { name: 'PTH (Intact)', code: 'PTH', category: 'Endocrinology', sampleType: 'Serum', unit: 'pg/mL', normalMin: 15, normalMax: 65, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 1200 },

  // Reproductive endocrinology. The FEMALE interval quoted is the FOLLICULAR PHASE —
  // these analytes swing severalfold across the cycle (LH peaks ~5x at ovulation, FSH
  // rises ~10x after menopause), so a single female band cannot be right for every
  // draw. Same deliberate limitation as the paediatric and pregnancy intervals noted at
  // the top of this file: a hospital tunes these, and the repair migration preserves
  // whatever it tunes them to. The alternative — omitting the sex split — is worse,
  // because a male testosterone of 50 ng/dL would read Normal against a merged band.
  { name: 'FSH', code: 'FSH', category: 'Endocrinology', sampleType: 'Serum', unit: 'mIU/mL', normalMin: 1.5, normalMax: 12.5, criticalLow: null, criticalHigh: null, maleNormalMin: 1.5, maleNormalMax: 12.4, femaleNormalMin: 3.5, femaleNormalMax: 12.5, method: 'CLIA', tatMinutes: 1440, fee: 500 },
  { name: 'LH', code: 'LH', category: 'Endocrinology', sampleType: 'Serum', unit: 'mIU/mL', normalMin: 1.7, normalMax: 12.6, criticalLow: null, criticalHigh: null, maleNormalMin: 1.7, maleNormalMax: 8.6, femaleNormalMin: 2.4, femaleNormalMax: 12.6, method: 'CLIA', tatMinutes: 1440, fee: 500 },
  { name: 'Estradiol (E2)', code: 'E2', category: 'Endocrinology', sampleType: 'Serum', unit: 'pg/mL', normalMin: 11, normalMax: 123, criticalLow: null, criticalHigh: null, maleNormalMin: 11, maleNormalMax: 44, femaleNormalMin: 27, femaleNormalMax: 123, method: 'CLIA', tatMinutes: 1440, fee: 600 },
  { name: 'Progesterone', code: 'PROG', category: 'Endocrinology', sampleType: 'Serum', unit: 'ng/mL', normalMin: 0.1, normalMax: 0.9, criticalLow: null, criticalHigh: null, maleNormalMin: 0.1, maleNormalMax: 0.8, femaleNormalMin: 0.1, femaleNormalMax: 0.9, method: 'CLIA', tatMinutes: 1440, fee: 600 },
  { name: 'Testosterone (Total)', code: 'TESTO', category: 'Endocrinology', sampleType: 'Serum', unit: 'ng/dL', normalMin: 8, normalMax: 871, criticalLow: null, criticalHigh: null, maleNormalMin: 240, maleNormalMax: 871, femaleNormalMin: 8, femaleNormalMax: 60, method: 'CLIA', tatMinutes: 1440, fee: 700 },
  { name: 'DHEA-S', code: 'DHEAS', category: 'Endocrinology', sampleType: 'Serum', unit: 'µg/dL', normalMin: 35, normalMax: 560, criticalLow: null, criticalHigh: null, maleNormalMin: 80, maleNormalMax: 560, femaleNormalMin: 35, femaleNormalMax: 430, method: 'CLIA', tatMinutes: 1440, fee: 900 },
  // Ovarian reserve. No sex split — it is not ordered on men in this setting.
  { name: 'Anti-Mullerian Hormone (AMH)', code: 'AMH', category: 'Endocrinology', sampleType: 'Serum', unit: 'ng/mL', normalMin: 1.0, normalMax: 4.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 2880, fee: 2000 },

  // ── Tumour Markers ─────────────────────────────────────────────────────────
  // None of these had a home before: PSA was filed under Endocrinology because it is an
  // immunoassay, and the other five simply did not exist. None carries a panic value —
  // a raised tumour marker is an oncology clinic conversation, never a night call.
  { name: 'PSA (Total)', code: 'PSA', category: 'Tumour Markers', sampleType: 'Serum', unit: 'ng/mL', normalMin: 0.0, normalMax: 4.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 700 },
  { name: 'PSA (Free)', code: 'FPSA', category: 'Tumour Markers', sampleType: 'Serum', unit: 'ng/mL', normalMin: 0.0, normalMax: 0.9, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 900 },
  { name: 'Alpha Fetoprotein (AFP)', code: 'AFP', category: 'Tumour Markers', sampleType: 'Serum', unit: 'ng/mL', normalMin: 0.0, normalMax: 10.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 900 },
  { name: 'CEA', code: 'CEA', category: 'Tumour Markers', sampleType: 'Serum', unit: 'ng/mL', normalMin: 0.0, normalMax: 5.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 900 },
  { name: 'CA-125', code: 'CA125', category: 'Tumour Markers', sampleType: 'Serum', unit: 'U/mL', normalMin: 0.0, normalMax: 35.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 1200 },
  { name: 'CA 19-9', code: 'CA199', category: 'Tumour Markers', sampleType: 'Serum', unit: 'U/mL', normalMin: 0.0, normalMax: 37.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 1400 },
  { name: 'CA 15-3', code: 'CA153', category: 'Tumour Markers', sampleType: 'Serum', unit: 'U/mL', normalMin: 0.0, normalMax: 31.3, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 1400 },

  // ── Cardiac Markers ────────────────────────────────────────────────────────
  // A troponin above the 99th-percentile URL is itself the alert — in the ED, a
  // positive troponin is telephoned, not filed.
  { name: 'Troponin I', code: 'TROPI', category: 'Cardiac Markers', sampleType: 'Serum', unit: 'ng/mL', normalMin: 0.0, normalMax: 0.04, criticalLow: null, criticalHigh: 0.04, method: 'CLIA', tatMinutes: 60, fee: 900 },
  // Troponin I above already pages on the same draw, and troponin is the superior and
  // decision-making marker. Two alerts for one myocardial injury is one alert too many.
  { name: 'CK-MB', code: 'CKMB', category: 'Cardiac Markers', sampleType: 'Serum', unit: 'ng/mL', normalMin: 0.0, normalMax: 5.0, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 120, fee: 600 },
  // 900 pg/mL is an AGE-STRATIFIED DIAGNOSTIC cut-off for acute heart failure, not a
  // panic value. Every decompensated HF patient on the ward clears it, and the team
  // admitted them for that reason — the alert tells nobody anything they do not know.
  { name: 'NT-proBNP', code: 'NTBNP', category: 'Cardiac Markers', sampleType: 'Serum', unit: 'pg/mL', normalMin: 0, normalMax: 125, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 240, fee: 1800 },

  // ── Serology ───────────────────────────────────────────────────────────────
  // These four are mandatory pre-operative and blood-bank screening in every Indian
  // hospital and were absent from the catalogue entirely.
  { name: 'HIV I & II', code: 'HIV', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA / Rapid', tatMinutes: 240, fee: 400 },
  { name: 'HBsAg', code: 'HBSAG', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA / Rapid', tatMinutes: 240, fee: 400 },
  { name: 'Anti-HCV', code: 'HCV', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 240, fee: 600 },
  { name: 'VDRL / RPR', code: 'VDRL', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Flocculation', tatMinutes: 240, fee: 300 },
  // Dengue NS1 and Widal were filed under Microbiology — neither is a culture.
  { name: 'Dengue NS1 Antigen', code: 'DNS1', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Immunochromatography', tatMinutes: 240, fee: 800 },
  { name: 'Dengue IgM', code: 'DIGM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 240, fee: 700 },
  { name: 'Dengue IgG', code: 'DIGG', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 240, fee: 700 },
  { name: 'Widal Test', code: 'WIDAL', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Tube Agglutination', tatMinutes: 240, fee: 300 },
  { name: 'Typhoid IgM (Typhidot)', code: 'TYPHM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Immunochromatography', tatMinutes: 240, fee: 600 },
  { name: 'Chikungunya IgM', code: 'CHIKM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 1440, fee: 900 },
  { name: 'Scrub Typhus IgM', code: 'SCRUBM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 1440, fee: 1000 },
  { name: 'Leptospira IgM', code: 'LEPTOM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 1440, fee: 900 },
  // Moved out of Haematology — the same immunochromatographic strip as Dengue NS1 above.
  { name: 'Malaria Antigen (Rapid)', code: 'MPRDT', category: 'Serology', sampleType: 'EDTA Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Immunochromatography', tatMinutes: 60, fee: 300 },
  { name: 'Filaria Antigen', code: 'FILAG', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ICT Card', tatMinutes: 240, fee: 800 },
  { name: 'Influenza A/B Rapid Antigen', code: 'FLUAG', category: 'Serology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Immunochromatography', tatMinutes: 60, fee: 800 },

  // Viral hepatitis. HBsAg and Anti-HCV were present for pre-operative screening, but a
  // patient presenting WITH jaundice needs A and E — which are the commonest causes of
  // acute viral hepatitis in India — and neither existed. The jaundice workup could not
  // be ordered through the system at all.
  { name: 'Hepatitis A IgM', code: 'HAVM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 1440, fee: 900 },
  { name: 'Hepatitis E IgM', code: 'HEVM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 1440, fee: 1200 },
  { name: 'HBeAg', code: 'HBEAG', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 1440, fee: 900 },
  // Quantitative, not qualitative: >= 10 mIU/mL is the protective titre after a
  // vaccination course, which is what a needlestick or a staff-immunisation check asks.
  { name: 'Anti-HBs Titre', code: 'ANTIHBS', category: 'Serology', sampleType: 'Serum', unit: 'mIU/mL', normalMin: 10, normalMax: null, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 800 },
  { name: 'H. pylori Antibody', code: 'HPYLAB', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 1440, fee: 700 },

  // Antenatal screening. TORCH is ordered as separate analytes, not one row, because
  // IgM (acute) and IgG (past exposure / immunity) carry opposite clinical meanings and
  // reporting them in one field is how a non-immune rubella result gets misread.
  { name: 'Toxoplasma IgM', code: 'TOXOM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 800 },
  { name: 'Toxoplasma IgG', code: 'TOXOG', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 800 },
  { name: 'Rubella IgG', code: 'RUBG', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 800 },
  { name: 'CMV IgM', code: 'CMVM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 900 },
  // Aneuploidy risk screens. The result is a computed RISK RATIO against gestational age
  // and maternal factors, not a concentration — qualitative by design.
  { name: 'Double Marker (First Trimester)', code: 'DUALM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'CLIA + Risk Algorithm', tatMinutes: 2880, fee: 2500 },
  { name: 'Quadruple Marker', code: 'QUADM', category: 'Serology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'CLIA + Risk Algorithm', tatMinutes: 2880, fee: 3500 },

  // ── Immunology / Autoimmune ────────────────────────────────────────────────
  { name: 'ASO Titre', code: 'ASO', category: 'Immunology', sampleType: 'Serum', unit: 'IU/mL', normalMin: 0, normalMax: 200, criticalLow: null, criticalHigh: null, method: 'Immunoturbidimetry', tatMinutes: 240, fee: 400 },
  { name: 'Rheumatoid Factor', code: 'RA', category: 'Immunology', sampleType: 'Serum', unit: 'IU/mL', normalMin: 0, normalMax: 14, criticalLow: null, criticalHigh: null, method: 'Immunoturbidimetry', tatMinutes: 240, fee: 400 },
  { name: 'ANA (IF)', code: 'ANA', category: 'Immunology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Indirect Immunofluorescence', tatMinutes: 1440, fee: 1200 },
  // Anti-CCP is more specific than rheumatoid factor and is what the 2010 ACR/EULAR RA
  // criteria actually score; RF alone was the only option here. Anti-dsDNA, C3 and C4
  // are the follow-on panel a positive ANA above triggers — that reflex had nowhere to go.
  { name: 'Anti-CCP', code: 'ACCP', category: 'Immunology', sampleType: 'Serum', unit: 'U/mL', normalMin: 0, normalMax: 20, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 1500 },
  { name: 'Anti-dsDNA', code: 'DSDNA', category: 'Immunology', sampleType: 'Serum', unit: 'IU/mL', normalMin: 0, normalMax: 30, criticalLow: null, criticalHigh: null, method: 'ELISA', tatMinutes: 1440, fee: 1200 },
  { name: 'Complement C3', code: 'C3', category: 'Immunology', sampleType: 'Serum', unit: 'mg/dL', normalMin: 90, normalMax: 180, criticalLow: null, criticalHigh: null, method: 'Immunoturbidimetry', tatMinutes: 1440, fee: 800 },
  { name: 'Complement C4', code: 'C4', category: 'Immunology', sampleType: 'Serum', unit: 'mg/dL', normalMin: 10, normalMax: 40, criticalLow: null, criticalHigh: null, method: 'Immunoturbidimetry', tatMinutes: 1440, fee: 800 },
  { name: 'ANCA (p-ANCA / c-ANCA)', code: 'ANCA', category: 'Immunology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Indirect Immunofluorescence', tatMinutes: 2880, fee: 1800 },
  { name: 'Serum IgE (Total)', code: 'IGE', category: 'Immunology', sampleType: 'Serum', unit: 'IU/mL', normalMin: 0, normalMax: 100, criticalLow: null, criticalHigh: null, method: 'CLIA', tatMinutes: 1440, fee: 900 },

  // ── Microbiology ───────────────────────────────────────────────────────────
  { name: 'Blood Culture & Sensitivity', code: 'BCUL', category: 'Microbiology', sampleType: 'Culture Bottle', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Automated BacT/ALERT', tatMinutes: 4320, fee: 1200 },
  { name: 'Urine Culture & Sensitivity', code: 'UCUL', category: 'Microbiology', sampleType: 'Urine', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Semi-quantitative Culture', tatMinutes: 2880, fee: 800 },
  { name: 'Sputum Culture & Sensitivity', code: 'SCUL', category: 'Microbiology', sampleType: 'Sputum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Culture', tatMinutes: 2880, fee: 800 },
  { name: 'Pus / Wound Swab C&S', code: 'PSCUL', category: 'Microbiology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Culture', tatMinutes: 2880, fee: 800 },
  { name: 'Stool Culture & Sensitivity', code: 'STCUL', category: 'Microbiology', sampleType: 'Stool', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Culture', tatMinutes: 2880, fee: 800 },
  { name: 'Gram Stain', code: 'GRAM', category: 'Microbiology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Gram Stain Microscopy', tatMinutes: 120, fee: 200 },
  { name: 'Sputum AFB (ZN Stain)', code: 'AFB', category: 'Microbiology', sampleType: 'Sputum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Ziehl-Neelsen', tatMinutes: 240, fee: 250 },
  { name: 'GeneXpert MTB/RIF', code: 'XPERT', category: 'Microbiology', sampleType: 'Sputum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Cartridge PCR', tatMinutes: 1440, fee: 2000 },
  { name: 'KOH Mount', code: 'KOH', category: 'Microbiology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'KOH Wet Mount', tatMinutes: 120, fee: 250 },
  // A CSF culture is the single most time-critical culture a hospital sends and it was
  // absent, so a suspected meningitis could be ordered as a CSF Analysis but never as a
  // culture. ET aspirate is the VAP workup; both are separate specimens from sputum.
  { name: 'CSF Culture & Sensitivity', code: 'CSFCUL', category: 'Microbiology', sampleType: 'CSF', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Culture', tatMinutes: 2880, fee: 900 },
  { name: 'ET / Tracheal Aspirate C&S', code: 'ETCUL', category: 'Microbiology', sampleType: 'Fluid', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Semi-quantitative Culture', tatMinutes: 2880, fee: 900 },
  { name: 'Body Fluid Culture & Sensitivity', code: 'BFCUL', category: 'Microbiology', sampleType: 'Fluid', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Culture', tatMinutes: 2880, fee: 900 },
  { name: 'Throat Swab C&S', code: 'THRCUL', category: 'Microbiology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Culture', tatMinutes: 2880, fee: 700 },
  { name: 'Fungal Culture', code: 'FUNCUL', category: 'Microbiology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'SDA Culture', tatMinutes: 10080, fee: 900 },
  // Moved out of Serology: serology means antibodies in serum. This is an antigen strip
  // read off a nasopharyngeal swab, and it sits beside the RT-PCR it is triaged against.
  { name: 'COVID-19 Rapid Antigen', code: 'COVAG', category: 'Microbiology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Immunochromatography', tatMinutes: 60, fee: 400 },

  // ── Clinical Pathology ─────────────────────────────────────────────────────
  // Was 'Urine R/M' under a category literally called 'urine' — a specimen type
  // masquerading as a discipline.
  { name: 'Urine Routine & Microscopy', code: 'URM', category: 'Clinical Pathology', sampleType: 'Urine', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Dipstick + Microscopy', tatMinutes: 60, fee: 150 },
  { name: 'Urine Pregnancy Test', code: 'UPT', category: 'Clinical Pathology', sampleType: 'Urine', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Immunochromatography', tatMinutes: 30, fee: 200 },
  { name: 'Urine Ketones', code: 'UKET', category: 'Clinical Pathology', sampleType: 'Urine', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Dipstick', tatMinutes: 60, fee: 100 },
  { name: 'Urine Microalbumin', code: 'UMALB', category: 'Clinical Pathology', sampleType: 'Urine', unit: 'mg/L', normalMin: 0, normalMax: 30, criticalLow: null, criticalHigh: null, method: 'Immunoturbidimetry', tatMinutes: 240, fee: 600 },
  { name: 'Urine Protein/Creatinine Ratio', code: 'UPCR', category: 'Clinical Pathology', sampleType: 'Urine', unit: 'mg/g', normalMin: 0, normalMax: 150, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 240, fee: 600 },
  { name: '24 Hour Urine Protein', code: 'U24P', category: 'Clinical Pathology', sampleType: 'Urine', unit: 'mg/24h', normalMin: 0, normalMax: 150, criticalLow: null, criticalHigh: null, method: 'Pyrogallol Red', tatMinutes: 1440, fee: 600 },
  // ACR, not just PCR: albumin/creatinine ratio is the KDIGO and ADA standard for
  // diabetic nephropathy screening and the one an annual diabetic review asks for. Only
  // the protein/creatinine ratio existed, which is a different test with a different
  // threshold and misses the microalbuminuric stage entirely.
  { name: 'Urine Albumin/Creatinine Ratio', code: 'UACR', category: 'Clinical Pathology', sampleType: 'Urine', unit: 'mg/g', normalMin: 0, normalMax: 30, criticalLow: null, criticalHigh: null, method: 'Calculated', tatMinutes: 240, fee: 700 },
  // Spot urine electrolytes are interpreted CONTEXTUALLY — a urine sodium under
  // 20 mEq/L is what separates prerenal from intrinsic AKI. The bands below are the
  // diet-dependent ranges Indian labs print on the report, not a health/disease
  // boundary; the flag they produce means "unusual for a normal diet", nothing more.
  { name: 'Spot Urine Sodium', code: 'USNA', category: 'Clinical Pathology', sampleType: 'Urine', unit: 'mEq/L', normalMin: 20, normalMax: 220, criticalLow: null, criticalHigh: null, method: 'ISE', tatMinutes: 240, fee: 250 },
  { name: 'Spot Urine Creatinine', code: 'USCR', category: 'Clinical Pathology', sampleType: 'Urine', unit: 'mg/dL', normalMin: 20, normalMax: 320, criticalLow: null, criticalHigh: null, method: 'Jaffe Kinetic', tatMinutes: 240, fee: 200 },
  { name: 'Stool Routine Examination', code: 'STRM', category: 'Clinical Pathology', sampleType: 'Stool', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Microscopy', tatMinutes: 120, fee: 200 },
  { name: 'Stool for Ova & Cyst', code: 'STOC', category: 'Clinical Pathology', sampleType: 'Stool', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Saline & Iodine Mount', tatMinutes: 120, fee: 250 },
  { name: 'Stool Occult Blood', code: 'SOB', category: 'Clinical Pathology', sampleType: 'Stool', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Immunochemical', tatMinutes: 120, fee: 250 },
  { name: 'CSF Analysis', code: 'CSFA', category: 'Clinical Pathology', sampleType: 'CSF', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Cytology + Biochemistry', tatMinutes: 120, fee: 800 },
  { name: 'Body Fluid Analysis', code: 'BFA', category: 'Clinical Pathology', sampleType: 'Fluid', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Cytology + Biochemistry', tatMinutes: 120, fee: 700 },
  { name: 'Semen Analysis', code: 'SEMEN', category: 'Clinical Pathology', sampleType: 'Semen', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'WHO 2021 Manual', tatMinutes: 240, fee: 600 },

  // ── Histopathology ─────────────────────────────────────────────────────────
  // These are the dual-validation use case: a histopathology report is released
  // only on pathologist sign-off. lab_dual_validation_config keys on test_category,
  // so without a test actually carrying 'Histopathology' the gate never engaged.
  { name: 'Histopathology - Small Specimen', code: 'HPES', category: 'Histopathology', sampleType: 'Biopsy', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'H&E Microscopy', tatMinutes: 4320, fee: 1500 },
  { name: 'Histopathology - Large Specimen', code: 'HPEL', category: 'Histopathology', sampleType: 'Biopsy', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'H&E Microscopy', tatMinutes: 7200, fee: 3000 },
  { name: 'Frozen Section', code: 'FROZEN', category: 'Histopathology', sampleType: 'Biopsy', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Cryostat Section', tatMinutes: 60, fee: 3500 },
  { name: 'Immunohistochemistry (per marker)', code: 'IHC', category: 'Histopathology', sampleType: 'Biopsy', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'IHC', tatMinutes: 7200, fee: 2500 },

  // ── Cytology ───────────────────────────────────────────────────────────────
  { name: 'FNAC', code: 'FNAC', category: 'Cytology', sampleType: 'Biopsy', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Fine Needle Aspiration Cytology', tatMinutes: 2880, fee: 1200 },
  { name: 'Pap Smear', code: 'PAP', category: 'Cytology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Papanicolaou Stain', tatMinutes: 4320, fee: 900 },
  { name: 'Fluid Cytology', code: 'FCYT', category: 'Cytology', sampleType: 'Fluid', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Cytospin', tatMinutes: 2880, fee: 1000 },

  // ── Molecular Biology ──────────────────────────────────────────────────────
  // COVID RT-PCR used to be the sole occupant of 'Genetics'. An infectious PCR is not
  // genetic testing: it shared a reporting category with hereditary disease diagnosis,
  // and any dual-validation rule a hospital set for genetics would have gated a swab.
  //
  // Viral loads carry unit 'report' rather than IU/mL deliberately. There is no
  // reference INTERVAL for a viral load — the target is "not detected" — and inventing
  // a band would make every suppressed patient's result flag against it.
  { name: 'COVID-19 RT-PCR', code: 'COVPCR', category: 'Molecular Biology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Real-Time PCR', tatMinutes: 1440, fee: 500 },
  { name: 'HBV DNA Viral Load', code: 'HBVVL', category: 'Molecular Biology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Real-Time PCR', tatMinutes: 4320, fee: 4000 },
  { name: 'HCV RNA Viral Load', code: 'HCVVL', category: 'Molecular Biology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Real-Time PCR', tatMinutes: 4320, fee: 4500 },
  { name: 'HIV-1 RNA Viral Load', code: 'HIVVL', category: 'Molecular Biology', sampleType: 'Serum', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Real-Time PCR', tatMinutes: 4320, fee: 4500 },
  // Pairs with the Pap smear already in Cytology — co-testing is the current cervical
  // screening standard, and only half of it existed.
  { name: 'HPV DNA (High Risk)', code: 'HPVDNA', category: 'Molecular Biology', sampleType: 'Swab', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'Real-Time PCR', tatMinutes: 4320, fee: 3000 },

  // ── Genetics ───────────────────────────────────────────────────────────────
  // Now genuinely human genetics. The thalassaemia panel is the confirmatory step after
  // an abnormal HPLC in the Haematology section — the two are ordered as a sequence.
  { name: 'Karyotyping', code: 'KARYO', category: 'Genetics', sampleType: 'Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'G-Banding', tatMinutes: 20160, fee: 5000 },
  { name: 'Thalassaemia Mutation Panel', code: 'THALMUT', category: 'Genetics', sampleType: 'EDTA Blood', unit: R, normalMin: null, normalMax: null, criticalLow: null, criticalHigh: null, method: 'PCR-ARMS / Sequencing', tatMinutes: 20160, fee: 6000 },

  // ── Therapeutic Drug Monitoring ────────────────────────────────────────────
  // The interval here is a THERAPEUTIC TARGET, not a health reference range: a result
  // below it means underdosed, not healthy. The critical high is genuine toxicity — a
  // lithium of 1.6 or a digoxin of 2.6 is a stop-the-drug phone call, which is exactly
  // what a panic value is for.
  { name: 'Serum Lithium', code: 'LI', category: 'Therapeutic Drug Monitoring', sampleType: 'Serum', unit: 'mEq/L', normalMin: 0.6, normalMax: 1.2, criticalLow: null, criticalHigh: 1.5, method: 'ISE', tatMinutes: 240, fee: 800 },
  { name: 'Serum Phenytoin', code: 'PHT', category: 'Therapeutic Drug Monitoring', sampleType: 'Serum', unit: 'µg/mL', normalMin: 10, normalMax: 20, criticalLow: null, criticalHigh: 30, method: 'CLIA', tatMinutes: 480, fee: 900 },
  { name: 'Serum Valproate', code: 'VPA', category: 'Therapeutic Drug Monitoring', sampleType: 'Serum', unit: 'µg/mL', normalMin: 50, normalMax: 100, criticalLow: null, criticalHigh: 150, method: 'CLIA', tatMinutes: 480, fee: 900 },
  { name: 'Vancomycin (Trough)', code: 'VANCO', category: 'Therapeutic Drug Monitoring', sampleType: 'Serum', unit: 'µg/mL', normalMin: 10, normalMax: 20, criticalLow: null, criticalHigh: 30, method: 'CLIA', tatMinutes: 480, fee: 1200 },
  { name: 'Serum Digoxin', code: 'DIGX', category: 'Therapeutic Drug Monitoring', sampleType: 'Serum', unit: 'ng/mL', normalMin: 0.8, normalMax: 2.0, criticalLow: null, criticalHigh: 2.5, method: 'CLIA', tatMinutes: 480, fee: 900 },
];

/**
 * Panels seeded as lab_test_groups, priced below the sum of their members.
 *
 * The first five carry the names doctors actually write on a form — 'Complete Blood
 * Count', not 'Complete Blood Count Panel'. That is deliberate and load-bearing: those
 * five used to ALSO exist as single rows in LAB_TEST_CATALOG, and now that the rows are
 * retired (see LAB_TEST_RETIRED) the group is what a prescription for "CBC" resolves
 * to. investigationSync falls back to a group lookup by name when no active test row
 * matches, so the names here must be the ones that were retired from there.
 *
 * `code` is the stable key — the QA seeder and the tenant repair both match on it — so
 * a group may be RENAMED but its code must never change.
 */
export const LAB_TEST_GROUP_CATALOG: Array<{
  name: string; code: string; category: LabTestCategory; fee: number; tatMinutes: number; members: string[];
}> = [
  { name: 'Complete Blood Count', code: 'CBCP', category: 'Haematology', fee: 350, tatMinutes: 120,
    members: ['Haemoglobin', 'Total Leucocyte Count', 'Differential Leucocyte Count', 'Platelet Count', 'RBC Count', 'PCV / Haematocrit', 'MCV', 'MCH', 'MCHC', 'RDW'] },
  { name: 'Liver Function Test', code: 'LFTP', category: 'Biochemistry', fee: 700, tatMinutes: 120,
    members: ['SGOT (AST)', 'SGPT (ALT)', 'Alkaline Phosphatase', 'GGT', 'Bilirubin Total', 'Bilirubin Direct', 'Bilirubin Indirect', 'Total Protein', 'Albumin', 'Globulin', 'A:G Ratio'] },
  { name: 'Kidney Function Test', code: 'KFTP', category: 'Biochemistry', fee: 700, tatMinutes: 120,
    members: ['Serum Creatinine', 'Blood Urea', 'Blood Urea Nitrogen', 'Uric Acid', 'eGFR', 'Serum Sodium', 'Serum Potassium', 'Serum Chloride'] },
  { name: 'Lipid Profile', code: 'LIPIDP', category: 'Biochemistry', fee: 600, tatMinutes: 120,
    members: ['Total Cholesterol', 'HDL Cholesterol', 'LDL Cholesterol', 'VLDL Cholesterol', 'Triglycerides'] },
  // New group. 'Serum Electrolytes' was a single row with no panel behind it, so
  // retiring the row would have left a routinely ordered test with nothing to resolve
  // to. The Kidney panel includes Na/K/Cl, but a standalone electrolytes request on a
  // vomiting or diuretic patient is its own order and should not drag in creatinine.
  { name: 'Serum Electrolytes', code: 'ELECP', category: 'Biochemistry', fee: 400, tatMinutes: 60,
    members: ['Serum Sodium', 'Serum Potassium', 'Serum Chloride', 'Serum Bicarbonate'] },
  { name: 'Thyroid Profile', code: 'TFT', category: 'Endocrinology', fee: 600, tatMinutes: 240,
    members: ['TSH', 'T3 (Total)', 'T4 (Total)'] },
  { name: 'Pre-Operative Screening', code: 'PREOP', category: 'Serology', fee: 1400, tatMinutes: 240,
    members: ['HIV I & II', 'HBsAg', 'Anti-HCV', 'VDRL / RPR'] },
  // 'Complete Blood Count' was a MEMBER here, and a group cannot contain a group —
  // lab_test_group_items points at lab_test_master only. Expanded to the four counts a
  // fever workup actually reads, which also makes them individually flaggable.
  { name: 'Fever Panel', code: 'FEVER', category: 'Serology', fee: 1500, tatMinutes: 240,
    members: ['Haemoglobin', 'Total Leucocyte Count', 'Differential Leucocyte Count', 'Platelet Count', 'Malaria Antigen (Rapid)', 'Dengue NS1 Antigen', 'Widal Test', 'Blood Sugar Random'] },
];

/**
 * Rows that must not be orderable as individual tests.
 *
 * Deactivated, never deleted — Meera's rule forbids destructive production migrations,
 * and a hospital may already have historical lab_order_items pointing at the row.
 *
 * The generator emits the deactivation SQL from THIS list (see generate-lab-catalog.mjs),
 * so adding an entry here is all that is needed. It used to be hand-written into the
 * repair migration, where the TypeScript list and the SQL acting on it could drift.
 */
export const LAB_TEST_RETIRED: Array<{ name: string; reason: string }> = [
  {
    name: 'ECG',
    reason:
      'A cardiac diagnostic procedure, not a laboratory test. Ordering it through the lab ' +
      'pipeline made investigationSync mint an "other" specimen and print a barcode for a ' +
      'patient from whom nothing is ever drawn. Belongs in the procedure/service master.',
  },

  // ── The five pseudo-panels ────────────────────────────────────────────────
  // Each of these existed BOTH as a single row with unit 'report' AND as a group, at the
  // same price. Two consequences, both bad:
  //
  //   1. One result. The row has one value field, so a CBC came back as a single
  //      unitless blob of text. No per-analyte H/L flag, no critical detection, no delta
  //      check, no autoverify, no trend graph — every downstream feature that reads a
  //      NUMBER got a paragraph instead.
  //   2. Two billable paths to the same work, so a CBC ordered as a row and as a panel
  //      on one encounter bills twice with nothing to detect it.
  //
  // They stay orderable BY NAME: the identically named group in LAB_TEST_GROUP_CATALOG
  // is what a prescription now resolves to, via the group fallback in investigationSync.
  {
    name: 'Complete Blood Count',
    reason:
      'Replaced by the identically named group, which expands into its ten analytes so ' +
      'each one carries its own reference interval and flag.',
  },
  {
    name: 'Liver Function Test',
    reason: 'Replaced by the identically named group (11 analytes).',
  },
  {
    name: 'Kidney Function Test',
    reason: 'Replaced by the identically named group (8 analytes).',
  },
  {
    name: 'Lipid Profile',
    reason: 'Replaced by the identically named group (5 analytes).',
  },
  {
    name: 'Serum Electrolytes',
    reason: 'Replaced by the identically named group (Na, K, Cl, HCO3).',
  },
];
