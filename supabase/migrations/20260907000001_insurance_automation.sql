-- Insurance Automation: schema fixes + new automation tables
-- Fixes silent failures caused by missing columns (code used (supabase as any) casts)
-- Adds automation log, config, and DB trigger functions

-- ─────────────────────────────────────────────
-- 1. insurance_pre_auth — add missing columns
-- ─────────────────────────────────────────────
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS intimation_sent_at timestamptz;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS intimation_method text
  CHECK (intimation_method IN ('phone','email','portal','walk-in','auto_system'));
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS is_emergency_admission boolean DEFAULT false;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS is_accident_case boolean DEFAULT false;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS fir_number text;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS is_extension boolean DEFAULT false;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS parent_pre_auth_id uuid REFERENCES insurance_pre_auth(id);
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS extension_reason text;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS automation_mode text DEFAULT 'auto'
  CHECK (automation_mode IN ('auto','manual','disabled'));
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS ai_pre_auth_generated boolean DEFAULT false;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS ai_notes_generated boolean DEFAULT false;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS bundle_generated_at timestamptz;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id);

-- ─────────────────────────────────────────────
-- 2. insurance_claims — add missing columns
-- ─────────────────────────────────────────────
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS resubmission_count integer DEFAULT 0;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS resubmission_deadline timestamptz;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS parent_claim_id uuid REFERENCES insurance_claims(id);
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS policy_number text;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS tpa_reference text;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS appeal_letter text;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS appeal_submitted_at timestamptz;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS automation_submitted boolean DEFAULT false;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS bundle_generated_at timestamptz;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id);

-- ─────────────────────────────────────────────
-- 3. tpa_config — add coverage rule columns
-- ─────────────────────────────────────────────
ALTER TABLE tpa_config ADD COLUMN IF NOT EXISTS room_rent_ceiling numeric(10,2) DEFAULT 0;
ALTER TABLE tpa_config ADD COLUMN IF NOT EXISTS co_payment_type text DEFAULT 'none'
  CHECK (co_payment_type IN ('none','percentage','fixed'));
ALTER TABLE tpa_config ADD COLUMN IF NOT EXISTS co_payment_value numeric(10,2) DEFAULT 0;
ALTER TABLE tpa_config ADD COLUMN IF NOT EXISTS deductible numeric(10,2) DEFAULT 0;
ALTER TABLE tpa_config ADD COLUMN IF NOT EXISTS intimation_email text;
ALTER TABLE tpa_config ADD COLUMN IF NOT EXISTS intimation_phone text;
ALTER TABLE tpa_config ADD COLUMN IF NOT EXISTS portal_url text;
ALTER TABLE tpa_config ADD COLUMN IF NOT EXISTS auto_intimation_enabled boolean DEFAULT true;
ALTER TABLE tpa_config ADD COLUMN IF NOT EXISTS pre_auth_turnaround_hours integer DEFAULT 48;

-- ─────────────────────────────────────────────
-- 4. admissions — add TPA resolution columns
-- ─────────────────────────────────────────────
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS tpa_name text;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS policy_number text;

-- ─────────────────────────────────────────────
-- 5. tpa_queries — add missing columns
--    (table created in p2_gaps.sql, adding new cols)
-- ─────────────────────────────────────────────
ALTER TABLE tpa_queries ADD COLUMN IF NOT EXISTS pre_auth_id uuid REFERENCES insurance_pre_auth(id);
ALTER TABLE tpa_queries ADD COLUMN IF NOT EXISTS ai_suggested_reply text;

-- ─────────────────────────────────────────────
-- 6. insurance_automation_log — new table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_automation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL,
  admission_id uuid REFERENCES admissions(id) ON DELETE CASCADE,
  pre_auth_id uuid REFERENCES insurance_pre_auth(id) ON DELETE SET NULL,
  claim_id uuid REFERENCES insurance_claims(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'intimation_auto_sent',
    'pre_auth_ai_generated',
    'pre_auth_auto_submitted',
    'denial_risk_checked',
    'claim_auto_bundled',
    'claim_auto_submitted',
    'appeal_auto_generated',
    'deadline_alert_sent',
    'tpa_name_auto_matched',
    'manual_override',
    'auto_skipped_high_risk',
    'query_ai_reply_suggested',
    'pre_auth_expiry_alert',
    'irdai_deadline_alert',
    'intimation_deadline_alert'
  )),
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success','failed','skipped','pending_review')),
  payload jsonb DEFAULT '{}',
  ai_used boolean DEFAULT false,
  ai_feature_key text,
  triggered_by text DEFAULT 'system',
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE insurance_automation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON insurance_automation_log;
CREATE POLICY "hospital_isolation" ON insurance_automation_log
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_ins_auto_log_admission ON insurance_automation_log(hospital_id, admission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ins_auto_log_claim ON insurance_automation_log(claim_id);
CREATE INDEX IF NOT EXISTS idx_ins_auto_log_event ON insurance_automation_log(hospital_id, event_type, created_at DESC);

-- ─────────────────────────────────────────────
-- 7. insurance_automation_config — new table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_automation_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE NOT NULL UNIQUE,
  auto_intimate_enabled boolean DEFAULT true,
  auto_preauth_generate_enabled boolean DEFAULT true,
  auto_preauth_submit_enabled boolean DEFAULT false,
  auto_claim_submit_enabled boolean DEFAULT false,
  auto_claim_max_risk_score integer DEFAULT 30,
  auto_appeal_generate_enabled boolean DEFAULT true,
  auto_query_suggest_enabled boolean DEFAULT true,
  intimation_reminder_hours integer DEFAULT 6,
  pre_auth_expiry_alert_days integer DEFAULT 3,
  irdai_deadline_alert_days integer DEFAULT 7,
  high_value_claim_threshold numeric(12,2) DEFAULT 500000,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE insurance_automation_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON insurance_automation_config;
CREATE POLICY "hospital_isolation" ON insurance_automation_config
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

-- ─────────────────────────────────────────────
-- 8. Enable Realtime on core insurance tables
-- ─────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_pre_auth;
ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_claims;
ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_automation_log;

-- ─────────────────────────────────────────────
-- 9. DB trigger functions for automation engine
--    (actual HTTP calls require pg_net extension)
-- ─────────────────────────────────────────────

-- Function: fire automation on new insurance admission
CREATE OR REPLACE FUNCTION public.fn_insurance_auto_intimate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.insurance_type IS NOT NULL AND NEW.insurance_type != 'self_pay' THEN
    -- Check if pg_net is available before calling
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
      PERFORM pg_net.http_post(
        url      := current_setting('app.supabase_functions_url', true) || '/insurance-automation',
        headers  := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
        ),
        body     := jsonb_build_object(
          'action',         'auto_intimate',
          'admission_id',   NEW.id,
          'hospital_id',    NEW.hospital_id,
          'patient_id',     NEW.patient_id,
          'admission_type', NEW.admission_type,
          'insurance_type', NEW.insurance_type,
          'insurance_id',   NEW.insurance_id
        )::text
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger: auto-intimate on new admission
DROP TRIGGER IF EXISTS trg_insurance_auto_intimate ON public.admissions;
CREATE TRIGGER trg_insurance_auto_intimate
  AFTER INSERT ON public.admissions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_insurance_auto_intimate();

-- Function: fire automation on patient discharge
CREATE OR REPLACE FUNCTION public.fn_insurance_on_discharge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'discharged' AND NEW.status = 'discharged'
     AND NEW.insurance_type IS NOT NULL AND NEW.insurance_type != 'self_pay' THEN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
      PERFORM pg_net.http_post(
        url      := current_setting('app.supabase_functions_url', true) || '/insurance-automation',
        headers  := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
        ),
        body     := jsonb_build_object(
          'action',       'auto_bundle_and_submit_claim',
          'admission_id', NEW.id,
          'hospital_id',  NEW.hospital_id,
          'patient_id',   NEW.patient_id
        )::text
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger: auto-bundle claim on discharge
DROP TRIGGER IF EXISTS trg_insurance_on_discharge ON public.admissions;
CREATE TRIGGER trg_insurance_on_discharge
  AFTER UPDATE ON public.admissions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_insurance_on_discharge();

-- pg_cron deadline monitoring (runs every 4 hours if pg_cron is available)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'insurance-deadline-check',
      '0 */4 * * *',
      $cron$
        SELECT pg_net.http_post(
          url      := current_setting('app.supabase_functions_url', true) || '/insurance-automation',
          headers  := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
          ),
          body     := '{"action":"check_deadlines"}'
        );
      $cron$
    );
  END IF;
END;
$$;
