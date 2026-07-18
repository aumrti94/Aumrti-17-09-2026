-- IPD Ancillary Payment gate — DB-side support for the per-hospital pre/post-paid setting.
--
-- The setting itself needs NO schema: it lives in hospital_settings under the key
-- 'ipd_ancillary_payment', and that table is generic. The policy shape (documented here for
-- whoever reads the DB without the TS) is, in the value JSONB:
--
--   {
--     "pharmacy":  { "mode": "post_paid"|"pre_paid", "receipt": "consolidated"|"separate" },
--     "lab":       { ... same ... },
--     "radiology": { ... same ... },
--     "override": {
--       "allow": true, "roles": ["admin","billing"],
--       "auto_bypass_urgent": true, "urgent_priorities": ["stat","urgent","emergency"]
--     }
--   }
--
-- An ABSENT key means post_paid/consolidated everywhere — i.e. exactly today's behaviour —
-- so there is deliberately no seed row here.
--
-- DELIBERATELY NO ENFORCEMENT TRIGGER. Unlike the day care financial-clearance gate
-- (20261008000140), which fires on an elective scheduled→active transition, this gate's
-- equivalents are time-critical clinical actions (collect a sample, start a scan, hand over a
-- drug). A malformed settings row or an urgent-priority string parsed differently in plpgsql
-- than in TS could make a STAT order unclampable with no client-side escape, and an IPD bypass
-- only costs float (the charge still accrues to the admission bill), so the trade is bad in
-- both directions. Enforcement is client-side (src/lib/ipdAncillaryGate.ts + its block points).
-- This migration adds only the artifacts that are pure upside: an audit alert_type and an index.

-- 1. Audit trail for a payment-gate override. Same pattern the day care / teleconsult gates
--    use: extend the clinical_alerts.alert_type whitelist (last set by 20261008000035) so
--    recordAncillaryOverride can write its row. Full list re-asserted; only the final value is
--    new. Keeping the whole list in one place is the convention these migrations follow.
ALTER TABLE public.clinical_alerts
  DROP CONSTRAINT IF EXISTS clinical_alerts_alert_type_check;

ALTER TABLE public.clinical_alerts
  ADD CONSTRAINT clinical_alerts_alert_type_check
  CHECK (alert_type IN (
    'drug_interaction', 'allergy_alert', 'critical_value',
    'high_alert_med', 'drug_override', 'antibiotic_stewardship',
    'patient_safety', 'payment_override',
    'high_news2', 'vitals_critical', 'mar_overdue', 'sepsis_risk',
    'critical_lab_value', 'stat_lab_order', 'lab_trend', 'lab_tat_overdue', 'lab_tat_breach',
    'critical_radiology', 'critical_incidental', 'radiology_report_overdue',
    'blood_request', 'specialist_consult', 'code_blue',
    'escalation', 'discharge_initiated', 'discharge_delay',
    'pre_op_blood_group_unknown',
    'ratio_breach',
    'ndps_countersign_required', 'ndps_dispense_rejected', 'expiring',
    'cold_chain_breach',
    'obstetric_risk', 'neonatal_jaundice',
    'credential_expiry',
    'infection', 'incident',
    'mental_health_risk',
    'high_nutritional_risk',
    'equipment_breakdown', 'calibration_failed',
    'missed_dialysis', 'inadequate_dialysis',
    'flash_sterilization', 'sterility_failure', 'instrument_loss',
    'sla_pre_auth_risk', 'sla_pre_auth_breach', 'supplementary_pre_auth_needed',
    'claim_query_received', 'claim_query_overdue', 'appeal_deadline_approaching',
    'payment_received',
    -- NEW: audited override of the IPD ancillary payment gate
    'ipd_ancillary_payment_override'
  ));

-- 2. The gate and postCharge's idempotency both look charges up by
--    (hospital_id, source_dedupe_key); today only (payment_status, hospital_id) is indexed.
--
--    PLAIN, not UNIQUE. postCharge's idempotency read uses .maybeSingle(), which ERRORS on
--    more than one row — and duplicate dedupe keys almost certainly exist in production (the
--    live radiology double-charge fixed alongside this feature wrote pairs of them). A UNIQUE
--    index would fail to build against that data. De-duplicating historical rows is a separate,
--    finance-signed-off cleanup.
CREATE INDEX IF NOT EXISTS idx_bli_dedupe_lookup
  ON public.bill_line_items (hospital_id, source_dedupe_key);

-- NOTE: pharmacy_dispensing.status is a plain text column with no CHECK constraint (see
-- 20260322164553), so the new 'awaiting_payment' value needs no migration to be accepted.
