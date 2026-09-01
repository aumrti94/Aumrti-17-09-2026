export const DEFAULT_COMPLAINTS: string[] = [
  "Fever", "Cough", "Cold", "Headache", "Body pain", "Vomiting",
  "Diarrhoea", "Chest pain", "Breathlessness", "Abdominal pain",
  "Burning urination", "Knee pain", "Back pain", "Skin rash",
];

export const DEFAULT_EXAM_FINDINGS: string[] = [
  "Conscious & alert", "Well-nourished", "Afebrile", "Febrile",
  "No pallor", "Pallor present", "Mild pallor", "No icterus",
  "Icterus present", "No cyanosis", "No clubbing", "No oedema",
  "Oedema bilateral", "Lymphadenopathy",
];

export const DEFAULT_DIAGNOSES: string[] = [
  "Upper Respiratory Tract Infection", "Hypertension",
  "Type 2 Diabetes Mellitus", "Acute Gastroenteritis", "Migraine",
  "Urinary Tract Infection", "Bronchial Asthma", "Anaemia",
];

export interface RxQuickPickTemplate {
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  duration_days: string;
  instructions: string;
  quantity: string;
}

export const DEFAULT_RX_TEMPLATES: RxQuickPickTemplate[] = [
  { drug_name: "Paracetamol 500mg", dose: "500mg", route: "Oral", frequency: "BD", duration_days: "3", instructions: "Take after food", quantity: "6" },
  { drug_name: "ORS", dose: "1 sachet", route: "Oral", frequency: "TDS", duration_days: "3", instructions: "Dissolve in 1L water", quantity: "9" },
  { drug_name: "Multivitamin", dose: "1 tab", route: "Oral", frequency: "OD", duration_days: "30", instructions: "Take after breakfast", quantity: "30" },
];

// Common tests doctors refer to third-party labs (SRL, Thyrocare, Metropolis, etc.)
export const DEFAULT_LAB_TEMPLATES: string[] = [
  "CBC", "LFT", "KFT", "Lipid Profile", "Blood Sugar Fasting",
  "HbA1c", "TSH", "Urine R/M", "Urine Culture",
  "Serum Creatinine", "Serum Electrolytes", "ECG",
];

// Common studies doctors refer to third-party radiology centres.
// Names must match radiology_study_master verbatim (see the seed in
// 20260903000003_radiology_study_master.sql) — an unmatched name is never ordered
// and never billed, and the quick-pick editor now flags it as off-master.
export const DEFAULT_RADIOLOGY_TEMPLATES: string[] = [
  "X-Ray Chest PA View", "USG Abdomen + Pelvis", "2D Echo + Doppler",
  "MRI Brain", "CT Chest", "X-Ray KUB",
];

// A doctor's personal drag-to-reorder priority for tests/studies within one
// lab category, lab panel, or radiology modality picker (keyed by that
// group's display label/name). One row in doctor_quick_picks holds all of
// them, each entry keyed by groupKey.
export interface TestGroupOrderEntry {
  groupKey: string;
  order: string[];
}

export const QUICK_PICK_DEFAULTS: Record<string, unknown[]> = {
  complaints: DEFAULT_COMPLAINTS,
  exam_findings: DEFAULT_EXAM_FINDINGS,
  diagnoses: DEFAULT_DIAGNOSES,
  rx_templates: DEFAULT_RX_TEMPLATES,
  lab_templates: DEFAULT_LAB_TEMPLATES,
  radiology_templates: DEFAULT_RADIOLOGY_TEMPLATES,
  test_group_order: [],
};
