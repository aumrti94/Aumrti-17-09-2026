-- Phase 11: Clinical Guidelines Engine

CREATE TABLE IF NOT EXISTS clinical_guidelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid,               -- null = system-wide default
  condition_name text NOT NULL,
  icd10_codes text[] DEFAULT '{}',
  guideline_source text,          -- RSSDI, JNC8, WHO, ICMR, custom
  mandatory_investigations text[] DEFAULT '{}',
  red_flags text[] DEFAULT '{}',
  first_line_treatment text,
  escalation_criteria text,
  contraindications text[] DEFAULT '{}',
  monitoring_parameters text[] DEFAULT '{}',
  review_frequency text,
  effective_from date DEFAULT current_date,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS guideline_adherence_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  encounter_id uuid,
  guideline_id uuid REFERENCES clinical_guidelines(id) ON DELETE SET NULL,
  flags_shown text[] DEFAULT '{}',
  flags_acknowledged text[] DEFAULT '{}',
  deviation_reason text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guidelines_condition ON clinical_guidelines(condition_name) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_guidelines_icd ON clinical_guidelines USING gin(icd10_codes);
CREATE INDEX IF NOT EXISTS idx_guideline_log_patient ON guideline_adherence_log(patient_id);

ALTER TABLE guideline_adherence_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guideline_log_isolation" ON guideline_adherence_log
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "guideline_log_service_role" ON guideline_adherence_log TO service_role USING (true) WITH CHECK (true);

-- clinical_guidelines is readable by all authenticated hospital users
ALTER TABLE clinical_guidelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guidelines_read" ON clinical_guidelines FOR SELECT
  USING (hospital_id IS NULL OR hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "guidelines_write" ON clinical_guidelines FOR ALL
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "guidelines_service_role" ON clinical_guidelines TO service_role USING (true) WITH CHECK (true);

-- Seed standard guidelines
INSERT INTO clinical_guidelines (condition_name, icd10_codes, guideline_source, mandatory_investigations, red_flags, first_line_treatment, monitoring_parameters, review_frequency) VALUES
(
  'Type 2 Diabetes Mellitus',
  ARRAY['E11', 'E11.9', 'E11.65'],
  'RSSDI 2024 / ADA 2024',
  ARRAY['HbA1c', 'Fasting Blood Sugar', 'Post-prandial Blood Sugar', 'Urine ACR', 'eGFR', 'Lipid profile', 'Fundoscopy', 'Foot examination'],
  ARRAY['HbA1c > 10%', 'Blood glucose > 400 mg/dL', 'Ketones in urine', 'Severe hypoglycaemia', 'Signs of DKA'],
  'Metformin 500mg BD with meals if eGFR > 30. Lifestyle modification (diet + exercise). SGLT2i or GLP-1 RA if CVD risk high.',
  ARRAY['HbA1c every 3 months until target, then 6 monthly', 'BP at every visit', 'Weight and BMI', 'Urine ACR annually', 'Foot exam at every visit'],
  'Every 3 months'
),
(
  'Hypertension',
  ARRAY['I10', 'I11', 'I12', 'I13'],
  'JNC8 / ESH 2023 / Indian guidelines',
  ARRAY['Blood pressure both arms', 'ECG', 'Serum creatinine', 'Urine routine', 'Fasting lipids', 'Blood glucose', 'Fundoscopy'],
  ARRAY['BP > 180/110 (hypertensive crisis)', 'Chest pain with high BP', 'Papilloedema', 'Hematuria', 'Severe headache with neurological symptoms'],
  'Lifestyle modification (DASH diet, exercise, salt restriction < 5g/day). First-line: ACE inhibitor or ARB, CCB, or thiazide. Target BP < 130/80 mmHg.',
  ARRAY['BP at every visit', 'Renal function 1-3 monthly on ACEi/ARB', 'Electrolytes on diuretics'],
  'Monthly until target, then 3-monthly'
),
(
  'Pulmonary Tuberculosis',
  ARRAY['A15', 'A15.0', 'A15.9'],
  'RNTCP/NTEP 2022',
  ARRAY['CBNAAT / GeneXpert sputum', 'AFB smear x2', 'Chest X-ray', 'LFT', 'HIV test', 'Blood sugar'],
  ARRAY['Haemoptysis > 200 mL', 'Respiratory failure', 'Miliary TB on CXR', 'TB meningitis features', 'MDR TB suspected'],
  '4-drug RHEZ (Rifampicin + Isoniazid + Ethambutol + Pyrazinamide) for 2 months intensive phase, then 2-drug RH for 4 months. DOTS mandatory. Notify to NIKSHAY portal.',
  ARRAY['Monthly sputum smear', 'LFT monthly for first 2 months', 'Visual acuity on Ethambutol', 'Weight monthly', 'Symptom check at every visit'],
  'Monthly'
),
(
  'Malaria',
  ARRAY['B50', 'B51', 'B52', 'B53'],
  'WHO 2023 / NVBDCP India',
  ARRAY['Peripheral blood film (thick & thin)', 'Malaria RDT', 'Plasmodium species identification', 'Haemoglobin', 'Platelet count', 'Renal function'],
  ARRAY['Altered consciousness', 'Severe anaemia (Hb < 7 g/dL)', 'Respiratory distress', 'Renal failure', 'Jaundice with high parasitaemia', 'Hypoglycaemia'],
  'P. falciparum: Artemisinin-based combination therapy (ACT) — Artesunate + Mefloquine or AL. P. vivax: Chloroquine + Primaquine (check G6PD before primaquine). Severe malaria: IV Artesunate.',
  ARRAY['Blood film D3, D7, D28 for treatment response', 'Haemoglobin weekly', 'Renal function in severe cases'],
  'Day 3, Day 7, Day 28 follow-up'
),
(
  'Sepsis',
  ARRAY['A41', 'A41.9', 'R65.20', 'R65.21'],
  'Surviving Sepsis Campaign 2021',
  ARRAY['Blood culture x2 (before antibiotics)', 'CBC with differential', 'Procalcitonin', 'Lactate', 'CRP', 'LFT', 'RFT', 'Coagulation profile', 'Urine culture', 'Chest X-ray'],
  ARRAY['Lactate > 2 mmol/L', 'Hypotension (MAP < 65 mmHg)', 'qSOFA score >= 2', 'Altered mentation', 'Respiratory rate > 22'],
  'Hour-1 Bundle: Blood cultures → IV broad-spectrum antibiotics within 1 hour → IV crystalloids 30 mL/kg if hypotension → Vasopressors if MAP < 65 → Measure lactate.',
  ARRAY['Hourly vital signs', 'Urine output hourly (target > 0.5 mL/kg/hr)', 'Repeat lactate at 2 hours', 'Blood glucose 2-hourly', 'Daily review for antibiotic de-escalation'],
  'Hourly monitoring initially'
)
ON CONFLICT DO NOTHING;
