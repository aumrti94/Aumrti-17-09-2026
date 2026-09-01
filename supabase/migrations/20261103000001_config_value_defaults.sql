-- ────────────────────────────────────────────────────────────────────────────
-- Config value defaults — full system seed
--
-- Mirrors src/constants/configValueDefaults.ts, which is now the single source
-- of truth for dropdown defaults. src/constants/configValueDefaults.test.ts
-- parses this file and fails the build if the two drift.
--
-- Why re-assert values 20260531150001 already seeded: that migration did not
-- land everywhere (docs/db-audit/02_COMPLETE_TABLE_INVENTORY.csv records ~39
-- live rows against ~200 in the seed), and an unseeded category renders an
-- empty dropdown. ON CONFLICT DO NOTHING against uq_config_system_defaults
-- makes this a no-op where the rows exist and a repair where they do not — it
-- never overwrites a label an environment has deliberately diverged on.
--
-- New here:
--   • allergy_types        — never seeded anywhere, the one genuinely missing list
--   • emergency_drug_routes / vaccine_routes — module vocabularies that were
--     hardcoded in the components until now
--   • compatibility values (sort_order >= 200) — values a module was already
--     writing before it was wired to this table, kept selectable so nothing
--     already saved becomes unreadable
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. allergen_type vocabulary ─────────────────────────────────────────────
-- allergy_records.allergen_type was pinned to five values by an inline CHECK in
-- 20261016000010. The allergy_types list is richer than that, and a configured
-- value that the column rejects is worse than no list at all. Widening a CHECK
-- cannot invalidate an existing row.

ALTER TABLE public.allergy_records
  DROP CONSTRAINT IF EXISTS allergy_records_allergen_type_check;

ALTER TABLE public.allergy_records
  ADD CONSTRAINT allergy_records_allergen_type_check
  CHECK (allergen_type IN ('drug', 'food', 'environmental', 'latex', 'contrast',
                           'insect', 'pollen', 'animal_dander', 'other'));

-- ── 2. System defaults (hospital_id = NULL, is_system = TRUE) ────────────────

INSERT INTO public.hospital_config_values
  (hospital_id, category, value, label, sort_order, is_active, is_system)
VALUES
  -- admission_types
  (NULL, 'admission_types', 'elective', 'Elective', 10, TRUE, TRUE),
  (NULL, 'admission_types', 'emergency', 'Emergency', 20, TRUE, TRUE),
  (NULL, 'admission_types', 'transfer', 'Transfer In', 30, TRUE, TRUE),
  (NULL, 'admission_types', 'daycare', 'Day Care', 40, TRUE, TRUE),
  (NULL, 'admission_types', 'trauma', 'Trauma', 50, TRUE, TRUE),
  -- allergy_types
  (NULL, 'allergy_types', 'drug', 'Drug', 10, TRUE, TRUE),
  (NULL, 'allergy_types', 'food', 'Food', 20, TRUE, TRUE),
  (NULL, 'allergy_types', 'environmental', 'Environmental', 30, TRUE, TRUE),
  (NULL, 'allergy_types', 'latex', 'Latex', 40, TRUE, TRUE),
  (NULL, 'allergy_types', 'contrast', 'Contrast / Dye', 50, TRUE, TRUE),
  (NULL, 'allergy_types', 'insect', 'Insect Sting', 60, TRUE, TRUE),
  (NULL, 'allergy_types', 'pollen', 'Pollen / Dust', 70, TRUE, TRUE),
  (NULL, 'allergy_types', 'animal_dander', 'Animal Dander', 80, TRUE, TRUE),
  (NULL, 'allergy_types', 'other', 'Other', 99, TRUE, TRUE),
  -- insurance_types
  (NULL, 'insurance_types', 'self_pay', 'Self Pay', 10, TRUE, TRUE),
  (NULL, 'insurance_types', 'insurance', 'Private Insurance', 20, TRUE, TRUE),
  (NULL, 'insurance_types', 'pmjay', 'PMJAY / Ayushman', 30, TRUE, TRUE),
  (NULL, 'insurance_types', 'cghs', 'CGHS', 40, TRUE, TRUE),
  (NULL, 'insurance_types', 'echs', 'ECHS', 50, TRUE, TRUE),
  (NULL, 'insurance_types', 'esi', 'ESI / ESIS', 60, TRUE, TRUE),
  (NULL, 'insurance_types', 'corporate', 'Corporate / TPA', 70, TRUE, TRUE),
  (NULL, 'insurance_types', 'state_scheme', 'State Scheme', 80, TRUE, TRUE),
  (NULL, 'insurance_types', 'other', 'Other', 90, TRUE, TRUE),
  -- drug_routes
  (NULL, 'drug_routes', 'Oral', 'Oral (PO)', 10, TRUE, TRUE),
  (NULL, 'drug_routes', 'IV', 'Intravenous (IV)', 20, TRUE, TRUE),
  (NULL, 'drug_routes', 'IM', 'Intramuscular (IM)', 30, TRUE, TRUE),
  (NULL, 'drug_routes', 'SC', 'Subcutaneous (SC)', 40, TRUE, TRUE),
  (NULL, 'drug_routes', 'Topical', 'Topical', 50, TRUE, TRUE),
  (NULL, 'drug_routes', 'Inhaled', 'Inhaled', 60, TRUE, TRUE),
  (NULL, 'drug_routes', 'Sublingual', 'Sublingual (SL)', 70, TRUE, TRUE),
  (NULL, 'drug_routes', 'Rectal', 'Rectal (PR)', 80, TRUE, TRUE),
  (NULL, 'drug_routes', 'Nasal', 'Nasal', 90, TRUE, TRUE),
  (NULL, 'drug_routes', 'Ophthalmic', 'Ophthalmic', 100, TRUE, TRUE),
  (NULL, 'drug_routes', 'Otic', 'Otic (Ear)', 110, TRUE, TRUE),
  (NULL, 'drug_routes', 'Transdermal', 'Transdermal', 120, TRUE, TRUE),
  (NULL, 'drug_routes', 'Inhalation', 'Inhalation', 210, TRUE, TRUE),
  -- drug_frequencies
  (NULL, 'drug_frequencies', 'OD', 'OD – Once Daily', 10, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'BD', 'BD – Twice Daily', 20, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'TDS', 'TDS – Three Times Daily', 30, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'QID', 'QID – Four Times Daily', 40, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'Q4H', 'Q4H – Every 4 Hours', 50, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'Q6H', 'Q6H – Every 6 Hours', 60, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'Q8H', 'Q8H – Every 8 Hours', 70, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'Q12H', 'Q12H – Every 12 Hours', 80, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'SOS', 'SOS – As Needed', 90, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'STAT', 'STAT – Immediately', 100, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'HS', 'HS – At Bedtime', 110, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'AC', 'AC – Before Meals', 120, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'PC', 'PC – After Meals', 130, TRUE, TRUE),
  (NULL, 'drug_frequencies', 'Weekly', 'Weekly', 210, TRUE, TRUE),
  -- dialysis_complications
  (NULL, 'dialysis_complications', 'hypotension', 'Hypotension', 10, TRUE, TRUE),
  (NULL, 'dialysis_complications', 'cramps', 'Muscle Cramps', 20, TRUE, TRUE),
  (NULL, 'dialysis_complications', 'nausea_vomiting', 'Nausea / Vomiting', 30, TRUE, TRUE),
  (NULL, 'dialysis_complications', 'headache', 'Headache', 40, TRUE, TRUE),
  (NULL, 'dialysis_complications', 'chest_pain', 'Chest Pain', 50, TRUE, TRUE),
  (NULL, 'dialysis_complications', 'arrhythmia', 'Arrhythmia', 60, TRUE, TRUE),
  (NULL, 'dialysis_complications', 'dialyzer_reaction', 'Dialyzer Reaction', 70, TRUE, TRUE),
  (NULL, 'dialysis_complications', 'air_embolism', 'Air Embolism', 80, TRUE, TRUE),
  (NULL, 'dialysis_complications', 'other', 'Other', 99, TRUE, TRUE),
  -- death_manner_types
  (NULL, 'death_manner_types', 'natural', 'Natural', 10, TRUE, TRUE),
  (NULL, 'death_manner_types', 'accident', 'Accidental', 20, TRUE, TRUE),
  (NULL, 'death_manner_types', 'suicide', 'Suicide', 30, TRUE, TRUE),
  (NULL, 'death_manner_types', 'homicide', 'Homicide', 40, TRUE, TRUE),
  (NULL, 'death_manner_types', 'undetermined', 'Undetermined', 50, TRUE, TRUE),
  -- record_requester_types
  (NULL, 'record_requester_types', 'patient', 'Patient (Self)', 10, TRUE, TRUE),
  (NULL, 'record_requester_types', 'legal_guardian', 'Legal Guardian', 20, TRUE, TRUE),
  (NULL, 'record_requester_types', 'lawyer', 'Advocate / Lawyer', 30, TRUE, TRUE),
  (NULL, 'record_requester_types', 'insurance', 'Insurance / TPA', 40, TRUE, TRUE),
  (NULL, 'record_requester_types', 'police', 'Police', 50, TRUE, TRUE),
  (NULL, 'record_requester_types', 'court', 'Court Order', 60, TRUE, TRUE),
  (NULL, 'record_requester_types', 'government', 'Government Authority', 70, TRUE, TRUE),
  (NULL, 'record_requester_types', 'treating_doctor', 'Treating Doctor', 80, TRUE, TRUE),
  (NULL, 'record_requester_types', 'employer', 'Employer', 90, TRUE, TRUE),
  (NULL, 'record_requester_types', 'research', 'Research / Academic', 100, TRUE, TRUE),
  -- home_care_services
  (NULL, 'home_care_services', 'wound_dressing', 'Wound Dressing', 10, TRUE, TRUE),
  (NULL, 'home_care_services', 'iv_therapy', 'IV / Infusion Therapy', 20, TRUE, TRUE),
  (NULL, 'home_care_services', 'physiotherapy', 'Physiotherapy', 30, TRUE, TRUE),
  (NULL, 'home_care_services', 'nursing_care', 'General Nursing Care', 40, TRUE, TRUE),
  (NULL, 'home_care_services', 'doctor_visit', 'Doctor Home Visit', 50, TRUE, TRUE),
  (NULL, 'home_care_services', 'sample_collection', 'Sample Collection', 60, TRUE, TRUE),
  (NULL, 'home_care_services', 'catheter_care', 'Catheter Care', 70, TRUE, TRUE),
  (NULL, 'home_care_services', 'icu_at_home', 'ICU at Home', 80, TRUE, TRUE),
  (NULL, 'home_care_services', 'newborn_care', 'Newborn / Neonatal Care', 90, TRUE, TRUE),
  (NULL, 'home_care_services', 'palliative', 'Palliative / End-of-Life', 100, TRUE, TRUE),
  (NULL, 'home_care_services', 'other', 'Other', 110, TRUE, TRUE),
  (NULL, 'home_care_services', 'Wound dressing', 'Wound dressing', 210, TRUE, TRUE),
  (NULL, 'home_care_services', 'IV antibiotics', 'IV antibiotics', 220, TRUE, TRUE),
  (NULL, 'home_care_services', 'Physiotherapy', 'Physiotherapy', 230, TRUE, TRUE),
  (NULL, 'home_care_services', 'Vitals monitoring', 'Vitals monitoring', 240, TRUE, TRUE),
  (NULL, 'home_care_services', 'Medication administration', 'Medication administration', 250, TRUE, TRUE),
  (NULL, 'home_care_services', 'Catheter care', 'Catheter care', 260, TRUE, TRUE),
  (NULL, 'home_care_services', 'Nasogastric tube care', 'Nasogastric tube care', 270, TRUE, TRUE),
  (NULL, 'home_care_services', 'Oxygen therapy', 'Oxygen therapy', 280, TRUE, TRUE),
  (NULL, 'home_care_services', 'Blood sugar monitoring', 'Blood sugar monitoring', 290, TRUE, TRUE),
  (NULL, 'home_care_services', 'Palliative care', 'Palliative care', 300, TRUE, TRUE),
  -- physio_modalities
  (NULL, 'physio_modalities', 'UST', 'Ultrasound Therapy (UST)', 10, TRUE, TRUE),
  (NULL, 'physio_modalities', 'IFT', 'Interferential Therapy (IFT)', 20, TRUE, TRUE),
  (NULL, 'physio_modalities', 'TENS', 'TENS', 30, TRUE, TRUE),
  (NULL, 'physio_modalities', 'SWD', 'Short Wave Diathermy (SWD)', 40, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Laser', 'Low Level Laser Therapy', 50, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Hot_Pack', 'Hot Pack / Fomentation', 60, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Cold_Pack', 'Cold Pack / Ice', 70, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Wax_Bath', 'Wax Bath (Paraffin)', 80, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Traction', 'Traction', 90, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Exercise', 'Therapeutic Exercise', 100, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Hydrotherapy', 'Hydrotherapy', 110, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Other', 'Other', 99, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Manual Therapy', 'Manual Therapy', 210, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Balance Training', 'Balance Training', 220, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Hot Pack', 'Hot Pack', 230, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Cold Pack', 'Cold Pack', 240, TRUE, TRUE),
  (NULL, 'physio_modalities', 'Wax Bath', 'Wax Bath', 250, TRUE, TRUE),
  -- leave_types
  (NULL, 'leave_types', 'casual', 'Casual Leave (CL)', 10, TRUE, TRUE),
  (NULL, 'leave_types', 'sick', 'Sick Leave (SL)', 20, TRUE, TRUE),
  (NULL, 'leave_types', 'earned', 'Earned / Privilege Leave', 30, TRUE, TRUE),
  (NULL, 'leave_types', 'maternity', 'Maternity Leave', 40, TRUE, TRUE),
  (NULL, 'leave_types', 'paternity', 'Paternity Leave', 50, TRUE, TRUE),
  (NULL, 'leave_types', 'compensatory', 'Compensatory Off', 60, TRUE, TRUE),
  (NULL, 'leave_types', 'unpaid', 'Unpaid Leave (LWP)', 70, TRUE, TRUE),
  (NULL, 'leave_types', 'study', 'Study / Training Leave', 80, TRUE, TRUE),
  (NULL, 'leave_types', 'emergency', 'Emergency Leave', 90, TRUE, TRUE),
  (NULL, 'leave_types', 'bereavement', 'Bereavement Leave', 100, TRUE, TRUE),
  (NULL, 'leave_types', 'optional', 'Optional / Restricted Holiday', 110, TRUE, TRUE),
  -- attendance_statuses
  (NULL, 'attendance_statuses', 'present', 'Present', 10, TRUE, TRUE),
  (NULL, 'attendance_statuses', 'absent', 'Absent', 20, TRUE, TRUE),
  (NULL, 'attendance_statuses', 'half_day', 'Half Day', 30, TRUE, TRUE),
  (NULL, 'attendance_statuses', 'late', 'Late Arrival', 40, TRUE, TRUE),
  (NULL, 'attendance_statuses', 'on_leave', 'On Approved Leave', 50, TRUE, TRUE),
  (NULL, 'attendance_statuses', 'holiday', 'Public Holiday', 60, TRUE, TRUE),
  (NULL, 'attendance_statuses', 'wfh', 'Work From Home', 70, TRUE, TRUE),
  (NULL, 'attendance_statuses', 'on_duty', 'On Duty / Deputation', 80, TRUE, TRUE),
  -- tpa_companies
  (NULL, 'tpa_companies', 'star_health', 'Star Health', 10, TRUE, TRUE),
  (NULL, 'tpa_companies', 'new_india', 'New India Assurance', 20, TRUE, TRUE),
  (NULL, 'tpa_companies', 'national', 'National Insurance', 30, TRUE, TRUE),
  (NULL, 'tpa_companies', 'united_india', 'United India', 40, TRUE, TRUE),
  (NULL, 'tpa_companies', 'hdfc_ergo', 'HDFC Ergo', 50, TRUE, TRUE),
  (NULL, 'tpa_companies', 'care_health', 'Care Health', 60, TRUE, TRUE),
  (NULL, 'tpa_companies', 'bajaj_allianz', 'Bajaj Allianz', 70, TRUE, TRUE),
  (NULL, 'tpa_companies', 'niva_bupa', 'Niva Bupa', 80, TRUE, TRUE),
  (NULL, 'tpa_companies', 'religare', 'Religare Health', 90, TRUE, TRUE),
  (NULL, 'tpa_companies', 'sbi_health', 'SBI Health', 100, TRUE, TRUE),
  (NULL, 'tpa_companies', 'icici_lombard', 'ICICI Lombard', 110, TRUE, TRUE),
  (NULL, 'tpa_companies', 'aditya_birla', 'Aditya Birla Health', 120, TRUE, TRUE),
  (NULL, 'tpa_companies', 'manipal_cigna', 'ManipalCigna', 130, TRUE, TRUE),
  (NULL, 'tpa_companies', 'iffco_tokio', 'Iffco Tokio', 140, TRUE, TRUE),
  (NULL, 'tpa_companies', 'royal_sundaram', 'Royal Sundaram', 150, TRUE, TRUE),
  (NULL, 'tpa_companies', 'oriental', 'Oriental Insurance', 160, TRUE, TRUE),
  (NULL, 'tpa_companies', 'cholamandalam', 'Cholamandalam MS', 170, TRUE, TRUE),
  (NULL, 'tpa_companies', 'tata_aig', 'Tata AIG', 180, TRUE, TRUE),
  -- government_schemes
  (NULL, 'government_schemes', 'pmjay', 'PMJAY / Ayushman Bharat', 10, TRUE, TRUE),
  (NULL, 'government_schemes', 'cghs', 'CGHS – Central Govt.', 20, TRUE, TRUE),
  (NULL, 'government_schemes', 'echs', 'ECHS – Ex-Servicemen', 30, TRUE, TRUE),
  (NULL, 'government_schemes', 'esi', 'ESI / ESIS', 40, TRUE, TRUE),
  (NULL, 'government_schemes', 'arogyasri', 'Arogyasri (Telangana)', 50, TRUE, TRUE),
  (NULL, 'government_schemes', 'mgnregs', 'MGNREGS Rashtriya', 60, TRUE, TRUE),
  (NULL, 'government_schemes', 'state_scheme', 'State Health Scheme (Other)', 70, TRUE, TRUE),
  -- claim_denial_categories
  (NULL, 'claim_denial_categories', 'documentation_missing', 'Documentation Missing', 10, TRUE, TRUE),
  (NULL, 'claim_denial_categories', 'clinical_not_justified', 'Not Clinically Justified', 20, TRUE, TRUE),
  (NULL, 'claim_denial_categories', 'policy_exclusion', 'Policy Exclusion', 30, TRUE, TRUE),
  (NULL, 'claim_denial_categories', 'duplicate_claim', 'Duplicate Claim', 40, TRUE, TRUE),
  (NULL, 'claim_denial_categories', 'technical_error', 'Technical / Coding Error', 50, TRUE, TRUE),
  (NULL, 'claim_denial_categories', 'rate_dispute', 'Rate / Package Dispute', 60, TRUE, TRUE),
  (NULL, 'claim_denial_categories', 'pre_auth_missing', 'Pre-Auth Not Obtained', 70, TRUE, TRUE),
  (NULL, 'claim_denial_categories', 'other', 'Other', 99, TRUE, TRUE),
  -- claim_rejection_codes
  (NULL, 'claim_rejection_codes', 'not_medically_necessary', 'Not Medically Necessary', 10, TRUE, TRUE),
  (NULL, 'claim_rejection_codes', 'policy_exclusion', 'Policy Exclusion', 20, TRUE, TRUE),
  (NULL, 'claim_rejection_codes', 'pre_auth_not_obtained', 'Pre-Auth Not Obtained', 30, TRUE, TRUE),
  (NULL, 'claim_rejection_codes', 'incorrect_icd_code', 'Incorrect ICD Code', 40, TRUE, TRUE),
  (NULL, 'claim_rejection_codes', 'document_deficiency', 'Document Deficiency', 50, TRUE, TRUE),
  (NULL, 'claim_rejection_codes', 'duplicate_claim', 'Duplicate Claim', 60, TRUE, TRUE),
  (NULL, 'claim_rejection_codes', 'rate_mismatch', 'Rate / Package Mismatch', 70, TRUE, TRUE),
  (NULL, 'claim_rejection_codes', 'other', 'Other', 99, TRUE, TRUE),
  -- lab_test_categories
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
  -- sample_types
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
  (NULL, 'sample_types', 'Other', 'Other', 150, TRUE, TRUE),
  -- housekeeping_task_types
  (NULL, 'housekeeping_task_types', 'bed_turnover', 'Bed Turnover', 10, TRUE, TRUE),
  (NULL, 'housekeeping_task_types', 'terminal_cleaning', 'Terminal Cleaning', 20, TRUE, TRUE),
  (NULL, 'housekeeping_task_types', 'routine_cleaning', 'Routine Cleaning', 30, TRUE, TRUE),
  (NULL, 'housekeeping_task_types', 'spill_management', 'Spill Management', 40, TRUE, TRUE),
  (NULL, 'housekeeping_task_types', 'isolation_protocol', 'Isolation Protocol', 50, TRUE, TRUE),
  (NULL, 'housekeeping_task_types', 'ot_cleaning', 'OT Cleaning', 60, TRUE, TRUE),
  (NULL, 'housekeeping_task_types', 'toilet_cleaning', 'Toilet Cleaning', 70, TRUE, TRUE),
  (NULL, 'housekeeping_task_types', 'linen_change', 'Linen Change', 80, TRUE, TRUE),
  (NULL, 'housekeeping_task_types', 'other', 'Other', 99, TRUE, TRUE),
  -- housekeeping_area_types
  (NULL, 'housekeeping_area_types', 'ward', 'General Ward', 10, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'ot', 'Operation Theatre', 20, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'icu', 'ICU / HDU', 30, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'emergency', 'Emergency / Casualty', 40, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'outpatient', 'OPD / Outpatient', 50, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'toilet', 'Toilet / Washroom', 60, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'corridor', 'Corridor', 70, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'stairwell', 'Stairwell', 80, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'reception', 'Reception / Lobby', 90, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'canteen', 'Canteen / Pantry', 100, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'pharmacy', 'Pharmacy', 110, TRUE, TRUE),
  (NULL, 'housekeeping_area_types', 'lab', 'Laboratory', 120, TRUE, TRUE),
  -- equipment_categories
  (NULL, 'equipment_categories', 'diagnostic', 'Diagnostic', 10, TRUE, TRUE),
  (NULL, 'equipment_categories', 'therapeutic', 'Therapeutic', 20, TRUE, TRUE),
  (NULL, 'equipment_categories', 'monitoring', 'Patient Monitoring', 30, TRUE, TRUE),
  (NULL, 'equipment_categories', 'laboratory', 'Laboratory', 40, TRUE, TRUE),
  (NULL, 'equipment_categories', 'surgical', 'Surgical Instruments', 50, TRUE, TRUE),
  (NULL, 'equipment_categories', 'ot_equipment', 'OT Equipment', 60, TRUE, TRUE),
  (NULL, 'equipment_categories', 'it_equipment', 'IT / Computers', 70, TRUE, TRUE),
  (NULL, 'equipment_categories', 'utility', 'Utility / Electrical', 80, TRUE, TRUE),
  (NULL, 'equipment_categories', 'radiation', 'Radiation / Imaging', 90, TRUE, TRUE),
  (NULL, 'equipment_categories', 'other', 'Other', 99, TRUE, TRUE),
  -- inventory_categories
  (NULL, 'inventory_categories', 'surgical', 'Surgical Supplies', 10, TRUE, TRUE),
  (NULL, 'inventory_categories', 'consumable', 'Consumables', 20, TRUE, TRUE),
  (NULL, 'inventory_categories', 'linen', 'Linen', 30, TRUE, TRUE),
  (NULL, 'inventory_categories', 'medical_gas', 'Medical Gases', 40, TRUE, TRUE),
  (NULL, 'inventory_categories', 'diagnostic', 'Diagnostic Reagents', 50, TRUE, TRUE),
  (NULL, 'inventory_categories', 'ppe', 'PPE', 60, TRUE, TRUE),
  (NULL, 'inventory_categories', 'stationery', 'Stationery / Forms', 70, TRUE, TRUE),
  (NULL, 'inventory_categories', 'other', 'Other', 99, TRUE, TRUE),
  -- department_types
  (NULL, 'department_types', 'clinical', 'Clinical', 10, TRUE, TRUE),
  (NULL, 'department_types', 'administrative', 'Administrative', 20, TRUE, TRUE),
  (NULL, 'department_types', 'support', 'Support', 30, TRUE, TRUE),
  (NULL, 'department_types', 'diagnostic', 'Diagnostic', 40, TRUE, TRUE),
  (NULL, 'department_types', 'paramedical', 'Paramedical', 50, TRUE, TRUE),
  -- cancellation_reasons
  (NULL, 'cancellation_reasons', 'patient_request', 'Patient requested cancellation', 1, TRUE, TRUE),
  (NULL, 'cancellation_reasons', 'clinically_unfit', 'Clinically unfit for procedure', 2, TRUE, TRUE),
  (NULL, 'cancellation_reasons', 'doctor_unavailable', 'Doctor / surgeon unavailable', 3, TRUE, TRUE),
  (NULL, 'cancellation_reasons', 'preauth_rejected', 'Insurance pre-auth rejected', 4, TRUE, TRUE),
  (NULL, 'cancellation_reasons', 'financial', 'Financial / unable to pay', 5, TRUE, TRUE),
  (NULL, 'cancellation_reasons', 'patient_no_show', 'Patient did not report', 6, TRUE, TRUE),
  (NULL, 'cancellation_reasons', 'rescheduled_elsewhere', 'Moved to another facility', 7, TRUE, TRUE),
  (NULL, 'cancellation_reasons', 'other', 'Other', 8, TRUE, TRUE),
  -- emergency_drug_routes
  (NULL, 'emergency_drug_routes', 'IV', 'IV', 10, TRUE, TRUE),
  (NULL, 'emergency_drug_routes', 'IM', 'IM', 20, TRUE, TRUE),
  (NULL, 'emergency_drug_routes', 'PO (oral)', 'PO (oral)', 30, TRUE, TRUE),
  (NULL, 'emergency_drug_routes', 'SC', 'SC', 40, TRUE, TRUE),
  (NULL, 'emergency_drug_routes', 'SL', 'SL', 50, TRUE, TRUE),
  (NULL, 'emergency_drug_routes', 'PR', 'PR', 60, TRUE, TRUE),
  (NULL, 'emergency_drug_routes', 'Nebulized', 'Nebulized', 70, TRUE, TRUE),
  (NULL, 'emergency_drug_routes', 'Inhaled', 'Inhaled', 80, TRUE, TRUE),
  (NULL, 'emergency_drug_routes', 'Topical', 'Topical', 90, TRUE, TRUE),
  (NULL, 'emergency_drug_routes', 'Other', 'Other', 99, TRUE, TRUE),
  -- vaccine_routes
  (NULL, 'vaccine_routes', 'im', 'IM', 10, TRUE, TRUE),
  (NULL, 'vaccine_routes', 'sc', 'SC', 20, TRUE, TRUE),
  (NULL, 'vaccine_routes', 'id', 'ID', 30, TRUE, TRUE),
  (NULL, 'vaccine_routes', 'oral', 'Oral', 40, TRUE, TRUE),
  (NULL, 'vaccine_routes', 'intranasal', 'Intranasal', 50, TRUE, TRUE)
ON CONFLICT DO NOTHING;
