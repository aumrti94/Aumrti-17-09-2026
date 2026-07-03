-- Phase 1 of Lab/Pathology/LIMS completion plan: finish the clinical_alerts.alert_type
-- CHECK-constraint repair that 20261008000031 started for nursing only.
--
-- The constraint (bolted on 2026-05-25 by 20260525000001_teleconsult_payment_gate.sql)
-- silently rejects every alert_type the rest of the app writes — including the lab's
-- critical-value notifications, which is a patient-safety hole. Per user decision
-- (2026-07-03), this migration whitelists EVERY alert_type literal actually used in src/
-- (grep-audited at implementation time), not just the lab's, ending the systemic
-- silent-failure bug in one purely additive change. 'lab_tat_overdue' is new (used by the
-- Phase 8 lab TAT panel); everything else is already written by existing code today.
--
-- NOTE on numbering: remote version 20261008000032 ('clinical_alerts_lab_types', from an
-- earlier session whose migration file was lost from the working tree) already whitelisted
-- the 3 lab types + 'lab_tat_breach' directly on the DB. This migration supersedes it and
-- keeps 'lab_tat_breach' listed so any rows written under it stay valid.

ALTER TABLE public.clinical_alerts
  DROP CONSTRAINT IF EXISTS clinical_alerts_alert_type_check;

ALTER TABLE public.clinical_alerts
  ADD CONSTRAINT clinical_alerts_alert_type_check
  CHECK (alert_type IN (
    -- original 8 (20260525000001)
    'drug_interaction', 'allergy_alert', 'critical_value',
    'high_alert_med', 'drug_override', 'antibiotic_stewardship',
    'patient_safety', 'payment_override',
    -- nursing 4 (20261008000031)
    'high_news2', 'vitals_critical', 'mar_overdue', 'sepsis_risk',
    -- lab (LabResultWorkspace, NewLabOrderModal, LabTrendPanel, LabTATPanel)
    'critical_lab_value', 'stat_lab_order', 'lab_trend', 'lab_tat_overdue',
    'lab_tat_breach', -- legacy value from superseded remote-only 20261008000032
    -- radiology (RadiologyReportingWorkspace, CriticalIncidentalFinder, RadiologyTATPanel)
    'critical_radiology', 'critical_incidental', 'radiology_report_overdue',
    -- emergency (EmergencyWorkspace, EmergencyPage)
    'blood_request', 'specialist_consult', 'code_blue',
    -- IPD (IPDWorkspace, DischargeTATTimer)
    'escalation', 'discharge_initiated', 'discharge_delay',
    -- OT (BookOTModal)
    'pre_op_blood_group_unknown',
    -- staffing (acuityStaffing)
    'ratio_breach',
    -- pharmacy (NDPSDualSignoffModal, ExpiryControlTab)
    'ndps_countersign_required', 'ndps_dispense_rejected', 'expiring',
    -- vaccination (ColdChainTab)
    'cold_chain_breach',
    -- specialty EMR (ObstetricSheet, NeonatalSheet)
    'obstetric_risk', 'neonatal_jaundice',
    -- HR (CredentialingTab)
    'credential_expiry',
    -- quality / IPC (InfectionControlTab, FileIncidentModal)
    'infection', 'incident',
    -- mental health (MHPsychometricTab, MHConsultationTab)
    'mental_health_risk',
    -- dietetics (DietPage)
    'high_nutritional_risk',
    -- biomedical (ReportBreakdownModal, CalibrationTab)
    'equipment_breakdown', 'calibration_failed',
    -- dialysis (DialysisScheduleTab, MachineBoardTab)
    'missed_dialysis', 'inadequate_dialysis',
    -- CSSD (SterilizeTab, IssueReturnTab)
    'flash_sterilization', 'sterility_failure', 'instrument_loss',
    -- insurance (insuranceAlerts.ts dispatchInApp — AlertType lowered)
    'sla_pre_auth_risk', 'sla_pre_auth_breach', 'supplementary_pre_auth_needed',
    'claim_query_received', 'claim_query_overdue', 'appeal_deadline_approaching',
    'payment_received'
  ));
