-- =============================================================================
-- Fix: Missing tables causing 100% UI failure in Notifications + Dashboard
-- Also: Add AI audit linkage columns, patient NKDA field
-- =============================================================================

-- notification_log: queried in src/pages/notifications/NotificationsPage.tsx
CREATE TABLE IF NOT EXISTS public.notification_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  channel        text        NOT NULL CHECK (channel IN ('whatsapp','sms','email','push','in_app')),
  status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('sent','delivered','failed','pending')),
  recipient_name text,
  recipient_phone text,
  recipient_email text,
  event_type     text,
  subject        text,
  message_body   text,
  error_message  text,
  provider       text,
  external_id    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.notification_log
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id());
CREATE INDEX IF NOT EXISTS idx_notification_log_hospital
  ON public.notification_log(hospital_id, created_at DESC);

-- notification_preferences: queried in src/pages/notifications/NotificationsPage.tsx
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id          uuid        REFERENCES public.patients(id) ON DELETE CASCADE,
  whatsapp_enabled    boolean     NOT NULL DEFAULT true,
  sms_enabled         boolean     NOT NULL DEFAULT false,
  email_enabled       boolean     NOT NULL DEFAULT false,
  push_enabled        boolean     NOT NULL DEFAULT false,
  quiet_hours_start   time        DEFAULT '22:00',
  quiet_hours_end     time        DEFAULT '07:00',
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, patient_id)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.notification_preferences
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id());
CREATE INDEX IF NOT EXISTS idx_notification_prefs_hospital
  ON public.notification_preferences(hospital_id);

-- alert_escalation_rules: queried in src/components/dashboard/AlertsPanel.tsx
-- and consumed by supabase/functions/alert-escalation/index.ts
CREATE TABLE IF NOT EXISTS public.alert_escalation_rules (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id              uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  severity                 text        DEFAULT 'all',
  alert_type               text,
  escalate_after_minutes   integer     NOT NULL DEFAULT 30,
  escalation_channels      text[]      DEFAULT ARRAY['whatsapp'],
  notify_roles             text[]      DEFAULT ARRAY['doctor','nursing_supervisor'],
  sms_numbers              text[]      DEFAULT ARRAY[]::text[],
  email_addresses          text[]      DEFAULT ARRAY[]::text[],
  is_active                boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.alert_escalation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.alert_escalation_rules
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id());
CREATE INDEX IF NOT EXISTS idx_alert_escalation_rules_hospital
  ON public.alert_escalation_rules(hospital_id);

-- AI audit linkage: add patient_id + encounter_id to ai_usage_logs (guarded — table created in 20260910000002)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_usage_logs') THEN
    ALTER TABLE public.ai_usage_logs
      ADD COLUMN IF NOT EXISTS patient_id    uuid REFERENCES public.patients(id),
      ADD COLUMN IF NOT EXISTS encounter_id  uuid;
    CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_patient
      ON public.ai_usage_logs(patient_id) WHERE patient_id IS NOT NULL;
  END IF;
END $$;

-- NKDA (No Known Drug Allergies) flag on patients — structured allergy field
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS nkda boolean DEFAULT false;

-- audit_log: ensure required columns exist for login/logout tracking
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS actor_role    text,
  ADD COLUMN IF NOT EXISTS action_type   text,
  ADD COLUMN IF NOT EXISTS entity_type   text,
  ADD COLUMN IF NOT EXISTS entity_id     uuid,
  ADD COLUMN IF NOT EXISTS metadata      jsonb;
