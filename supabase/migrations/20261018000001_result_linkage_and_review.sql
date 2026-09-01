-- Lab & Radiology results → OPD / IPD, part 1 of 3: schema.
--
-- PROBLEM. A doctor who orders an investigation from a consultation never learns the result.
-- lab_orders and radiology_orders already carry encounter_id and admission_id, but nothing
-- reads them into the doctor's screen, and clinical_alerts is addressed to the hospital, not
-- to a clinician — so "tell the ordering doctor the report is ready" has nothing to hang off.
--
-- This migration adds the three things the feature needs and cannot get from existing columns:
--   1. an addressee + order linkage on clinical_alerts,
--   2. a clinician-review stamp on every reportable unit (NABH COP.6 evidence that the
--      result was actually seen, not merely released),
--   3. admission_id on external_lab_referrals, which only ever had encounter_id and so
--      could never link a referred-out test back to an inpatient.
--
-- No new tables, so no new RLS policies: every column added here lives on a table that
-- already has hospital_id + RLS + an isolation policy.

/* ─────────────── 1. Address an alert to a clinician ─────────────── */

ALTER TABLE public.clinical_alerts
  ADD COLUMN IF NOT EXISTS recipient_user_id    uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS lab_order_id         uuid REFERENCES public.lab_orders(id),
  ADD COLUMN IF NOT EXISTS radiology_order_id   uuid REFERENCES public.radiology_orders(id),
  ADD COLUMN IF NOT EXISTS external_referral_id uuid REFERENCES public.external_lab_referrals(id);

COMMENT ON COLUMN public.clinical_alerts.recipient_user_id IS
  'The clinician this alert is addressed to — for result-ready alerts, the ordering doctor. '
  'NULL means hospital-wide (the pre-existing behaviour of every other alert type). '
  'Purpose: routing only. Retention: follows the clinical_alerts row. '
  'Access: readable by the recipient and by roles already permitted to read clinical_alerts.';

COMMENT ON COLUMN public.clinical_alerts.lab_order_id IS
  'The lab order whose release raised this alert. Also used for pathology_cases alerts, '
  'which reach their encounter through pathology_cases.lab_order_id. Purpose: navigation '
  'and de-duplication (one alert per order). Retention: follows the clinical_alerts row.';

COMMENT ON COLUMN public.clinical_alerts.radiology_order_id IS
  'The radiology order whose report sign-off raised this alert. Purpose: navigation and '
  'de-duplication (one alert per order). Retention: follows the clinical_alerts row.';

COMMENT ON COLUMN public.clinical_alerts.external_referral_id IS
  'The referred-out test whose report arrived. Purpose: navigation and de-duplication. '
  'Retention: follows the clinical_alerts row.';

-- The doctor's "Results Ready" queue and the notification bell both read
-- (recipient_user_id, is_acknowledged); the partial index keeps hospital-wide alerts
-- (recipient_user_id IS NULL — the overwhelming majority) out of it.
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_recipient_open
  ON public.clinical_alerts (recipient_user_id, is_acknowledged)
  WHERE recipient_user_id IS NOT NULL;

-- De-duplication reads: "is there already an open alert for this order?"
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_lab_order
  ON public.clinical_alerts (lab_order_id) WHERE lab_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_radiology_order
  ON public.clinical_alerts (radiology_order_id) WHERE radiology_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_external_referral
  ON public.clinical_alerts (external_referral_id) WHERE external_referral_id IS NOT NULL;

/* ─────────────── 2. alert_type whitelist ───────────────
   The CHECK constraint silently rejects any alert_type not listed, so a new type MUST be
   added by dropping and re-creating the whole list — see 20261008000035 for the history of
   this trap. The list below is 20261008000146's (the current authority) plus four new
   result-ready types. */

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
    -- NEW: a released report waiting for the ordering doctor to read it. Informational,
    -- one per order (never one per test) — see Dr. Ramesh's alert-fatigue rule.
    'lab_result_ready', 'radiology_report_ready',
    'pathology_report_ready', 'external_lab_report_ready'
  ));

/* ─────────────── 3. Clinician review stamp ───────────────
   Applied to every reportable unit. A scalar/profile/microbiology result is reviewed at the
   lab_orders level (that is the unit the doctor reads); imaging at radiology_reports;
   histopathology at pathology_cases, which is signed off independently of its parent order.

   Cleared again when a report is amended, so a corrected result re-enters the queue rather
   than staying invisible to the doctor who already read the superseded version. */

ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS results_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS results_reviewed_by uuid REFERENCES public.users(id);

ALTER TABLE public.radiology_reports
  ADD COLUMN IF NOT EXISTS results_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS results_reviewed_by uuid REFERENCES public.users(id);

ALTER TABLE public.pathology_cases
  ADD COLUMN IF NOT EXISTS results_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS results_reviewed_by uuid REFERENCES public.users(id);

ALTER TABLE public.external_lab_referrals
  ADD COLUMN IF NOT EXISTS results_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS results_reviewed_by uuid REFERENCES public.users(id);

COMMENT ON COLUMN public.lab_orders.results_reviewed_at IS
  'When a clinician confirmed they had read this report (NABH COP.6 evidence that the '
  'result reached the doctor, distinct from validated_at which records lab release). '
  'Reset to NULL if the report is amended. Retention: life of the medical record.';
COMMENT ON COLUMN public.lab_orders.results_reviewed_by IS
  'The clinician who confirmed reading this report. Purpose: medico-legal attribution.';
COMMENT ON COLUMN public.radiology_reports.results_reviewed_at IS
  'When a clinician confirmed they had read this report — see lab_orders.results_reviewed_at.';
COMMENT ON COLUMN public.radiology_reports.results_reviewed_by IS
  'The clinician who confirmed reading this report. Purpose: medico-legal attribution.';
COMMENT ON COLUMN public.pathology_cases.results_reviewed_at IS
  'When a clinician confirmed they had read this case — see lab_orders.results_reviewed_at.';
COMMENT ON COLUMN public.pathology_cases.results_reviewed_by IS
  'The clinician who confirmed reading this case. Purpose: medico-legal attribution.';
COMMENT ON COLUMN public.external_lab_referrals.results_reviewed_at IS
  'When a clinician confirmed they had read the outside lab''s report — see lab_orders.results_reviewed_at.';
COMMENT ON COLUMN public.external_lab_referrals.results_reviewed_by IS
  'The clinician who confirmed reading this report. Purpose: medico-legal attribution.';

-- The doctor's queue reads "released but not yet reviewed, ordered by me".
CREATE INDEX IF NOT EXISTS idx_lab_orders_unreviewed
  ON public.lab_orders (ordered_by, results_reviewed_at)
  WHERE results_reviewed_at IS NULL;

/* ─────────────── 4. Referred-out tests for inpatients ─────────────── */

ALTER TABLE public.external_lab_referrals
  ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES public.admissions(id);

COMMENT ON COLUMN public.external_lab_referrals.admission_id IS
  'The IPD admission this referral was raised under. The table shipped with encounter_id '
  'only, so a test referred out for an inpatient could not be linked back to the admission '
  'and never appeared in the ward doctor''s Reports tab. Purpose: care linkage.';

/* ─────────────── 5. Encounter/admission lookup indexes ───────────────
   lab_orders(encounter_id) and radiology_orders(encounter_id) already exist
   (20261016000012). The admission_id and referral counterparts do not — the Reports panel
   filters on exactly these columns on every mount. Plain, not CONCURRENTLY, so this
   migration stays transactional. */

CREATE INDEX IF NOT EXISTS idx_lab_orders_admission_id
  ON public.lab_orders (admission_id) WHERE admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_radiology_orders_admission_id
  ON public.radiology_orders (admission_id) WHERE admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_lab_referrals_encounter_id
  ON public.external_lab_referrals (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_lab_referrals_admission_id
  ON public.external_lab_referrals (admission_id) WHERE admission_id IS NOT NULL;

/* ─────────────── 6. Realtime precondition ───────────────
   The Reports panel is live: a result released in the lab appears in the doctor's open
   consultation without a refresh. That depends on every result-bearing table being in the
   supabase_realtime publication. 20261009000174 already publishes all of them (with
   REPLICA IDENTITY FULL, which the hospital_id row filters need), so this migration does not
   re-add them — it verifies, and says so loudly if the assumption ever stops holding, rather
   than letting the live badge fail silently. */

DO $$
DECLARE
  missing text[];
BEGIN
  SELECT array_agg(t) INTO missing
  FROM unnest(ARRAY[
    'lab_orders', 'lab_order_items', 'lab_results', 'pathology_cases',
    'external_lab_referrals', 'radiology_orders', 'radiology_reports', 'clinical_alerts'
  ]) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
  );

  IF missing IS NOT NULL THEN
    RAISE WARNING 'Live results will not update for these unpublished tables: %. Re-run 20261009000174.', missing;
  END IF;
END $$;
