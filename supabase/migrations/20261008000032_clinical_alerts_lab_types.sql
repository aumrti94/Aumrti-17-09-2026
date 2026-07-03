-- RECONSTRUCTED FILE — this migration was applied to the remote DB (version
-- 20261008000032, name 'clinical_alerts_lab_types') by an earlier session whose
-- working-tree file was subsequently lost. Recreated 2026-07-03 from the live
-- constraint definition (pg_get_constraintdef) so `supabase db push` finds a local
-- counterpart and fresh-DB replays stay coherent. Superseded by
-- 20261008000035_clinical_alerts_all_types.sql, which re-lists these values and
-- whitelists the remaining ~30 blocked alert types across all modules.

ALTER TABLE public.clinical_alerts
  DROP CONSTRAINT IF EXISTS clinical_alerts_alert_type_check;

ALTER TABLE public.clinical_alerts
  ADD CONSTRAINT clinical_alerts_alert_type_check
  CHECK (alert_type IN (
    'drug_interaction', 'allergy_alert', 'critical_value',
    'high_alert_med', 'drug_override', 'antibiotic_stewardship',
    'patient_safety', 'payment_override',
    'high_news2', 'vitals_critical', 'mar_overdue', 'sepsis_risk',
    'critical_lab_value', 'stat_lab_order', 'lab_trend', 'lab_tat_breach'
  ));
