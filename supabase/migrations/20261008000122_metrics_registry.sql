-- ============================================================
-- Analytics & BI Metrics Registry
-- ============================================================
-- Documents the numerator/denominator/time-period behind every KPI card
-- across the 11 tabs of /analytics (src/pages/analytics/AnalyticsPage.tsx),
-- so "the dashboard shows X" always has a queryable definition instead of
-- living only inside component source. Distinct from platform_metrics_registry
-- (migration 20261008000117), which documents the Platform Pod's control-plane
-- SaaS metrics (MRR/ARR/churn) — a separate system with a separate owner.
-- Same shape/RLS pattern as prompt_registry and platform_metrics_registry:
-- global (no hospital_id — this catalogs what metrics exist, not per-hospital
-- data), versioned, is_active-gated, admin-write / authenticated-read.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.metrics_registry (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key               text        NOT NULL UNIQUE,
  display_name             text        NOT NULL,
  tab_key                  text        NOT NULL,  -- which of the 11 AnalyticsPage tabs this KPI appears on
  numerator_description    text        NOT NULL,
  denominator_description  text,
  period_description       text,
  methodology_notes        text,
  source_tables            jsonb,      -- e.g. ["bills", "pharmacy_dispensing"]
  owner_persona            text,       -- e.g. "Santosh"
  caveats                  text,
  version                  int         NOT NULL DEFAULT 1,
  is_active                boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.metrics_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "metrics_registry_read_all" ON public.metrics_registry;
CREATE POLICY "metrics_registry_read_all" ON public.metrics_registry
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "metrics_registry_admin_write" ON public.metrics_registry;
CREATE POLICY "metrics_registry_admin_write" ON public.metrics_registry
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

CREATE OR REPLACE FUNCTION public.set_analytics_metrics_registry_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_metrics_registry_updated_at ON public.metrics_registry;
CREATE TRIGGER trg_analytics_metrics_registry_updated_at
  BEFORE UPDATE ON public.metrics_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_analytics_metrics_registry_updated_at();

CREATE INDEX IF NOT EXISTS idx_analytics_metrics_registry_key
  ON public.metrics_registry (metric_key)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_analytics_metrics_registry_tab
  ON public.metrics_registry (tab_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: one row per KPI card, as implemented as of this migration (post the
-- Phase 0 bug-fix pass — readmission rate and patient satisfaction below
-- describe the corrected shared-hook logic in src/hooks/useAnalyticsData.ts,
-- not the old per-tab duplicated formulas).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.metrics_registry
  (metric_key, display_name, tab_key, numerator_description, denominator_description, period_description, methodology_notes, source_tables, owner_persona, caveats) VALUES

  -- Revenue tab
  ('analytics.revenue.total_collection', 'Total Collection', 'revenue',
   'SUM(bills.paid_amount) for bill_type != pharmacy, payment_status in (paid, partial), plus SUM(pharmacy_dispensing.net_amount) for dispensing_type=retail, status=dispensed',
   NULL, 'Selected date range (bill_date / dispensing created_at)',
   'Cross-sourced: bills table excludes pharmacy bill_type to avoid double-counting; pharmacy revenue is added separately from pharmacy_dispensing.',
   '["bills", "pharmacy_dispensing"]', 'Santosh', NULL),

  ('analytics.revenue.outstanding', 'Outstanding', 'revenue',
   'SUM(bills.balance_due) where payment_status in (unpaid, partial)', 'Count of matching bills shown as subtitle',
   'Selected date range (bill_date)', 'Straight sum of unpaid/partial balances in range.',
   '["bills"]', 'Santosh', NULL),

  ('analytics.revenue.opd_collections', 'OPD Collections', 'revenue',
   'SUM(bills.paid_amount) where bill_type=opd, payment_status in (paid, partial)', 'Distinct encounter_id count shown as subtitle',
   'Selected date range (bill_date)', 'OPD-only slice of the same bills table used for Total Collection.',
   '["bills"]', 'Santosh', NULL),

  ('analytics.revenue.ipd_collections', 'IPD Collections', 'revenue',
   'SUM(bills.paid_amount) where bill_type=ipd, payment_status in (paid, partial)', 'Distinct admission_id count shown as subtitle',
   'Selected date range (bill_date)', 'IPD-only slice of the same bills table used for Total Collection. Does not break out OT revenue as a separate bucket.',
   '["bills"]', 'Santosh', 'OT revenue is folded into whichever bill_type the OT charge-posting used, not isolated here.'),

  ('analytics.revenue.pharmacy_sales', 'Pharmacy Sales', 'revenue',
   'SUM(pharmacy_dispensing.net_amount) where dispensing_type=retail, status=dispensed', 'Count of matching rows shown as subtitle',
   'Selected date range (dispensing created_at)', 'Pharmacy revenue is sourced from pharmacy_dispensing, not bills, since IPD-consumed drugs post through bills separately.',
   '["pharmacy_dispensing"]', 'Santosh', NULL),

  ('analytics.revenue.insurance_claims_summary', 'Insurance Claims (Submitted/Settled/Pending/Rejected)', 'revenue',
   'Count and amount of insurance_claims grouped by status', NULL, 'Selected date range',
   'Generic insurance_claims table only — PMJAY-specific claims (pmjay_claims table) are not yet included; see Phase 2.',
   '["insurance_claims"]', 'Santosh', 'Does not include PMJAY-specific claim data.'),

  -- Clinical tab
  ('analytics.clinical.opd_visits', 'OPD Visits', 'clinical',
   'COUNT(opd_encounters) in range', NULL, 'Selected date range', 'Daily average shown as subtitle.',
   '["opd_encounters"]', 'Santosh', NULL),

  ('analytics.clinical.ipd_admissions', 'IPD Admissions', 'clinical',
   'COUNT(admissions) admitted in range', NULL, 'Selected date range', NULL,
   '["admissions"]', 'Santosh', NULL),

  ('analytics.clinical.bed_occupancy', 'Bed Occupancy', 'clinical',
   'COUNT(beds where status=occupied)', 'COUNT(beds where is_active=true)', 'Point-in-time (as of page load)',
   'Not date-range filtered — always reflects current occupancy.',
   '["beds"]', 'Santosh', 'Not affected by the date-range picker despite sitting on a range-filtered tab.'),

  ('analytics.clinical.lab_processed', 'Lab Processed', 'clinical',
   'COUNT(lab_order_items) completed in range', NULL, 'Selected date range', NULL,
   '["lab_order_items"]', 'Santosh', NULL),

  ('analytics.clinical.emergency_cases', 'Emergency Cases', 'clinical',
   'COUNT(ed_visits) in range', 'P1 Critical subset shown as subtitle', 'Selected date range', NULL,
   '["ed_visits"]', 'Santosh', NULL),

  ('analytics.clinical.avg_discharge_tat', 'Avg Discharge TAT', 'clinical',
   'AVG(discharged_at - admitted_at) in hours, across discharges in range', 'COUNT(discharges) in range',
   'Selected date range (discharged_at)', 'Same discharge population used for Quality tab TAT and readmission calcs.',
   '["admissions"]', 'Santosh', NULL),

  -- Quality tab
  ('analytics.quality.nabh_compliance_score', 'NABH Compliance Score', 'quality',
   'AVG(nabh_criteria.compliance_score) across all rows', 'COUNT(nabh_criteria) shown as subtitle', 'Point-in-time (not range-filtered)',
   'Target displayed is a fixed 80%, not a configurable benchmark.',
   '["nabh_criteria"]', 'Santosh', NULL),

  ('analytics.quality.patient_safety_incidents', 'Patient Safety', 'quality',
   'COUNT(incident_reports) in range, with sentinel-severity subset and open CAPA count shown as subtitle', NULL,
   'Selected date range (incident_date)', NULL,
   '["incident_reports", "capa_records"]', 'Santosh', NULL),

  ('analytics.quality.infection_control_hai_rate', 'Infection Control (HAI rate)', 'quality',
   'quality_indicators row where indicator_name contains "hai"', NULL, 'Point-in-time (not range-filtered)',
   'Hand Hygiene % shown as subtitle from a separate quality_indicators row matched by name.',
   '["quality_indicators"]', 'Santosh', 'Depends entirely on manual quality_indicators data entry; shows N/A if not configured.'),

  ('analytics.quality.readmission_rate', 'Clinical Quality — 30-Day Readmission Rate', 'quality',
   'COUNT(discharged patients in range whose next admission falls within 30 days of discharge)', 'COUNT(discharges in range)',
   'Selected date range (discharged_at)',
   'Real chronological check via computeReadmissionMetrics() in src/hooks/useAnalyticsData.ts (shared with National Benchmark tab) — for each discharge, looks up that patient''s next admission by admitted_at and tests the 30-day window. Also surfaces AI-predicted high-risk % (admissions.readmission_risk_level/_score, written at discharge by ReadmissionRiskPanel) as a distinct, separately-labeled figure.',
   '["admissions"]', 'Santosh', 'Fixed in this migration''s preceding Phase 0 pass — previously counted any duplicate patient_id in the range with no real 30-day window.'),

  ('analytics.quality.patient_satisfaction', 'Patient Satisfaction', 'quality',
   'AVG(prom_prem_surveys.prem_overall) for status=responded in range', 'COUNT(responded surveys) shown as subtitle',
   'Selected date range (responded_at)',
   'Via computePatientSatisfaction() in src/hooks/useAnalyticsData.ts (shared with National Benchmark tab, PREM row). 1-5 scale.',
   '["prom_prem_surveys"]', 'Santosh', 'Fixed in this migration''s preceding Phase 0 pass — previously hardcoded to N/A; National Benchmark tab previously queried a nonexistent prom_responses table.'),

  -- Doctors tab (per-doctor tile)
  ('analytics.doctors.opd_visits', 'Doctor — OPD Visits', 'doctors',
   'COUNT(opd_encounters) for this doctor in range', NULL, 'Selected date range', NULL,
   '["opd_encounters"]', 'Santosh', NULL),

  ('analytics.doctors.revenue', 'Doctor — Revenue', 'doctors',
   'SUM(bills.paid_amount) attributable to this doctor in range, with a token-based fallback for OPD bills not directly linked to an encounter', NULL,
   'Selected date range', 'See useDoctorScores() in src/hooks/useDoctorDeptData.ts for the attribution chain across opd_encounters/admissions/ot_schedules/bills/opd_tokens.',
   '["bills", "opd_encounters", "admissions", "ot_schedules", "opd_tokens"]', 'Santosh', NULL),

  ('analytics.doctors.ipd_admits', 'Doctor — IPD Admits', 'doctors',
   'COUNT(admissions) with this doctor as admitting_doctor_id in range', NULL, 'Selected date range', NULL,
   '["admissions"]', 'Santosh', NULL),

  ('analytics.doctors.ot_cases', 'Doctor — OT Cases', 'doctors',
   'COUNT(ot_schedules) with this doctor as surgeon in range', NULL, 'Selected date range', NULL,
   '["ot_schedules"]', 'Santosh', NULL),

  ('analytics.doctors.avg_los', 'Doctor — Avg LOS', 'doctors',
   'AVG(discharged_at - admitted_at) in days, across this doctor''s discharged patients in range', NULL, 'Selected date range', NULL,
   '["admissions"]', 'Santosh', NULL),

  -- Departments tab
  ('analytics.departments.revenue_this_period', 'Department Revenue This Period', 'departments',
   'SUM(bills.paid_amount) attributed to the department''s doctors in range', NULL, 'Selected date range',
   NULL, '["bills"]', 'Santosh', NULL),

  ('analytics.departments.pct_of_hospital_revenue', '% of Hospital Revenue', 'departments',
   'Department revenue this period', 'Total hospital revenue this period', 'Selected date range', NULL,
   '["bills"]', 'Santosh', NULL),

  ('analytics.departments.avg_revenue_per_patient', 'Avg Revenue / Patient', 'departments',
   'Department revenue this period', 'Distinct patient count for the department in period', 'Selected date range', NULL,
   '["bills"]', 'Santosh', NULL),

  ('analytics.departments.total_patients', 'Department Total Patients', 'departments',
   'Distinct patient count attributed to the department''s doctors in range', NULL, 'Selected date range', NULL,
   '["opd_encounters", "admissions"]', 'Santosh', NULL),

  -- Forecasts tab
  ('analytics.forecasts.opd_visit_forecast', 'OPD Visit Forecast (7-day)', 'forecasts',
   'Naive moving-average projection over the last 60 days of opd_encounters counts', NULL, 'Trailing 60 days, projecting 7 days forward',
   'Pure statistical projection (no AI call) — labeled "Preview — non-clinical" in the UI.',
   '["opd_encounters"]', 'Santosh', 'Not clinically validated; a projection, not a prediction with confidence guarantees.'),

  ('analytics.forecasts.ipd_occupancy_forecast', 'IPD Occupancy Forecast (7-day)', 'forecasts',
   'Weighted moving-average + day-of-week seasonality + linear trend over cumulative admissions minus discharges, last 60 days', NULL,
   'Trailing 60 days, projecting 7 days forward',
   'Fixed in the preceding Phase 0 pass — previously queried nonexistent admissions.admission_date/discharge_date columns and silently returned "not enough data" regardless of real volume; now correctly uses admitted_at/discharged_at.',
   '["admissions"]', 'Santosh', 'Not clinically validated; a projection, not a prediction with confidence guarantees.'),

  -- National Benchmark tab (NABH/NHM/WHO reference indicators — 18)
  ('analytics.benchmark.alos', 'Average Length of Stay', 'national_benchmark',
   'AVG(discharged_at - admitted_at) in days for discharges in trailing 30 days', NULL, 'Trailing 30 days',
   'Benchmark target 4.2 days sourced from NABH Annual Benchmark 2023 (hardcoded reference constant, not a live external feed).',
   '["admissions"]', 'Santosh', 'Benchmark constants are a static in-source table; go stale unless manually updated when NABH republishes.'),

  ('analytics.benchmark.bor', 'Bed Occupancy Rate', 'national_benchmark',
   'COUNT(beds where status=occupied)', 'COUNT(active beds)', 'Point-in-time', 'Benchmark target 65% (NHM Quality Standards 2023).',
   '["beds"]', 'Santosh', NULL),

  ('analytics.benchmark.dtr', 'Discharge Turn-Around Time', 'national_benchmark',
   'quality_indicators row matched by name containing "discharge" and "time"', NULL, 'Depends on quality_indicators entry period',
   'Benchmark target 4.0 hrs (NABH COP Standard). Shows "No data" if not manually entered in Quality Indicators.',
   '["quality_indicators"]', 'Santosh', 'Manual-entry dependent.'),

  ('analytics.benchmark.ertos', 'Emergency to OT Time — Trauma', 'national_benchmark',
   'Not currently computed — always null', NULL, NULL,
   'Benchmark target 60 mins (NABH COP.3) is defined but no live computation exists yet; always renders "No data".',
   '[]', 'Santosh', 'Known gap: no source query implemented.'),

  ('analytics.benchmark.clabsi', 'CLABSI Rate', 'national_benchmark',
   'COUNT(ipc_infection_events where infection_type=CLABSI)', NULL, 'Trailing 30 days',
   'Benchmark target 1.5/1000 CL-days (NABH HIC Benchmark 2023). Shown as a raw count, not yet normalized per 1000 device-days.',
   '["ipc_infection_events"]', 'Santosh', 'Displayed count is not divided by device-days exposure, so it is not a true rate against the stated unit.'),

  ('analytics.benchmark.cauti', 'CAUTI Rate', 'national_benchmark',
   'COUNT(ipc_infection_events where infection_type=CAUTI)', NULL, 'Trailing 30 days',
   'Benchmark target 2.0/1000 UC-days (NABH HIC Benchmark 2023).', '["ipc_infection_events"]', 'Santosh',
   'Displayed count is not divided by device-days exposure.'),

  ('analytics.benchmark.vap', 'VAP Rate', 'national_benchmark',
   'COUNT(ipc_infection_events where infection_type=VAP)', NULL, 'Trailing 30 days',
   'Benchmark target 2.5/1000 vent-days (NABH HIC Benchmark 2023).', '["ipc_infection_events"]', 'Santosh',
   'Displayed count is not divided by device-days exposure.'),

  ('analytics.benchmark.ssi', 'SSI Rate', 'national_benchmark',
   'Not currently computed — always null', NULL, NULL,
   'Benchmark target 2.0/100 procedures (NABH HIC Benchmark 2023) is defined but no live computation exists yet.',
   '[]', 'Santosh', 'Known gap: no source query implemented.'),

  ('analytics.benchmark.mer', 'Medication Error Rate', 'national_benchmark',
   'quality_indicators row matched by name containing "medication error"/"med error"', NULL, 'Depends on quality_indicators entry period',
   'Benchmark target 0.10% (NABH MOM Standard). Manual-entry dependent.', '["quality_indicators"]', 'Santosh', NULL),

  ('analytics.benchmark.adr', 'Adverse Drug Reaction Reporting Rate', 'national_benchmark',
   'quality_indicators row matched by name containing "adr"', NULL, 'Depends on quality_indicators entry period',
   'Benchmark target 5.0/1000 patients (PvPI National Target). Manual-entry dependent.', '["quality_indicators"]', 'Santosh', NULL),

  ('analytics.benchmark.falls', 'Patient Fall Rate', 'national_benchmark',
   'quality_indicators row matched by name containing "fall"', NULL, 'Depends on quality_indicators entry period',
   'Benchmark target 0.5/1000 patient-days (NABH QPS Standard). Manual-entry dependent.', '["quality_indicators"]', 'Santosh', NULL),

  ('analytics.benchmark.pressure', 'Pressure Injury (new) Rate', 'national_benchmark',
   'quality_indicators row matched by name containing "pressure"/"bedsore"', NULL, 'Depends on quality_indicators entry period',
   'Benchmark target 1.0/1000 patient-days (NABH COP Standard). Manual-entry dependent.', '["quality_indicators"]', 'Santosh', NULL),

  ('analytics.benchmark.readmit30', '30-Day Readmission Rate (Benchmark)', 'national_benchmark',
   'Same computeReadmissionMetrics() as analytics.quality.readmission_rate', NULL, 'Trailing 30 days',
   'Benchmark target 5.0% (NABH QPS Benchmark 2023). Shares the single corrected implementation with the Quality tab as of the preceding Phase 0 pass.',
   '["admissions"]', 'Santosh', NULL),

  ('analytics.benchmark.hh', 'Hand Hygiene Compliance', 'national_benchmark',
   'SUM(hand_hygiene_audits.total_compliant)', 'SUM(hand_hygiene_audits.total_opportunities)', 'Current calendar month',
   'Benchmark target 80% (WHO / NABH HIC.9).', '["hand_hygiene_audits"]', 'Santosh', NULL),

  ('analytics.benchmark.capa_tat', 'CAPA Closure within 30 Days', 'national_benchmark',
   'COUNT(closed capa_records where closed_at <= due_date)', 'COUNT(closed capa_records)', 'Point-in-time (all closed CAPAs)',
   'Benchmark target 80% (NABH QPS Standard).', '["capa_records"]', 'Santosh', NULL),

  ('analytics.benchmark.incident_rr', 'Incident Reporting Rate', 'national_benchmark',
   'COUNT(incident_reports) in trailing 30 days', 'COUNT(active beds) x 100', 'Trailing 30 days',
   'Benchmark target 5.0/100 beds/month (NABH Safety Culture). Not annualized to a true monthly rate — computed directly against a 30-day window.',
   '["incident_reports", "beds"]', 'Santosh', NULL),

  ('analytics.benchmark.prem', 'Patient Satisfaction Score (PREM, Benchmark)', 'national_benchmark',
   'Same computePatientSatisfaction() as analytics.quality.patient_satisfaction, converted from a 1-5 scale to a percentage of max', NULL,
   'Current calendar month',
   'Benchmark target 80% (NABH PRE Standard). Fixed in this migration''s preceding Phase 0 pass — previously queried a nonexistent prom_responses.overall_score and always showed "No data".',
   '["prom_prem_surveys"]', 'Santosh', NULL),

  ('analytics.benchmark.complaint_res', 'Complaint Resolution within 7 Days', 'national_benchmark',
   'quality_indicators row matched by name containing "complaint"', NULL, 'Depends on quality_indicators entry period',
   'Benchmark target 90% (NABH PRE Standard). Manual-entry dependent.', '["quality_indicators"]', 'Santosh', NULL),

  -- PROM Analytics tab
  ('analytics.prom.response_rate', 'PROM/PREM Response Rate', 'prom_analytics',
   'COUNT(prom_prem_surveys where status=responded)', 'COUNT(prom_prem_surveys where status in (sent, responded, expired))', 'Trailing 200 surveys sent',
   NULL, '["prom_prem_surveys"]', 'Santosh', NULL),

  ('analytics.prom.avg_overall_prem', 'Avg Overall PREM', 'prom_analytics',
   'AVG(prom_prem_surveys.prem_overall) for responded surveys', NULL, 'Trailing 200 surveys sent', '1-5 scale.',
   '["prom_prem_surveys"]', 'Santosh', NULL),

  ('analytics.prom.avg_pain_score', 'Avg Pain Score (post-discharge)', 'prom_analytics',
   'AVG(prom_prem_surveys.prom_pain_score) for responded surveys', NULL, 'Trailing 200 surveys sent', '0-10 scale.',
   '["prom_prem_surveys"]', 'Santosh', NULL),

  ('analytics.prom.self_reported_readmission_rate', 'Readmission Rate (Self-Reported)', 'prom_analytics',
   'COUNT(prom_prem_surveys where prom_readmitted=true)', 'COUNT(responded surveys)', 'Trailing 200 surveys sent',
   'Patient self-report, not a chart-verified readmission — deliberately kept distinct from analytics.quality.readmission_rate (the chronological, chart-based figure), scoped only to survey responders, a smaller and potentially biased sample.',
   '["prom_prem_surveys"]', 'Santosh', 'Survey-responder sample only; do not conflate with the authoritative chart-based readmission rate.'),

  -- Population Health tab
  ('analytics.population.disease_burden', 'Top Diagnoses / Admission Trend', 'population_health',
   'COUNT(admissions) grouped by admitting_diagnosis, and by month', NULL, 'Selected lookback period (3/6/12 months)',
   NULL, '["admissions"]', 'Santosh', NULL),

  ('analytics.population.chronic_disease_burden', 'Chronic Disease Burden (registered-patient counts)', 'population_health',
   'COUNT(patients) whose chronic_conditions array contains a matching keyword, per condition (DM, HTN, TB, Asthma, CKD)', NULL,
   'Point-in-time (current patient records)',
   'Fixed in the preceding Phase 0 pass — previously fabricated a "control rate" via Math.random() for DM/HTN/TB and exported it in the NCD Registry CSV. Now reports registered-patient counts only; no control-status field exists in the schema.',
   '["patients"]', 'Santosh', 'No structured control-status (HbA1c/BP reading/DOTS completion) field exists — control rate is intentionally not shown.'),

  ('analytics.population.risk_stratification', 'Comorbidity Distribution / High-Risk Patients', 'population_health',
   'COUNT(patients) bucketed by chronic_conditions array length (0/1/2/3+)', NULL, 'Point-in-time (current patient records)',
   'High-risk list caps at 20 patients with 3+ conditions.', '["patients"]', 'Santosh', NULL),

  -- AI Digest tab
  ('analytics.ai_digest.critical_alerts', 'Critical Alerts', 'ai_digest',
   'COUNT(unacknowledged critical clinical alerts)', NULL, 'Point-in-time (as of digest generation)', NULL,
   '["clinical_alerts"]', 'Santosh', NULL),

  ('analytics.ai_digest.lab_pending', 'Lab Pending', 'ai_digest',
   'COUNT(lab orders not yet resulted)', NULL, 'Point-in-time (as of digest generation)', NULL,
   '["lab_order_items"]', 'Santosh', NULL),

  ('analytics.ai_digest.executive_digest', 'AI Executive Digest', 'ai_digest',
   'LLM-generated narrative summary over the day''s OPD/revenue/occupancy/billing/lab snapshot', NULL, 'Daily',
   'Generated via the ai-executive-digest edge function, persisted to ai_digests, using anomaly thresholds (>3 critical alerts, >95% occupancy, >20 lab pending) rather than statistical anomaly detection.',
   '["ai_digests"]', 'Santosh', 'Static thresholds, not a statistical/trained anomaly model — flagged for @qb / Dr. Nalini review.'),

  -- AI Performance tab
  ('analytics.ai_perf.total_decisions', 'Total AI Decisions', 'ai_performance',
   'COUNT(ai_suggestions_audit) in selected period', NULL, 'Last 7 / 30 / 90 days or this month (selector)', NULL,
   '["ai_suggestions_audit"]', 'Dr. Nalini', NULL),

  ('analytics.ai_perf.acceptance_rate', 'AI Acceptance Rate', 'ai_performance',
   'COUNT(ai_suggestions_audit where outcome=accepted)', 'COUNT(ai_suggestions_audit) in period', 'Last 7 / 30 / 90 days or this month (selector)',
   'Cited against NABH E9 AI-governance standard.', '["ai_suggestions_audit"]', 'Dr. Nalini', NULL),

  ('analytics.ai_perf.override_rate', 'AI Override Rate', 'ai_performance',
   'COUNT(ai_suggestions_audit where outcome=overridden)', 'COUNT(ai_suggestions_audit) in period', 'Last 7 / 30 / 90 days or this month (selector)',
   NULL, '["ai_suggestions_audit"]', 'Dr. Nalini', NULL),

  ('analytics.ai_perf.rejection_rate', 'AI Rejection Rate', 'ai_performance',
   'COUNT(ai_suggestions_audit where outcome=rejected)', 'COUNT(ai_suggestions_audit) in period', 'Last 7 / 30 / 90 days or this month (selector)',
   'Rendered in red if above 30%.', '["ai_suggestions_audit"]', 'Dr. Nalini', NULL),

  ('analytics.ai_perf.avg_confidence', 'Avg AI Confidence', 'ai_performance',
   'AVG(ai_suggestions_audit.confidence) across all features in period', NULL, 'Last 7 / 30 / 90 days or this month (selector)',
   NULL, '["ai_suggestions_audit"]', 'Dr. Nalini', NULL)

ON CONFLICT (metric_key) DO NOTHING;
