-- Sprint 3A: SMS delivery log for send-sms edge function
CREATE TABLE IF NOT EXISTS public.sms_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  to_phone        text NOT NULL,
  message         text NOT NULL,
  provider        text NOT NULL DEFAULT 'msg91',
  message_id      text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  notification_id uuid,
  sent_at         timestamptz,
  error_text      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.sms_notifications
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE INDEX IF NOT EXISTS idx_sms_notifications_hospital
  ON public.sms_notifications(hospital_id, created_at DESC);
