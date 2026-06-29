-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: insurance_intimation_trigger
-- Purpose  : Hardened TPA auto-intimation for IPD insurance admissions.
--            1. Add insurance_executive to app_role.
--            2. Create insurance_intimations table (per-admission audit trail).
--            3. Replace fn_insurance_auto_intimate — creates intimations row +
--               deadline before firing async HTTP, so failures are detectable.
--            4. pg_cron every 30 min: flag stuck/failed rows, raise CRITICAL
--               clinical_alerts near deadline.
-- Idempotent: Yes — IF NOT EXISTS, CREATE OR REPLACE, DROP IF EXISTS.
-- Depends on: pg_net (async HTTP), pg_cron (scheduler), clinical_alerts table,
--             admissions.insurance_type, admissions.admission_type
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Role ──────────────────────────────────────────────────────────────────
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'insurance_executive';

-- ── 2. insurance_intimations table ──────────────────────────────────────────
-- One row per admission × intimation attempt. Re-attempts create new rows.
-- Pattern: minimal skeleton via CREATE TABLE IF NOT EXISTS, then ADD COLUMN IF
-- NOT EXISTS for every domain column — fully idempotent across re-runs.

CREATE TABLE IF NOT EXISTS public.insurance_intimations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid        NOT NULL REFERENCES public.hospitals(id),
  admission_id uuid       NOT NULL REFERENCES public.admissions(id),
  patient_id  uuid        NOT NULL REFERENCES public.patients(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Payer snapshot columns
ALTER TABLE public.insurance_intimations
  ADD COLUMN IF NOT EXISTS payer_type      text,
  ADD COLUMN IF NOT EXISTS admission_type  text;

-- Workflow state
ALTER TABLE public.insurance_intimations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.insurance_intimations
  DROP CONSTRAINT IF EXISTS insurance_intimations_status_check;
ALTER TABLE public.insurance_intimations
  ADD CONSTRAINT insurance_intimations_status_check
    CHECK (status IN ('pending', 'sent', 'failed', 'acknowledged'));

-- Timing columns
ALTER TABLE public.insurance_intimations
  ADD COLUMN IF NOT EXISTS intimation_deadline    timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at                timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_at        timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_alert_fired   boolean NOT NULL DEFAULT false;

-- TPA acknowledgement
ALTER TABLE public.insurance_intimations
  ADD COLUMN IF NOT EXISTS reference_number_from_tpa text,
  ADD COLUMN IF NOT EXISTS tpa_response_notes        text;

-- Failure tracking
ALTER TABLE public.insurance_intimations
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS retry_count    int NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_intimation_per_admission
  ON public.insurance_intimations (hospital_id, admission_id)
  WHERE status IN ('pending', 'sent', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_intimations_pending_deadline
  ON public.insurance_intimations (hospital_id, intimation_deadline, status)
  WHERE status IN ('pending', 'sent');

ALTER TABLE public.insurance_intimations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intimations_select" ON public.insurance_intimations;
DROP POLICY IF EXISTS "intimations_insert" ON public.insurance_intimations;
DROP POLICY IF EXISTS "intimations_update" ON public.insurance_intimations;

CREATE POLICY "intimations_select" ON public.insurance_intimations
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "intimations_insert" ON public.insurance_intimations
  FOR INSERT TO authenticated WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "intimations_update" ON public.insurance_intimations
  FOR UPDATE TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.set_updated_at_intimations()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_intimations_updated_at ON public.insurance_intimations;
CREATE TRIGGER trg_intimations_updated_at
  BEFORE UPDATE ON public.insurance_intimations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_intimations();

-- ── 3. Trigger function — auto-intimate on admission INSERT ──────────────────
-- Design:
--   a. Skip self-pay admissions (insurance_type = 'self_pay' or null).
--   b. Calculate deadline: emergency → +48 h, all other types → +24 h.
--   c. Insert insurance_intimations row synchronously (status = 'pending').
--      If a sent/acknowledged row already exists for this admission → skip.
--   d. Fire async pg_net.http_post to insurance-automation edge function.
--      pg_net is non-blocking; the edge function updates the row to 'sent' or
--      'failed'.  The pg_cron job at step 4 handles stuck 'pending' rows.

CREATE OR REPLACE FUNCTION public.fn_insurance_auto_intimate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deadline   timestamptz;
  v_intimation record;
BEGIN
  -- Skip non-insurance admissions
  IF NEW.insurance_type IS NULL OR NEW.insurance_type = 'self_pay' THEN
    RETURN NEW;
  END IF;

  -- Deadline: Indian regulations — emergency 48 h, planned/elective 24 h
  IF NEW.admission_type = 'emergency' THEN
    v_deadline := now() + INTERVAL '48 hours';
  ELSE
    v_deadline := now() + INTERVAL '24 hours';
  END IF;

  -- Idempotency: skip if a live intimation row already exists for this admission
  -- (handles AFTER UPDATE triggers that might re-fire on other column changes)
  SELECT id INTO v_intimation
  FROM public.insurance_intimations
  WHERE admission_id = NEW.id
    AND status IN ('pending', 'sent', 'acknowledged')
  LIMIT 1;

  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Create the intimation record synchronously before the async HTTP call.
  -- Edge Function will UPDATE this row to 'sent'; pg_cron catches 'pending' rot.
  INSERT INTO public.insurance_intimations (
    hospital_id,
    admission_id,
    patient_id,
    payer_type,
    admission_type,
    status,
    intimation_deadline
  ) VALUES (
    NEW.hospital_id,
    NEW.id,
    NEW.patient_id,
    NEW.insurance_type,
    NEW.admission_type,
    'pending',
    v_deadline
  );

  -- Async HTTP call — only if pg_net extension is present
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM pg_net.http_post(
      url     := current_setting('app.supabase_functions_url', true) || '/insurance-automation',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body    := jsonb_build_object(
        'action',              'auto_intimate',
        'admission_id',        NEW.id,
        'hospital_id',         NEW.hospital_id,
        'patient_id',          NEW.patient_id,
        'payer_type',          NEW.insurance_type,
        'admission_type',      NEW.admission_type,
        'admitting_doctor_id', NEW.admitting_doctor_id,
        'admission_datetime',  NEW.created_at,
        'insurance_type',      NEW.insurance_type,
        'insurance_id',        NEW.insurance_id,
        'intimation_deadline', v_deadline
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_insurance_auto_intimate ON public.admissions;
CREATE TRIGGER trg_insurance_auto_intimate
  AFTER INSERT ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_insurance_auto_intimate();

-- ── 4. Deadline monitor function (called by pg_cron) ────────────────────────
-- Runs every 30 minutes. Two passes:
--   Pass A — stuck pending: rows still 'pending' after 5 minutes (edge fn never
--             ran or pg_net extension absent) → mark 'failed' + CRITICAL alert.
--   Pass B — deadline proximity: 'sent' rows within 4 hours of deadline with no
--             acknowledgement and alert not yet fired → CRITICAL clinical_alert.

CREATE OR REPLACE FUNCTION public.check_intimation_deadlines()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row record;
BEGIN

  -- ── Pass A: stuck pending rows ──────────────────────────────────────────────
  FOR v_row IN
    SELECT i.*, a.admission_number
    FROM   public.insurance_intimations i
    JOIN   public.admissions            a ON a.id = i.admission_id
    WHERE  i.status = 'pending'
      AND  i.created_at < now() - INTERVAL '5 minutes'
  LOOP
    -- Mark failed
    UPDATE public.insurance_intimations
    SET    status         = 'failed',
           failure_reason = 'Edge function did not respond within 5 minutes — pg_net may be unavailable'
    WHERE  id = v_row.id;

    -- CRITICAL clinical_alert for insurance_executive
    INSERT INTO public.clinical_alerts (
      hospital_id, alert_type, alert_message, severity, patient_id
    ) VALUES (
      v_row.hospital_id,
      'intimation_send_failure',
      'CRITICAL: TPA auto-intimation failed for admission ' ||
        COALESCE(v_row.admission_number, v_row.admission_id::text) ||
        ' (' || v_row.payer_type || '). Deadline: ' ||
        to_char(v_row.intimation_deadline AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI IST') ||
        '. Intimate the TPA manually NOW.',
      'critical',
      v_row.patient_id
    );
  END LOOP;

  -- ── Pass B: approaching deadline without acknowledgement ────────────────────
  FOR v_row IN
    SELECT i.*, a.admission_number
    FROM   public.insurance_intimations i
    JOIN   public.admissions            a ON a.id = i.admission_id
    WHERE  i.status = 'sent'
      AND  i.deadline_alert_fired = false
      AND  i.intimation_deadline BETWEEN now() AND now() + INTERVAL '4 hours'
  LOOP
    -- Fire one CRITICAL alert and mark flag so it doesn't repeat
    INSERT INTO public.clinical_alerts (
      hospital_id, alert_type, alert_message, severity, patient_id
    ) VALUES (
      v_row.hospital_id,
      'intimation_deadline_approaching',
      'CRITICAL: TPA acknowledgement not received for admission ' ||
        COALESCE(v_row.admission_number, v_row.admission_id::text) ||
        ' (' || v_row.payer_type || '). Deadline in < 4 hours: ' ||
        to_char(v_row.intimation_deadline AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI IST') ||
        '. Follow up with TPA immediately.',
      'critical',
      v_row.patient_id
    );

    UPDATE public.insurance_intimations
    SET    deadline_alert_fired = true
    WHERE  id = v_row.id;
  END LOOP;

END;
$$;

-- ── 5. pg_cron — every 30 minutes ────────────────────────────────────────────
-- Replaces the 4-hour slot from the earlier insurance_automation migration.
-- Idempotent: unschedule by name first, then reschedule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove old 4-hour slot if it exists
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'insurance-deadline-check') THEN
      PERFORM cron.unschedule('insurance-deadline-check');
    END IF;

    -- Upsert the 30-minute slot (unschedule first if already exists from a prior run)
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-intimation-deadlines') THEN
      PERFORM cron.unschedule('check-intimation-deadlines');
    END IF;

    PERFORM cron.schedule(
      'check-intimation-deadlines',
      '*/30 * * * *',
      $cron$ SELECT public.check_intimation_deadlines(); $cron$
    );
  END IF;
END;
$$;
