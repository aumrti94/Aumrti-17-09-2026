-- ============================================================
-- Trial Lifecycle Cron Job (pg_cron)
-- Calls trial-lifecycle-cron edge function daily at 00:30 UTC
-- ============================================================
-- NOTE: pg_cron is available on Supabase Pro and above.
-- To enable: Database → Extensions → pg_cron
-- Supabase also supports net.http_post via pg_net extension.
--
-- The cron job calls the edge function directly.
-- The edge function URL pattern: https://<project-ref>.supabase.co/functions/v1/trial-lifecycle-cron
--
-- IMPORTANT: Set app.supabase_project_ref and app.supabase_anon_key as database settings,
-- OR manually replace the URL below with your actual project URL.
-- ============================================================

-- Create the cron schedule (idempotent via cron.schedule upsert)
-- Runs at 00:30 UTC every day
DO $$
BEGIN
  -- Only create if pg_cron extension is available
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    PERFORM cron.schedule(
      'aumrti-trial-lifecycle-check',
      '30 0 * * *',
      $cron_body$
        SELECT net.http_post(
          url := current_setting('app.supabase_url', true) || '/functions/v1/trial-lifecycle-cron',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
          ),
          body := '{}'::jsonb
        );
      $cron_body$
    );
    RAISE NOTICE 'Cron job aumrti-trial-lifecycle-check scheduled.';
  ELSE
    RAISE NOTICE 'pg_cron not available — schedule the trial-lifecycle-cron edge function manually via Supabase Dashboard or an external scheduler.';
  END IF;
END;
$$;

-- ── Alternative: app settings for the cron ───────────────────────────────────
-- Run these in SQL editor after migration to configure the cron URL:
--   ALTER DATABASE postgres SET "app.supabase_url" = 'https://YOUR-REF.supabase.co';
--   ALTER DATABASE postgres SET "app.supabase_service_role_key" = 'YOUR-SERVICE-ROLE-KEY';
--
-- Or trigger manually from CEO dashboard at /platform via:
--   supabase.functions.invoke('trial-lifecycle-cron')
