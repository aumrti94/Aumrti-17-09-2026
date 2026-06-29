-- Teleconsult payment gate configuration
-- Stored in hospital_settings as key = 'teleconsult_payment'
-- value shape: { "require_prepayment": boolean, "override_roles": string[] }
--
-- Default (when key absent) = postpaid allowed (require_prepayment: false)
-- Roles that can override: default ["admin"] — configurable per hospital
--
-- No schema changes needed: hospital_settings already has (hospital_id, key, value JSONB).
-- This migration adds the clinical_alerts alert_type for payment overrides.

ALTER TABLE public.clinical_alerts
  DROP CONSTRAINT IF EXISTS clinical_alerts_alert_type_check;

-- Re-add constraint with payment_override included
ALTER TABLE public.clinical_alerts
  ADD CONSTRAINT clinical_alerts_alert_type_check
  CHECK (alert_type IN (
    'drug_interaction', 'allergy_alert', 'critical_value',
    'high_alert_med', 'drug_override', 'antibiotic_stewardship',
    'patient_safety', 'payment_override'
  ));
