-- ============================================================
-- Schedule churn-remediation-scan (weekly)
-- ============================================================
-- Same Vault-lookup pattern as 20261008000100_cron_jobs_use_vault.sql — no
-- literal credentials in this committed file. Requires the
-- aumrti_service_role_key Vault secret (already created live for the
-- Platform Pod cron jobs) to exist before this actually schedules anything.
-- ============================================================

DO $$
DECLARE
  fn_url text := 'https://pdxvisvmnzjhsgmvygku.supabase.co';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not enabled — skipping churn-remediation-scan schedule.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key') THEN
    RAISE NOTICE 'aumrti_service_role_key not found in Vault — run vault.create_secret(...) first, then re-run this migration.';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('aumrti-churn-remediation-scan');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- job didn't exist yet, nothing to unschedule
  END;

  PERFORM cron.schedule(
    'aumrti-churn-remediation-scan',
    '0 3 * * 1', -- Mondays 03:00 UTC
    format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')),
        body := '{}'::jsonb
      );$sql$,
      fn_url || '/functions/v1/churn-remediation-scan'
    )
  );

  RAISE NOTICE 'Scheduled aumrti-churn-remediation-scan (weekly, Mondays 03:00 UTC).';
END;
$$;
