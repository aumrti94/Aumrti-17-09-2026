-- ── Gap 18: Notification Preferences & Log ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id          uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  staff_user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  whatsapp_enabled    boolean NOT NULL DEFAULT true,
  sms_enabled         boolean NOT NULL DEFAULT true,
  email_enabled       boolean NOT NULL DEFAULT false,
  push_enabled        boolean NOT NULL DEFAULT false,
  quiet_hours_start   time    DEFAULT '22:00',
  quiet_hours_end     time    DEFAULT '07:00',
  language            text    DEFAULT 'en',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, patient_id),
  UNIQUE (hospital_id, staff_user_id)
);

CREATE TABLE IF NOT EXISTS public.notification_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id          uuid REFERENCES public.patients(id),
  recipient_name      text,
  recipient_phone     text,
  recipient_email     text,
  channel             text NOT NULL CHECK (channel IN ('whatsapp','sms','email','push','in_app')),
  event_type          text NOT NULL,
  subject             text,
  message             text,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','delivered','failed')),
  error_message       text,
  provider_response   jsonb,
  sent_at             timestamptz DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- notification_log may pre-exist (20260607000001) without patient_id; ensure it for the index/policy below.
ALTER TABLE public.notification_log ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES public.patients(id);

CREATE INDEX IF NOT EXISTS idx_notification_log_hospital
  ON public.notification_log (hospital_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_log_patient
  ON public.notification_log (hospital_id, patient_id, created_at DESC);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_prefs_hospital_iso" ON public.notification_preferences;
CREATE POLICY "notif_prefs_hospital_iso" ON public.notification_preferences
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_log_hospital_iso" ON public.notification_log;
CREATE POLICY "notif_log_hospital_iso" ON public.notification_log
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
