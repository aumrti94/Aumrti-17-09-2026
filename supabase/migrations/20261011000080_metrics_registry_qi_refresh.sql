-- ============================================================================
-- NABH Quality Indicator Engine — 7b/7: make the metrics registry truthful again
-- ============================================================================
-- 20261008000122_metrics_registry.sql honestly documented what was broken at the
-- time: ertos and ssi "not currently computed — always null", the device-associated
-- infection rates not divided by device-days, and six metrics "manual-entry
-- dependent". All of those are now computed by
-- public.run_quality_indicator_collection().
--
-- This runs LAST in the series so the registry never advertises a capability
-- before it is deployed.
-- ============================================================================

UPDATE public.metrics_registry SET
  numerator_description   = 'Sum of (surgery actual_start_time - ED arrival_time) in minutes',
  denominator_description = 'Emergency cases taken to OT within 24h of arrival',
  source_tables           = '["quality_indicators","ed_visits","ot_schedules"]'::jsonb,
  methodology_notes       = 'Read from quality_indicators (indicator_code = cop.ertos_trauma_min).',
  caveats                 = 'Now computed. No foreign key links ed_visits to ot_schedules, so a case is matched on patient within a 24-hour window of ED arrival.',
  version                 = version + 1,
  updated_at              = now()
WHERE metric_key = 'analytics.benchmark.ertos';

UPDATE public.metrics_registry SET
  numerator_description   = 'SSI events with onset in period',
  denominator_description = 'Completed surgeries in period',
  source_tables           = '["quality_indicators","ipc_infection_events","ot_schedules"]'::jsonb,
  methodology_notes       = 'Read from quality_indicators (indicator_code = hic.ssi_pct).',
  caveats                 = 'Now computed from ipc_infection_events where infection_type = SSI. Previously proxied from clinical_alerts of alert_type = infection, which counted every HAI type as a surgical site infection.',
  version                 = version + 1,
  updated_at              = now()
WHERE metric_key = 'analytics.benchmark.ssi';

-- The three device-associated rates: real device-day denominators.
UPDATE public.metrics_registry SET
  denominator_description = CASE metric_key
                              WHEN 'analytics.benchmark.clabsi' THEN 'Central-line days in period'
                              WHEN 'analytics.benchmark.cauti'  THEN 'Urinary-catheter days in period'
                              ELSE 'Ventilator days in period'
                            END,
  source_tables           = '["quality_indicators","ipc_infection_events","ipc_device_usage"]'::jsonb,
  methodology_notes       = 'Read from quality_indicators (hic.clabsi_per1000 / hic.cauti_per1000 / hic.vap_per1000).',
  caveats                 = 'Now a true rate. Device-days come from ipc_device_usage as exposure overlapping the period, so a device spanning month boundaries contributes only its in-period days. A period with no device usage yields NULL, not a raw count.',
  version                 = version + 1,
  updated_at              = now()
WHERE metric_key IN ('analytics.benchmark.clabsi',
                     'analytics.benchmark.cauti',
                     'analytics.benchmark.vap');

-- Previously "manual-entry dependent": now auto-collected from source modules.
UPDATE public.metrics_registry SET
  methodology_notes = 'Read from quality_indicators, auto-collected monthly by public.run_quality_indicator_collection().',
  caveats           = 'Auto-collected from source module data. No longer dependent on manual entry.',
  version           = version + 1,
  updated_at        = now()
WHERE metric_key IN ('analytics.benchmark.dtr',
                     'analytics.benchmark.mer',
                     'analytics.benchmark.falls',
                     'analytics.benchmark.pressure',
                     'analytics.benchmark.complaint_res',
                     'analytics.benchmark.hh',
                     'analytics.benchmark.capa_tat',
                     'analytics.benchmark.incident_rr',
                     'analytics.benchmark.prem',
                     'analytics.benchmark.alos',
                     'analytics.benchmark.bor',
                     'analytics.benchmark.readmit30');

-- ADR is the one benchmark still genuinely un-instrumented; say so plainly
-- rather than leaving a stale "manual-entry dependent" note that reads like an
-- oversight.
UPDATE public.metrics_registry SET
  methodology_notes = 'Manual entry only. Registered in quality_indicator_definitions as mom.adr_per1000 with collection_mode = manual.',
  caveats           = 'NOT INSTRUMENTED: no adverse-drug-reaction table exists in the schema, so this cannot be auto-collected. Under-reporting is the failure mode, so a higher rate is better.',
  version           = version + 1,
  updated_at        = now()
WHERE metric_key = 'analytics.benchmark.adr';

-- Register the engine itself so the provenance of every indicator is queryable.
INSERT INTO public.metrics_registry (
  metric_key, display_name, tab_key,
  numerator_description, denominator_description, period_description,
  methodology_notes, source_tables, owner_persona, caveats
) VALUES (
  'quality.indicator_engine',
  'NABH Quality Indicator Engine',
  'quality',
  'Per-indicator numerator, defined in quality_indicator_definitions',
  'Per-indicator denominator, defined in quality_indicator_definitions',
  'Monthly periods; current month refreshed nightly, prior month sealed on the 2nd',
  'public.run_quality_indicator_collection(hospital_id, period_start, period) computes every '
    || 'auto/hybrid indicator from source modules and upserts into quality_indicators, keyed on '
    || '(hospital_id, indicator_code, period, period_start). Criterion scores are then derived by '
    || 'public.run_nabh_auto_collection(). Read quality_indicators_current for latest values and '
    || 'quality_indicators for trends.',
  '["quality_indicators","quality_indicator_definitions","quality_indicator_overrides","nabh_criteria","nabh_evidence_log"]'::jsonb,
  'Quality Manager',
  'Indicators with no backing table are registered with collection_mode = manual and the reason '
    || 'in quality_indicator_definitions.caveats. NABH criteria with no mapped indicator are left '
    || 'not_assessed rather than being scored from module row counts.'
)
ON CONFLICT (metric_key) DO UPDATE SET
  display_name            = EXCLUDED.display_name,
  numerator_description   = EXCLUDED.numerator_description,
  denominator_description = EXCLUDED.denominator_description,
  period_description      = EXCLUDED.period_description,
  methodology_notes       = EXCLUDED.methodology_notes,
  source_tables           = EXCLUDED.source_tables,
  caveats                 = EXCLUDED.caveats,
  version                 = public.metrics_registry.version + 1,
  updated_at              = now();
