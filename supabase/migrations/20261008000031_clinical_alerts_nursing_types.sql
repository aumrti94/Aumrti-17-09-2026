-- Phase 6 of nursing module completion plan (bug discovered while smoke-testing the new
-- nurse-facing acknowledgment panel): clinical_alerts.alert_type has a CHECK constraint
-- (added 2026-05-25 by 20260525000001_teleconsult_payment_gate.sql) that only allows 8 values —
-- but nursing's own alert-writing code paths (NursingKardexTab.tsx, IPDVitalsTab.tsx,
-- NursingVitalsTask.tsx, MARAdherenceMonitor.tsx, clinicalPredictions.ts's sepsis check) have
-- always used 4 values that were never in that list, so every one of those inserts has been
-- silently failing since the constraint was added. This widens the allow-list additively
-- (keeps all 8 existing values, adds the 4 nursing needs) — does not touch or fix the ~26 other
-- alert_type values used elsewhere in the codebase (Lab/Radiology/Emergency/Dialysis/CSSD/etc.),
-- which have the same bug but are out of scope for the nursing module completion plan.
ALTER TABLE public.clinical_alerts
  DROP CONSTRAINT IF EXISTS clinical_alerts_alert_type_check;

ALTER TABLE public.clinical_alerts
  ADD CONSTRAINT clinical_alerts_alert_type_check
  CHECK (alert_type IN (
    'drug_interaction', 'allergy_alert', 'critical_value',
    'high_alert_med', 'drug_override', 'antibiotic_stewardship',
    'patient_safety', 'payment_override',
    'high_news2', 'vitals_critical', 'mar_overdue', 'sepsis_risk'
  ));
