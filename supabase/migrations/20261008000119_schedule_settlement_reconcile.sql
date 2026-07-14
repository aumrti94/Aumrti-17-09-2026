-- ============================================================
-- Schedule razorpay-settlement-reconcile (weekly)
-- ============================================================
-- Same Vault-lookup pattern as every other cron this session — no literal
-- credentials in this committed file. Requires the aumrti_service_role_key
-- Vault secret to exist before this actually schedules anything.
-- Runs Wednesdays to spread cron load across the week.
-- ============================================================

DO $$
DECLARE
  fn_url text := 'https://pdxvisvmnzjhsgmvygku.supabase.co';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not enabled — skipping razorpay-settlement-reconcile schedule.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key') THEN
    RAISE NOTICE 'aumrti_service_role_key not found in Vault — run vault.create_secret(...) first, then re-run this migration.';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('aumrti-settlement-reconcile');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- job didn't exist yet, nothing to unschedule
  END;

  PERFORM cron.schedule(
    'aumrti-settlement-reconcile',
    '0 3 * * 3', -- Wednesdays 03:00 UTC
    format(
      $sql$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')),
        body := '{}'::jsonb
      );$sql$,
      fn_url || '/functions/v1/razorpay-settlement-reconcile'
    )
  );

  RAISE NOTICE 'Scheduled aumrti-settlement-reconcile (weekly, Wednesdays 03:00 UTC).';
END;
$$;
