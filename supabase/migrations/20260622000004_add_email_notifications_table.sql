-- Sprint 3B: Email delivery log for send-email edge function
CREATE TABLE IF NOT EXISTS public.email_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  to_email        text NOT NULL,
  subject         text NOT NULL,
  body_html       text,
  provider        text NOT NULL DEFAULT 'resend',
  message_id      text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  notification_id uuid,
  sent_at         timestamptz,
  error_text      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.email_notifications
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE INDEX IF NOT EXISTS idx_email_notifications_hospital
  ON public.email_notifications(hospital_id, created_at DESC);
