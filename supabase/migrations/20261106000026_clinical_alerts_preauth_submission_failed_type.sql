-- submit-pre-auth-hcx/index.ts inserts clinical_alerts with alert_type =
-- 'pre_auth_submission_failed' — never in clinical_alerts_alert_type_check, and the insert's
-- own `.catch(() => {})` was ALSO the non-existent-.catch()-on-a-query-builder defect found
-- repeatedly this session, so this failure was doubly silent: the insert always crashed
-- synchronously before ever reaching the constraint, and even after fixing that (same pass),
-- the CHECK itself would have rejected the value anyway. Confirmed via grep that no other
-- code references this string, so there is no existing synonym to rename to. Found via
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
    'leakage_detected'::text,
    'insurance_preauth_decision'::text, 'insurance_claim_decision'::text,
    'pre_auth_submission_failed'::text
  ]));

COMMIT;
