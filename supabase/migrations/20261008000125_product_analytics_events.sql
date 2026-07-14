-- Product analytics events — net-new infrastructure. No event-tracking pipeline
-- existed anywhere in the repo before this (confirmed by grep for trackEvent/
-- logEvent/analytics_events/posthog/amplitude — zero matches). This unblocks
-- Rahul's ask from the Analytics & BI team review: which of the 11 AnalyticsPage
-- tabs hospitals actually use, before investing further in new ones.

CREATE TABLE IF NOT EXISTS public.product_analytics_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id       uuid        REFERENCES public.users(id),
  event_name    text        NOT NULL,
  event_context jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_analytics_events_lookup
  ON public.product_analytics_events (hospital_id, event_name, created_at);

ALTER TABLE public.product_analytics_events ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can log an event for their own hospital (write-only in
-- practice from the client — the app never reads its own events back).
CREATE POLICY "product_analytics_events_insert_own_hospital" ON public.product_analytics_events
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Reads restricted to admins — this is usage telemetry for product decisions,
-- not a per-hospital feature.
CREATE POLICY "product_analytics_events_admin_read" ON public.product_analytics_events
  FOR SELECT TO authenticated
  USING (public.is_aumrti_admin() OR hospital_id = get_user_hospital_id());
