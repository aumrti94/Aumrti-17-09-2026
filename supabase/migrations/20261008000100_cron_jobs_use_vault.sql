-- ============================================================
-- Move cron-job credentials out of literal cron.job bodies, into Vault
-- ============================================================
-- On 2026-07-10, pg_cron was found disabled project-wide (see
-- 20261008000097_schedule_pod_cron_jobs.sql's trailing comment). As a live
-- stopgap to unblock without committing a secret to a migration file, the
-- 6 HTTP-triggered cron jobs were scheduled with the service-role key
-- hardcoded directly into cron.job.command — readable by anyone with SQL
-- access to this project (same trust boundary as the Dashboard, but not
-- the intended long-term home for a live credential).
--
-- This migration moves that key into Supabase Vault (already installed,
-- confirmed live) and re-points every HTTP-triggered job at a
-- vault.decrypted_secrets lookup instead of a literal string. The two
-- SQL-RPC jobs (aumrti-monthly-depreciation, aumrti-nightly-budget-actuals)
-- call a Postgres function directly and never touch the key — untouched.
--
-- PREREQUISITE (run once, NOT via migration — never commit a real secret
-- to a file): insert the key into Vault first:
--   SELECT vault.create_secret(
--     '<the SUPABASE_SERVICE_ROLE_KEY value>',
--     'aumrti_service_role_key',
--     'Service-role key for HTTP-triggered pg_cron jobs (net.http_post → edge functions)'
--   );
-- Safe to run from the Dashboard SQL Editor, or from any script that reads
-- it from .env.local (gitignored) — never from a migration file.
-- ============================================================

DO $$
DECLARE
  -- The project URL is not sensitive — it's already public in the compiled
  -- frontend bundle (VITE_SUPABASE_URL) and in every API request. Only the
  -- service-role key needs Vault; current_setting('app.supabase_url', ...)
  -- was tried first but that GUC can't be set from this connection's
  -- privilege level either (same discovery as the pg_cron migration), so
  -- the URL is a literal here rather than adding a second blocked dependency.
  fn_url text := 'https://pdxvisvmnzjhsgmvygku.supabase.co';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not enabled — nothing to reschedule.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key') THEN
    RAISE NOTICE 'aumrti_service_role_key not found in Vault yet — run the vault.create_secret(...) step above first, then re-run this migration. Existing cron jobs (if any) are left as-is.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('aumrti-dunning-processor');
  PERFORM cron.schedule('aumrti-dunning-processor', '0 6,18 * * *', format(
    $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{}'::jsonb);$sql$,
    fn_url || '/functions/v1/dunning-processor'
  ));

  PERFORM cron.unschedule('aumrti-webhook-dlq-retry');
  PERFORM cron.schedule('aumrti-webhook-dlq-retry', '*/15 * * * *', format(
    $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{}'::jsonb);$sql$,
    fn_url || '/functions/v1/webhook-dlq-processor'
  ));

  PERFORM cron.unschedule('aumrti-notification-dispatcher');
  PERFORM cron.schedule('aumrti-notification-dispatcher', '*/10 * * * *', format(
    $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{}'::jsonb);$sql$,
    fn_url || '/functions/v1/notification-dispatcher'
  ));

  PERFORM cron.unschedule('aumrti-trial-lifecycle-check');
  PERFORM cron.schedule('aumrti-trial-lifecycle-check', '30 0 * * *', format(
    $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{}'::jsonb);$sql$,
    fn_url || '/functions/v1/trial-lifecycle-cron'
  ));

  PERFORM cron.unschedule('daily-leakage-scan');
  PERFORM cron.schedule('daily-leakage-scan', '30 0 * * *', format(
    $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{"action":"daily_scan"}'::jsonb);$sql$,
    fn_url || '/functions/v1/daily-leakage-scan'
  ));

  PERFORM cron.unschedule('insurance-deadline-check');
  PERFORM cron.schedule('insurance-deadline-check', '0 */4 * * *', format(
    $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{"action":"check_deadlines"}'::jsonb);$sql$,
    fn_url || '/functions/v1/insurance-automation'
  ));

  RAISE NOTICE 'Rescheduled all 6 HTTP-triggered cron jobs to look up the service-role key from Vault instead of a literal string.';
END;
$$;
