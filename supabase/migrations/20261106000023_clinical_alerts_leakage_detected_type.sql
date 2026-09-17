-- daily-leakage-scan/index.ts inserts clinical_alerts with alert_type = 'leakage_detected' —
-- a value clinical_alerts_alert_type_check has never allowed, missed even by the KNOWN-BUG-135
-- fix earlier this same phase (which added five other missing alert_type values found by
-- auditing every clinical_alerts write site). The insert's `error` was never checked (only the
-- overall scan's success), so this has silently failed on every single leakage scan since the
-- feature shipped: daily-leakage-scan has always reported `ok:true` and correctly written the
-- leakage_reports row, but the in-app "Leakage Alert" clinical_alerts notification that a
-- hospital's billing/CFO staff actually see in the app has never once been created. Found via
-- Phase 6 edge-function testing.

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
    'leakage_detected'::text
  ]));

COMMIT;
