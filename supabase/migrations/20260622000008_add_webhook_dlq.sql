-- Webhook Dead-Letter Queue (Sprint 7D)
-- Stores webhook deliveries that failed processing so they can be retried.
-- Does NOT replace razorpay_webhook_log (which handles deduplication of successes).
-- Edge functions use service role key — no RLS needed on this table.

CREATE TABLE IF NOT EXISTS public.webhook_dlq (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text        NOT NULL,   -- 'razorpay_payment' | 'razorpay_subscription'
  webhook_id        text,                   -- x-razorpay-event-id header (may be null for old events)
  event_type        text        NOT NULL,
  payload           jsonb       NOT NULL DEFAULT '{}',
  error_message     text        NOT NULL DEFAULT '',
  retry_count       int         NOT NULL DEFAULT 0,
  max_retries       int         NOT NULL DEFAULT 5,
  next_retry_at     timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'retrying', 'resolved', 'dead')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

-- Index for the DLQ processor cron query
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_dispatch
  ON public.webhook_dlq (status, next_retry_at)
  WHERE status IN ('pending', 'retrying');
