-- Notification Unified Queue (Sprint 8C)
-- Single queue for all outbound notifications (SMS, email, WhatsApp, push).
-- Provides: deduplication via dedup_key, retry with exponential back-off,
-- dead-letter after max_retries, and audit trail.
-- The notification-dispatcher cron reads from this queue and routes to send-* functions.

CREATE TABLE IF NOT EXISTS public.notification_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid        REFERENCES public.hospitals(id) ON DELETE CASCADE,
  channel         text        NOT NULL CHECK (channel IN ('sms', 'email', 'whatsapp', 'push')),
  recipient       text        NOT NULL,           -- phone, email, or FCM token
  subject         text,                           -- email subject or push title
  body            text        NOT NULL,
  metadata        jsonb,                          -- extra data for the channel (template vars, etc.)
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  retry_count     int         NOT NULL DEFAULT 0,
  max_retries     int         NOT NULL DEFAULT 3,
  next_retry_at   timestamptz NOT NULL DEFAULT now(),
  dedup_key       text,                           -- sha256(channel+recipient+body_hash+YYYY-MM-DD)
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  error           text
);

-- Prevent duplicate notifications within the same day for the same channel+recipient+content
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_dedup
  ON public.notification_queue (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Dispatcher query index
CREATE INDEX IF NOT EXISTS idx_notification_queue_dispatch
  ON public.notification_queue (status, next_retry_at)
  WHERE status IN ('pending', 'failed');

-- Lookup by hospital
CREATE INDEX IF NOT EXISTS idx_notification_queue_hospital
  ON public.notification_queue (hospital_id, created_at DESC);

-- RLS: hospital isolation
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation on notification_queue"
  ON public.notification_queue FOR ALL TO authenticated
  USING (
    hospital_id IS NULL OR hospital_id = public.get_user_hospital_id()
  )
  WITH CHECK (
    hospital_id IS NULL OR hospital_id = public.get_user_hospital_id()
  );
