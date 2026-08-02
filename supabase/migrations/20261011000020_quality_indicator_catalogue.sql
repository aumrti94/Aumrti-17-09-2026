-- ============================================================================
-- NABH Quality Indicator Engine — 2/7: the catalogue
-- ============================================================================
-- One row per indicator. `collection_mode` decides whether the engine computes
-- it ('auto'/'hybrid') or a human enters it ('manual').
--
-- Indicators with no backing table are registered as 'manual' WITH the reason
-- written into `caveats`, rather than being omitted. An accreditor needs to see
-- that an indicator is required and un-instrumented; silently dropping it is
-- how the current dashboard ends up showing green ticks for things it has never
-- measured.
--
-- `nabh_standard_code` links an indicator to the standard it evidences, and is
-- what run_nabh_auto_collection() scores criteria from. It is NULL where the
-- seeded standard set (nabh_standards, 74 rows, explicitly "representative"
-- with a TODO for full CSV import) has no matching entry — notably diagnostics
-- (lab/radiology) and antibiotic stewardship. Those indicators are still
-- collected; they simply do not score a criterion until the standards are
-- imported in full.
--
-- multiplier: 100 => %, 1000 => per-1000, 1 => raw (hrs/min/days/count/score).
-- ============================================================================

INSERT INTO public.quality_indicator_definitions (
  indicator_code, display_name, nabh_chapter, nabh_standard_code, category, unit,
  direction, multiplier, collection_mode, default_target, default_benchmark,
  numerator_description, denominator_description, source_tables, caveats, sort_order
) VALUES

-- ─── AAC — Access, Assessment and Continuity of Care ────────────────────────
('aac.opd_wait_avg_min','Average OPD Waiting Time','AAC','AAC.1','operational','min',
 'lower_is_better',1,'auto',30,25,
 'Sum of wait minutes for completed OPD tokens','Completed OPD tokens',
 '["opd_tokens"]','Uses opd_tokens.wait_minutes; falls back to consultation_start_at - created_at where null.',10),

('aac.opd_wait_gt30_pct','OPD Waits Exceeding 30 Minutes','AAC','AAC.1','operational','%',
 'lower_is_better',100,'auto',20,15,
 'Completed OPD tokens with wait > 30 min','Completed OPD tokens',
 '["opd_tokens"]',NULL,20),

('aac.ip_alos_days','Average Length of Stay','AAC','AAC.7','clinical','days',
 'lower_is_better',1,'auto',4.2,4.0,
 'Sum of (discharged_at - admitted_at) in days','Discharges in period',
 '["admissions"]',NULL,30),

('aac.bed_occupancy_pct','Bed Occupancy Rate','AAC','AAC.2','operational','%',
 'higher_is_better',100,'auto',75,80,
 'Sum of daily occupied beds','Sum of daily total beds',
 '["daily_census_snapshots","admissions","beds"]',
 'Prefers daily_census_snapshots midnight census; falls back to admission-stay overlap over active beds.',40),

('aac.discharge_tat_hrs','Discharge Turnaround Time','AAC','AAC.7','operational','hrs',
 'lower_is_better',1,'auto',4,3,
 'Sum of (discharged_at - discharge_ordered_at) in hours','Discharges with a recorded discharge order',
 '["admissions"]','Only counts admissions where discharge_ordered_at was captured.',50),

('aac.discharge_summary_pct','Discharge Summary Completion','AAC','AAC.9','clinical','%',
 'higher_is_better',100,'auto',100,98,
 'Discharges with discharge_summary_done','Discharges in period',
 '["admissions"]',NULL,60),

('aac.lama_dama_pct','LAMA / DAMA Rate','AAC','AAC.7','clinical','%',
 'lower_is_better',100,'auto',2,1.5,
 'Discharges of type lama/dama/absconded','Discharges in period',
 '["admissions"]',NULL,70),

('aac.readmit_30d_pct','Readmission Within 30 Days','AAC','AAC.10','clinical','%',
 'lower_is_better',100,'auto',5,4,
 'Discharges followed by a readmission of the same patient within 30 days','Discharges in period',
 '["admissions"]',NULL,80),

('aac.readmit_48h_pct','Unplanned Readmission Within 48 Hours','AAC','AAC.10','clinical','%',
 'lower_is_better',100,'auto',1,0.5,
 'Discharges followed by a readmission of the same patient within 48 hours','Discharges in period',
 '["admissions"]',NULL,90),

('aac.initial_assessment_24h_pct','Initial Assessment Within 24 Hours','AAC','AAC.3','clinical','%',
 'higher_is_better',100,'manual',100,95,
 'Inpatients with a documented initial assessment within 24 hours','Admissions in period',
 '[]','NOT INSTRUMENTED: admissions has no initial_assessment_at / first_assessed_at column. Requires a schema change before it can be automated.',100),

-- ─── COP — Care of Patients ─────────────────────────────────────────────────
('cop.mortality_pct','Gross Inpatient Mortality Rate','COP','COP.1','clinical','%',
 'lower_is_better',100,'auto',2,1.5,
 'Discharges with discharge_type = death','Discharges in period',
 '["admissions"]',NULL,110),

('cop.code_blue_per1000','Code Blue Events per 1000 Discharges','COP','COP.3','clinical','/1000',
 'lower_is_better',1000,'auto',2,1.5,
 'Code blue events in period','Discharges in period',
 '["code_blue_events","admissions"]',NULL,120),

('cop.rosc_pct','Return of Spontaneous Circulation Rate','COP','COP.3','clinical','%',
 'higher_is_better',100,'auto',30,40,
 'Code blue events with rosc_achieved','Code blue events in period',
 '["code_blue_events"]',NULL,130),

('cop.who_checklist_pct','WHO Surgical Safety Checklist Completion','COP','COP.9','patient_safety','%',
 'higher_is_better',100,'auto',100,98,
 'Completed surgeries with sign-in, time-out and sign-out all recorded','Completed surgeries in period',
 '["ot_checklists","ot_schedules"]',NULL,140),

('cop.ot_cancellation_pct','OT Cancellation Rate','COP','COP.9','operational','%',
 'lower_is_better',100,'auto',1,0.8,
 'Surgeries cancelled or postponed','Surgeries scheduled in period',
 '["ot_schedules"]',NULL,150),

('cop.ot_start_delay_min','Average OT Start Delay','COP','COP.9','operational','min',
 'lower_is_better',1,'auto',15,10,
 'Sum of positive (actual_start_time - scheduled start) in minutes','Surgeries that started in period',
 '["ot_schedules"]',
 'scheduled_start_time is a time-of-day column; the scheduled instant is composed with scheduled_date in server timezone. Early starts clamp to zero so they cannot offset delays.',160),

('cop.instrument_count_discrepancy_pct','Instrument / Sponge Count Discrepancy','COP','COP.9','patient_safety','%',
 'lower_is_better',100,'auto',0,0,
 'Counts where opening <> closing or a discrepancy note was recorded','Instrument counts performed in period',
 '["ot_instrument_counts","ot_schedules"]',NULL,170),

('cop.transfusion_reaction_per1000','Transfusion Reaction Rate','COP','COP.4','patient_safety','/1000',
 'lower_is_better',1000,'auto',1,0.5,
 'Transfusion reactions reported','Blood units issued in period',
 '["transfusion_reactions","blood_issues"]',
 'transfusion_reactions previously had no reader anywhere in the application; this is its first consumer.',180),

('cop.blood_return_pct','Blood Units Returned Unused','COP','COP.4','operational','%',
 'lower_is_better',100,'auto',5,3,
 'Blood issues flagged returned','Blood units issued in period',
 '["blood_issues"]',NULL,190),

('cop.pressure_injury_per1000','Hospital-Acquired Pressure Injury Rate','COP','COP.2','clinical','/1000',
 'lower_is_better',1000,'auto',1,0.5,
 'Admissions with a pressure wound first assessed more than 48h after admission','Patient-days in period',
 '["wound_assessments","admissions"]',
 'Hospital-acquired is inferred from a >48h gap after admitted_at, since wound_assessments has no present-on-admission flag.',200),

('cop.braden_24h_pct','Braden Assessment Within 24 Hours','COP','COP.2','clinical','%',
 'higher_is_better',100,'auto',90,95,
 'Admissions with a Braden assessment within 24 hours','Admissions in period',
 '["braden_scale_assessments","admissions"]',NULL,210),

('cop.restraint_per1000','Restraint Episodes per 1000 Patient-Days','COP','COP.5','patient_safety','/1000',
 'lower_is_better',1000,'auto',2,1,
 'Restraint records applied in period','Patient-days in period',
 '["restraint_records"]',NULL,220),

('cop.pain_reassessed_pct','Pain Reassessed Four-Hourly','COP','COP.7','clinical','%',
 'higher_is_better',100,'auto',90,95,
 'Audited patients with four-hourly pain reassessment','Patients audited in period',
 '["pain_audit_records"]','Audit-sample based, not a census of all patients.',230),

('cop.analgesia_30min_pct','Analgesia Administered Within 30 Minutes','COP','COP.7','clinical','%',
 'higher_is_better',100,'auto',90,95,
 'Audited patients given analgesia within 30 minutes','Patients audited in period',
 '["pain_audit_records"]','Audit-sample based.',240),

('cop.ed_los_min','Emergency Department Length of Stay','COP','COP.13','operational','min',
 'lower_is_better',1,'auto',240,180,
 'Sum of (disposition_time - arrival_time) in minutes','ED visits with a disposition in period',
 '["ed_visits"]',NULL,250),

('cop.ertos_trauma_min','Emergency to Operating Theatre Time','COP','COP.13','operational','min',
 'lower_is_better',1,'auto',60,45,
 'Sum of (surgery actual_start_time - ED arrival_time) in minutes','Emergency cases taken to OT within 24h of arrival',
 '["ed_visits","ot_schedules"]',
 'No foreign key links ed_visits to ot_schedules; matched on patient within a 24-hour window.',260),

('cop.lab_tat_avg_hrs','Laboratory Turnaround Time','COP',NULL,'operational','hrs',
 'lower_is_better',1,'auto',4,3,
 'Sum of (validated_at - sample_collected_at) in hours','Validated lab test items in period',
 '["lab_order_items","lab_orders"]',
 'Measured collection-to-validation. Rows where validated_at precedes collection (clock skew or back-dated entry) are excluded. No diagnostics standard exists in the seeded standard set, so this scores no criterion yet.',270),

('cop.lab_tat_breach_pct','Laboratory TAT Breach Rate','COP',NULL,'operational','%',
 'lower_is_better',100,'auto',10,5,
 'Validated lab items exceeding the priority TAT threshold','Validated lab test items in period',
 '["lab_order_items","lab_orders"]','Threshold is 1h for stat/urgent/emergency priority, 4h otherwise.',280),

('cop.lab_critical_ack_pct','Critical Lab Value Acknowledgement','COP',NULL,'patient_safety','%',
 'higher_is_better',100,'auto',100,100,
 'Critical-flagged results acknowledged','Critical-flagged results in period',
 '["lab_order_items"]',NULL,290),

('cop.lab_sample_reject_pct','Laboratory Sample Rejection Rate','COP',NULL,'operational','%',
 'lower_is_better',100,'auto',1,0.5,
 'Samples with a rejection reason','Samples collected in period',
 '["lab_samples"]',NULL,300),

('cop.radiology_tat_hrs','Radiology Reporting Turnaround Time','COP',NULL,'operational','hrs',
 'lower_is_better',1,'auto',24,12,
 'Sum of (report validated_at - order_time) in hours','Validated radiology reports in period',
 '["radiology_reports","radiology_orders"]',NULL,310),

('cop.ed_door_to_doctor_min','Emergency Door-to-Doctor Time','COP','COP.13','operational','min',
 'lower_is_better',1,'manual',15,10,
 'Sum of (first clinician contact - arrival_time) in minutes','ED visits in period',
 '[]','NOT INSTRUMENTED: ed_visits records arrival_time and disposition_time but no first-clinician-contact timestamp.',320),

('cop.icu_mortality_pct','ICU Mortality Rate','COP','COP.10','clinical','%',
 'lower_is_better',100,'manual',10,8,
 'ICU deaths','ICU discharges in period',
 '[]','NOT INSTRUMENTED: no reliable ICU flag on wards to separate ICU from general-ward stays.',330),

-- ─── MOM — Management of Medication ─────────────────────────────────────────
('mom.med_error_per1000','Medication Error Rate per 1000 Doses','MOM','MOM.5','patient_safety','/1000',
 'lower_is_better',1000,'auto',1,0.5,
 'Medication-error safety events reported','Medication doses administered in period',
 '["safety_events","incident_reports","mar_records","nursing_mar"]',
 'Counts one incident store per hospital: safety_events if the hospital has adopted it, otherwise legacy incident_reports. Counting both would double-count the same event.',340),

('mom.mar_compliance_pct','Medication Administration Compliance','MOM','MOM.4','clinical','%',
 'higher_is_better',100,'auto',98,99,
 'Doses recorded as administered','Doses scheduled in period',
 '["nursing_mar"]',NULL,350),

('mom.high_alert_double_check_pct','High-Alert Medication Double Check','MOM','MOM.4','patient_safety','%',
 'higher_is_better',100,'auto',100,100,
 'High-alert administrations with both nurses verified','High-alert double-check records in period',
 '["high_alert_double_checks"]',NULL,360),

('mom.med_recon_admission_pct','Medication Reconciliation at Admission','MOM','MOM.6','clinical','%',
 'higher_is_better',100,'auto',90,95,
 'Admissions with a recorded admission reconciliation event','Admissions in period',
 '["med_reconciliation_events","admissions"]',NULL,370),

('mom.med_recon_unresolved_pct','Unresolved Reconciliation Discrepancies','MOM','MOM.6','clinical','%',
 'lower_is_better',100,'auto',5,2,
 'Unresolved discrepancies','Total discrepancies identified in period',
 '["med_reconciliation_events"]',NULL,380),

('mom.antibiotic_justified_pct','Restricted Antibiotic Justification Rate','MOM',NULL,'infection_control','%',
 'higher_is_better',100,'auto',90,95,
 'Restricted-antibiotic justifications approved','Restricted-antibiotic justifications raised in period',
 '["antibiotic_justifications"]',
 'Antimicrobial stewardship has no standard in the seeded standard set, so this scores no criterion yet.',390),

('mom.adr_per1000','Adverse Drug Reaction Reporting Rate','MOM','MOM.5','patient_safety','/1000',
 'higher_is_better',1000,'manual',5,8,
 'Adverse drug reactions reported','Doses administered in period',
 '[]','NOT INSTRUMENTED: no adverse-drug-reaction table exists in the schema. Under-reporting is the failure mode, so a higher rate is better.',400),

('mom.ndps_balance_ok_pct','NDPS Register Balance Reconciliation','MOM','MOM.3','operational','%',
 'higher_is_better',100,'manual',100,100,
 'NDPS reconciliations with matching balance','NDPS reconciliations performed in period',
 '[]','NOT INSTRUMENTED: ndps_register records transactions but carries no verified reconciliation outcome.',410),

-- ─── PRE — Patient Rights and Education ─────────────────────────────────────
('pre.consent_pct','Informed Consent Before Surgery','PRE','PRE.3','patient_safety','%',
 'higher_is_better',100,'auto',100,100,
 'Completed surgeries with consent recorded at sign-in','Completed surgeries in period',
 '["ot_checklists","ot_schedules"]',NULL,420),

('pre.complaint_resolved_7d_pct','Complaints Resolved Within 7 Days','PRE','PRE.5','operational','%',
 'higher_is_better',100,'auto',90,95,
 'Complaints resolved within 7 days of being raised','Complaints raised in period',
 '["grievances"]',
 'Denominator is complaints RAISED, not resolved, so unresolved complaints correctly depress the rate.',430),

('pre.complaint_tat_hrs','Average Complaint Resolution Time','PRE','PRE.5','operational','hrs',
 'lower_is_better',1,'auto',48,24,
 'Sum of resolution hours','Complaints resolved in period',
 '["grievances"]','Uses stored tat_hours where present, otherwise resolved_at - created_at.',440),

('pre.complaint_sla_breach_pct','Complaint SLA Breach Rate','PRE','PRE.5','operational','%',
 'lower_is_better',100,'auto',10,5,
 'Complaints flagged as SLA breached','Complaints raised in period',
 '["grievances"]',NULL,450),

('pre.prem_satisfaction_pct','Patient Experience Score (PREM)','PRE','PRE.5','operational','%',
 'higher_is_better',100,'auto',80,85,
 'Sum of overall PREM ratings','Responses x maximum score of 5',
 '["prom_prem_surveys"]',NULL,460),

('pre.survey_response_pct','PROM / PREM Survey Response Rate','PRE','PRE.5','operational','%',
 'higher_is_better',100,'auto',40,50,
 'Surveys responded','Surveys sent in period',
 '["prom_prem_surveys"]',NULL,470),

-- The one row where unit is not a percentage but the multiplier is still 100:
-- NPS is (promoters - detractors) / responses x 100, giving a -100..+100 score.
('pre.nps','Net Promoter Score','PRE','PRE.5','operational','score',
 'higher_is_better',100,'auto',50,60,
 'Promoters (score >= 9) minus detractors (score <= 6)','Total NPS responses in period',
 '["nps_responses"]','Legitimately ranges from -100 to +100; a negative value is meaningful, not an error. Scored x100 despite the "score" unit because it is a net percentage.',480),

('pre.csat_pct','Overall Patient Satisfaction (CSAT)','PRE','PRE.5','operational','%',
 'higher_is_better',100,'auto',80,85,
 'Sum of overall CSAT ratings','Feedback records x maximum score of 5',
 '["feedback_records"]',NULL,490),

('pre.rights_display_audit','Patient Rights Display and Awareness Audit','PRE','PRE.1','nabh','%',
 'higher_is_better',100,'manual',100,100,
 'Audit points compliant','Audit points assessed',
 '[]','NOT INSTRUMENTED: narrative/observational standard with no transactional source. Requires a documented internal audit.',500),

-- ─── HIC — Hospital Infection Control ───────────────────────────────────────
('hic.clabsi_per1000','CLABSI Rate per 1000 Central-Line Days','HIC','HIC.9','infection_control','/1000',
 'lower_is_better',1000,'auto',1.5,1,
 'CLABSI events with onset in period','Central-line days in period',
 '["ipc_infection_events","ipc_device_usage"]',
 'Device-days are computed as exposure overlapping the period, so a line spanning month boundaries contributes only its in-period days.',510),

('hic.cauti_per1000','CAUTI Rate per 1000 Catheter Days','HIC','HIC.9','infection_control','/1000',
 'lower_is_better',1000,'auto',2,1.5,
 'CAUTI events with onset in period','Urinary-catheter days in period',
 '["ipc_infection_events","ipc_device_usage"]',NULL,520),

('hic.vap_per1000','VAP Rate per 1000 Ventilator Days','HIC','HIC.9','infection_control','/1000',
 'lower_is_better',1000,'auto',2.5,2,
 'VAP events with onset in period','Ventilator days in period',
 '["ipc_infection_events","ipc_device_usage"]',NULL,530),

('hic.ssi_pct','Surgical Site Infection Rate','HIC','HIC.9','infection_control','%',
 'lower_is_better',100,'auto',2,1.5,
 'SSI events with onset in period','Completed surgeries in period',
 '["ipc_infection_events","ot_schedules"]',
 'Previously proxied from clinical_alerts of type infection, which is not an SSI record; now sourced from ipc_infection_events.',540),

('hic.hai_per1000','Overall Healthcare-Associated Infection Rate','HIC','HIC.9','infection_control','/1000',
 'lower_is_better',1000,'auto',5,3,
 'All HAI events with onset in period','Patient-days in period',
 '["ipc_infection_events"]',NULL,550),

('hic.hand_hygiene_pct','Hand Hygiene Compliance','HIC','HIC.2','infection_control','%',
 'higher_is_better',100,'auto',80,90,
 'Compliant hand-hygiene opportunities observed','Hand-hygiene opportunities observed in period',
 '["hand_hygiene_audits"]',
 'Falls back to summing the WHO five-moments columns when total_compliant/total_opportunities are null.',560),

('hic.bundle_compliance_pct','Care Bundle Compliance','HIC','HIC.9','infection_control','%',
 'higher_is_better',100,'auto',90,95,
 'Bundle checklists scoring 100 percent','Bundle checklists completed in period',
 '["ipc_bundle_checklists"]',NULL,570),

('hic.needle_stick_per1000','Sharps and Needle-Stick Injury Rate','HIC','HIC.4','patient_safety','/1000',
 'lower_is_better',1000,'auto',5,3,
 'Needle-stick and blood-exposure records','Active staff in period',
 '["occupational_health_records","staff_profiles"]',NULL,580),

('hic.pep_initiation_pct','Post-Exposure Prophylaxis Initiation','HIC','HIC.4','infection_control','%',
 'higher_is_better',100,'auto',100,100,
 'Exposure records with PEP given','Needle-stick and blood-exposure records in period',
 '["occupational_health_records"]',NULL,590),

('hic.sterilization_bi_pass_pct','Sterilisation Biological Indicator Pass Rate','HIC','HIC.7','infection_control','%',
 'higher_is_better',100,'auto',100,100,
 'Cycles with a passing biological indicator','Cycles with a biological indicator result in period',
 '["sterilization_cycles"]',NULL,600),

('hic.flash_sterilization_pct','Flash Sterilisation Usage','HIC','HIC.7','infection_control','%',
 'lower_is_better',100,'auto',5,2,
 'Cycles recorded as flash sterilisation','Sterilisation cycles in period',
 '["sterilization_cycles"]',NULL,610),

('hic.bmw_kg_per_patient_day','Biomedical Waste Generated per Patient-Day','HIC','HIC.5','operational','kg',
 'neutral',1,'auto',NULL,NULL,
 'Total biomedical waste in kilograms','Patient-days in period',
 '["bmw_records"]','Informational volume metric: neither a higher nor a lower value is inherently better, so it never scores a criterion.',620),

('hic.bmw_segregation_pct','Biomedical Waste Segregation Compliance','HIC','HIC.5','infection_control','%',
 'higher_is_better',100,'manual',95,98,
 'Segregation audit points compliant','Segregation audit points assessed',
 '[]','NOT INSTRUMENTED: bmw_records captures weights per bag colour but no segregation-audit outcome.',630),

('hic.kitchen_laundry_audit_pct','Kitchen and Laundry Hygiene Audit','HIC','HIC.8','infection_control','%',
 'higher_is_better',100,'manual',90,95,
 'Audit points compliant','Audit points assessed',
 '[]','NOT INSTRUMENTED: no kitchen or laundry hygiene audit table exists.',640),

-- ─── ROM — Responsibilities of Management ───────────────────────────────────
('rom.committee_quorum_pct','Committee Meetings Held With Quorum','ROM','ROM.4','nabh','%',
 'higher_is_better',100,'auto',100,100,
 'Committee meetings with quorum met','Committee meetings held in period',
 '["committee_meetings","hospital_committees"]',
 'committee_meetings has no hospital_id; scoped via hospital_committees.',650),

('rom.committee_action_closure_pct','Committee Action Items Closed On Time','ROM','ROM.4','nabh','%',
 'higher_is_better',100,'auto',80,90,
 'Action items completed','Action items due in period',
 '["committee_action_items","committee_meetings","hospital_committees"]',
 'committee_action_items has neither hospital_id nor a direct committee link; scoped via committee_meetings then hospital_committees.',660),

('rom.statutory_licence_valid_pct','Statutory Licences Current','ROM','ROM.2','nabh','%',
 'higher_is_better',100,'manual',100,100,
 'Statutory licences valid at period end','Statutory licences required',
 '[]','NOT INSTRUMENTED: no statutory licence register table exists.',670),

-- ─── FMS — Facility Management and Safety ───────────────────────────────────
('fms.pm_ontime_pct','Preventive Maintenance Completed On Time','FMS','FMS.4','operational','%',
 'higher_is_better',100,'auto',95,98,
 'Preventive maintenance completed on or before due date','Preventive maintenance due in period',
 '["pm_schedules"]',NULL,680),

('fms.equipment_downtime_hrs','Equipment Downtime per Asset','FMS','FMS.4','operational','hrs',
 'lower_is_better',1,'auto',2,1,
 'Total breakdown downtime hours','Active equipment assets',
 '["breakdown_logs","equipment_master"]',NULL,690),

('fms.calibration_valid_pct','Equipment Calibration Currency','FMS','FMS.4','operational','%',
 'higher_is_better',100,'auto',100,100,
 'Active equipment with calibration valid at period end','Active equipment assets',
 '["calibration_records","equipment_master"]',
 'Denominator is all active equipment; assets that never require calibration will depress this until they are excluded via overrides.',700),

('fms.fire_drill_count','Fire and Mock Drills Conducted','FMS','FMS.1','nabh','count',
 'higher_is_better',1,'auto',1,2,
 'Fire and mock drills conducted in period','Fixed denominator of 1 (this is a count, not a rate)',
 '["fire_safety_drills"]',NULL,710),

('fms.fire_exits_clear_pct','Fire Exits Clear at Drill','FMS','FMS.1','nabh','%',
 'higher_is_better',100,'auto',100,100,
 'Drills where fire exits were clear','Drills conducted in period',
 '["fire_safety_drills"]',NULL,720),

('fms.evacuation_time_min','Average Evacuation Time','FMS','FMS.1','nabh','min',
 'lower_is_better',1,'auto',10,7,
 'Sum of evacuation times in minutes','Drills with a recorded evacuation time',
 '["fire_safety_drills"]',NULL,730),

('fms.amc_expiring_count','Equipment AMC Expiring Within 30 Days','FMS','FMS.4','operational','count',
 'lower_is_better',1,'auto',0,0,
 'Active equipment with AMC expiring within 30 days of period end','Fixed denominator of 1 (this is a count, not a rate)',
 '["equipment_master"]',NULL,740),

('fms.medical_gas_log_pct','Medical Gas System Check Compliance','FMS','FMS.5','nabh','%',
 'higher_is_better',100,'manual',100,100,
 'Scheduled medical gas checks completed','Scheduled medical gas checks due',
 '[]','NOT INSTRUMENTED: medical_gas_logs records readings but has no scheduled-vs-completed model.',750),

('fms.electrical_safety_pct','Electrical Safety Check Compliance','FMS','FMS.5','nabh','%',
 'higher_is_better',100,'manual',100,100,
 'Scheduled electrical safety checks completed','Scheduled electrical safety checks due',
 '[]','NOT INSTRUMENTED: electrical_safety_logs has no scheduled-vs-completed model.',760),

-- ─── HRM — Human Resource Management ────────────────────────────────────────
('hrm.training_hours_per_staff','Training Hours per Employee','HRM','HRM.2','nabh','hrs',
 'higher_is_better',1,'auto',4,6,
 'Total completed training hours in period','Active staff',
 '["staff_training_records","staff_profiles"]',NULL,770),

('hrm.mandatory_training_pct','Mandatory Training Coverage','HRM','HRM.2','nabh','%',
 'higher_is_better',100,'auto',90,95,
 'Staff with mandatory training completed in the last 12 months','Active staff',
 '["staff_training_records","staff_profiles"]',
 'Mandatory topics are matched on title/type keywords (BLS, ACLS, fire, infection, safety, hand hygiene, BMW) because no mandatory flag exists on staff_training_records.',780),

('hrm.credential_valid_pct','Credentials Verified and Current','HRM','HRM.5','nabh','%',
 'higher_is_better',100,'auto',100,100,
 'Credentials verified and unexpired at period end','Credential records on file',
 '["staff_credentials"]',NULL,790),

('hrm.attrition_pct','Staff Attrition Rate','HRM','HRM.1','operational','%',
 'lower_is_better',100,'auto',2,1.5,
 'Staff exits in period','Active staff',
 '["staff_exits","staff_profiles"]',NULL,800),

('hrm.staff_injury_per1000','Staff Injury Rate','HRM','HRM.4','patient_safety','/1000',
 'lower_is_better',1000,'auto',5,3,
 'Staff injuries reported in period','Active staff',
 '["staff_injuries","staff_profiles"]',NULL,810),

('hrm.injury_days_lost','Days Lost per Staff Injury','HRM','HRM.4','operational','days',
 'lower_is_better',1,'auto',2,1,
 'Total days lost to staff injury','Staff injuries reported in period',
 '["staff_injuries"]',NULL,820),

('hrm.nurse_patient_ratio','Nurse to Patient Ratio','HRM','HRM.1','operational','ratio',
 'higher_is_better',1,'manual',0.25,0.33,
 'Nurses on duty','Patients under care',
 '[]','NOT INSTRUMENTED: duty_roster carries no reliable nurse-role flag to separate nursing from other staff on shift.',830),

-- ─── IMS — Information Management System ────────────────────────────────────
('ims.record_completeness_pct','Medical Record Completeness','IMS','IMS.1','clinical','%',
 'higher_is_better',100,'auto',95,98,
 'Discharges with both a discharge summary and an ICD coding record','Discharges in period',
 '["admissions","icd_codings"]','icd_codings links by visit_id, not admission_id.',840),

('ims.coding_accuracy_pct','ICD Coding Accuracy','IMS','IMS.3','nabh','%',
 'higher_is_better',100,'auto',95,98,
 'Coding audits where the corrected code matched the original','Coding audits performed in period',
 '["coding_audits"]',
 'coding_audits.corrected_code is NOT NULL, so accuracy compares corrected_code = original_code rather than testing for null.',850),

('ims.mccd_completion_pct','Death Certificate (MCCD) Completion','IMS','IMS.1','clinical','%',
 'higher_is_better',100,'auto',100,100,
 'MCCD certificates issued in period','Inpatient deaths in period',
 '["mccd_certificates","admissions"]',NULL,860),

('ims.record_retrieval_min','Medical Record Retrieval Time','IMS','IMS.1','nabh','min',
 'lower_is_better',1,'manual',30,20,
 'Sum of retrieval times in minutes','Record retrieval requests in period',
 '[]','NOT INSTRUMENTED: record_requests has no fulfilment timestamp to measure retrieval against.',870),

-- ─── QPS — Quality, Patient Safety and Improvement ──────────────────────────
('qps.fall_per1000','Patient Fall Rate per 1000 Patient-Days','QPS','QPS.3','patient_safety','/1000',
 'lower_is_better',1000,'auto',0.5,0.3,
 'Patient fall events reported','Patient-days in period',
 '["safety_events","incident_reports"]',
 'Counts one incident store per hospital: safety_events if adopted, otherwise legacy incident_reports.',880),

('qps.fall_risk_24h_pct','Fall Risk Assessed Within 24 Hours','QPS','QPS.3','patient_safety','%',
 'higher_is_better',100,'auto',90,95,
 'Admissions with a fall risk assessment within 24 hours','Admissions in period',
 '["fall_risk_assessments","admissions"]',
 'fall_risk_assessments.assessment_date is a date, not a timestamp, so the 24-hour window is evaluated at day granularity.',890),

('qps.high_risk_precautions_pct','Precautions Initiated for High Fall Risk','QPS','QPS.3','patient_safety','%',
 'higher_is_better',100,'auto',100,100,
 'High-risk assessments with fall precautions initiated','High-risk fall assessments in period',
 '["fall_risk_assessments"]',NULL,900),

('qps.incident_report_per100beds','Incident Reporting Rate per 100 Beds','QPS','QPS.3','patient_safety','/100',
 'higher_is_better',100,'auto',5,8,
 'Safety events and incidents reported','Active beds',
 '["safety_events","incident_reports","beds"]',
 'Higher is better: under-reporting, not over-reporting, is the NABH failure mode for this indicator.',910),

('qps.sentinel_count','Sentinel Events','QPS','QPS.4','patient_safety','count',
 'lower_is_better',1,'auto',0,0,
 'Sentinel events or events resulting in death','Fixed denominator of 1 (this is a count, not a rate)',
 '["safety_events"]',NULL,920),

('qps.rca_completion_pct','Root Cause Analysis Completion','QPS','QPS.4','patient_safety','%',
 'higher_is_better',100,'auto',100,100,
 'Sentinel or severe events with a completed RCA','Sentinel or severe events in period',
 '["safety_events","safety_event_rca"]',NULL,930),

('qps.capa_ontime_closure_pct','CAPA Closed On Time','QPS','QPS.5','nabh','%',
 'higher_is_better',100,'auto',80,90,
 'CAPAs completed on or before their due date','CAPAs due in period',
 '["capa_records"]',NULL,940),

('qps.capa_overdue_pct','CAPA Overdue Rate','QPS','QPS.5','nabh','%',
 'lower_is_better',100,'auto',10,5,
 'Open CAPAs past their due date at period end','Open CAPAs with a due date',
 '["capa_records"]',NULL,950)

ON CONFLICT (indicator_code) DO UPDATE SET
  display_name            = EXCLUDED.display_name,
  nabh_chapter            = EXCLUDED.nabh_chapter,
  nabh_standard_code      = EXCLUDED.nabh_standard_code,
  category                = EXCLUDED.category,
  unit                    = EXCLUDED.unit,
  direction               = EXCLUDED.direction,
  multiplier              = EXCLUDED.multiplier,
  collection_mode         = EXCLUDED.collection_mode,
  default_target          = EXCLUDED.default_target,
  default_benchmark       = EXCLUDED.default_benchmark,
  numerator_description   = EXCLUDED.numerator_description,
  denominator_description = EXCLUDED.denominator_description,
  source_tables           = EXCLUDED.source_tables,
  caveats                 = EXCLUDED.caveats,
  sort_order              = EXCLUDED.sort_order,
  updated_at              = now();

-- Sanity check: every non-null standard code must exist in nabh_standards, or
-- the criterion scoring in the next migration will silently score nothing.
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(DISTINCT d.nabh_standard_code, ', ')
    INTO v_missing
  FROM public.quality_indicator_definitions d
  WHERE d.nabh_standard_code IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.nabh_standards s
                     WHERE s.standard_code = d.nabh_standard_code);
  IF v_missing IS NOT NULL THEN
    RAISE WARNING 'Indicator definitions reference standards absent from nabh_standards: %', v_missing;
  END IF;
END $$;
