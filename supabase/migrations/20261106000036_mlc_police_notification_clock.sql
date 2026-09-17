-- Phase 8B (docs/testing/PHASE_8_STATUS.md §2, KNOWN-BUG-238) — a real, server-enforced 24h
-- "notify police" statutory clock for MLC cases. Modeled directly on the one genuine server-side
-- clock precedent in this codebase, `insurance_intimation_trigger`
-- (20260518000004_insurance_intimation_trigger.sql), simplified: this only needs to *alert*, not
-- dispatch anything externally, so no async HTTP call or Vault secret is needed — a direct
-- pg_cron → plpgsql function is enough.
--
-- WHY. Research for this phase found 10 independent places across the app that capture "this is
-- an MLC" across 6 tables/columns, with zero cross-references between them, and the only trace of
-- the legally-relevant "notify police within 24 hours" rule anywhere in the codebase was one
-- sentence of UI copy in AdmitPatientModal.tsx — never enforced. Consolidating all 10 write paths
-- into one canonical table is a genuine product decision (which path wins, what happens to the
-- other nine) explicitly deferred for clinical-pod to scope. What this migration builds instead:
-- a clock that fires regardless of which of the three "an MLC episode exists" flags
-- (admissions.is_mlc, ed_visits.mlc, mortuary_admissions.is_mlc) triggered it, without requiring
-- that consolidation first.
--
-- DESIGN. `admissions` is self-contained (it has both the is_mlc flag and its own
-- police_informed_at timestamp), so one direct trigger tracks and resolves it. `ed_visits` and
-- `mortuary_admissions` have no informed-at column of their own — that signal lives on a
-- different table entirely (mlc_cases.police_informed_at via ed_visit_id;
-- mlc_records.intimated_at via mortuary_id) — so those two get a "create pending" trigger on the
-- source table plus a "mark informed" companion trigger on whichever table actually records the
-- confirmation. One shared plpgsql function handles each half generically via TG_ARGV, reading
-- columns dynamically through to_jsonb(NEW) so the same function body serves all three source
-- tables and both companion tables without duplicating the insert/update logic three times over.

CREATE TABLE IF NOT EXISTS public.mlc_police_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  source_table text NOT NULL CHECK (source_table IN ('admissions', 'ed_visits', 'mortuary_admissions')),
  source_id uuid NOT NULL,
  patient_id uuid REFERENCES public.patients(id),
  mlc_flagged_at timestamptz NOT NULL DEFAULT now(),
  notification_deadline timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'informed')),
  informed_at timestamptz,
  deadline_alert_fired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

ALTER TABLE public.mlc_police_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_isolation" ON public.mlc_police_notifications;
CREATE POLICY "hospital_isolation" ON public.mlc_police_notifications
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

DROP TRIGGER IF EXISTS log_phi_mlc_police_notifications ON public.mlc_police_notifications;
CREATE TRIGGER log_phi_mlc_police_notifications
  AFTER INSERT OR UPDATE OR DELETE ON public.mlc_police_notifications
  FOR EACH ROW EXECUTE FUNCTION public.log_phi_change();

CREATE INDEX IF NOT EXISTS idx_mlc_police_notifications_pending
  ON public.mlc_police_notifications(hospital_id, status) WHERE status = 'pending';

-- ── Direct: source table itself carries both the flag and (where it exists) the informed-at ───

CREATE OR REPLACE FUNCTION public.fn_mlc_track_notification()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_flag boolean;
  v_informed_at timestamptz;
  v_flag_col text := TG_ARGV[0];
  v_informed_col text := TG_ARGV[1]; -- 'NONE' when this table has no informed-at column of its own
BEGIN
  v_flag := (to_jsonb(NEW) ->> v_flag_col)::boolean;
  IF v_flag IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF v_informed_col <> 'NONE' THEN
    v_informed_at := (to_jsonb(NEW) ->> v_informed_col)::timestamptz;
  END IF;

  INSERT INTO public.mlc_police_notifications (hospital_id, source_table, source_id, patient_id, status, informed_at)
  VALUES (NEW.hospital_id, TG_TABLE_NAME, NEW.id, NEW.patient_id,
          CASE WHEN v_informed_at IS NOT NULL THEN 'informed' ELSE 'pending' END, v_informed_at)
  ON CONFLICT (source_table, source_id) DO UPDATE SET
    status = CASE WHEN EXCLUDED.informed_at IS NOT NULL THEN 'informed' ELSE public.mlc_police_notifications.status END,
    informed_at = COALESCE(public.mlc_police_notifications.informed_at, EXCLUDED.informed_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mlc_track_admissions ON public.admissions;
CREATE TRIGGER trg_mlc_track_admissions
  AFTER INSERT OR UPDATE OF is_mlc, police_informed_at ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_mlc_track_notification('is_mlc', 'police_informed_at');

DROP TRIGGER IF EXISTS trg_mlc_track_ed_visits ON public.ed_visits;
CREATE TRIGGER trg_mlc_track_ed_visits
  AFTER INSERT OR UPDATE OF mlc ON public.ed_visits
  FOR EACH ROW EXECUTE FUNCTION public.fn_mlc_track_notification('mlc', 'NONE');

DROP TRIGGER IF EXISTS trg_mlc_track_mortuary_admissions ON public.mortuary_admissions;
CREATE TRIGGER trg_mlc_track_mortuary_admissions
  AFTER INSERT OR UPDATE OF is_mlc ON public.mortuary_admissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_mlc_track_notification('is_mlc', 'NONE');

-- ── Companion: the confirmation lives on a different table than the flag ───────────────────────

CREATE OR REPLACE FUNCTION public.fn_mlc_mark_informed_from_companion()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_source_table text := TG_ARGV[0];
  v_link_col text := TG_ARGV[1];
  v_informed_col text := TG_ARGV[2];
  v_link_id uuid;
  v_informed_at timestamptz;
BEGIN
  v_link_id := (to_jsonb(NEW) ->> v_link_col)::uuid;
  v_informed_at := (to_jsonb(NEW) ->> v_informed_col)::timestamptz;

  IF v_link_id IS NULL OR v_informed_at IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.mlc_police_notifications
  SET status = 'informed', informed_at = COALESCE(informed_at, v_informed_at)
  WHERE source_table = v_source_table AND source_id = v_link_id AND status = 'pending';

  RETURN NEW;
END;
$$;

-- mlc_cases.police_informed_at, when the case is linked to an ED visit, resolves that ed_visits row.
DROP TRIGGER IF EXISTS trg_mlc_informed_from_mlc_cases_ed ON public.mlc_cases;
CREATE TRIGGER trg_mlc_informed_from_mlc_cases_ed
  AFTER INSERT OR UPDATE OF police_informed_at ON public.mlc_cases
  FOR EACH ROW EXECUTE FUNCTION public.fn_mlc_mark_informed_from_companion('ed_visits', 'ed_visit_id', 'police_informed_at');

-- mlc_records.intimated_at (MortuaryPage.tsx's "Intimate Police" action) resolves the matching
-- mortuary_admissions row.
DROP TRIGGER IF EXISTS trg_mlc_informed_from_mlc_records ON public.mlc_records;
CREATE TRIGGER trg_mlc_informed_from_mlc_records
  AFTER INSERT OR UPDATE OF intimated_at ON public.mlc_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_mlc_mark_informed_from_companion('mortuary_admissions', 'mortuary_id', 'intimated_at');

-- ── The sweep: every 30 minutes, matching the cadence of the insurance-intimation precedent ────

CREATE OR REPLACE FUNCTION public.check_mlc_deadlines()
RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM public.mlc_police_notifications
    WHERE status = 'pending' AND notification_deadline < now() AND NOT deadline_alert_fired
  LOOP
    INSERT INTO public.clinical_alerts (hospital_id, patient_id, alert_type, severity, alert_message, dedupe_key)
    VALUES (
      r.hospital_id, r.patient_id, 'mlc_police_notification_overdue', 'critical',
      format('MLC police notification overdue — flagged %s, 24h deadline passed, police not yet confirmed informed.', r.mlc_flagged_at),
      r.id::text
    )
    ON CONFLICT (hospital_id, alert_type, dedupe_key) DO NOTHING;

    UPDATE public.mlc_police_notifications SET deadline_alert_fired = true WHERE id = r.id;
  END LOOP;
END;
$$;

-- alert_type whitelist — same "drop and recreate" mechanism 20261106000028 used.
ALTER TABLE public.clinical_alerts DROP CONSTRAINT IF EXISTS clinical_alerts_alert_type_check;
ALTER TABLE public.clinical_alerts ADD CONSTRAINT clinical_alerts_alert_type_check
  CHECK (alert_type = ANY (ARRAY[
    'drug_interaction'::text, 'allergy_alert'::text, 'critical_value'::text, 'high_alert_med'::text,
    'drug_override'::text, 'antibiotic_stewardship'::text, 'patient_safety'::text, 'payment_override'::text,
    'high_news2'::text, 'vitals_critical'::text, 'mar_overdue'::text, 'sepsis_risk'::text,
    'critical_lab_value'::text, 'stat_lab_order'::text, 'lab_trend'::text, 'lab_tat_overdue'::text,
    'lab_tat_breach'::text, 'critical_radiology'::text, 'critical_incidental'::text,
    'radiology_report_overdue'::text, 'blood_request'::text, 'specialist_consult'::text, 'code_blue'::text,
    'escalation'::text, 'discharge_initiated'::text, 'discharge_delay'::text,
    'pre_op_blood_group_unknown'::text, 'ratio_breach'::text, 'ndps_countersign_required'::text,
    'ndps_dispense_rejected'::text, 'expiring'::text, 'cold_chain_breach'::text, 'obstetric_risk'::text,
    'neonatal_jaundice'::text, 'credential_expiry'::text, 'infection'::text, 'incident'::text,
    'mental_health_risk'::text, 'high_nutritional_risk'::text, 'equipment_breakdown'::text,
    'calibration_failed'::text, 'missed_dialysis'::text, 'inadequate_dialysis'::text,
    'flash_sterilization'::text, 'sterility_failure'::text, 'instrument_loss'::text,
    'sla_pre_auth_risk'::text, 'sla_pre_auth_breach'::text, 'supplementary_pre_auth_needed'::text,
    'claim_query_received'::text, 'claim_query_overdue'::text, 'appeal_deadline_approaching'::text,
    'payment_received'::text, 'ipd_ancillary_payment_override'::text, 'lab_result_ready'::text,
    'radiology_report_ready'::text, 'pathology_report_ready'::text, 'external_lab_report_ready'::text,
    'pre_auth_expiry_alert'::text, 'irdai_deadline_alert'::text, 'intimation_deadline_alert'::text,
    'daycare_no_show'::text, 'daycare_cancelled'::text,
    'leakage_detected'::text,
    'insurance_preauth_decision'::text, 'insurance_claim_decision'::text,
    'pre_auth_submission_failed'::text,
    'nabh_qi_anomaly'::text,
    'mlc_police_notification_overdue'::text
  ]));

-- Direct SQL cron job — no Edge Function/Vault dispatch needed, unlike the insurance precedent,
-- since this only needs to alert, not send anything externally.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'check-mlc-deadlines';
    PERFORM cron.schedule('check-mlc-deadlines', '*/30 * * * *', 'SELECT public.check_mlc_deadlines();');
  END IF;
END;
$$;
