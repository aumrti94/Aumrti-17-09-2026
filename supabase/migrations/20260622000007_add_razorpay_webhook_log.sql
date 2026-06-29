-- Sprint 4C: Razorpay webhook deduplication log
-- hospital_id is nullable because dedup check happens before bill lookup
-- No RLS — only accessed via service-role key from edge functions
CREATE TABLE IF NOT EXISTS public.razorpay_webhook_log (
  webhook_id   text PRIMARY KEY,
  hospital_id  uuid,
  event        text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_hospital
  ON public.razorpay_webhook_log(hospital_id, processed_at DESC)
  WHERE hospital_id IS NOT NULL;
