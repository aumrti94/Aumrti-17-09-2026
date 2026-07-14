-- ============================================================
-- Schedule mrr-snapshot-job (monthly, 1st of month)
-- ============================================================
-- Same Vault-lookup pattern as every other cron this session — no literal
-- credentials in this committed file. Requires the aumrti_service_role_key
-- Vault secret to exist before this actually schedules anything.
-- ============================================================

DO $$
DECLARE
  fn_url text := 'https://pdxvisvmnzjhsgmvygku.supabase.co';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not enabled — skipping mrr-snapshot-job schedule.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key') THEN
    RAISE NOTICE 'aumrti_service_role_key not found in Vault — run vault.create_secret(...) first, then re-run this migration.';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('aumrti-mrr-snapshot-job');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- job didn't exist yet, nothing to unschedule
  END;

  PERFORM cron.schedule(
    'aumrti-mrr-snapshot-job',
    '0 2 1 * *', -- 1st of each month, 02:00 UTC
    format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')),
        body := '{}'::jsonb
      );$sql$,
      fn_url || '/functions/v1/mrr-snapshot-job'
    )
  );

  RAISE NOTICE 'Scheduled aumrti-mrr-snapshot-job (monthly, 1st at 02:00 UTC).';
END;
$$;
