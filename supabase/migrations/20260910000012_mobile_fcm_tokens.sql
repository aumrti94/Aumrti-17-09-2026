-- ── Gap 14: Mobile App — FCM Token Storage ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fcm_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token           text NOT NULL,
  platform        text NOT NULL CHECK (platform IN ('android','ios','web')),
  app_version     text,
  device_model    text,
  is_active       boolean NOT NULL DEFAULT true,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_hospital_user
  ON public.fcm_tokens (hospital_id, user_id, is_active);

ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fcm_tokens_hospital_iso" ON public.fcm_tokens;
CREATE POLICY "fcm_tokens_hospital_iso" ON public.fcm_tokens
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- ── Push notification log ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id),
  title           text NOT NULL,
  body            text NOT NULL,
  data            jsonb,
  platform        text CHECK (platform IN ('android','ios','web','all')),
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','delivered','failed')),
  fcm_message_id  text,
  error_message   text,
  sent_at         timestamptz DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_notifications_hospital
  ON public.push_notifications (hospital_id, created_at DESC);

ALTER TABLE public.push_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_notifications_hospital_iso" ON public.push_notifications;
CREATE POLICY "push_notifications_hospital_iso" ON public.push_notifications
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
