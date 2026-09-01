-- Phase 2 — foreign-key indexes and duplicate-index cleanup.
--
-- ROOT CAUSE (U-1): 61% of foreign keys had no index whose leading column was the FK column.
-- hospital_id is the predicate of nearly every RLS policy in this schema, so every filtered read
-- on those tables was a sequential scan, and every parent DELETE scanned each child table in
-- full — which matters because purge_hospital*() exists to delete tenants.
--
-- Generated from live pg_catalog state, not from a static list, so it reflects the schema as it
-- actually is after Phase 0/1 (which already added indexes for the new tables).
--
--   904 indexes created  (126 on hospital_id, 96 on patient_id)
--   14 duplicate indexes dropped
--
-- CONCURRENTLY: no table is write-locked, so this is safe to run against a live database.
-- It also means these statements CANNOT run inside a transaction block — this migration
-- deliberately has no BEGIN/COMMIT, and each statement is independently re-runnable.
-- Purely additive: no query changes behaviour, only its plan.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abdm_audit_log_hospital_id
  ON public.abdm_audit_log (hospital_id);   -- FK abdm_audit_log_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abdm_care_contexts_hospital_id
  ON public.abdm_care_contexts (hospital_id);   -- FK abdm_care_contexts_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abdm_consents_hospital_id
  ON public.abdm_consents (hospital_id);   -- FK abdm_consents_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abdm_gateway_logs_hospital_id
  ON public.abdm_gateway_logs (hospital_id);   -- FK abdm_gateway_logs_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admission_day_care_procedures_hospital_id
  ON public.admission_day_care_procedures (hospital_id);   -- FK admission_day_care_procedures_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ambulance_vehicles_hospital_id
  ON public.ambulance_vehicles (hospital_id);   -- FK ambulance_vehicles_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anaesthesia_records_hospital_id
  ON public.anaesthesia_records (hospital_id);   -- FK anaesthesia_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_hospital_id
  ON public.api_keys (hospital_id);   -- FK api_keys_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_records_hospital_id
  ON public.audit_records (hospital_id);   -- FK audit_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_accounts_hospital_id
  ON public.bank_accounts (hospital_id);   -- FK bank_accounts_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_hospital_id
  ON public.bank_transactions (hospital_id);   -- FK bank_transactions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_antibody_screening_hospital_id
  ON public.blood_antibody_screening (hospital_id);   -- FK blood_antibody_screening_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_issues_hospital_id
  ON public.blood_issues (hospital_id);   -- FK blood_issues_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_requests_hospital_id
  ON public.blood_requests (hospital_id);   -- FK blood_requests_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_branches_hospital_id
  ON public.branches (hospital_id);   -- FK branches_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_order_drugs_hospital_id
  ON public.chemo_order_drugs (hospital_id);   -- FK chemo_order_drugs_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_hospital_id
  ON public.chemo_orders (hospital_id);   -- FK chemo_orders_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_protocols_hospital_id
  ON public.clinical_protocols (hospital_id);   -- FK clinical_protocols_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_reference_sources_hospital_id
  ON public.clinical_reference_sources (hospital_id);   -- FK clinical_reference_sources_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_coding_audits_hospital_id
  ON public.coding_audits (hospital_id);   -- FK coding_audits_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collection_campaigns_hospital_id
  ON public.collection_campaigns (hospital_id);   -- FK collection_campaigns_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_consent_templates_hospital_id
  ON public.consent_templates (hospital_id);   -- FK consent_templates_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_note_items_hospital_id
  ON public.credit_note_items (hospital_id);   -- FK credit_note_items_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_match_records_hospital_id
  ON public.cross_match_records (hospital_id);   -- FK cross_match_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cycle_instruments_hospital_id
  ON public.cycle_instruments (hospital_id);   -- FK cycle_instruments_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daycare_chairs_hospital_id
  ON public.daycare_chairs (hospital_id);   -- FK daycare_chairs_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_demand_forecasts_hospital_id
  ON public.demand_forecasts (hospital_id);   -- FK demand_forecasts_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_denial_logs_hospital_id
  ON public.denial_logs (hospital_id);   -- FK denial_logs_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dental_treatment_plans_hospital_id
  ON public.dental_treatment_plans (hospital_id);   -- FK dental_treatment_plans_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_departments_hospital_id
  ON public.departments (hospital_id);   -- FK departments_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialysis_machines_hospital_id
  ON public.dialysis_machines (hospital_id);   -- FK dialysis_machines_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialysis_sessions_hospital_id
  ON public.dialysis_sessions (hospital_id);   -- FK dialysis_sessions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialyzer_reuse_hospital_id
  ON public.dialyzer_reuse (hospital_id);   -- FK dialyzer_reuse_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disciplinary_actions_hospital_id
  ON public.disciplinary_actions (hospital_id);   -- FK disciplinary_actions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_discount_approvals_hospital_id
  ON public.discount_approvals (hospital_id);   -- FK discount_approvals_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drug_master_hospital_id
  ON public.drug_master (hospital_id);   -- FK drug_master_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_embryology_records_hospital_id
  ON public.embryology_records (hospital_id);   -- FK embryology_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emr_template_definitions_hospital_id
  ON public.emr_template_definitions (hospital_id);   -- FK emr_template_definitions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enterprise_leads_hospital_id
  ON public.enterprise_leads (hospital_id);   -- FK enterprise_leads_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entitlement_fail_open_events_hospital_id
  ON public.entitlement_fail_open_events (hospital_id);   -- FK entitlement_fail_open_events_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expense_records_hospital_id
  ON public.expense_records (hospital_id);   -- FK expense_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_full_final_settlements_hospital_id
  ON public.full_final_settlements (hospital_id);   -- FK full_final_settlements_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_govt_schemes_hospital_id
  ON public.govt_schemes (hospital_id);   -- FK govt_schemes_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_ai_log_hospital_id
  ON public.grn_ai_log (hospital_id);   -- FK grn_ai_log_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_items_hospital_id
  ON public.grn_items (hospital_id);   -- FK grn_items_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hcx_submissions_hospital_id
  ON public.hcx_submissions (hospital_id);   -- FK hcx_submissions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_coach_sessions_hospital_id
  ON public.health_coach_sessions (hospital_id);   -- FK health_coach_sessions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospital_signup_consents_hospital_id
  ON public.hospital_signup_consents (hospital_id);   -- FK hospital_signup_consents_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icd10_code_sets_hospital_id
  ON public.icd10_code_sets (hospital_id);   -- FK icd10_code_sets_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icd10_codes_hospital_id
  ON public.icd10_codes (hospital_id);   -- FK icd10_codes_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbox_messages_hospital_id
  ON public.inbox_messages (hospital_id);   -- FK inbox_messages_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_indent_items_hospital_id
  ON public.indent_items (hospital_id);   -- FK indent_items_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipd_advances_hospital_id
  ON public.ipd_advances (hospital_id);   -- FK ipd_advances_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipd_vitals_hospital_id
  ON public.ipd_vitals (hospital_id);   -- FK ipd_vitals_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_openings_hospital_id
  ON public.job_openings (hospital_id);   -- FK job_openings_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_line_items_hospital_id
  ON public.journal_line_items (hospital_id);   -- FK journal_line_items_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_analyzer_test_mappings_hospital_id
  ON public.lab_analyzer_test_mappings (hospital_id);   -- FK lab_analyzer_test_mappings_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_results_hospital_id
  ON public.lab_results (hospital_id);   -- FK lab_results_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_requests_hospital_id
  ON public.leave_requests (hospital_id);   -- FK leave_requests_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ndps_register_hospital_id
  ON public.ndps_register (hospital_id);   -- FK ndps_register_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_neonatal_records_hospital_id
  ON public.neonatal_records (hospital_id);   -- FK neonatal_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_no_show_predictions_hospital_id
  ON public.no_show_predictions (hospital_id);   -- FK no_show_predictions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nps_responses_hospital_id
  ON public.nps_responses (hospital_id);   -- FK nps_responses_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_fluid_outputs_hospital_id
  ON public.nursing_fluid_outputs (hospital_id);   -- FK nursing_fluid_outputs_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_handovers_hospital_id
  ON public.nursing_handovers (hospital_id);   -- FK nursing_handovers_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_procedure_consumables_hospital_id
  ON public.nursing_procedure_consumables (hospital_id);   -- FK nursing_procedure_consumables_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_procedures_hospital_id
  ON public.nursing_procedures (hospital_id);   -- FK nursing_procedures_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obstetric_records_hospital_id
  ON public.obstetric_records (hospital_id);   -- FK obstetric_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_onboarding_tasks_hospital_id
  ON public.onboarding_tasks (hospital_id);   -- FK onboarding_tasks_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_visits_hospital_id
  ON public.opd_visits (hospital_id);   -- FK opd_visits_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ophthalmology_records_hospital_id
  ON public.ophthalmology_records (hospital_id);   -- FK ophthalmology_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_checklists_hospital_id
  ON public.ot_checklists (hospital_id);   -- FK ot_checklists_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_equipment_checklist_hospital_id
  ON public.ot_equipment_checklist (hospital_id);   -- FK ot_equipment_checklist_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_instrument_counts_hospital_id
  ON public.ot_instrument_counts (hospital_id);   -- FK ot_instrument_counts_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_rooms_hospital_id
  ON public.ot_rooms (hospital_id);   -- FK ot_rooms_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_station_logs_hospital_id
  ON public.package_station_logs (hospital_id);   -- FK package_station_logs_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_partograph_entries_hospital_id
  ON public.partograph_entries (hospital_id);   -- FK partograph_entries_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_partograph_records_hospital_id
  ON public.partograph_records (hospital_id);   -- FK partograph_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_encounter_templates_hospital_id
  ON public.patient_encounter_templates (hospital_id);   -- FK patient_encounter_templates_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_feedback_hospital_id
  ON public.patient_feedback (hospital_id);   -- FK patient_feedback_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_history_ingest_jobs_hospital_id
  ON public.patient_history_ingest_jobs (hospital_id);   -- FK patient_history_ingest_jobs_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_history_source_chunks_hospital_id
  ON public.patient_history_source_chunks (hospital_id);   -- FK patient_history_source_chunks_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_history_sources_hospital_id
  ON public.patient_history_sources (hospital_id);   -- FK patient_history_sources_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_portal_sessions_hospital_id
  ON public.patient_portal_sessions (hospital_id);   -- FK patient_portal_sessions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_template_responses_hospital_id
  ON public.patient_template_responses (hospital_id);   -- FK patient_template_responses_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_items_hospital_id
  ON public.payroll_items (hospital_id);   -- FK payroll_items_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pcpndt_form_f_hospital_id
  ON public.pcpndt_form_f (hospital_id);   -- FK pcpndt_form_f_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_periodontal_charts_hospital_id
  ON public.periodontal_charts (hospital_id);   -- FK periodontal_charts_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_items_hospital_id
  ON public.pharmacy_dispensing_items (hospital_id);   -- FK pharmacy_dispensing_items_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_stock_alerts_hospital_id
  ON public.pharmacy_stock_alerts (hospital_id);   -- FK pharmacy_stock_alerts_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_phi_backfill_log_hospital_id
  ON public.phi_backfill_log (hospital_id);   -- FK phi_backfill_log_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_platform_feature_flag_overrides_hospital_id
  ON public.platform_feature_flag_overrides (hospital_id);   -- FK platform_feature_flag_overrides_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmjay_preauth_requests_hospital_id
  ON public.pmjay_preauth_requests (hospital_id);   -- FK pmjay_preauth_requests_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_po_items_hospital_id
  ON public.po_items (hospital_id);   -- FK po_items_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portal_chat_messages_hospital_id
  ON public.portal_chat_messages (hospital_id);   -- FK portal_chat_messages_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_recommendations_hospital_id
  ON public.procurement_recommendations (hospital_id);   -- FK procurement_recommendations_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_requisitions_hospital_id
  ON public.purchase_requisitions (hospital_id);   -- FK purchase_requisitions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_modalities_hospital_id
  ON public.radiology_modalities (hospital_id);   -- FK radiology_modalities_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_reports_hospital_id
  ON public.radiology_reports (hospital_id);   -- FK radiology_reports_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_record_requests_hospital_id
  ON public.record_requests (hospital_id);   -- FK record_requests_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restraint_records_hospital_id
  ON public.restraint_records (hospital_id);   -- FK restraint_records_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retention_schedules_hospital_id
  ON public.retention_schedules (hospital_id);   -- FK retention_schedules_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfqs_hospital_id
  ON public.rfqs (hospital_id);   -- FK rfqs_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_salary_structures_hospital_id
  ON public.salary_structures (hospital_id);   -- FK salary_structures_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheme_beneficiaries_hospital_id
  ON public.scheme_beneficiaries (hospital_id);   -- FK scheme_beneficiaries_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_set_issues_hospital_id
  ON public.set_issues (hospital_id);   -- FK set_issues_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlement_reconciliation_flags_hospital_id
  ON public.settlement_reconciliation_flags (hospital_id);   -- FK settlement_reconciliation_flags_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shift_master_hospital_id
  ON public.shift_master (hospital_id);   -- FK shift_master_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_exits_hospital_id
  ON public.staff_exits (hospital_id);   -- FK staff_exits_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_profiles_hospital_id
  ON public.staff_profiles (hospital_id);   -- FK staff_profiles_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stimulation_monitoring_hospital_id
  ON public.stimulation_monitoring (hospital_id);   -- FK stimulation_monitoring_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_transactions_hospital_id
  ON public.stock_transactions (hospital_id);   -- FK stock_transactions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teleconsult_sessions_hospital_id
  ON public.teleconsult_sessions (hospital_id);   -- FK teleconsult_sessions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toxicity_events_hospital_id
  ON public.toxicity_events (hospital_id);   -- FK toxicity_events_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpa_dispute_communications_hospital_id
  ON public.tpa_dispute_communications (hospital_id);   -- FK tpa_dispute_communications_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfusion_reactions_hospital_id
  ON public.transfusion_reactions (hospital_id);   -- FK transfusion_reactions_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_hospital_id
  ON public.users (hospital_id);   -- FK users_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vaccination_due_hospital_id
  ON public.vaccination_due (hospital_id);   -- FK vaccination_due_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vaccine_camps_hospital_id
  ON public.vaccine_camps (hospital_id);   -- FK vaccine_camps_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendor_quotations_hospital_id
  ON public.vendor_quotations (hospital_id);   -- FK vendor_quotations_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendors_hospital_id
  ON public.vendors (hospital_id);   -- FK vendors_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vial_wastage_hospital_id
  ON public.vial_wastage (hospital_id);   -- FK vial_wastage_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ward_round_notes_hospital_id
  ON public.ward_round_notes (hospital_id);   -- FK ward_round_notes_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wards_hospital_id
  ON public.wards (hospital_id);   -- FK wards_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_bot_messages_hospital_id
  ON public.whatsapp_bot_messages (hospital_id);   -- FK whatsapp_bot_messages_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_templates_hospital_id
  ON public.whatsapp_templates (hospital_id);   -- FK whatsapp_templates_hospital_id_fkey -> hospitals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abdm_audit_log_patient_id
  ON public.abdm_audit_log (patient_id);   -- FK abdm_audit_log_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abdm_care_contexts_patient_id
  ON public.abdm_care_contexts (patient_id);   -- FK abdm_care_contexts_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abdm_consents_patient_id
  ON public.abdm_consents (patient_id);   -- FK abdm_consents_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admission_estimates_patient_id
  ON public.admission_estimates (patient_id);   -- FK admission_estimates_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_adult_immunization_schedule_patient_id
  ON public.adult_immunization_schedule (patient_id);   -- FK adult_immunization_schedule_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_advance_receipts_patient_id
  ON public.advance_receipts (patient_id);   -- FK advance_receipts_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_feature_logs_patient_id
  ON public.ai_feature_logs (patient_id);   -- FK ai_feature_logs_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ambulance_dispatches_patient_id
  ON public.ambulance_dispatches (patient_id);   -- FK ambulance_dispatches_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anaesthesia_records_patient_id
  ON public.anaesthesia_records (patient_id);   -- FK anaesthesia_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_antibiotic_justifications_patient_id
  ON public.antibiotic_justifications (patient_id);   -- FK antibiotic_justifications_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bed_reservations_patient_id
  ON public.bed_reservations (patient_id);   -- FK bed_reservations_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_antibody_screening_patient_id
  ON public.blood_antibody_screening (patient_id);   -- FK blood_antibody_screening_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_issues_patient_id
  ON public.blood_issues (patient_id);   -- FK blood_issues_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_requests_patient_id
  ON public.blood_requests (patient_id);   -- FK blood_requests_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bpmh_records_patient_id
  ON public.bpmh_records (patient_id);   -- FK bpmh_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_patient_id
  ON public.chemo_orders (patient_id);   -- FK chemo_orders_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chronic_disease_programs_patient_id
  ON public.chronic_disease_programs (patient_id);   -- FK chronic_disease_programs_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_code_blue_events_patient_id
  ON public.code_blue_events (patient_id);   -- FK code_blue_events_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_notes_patient_id
  ON public.credit_notes (patient_id);   -- FK credit_notes_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_match_records_patient_id
  ON public.cross_match_records (patient_id);   -- FK cross_match_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_death_certificates_patient_id
  ON public.death_certificates (patient_id);   -- FK death_certificates_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialysis_patients_patient_id
  ON public.dialysis_patients (patient_id);   -- FK dialysis_patients_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_diet_orders_patient_id
  ON public.diet_orders (patient_id);   -- FK diet_orders_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_diet_plans_patient_id
  ON public.diet_plans (patient_id);   -- FK diet_plans_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ed_handover_notes_patient_id
  ON public.ed_handover_notes (patient_id);   -- FK ed_handover_notes_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ed_visits_patient_id
  ON public.ed_visits (patient_id);   -- FK ed_visits_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_external_lab_referrals_patient_id
  ON public.external_lab_referrals (patient_id);   -- FK external_lab_referrals_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fall_risk_assessments_patient_id
  ON public.fall_risk_assessments (patient_id);   -- FK fall_risk_assessments_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feedback_records_patient_id
  ON public.feedback_records (patient_id);   -- FK feedback_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hep_plans_patient_id
  ON public.hep_plans (patient_id);   -- FK hep_plans_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_home_care_plans_patient_id
  ON public.home_care_plans (patient_id);   -- FK home_care_plans_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_home_care_visits_patient_id
  ON public.home_care_visits (patient_id);   -- FK home_care_visits_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_home_tele_monitoring_patient_id
  ON public.home_tele_monitoring (patient_id);   -- FK home_tele_monitoring_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_idsp_submissions_patient_id
  ON public.idsp_submissions (patient_id);   -- FK idsp_submissions_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbox_messages_patient_id
  ON public.inbox_messages (patient_id);   -- FK inbox_messages_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incident_reports_patient_id
  ON public.incident_reports (patient_id);   -- FK incident_reports_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_claims_patient_id
  ON public.insurance_claims (patient_id);   -- FK insurance_claims_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_intimations_patient_id
  ON public.insurance_intimations (patient_id);   -- FK insurance_intimations_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_pre_auth_patient_id
  ON public.insurance_pre_auth (patient_id);   -- FK insurance_pre_auth_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_bundle_checklists_patient_id
  ON public.ipc_bundle_checklists (patient_id);   -- FK ipc_bundle_checklists_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_device_usage_patient_id
  ON public.ipc_device_usage (patient_id);   -- FK ipc_device_usage_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_infection_events_patient_id
  ON public.ipc_infection_events (patient_id);   -- FK ipc_infection_events_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipd_advances_patient_id
  ON public.ipd_advances (patient_id);   -- FK ipd_advances_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipd_nursing_notes_patient_id
  ON public.ipd_nursing_notes (patient_id);   -- FK ipd_nursing_notes_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_results_patient_id
  ON public.lab_results (patient_id);   -- FK lab_results_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mccd_certificates_patient_id
  ON public.mccd_certificates (patient_id);   -- FK mccd_certificates_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mci_triage_patients_patient_id
  ON public.mci_triage_patients (patient_id);   -- FK mci_triage_patients_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meal_deliveries_patient_id
  ON public.meal_deliveries (patient_id);   -- FK meal_deliveries_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_med_admin_records_patient_id
  ON public.med_admin_records (patient_id);   -- FK med_admin_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medical_records_patient_id
  ON public.medical_records (patient_id);   -- FK medical_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_neonatal_records_patient_id
  ON public.neonatal_records (patient_id);   -- FK neonatal_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_log_patient_id
  ON public.notification_log (patient_id);   -- FK notification_log_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_preferences_patient_id
  ON public.notification_preferences (patient_id);   -- FK notification_preferences_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nps_surveys_patient_id
  ON public.nps_surveys (patient_id);   -- FK nps_surveys_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_care_plans_patient_id
  ON public.nursing_care_plans (patient_id);   -- FK nursing_care_plans_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_procedures_patient_id
  ON public.nursing_procedures (patient_id);   -- FK nursing_procedures_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_vitals_patient_id
  ON public.nursing_vitals (patient_id);   -- FK nursing_vitals_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nutrition_screenings_patient_id
  ON public.nutrition_screenings (patient_id);   -- FK nutrition_screenings_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nutritional_screenings_patient_id
  ON public.nutritional_screenings (patient_id);   -- FK nutritional_screenings_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obstetric_records_patient_id
  ON public.obstetric_records (patient_id);   -- FK obstetric_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oncology_patients_patient_id
  ON public.oncology_patients (patient_id);   -- FK oncology_patients_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_visits_patient_id
  ON public.opd_visits (patient_id);   -- FK opd_visits_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ophthalmology_records_patient_id
  ON public.ophthalmology_records (patient_id);   -- FK ophthalmology_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organ_donations_patient_id
  ON public.organ_donations (patient_id);   -- FK organ_donations_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_schedules_patient_id
  ON public.ot_schedules (patient_id);   -- FK ot_schedules_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outcome_scores_patient_id
  ON public.outcome_scores (patient_id);   -- FK outcome_scores_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_palliative_care_plans_patient_id
  ON public.palliative_care_plans (patient_id);   -- FK palliative_care_plans_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_partograph_records_patient_id
  ON public.partograph_records (patient_id);   -- FK partograph_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_abha_profiles_patient_id
  ON public.patient_abha_profiles (patient_id);   -- FK patient_abha_profiles_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_consents_patient_id
  ON public.patient_consents (patient_id);   -- FK patient_consents_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_documents_patient_id
  ON public.patient_documents (patient_id);   -- FK patient_documents_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_feedback_patient_id
  ON public.patient_feedback (patient_id);   -- FK patient_feedback_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_history_source_chunks_patient_id
  ON public.patient_history_source_chunks (patient_id);   -- FK patient_history_source_chunks_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_portal_sessions_patient_id
  ON public.patient_portal_sessions (patient_id);   -- FK patient_portal_sessions_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physio_equipment_bookings_patient_id
  ON public.physio_equipment_bookings (patient_id);   -- FK physio_equipment_bookings_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physio_sessions_patient_id
  ON public.physio_sessions (patient_id);   -- FK physio_sessions_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmjay_claims_patient_id
  ON public.pmjay_claims (patient_id);   -- FK pmjay_claims_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmjay_preauth_requests_patient_id
  ON public.pmjay_preauth_requests (patient_id);   -- FK pmjay_preauth_requests_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pre_auth_requests_patient_id
  ON public.pre_auth_requests (patient_id);   -- FK pre_auth_requests_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prescriptions_patient_id
  ON public.prescriptions (patient_id);   -- FK prescriptions_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_preventive_screenings_patient_id
  ON public.preventive_screenings (patient_id);   -- FK preventive_screenings_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prom_prem_surveys_patient_id
  ON public.prom_prem_surveys (patient_id);   -- FK prom_prem_surveys_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_orders_patient_id
  ON public.radiology_orders (patient_id);   -- FK radiology_orders_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_reports_patient_id
  ON public.radiology_reports (patient_id);   -- FK radiology_reports_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_record_requests_patient_id
  ON public.record_requests (patient_id);   -- FK record_requests_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refund_payables_patient_id
  ON public.refund_payables (patient_id);   -- FK refund_payables_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restraint_records_patient_id
  ON public.restraint_records (patient_id);   -- FK restraint_records_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retention_schedules_patient_id
  ON public.retention_schedules (patient_id);   -- FK retention_schedules_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_alerts_patient_id
  ON public.revenue_alerts (patient_id);   -- FK revenue_alerts_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teleconsult_sessions_patient_id
  ON public.teleconsult_sessions (patient_id);   -- FK teleconsult_sessions_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toxicity_events_patient_id
  ON public.toxicity_events (patient_id);   -- FK toxicity_events_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfusion_reactions_patient_id
  ON public.transfusion_reactions (patient_id);   -- FK transfusion_reactions_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ward_round_notes_patient_id
  ON public.ward_round_notes (patient_id);   -- FK ward_round_notes_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_bot_sessions_patient_id
  ON public.whatsapp_bot_sessions (patient_id);   -- FK whatsapp_bot_sessions_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_notifications_patient_id
  ON public.whatsapp_notifications (patient_id);   -- FK whatsapp_notifications_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wound_assessments_patient_id
  ON public.wound_assessments (patient_id);   -- FK wound_assessments_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abdm_audit_log_performed_by
  ON public.abdm_audit_log (performed_by);   -- FK abdm_audit_log_performed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abdm_consent_logs_consent_given_by
  ON public.abdm_consent_logs (consent_given_by);   -- FK abdm_consent_logs_consent_given_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_audit_log_admin_id
  ON public.admin_audit_log (admin_id);   -- FK admin_audit_log_admin_id_fkey -> aumrti_admins
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admission_day_care_procedures_procedure_id
  ON public.admission_day_care_procedures (procedure_id);   -- FK admission_day_care_procedures_procedure_id_fkey -> day_care_procedures
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admission_estimates_created_by
  ON public.admission_estimates (created_by);   -- FK admission_estimates_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admission_estimates_package_id
  ON public.admission_estimates (package_id);   -- FK admission_estimates_package_id_fkey -> health_packages
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_payer_id
  ON public.admissions (payer_id);   -- FK admissions_payer_id_fkey -> payer_masters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_consultant_doctor_id
  ON public.admissions (consultant_doctor_id);   -- FK admissions_consultant_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_cancelled_by
  ON public.admissions (cancelled_by);   -- FK admissions_cancelled_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_bed_id
  ON public.admissions (bed_id);   -- FK admissions_bed_id_fkey -> beds
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_department_id
  ON public.admissions (department_id);   -- FK admissions_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_discharge_signed_by
  ON public.admissions (discharge_signed_by);   -- FK admissions_discharge_signed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_discharge_unsigned_by
  ON public.admissions (discharge_unsigned_by);   -- FK admissions_discharge_unsigned_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_financial_clearance_by
  ON public.admissions (financial_clearance_by);   -- FK admissions_financial_clearance_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_financial_override_by
  ON public.admissions (financial_override_by);   -- FK admissions_financial_override_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_late_discharge_by
  ON public.admissions (late_discharge_by);   -- FK admissions_late_discharge_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_day_care_procedure_id
  ON public.admissions (day_care_procedure_id);   -- FK admissions_day_care_procedure_id_fkey -> day_care_procedures
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_package_id
  ON public.admissions (package_id);   -- FK admissions_package_id_fkey -> hospital_packages
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admissions_ward_id
  ON public.admissions (ward_id);   -- FK admissions_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_adult_immunization_schedule_given_by
  ON public.adult_immunization_schedule (given_by);   -- FK adult_immunization_schedule_given_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_advance_receipts_adjusted_in_bill_id
  ON public.advance_receipts (adjusted_in_bill_id);   -- FK advance_receipts_adjusted_in_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_advance_receipts_received_by
  ON public.advance_receipts (received_by);   -- FK advance_receipts_received_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_feature_classes_updated_by
  ON public.ai_feature_classes (updated_by);   -- FK ai_feature_classes_updated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_suggestions_audit_user_id
  ON public.ai_suggestions_audit (user_id);   -- FK ai_suggestions_audit_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alert_escalation_log_rule_id
  ON public.alert_escalation_log (rule_id);   -- FK alert_escalation_log_rule_id_fkey -> alert_escalation_rules
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ambulance_dispatches_bill_id
  ON public.ambulance_dispatches (bill_id);   -- FK ambulance_dispatches_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ambulance_dispatches_vehicle_id
  ON public.ambulance_dispatches (vehicle_id);   -- FK ambulance_dispatches_vehicle_id_fkey -> ambulance_vehicles
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ambulance_equipment_checks_checked_by
  ON public.ambulance_equipment_checks (checked_by);   -- FK ambulance_equipment_checks_checked_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ambulance_equipment_checks_vehicle_id
  ON public.ambulance_equipment_checks (vehicle_id);   -- FK ambulance_equipment_checks_vehicle_id_fkey -> ambulance_vehicles
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ambulance_transit_treatment_dispatch_id
  ON public.ambulance_transit_treatment (dispatch_id);   -- FK ambulance_transit_treatment_dispatch_id_fkey -> ambulance_dispatches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ambulance_transit_treatment_recorded_by
  ON public.ambulance_transit_treatment (recorded_by);   -- FK ambulance_transit_treatment_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_amc_contracts_equipment_id
  ON public.amc_contracts (equipment_id);   -- FK amc_contracts_equipment_id_fkey -> equipment_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anaesthesia_records_ot_id
  ON public.anaesthesia_records (ot_id);   -- FK anaesthesia_records_ot_id_fkey -> ot_schedules
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_andrology_reports_reported_by
  ON public.andrology_reports (reported_by);   -- FK andrology_reports_reported_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_andrology_reports_couple_id
  ON public.andrology_reports (couple_id);   -- FK andrology_reports_couple_id_fkey -> art_couples
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_antibiotic_justifications_approved_by
  ON public.antibiotic_justifications (approved_by);   -- FK antibiotic_justifications_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_antibiotic_justifications_prescribed_by
  ON public.antibiotic_justifications (prescribed_by);   -- FK antibiotic_justifications_prescribed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_created_by
  ON public.api_keys (created_by);   -- FK api_keys_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_slot_id
  ON public.appointments (slot_id);   -- FK appointments_slot_id_fkey -> doctor_slots
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_booked_by
  ON public.appointments (booked_by);   -- FK appointments_booked_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_department_id
  ON public.appointments (department_id);   -- FK appointments_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_referral_doctor_id
  ON public.appointments (referral_doctor_id);   -- FK appointments_referral_doctor_id_fkey -> referral_doctors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_art_couples_treating_doctor
  ON public.art_couples (treating_doctor);   -- FK art_couples_treating_doctor_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_art_couples_male_patient_id
  ON public.art_couples (male_patient_id);   -- FK art_couples_male_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_regularization_requests_user_id
  ON public.attendance_regularization_requests (user_id);   -- FK attendance_regularization_requests_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_regularization_requests_reviewed_by
  ON public.attendance_regularization_requests (reviewed_by);   -- FK attendance_regularization_requests_reviewed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_records_created_by
  ON public.audit_records (created_by);   -- FK audit_records_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auto_posting_rules_credit_account_id
  ON public.auto_posting_rules (credit_account_id);   -- FK auto_posting_rules_credit_account_id_fkey -> chart_of_accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auto_posting_rules_debit_account_id
  ON public.auto_posting_rules (debit_account_id);   -- FK auto_posting_rules_debit_account_id_fkey -> chart_of_accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ayush_encounters_practitioner_id
  ON public.ayush_encounters (practitioner_id);   -- FK ayush_encounters_practitioner_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_accounts_coa_account_id
  ON public.bank_accounts (coa_account_id);   -- FK bank_accounts_coa_account_id_fkey -> chart_of_accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_bank_account_id
  ON public.bank_transactions (bank_account_id);   -- FK bank_transactions_bank_account_id_fkey -> bank_accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_reconciled_with
  ON public.bank_transactions (reconciled_with);   -- FK bank_transactions_reconciled_with_fkey -> journal_line_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bed_demand_forecasts_ward_id
  ON public.bed_demand_forecasts (ward_id);   -- FK bed_demand_forecasts_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bed_reservations_reserved_by
  ON public.bed_reservations (reserved_by);   -- FK bed_reservations_reserved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bed_reservations_doctor_id
  ON public.bed_reservations (doctor_id);   -- FK bed_reservations_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bed_reservations_admission_id
  ON public.bed_reservations (admission_id);   -- FK bed_reservations_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_amendments_changed_by
  ON public.bill_amendments (changed_by);   -- FK bill_amendments_changed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_discount_approvals_approved_by
  ON public.bill_discount_approvals (approved_by);   -- FK bill_discount_approvals_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_discount_approvals_requested_by
  ON public.bill_discount_approvals (requested_by);   -- FK bill_discount_approvals_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_line_items_ordered_by
  ON public.bill_line_items (ordered_by);   -- FK bill_line_items_ordered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_line_items_payment_collected_by
  ON public.bill_line_items (payment_collected_by);   -- FK bill_line_items_payment_collected_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_line_items_service_id
  ON public.bill_line_items (service_id);   -- FK bill_line_items_service_id_fkey -> service_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bill_payments_received_by
  ON public.bill_payments (received_by);   -- FK bill_payments_received_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bills_created_by
  ON public.bills (created_by);   -- FK bills_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bills_encounter_id
  ON public.bills (encounter_id);   -- FK bills_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bills_admission_id
  ON public.bills (admission_id);   -- FK bills_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bills_discount_approved_by
  ON public.bills (discount_approved_by);   -- FK bills_discount_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_antibody_screening_tested_by
  ON public.blood_antibody_screening (tested_by);   -- FK blood_antibody_screening_tested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_antibody_screening_unit_id
  ON public.blood_antibody_screening (unit_id);   -- FK blood_antibody_screening_unit_id_fkey -> blood_units
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_issues_issued_by
  ON public.blood_issues (issued_by);   -- FK blood_issues_issued_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_issues_unit_id
  ON public.blood_issues (unit_id);   -- FK blood_issues_unit_id_fkey -> blood_units
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_issues_cross_match_id
  ON public.blood_issues (cross_match_id);   -- FK blood_issues_cross_match_id_fkey -> cross_match_records
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_issues_bill_id
  ON public.blood_issues (bill_id);   -- FK blood_issues_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_issues_admission_id
  ON public.blood_issues (admission_id);   -- FK blood_issues_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_requests_requested_by
  ON public.blood_requests (requested_by);   -- FK blood_requests_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_requests_admission_id
  ON public.blood_requests (admission_id);   -- FK blood_requests_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_unit_tti_tests_released_by
  ON public.blood_unit_tti_tests (released_by);   -- FK blood_unit_tti_tests_released_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_unit_tti_tests_tested_by
  ON public.blood_unit_tti_tests (tested_by);   -- FK blood_unit_tti_tests_tested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_units_donor_id
  ON public.blood_units (donor_id);   -- FK blood_units_donor_id_fkey -> donors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_units_issued_to
  ON public.blood_units (issued_to);   -- FK blood_units_issued_to_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blood_units_reserved_for
  ON public.blood_units (reserved_for);   -- FK blood_units_reserved_for_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bmw_records_verified_by
  ON public.bmw_records (verified_by);   -- FK bmw_records_verified_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bmw_records_collected_by
  ON public.bmw_records (collected_by);   -- FK bmw_records_collected_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bmw_records_ward_id
  ON public.bmw_records (ward_id);   -- FK bmw_records_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_body_releases_mortuary_id
  ON public.body_releases (mortuary_id);   -- FK body_releases_mortuary_id_fkey -> mortuary_admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_body_releases_released_by
  ON public.body_releases (released_by);   -- FK body_releases_released_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bpmh_records_recorded_by
  ON public.bpmh_records (recorded_by);   -- FK bpmh_records_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bpmh_records_admission_id
  ON public.bpmh_records (admission_id);   -- FK bpmh_records_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_braden_scale_assessments_assessed_by
  ON public.braden_scale_assessments (assessed_by);   -- FK braden_scale_assessments_assessed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_braden_scale_assessments_admission_id
  ON public.braden_scale_assessments (admission_id);   -- FK braden_scale_assessments_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_breakdown_logs_reported_by
  ON public.breakdown_logs (reported_by);   -- FK breakdown_logs_reported_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_budget_lines_approved_by
  ON public.budget_lines (approved_by);   -- FK budget_lines_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_budget_lines_department_id
  ON public.budget_lines (department_id);   -- FK budget_lines_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_budget_lines_created_by
  ON public.budget_lines (created_by);   -- FK budget_lines_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calibration_records_equipment_id
  ON public.calibration_records (equipment_id);   -- FK calibration_records_equipment_id_fkey -> equipment_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_capa_records_verification_by
  ON public.capa_records (verification_by);   -- FK capa_records_verification_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_capa_records_responsible_person
  ON public.capa_records (responsible_person);   -- FK capa_records_responsible_person_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_care_bundle_checks_admission_id
  ON public.care_bundle_checks (admission_id);   -- FK care_bundle_checks_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_care_bundle_checks_recorded_by
  ON public.care_bundle_checks (recorded_by);   -- FK care_bundle_checks_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_care_plan_tasks_care_plan_id
  ON public.care_plan_tasks (care_plan_id);   -- FK care_plan_tasks_care_plan_id_fkey -> care_plans
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_case_sheet_templates_created_by
  ON public.case_sheet_templates (created_by);   -- FK case_sheet_templates_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chart_of_accounts_parent_id
  ON public.chart_of_accounts (parent_id);   -- FK chart_of_accounts_parent_id_fkey -> chart_of_accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_order_drugs_order_id
  ON public.chemo_order_drugs (order_id);   -- FK chemo_order_drugs_order_id_fkey -> chemo_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_order_drugs_administered_by
  ON public.chemo_order_drugs (administered_by);   -- FK chemo_order_drugs_administered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_v1_by
  ON public.chemo_orders (v1_by);   -- FK chemo_orders_v1_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_protocol_id
  ON public.chemo_orders (protocol_id);   -- FK chemo_orders_protocol_id_fkey -> chemo_protocols
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_ordered_by
  ON public.chemo_orders (ordered_by);   -- FK chemo_orders_ordered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_oncology_patient_id
  ON public.chemo_orders (oncology_patient_id);   -- FK chemo_orders_oncology_patient_id_fkey -> oncology_patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_v4_by
  ON public.chemo_orders (v4_by);   -- FK chemo_orders_v4_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_v2_by
  ON public.chemo_orders (v2_by);   -- FK chemo_orders_v2_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_v3_by
  ON public.chemo_orders (v3_by);   -- FK chemo_orders_v3_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_bill_id
  ON public.chemo_orders (bill_id);   -- FK chemo_orders_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chemo_orders_v5_by
  ON public.chemo_orders (v5_by);   -- FK chemo_orders_v5_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chronic_disease_programs_treating_doctor
  ON public.chronic_disease_programs (treating_doctor);   -- FK chronic_disease_programs_treating_doctor_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cleaning_schedules_assigned_supervisor
  ON public.cleaning_schedules (assigned_supervisor);   -- FK cleaning_schedules_assigned_supervisor_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cleaning_schedules_ward_id
  ON public.cleaning_schedules (ward_id);   -- FK cleaning_schedules_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_alerts_acknowledged_by
  ON public.clinical_alerts (acknowledged_by);   -- FK clinical_alerts_acknowledged_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_alerts_lab_order_item_id
  ON public.clinical_alerts (lab_order_item_id);   -- FK clinical_alerts_lab_order_item_id_fkey -> lab_order_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_audits_linked_nabh_standard_id
  ON public.clinical_audits (linked_nabh_standard_id);   -- FK clinical_audits_linked_nabh_standard_id_fkey -> nabh_standards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_audits_department_id
  ON public.clinical_audits (department_id);   -- FK clinical_audits_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_audits_created_by
  ON public.clinical_audits (created_by);   -- FK clinical_audits_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_code_blue_audits_audited_by
  ON public.code_blue_audits (audited_by);   -- FK code_blue_audits_audited_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_code_blue_audits_event_id
  ON public.code_blue_audits (event_id);   -- FK code_blue_audits_event_id_fkey -> code_blue_events
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_code_blue_events_team_leader
  ON public.code_blue_events (team_leader);   -- FK code_blue_events_team_leader_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_coding_audits_audited_by
  ON public.coding_audits (audited_by);   -- FK coding_audits_audited_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_coding_audits_coding_id
  ON public.coding_audits (coding_id);   -- FK coding_audits_coding_id_fkey -> icd_codings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cold_chain_log_recorded_by
  ON public.cold_chain_log (recorded_by);   -- FK cold_chain_log_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cold_storage_log_recorded_by
  ON public.cold_storage_log (recorded_by);   -- FK cold_storage_log_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collection_campaigns_created_by
  ON public.collection_campaigns (created_by);   -- FK collection_campaigns_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_committee_action_items_responsible_owner_id
  ON public.committee_action_items (responsible_owner_id);   -- FK committee_action_items_responsible_owner_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_committee_meetings_created_by
  ON public.committee_meetings (created_by);   -- FK committee_meetings_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_committee_members_user_id
  ON public.committee_members (user_id);   -- FK committee_members_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_config_change_logs_changed_by
  ON public.config_change_logs (changed_by);   -- FK config_change_logs_changed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credential_override_log_acting_user_id
  ON public.credential_override_log (acting_user_id);   -- FK credential_override_log_acting_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credential_override_log_clinician_id
  ON public.credential_override_log (clinician_id);   -- FK credential_override_log_clinician_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_note_items_dispensing_item_id
  ON public.credit_note_items (dispensing_item_id);   -- FK credit_note_items_dispensing_item_id_fkey -> pharmacy_dispensing_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_notes_admission_id
  ON public.credit_notes (admission_id);   -- FK credit_notes_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_notes_created_by
  ON public.credit_notes (created_by);   -- FK credit_notes_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_notes_original_bill_id
  ON public.credit_notes (original_bill_id);   -- FK credit_notes_original_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_notes_approved_by
  ON public.credit_notes (approved_by);   -- FK credit_notes_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_match_records_admission_id
  ON public.cross_match_records (admission_id);   -- FK cross_match_records_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_match_records_unit_id
  ON public.cross_match_records (unit_id);   -- FK cross_match_records_unit_id_fkey -> blood_units
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_match_records_performed_by
  ON public.cross_match_records (performed_by);   -- FK cross_match_records_performed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cycle_instruments_cycle_id
  ON public.cycle_instruments (cycle_id);   -- FK cycle_instruments_cycle_id_fkey -> sterilization_cycles
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cycle_instruments_instrument_id
  ON public.cycle_instruments (instrument_id);   -- FK cycle_instruments_instrument_id_fkey -> instruments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cycle_instruments_set_id
  ON public.cycle_instruments (set_id);   -- FK cycle_instruments_set_id_fkey -> instrument_sets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_cash_closure_closed_by
  ON public.daily_cash_closure (closed_by);   -- FK daily_cash_closure_closed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_cash_closure_approved_by
  ON public.daily_cash_closure (approved_by);   -- FK daily_cash_closure_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_data_erasure_requests_requested_by
  ON public.data_erasure_requests (requested_by);   -- FK data_erasure_requests_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_data_erasure_requests_reviewed_by
  ON public.data_erasure_requests (reviewed_by);   -- FK data_erasure_requests_reviewed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daycare_chairs_current_patient
  ON public.daycare_chairs (current_patient);   -- FK daycare_chairs_current_patient_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_death_certificates_certified_by
  ON public.death_certificates (certified_by);   -- FK death_certificates_certified_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_death_certificates_admission_id
  ON public.death_certificates (admission_id);   -- FK death_certificates_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_demand_forecasts_item_id
  ON public.demand_forecasts (item_id);   -- FK demand_forecasts_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dental_charts_created_by
  ON public.dental_charts (created_by);   -- FK dental_charts_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dental_lab_orders_ordered_by
  ON public.dental_lab_orders (ordered_by);   -- FK dental_lab_orders_ordered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dental_treatment_plans_created_by
  ON public.dental_treatment_plans (created_by);   -- FK dental_treatment_plans_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dental_treatment_plans_bill_id
  ON public.dental_treatment_plans (bill_id);   -- FK dental_treatment_plans_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dental_treatment_plans_chart_id
  ON public.dental_treatment_plans (chart_id);   -- FK dental_treatment_plans_chart_id_fkey -> dental_charts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_department_indents_requested_by
  ON public.department_indents (requested_by);   -- FK department_indents_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_department_indents_department_id
  ON public.department_indents (department_id);   -- FK department_indents_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_department_indents_approved_by
  ON public.department_indents (approved_by);   -- FK department_indents_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_depreciation_postings_journal_id
  ON public.depreciation_postings (journal_id);   -- FK depreciation_postings_journal_id_fkey -> journal_entries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_depreciation_postings_asset_id
  ON public.depreciation_postings (asset_id);   -- FK depreciation_postings_asset_id_fkey -> fixed_assets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialysis_machines_current_patient_id
  ON public.dialysis_machines (current_patient_id);   -- FK dialysis_machines_current_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialysis_patients_treating_doctor
  ON public.dialysis_patients (treating_doctor);   -- FK dialysis_patients_treating_doctor_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialysis_sessions_machine_id
  ON public.dialysis_sessions (machine_id);   -- FK dialysis_sessions_machine_id_fkey -> dialysis_machines
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialysis_sessions_performed_by
  ON public.dialysis_sessions (performed_by);   -- FK dialysis_sessions_performed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialysis_sessions_dialysis_patient_id
  ON public.dialysis_sessions (dialysis_patient_id);   -- FK dialysis_sessions_dialysis_patient_id_fkey -> dialysis_patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialysis_sessions_bill_id
  ON public.dialysis_sessions (bill_id);   -- FK dialysis_sessions_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialyzer_reuse_dialysis_patient_id
  ON public.dialyzer_reuse (dialysis_patient_id);   -- FK dialyzer_reuse_dialysis_patient_id_fkey -> dialysis_patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dicom_files_uploaded_by
  ON public.dicom_files (uploaded_by);   -- FK dicom_files_uploaded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_diet_orders_ordered_by
  ON public.diet_orders (ordered_by);   -- FK diet_orders_ordered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_diet_plans_created_by
  ON public.diet_plans (created_by);   -- FK diet_plans_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dietitian_notes_admission_id
  ON public.dietitian_notes (admission_id);   -- FK dietitian_notes_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dietitian_notes_noted_by
  ON public.dietitian_notes (noted_by);   -- FK dietitian_notes_noted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disaster_drills_approved_by
  ON public.disaster_drills (approved_by);   -- FK disaster_drills_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disaster_drills_coordinator
  ON public.disaster_drills (coordinator);   -- FK disaster_drills_coordinator_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disciplinary_actions_raised_by
  ON public.disciplinary_actions (raised_by);   -- FK disciplinary_actions_raised_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_discount_approvals_bill_id
  ON public.discount_approvals (bill_id);   -- FK discount_approvals_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_discount_approvals_requested_by
  ON public.discount_approvals (requested_by);   -- FK discount_approvals_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_discount_approvals_approved_by
  ON public.discount_approvals (approved_by);   -- FK discount_approvals_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_discount_codes_created_by
  ON public.discount_codes (created_by);   -- FK discount_codes_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doctor_schedules_doctor_id
  ON public.doctor_schedules (doctor_id);   -- FK doctor_schedules_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doctor_slots_department_id
  ON public.doctor_slots (department_id);   -- FK doctor_slots_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_donor_campaigns_triggered_by
  ON public.donor_campaigns (triggered_by);   -- FK donor_campaigns_triggered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dunning_attempts_subscription_id
  ON public.dunning_attempts (subscription_id);   -- FK dunning_attempts_subscription_id_fkey -> hospital_subscriptions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_duty_roster_published_by
  ON public.duty_roster (published_by);   -- FK duty_roster_published_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_duty_roster_ward_id
  ON public.duty_roster (ward_id);   -- FK duty_roster_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_duty_roster_department_id
  ON public.duty_roster (department_id);   -- FK duty_roster_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_duty_roster_created_by
  ON public.duty_roster (created_by);   -- FK duty_roster_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_duty_roster_shift_id
  ON public.duty_roster (shift_id);   -- FK duty_roster_shift_id_fkey -> shift_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ed_charge_items_service_master_id
  ON public.ed_charge_items (service_master_id);   -- FK ed_charge_items_service_master_id_fkey -> service_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ed_handover_notes_incoming_nurse_id
  ON public.ed_handover_notes (incoming_nurse_id);   -- FK ed_handover_notes_incoming_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ed_handover_notes_outgoing_nurse_id
  ON public.ed_handover_notes (outgoing_nurse_id);   -- FK ed_handover_notes_outgoing_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ed_medications_ed_charge_item_id
  ON public.ed_medications (ed_charge_item_id);   -- FK ed_medications_ed_charge_item_id_fkey -> ed_charge_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ed_visits_bill_id
  ON public.ed_visits (bill_id);   -- FK ed_visits_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ed_visits_doctor_id
  ON public.ed_visits (doctor_id);   -- FK ed_visits_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_electrical_safety_logs_performed_by
  ON public.electrical_safety_logs (performed_by);   -- FK electrical_safety_logs_performed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_embryo_bank_cycle_id
  ON public.embryo_bank (cycle_id);   -- FK embryo_bank_cycle_id_fkey -> ivf_cycles
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_embryo_bank_embryo_id
  ON public.embryo_bank (embryo_id);   -- FK embryo_bank_embryo_id_fkey -> embryology_records
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emi_installments_payment_id
  ON public.emi_installments (payment_id);   -- FK emi_installments_payment_id_fkey -> bill_payments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emi_plans_created_by
  ON public.emi_plans (created_by);   -- FK emi_plans_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_epidemic_protocols_activated_by
  ON public.epidemic_protocols (activated_by);   -- FK epidemic_protocols_activated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_esg_monthly_metrics_entered_by
  ON public.esg_monthly_metrics (entered_by);   -- FK esg_monthly_metrics_entered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expense_records_created_by
  ON public.expense_records (created_by);   -- FK expense_records_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expense_records_journal_id
  ON public.expense_records (journal_id);   -- FK expense_records_journal_id_fkey -> journal_entries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expense_records_department_id
  ON public.expense_records (department_id);   -- FK expense_records_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_external_lab_referrals_referred_by
  ON public.external_lab_referrals (referred_by);   -- FK external_lab_referrals_referred_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fall_risk_assessments_assessed_by
  ON public.fall_risk_assessments (assessed_by);   -- FK fall_risk_assessments_assessed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fcm_tokens_user_id
  ON public.fcm_tokens (user_id);   -- FK fcm_tokens_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feedback_records_escalated_to
  ON public.feedback_records (escalated_to);   -- FK feedback_records_escalated_to_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fire_safety_drills_conducted_by
  ON public.fire_safety_drills (conducted_by);   -- FK fire_safety_drills_conducted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fixed_assets_department_id
  ON public.fixed_assets (department_id);   -- FK fixed_assets_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_full_final_settlements_settled_by
  ON public.full_final_settlements (settled_by);   -- FK full_final_settlements_settled_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grievances_assigned_to
  ON public.grievances (assigned_to);   -- FK grievances_assigned_to_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grievances_department_id
  ON public.grievances (department_id);   -- FK grievances_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_ai_log_grn_id
  ON public.grn_ai_log (grn_id);   -- FK grn_ai_log_grn_id_fkey -> grn_records
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_items_grn_id
  ON public.grn_items (grn_id);   -- FK grn_items_grn_id_fkey -> grn_records
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_items_po_item_id
  ON public.grn_items (po_item_id);   -- FK grn_items_po_item_id_fkey -> po_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_items_item_id
  ON public.grn_items (item_id);   -- FK grn_items_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_records_received_by
  ON public.grn_records (received_by);   -- FK grn_records_received_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_records_po_id
  ON public.grn_records (po_id);   -- FK grn_records_po_id_fkey -> purchase_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_records_vendor_id
  ON public.grn_records (vendor_id);   -- FK grn_records_vendor_id_fkey -> vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_guideline_adherence_log_guideline_id
  ON public.guideline_adherence_log (guideline_id);   -- FK guideline_adherence_log_guideline_id_fkey -> clinical_guidelines
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hand_hygiene_audits_auditor_id
  ON public.hand_hygiene_audits (auditor_id);   -- FK hand_hygiene_audits_auditor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hand_hygiene_audits_ward_id
  ON public.hand_hygiene_audits (ward_id);   -- FK hand_hygiene_audits_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hcx_submissions_pre_auth_id
  ON public.hcx_submissions (pre_auth_id);   -- FK hcx_submissions_pre_auth_id_fkey -> insurance_pre_auth
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hcx_submissions_claim_id
  ON public.hcx_submissions (claim_id);   -- FK hcx_submissions_claim_id_fkey -> insurance_claims
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_coach_sessions_discharge_id
  ON public.health_coach_sessions (discharge_id);   -- FK health_coach_sessions_discharge_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hep_plans_created_by
  ON public.hep_plans (created_by);   -- FK hep_plans_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_high_alert_double_checks_first_check_by
  ON public.high_alert_double_checks (first_check_by);   -- FK high_alert_double_checks_first_check_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_high_alert_double_checks_admission_id
  ON public.high_alert_double_checks (admission_id);   -- FK high_alert_double_checks_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_high_alert_double_checks_second_check_by
  ON public.high_alert_double_checks (second_check_by);   -- FK high_alert_double_checks_second_check_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hmis_reports_submitted_by
  ON public.hmis_reports (submitted_by);   -- FK hmis_reports_submitted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_home_care_plans_created_by
  ON public.home_care_plans (created_by);   -- FK home_care_plans_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_home_care_plans_care_coordinator
  ON public.home_care_plans (care_coordinator);   -- FK home_care_plans_care_coordinator_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_home_care_visits_plan_id
  ON public.home_care_visits (plan_id);   -- FK home_care_visits_plan_id_fkey -> home_care_plans
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_home_care_visits_nurse_id
  ON public.home_care_visits (nurse_id);   -- FK home_care_visits_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_home_tele_monitoring_plan_id
  ON public.home_tele_monitoring (plan_id);   -- FK home_tele_monitoring_plan_id_fkey -> home_care_plans
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospital_addons_purchased_by
  ON public.hospital_addons (purchased_by);   -- FK hospital_addons_purchased_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospital_addons_addon_sku_id
  ON public.hospital_addons (addon_sku_id);   -- FK hospital_addons_addon_sku_id_fkey -> addon_skus
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospital_committees_chairperson_id
  ON public.hospital_committees (chairperson_id);   -- FK hospital_committees_chairperson_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospital_committees_secretary_id
  ON public.hospital_committees (secretary_id);   -- FK hospital_committees_secretary_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospital_feature_overrides_created_by
  ON public.hospital_feature_overrides (created_by);   -- FK hospital_feature_overrides_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospital_module_entitlements_updated_by
  ON public.hospital_module_entitlements (updated_by);   -- FK hospital_module_entitlements_updated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospital_pricing_overrides_created_by
  ON public.hospital_pricing_overrides (created_by);   -- FK hospital_pricing_overrides_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospitals_chain_id
  ON public.hospitals (chain_id);   -- FK hospitals_chain_id_fkey -> hospital_chains
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hospitals_referred_by_code_id
  ON public.hospitals (referred_by_code_id);   -- FK hospitals_referred_by_code_id_fkey -> referral_codes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_housekeeping_tasks_bed_id
  ON public.housekeeping_tasks (bed_id);   -- FK housekeeping_tasks_bed_id_fkey -> beds
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icd10_code_sets_uploaded_by
  ON public.icd10_code_sets (uploaded_by);   -- FK icd10_code_sets_uploaded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icd10_codes_code_set_id
  ON public.icd10_codes (code_set_id);   -- FK icd10_codes_code_set_id_fkey -> icd10_code_sets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icd_codings_mrd_locked_by
  ON public.icd_codings (mrd_locked_by);   -- FK icd_codings_mrd_locked_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icd_codings_validated_by
  ON public.icd_codings (validated_by);   -- FK icd_codings_validated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icd_codings_coded_by
  ON public.icd_codings (coded_by);   -- FK icd_codings_coded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icu_daily_goals_updated_by
  ON public.icu_daily_goals (updated_by);   -- FK icu_daily_goals_updated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icu_daily_goals_admission_id
  ON public.icu_daily_goals (admission_id);   -- FK icu_daily_goals_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icu_flowsheet_entries_admission_id
  ON public.icu_flowsheet_entries (admission_id);   -- FK icu_flowsheet_entries_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icu_flowsheet_entries_recorded_by
  ON public.icu_flowsheet_entries (recorded_by);   -- FK icu_flowsheet_entries_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbox_messages_parent_id
  ON public.inbox_messages (parent_id);   -- FK inbox_messages_parent_id_fkey -> inbox_messages
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incident_reports_department_id
  ON public.incident_reports (department_id);   -- FK incident_reports_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incident_reports_reported_by
  ON public.incident_reports (reported_by);   -- FK incident_reports_reported_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_indent_items_indent_id
  ON public.indent_items (indent_id);   -- FK indent_items_indent_id_fkey -> department_indents
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_indent_items_item_id
  ON public.indent_items (item_id);   -- FK indent_items_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instruments_set_id
  ON public.instruments (set_id);   -- FK instruments_set_id_fkey -> instrument_sets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_automation_log_admission_id
  ON public.insurance_automation_log (admission_id);   -- FK insurance_automation_log_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_automation_log_pre_auth_id
  ON public.insurance_automation_log (pre_auth_id);   -- FK insurance_automation_log_pre_auth_id_fkey -> insurance_pre_auth
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_claims_parent_claim_id
  ON public.insurance_claims (parent_claim_id);   -- FK insurance_claims_parent_claim_id_fkey -> insurance_claims
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_claims_pre_auth_id
  ON public.insurance_claims (pre_auth_id);   -- FK insurance_claims_pre_auth_id_fkey -> insurance_pre_auth
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_claims_payer_id
  ON public.insurance_claims (payer_id);   -- FK insurance_claims_payer_id_fkey -> payer_masters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_claims_bill_id
  ON public.insurance_claims (bill_id);   -- FK insurance_claims_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_claims_created_by
  ON public.insurance_claims (created_by);   -- FK insurance_claims_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_enhancement_requests_admission_id
  ON public.insurance_enhancement_requests (admission_id);   -- FK insurance_enhancement_requests_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_enhancement_requests_submitted_by
  ON public.insurance_enhancement_requests (submitted_by);   -- FK insurance_enhancement_requests_submitted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_enhancement_requests_reviewed_by
  ON public.insurance_enhancement_requests (reviewed_by);   -- FK insurance_enhancement_requests_reviewed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_enhancement_requests_pre_auth_id
  ON public.insurance_enhancement_requests (pre_auth_id);   -- FK insurance_enhancement_requests_pre_auth_id_fkey -> insurance_pre_auth
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_intimations_admission_id
  ON public.insurance_intimations (admission_id);   -- FK insurance_intimations_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_pre_auth_parent_pre_auth_id
  ON public.insurance_pre_auth (parent_pre_auth_id);   -- FK insurance_pre_auth_parent_pre_auth_id_fkey -> insurance_pre_auth
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_pre_auth_submitted_by
  ON public.insurance_pre_auth (submitted_by);   -- FK insurance_pre_auth_submitted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_pre_auth_created_by
  ON public.insurance_pre_auth (created_by);   -- FK insurance_pre_auth_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_pre_auth_admission_id
  ON public.insurance_pre_auth (admission_id);   -- FK insurance_pre_auth_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_anomalies_item_id
  ON public.inventory_anomalies (item_id);   -- FK inventory_anomalies_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_anomalies_reviewed_by
  ON public.inventory_anomalies (reviewed_by);   -- FK inventory_anomalies_reviewed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_stock_consignment_vendor_id
  ON public.inventory_stock (consignment_vendor_id);   -- FK inventory_stock_consignment_vendor_id_fkey -> vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_io_balance_records_admission_id
  ON public.io_balance_records (admission_id);   -- FK io_balance_records_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_io_balance_records_recorded_by
  ON public.io_balance_records (recorded_by);   -- FK io_balance_records_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_bundle_checklists_completed_by
  ON public.ipc_bundle_checklists (completed_by);   -- FK ipc_bundle_checklists_completed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_bundle_checklists_device_usage_id
  ON public.ipc_bundle_checklists (device_usage_id);   -- FK ipc_bundle_checklists_device_usage_id_fkey -> ipc_device_usage
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_device_usage_inserted_by
  ON public.ipc_device_usage (inserted_by);   -- FK ipc_device_usage_inserted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_device_usage_removed_by
  ON public.ipc_device_usage (removed_by);   -- FK ipc_device_usage_removed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_device_usage_ward_id
  ON public.ipc_device_usage (ward_id);   -- FK ipc_device_usage_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_infection_events_reported_by
  ON public.ipc_infection_events (reported_by);   -- FK ipc_infection_events_reported_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_infection_events_admission_id
  ON public.ipc_infection_events (admission_id);   -- FK ipc_infection_events_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_infection_events_device_usage_id
  ON public.ipc_infection_events (device_usage_id);   -- FK ipc_infection_events_device_usage_id_fkey -> ipc_device_usage
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_infection_events_lab_order_id
  ON public.ipc_infection_events (lab_order_id);   -- FK ipc_infection_events_lab_order_id_fkey -> lab_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipc_infection_events_ward_id
  ON public.ipc_infection_events (ward_id);   -- FK ipc_infection_events_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipd_advances_collected_by
  ON public.ipd_advances (collected_by);   -- FK ipd_advances_collected_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipd_medications_ordered_by
  ON public.ipd_medications (ordered_by);   -- FK ipd_medications_ordered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipd_nursing_notes_recorded_by
  ON public.ipd_nursing_notes (recorded_by);   -- FK ipd_nursing_notes_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipd_vitals_recorded_by
  ON public.ipd_vitals (recorded_by);   -- FK ipd_vitals_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_item_consumption_daily_item_id
  ON public.item_consumption_daily (item_id);   -- FK item_consumption_daily_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_iv_fluids_recorded_by
  ON public.iv_fluids (recorded_by);   -- FK iv_fluids_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ivf_cycles_bill_id
  ON public.ivf_cycles (bill_id);   -- FK ivf_cycles_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jci_evidence_items_assessed_by
  ON public.jci_evidence_items (assessed_by);   -- FK jci_evidence_items_assessed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_applicants_hired_user_id
  ON public.job_applicants (hired_user_id);   -- FK job_applicants_hired_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_openings_department_id
  ON public.job_openings (department_id);   -- FK job_openings_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_openings_created_by
  ON public.job_openings (created_by);   -- FK job_openings_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_entries_posted_by
  ON public.journal_entries (posted_by);   -- FK journal_entries_posted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_entries_reversed_by
  ON public.journal_entries (reversed_by);   -- FK journal_entries_reversed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_line_items_cost_centre_id
  ON public.journal_line_items (cost_centre_id);   -- FK journal_line_items_cost_centre_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_line_items_account_id
  ON public.journal_line_items (account_id);   -- FK journal_line_items_account_id_fkey -> chart_of_accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_line_items_journal_id
  ON public.journal_line_items (journal_id);   -- FK journal_line_items_journal_id_fkey -> journal_entries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_analyzer_messages_posted_by
  ON public.lab_analyzer_messages (posted_by);   -- FK lab_analyzer_messages_posted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_analyzer_messages_order_item_id
  ON public.lab_analyzer_messages (order_item_id);   -- FK lab_analyzer_messages_order_item_id_fkey -> lab_order_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_analyzer_test_mappings_test_id
  ON public.lab_analyzer_test_mappings (test_id);   -- FK lab_analyzer_test_mappings_test_id_fkey -> lab_test_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_calibration_records_created_by
  ON public.lab_calibration_records (created_by);   -- FK lab_calibration_records_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_order_items_test_id
  ON public.lab_order_items (test_id);   -- FK lab_order_items_test_id_fkey -> lab_test_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_order_items_critical_acknowledged_by
  ON public.lab_order_items (critical_acknowledged_by);   -- FK lab_order_items_critical_acknowledged_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_order_items_result_entered_by
  ON public.lab_order_items (result_entered_by);   -- FK lab_order_items_result_entered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_order_items_sample_collected_by
  ON public.lab_order_items (sample_collected_by);   -- FK lab_order_items_sample_collected_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_order_items_validated_by
  ON public.lab_order_items (validated_by);   -- FK lab_order_items_validated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_orders_ordered_by
  ON public.lab_orders (ordered_by);   -- FK lab_orders_ordered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_orders_qc_override_by
  ON public.lab_orders (qc_override_by);   -- FK lab_orders_qc_override_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_orders_barcode_printed_by
  ON public.lab_orders (barcode_printed_by);   -- FK lab_orders_barcode_printed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_orders_encounter_id
  ON public.lab_orders (encounter_id);   -- FK lab_orders_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_orders_mixup_acknowledged_by
  ON public.lab_orders (mixup_acknowledged_by);   -- FK lab_orders_mixup_acknowledged_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_qc_entries_recorded_by
  ON public.lab_qc_entries (recorded_by);   -- FK lab_qc_entries_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_results_finalized_by
  ON public.lab_results (finalized_by);   -- FK lab_results_finalized_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_results_verified_by
  ON public.lab_results (verified_by);   -- FK lab_results_verified_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_samples_rejected_by
  ON public.lab_samples (rejected_by);   -- FK lab_samples_rejected_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_samples_recollected_from_sample_id
  ON public.lab_samples (recollected_from_sample_id);   -- FK lab_samples_recollected_from_sample_id_fkey -> lab_samples
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_samples_received_by
  ON public.lab_samples (received_by);   -- FK lab_samples_received_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_samples_lab_order_id
  ON public.lab_samples (lab_order_id);   -- FK lab_samples_lab_order_id_fkey -> lab_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_samples_collected_by
  ON public.lab_samples (collected_by);   -- FK lab_samples_collected_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lab_test_group_items_test_id
  ON public.lab_test_group_items (test_id);   -- FK lab_test_group_items_test_id_fkey -> lab_test_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_balance_user_id
  ON public.leave_balance (user_id);   -- FK leave_balance_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_requests_user_id
  ON public.leave_requests (user_id);   -- FK leave_requests_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_requests_reviewed_by
  ON public.leave_requests (reviewed_by);   -- FK leave_requests_reviewed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_linen_records_ward_id
  ON public.linen_records (ward_id);   -- FK linen_records_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lms_certificates_enrollment_id
  ON public.lms_certificates (enrollment_id);   -- FK lms_certificates_enrollment_id_fkey -> lms_enrollments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lms_certificates_course_id
  ON public.lms_certificates (course_id);   -- FK lms_certificates_course_id_fkey -> lms_courses
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lms_enrollments_course_id
  ON public.lms_enrollments (course_id);   -- FK lms_enrollments_course_id_fkey -> lms_courses
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mar_double_checks_first_nurse_id
  ON public.mar_double_checks (first_nurse_id);   -- FK mar_double_checks_first_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mar_double_checks_mar_id
  ON public.mar_double_checks (mar_id);   -- FK mar_double_checks_mar_id_fkey -> nursing_mar
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mar_double_checks_second_nurse_id
  ON public.mar_double_checks (second_nurse_id);   -- FK mar_double_checks_second_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mar_records_source_mar_id
  ON public.mar_records (source_mar_id);   -- FK mar_records_source_mar_id_fkey -> nursing_mar
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marketing_campaigns_created_by
  ON public.marketing_campaigns (created_by);   -- FK marketing_campaigns_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mccd_certificates_certifying_doctor
  ON public.mccd_certificates (certifying_doctor);   -- FK mccd_certificates_certifying_doctor_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mci_events_deactivated_by
  ON public.mci_events (deactivated_by);   -- FK mci_events_deactivated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mci_events_activated_by
  ON public.mci_events (activated_by);   -- FK mci_events_activated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mci_triage_patients_mci_event_id
  ON public.mci_triage_patients (mci_event_id);   -- FK mci_triage_patients_mci_event_id_fkey -> mci_events
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mci_triage_patients_triaged_by
  ON public.mci_triage_patients (triaged_by);   -- FK mci_triage_patients_triaged_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meal_deliveries_admission_id
  ON public.meal_deliveries (admission_id);   -- FK meal_deliveries_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meal_deliveries_delivered_by
  ON public.meal_deliveries (delivered_by);   -- FK meal_deliveries_delivered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meal_deliveries_diet_order_id
  ON public.meal_deliveries (diet_order_id);   -- FK meal_deliveries_diet_order_id_fkey -> diet_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_med_admin_records_administered_by
  ON public.med_admin_records (administered_by);   -- FK med_admin_records_administered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_med_reconciliation_events_verified_by
  ON public.med_reconciliation_events (verified_by);   -- FK med_reconciliation_events_verified_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_med_reconciliation_events_reconciled_by
  ON public.med_reconciliation_events (reconciled_by);   -- FK med_reconciliation_events_reconciled_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medical_gas_logs_recorded_by
  ON public.medical_gas_logs (recorded_by);   -- FK medical_gas_logs_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medication_adherence_care_plan_id
  ON public.medication_adherence (care_plan_id);   -- FK medication_adherence_care_plan_id_fkey -> care_plans
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_migration_jobs_started_by
  ON public.migration_jobs (started_by);   -- FK migration_jobs_started_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mlc_cases_created_by
  ON public.mlc_cases (created_by);   -- FK mlc_cases_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mlc_records_mortuary_id
  ON public.mlc_records (mortuary_id);   -- FK mlc_records_mortuary_id_fkey -> mortuary_admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mortuary_admissions_pronounced_by
  ON public.mortuary_admissions (pronounced_by);   -- FK mortuary_admissions_pronounced_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mortuary_admissions_admission_id
  ON public.mortuary_admissions (admission_id);   -- FK mortuary_admissions_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mrr_snapshots_plan_id
  ON public.mrr_snapshots (plan_id);   -- FK mrr_snapshots_plan_id_fkey -> subscription_plans
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nabh_evidence_items_uploaded_by
  ON public.nabh_evidence_items (uploaded_by);   -- FK nabh_evidence_items_uploaded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nabh_evidence_log_logged_by
  ON public.nabh_evidence_log (logged_by);   -- FK nabh_evidence_log_logged_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nabh_hospital_compliance_nabh_standard_id
  ON public.nabh_hospital_compliance (nabh_standard_id);   -- FK nabh_hospital_compliance_nabh_standard_id_fkey -> nabh_standards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nabh_hospital_compliance_process_owner_id
  ON public.nabh_hospital_compliance (process_owner_id);   -- FK nabh_hospital_compliance_process_owner_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nabh_hospital_compliance_last_assessed_by
  ON public.nabh_hospital_compliance (last_assessed_by);   -- FK nabh_hospital_compliance_last_assessed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ndps_pending_dispenses_primary_pharmacist_id
  ON public.ndps_pending_dispenses (primary_pharmacist_id);   -- FK ndps_pending_dispenses_primary_pharmacist_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ndps_pending_dispenses_drug_id
  ON public.ndps_pending_dispenses (drug_id);   -- FK ndps_pending_dispenses_drug_id_fkey -> drug_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ndps_pending_dispenses_countersigner_id
  ON public.ndps_pending_dispenses (countersigner_id);   -- FK ndps_pending_dispenses_countersigner_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ndps_register_pharmacist_id
  ON public.ndps_register (pharmacist_id);   -- FK ndps_register_pharmacist_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ndps_register_countersigned_by
  ON public.ndps_register (countersigned_by);   -- FK ndps_register_countersigned_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ndps_register_drug_id
  ON public.ndps_register (drug_id);   -- FK ndps_register_drug_id_fkey -> drug_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ndps_register_second_pharmacist_id
  ON public.ndps_register (second_pharmacist_id);   -- FK ndps_register_second_pharmacist_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ndps_register_dispensing_id
  ON public.ndps_register (dispensing_id);   -- FK ndps_register_dispensing_id_fkey -> pharmacy_dispensing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_neonatal_records_admission_id
  ON public.neonatal_records (admission_id);   -- FK neonatal_records_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_neonatal_records_mother_patient_id
  ON public.neonatal_records (mother_patient_id);   -- FK neonatal_records_mother_patient_id_fkey -> patients
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nps_responses_survey_id
  ON public.nps_responses (survey_id);   -- FK nps_responses_survey_id_fkey -> nps_surveys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_fluid_outputs_recorded_by
  ON public.nursing_fluid_outputs (recorded_by);   -- FK nursing_fluid_outputs_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_handovers_ward_id
  ON public.nursing_handovers (ward_id);   -- FK nursing_handovers_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_handovers_outgoing_nurse_id
  ON public.nursing_handovers (outgoing_nurse_id);   -- FK nursing_handovers_outgoing_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_handovers_incoming_nurse_id
  ON public.nursing_handovers (incoming_nurse_id);   -- FK nursing_handovers_incoming_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_mar_second_nurse_id
  ON public.nursing_mar (second_nurse_id);   -- FK nursing_mar_second_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_mar_administered_by
  ON public.nursing_mar (administered_by);   -- FK nursing_mar_administered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_procedure_consumables_inventory_item_id
  ON public.nursing_procedure_consumables (inventory_item_id);   -- FK nursing_procedure_consumables_inventory_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_procedures_admission_id
  ON public.nursing_procedures (admission_id);   -- FK nursing_procedures_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_procedures_bill_id
  ON public.nursing_procedures (bill_id);   -- FK nursing_procedures_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_procedures_performed_by
  ON public.nursing_procedures (performed_by);   -- FK nursing_procedures_performed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nursing_vitals_recorded_by
  ON public.nursing_vitals (recorded_by);   -- FK nursing_vitals_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nutrition_screenings_screened_by
  ON public.nutrition_screenings (screened_by);   -- FK nutrition_screenings_screened_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nutritional_screenings_screened_by
  ON public.nutritional_screenings (screened_by);   -- FK nutritional_screenings_screened_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_occupational_health_records_recorded_by
  ON public.occupational_health_records (recorded_by);   -- FK occupational_health_records_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_occupational_health_records_user_id
  ON public.occupational_health_records (user_id);   -- FK occupational_health_records_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oncology_patients_treating_oncologist
  ON public.oncology_patients (treating_oncologist);   -- FK oncology_patients_treating_oncologist_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oncology_patients_protocol_id
  ON public.oncology_patients (protocol_id);   -- FK oncology_patients_protocol_id_fkey -> chemo_protocols
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_online_reviews_responded_by
  ON public.online_reviews (responded_by);   -- FK online_reviews_responded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_diagnoses_created_by
  ON public.opd_diagnoses (created_by);   -- FK opd_diagnoses_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_encounters_token_id
  ON public.opd_encounters (token_id);   -- FK opd_encounters_token_id_fkey -> opd_tokens
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_encounters_consultation_bill_id
  ON public.opd_encounters (consultation_bill_id);   -- FK opd_encounters_consultation_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_encounters_revisit_of_encounter_id
  ON public.opd_encounters (revisit_of_encounter_id);   -- FK opd_encounters_revisit_of_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_tokens_appointment_id
  ON public.opd_tokens (appointment_id);   -- FK opd_tokens_appointment_id_fkey -> appointments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_tokens_revisit_of_token_id
  ON public.opd_tokens (revisit_of_token_id);   -- FK opd_tokens_revisit_of_token_id_fkey -> opd_tokens
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_tokens_department_id
  ON public.opd_tokens (department_id);   -- FK opd_tokens_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_tokens_payer_id
  ON public.opd_tokens (payer_id);   -- FK opd_tokens_payer_id_fkey -> payer_masters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_tokens_doctor_id
  ON public.opd_tokens (doctor_id);   -- FK opd_tokens_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_visits_department_id
  ON public.opd_visits (department_id);   -- FK opd_visits_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_opd_visits_doctor_id
  ON public.opd_visits (doctor_id);   -- FK opd_visits_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organ_donations_mortuary_id
  ON public.organ_donations (mortuary_id);   -- FK organ_donations_mortuary_id_fkey -> mortuary_admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_checklists_ot_schedule_id
  ON public.ot_checklists (ot_schedule_id);   -- FK ot_checklists_ot_schedule_id_fkey -> ot_schedules
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_consumables_created_by
  ON public.ot_consumables (created_by);   -- FK ot_consumables_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_consumables_inventory_item_id
  ON public.ot_consumables (inventory_item_id);   -- FK ot_consumables_inventory_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_implants_inventory_item_id
  ON public.ot_implants (inventory_item_id);   -- FK ot_implants_inventory_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_implants_created_by
  ON public.ot_implants (created_by);   -- FK ot_implants_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_schedules_bill_id
  ON public.ot_schedules (bill_id);   -- FK ot_schedules_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_schedules_admission_id
  ON public.ot_schedules (admission_id);   -- FK ot_schedules_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_schedules_pac_done_by
  ON public.ot_schedules (pac_done_by);   -- FK ot_schedules_pac_done_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_schedules_ot_room_id
  ON public.ot_schedules (ot_room_id);   -- FK ot_schedules_ot_room_id_fkey -> ot_rooms
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_schedules_anaesthetist_id
  ON public.ot_schedules (anaesthetist_id);   -- FK ot_schedules_anaesthetist_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_schedules_scrub_nurse_id
  ON public.ot_schedules (scrub_nurse_id);   -- FK ot_schedules_scrub_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_schedules_surgeon_id
  ON public.ot_schedules (surgeon_id);   -- FK ot_schedules_surgeon_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_schedules_privilege_override_by
  ON public.ot_schedules (privilege_override_by);   -- FK ot_schedules_privilege_override_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ot_team_members_ot_schedule_id
  ON public.ot_team_members (ot_schedule_id);   -- FK ot_team_members_ot_schedule_id_fkey -> ot_schedules
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outcome_scores_scored_by
  ON public.outcome_scores (scored_by);   -- FK outcome_scores_scored_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_overtime_requests_reviewed_by
  ON public.overtime_requests (reviewed_by);   -- FK overtime_requests_reviewed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_overtime_requests_user_id
  ON public.overtime_requests (user_id);   -- FK overtime_requests_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_bookings_bill_id
  ON public.package_bookings (bill_id);   -- FK package_bookings_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_bookings_coordinator
  ON public.package_bookings (coordinator);   -- FK package_bookings_coordinator_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_bookings_corporate_account_id
  ON public.package_bookings (corporate_account_id);   -- FK package_bookings_corporate_account_id_fkey -> corporate_accounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_bookings_package_id
  ON public.package_bookings (package_id);   -- FK package_bookings_package_id_fkey -> health_packages
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_extras_service_id
  ON public.package_extras (service_id);   -- FK package_extras_service_id_fkey -> service_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_inclusions_service_id
  ON public.package_inclusions (service_id);   -- FK package_inclusions_service_id_fkey -> service_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_station_logs_booking_id
  ON public.package_station_logs (booking_id);   -- FK package_station_logs_booking_id_fkey -> package_bookings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_station_logs_completed_by
  ON public.package_station_logs (completed_by);   -- FK package_station_logs_completed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pain_audit_records_ward_id
  ON public.pain_audit_records (ward_id);   -- FK pain_audit_records_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pain_audit_records_auditor_id
  ON public.pain_audit_records (auditor_id);   -- FK pain_audit_records_auditor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_palliative_care_plans_key_nurse_id
  ON public.palliative_care_plans (key_nurse_id);   -- FK palliative_care_plans_key_nurse_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_palliative_care_plans_admission_id
  ON public.palliative_care_plans (admission_id);   -- FK palliative_care_plans_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_palliative_care_plans_palliative_physician_id
  ON public.palliative_care_plans (palliative_physician_id);   -- FK palliative_care_plans_palliative_physician_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_panchakarma_schedules_prescribed_by
  ON public.panchakarma_schedules (prescribed_by);   -- FK panchakarma_schedules_prescribed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_panchakarma_schedules_therapist_id
  ON public.panchakarma_schedules (therapist_id);   -- FK panchakarma_schedules_therapist_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_partograph_entries_recorded_by
  ON public.partograph_entries (recorded_by);   -- FK partograph_entries_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_partograph_records_admission_id
  ON public.partograph_records (admission_id);   -- FK partograph_records_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pathology_cases_first_signed_by
  ON public.pathology_cases (first_signed_by);   -- FK pathology_cases_first_signed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pathology_cases_final_signed_by
  ON public.pathology_cases (final_signed_by);   -- FK pathology_cases_final_signed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pathology_cases_created_by
  ON public.pathology_cases (created_by);   -- FK pathology_cases_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_abha_profiles_linked_by
  ON public.patient_abha_profiles (linked_by);   -- FK patient_abha_profiles_linked_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_acquisition_campaign_id
  ON public.patient_acquisition (campaign_id);   -- FK patient_acquisition_campaign_id_fkey -> marketing_campaigns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_acquisition_referral_doctor_id
  ON public.patient_acquisition (referral_doctor_id);   -- FK patient_acquisition_referral_doctor_id_fkey -> referral_doctors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_consents_signed_by_user_id
  ON public.patient_consents (signed_by_user_id);   -- FK patient_consents_signed_by_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_consents_template_id
  ON public.patient_consents (template_id);   -- FK patient_consents_template_id_fkey -> consent_form_templates
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_consents_admission_id
  ON public.patient_consents (admission_id);   -- FK patient_consents_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_documents_uploaded_by
  ON public.patient_documents (uploaded_by);   -- FK patient_documents_uploaded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_encounter_templates_template_definition_id
  ON public.patient_encounter_templates (template_definition_id);   -- FK patient_encounter_templates_template_definition_id_fkey -> emr_template_definitions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_encounter_templates_encounter_id
  ON public.patient_encounter_templates (encounter_id);   -- FK patient_encounter_templates_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_encounter_templates_clinician_id
  ON public.patient_encounter_templates (clinician_id);   -- FK patient_encounter_templates_clinician_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_feedback_encounter_id
  ON public.patient_feedback (encounter_id);   -- FK patient_feedback_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_feedback_admission_id
  ON public.patient_feedback (admission_id);   -- FK patient_feedback_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_history_digests_job_id
  ON public.patient_history_digests (job_id);   -- FK patient_history_digests_job_id_fkey -> patient_history_ingest_jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_history_digests_reviewed_by
  ON public.patient_history_digests (reviewed_by);   -- FK patient_history_digests_reviewed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_history_ingest_jobs_encounter_id
  ON public.patient_history_ingest_jobs (encounter_id);   -- FK patient_history_ingest_jobs_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_history_ingest_jobs_requested_by
  ON public.patient_history_ingest_jobs (requested_by);   -- FK patient_history_ingest_jobs_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_rights_acknowledgements_admission_id
  ON public.patient_rights_acknowledgements (admission_id);   -- FK patient_rights_acknowledgements_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_template_responses_encounter_template_id
  ON public.patient_template_responses (encounter_template_id);   -- FK patient_template_responses_encounter_template_id_fkey -> patient_encounter_templates
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_links_created_by
  ON public.payment_links (created_by);   -- FK payment_links_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_items_user_id
  ON public.payroll_items (user_id);   -- FK payroll_items_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_items_payroll_run_id
  ON public.payroll_items (payroll_run_id);   -- FK payroll_items_payroll_run_id_fkey -> payroll_runs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_runs_approved_by
  ON public.payroll_runs (approved_by);   -- FK payroll_runs_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_runs_processed_by
  ON public.payroll_runs (processed_by);   -- FK payroll_runs_processed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payslips_structure_id
  ON public.payslips (structure_id);   -- FK payslips_structure_id_fkey -> salary_structures
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pcpndt_form_f_order_id
  ON public.pcpndt_form_f (order_id);   -- FK pcpndt_form_f_order_id_fkey -> radiology_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pcpndt_form_f_signed_by
  ON public.pcpndt_form_f (signed_by);   -- FK pcpndt_form_f_signed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pcpndt_records_declared_by
  ON public.pcpndt_records (declared_by);   -- FK pcpndt_records_declared_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pcpndt_records_consent_obtained_by
  ON public.pcpndt_records (consent_obtained_by);   -- FK pcpndt_records_consent_obtained_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_performance_appraisals_user_id
  ON public.performance_appraisals (user_id);   -- FK performance_appraisals_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_performance_appraisals_manager_id
  ON public.performance_appraisals (manager_id);   -- FK performance_appraisals_manager_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_periodontal_charts_created_by
  ON public.periodontal_charts (created_by);   -- FK periodontal_charts_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_encounter_id
  ON public.pharmacy_dispensing (encounter_id);   -- FK pharmacy_dispensing_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_prescription_id
  ON public.pharmacy_dispensing (prescription_id);   -- FK pharmacy_dispensing_prescription_id_fkey -> prescriptions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_dispensed_by
  ON public.pharmacy_dispensing (dispensed_by);   -- FK pharmacy_dispensing_dispensed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_items_ndps_second_pharmacist_id
  ON public.pharmacy_dispensing_items (ndps_second_pharmacist_id);   -- FK pharmacy_dispensing_items_ndps_second_pharmacist_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_items_batch_id
  ON public.pharmacy_dispensing_items (batch_id);   -- FK pharmacy_dispensing_items_batch_id_fkey -> drug_batches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_items_dispensing_id
  ON public.pharmacy_dispensing_items (dispensing_id);   -- FK pharmacy_dispensing_items_dispensing_id_fkey -> pharmacy_dispensing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_items_returned_by
  ON public.pharmacy_dispensing_items (returned_by);   -- FK pharmacy_dispensing_items_returned_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_items_return_confirmed_by
  ON public.pharmacy_dispensing_items (return_confirmed_by);   -- FK pharmacy_dispensing_items_return_confirmed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_items_drug_id
  ON public.pharmacy_dispensing_items (drug_id);   -- FK pharmacy_dispensing_items_drug_id_fkey -> drug_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_dispensing_items_ndps_return_senior_id
  ON public.pharmacy_dispensing_items (ndps_return_senior_id);   -- FK pharmacy_dispensing_items_ndps_return_senior_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_return_audit_credit_note_id
  ON public.pharmacy_return_audit (credit_note_id);   -- FK pharmacy_return_audit_credit_note_id_fkey -> credit_notes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_return_audit_dispensing_item_id
  ON public.pharmacy_return_audit (dispensing_item_id);   -- FK pharmacy_return_audit_dispensing_item_id_fkey -> pharmacy_dispensing_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_return_audit_created_by
  ON public.pharmacy_return_audit (created_by);   -- FK pharmacy_return_audit_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_return_audit_admission_id
  ON public.pharmacy_return_audit (admission_id);   -- FK pharmacy_return_audit_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_stock_alerts_drug_id
  ON public.pharmacy_stock_alerts (drug_id);   -- FK pharmacy_stock_alerts_drug_id_fkey -> drug_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_stock_alerts_acknowledged_by
  ON public.pharmacy_stock_alerts (acknowledged_by);   -- FK pharmacy_stock_alerts_acknowledged_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_stock_alerts_batch_id
  ON public.pharmacy_stock_alerts (batch_id);   -- FK pharmacy_stock_alerts_batch_id_fkey -> drug_batches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_supplier_returns_batch_id
  ON public.pharmacy_supplier_returns (batch_id);   -- FK pharmacy_supplier_returns_batch_id_fkey -> drug_batches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_supplier_returns_drug_id
  ON public.pharmacy_supplier_returns (drug_id);   -- FK pharmacy_supplier_returns_drug_id_fkey -> drug_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_supplier_returns_created_by
  ON public.pharmacy_supplier_returns (created_by);   -- FK pharmacy_supplier_returns_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_waste_disposal_drug_id
  ON public.pharmacy_waste_disposal (drug_id);   -- FK pharmacy_waste_disposal_drug_id_fkey -> drug_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_waste_disposal_disposed_by
  ON public.pharmacy_waste_disposal (disposed_by);   -- FK pharmacy_waste_disposal_disposed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_waste_disposal_batch_id
  ON public.pharmacy_waste_disposal (batch_id);   -- FK pharmacy_waste_disposal_batch_id_fkey -> drug_batches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physio_equipment_bookings_session_id
  ON public.physio_equipment_bookings (session_id);   -- FK physio_equipment_bookings_session_id_fkey -> physio_sessions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physio_equipment_bookings_booked_for
  ON public.physio_equipment_bookings (booked_for);   -- FK physio_equipment_bookings_booked_for_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physio_referrals_admission_id
  ON public.physio_referrals (admission_id);   -- FK physio_referrals_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physio_referrals_accepted_by
  ON public.physio_referrals (accepted_by);   -- FK physio_referrals_accepted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physio_referrals_opd_encounter_id
  ON public.physio_referrals (opd_encounter_id);   -- FK physio_referrals_opd_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physio_referrals_referred_by
  ON public.physio_referrals (referred_by);   -- FK physio_referrals_referred_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physio_sessions_therapist_id
  ON public.physio_sessions (therapist_id);   -- FK physio_sessions_therapist_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_platform_feature_flags_created_by
  ON public.platform_feature_flags (created_by);   -- FK platform_feature_flags_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_platform_incident_updates_created_by
  ON public.platform_incident_updates (created_by);   -- FK platform_incident_updates_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_platform_incidents_created_by
  ON public.platform_incidents (created_by);   -- FK platform_incidents_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_platform_support_tickets_created_by
  ON public.platform_support_tickets (created_by);   -- FK platform_support_tickets_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_platform_support_tickets_assigned_to
  ON public.platform_support_tickets (assigned_to);   -- FK platform_support_tickets_assigned_to_fkey -> aumrti_admins
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pm_schedules_done_by
  ON public.pm_schedules (done_by);   -- FK pm_schedules_done_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmjay_claims_admission_id
  ON public.pmjay_claims (admission_id);   -- FK pmjay_claims_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmjay_claims_pre_auth_id
  ON public.pmjay_claims (pre_auth_id);   -- FK pmjay_claims_pre_auth_id_fkey -> pre_auth_requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmjay_claims_scheme_id
  ON public.pmjay_claims (scheme_id);   -- FK pmjay_claims_scheme_id_fkey -> govt_schemes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmjay_claims_bill_id
  ON public.pmjay_claims (bill_id);   -- FK pmjay_claims_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmjay_packages_scheme_id
  ON public.pmjay_packages (scheme_id);   -- FK pmjay_packages_scheme_id_fkey -> govt_schemes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pmjay_preauth_requests_requested_by
  ON public.pmjay_preauth_requests (requested_by);   -- FK pmjay_preauth_requests_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_po_items_po_id
  ON public.po_items (po_id);   -- FK po_items_po_id_fkey -> purchase_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_po_items_item_id
  ON public.po_items (item_id);   -- FK po_items_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prakriti_assessments_assessed_by
  ON public.prakriti_assessments (assessed_by);   -- FK prakriti_assessments_assessed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pre_auth_requests_scheme_id
  ON public.pre_auth_requests (scheme_id);   -- FK pre_auth_requests_scheme_id_fkey -> govt_schemes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pre_auth_requests_package_id
  ON public.pre_auth_requests (package_id);   -- FK pre_auth_requests_package_id_fkey -> pmjay_packages
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pre_auth_requests_beneficiary_id
  ON public.pre_auth_requests (beneficiary_id);   -- FK pre_auth_requests_beneficiary_id_fkey -> scheme_beneficiaries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pre_auth_requests_admission_id
  ON public.pre_auth_requests (admission_id);   -- FK pre_auth_requests_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prescriptions_doctor_id
  ON public.prescriptions (doctor_id);   -- FK prescriptions_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_preventive_screenings_screened_by
  ON public.preventive_screenings (screened_by);   -- FK preventive_screenings_screened_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_recommendations_item_id
  ON public.procurement_recommendations (item_id);   -- FK procurement_recommendations_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_analytics_events_user_id
  ON public.product_analytics_events (user_id);   -- FK product_analytics_events_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prompt_registry_approved_by
  ON public.prompt_registry (approved_by);   -- FK prompt_registry_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_psychometric_assessments_encounter_id
  ON public.psychometric_assessments (encounter_id);   -- FK psychometric_assessments_encounter_id_fkey -> mental_health_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_paid_by
  ON public.purchase_orders (paid_by);   -- FK purchase_orders_paid_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_vendor_id
  ON public.purchase_orders (vendor_id);   -- FK purchase_orders_vendor_id_fkey -> vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_created_by
  ON public.purchase_orders (created_by);   -- FK purchase_orders_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_approved_by
  ON public.purchase_orders (approved_by);   -- FK purchase_orders_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_cost_centre_id
  ON public.purchase_orders (cost_centre_id);   -- FK purchase_orders_cost_centre_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_requisitions_requested_by
  ON public.purchase_requisitions (requested_by);   -- FK purchase_requisitions_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_requisitions_department_id
  ON public.purchase_requisitions (department_id);   -- FK purchase_requisitions_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_notifications_user_id
  ON public.push_notifications (user_id);   -- FK push_notifications_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qi_projects_linked_nabh_standard_id
  ON public.qi_projects (linked_nabh_standard_id);   -- FK qi_projects_linked_nabh_standard_id_fkey -> nabh_standards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qi_projects_source_audit_id
  ON public.qi_projects (source_audit_id);   -- FK qi_projects_source_audit_id_fkey -> clinical_audits
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qi_projects_project_owner_id
  ON public.qi_projects (project_owner_id);   -- FK qi_projects_project_owner_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quality_indicator_overrides_indicator_code
  ON public.quality_indicator_overrides (indicator_code);   -- FK quality_indicator_overrides_indicator_code_fkey -> quality_indicator_definitions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quality_indicator_overrides_updated_by
  ON public.quality_indicator_overrides (updated_by);   -- FK quality_indicator_overrides_updated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_state_doctor_id
  ON public.queue_state (doctor_id);   -- FK queue_state_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_state_department_id
  ON public.queue_state (department_id);   -- FK queue_state_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_state_current_token_id
  ON public.queue_state (current_token_id);   -- FK queue_state_current_token_id_fkey -> opd_tokens
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_state_called_by
  ON public.queue_state (called_by);   -- FK queue_state_called_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotation_items_item_id
  ON public.quotation_items (item_id);   -- FK quotation_items_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_orders_ordered_by
  ON public.radiology_orders (ordered_by);   -- FK radiology_orders_ordered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_orders_encounter_id
  ON public.radiology_orders (encounter_id);   -- FK radiology_orders_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_orders_modality_id
  ON public.radiology_orders (modality_id);   -- FK radiology_orders_modality_id_fkey -> radiology_modalities
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_reports_radiologist_id
  ON public.radiology_reports (radiologist_id);   -- FK radiology_reports_radiologist_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_reports_validated_by
  ON public.radiology_reports (validated_by);   -- FK radiology_reports_validated_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radiology_reports_order_id
  ON public.radiology_reports (order_id);   -- FK radiology_reports_order_id_fkey -> radiology_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reconciliation_discrepancies_reconciliation_id
  ON public.reconciliation_discrepancies (reconciliation_id);   -- FK reconciliation_discrepancies_reconciliation_id_fkey -> med_reconciliation_events
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reconciliation_discrepancies_admission_id
  ON public.reconciliation_discrepancies (admission_id);   -- FK reconciliation_discrepancies_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reconciliation_discrepancies_resolved_by
  ON public.reconciliation_discrepancies (resolved_by);   -- FK reconciliation_discrepancies_resolved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_record_access_logs_accessed_by
  ON public.record_access_logs (accessed_by);   -- FK record_access_logs_accessed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_record_requests_approved_by
  ON public.record_requests (approved_by);   -- FK record_requests_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_record_requests_record_id
  ON public.record_requests (record_id);   -- FK record_requests_record_id_fkey -> medical_records
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_codes_partner_id
  ON public.referral_codes (partner_id);   -- FK referral_codes_partner_id_fkey -> referral_partners
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_codes_created_by
  ON public.referral_codes (created_by);   -- FK referral_codes_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_partners_created_by
  ON public.referral_partners (created_by);   -- FK referral_partners_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refund_payables_approved_by
  ON public.refund_payables (approved_by);   -- FK refund_payables_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refund_payables_requested_by
  ON public.refund_payables (requested_by);   -- FK refund_payables_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refund_payables_credit_note_id
  ON public.refund_payables (credit_note_id);   -- FK refund_payables_credit_note_id_fkey -> credit_notes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_requisition_items_item_id
  ON public.requisition_items (item_id);   -- FK requisition_items_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_research_cohorts_created_by
  ON public.research_cohorts (created_by);   -- FK research_cohorts_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_restraint_records_applied_by
  ON public.restraint_records (applied_by);   -- FK restraint_records_applied_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retention_schedules_destruction_authorized_by
  ON public.retention_schedules (destruction_authorized_by);   -- FK retention_schedules_destruction_authorized_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_alerts_resolved_by
  ON public.revenue_alerts (resolved_by);   -- FK revenue_alerts_resolved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_leak_actions_assigned_by
  ON public.revenue_leak_actions (assigned_by);   -- FK revenue_leak_actions_assigned_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_leak_actions_assigned_to
  ON public.revenue_leak_actions (assigned_to);   -- FK revenue_leak_actions_assigned_to_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_leak_actions_resolved_by
  ON public.revenue_leak_actions (resolved_by);   -- FK revenue_leak_actions_resolved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfq_vendors_vendor_id
  ON public.rfq_vendors (vendor_id);   -- FK rfq_vendors_vendor_id_fkey -> vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfqs_requisition_id
  ON public.rfqs (requisition_id);   -- FK rfqs_requisition_id_fkey -> purchase_requisitions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfqs_created_by
  ON public.rfqs (created_by);   -- FK rfqs_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safety_event_capa_responsible_owner_id
  ON public.safety_event_capa (responsible_owner_id);   -- FK safety_event_capa_responsible_owner_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safety_event_rca_completed_by
  ON public.safety_event_rca (completed_by);   -- FK safety_event_rca_completed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safety_events_department_id
  ON public.safety_events (department_id);   -- FK safety_events_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safety_events_reported_by
  ON public.safety_events (reported_by);   -- FK safety_events_reported_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safety_events_admission_id
  ON public.safety_events (admission_id);   -- FK safety_events_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safety_events_linked_nabh_standard_id
  ON public.safety_events (linked_nabh_standard_id);   -- FK safety_events_linked_nabh_standard_id_fkey -> nabh_standards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safety_rounds_conducted_by
  ON public.safety_rounds (conducted_by);   -- FK safety_rounds_conducted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheme_beneficiaries_scheme_id
  ON public.scheme_beneficiaries (scheme_id);   -- FK scheme_beneficiaries_scheme_id_fkey -> govt_schemes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_second_victim_cases_staff_id
  ON public.second_victim_cases (staff_id);   -- FK second_victim_cases_staff_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_second_victim_cases_support_assigned_to
  ON public.second_victim_cases (support_assigned_to);   -- FK second_victim_cases_support_assigned_to_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_second_victim_sessions_case_id
  ON public.second_victim_sessions (case_id);   -- FK second_victim_sessions_case_id_fkey -> second_victim_cases
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sedation_scores_recorded_by
  ON public.sedation_scores (recorded_by);   -- FK sedation_scores_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sedation_scores_admission_id
  ON public.sedation_scores (admission_id);   -- FK sedation_scores_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_charges_bill_id
  ON public.service_charges (bill_id);   -- FK service_charges_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_charges_therapist_id
  ON public.service_charges (therapist_id);   -- FK service_charges_therapist_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_charges_encounter_id
  ON public.service_charges (encounter_id);   -- FK service_charges_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_charges_created_by
  ON public.service_charges (created_by);   -- FK service_charges_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_master_department_id
  ON public.service_master (department_id);   -- FK service_master_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_master_doctor_id
  ON public.service_master (doctor_id);   -- FK service_master_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_rates_payer_id
  ON public.service_rates (payer_id);   -- FK service_rates_payer_id_fkey -> payer_masters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_set_issues_issued_by
  ON public.set_issues (issued_by);   -- FK set_issues_issued_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_set_issues_set_id
  ON public.set_issues (set_id);   -- FK set_issues_set_id_fkey -> instrument_sets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_set_issues_returned_by
  ON public.set_issues (returned_by);   -- FK set_issues_returned_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlement_reconciliation_flags_resolved_by
  ON public.settlement_reconciliation_flags (resolved_by);   -- FK settlement_reconciliation_flags_resolved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shift_swap_requests_reviewed_by
  ON public.shift_swap_requests (reviewed_by);   -- FK shift_swap_requests_reviewed_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shift_swap_requests_requester_id
  ON public.shift_swap_requests (requester_id);   -- FK shift_swap_requests_requester_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shift_swap_requests_counterparty_id
  ON public.shift_swap_requests (counterparty_id);   -- FK shift_swap_requests_counterparty_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_attendance_marked_by
  ON public.staff_attendance (marked_by);   -- FK staff_attendance_marked_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_burnout_scores_user_id
  ON public.staff_burnout_scores (user_id);   -- FK staff_burnout_scores_user_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_credentials_verified_by
  ON public.staff_credentials (verified_by);   -- FK staff_credentials_verified_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_documents_uploaded_by
  ON public.staff_documents (uploaded_by);   -- FK staff_documents_uploaded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_documents_verified_by
  ON public.staff_documents (verified_by);   -- FK staff_documents_verified_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_exits_created_by
  ON public.staff_exits (created_by);   -- FK staff_exits_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_grievances_resolved_by
  ON public.staff_grievances (resolved_by);   -- FK staff_grievances_resolved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_grievances_raised_by
  ON public.staff_grievances (raised_by);   -- FK staff_grievances_raised_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_injuries_employee_id
  ON public.staff_injuries (employee_id);   -- FK staff_injuries_employee_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_privileges_granted_by
  ON public.staff_privileges (granted_by);   -- FK staff_privileges_granted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_privileges_department_id
  ON public.staff_privileges (department_id);   -- FK staff_privileges_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_profiles_department_id
  ON public.staff_profiles (department_id);   -- FK staff_profiles_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_salary_assignments_structure_id
  ON public.staff_salary_assignments (structure_id);   -- FK staff_salary_assignments_structure_id_fkey -> salary_structures
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staffing_alerts_snapshot_id
  ON public.staffing_alerts (snapshot_id);   -- FK staffing_alerts_snapshot_id_fkey -> ward_acuity_snapshots
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sterilization_cycles_flash_approved_by
  ON public.sterilization_cycles (flash_approved_by);   -- FK sterilization_cycles_flash_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sterilization_cycles_bi_read_by
  ON public.sterilization_cycles (bi_read_by);   -- FK sterilization_cycles_bi_read_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sterilization_cycles_operator_id
  ON public.sterilization_cycles (operator_id);   -- FK sterilization_cycles_operator_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stimulation_monitoring_recorded_by
  ON public.stimulation_monitoring (recorded_by);   -- FK stimulation_monitoring_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_count_items_item_id
  ON public.stock_count_items (item_id);   -- FK stock_count_items_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_counts_store_id
  ON public.stock_counts (store_id);   -- FK stock_counts_store_id_fkey -> store_locations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_counts_approved_by
  ON public.stock_counts (approved_by);   -- FK stock_counts_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_counts_counted_by
  ON public.stock_counts (counted_by);   -- FK stock_counts_counted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_reorder_triggers_created_by
  ON public.stock_reorder_triggers (created_by);   -- FK stock_reorder_triggers_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_reorder_triggers_drug_id
  ON public.stock_reorder_triggers (drug_id);   -- FK stock_reorder_triggers_drug_id_fkey -> drug_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_transactions_department_id
  ON public.stock_transactions (department_id);   -- FK stock_transactions_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_transactions_item_id
  ON public.stock_transactions (item_id);   -- FK stock_transactions_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_transactions_created_by
  ON public.stock_transactions (created_by);   -- FK stock_transactions_created_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_store_indents_requested_by
  ON public.store_indents (requested_by);   -- FK store_indents_requested_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_store_indents_approved_by
  ON public.store_indents (approved_by);   -- FK store_indents_approved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_store_indents_received_by
  ON public.store_indents (received_by);   -- FK store_indents_received_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_store_locations_ward_id
  ON public.store_locations (ward_id);   -- FK store_locations_ward_id_fkey -> wards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_store_stock_consignment_vendor_id
  ON public.store_stock (consignment_vendor_id);   -- FK store_stock_consignment_vendor_id_fkey -> vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_store_stock_movements_indent_id
  ON public.store_stock_movements (indent_id);   -- FK store_stock_movements_indent_id_fkey -> store_indents
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_store_stock_movements_moved_by
  ON public.store_stock_movements (moved_by);   -- FK store_stock_movements_moved_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscription_invoices_subscription_id
  ON public.subscription_invoices (subscription_id);   -- FK subscription_invoices_subscription_id_fkey -> hospital_subscriptions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tally_export_log_exported_by
  ON public.tally_export_log (exported_by);   -- FK tally_export_log_exported_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tds_annual_summary_staff_id
  ON public.tds_annual_summary (staff_id);   -- FK tds_annual_summary_staff_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teleconsult_sessions_encounter_id
  ON public.teleconsult_sessions (encounter_id);   -- FK teleconsult_sessions_encounter_id_fkey -> opd_encounters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teleconsult_sessions_doctor_id
  ON public.teleconsult_sessions (doctor_id);   -- FK teleconsult_sessions_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toxicity_events_reported_by
  ON public.toxicity_events (reported_by);   -- FK toxicity_events_reported_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toxicity_events_order_id
  ON public.toxicity_events (order_id);   -- FK toxicity_events_order_id_fkey -> chemo_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpa_dispute_communications_sent_by
  ON public.tpa_dispute_communications (sent_by);   -- FK tpa_dispute_communications_sent_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpa_dispute_communications_dispute_id
  ON public.tpa_dispute_communications (dispute_id);   -- FK tpa_dispute_communications_dispute_id_fkey -> tpa_disputes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpa_disputes_reconciliation_id
  ON public.tpa_disputes (reconciliation_id);   -- FK tpa_disputes_reconciliation_id_fkey -> insurance_payment_reconciliation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpa_disputes_raised_by
  ON public.tpa_disputes (raised_by);   -- FK tpa_disputes_raised_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpa_queries_pre_auth_id
  ON public.tpa_queries (pre_auth_id);   -- FK tpa_queries_pre_auth_id_fkey -> insurance_pre_auth
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpa_queries_admission_id
  ON public.tpa_queries (admission_id);   -- FK tpa_queries_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpa_queries_replied_by
  ON public.tpa_queries (replied_by);   -- FK tpa_queries_replied_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfusion_reactions_issue_id
  ON public.transfusion_reactions (issue_id);   -- FK transfusion_reactions_issue_id_fkey -> blood_issues
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfusion_reactions_unit_id
  ON public.transfusion_reactions (unit_id);   -- FK transfusion_reactions_unit_id_fkey -> blood_units
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfusion_reactions_reported_by
  ON public.transfusion_reactions (reported_by);   -- FK transfusion_reactions_reported_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_tour_progress_tour_key
  ON public.user_tour_progress (tour_key);   -- FK user_tour_progress_tour_key_fkey -> platform_onboarding_tours
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_department_id
  ON public.users (department_id);   -- FK users_department_id_fkey -> departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_branch_id
  ON public.users (branch_id);   -- FK users_branch_id_fkey -> branches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vaccination_due_vaccine_id
  ON public.vaccination_due (vaccine_id);   -- FK vaccination_due_vaccine_id_fkey -> vaccine_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vaccination_records_administered_by
  ON public.vaccination_records (administered_by);   -- FK vaccination_records_administered_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vaccination_records_bill_id
  ON public.vaccination_records (bill_id);   -- FK vaccination_records_bill_id_fkey -> bills
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vaccination_records_vaccine_id
  ON public.vaccination_records (vaccine_id);   -- FK vaccination_records_vaccine_id_fkey -> vaccine_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vaccine_camps_conducted_by
  ON public.vaccine_camps (conducted_by);   -- FK vaccine_camps_conducted_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vaccine_stock_vaccine_id
  ON public.vaccine_stock (vaccine_id);   -- FK vaccine_stock_vaccine_id_fkey -> vaccine_master
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendor_quotations_po_id
  ON public.vendor_quotations (po_id);   -- FK vendor_quotations_po_id_fkey -> purchase_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendor_quotations_vendor_id
  ON public.vendor_quotations (vendor_id);   -- FK vendor_quotations_vendor_id_fkey -> vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendor_rate_contracts_item_id
  ON public.vendor_rate_contracts (item_id);   -- FK vendor_rate_contracts_item_id_fkey -> inventory_items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendor_rate_contracts_vendor_id
  ON public.vendor_rate_contracts (vendor_id);   -- FK vendor_rate_contracts_vendor_id_fkey -> vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ventilator_params_admission_id
  ON public.ventilator_params (admission_id);   -- FK ventilator_params_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ventilator_params_recorded_by
  ON public.ventilator_params (recorded_by);   -- FK ventilator_params_recorded_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vial_wastage_order_id
  ON public.vial_wastage (order_id);   -- FK vial_wastage_order_id_fkey -> chemo_orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visitor_passes_issued_by
  ON public.visitor_passes (issued_by);   -- FK visitor_passes_issued_by_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ward_round_notes_doctor_id
  ON public.ward_round_notes (doctor_id);   -- FK ward_round_notes_doctor_id_fkey -> users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ward_round_notes_admission_id
  ON public.ward_round_notes (admission_id);   -- FK ward_round_notes_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wound_assessments_admission_id
  ON public.wound_assessments (admission_id);   -- FK wound_assessments_admission_id_fkey -> admissions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wound_assessments_assessed_by
  ON public.wound_assessments (assessed_by);   -- FK wound_assessments_assessed_by_fkey -> users

-- ── duplicate indexes (constraint-backed copy is kept) ──
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ai_language_settings_hospital_feature;   -- duplicate of uq_ai_lang_hospital_feature on ai_language_settings
DROP INDEX CONCURRENTLY IF EXISTS public.idx_aumrti_admins_auth_user_id;   -- duplicate of aumrti_admins_auth_user_id_key on aumrti_admins
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bills_hospital_number;   -- duplicate of bills_hospital_bill_number_key on bills
DROP INDEX CONCURRENTLY IF EXISTS public.blood_tti_unit_idx;   -- duplicate of blood_unit_tti_tests_unit_id_key on blood_unit_tti_tests
DROP INDEX CONCURRENTLY IF EXISTS public.idx_discount_codes_code;   -- duplicate of discount_codes_code_key on discount_codes
DROP INDEX CONCURRENTLY IF EXISTS public.idx_doctor_quick_picks_doctor;   -- duplicate of doctor_quick_picks_doctor_id_category_key on doctor_quick_picks
DROP INDEX CONCURRENTLY IF EXISTS public.idx_his_hospital_id;   -- duplicate of hospital_insurance_settings_hospital_id_key on hospital_insurance_settings
DROP INDEX CONCURRENTLY IF EXISTS public.idx_hospital_pricing_overrides_hosp_id;   -- duplicate of hospital_pricing_overrides_hospital_id_key on hospital_pricing_overrides
DROP INDEX CONCURRENTLY IF EXISTS public.idx_hospital_subscriptions_hospital_id;   -- duplicate of hospital_subscriptions_hospital_id_key on hospital_subscriptions
DROP INDEX CONCURRENTLY IF EXISTS public.idx_nabh_compliance_hospital;   -- duplicate of nabh_hospital_compliance_hospital_id_nabh_standard_id_key on nabh_hospital_compliance
DROP INDEX CONCURRENTLY IF EXISTS public.idx_patients_hospital_uhid;   -- duplicate of patients_hospital_id_uhid_key on patients
DROP INDEX CONCURRENTLY IF EXISTS public.idx_payment_links_token;   -- duplicate of payment_links_link_token_key on payment_links
DROP INDEX CONCURRENTLY IF EXISTS public.prom_prem_surveys_response_token_idx;   -- duplicate of prom_prem_surveys_response_token_key on prom_prem_surveys
DROP INDEX CONCURRENTLY IF EXISTS public.idx_safety_event_rca_event;   -- duplicate of safety_event_rca_safety_event_id_key on safety_event_rca
