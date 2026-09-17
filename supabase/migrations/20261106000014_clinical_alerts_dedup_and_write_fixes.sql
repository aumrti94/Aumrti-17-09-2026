-- Phase 5 (the five hubs) — clinical_alerts hub. Two independent problems found while
-- auditing every insert/upsert site against this table:
--
-- 1. KNOWN-BUG-002: `clinical_alerts` has no DB-level dedup. Several UI panels raise an alert
--    on a repeat-prone trigger (page load, a manual "Refresh" button, a 1-second poll interval,
--    a 4-hourly cron) with no check for an existing row, so the same underlying condition
--    (one overdue lab order, one overdue radiology study, one delayed discharge...) produces a
--    new row every time the trigger re-fires. Confirmed across LabTATPanel.tsx,
--    RadiologyTATPanel.tsx, LabTrendPanel.tsx, DischargeTATTimer.tsx,
--    CriticalIncidentalFinder.tsx, and three sites in supabase/functions/insurance-automation.
--
-- 2. A SEPARATE and more serious defect found in the same audit: several call sites have been
--    writing rows that could never have succeeded, for every hospital, since inception:
--      - `admission_id` used as a column in 6 call sites; the column has never existed on this
--        table (confirmed: no migration in this repo's history ever adds it).
--      - `message` used instead of `alert_message` in 3 more sites (the real column has always
--        been `alert_message`).
--      - `severity: "warning"` / `severity: "info"` used in 4 sites; the CHECK constraint has
--        only ever allowed low/medium/high/critical.
--      - `alert_type` values `pre_auth_expiry_alert`, `irdai_deadline_alert`,
--        `intimation_deadline_alert`, `daycare_no_show`, `daycare_cancelled` used in 5 sites;
--        none was ever added to the whitelist.
--    Every one of these inserts goes through `.insert()` (which returns `{ data, error }` as a
--    VALUE, never throws — see multi-tenant-data-access skill) inside a `.catch(() => {})` or an
--    unchecked `await`, both of which are no-ops against a Postgres error returned as data. The
--    practical effect: insurance-automation's 4-hourly pre-auth-expiry, IRDAI 45-day-deadline,
--    and TPA-intimation-deadline alerts, and every day-care cancellation/no-show/payment-override
--    audit alert, have never actually been written to this table, for any hospital, while the
--    calling code's own success-path logging (`logEvent(..., "success", ...)`) reported them as
--    having worked. This is the same silent-failure shape as KNOWN-BUG-007 (nabh_criteria never
--    seeded) — the code path runs, returns success, and produces nothing.
--
-- This migration fixes the schema half of both problems. The calling code is fixed in the same
-- change (see git log for this commit) to stop passing the wrong column names, use valid
-- severity/alert_type values, and populate the new dedup key.

BEGIN;

-- ── 1. admission_id — a real linkage column, not just a dedup key ──────────────────────────
-- Several of the broken call sites above need this as a genuine FK, not only as something to
-- dedupe on: it is how an admission's own workspace would ever query "alerts about me".
ALTER TABLE public.clinical_alerts
  ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES public.admissions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_clinical_alerts_admission_id
  ON public.clinical_alerts (admission_id)
  WHERE admission_id IS NOT NULL;

-- ── 2. Generic per-event dedup key ───────────────────────────────────────────────────────────
-- clinical_alerts already has type-specific linkage columns (lab_order_id, radiology_order_id,
-- lab_order_item_id, external_referral_id) but not every alert type has one, and some existing
-- columns are shared across many alert_types where the natural dedup key differs (e.g.
-- lab_order_item_id alone isn't unique enough for antibiotic_stewardship, which can raise
-- multiple distinct phenotype alerts against the same item). A single nullable text column,
-- populated only by call sites that need dedup, keeps every other alert_type's behaviour
-- completely unchanged (a plain UNIQUE constraint permits unlimited NULLs — no partial index or
-- WHERE clause needed, and it works directly as a Supabase-JS `.upsert(..., {onConflict})`
-- target, which a partial unique index would not: PostgREST cannot express the WHERE predicate
-- a partial index's ON CONFLICT arbiter requires).
ALTER TABLE public.clinical_alerts
  ADD COLUMN IF NOT EXISTS dedupe_key text;

ALTER TABLE public.clinical_alerts
  DROP CONSTRAINT IF EXISTS clinical_alerts_dedupe_uq;
ALTER TABLE public.clinical_alerts
  ADD CONSTRAINT clinical_alerts_dedupe_uq UNIQUE (hospital_id, alert_type, dedupe_key);

-- ── 3. alert_type whitelist — five real, currently-used values were never added ─────────────
-- Same trap 20261018000001's own comment names: "the CHECK constraint silently rejects any
-- alert_type not listed... dropping and re-creating the whole list" is the only way to add one.
-- List below is 20261018000001's (the prior authority) plus these five.
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
    'ipd_ancillary_payment_override',
    'lab_result_ready', 'radiology_report_ready',
    'pathology_report_ready', 'external_lab_report_ready',
    -- NEW (this migration): insurance-automation's 4-hourly compliance-deadline alerts and
    -- day-care's cancellation/no-show/payment-override audit alerts — all five were already
    -- being inserted by live code, just never accepted by this constraint.
    'pre_auth_expiry_alert', 'irdai_deadline_alert', 'intimation_deadline_alert',
    'daycare_no_show', 'daycare_cancelled'
  ));

COMMIT;
