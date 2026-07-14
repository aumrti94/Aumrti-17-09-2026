-- ============================================================
-- Schedule the Platform Pod's dormant cron jobs (pg_cron)
-- ============================================================
-- Three edge functions were fully built with documented intended
-- schedules in their own header comments, but none were ever actually
-- scheduled via a committed migration — so they never ran in production.
-- This migration wires them up, following the same idempotent
-- IF EXISTS (pg_cron) guard pattern as 20260609000002_trial_lifecycle_cron.sql.
--
--   dunning-processor        — 06:00 & 18:00 UTC daily (matches its own
--                               header-documented cadence)
--   webhook-dlq-processor    — every 15 minutes (matches its own header)
--   notification-dispatcher  — every 10 minutes (nothing writes to
--                               notification_queue yet, so this is a
--                               safe no-op until a producer is wired up)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN

    PERFORM cron.schedule(
      'aumrti-dunning-processor',
      '0 6,18 * * *',
      $cron_body$
        SELECT net.http_post(
          url := current_setting('app.supabase_url', true) || '/functions/v1/dunning-processor',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
          ),
          body := '{}'::jsonb
        );
      $cron_body$
    );

    PERFORM cron.schedule(
      'aumrti-webhook-dlq-retry',
      '*/15 * * * *',
      $cron_body$
        SELECT net.http_post(
          url := current_setting('app.supabase_url', true) || '/functions/v1/webhook-dlq-processor',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
          ),
          body := '{}'::jsonb
        );
      $cron_body$
    );

    PERFORM cron.schedule(
      'aumrti-notification-dispatcher',
      '*/10 * * * *',
      $cron_body$
        SELECT net.http_post(
          url := current_setting('app.supabase_url', true) || '/functions/v1/notification-dispatcher',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
          ),
          body := '{}'::jsonb
        );
      $cron_body$
    );

    RAISE NOTICE 'Scheduled aumrti-dunning-processor, aumrti-webhook-dlq-retry, aumrti-notification-dispatcher.';
  ELSE
    RAISE NOTICE 'pg_cron not available — schedule dunning-processor, webhook-dlq-processor, and notification-dispatcher manually via Supabase Dashboard or an external scheduler.';
  END IF;
END;
$$;

-- IMPORTANT — discovered live on 2026-07-10: pg_cron was NOT enabled on this
-- project at all (confirmed via pg_extension query), and the
-- app.supabase_url / app.supabase_service_role_key database settings this
-- migration's cron.schedule bodies reference were never set (ALTER DATABASE
-- ... SET requires elevated privileges the pooler connection role does not
-- have — it must be run via the Supabase Dashboard SQL Editor). So this
-- migration alone does NOT make the jobs run, even though it applies cleanly.
--
-- To actually bring these three jobs (and aumrti-trial-lifecycle-check,
-- which has the identical gap) online, either:
--   (a) run `ALTER DATABASE postgres SET "app.supabase_url" = '...'` and
--       `ALTER DATABASE postgres SET "app.supabase_service_role_key" = '...'`
--       once via Dashboard → SQL Editor, so this migration's current_setting()
--       calls resolve, OR
--   (b) re-schedule each job with the URL/key hardcoded directly in the
--       cron.job body instead of current_setting() (what was done as a live
--       stopgap on 2026-07-10 to unblock this without touching secrets in
--       a committed file — see Nikhil's backlog for the follow-up to move
--       these to option (a) or to Vault-based secrets).
--
-- Also discovered the same day: daily-leakage-scan, insurance-automation,
-- depreciation_run and budget_actuals all have the identical guarded-cron
-- pattern and were very likely never running either, for the same root
-- cause (pg_cron was off project-wide) — not fixed here (different domain,
-- out of this session's scope), flagged for Ashok/Girija/Lakshmi to verify.
