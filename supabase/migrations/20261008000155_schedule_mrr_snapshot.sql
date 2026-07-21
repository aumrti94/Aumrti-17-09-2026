-- ═══════════════════════════════════════════════════════════════════════════
-- Schedule the MRR snapshot job
--
-- `mrr-snapshot-job` has existed since migration ...120 and its own header says
-- "1st of month, scheduled via pg_cron" — but no cron.schedule entry for it was
-- ever written. So `mrr_snapshots` has stayed empty and compute_dollar_nrr()
-- has had no history to work from.
--
-- This is the one gap worth closing promptly rather than perfectly: a snapshot
-- is a point-in-time record and CANNOT be reconstructed after the fact. Every
-- month without this job is a month of net-revenue-retention history that is
-- permanently unavailable.
--
-- Follows 20261008000100_cron_jobs_use_vault.sql exactly: guard on pg_cron,
-- guard on the Vault secret, unschedule-then-schedule, service-role key read
-- from vault.decrypted_secrets rather than written into the job body.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  fn_url text := 'https://pdxvisvmnzjhsgmvygku.supabase.co';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not enabled — skipping MRR snapshot schedule.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key') THEN
    RAISE NOTICE 'aumrti_service_role_key not in Vault — skipping. Re-run after vault.create_secret(...).';
    RETURN;
  END IF;

  -- 02:00 UTC on the 1st: after month-end charges have settled, before anyone
  -- looks at the dashboard.
  --
  -- Guarded: cron.unschedule() RAISES if the job does not exist, which for a
  -- brand-new job name would abort this whole block. (The older migration this
  -- follows could call it unguarded only because its jobs already existed.)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aumrti-mrr-snapshot') THEN
    PERFORM cron.unschedule('aumrti-mrr-snapshot');
  END IF;
  PERFORM cron.schedule('aumrti-mrr-snapshot', '0 2 1 * *', format(
    $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{}'::jsonb);$sql$,
    fn_url || '/functions/v1/mrr-snapshot-job'
  ));

  RAISE NOTICE 'Scheduled aumrti-mrr-snapshot (0 2 1 * *).';
END $$;
