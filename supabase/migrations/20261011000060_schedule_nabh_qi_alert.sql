-- ============================================================================
-- NABH Quality Indicator Engine — 6/7: schedule the QI anomaly alert
-- ============================================================================
-- supabase/functions/ai-nabh-indicator-alert carries a cron expression
-- (0 2 * * 1) in a COMMENT BLOCK ONLY. There has never been a cron.schedule for
-- it in any migration and nothing in supabase/config.toml, so the weekly NABH
-- indicator anomaly alert has never once run in any environment.
--
-- This uses the Vault pattern of 20261008000100_cron_jobs_use_vault.sql and
-- inherits its manual prerequisite: aumrti_service_role_key must already exist
-- in Vault. It degrades to a NOTICE if not, which is why this migration is last
-- in the series — everything before it works regardless.
-- ============================================================================

DO $$
DECLARE
  -- Project URL is not sensitive: it already ships in the compiled frontend
  -- bundle. Only the service-role key needs Vault. Literal here for the same
  -- reason as the migration this pattern comes from — the app.supabase_url GUC
  -- cannot be set at this connection's privilege level.
  fn_url text := 'https://pdxvisvmnzjhsgmvygku.supabase.co';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not enabled — skipping aumrti-nabh-qi-weekly-alert.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key') THEN
    RAISE NOTICE
      'aumrti_service_role_key not in Vault — skipping aumrti-nabh-qi-weekly-alert. '
      'Run vault.create_secret(...) as described in 20261008000100_cron_jobs_use_vault.sql, '
      'then re-run this migration. Indicator collection itself is unaffected: it '
      'runs via SQL-RPC cron and needs no credential.';
    RETURN;
  END IF;

  BEGIN PERFORM cron.unschedule('aumrti-nabh-qi-weekly-alert'); EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Monday 02:00 UTC, after the monthly close and the nightly refresh.
  PERFORM cron.schedule('aumrti-nabh-qi-weekly-alert', '0 2 * * 1', format(
    $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{}'::jsonb);$sql$,
    fn_url || '/functions/v1/ai-nabh-indicator-alert'
  ));

  RAISE NOTICE 'Scheduled aumrti-nabh-qi-weekly-alert (Mondays 02:00 UTC).';
END;
$$;
