-- Dunning Automation (Sprint 8B)
-- Tracks payment retry attempts for past_due subscriptions during the 7-day
-- grace period before trial-lifecycle-cron suspends the account.
-- Complements the existing trial-lifecycle-cron (which handles suspension).

CREATE TABLE IF NOT EXISTS public.dunning_attempts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  subscription_id     uuid        REFERENCES public.hospital_subscriptions(id),
  attempt_number      int         NOT NULL,           -- 1, 2, 3, 4, 5 (escalation day)
  channel             text        NOT NULL,           -- 'email' | 'sms' | 'whatsapp'
  status              text        NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'failed')),
  sent_at             timestamptz NOT NULL DEFAULT now(),
  razorpay_retry_id   text,                           -- if Razorpay payment retry was triggered
  error_message       text
);

CREATE INDEX IF NOT EXISTS idx_dunning_attempts_hospital
  ON public.dunning_attempts (hospital_id, sent_at DESC);

-- RLS: only admins can read dunning attempts (billing sensitive data)
ALTER TABLE public.dunning_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation on dunning_attempts"
  ON public.dunning_attempts FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
