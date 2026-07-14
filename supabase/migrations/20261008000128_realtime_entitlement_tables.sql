-- Enable realtime on the entitlement tables so a plan / feature-override / pricing
-- change made by a platform admin propagates INSTANTLY to the hospital's running
-- app (useSubscriptionConfig subscribes to these). Previously the app cached the
-- plan for 5 minutes with no invalidation, so a Starter→Clinics switch kept serving
-- the old plan's module access and limits.
--
-- REPLICA IDENTITY FULL is required so realtime row filters can match on hospital_id
-- (which is not the primary key). Idempotent — safe to re-run.

ALTER TABLE public.hospital_subscriptions      REPLICA IDENTITY FULL;
ALTER TABLE public.hospital_feature_overrides  REPLICA IDENTITY FULL;
ALTER TABLE public.hospital_pricing_overrides  REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'hospital_subscriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hospital_subscriptions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'hospital_feature_overrides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hospital_feature_overrides;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'hospital_pricing_overrides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hospital_pricing_overrides;
  END IF;
END $$;
