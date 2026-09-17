-- ai-nabh-indicator-alert/index.ts inserts clinical_alerts with alert_type = 'nabh_qi_anomaly'
-- — never in clinical_alerts_alert_type_check, despite being the real, actively-used
-- vocabulary: NABHQIAlertCard.tsx filters and realtime-subscribes on this exact string, and
-- migration 20261011000070's own comment names it. The insert's error was never checked, so
-- every single NABH quality-indicator anomaly alert this function has ever tried to raise has
-- silently failed — the NABHQIAlertCard dashboard widget has never once received a real
-- alert. Found via Phase 6 edge-function testing.

BEGIN;

ALTER TABLE public.clinical_alerts DROP CONSTRAINT IF EXISTS clinical_alerts_alert_type_check;

ALTER TABLE public.clinical_alerts ADD CONSTRAINT clinical_alerts_alert_type_check
  CHECK (alert_type = ANY (ARRAY[
    'drug_interaction'::text, 'allergy_alert'::text, 'critical_value'::text, 'high_alert_med'::text,
    'drug_override'::text, 'antibiotic_stewardship'::text, 'patient_safety'::text, 'payment_override'::text,
    'high_news2'::text, 'vitals_critical'::text, 'mar_overdue'::text, 'sepsis_risk'::text,
    'critical_lab_value'::text, 'stat_lab_order'::text, 'lab_trend'::text, 'lab_tat_overdue'::text,
    'lab_tat_breach'::text, 'critical_radiology'::text, 'critical_incidental'::text,
    'radiology_report_overdue'::text, 'blood_request'::text, 'specialist_consult'::text, 'code_blue'::text,
    'escalation'::text, 'discharge_initiated'::text, 'discharge_delay'::text,
    'pre_op_blood_group_unknown'::text, 'ratio_breach'::text, 'ndps_countersign_required'::text,
    'ndps_dispense_rejected'::text, 'expiring'::text, 'cold_chain_breach'::text, 'obstetric_risk'::text,
    'neonatal_jaundice'::text, 'credential_expiry'::text, 'infection'::text, 'incident'::text,
    'mental_health_risk'::text, 'high_nutritional_risk'::text, 'equipment_breakdown'::text,
    'calibration_failed'::text, 'missed_dialysis'::text, 'inadequate_dialysis'::text,
    'flash_sterilization'::text, 'sterility_failure'::text, 'instrument_loss'::text,
    'sla_pre_auth_risk'::text, 'sla_pre_auth_breach'::text, 'supplementary_pre_auth_needed'::text,
    'claim_query_received'::text, 'claim_query_overdue'::text, 'appeal_deadline_approaching'::text,
    'payment_received'::text, 'ipd_ancillary_payment_override'::text, 'lab_result_ready'::text,
    'radiology_report_ready'::text, 'pathology_report_ready'::text, 'external_lab_report_ready'::text,
    'pre_auth_expiry_alert'::text, 'irdai_deadline_alert'::text, 'intimation_deadline_alert'::text,
    'daycare_no_show'::text, 'daycare_cancelled'::text,
    'leakage_detected'::text,
    'insurance_preauth_decision'::text, 'insurance_claim_decision'::text,
    'pre_auth_submission_failed'::text,
    'nabh_qi_anomaly'::text
  ]));

COMMIT;
