// Shorthand a doctor writes → the canonical catalogue name it means.
//
// WHY THIS EXISTS
// The fuzzy matcher in orderCatalogue.ts forgives SPELLING and REDUNDANT WORDS — "creatinin"
// for "Serum Creatinine", "Fever panel test" for "Fever Panel". It cannot forgive a name that
// shares no letters with its target, and it must not: loosening it far enough to turn "KFT"
// into "Kidney Function Test" would also turn "CT" into "Clotting Time" and bill a patient for
// a coagulation study instead of a scan.
//
// Abbreviations are therefore a LOOKUP, not a score. Everything below is a mapping a
// registered practitioner in India would read as unambiguous on a chit.
//
// ── Rules ────────────────────────────────────────────────────────────────────
//  1. The right-hand side is a canonical NAME, never an id. It is resolved against the
//     HOSPITAL's own catalogue at load time, so a hospital that does not offer the test still
//     correctly reports it as not offered rather than ordering something it cannot perform.
//  2. Nothing ambiguous. "CT" (Clotting Time vs CT scan), "BT" (Bleeding Time vs bleeding
//     time of day), bare "KUB" (X-Ray KUB vs USG KUB + Prostate) and bare "Na"/"K" are
//     deliberately absent. An abbreviation that needs context is one a human should resolve.
//  3. Aliases the hospital LEARNS — from a doctor's correction or an accepted
//     `ai-resolve-orders` answer — live in the `order_name_aliases` table, not here. This
//     list is the floor that ships on day one with no LLM call and no migration.
//
// Keys are matched after `expandSymbols` + `normalizeTerm`, so punctuation, case and spacing
// are irrelevant: "pre-op", "Pre Op" and "PREOP" are the same key.

export interface OrderAlias {
  /** What the doctor writes. Case, spacing and punctuation are normalised away. */
  alias: string;
  /** Exact catalogue name in lab_test_master / lab_test_groups / radiology_study_master. */
  canonical: string;
}

export const BUILT_IN_ORDER_ALIASES: readonly OrderAlias[] = [
  // ── Panels (lab_test_groups) ───────────────────────────────────────────────
  { alias: "CBC", canonical: "Complete Blood Count" },
  { alias: "CBP", canonical: "Complete Blood Count" },
  { alias: "FBC", canonical: "Complete Blood Count" },
  { alias: "Hemogram", canonical: "Complete Blood Count" },
  { alias: "Haemogram", canonical: "Complete Blood Count" },
  { alias: "Complete Blood Picture", canonical: "Complete Blood Count" },
  { alias: "Complete Haemogram", canonical: "Complete Blood Count" },

  { alias: "LFT", canonical: "Liver Function Test" },
  { alias: "Liver Function", canonical: "Liver Function Test" },
  { alias: "Liver Profile", canonical: "Liver Function Test" },

  { alias: "KFT", canonical: "Kidney Function Test" },
  { alias: "RFT", canonical: "Kidney Function Test" },
  { alias: "Renal Function", canonical: "Kidney Function Test" },
  { alias: "Renal Function Test", canonical: "Kidney Function Test" },
  { alias: "Renal Profile", canonical: "Kidney Function Test" },
  { alias: "Kidney Function", canonical: "Kidney Function Test" },
  { alias: "Kidney Profile", canonical: "Kidney Function Test" },

  { alias: "TFT", canonical: "Thyroid Profile" },
  { alias: "Thyroid Function", canonical: "Thyroid Profile" },
  { alias: "Thyroid Function Test", canonical: "Thyroid Profile" },
  { alias: "Thyroid Panel", canonical: "Thyroid Profile" },

  { alias: "Lipid Panel", canonical: "Lipid Profile" },
  { alias: "Cholesterol Profile", canonical: "Lipid Profile" },
  { alias: "Cholesterol Panel", canonical: "Lipid Profile" },

  { alias: "Electrolytes", canonical: "Serum Electrolytes" },
  { alias: "Serum Electrolyte", canonical: "Serum Electrolytes" },

  { alias: "Preop", canonical: "Pre-Operative Screening" },
  { alias: "Pre Op", canonical: "Pre-Operative Screening" },
  { alias: "Pre Op Screening", canonical: "Pre-Operative Screening" },
  { alias: "Pre Operative Screening", canonical: "Pre-Operative Screening" },

  { alias: "Fever Profile", canonical: "Fever Panel" },
  { alias: "Pyrexia Panel", canonical: "Fever Panel" },

  // ── Haematology ────────────────────────────────────────────────────────────
  { alias: "Hb", canonical: "Haemoglobin" },
  { alias: "Hgb", canonical: "Haemoglobin" },
  { alias: "TLC", canonical: "Total Leucocyte Count" },
  { alias: "WBC Count", canonical: "Total Leucocyte Count" },
  { alias: "DLC", canonical: "Differential Leucocyte Count" },
  { alias: "ANC", canonical: "Absolute Neutrophil Count" },
  { alias: "AEC", canonical: "Absolute Eosinophil Count" },
  { alias: "Platelet", canonical: "Platelet Count" },
  { alias: "PLT", canonical: "Platelet Count" },
  { alias: "PCV", canonical: "PCV / Haematocrit" },
  { alias: "HCT", canonical: "PCV / Haematocrit" },
  { alias: "Hematocrit", canonical: "PCV / Haematocrit" },
  { alias: "Peripheral Smear", canonical: "Peripheral Smear Examination" },
  { alias: "MP", canonical: "Malaria Parasite (Smear)" },
  { alias: "Malaria Parasite", canonical: "Malaria Parasite (Smear)" },
  { alias: "Blood Group", canonical: "Blood Group & Rh Typing" },
  { alias: "Blood Grouping", canonical: "Blood Group & Rh Typing" },

  // ── Coagulation ────────────────────────────────────────────────────────────
  { alias: "PT", canonical: "Prothrombin Time" },
  { alias: "PTT", canonical: "aPTT" },
  { alias: "D Dimer", canonical: "D-Dimer" },

  // ── Liver / renal chemistry ────────────────────────────────────────────────
  { alias: "AST", canonical: "SGOT (AST)" },
  { alias: "SGOT", canonical: "SGOT (AST)" },
  { alias: "ALT", canonical: "SGPT (ALT)" },
  { alias: "SGPT", canonical: "SGPT (ALT)" },
  { alias: "ALP", canonical: "Alkaline Phosphatase" },
  { alias: "GGTP", canonical: "GGT" },
  { alias: "Total Bilirubin", canonical: "Bilirubin Total" },
  { alias: "Serum Bilirubin", canonical: "Bilirubin Total" },
  { alias: "Creatinine", canonical: "Serum Creatinine" },
  { alias: "Sr Creatinine", canonical: "Serum Creatinine" },
  { alias: "Urea", canonical: "Blood Urea" },
  { alias: "BUN", canonical: "Blood Urea Nitrogen" },
  { alias: "Calcium", canonical: "Serum Calcium" },
  { alias: "Sodium", canonical: "Serum Sodium" },
  { alias: "Potassium", canonical: "Serum Potassium" },
  { alias: "Chloride", canonical: "Serum Chloride" },
  { alias: "Bicarbonate", canonical: "Serum Bicarbonate" },
  { alias: "HCO3", canonical: "Serum Bicarbonate" },
  { alias: "ABG", canonical: "Arterial Blood Gas" },
  { alias: "Amylase", canonical: "Serum Amylase" },
  { alias: "Lipase", canonical: "Serum Lipase" },
  { alias: "CPK", canonical: "CPK Total" },

  // ── Lipids and glycaemia ───────────────────────────────────────────────────
  { alias: "Cholesterol", canonical: "Total Cholesterol" },
  { alias: "HDL", canonical: "HDL Cholesterol" },
  { alias: "LDL", canonical: "LDL Cholesterol" },
  { alias: "VLDL", canonical: "VLDL Cholesterol" },
  { alias: "TG", canonical: "Triglycerides" },
  { alias: "Triglyceride", canonical: "Triglycerides" },
  { alias: "A1c", canonical: "HbA1c" },
  { alias: "Glycated Haemoglobin", canonical: "HbA1c" },
  { alias: "Glycosylated Haemoglobin", canonical: "HbA1c" },
  { alias: "FBS", canonical: "Blood Sugar Fasting" },
  { alias: "Fasting Blood Sugar", canonical: "Blood Sugar Fasting" },
  { alias: "Fasting Sugar", canonical: "Blood Sugar Fasting" },
  { alias: "Fasting Glucose", canonical: "Blood Sugar Fasting" },
  { alias: "PPBS", canonical: "Blood Sugar Post Prandial" },
  { alias: "PP Sugar", canonical: "Blood Sugar Post Prandial" },
  { alias: "Post Prandial Sugar", canonical: "Blood Sugar Post Prandial" },
  { alias: "Post Prandial Blood Sugar", canonical: "Blood Sugar Post Prandial" },
  { alias: "RBS", canonical: "Blood Sugar Random" },
  { alias: "Random Blood Sugar", canonical: "Blood Sugar Random" },
  { alias: "Random Sugar", canonical: "Blood Sugar Random" },
  { alias: "OGTT", canonical: "Oral Glucose Tolerance Test" },

  // ── Inflammation, haematinics, endocrine ───────────────────────────────────
  { alias: "CRP", canonical: "CRP (C-Reactive Protein)" },
  { alias: "C Reactive Protein", canonical: "CRP (C-Reactive Protein)" },
  { alias: "Ferritin", canonical: "Serum Ferritin" },
  { alias: "Iron", canonical: "Serum Iron" },
  { alias: "B12", canonical: "Vitamin B12" },
  { alias: "Vit B12", canonical: "Vitamin B12" },
  { alias: "Vit D", canonical: "Vitamin D (25-OH)" },
  { alias: "Vitamin D", canonical: "Vitamin D (25-OH)" },
  { alias: "25 OH Vitamin D", canonical: "Vitamin D (25-OH)" },
  { alias: "FT3", canonical: "Free T3" },
  { alias: "FT4", canonical: "Free T4" },
  { alias: "T3", canonical: "T3 (Total)" },
  { alias: "T4", canonical: "T4 (Total)" },
  { alias: "Cortisol", canonical: "Serum Cortisol (Morning)" },
  { alias: "HCG", canonical: "Beta hCG" },

  // ── Cardiac and tumour markers ─────────────────────────────────────────────
  { alias: "Troponin", canonical: "Troponin I" },
  { alias: "Trop I", canonical: "Troponin I" },
  { alias: "CKMB", canonical: "CK-MB" },
  { alias: "BNP", canonical: "NT-proBNP" },
  { alias: "PSA", canonical: "PSA (Total)" },
  { alias: "AFP", canonical: "Alpha Fetoprotein (AFP)" },

  // ── Serology ───────────────────────────────────────────────────────────────
  { alias: "HIV", canonical: "HIV I & II" },
  { alias: "Australia Antigen", canonical: "HBsAg" },
  { alias: "HCV", canonical: "Anti-HCV" },
  { alias: "VDRL", canonical: "VDRL / RPR" },
  { alias: "RPR", canonical: "VDRL / RPR" },
  { alias: "NS1", canonical: "Dengue NS1 Antigen" },
  { alias: "Dengue NS1", canonical: "Dengue NS1 Antigen" },
  { alias: "Typhidot", canonical: "Typhoid IgM (Typhidot)" },

  // ── Radiology ──────────────────────────────────────────────────────────────
  // "Chest X-ray" with no view specified means the PA film in routine practice; the AP view
  // is what you order for a patient who cannot stand, and that is a deliberate choice.
  { alias: "CXR", canonical: "X-Ray Chest PA View" },
  { alias: "Chest X Ray", canonical: "X-Ray Chest PA View" },
  { alias: "Chest Xray", canonical: "X-Ray Chest PA View" },
  { alias: "X Ray Chest", canonical: "X-Ray Chest PA View" },
  { alias: "Xray Chest", canonical: "X-Ray Chest PA View" },
  { alias: "X Ray KUB", canonical: "X-Ray KUB" },
  { alias: "KUB Xray", canonical: "X-Ray KUB" },

  { alias: "Ultrasound Abdomen", canonical: "USG Abdomen" },
  { alias: "Sonography Abdomen", canonical: "USG Abdomen" },
  { alias: "USG Whole Abdomen", canonical: "USG Abdomen + Pelvis" },
  { alias: "Whole Abdomen Ultrasound", canonical: "USG Abdomen + Pelvis" },
  { alias: "Ultrasound Abdomen and Pelvis", canonical: "USG Abdomen + Pelvis" },
  { alias: "Obstetric Ultrasound", canonical: "USG Obstetric" },
  { alias: "Obstetric Scan", canonical: "USG Obstetric" },

  { alias: "2D Echo", canonical: "2D Echo + Doppler" },
  { alias: "Echo", canonical: "2D Echo + Doppler" },
  { alias: "Echocardiography", canonical: "2D Echo + Doppler" },
  { alias: "Echocardiogram", canonical: "2D Echo + Doppler" },

  { alias: "ECG", canonical: "ECG (12-Lead)" },
  { alias: "EKG", canonical: "ECG (12-Lead)" },
  { alias: "12 Lead ECG", canonical: "ECG (12-Lead)" },
  { alias: "TMT", canonical: "Stress ECG (TMT)" },
  { alias: "Treadmill Test", canonical: "Stress ECG (TMT)" },

  { alias: "CT Head", canonical: "CT Brain Plain" },
  { alias: "CT Brain", canonical: "CT Brain Plain" },
  { alias: "HRCT", canonical: "HRCT Chest" },

  { alias: "Mammogram", canonical: "Mammography Bilateral" },
  { alias: "Mammography", canonical: "Mammography Bilateral" },
  { alias: "DEXA", canonical: "DEXA Scan (Spine + Hip)" },
  { alias: "BMD", canonical: "DEXA Scan (Spine + Hip)" },
  { alias: "Bone Density", canonical: "DEXA Scan (Spine + Hip)" },
];
