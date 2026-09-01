-- BUG-P4-004 — a drug-safety override must be attributable.
--
-- ROOT CAUSE. DrugSafetyAlertModal tells the prescriber "This override will be logged in the
-- patient record", but RxOrdersTab.handleSafetyOverride inserted into clinical_alerts with
-- only hospital_id, alert_type, severity and alert_message. `patient_id` already existed on
-- the table and was simply never populated, so the override was attached to nobody; and there
-- was no column anywhere to record WHO made the decision.
--
-- Scenario P4-S11 requires the override be recorded "with a reason and the prescriber's
-- identity". The reason lives in alert_message. This migration adds the identity, so an
-- anonymous override becomes impossible to write rather than merely discouraged.
--
-- Locked by TC-P4F-020 / TC-P4F-021.

ALTER TABLE public.clinical_alerts
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id);

COMMENT ON COLUMN public.clinical_alerts.created_by IS
  'The clinician whose action raised this alert — for drug_override, the prescriber who '
  'overrode the contraindication. Required for medico-legal defensibility (P4-S11).';

-- The patient chart reads alerts by patient; the override audit reads them by author.
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_patient
  ON public.clinical_alerts (patient_id)
  WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_alerts_created_by
  ON public.clinical_alerts (created_by)
  WHERE created_by IS NOT NULL;
