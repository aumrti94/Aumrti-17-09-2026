-- ────────────────────────────────────────────────────────────────────────────
-- hospital_config_values
-- Replaces all hardcoded dropdown arrays across the codebase with a single,
-- per-hospital configurable lookup table.
-- System-level defaults have hospital_id = NULL and is_system = TRUE.
-- Hospital-specific overrides have hospital_id set and take precedence.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hospital_config_values (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  UUID        REFERENCES hospitals(id) ON DELETE CASCADE,
  category     TEXT        NOT NULL,
  value        TEXT        NOT NULL,
  label        TEXT        NOT NULL,
  sort_order   INT         NOT NULL DEFAULT 0,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  is_system    BOOLEAN     NOT NULL DEFAULT FALSE,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hospital_id, category, value)
);

-- Partial unique index for system defaults (hospital_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_config_system_defaults
  ON hospital_config_values (category, value)
  WHERE hospital_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_hcv_hospital_category
  ON hospital_config_values (hospital_id, category, is_active, sort_order);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_hcv_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_hcv_updated_at ON hospital_config_values;
CREATE TRIGGER trg_hcv_updated_at
  BEFORE UPDATE ON hospital_config_values
  FOR EACH ROW EXECUTE FUNCTION set_hcv_updated_at();

-- RLS: read system defaults OR own hospital; write own hospital only.
-- Uses an inline subquery instead of a helper function to avoid the
-- Supabase "permission denied for schema auth" restriction.
ALTER TABLE hospital_config_values ENABLE ROW LEVEL SECURITY;

-- Drop policies first so this migration is safe to re-run
DROP POLICY IF EXISTS hcv_select ON hospital_config_values;
DROP POLICY IF EXISTS hcv_insert ON hospital_config_values;
DROP POLICY IF EXISTS hcv_update ON hospital_config_values;
DROP POLICY IF EXISTS hcv_delete ON hospital_config_values;

CREATE POLICY hcv_select ON hospital_config_values FOR SELECT
  USING (
    hospital_id IS NULL
    OR hospital_id = (
      SELECT hospital_id FROM public.users
      WHERE  auth_user_id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY hcv_insert ON hospital_config_values FOR INSERT
  WITH CHECK (
    hospital_id = (
      SELECT hospital_id FROM public.users
      WHERE  auth_user_id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY hcv_update ON hospital_config_values FOR UPDATE
  USING (
    hospital_id = (
      SELECT hospital_id FROM public.users
      WHERE  auth_user_id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY hcv_delete ON hospital_config_values FOR DELETE
  USING (
    is_system = FALSE
    AND hospital_id = (
      SELECT hospital_id FROM public.users
      WHERE  auth_user_id = auth.uid() LIMIT 1
    )
  );

-- ── SEED: System Defaults (hospital_id = NULL, is_system = TRUE) ─────────────

INSERT INTO hospital_config_values (hospital_id, category, value, label, sort_order, is_system) VALUES

-- ── 1. Admission Types ───────────────────────────────────────────────────────
(NULL, 'admission_types', 'elective',   'Elective',         10, TRUE),
(NULL, 'admission_types', 'emergency',  'Emergency',        20, TRUE),
(NULL, 'admission_types', 'transfer',   'Transfer In',      30, TRUE),
(NULL, 'admission_types', 'daycare',    'Day Care',         40, TRUE),
(NULL, 'admission_types', 'trauma',     'Trauma',           50, TRUE),

-- ── 2. Insurance / Payer Types ───────────────────────────────────────────────
(NULL, 'insurance_types', 'self_pay',     'Self Pay',             10, TRUE),
(NULL, 'insurance_types', 'insurance',    'Private Insurance',    20, TRUE),
(NULL, 'insurance_types', 'pmjay',        'PMJAY / Ayushman',     30, TRUE),
(NULL, 'insurance_types', 'cghs',         'CGHS',                 40, TRUE),
(NULL, 'insurance_types', 'echs',         'ECHS',                 50, TRUE),
(NULL, 'insurance_types', 'esi',          'ESI / ESIS',           60, TRUE),
(NULL, 'insurance_types', 'corporate',    'Corporate / TPA',      70, TRUE),
(NULL, 'insurance_types', 'state_scheme', 'State Scheme',         80, TRUE),
(NULL, 'insurance_types', 'other',        'Other',                90, TRUE),

-- ── 3. Drug / Medication Routes ──────────────────────────────────────────────
(NULL, 'drug_routes', 'Oral',        'Oral (PO)',         10, TRUE),
(NULL, 'drug_routes', 'IV',          'Intravenous (IV)',  20, TRUE),
(NULL, 'drug_routes', 'IM',          'Intramuscular (IM)',30, TRUE),
(NULL, 'drug_routes', 'SC',          'Subcutaneous (SC)', 40, TRUE),
(NULL, 'drug_routes', 'Topical',     'Topical',           50, TRUE),
(NULL, 'drug_routes', 'Inhaled',     'Inhaled',           60, TRUE),
(NULL, 'drug_routes', 'Sublingual',  'Sublingual (SL)',   70, TRUE),
(NULL, 'drug_routes', 'Rectal',      'Rectal (PR)',       80, TRUE),
(NULL, 'drug_routes', 'Nasal',       'Nasal',             90, TRUE),
(NULL, 'drug_routes', 'Ophthalmic',  'Ophthalmic',       100, TRUE),
(NULL, 'drug_routes', 'Otic',        'Otic (Ear)',        110, TRUE),
(NULL, 'drug_routes', 'Transdermal', 'Transdermal',      120, TRUE),

-- ── 4. Drug Dosing Frequencies ───────────────────────────────────────────────
(NULL, 'drug_frequencies', 'OD',   'OD – Once Daily',             10, TRUE),
(NULL, 'drug_frequencies', 'BD',   'BD – Twice Daily',            20, TRUE),
(NULL, 'drug_frequencies', 'TDS',  'TDS – Three Times Daily',     30, TRUE),
(NULL, 'drug_frequencies', 'QID',  'QID – Four Times Daily',      40, TRUE),
(NULL, 'drug_frequencies', 'Q4H',  'Q4H – Every 4 Hours',         50, TRUE),
(NULL, 'drug_frequencies', 'Q6H',  'Q6H – Every 6 Hours',         60, TRUE),
(NULL, 'drug_frequencies', 'Q8H',  'Q8H – Every 8 Hours',         70, TRUE),
(NULL, 'drug_frequencies', 'Q12H', 'Q12H – Every 12 Hours',       80, TRUE),
(NULL, 'drug_frequencies', 'SOS',  'SOS – As Needed',             90, TRUE),
(NULL, 'drug_frequencies', 'STAT', 'STAT – Immediately',         100, TRUE),
(NULL, 'drug_frequencies', 'HS',   'HS – At Bedtime',            110, TRUE),
(NULL, 'drug_frequencies', 'AC',   'AC – Before Meals',          120, TRUE),
(NULL, 'drug_frequencies', 'PC',   'PC – After Meals',           130, TRUE),

-- ── 5. Leave Types ───────────────────────────────────────────────────────────
(NULL, 'leave_types', 'casual',        'Casual Leave (CL)',         10, TRUE),
(NULL, 'leave_types', 'sick',          'Sick Leave (SL)',            20, TRUE),
(NULL, 'leave_types', 'earned',        'Earned / Privilege Leave',  30, TRUE),
(NULL, 'leave_types', 'maternity',     'Maternity Leave',           40, TRUE),
(NULL, 'leave_types', 'paternity',     'Paternity Leave',           50, TRUE),
(NULL, 'leave_types', 'compensatory',  'Compensatory Off',          60, TRUE),
(NULL, 'leave_types', 'unpaid',        'Unpaid Leave (LWP)',        70, TRUE),
(NULL, 'leave_types', 'study',         'Study / Training Leave',    80, TRUE),
(NULL, 'leave_types', 'emergency',     'Emergency Leave',           90, TRUE),
(NULL, 'leave_types', 'bereavement',   'Bereavement Leave',        100, TRUE),
(NULL, 'leave_types', 'optional',      'Optional / Restricted Holiday', 110, TRUE),

-- ── 6. Attendance Statuses ───────────────────────────────────────────────────
(NULL, 'attendance_statuses', 'present',    'Present',             10, TRUE),
(NULL, 'attendance_statuses', 'absent',     'Absent',              20, TRUE),
(NULL, 'attendance_statuses', 'half_day',   'Half Day',            30, TRUE),
(NULL, 'attendance_statuses', 'late',       'Late Arrival',        40, TRUE),
(NULL, 'attendance_statuses', 'on_leave',   'On Approved Leave',   50, TRUE),
(NULL, 'attendance_statuses', 'holiday',    'Public Holiday',      60, TRUE),
(NULL, 'attendance_statuses', 'wfh',        'Work From Home',      70, TRUE),
(NULL, 'attendance_statuses', 'on_duty',    'On Duty / Deputation',80, TRUE),

-- ── 7. Lab Test Categories ───────────────────────────────────────────────────
(NULL, 'lab_test_categories', 'Haematology',     'Haematology',          10, TRUE),
(NULL, 'lab_test_categories', 'Biochemistry',    'Biochemistry',         20, TRUE),
(NULL, 'lab_test_categories', 'Pathology',       'Pathology / Histology',30, TRUE),
(NULL, 'lab_test_categories', 'Microbiology',    'Microbiology / Culture',40, TRUE),
(NULL, 'lab_test_categories', 'Serology',        'Serology / Immunology',50, TRUE),
(NULL, 'lab_test_categories', 'Endocrinology',   'Endocrinology / Hormones',60, TRUE),
(NULL, 'lab_test_categories', 'Genetics',        'Genetics / Molecular', 70, TRUE),
(NULL, 'lab_test_categories', 'Urology',         'Urology / UA',         80, TRUE),
(NULL, 'lab_test_categories', 'Coagulation',     'Coagulation Studies',  90, TRUE),
(NULL, 'lab_test_categories', 'Other',           'Other / Miscellaneous',99, TRUE),

-- ── 8. Sample Types ──────────────────────────────────────────────────────────
(NULL, 'sample_types', 'Blood',   'Blood (Venous)',    10, TRUE),
(NULL, 'sample_types', 'Urine',   'Urine',             20, TRUE),
(NULL, 'sample_types', 'Stool',   'Stool / Faeces',    30, TRUE),
(NULL, 'sample_types', 'Swab',    'Swab',              40, TRUE),
(NULL, 'sample_types', 'CSF',     'CSF',               50, TRUE),
(NULL, 'sample_types', 'Sputum',  'Sputum',            60, TRUE),
(NULL, 'sample_types', 'Biopsy',  'Biopsy / Tissue',   70, TRUE),
(NULL, 'sample_types', 'Fluid',   'Body Fluid',        80, TRUE),
(NULL, 'sample_types', 'Other',   'Other',             99, TRUE),

-- ── 9. Housekeeping Task Types ───────────────────────────────────────────────
(NULL, 'housekeeping_task_types', 'bed_turnover',       'Bed Turnover',          10, TRUE),
(NULL, 'housekeeping_task_types', 'terminal_cleaning',  'Terminal Cleaning',     20, TRUE),
(NULL, 'housekeeping_task_types', 'routine_cleaning',   'Routine Cleaning',      30, TRUE),
(NULL, 'housekeeping_task_types', 'spill_management',   'Spill Management',      40, TRUE),
(NULL, 'housekeeping_task_types', 'isolation_protocol', 'Isolation Protocol',    50, TRUE),
(NULL, 'housekeeping_task_types', 'ot_cleaning',        'OT Cleaning',           60, TRUE),
(NULL, 'housekeeping_task_types', 'toilet_cleaning',    'Toilet Cleaning',       70, TRUE),
(NULL, 'housekeeping_task_types', 'linen_change',       'Linen Change',          80, TRUE),
(NULL, 'housekeeping_task_types', 'other',              'Other',                 99, TRUE),

-- ── 10. Housekeeping Area Types ──────────────────────────────────────────────
(NULL, 'housekeeping_area_types', 'ward',       'General Ward',      10, TRUE),
(NULL, 'housekeeping_area_types', 'ot',         'Operation Theatre', 20, TRUE),
(NULL, 'housekeeping_area_types', 'icu',        'ICU / HDU',         30, TRUE),
(NULL, 'housekeeping_area_types', 'emergency',  'Emergency / Casualty',40, TRUE),
(NULL, 'housekeeping_area_types', 'outpatient', 'OPD / Outpatient',  50, TRUE),
(NULL, 'housekeeping_area_types', 'toilet',     'Toilet / Washroom', 60, TRUE),
(NULL, 'housekeeping_area_types', 'corridor',   'Corridor',          70, TRUE),
(NULL, 'housekeeping_area_types', 'stairwell',  'Stairwell',         80, TRUE),
(NULL, 'housekeeping_area_types', 'reception',  'Reception / Lobby', 90, TRUE),
(NULL, 'housekeeping_area_types', 'canteen',    'Canteen / Pantry', 100, TRUE),
(NULL, 'housekeeping_area_types', 'pharmacy',   'Pharmacy',         110, TRUE),
(NULL, 'housekeeping_area_types', 'lab',        'Laboratory',       120, TRUE),

-- ── 11. Department Types ─────────────────────────────────────────────────────
(NULL, 'department_types', 'clinical',       'Clinical',       10, TRUE),
(NULL, 'department_types', 'administrative', 'Administrative', 20, TRUE),
(NULL, 'department_types', 'support',        'Support',        30, TRUE),
(NULL, 'department_types', 'diagnostic',     'Diagnostic',     40, TRUE),
(NULL, 'department_types', 'paramedical',    'Paramedical',    50, TRUE),

-- ── 12. Claim Denial Categories ──────────────────────────────────────────────
(NULL, 'claim_denial_categories', 'documentation_missing',  'Documentation Missing',      10, TRUE),
(NULL, 'claim_denial_categories', 'clinical_not_justified', 'Not Clinically Justified',   20, TRUE),
(NULL, 'claim_denial_categories', 'policy_exclusion',       'Policy Exclusion',           30, TRUE),
(NULL, 'claim_denial_categories', 'duplicate_claim',        'Duplicate Claim',            40, TRUE),
(NULL, 'claim_denial_categories', 'technical_error',        'Technical / Coding Error',   50, TRUE),
(NULL, 'claim_denial_categories', 'rate_dispute',           'Rate / Package Dispute',     60, TRUE),
(NULL, 'claim_denial_categories', 'pre_auth_missing',       'Pre-Auth Not Obtained',      70, TRUE),
(NULL, 'claim_denial_categories', 'other',                  'Other',                      99, TRUE),

-- ── 13. Claim Rejection Codes (with labels for appeal guidance) ───────────────
(NULL, 'claim_rejection_codes', 'not_medically_necessary', 'Not Medically Necessary', 10, TRUE),
(NULL, 'claim_rejection_codes', 'policy_exclusion',        'Policy Exclusion',         20, TRUE),
(NULL, 'claim_rejection_codes', 'pre_auth_not_obtained',   'Pre-Auth Not Obtained',    30, TRUE),
(NULL, 'claim_rejection_codes', 'incorrect_icd_code',      'Incorrect ICD Code',       40, TRUE),
(NULL, 'claim_rejection_codes', 'document_deficiency',     'Document Deficiency',      50, TRUE),
(NULL, 'claim_rejection_codes', 'duplicate_claim',         'Duplicate Claim',          60, TRUE),
(NULL, 'claim_rejection_codes', 'rate_mismatch',           'Rate / Package Mismatch',  70, TRUE),
(NULL, 'claim_rejection_codes', 'other',                   'Other',                    99, TRUE),

-- ── 14. TPA Companies ────────────────────────────────────────────────────────
(NULL, 'tpa_companies', 'star_health',     'Star Health',           10, TRUE),
(NULL, 'tpa_companies', 'new_india',       'New India Assurance',   20, TRUE),
(NULL, 'tpa_companies', 'national',        'National Insurance',    30, TRUE),
(NULL, 'tpa_companies', 'united_india',    'United India',          40, TRUE),
(NULL, 'tpa_companies', 'hdfc_ergo',       'HDFC Ergo',             50, TRUE),
(NULL, 'tpa_companies', 'care_health',     'Care Health',           60, TRUE),
(NULL, 'tpa_companies', 'bajaj_allianz',   'Bajaj Allianz',         70, TRUE),
(NULL, 'tpa_companies', 'niva_bupa',       'Niva Bupa',             80, TRUE),
(NULL, 'tpa_companies', 'religare',        'Religare Health',       90, TRUE),
(NULL, 'tpa_companies', 'sbi_health',      'SBI Health',           100, TRUE),
(NULL, 'tpa_companies', 'icici_lombard',   'ICICI Lombard',        110, TRUE),
(NULL, 'tpa_companies', 'aditya_birla',    'Aditya Birla Health',  120, TRUE),
(NULL, 'tpa_companies', 'manipal_cigna',   'ManipalCigna',         130, TRUE),
(NULL, 'tpa_companies', 'iffco_tokio',     'Iffco Tokio',          140, TRUE),
(NULL, 'tpa_companies', 'royal_sundaram',  'Royal Sundaram',       150, TRUE),
(NULL, 'tpa_companies', 'oriental',        'Oriental Insurance',   160, TRUE),
(NULL, 'tpa_companies', 'cholamandalam',   'Cholamandalam MS',     170, TRUE),
(NULL, 'tpa_companies', 'tata_aig',        'Tata AIG',             180, TRUE),

-- ── 15. Government Schemes ───────────────────────────────────────────────────
(NULL, 'government_schemes', 'pmjay',        'PMJAY / Ayushman Bharat',      10, TRUE),
(NULL, 'government_schemes', 'cghs',         'CGHS – Central Govt.',         20, TRUE),
(NULL, 'government_schemes', 'echs',         'ECHS – Ex-Servicemen',         30, TRUE),
(NULL, 'government_schemes', 'esi',          'ESI / ESIS',                   40, TRUE),
(NULL, 'government_schemes', 'arogyasri',    'Arogyasri (Telangana)',         50, TRUE),
(NULL, 'government_schemes', 'mgnregs',      'MGNREGS Rashtriya',            60, TRUE),
(NULL, 'government_schemes', 'state_scheme', 'State Health Scheme (Other)',  70, TRUE),

-- ── 16. Dialysis Complications ───────────────────────────────────────────────
(NULL, 'dialysis_complications', 'hypotension',       'Hypotension',           10, TRUE),
(NULL, 'dialysis_complications', 'cramps',            'Muscle Cramps',         20, TRUE),
(NULL, 'dialysis_complications', 'nausea_vomiting',   'Nausea / Vomiting',    30, TRUE),
(NULL, 'dialysis_complications', 'headache',          'Headache',              40, TRUE),
(NULL, 'dialysis_complications', 'chest_pain',        'Chest Pain',            50, TRUE),
(NULL, 'dialysis_complications', 'arrhythmia',        'Arrhythmia',            60, TRUE),
(NULL, 'dialysis_complications', 'dialyzer_reaction', 'Dialyzer Reaction',     70, TRUE),
(NULL, 'dialysis_complications', 'air_embolism',      'Air Embolism',          80, TRUE),
(NULL, 'dialysis_complications', 'other',             'Other',                 99, TRUE),

-- ── 17. Death Manner Types ───────────────────────────────────────────────────
(NULL, 'death_manner_types', 'natural',       'Natural',       10, TRUE),
(NULL, 'death_manner_types', 'accident',      'Accidental',    20, TRUE),
(NULL, 'death_manner_types', 'suicide',       'Suicide',       30, TRUE),
(NULL, 'death_manner_types', 'homicide',      'Homicide',      40, TRUE),
(NULL, 'death_manner_types', 'undetermined',  'Undetermined',  50, TRUE),

-- ── 18. Record Requester Types ───────────────────────────────────────────────
(NULL, 'record_requester_types', 'patient',           'Patient (Self)',         10, TRUE),
(NULL, 'record_requester_types', 'legal_guardian',    'Legal Guardian',         20, TRUE),
(NULL, 'record_requester_types', 'lawyer',            'Advocate / Lawyer',      30, TRUE),
(NULL, 'record_requester_types', 'insurance',         'Insurance / TPA',        40, TRUE),
(NULL, 'record_requester_types', 'police',            'Police',                 50, TRUE),
(NULL, 'record_requester_types', 'court',             'Court Order',            60, TRUE),
(NULL, 'record_requester_types', 'government',        'Government Authority',   70, TRUE),
(NULL, 'record_requester_types', 'treating_doctor',   'Treating Doctor',        80, TRUE),
(NULL, 'record_requester_types', 'employer',          'Employer',               90, TRUE),
(NULL, 'record_requester_types', 'research',          'Research / Academic',   100, TRUE),

-- ── 19. Home Care Services ───────────────────────────────────────────────────
(NULL, 'home_care_services', 'wound_dressing',  'Wound Dressing',              10, TRUE),
(NULL, 'home_care_services', 'iv_therapy',      'IV / Infusion Therapy',       20, TRUE),
(NULL, 'home_care_services', 'physiotherapy',   'Physiotherapy',               30, TRUE),
(NULL, 'home_care_services', 'nursing_care',    'General Nursing Care',        40, TRUE),
(NULL, 'home_care_services', 'doctor_visit',    'Doctor Home Visit',           50, TRUE),
(NULL, 'home_care_services', 'sample_collection','Sample Collection',          60, TRUE),
(NULL, 'home_care_services', 'catheter_care',   'Catheter Care',               70, TRUE),
(NULL, 'home_care_services', 'icu_at_home',     'ICU at Home',                 80, TRUE),
(NULL, 'home_care_services', 'newborn_care',    'Newborn / Neonatal Care',     90, TRUE),
(NULL, 'home_care_services', 'palliative',      'Palliative / End-of-Life',   100, TRUE),
(NULL, 'home_care_services', 'other',           'Other',                       99, TRUE),

-- ── 20. Equipment Categories ─────────────────────────────────────────────────
(NULL, 'equipment_categories', 'diagnostic',    'Diagnostic',            10, TRUE),
(NULL, 'equipment_categories', 'therapeutic',   'Therapeutic',           20, TRUE),
(NULL, 'equipment_categories', 'monitoring',    'Patient Monitoring',    30, TRUE),
(NULL, 'equipment_categories', 'laboratory',    'Laboratory',            40, TRUE),
(NULL, 'equipment_categories', 'surgical',      'Surgical Instruments',  50, TRUE),
(NULL, 'equipment_categories', 'ot_equipment',  'OT Equipment',          60, TRUE),
(NULL, 'equipment_categories', 'it_equipment',  'IT / Computers',        70, TRUE),
(NULL, 'equipment_categories', 'utility',       'Utility / Electrical',  80, TRUE),
(NULL, 'equipment_categories', 'radiation',     'Radiation / Imaging',   90, TRUE),
(NULL, 'equipment_categories', 'other',         'Other',                 99, TRUE),

-- ── 21. Inventory / Stock Categories ─────────────────────────────────────────
(NULL, 'inventory_categories', 'surgical',    'Surgical Supplies',     10, TRUE),
(NULL, 'inventory_categories', 'consumable',  'Consumables',           20, TRUE),
(NULL, 'inventory_categories', 'linen',       'Linen',                 30, TRUE),
(NULL, 'inventory_categories', 'medical_gas', 'Medical Gases',         40, TRUE),
(NULL, 'inventory_categories', 'diagnostic',  'Diagnostic Reagents',   50, TRUE),
(NULL, 'inventory_categories', 'ppe',         'PPE',                   60, TRUE),
(NULL, 'inventory_categories', 'stationery',  'Stationery / Forms',    70, TRUE),
(NULL, 'inventory_categories', 'other',       'Other',                 99, TRUE),

-- ── 22. Physiotherapy Modalities ─────────────────────────────────────────────
(NULL, 'physio_modalities', 'UST',         'Ultrasound Therapy (UST)', 10, TRUE),
(NULL, 'physio_modalities', 'IFT',         'Interferential Therapy (IFT)',20, TRUE),
(NULL, 'physio_modalities', 'TENS',        'TENS',                     30, TRUE),
(NULL, 'physio_modalities', 'SWD',         'Short Wave Diathermy (SWD)',40, TRUE),
(NULL, 'physio_modalities', 'Laser',       'Low Level Laser Therapy',  50, TRUE),
(NULL, 'physio_modalities', 'Hot_Pack',    'Hot Pack / Fomentation',   60, TRUE),
(NULL, 'physio_modalities', 'Cold_Pack',   'Cold Pack / Ice',          70, TRUE),
(NULL, 'physio_modalities', 'Wax_Bath',    'Wax Bath (Paraffin)',       80, TRUE),
(NULL, 'physio_modalities', 'Traction',    'Traction',                 90, TRUE),
(NULL, 'physio_modalities', 'Exercise',    'Therapeutic Exercise',    100, TRUE),
(NULL, 'physio_modalities', 'Hydrotherapy','Hydrotherapy',            110, TRUE),
(NULL, 'physio_modalities', 'Other',       'Other',                    99, TRUE)

ON CONFLICT DO NOTHING;
