-- ============================================================================
-- NABH Quality Indicator Engine — 7a/7: first-class columns for QI alerts
-- ============================================================================
-- ai-nabh-indicator-alert carried the indicator key in `ward_name` and the
-- metric payload as a JSON string in `bed_number`. Both are patient-location
-- columns; a QI anomaly has no ward and no bed. Any query filtering
-- clinical_alerts by ward would also match these rows.
--
-- The edge function writes both the new and legacy columns for one release so
-- already-deployed readers keep working; NABHQIAlertCard prefers the new ones.
-- ============================================================================

ALTER TABLE public.clinical_alerts
  ADD COLUMN IF NOT EXISTS indicator_code text,
  ADD COLUMN IF NOT EXISTS metric_json    jsonb;

-- One open anomaly per indicator per hospital is the dedupe path the function
-- takes on every alert it considers.
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_indicator
  ON public.clinical_alerts (hospital_id, indicator_code, created_at DESC)
  WHERE indicator_code IS NOT NULL;

COMMENT ON COLUMN public.clinical_alerts.indicator_code IS
  'quality_indicator_definitions.indicator_code for alert_type = nabh_qi_anomaly.';
COMMENT ON COLUMN public.clinical_alerts.metric_json IS
  'Metric payload {label,current,baseline,deviation_pct,unit} for QI anomaly alerts.';
