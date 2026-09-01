-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Schedule the outbound webhook dispatcher
--
-- Follows 20261008000100_cron_jobs_use_vault.sql exactly — same Vault secret name, same
-- net.http_post shape, same guards. Scheduling lives with the other HTTP-triggered jobs rather
-- than inside the feature migration that created the dispatcher.
--
-- ── Why this migration exists ────────────────────────────────────────────────────────────────
-- 20261019000003 originally scheduled the dispatcher itself, copying the cron block from
-- 20260518000008_leakage_reports.sql. That copy carried two defects:
--
--   * `pg_net.http_post` — pg_net installs its API into schema `net`, so this function does not
--     exist and the job errors on every tick;
--   * `current_setting('app.supabase_functions_url', true)` — no such GUC is ever set, and the
--     missing_ok flag turns that into NULL rather than an error, so the job quietly posted to a
--     NULL url instead of failing loudly.
--
-- 20261008000100 had already solved both for the six jobs that existed then. This brings the
-- dispatcher into line.
--
-- ── PREREQUISITE ─────────────────────────────────────────────────────────────────────────────
-- The Vault secret must exist. If it does not (or was created under a different name), this
-- migration says so and changes nothing:
--
--   SELECT vault.create_secret(
--     '<the SUPABASE_SERVICE_ROLE_KEY value>',
--     'aumrti_service_role_key',
--     'Service-role key for HTTP-triggered pg_cron jobs (net.http_post → edge functions)'
--   );
--
-- Run it from the Dashboard SQL Editor. Never commit a real secret to a migration file.
--
-- The dispatcher must also be DEPLOYED — `supabase db push` applies migrations but does not
-- deploy edge functions:
--
--   npx supabase functions deploy webhook-dispatcher
--
-- A schedule pointing at an undeployed function returns 404 every minute, which is exactly the
-- state that made webhooks appear broken.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- Not sensitive: the project URL is already public in the compiled frontend bundle
  -- (VITE_SUPABASE_URL) and in every API request. Matches 20261008000100.
  fn_url text := 'https://pdxvisvmnzjhsgmvygku.supabase.co';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron is not enabled — webhook deliveries will not be dispatched. '
      'Enable via Dashboard → Database → Extensions → pg_cron, then re-run this migration.';
    RETURN;
  END IF;

  -- Remove the broken job 20261019000003 may have left behind. cron.schedule stores the command
  -- string without validating it, so a job created by that migration exists and fails silently
  -- on every tick.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhook-dispatcher') THEN
    PERFORM cron.unschedule('webhook-dispatcher');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key') THEN
    RAISE NOTICE
      'aumrti_service_role_key not found in Vault — webhook-dispatcher NOT scheduled. '
      'Run the vault.create_secret(...) step in this file''s header, then re-run this migration.';
    RETURN;
  END IF;

  -- Every minute: the outbox is drained continuously, so a webhook arrives within ~60s of the
  -- clinical or billing event that produced it. The dispatcher is a no-op when there is nothing
  -- to send, so an idle hospital costs one cheap query per minute.
  PERFORM cron.schedule('webhook-dispatcher', '* * * * *', format(
    $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{"trigger":"cron"}'::jsonb);$sql$,
    fn_url || '/functions/v1/webhook-dispatcher'
  ));

  RAISE NOTICE 'webhook-dispatcher scheduled every minute via Vault credential lookup.';
END;
$$;
