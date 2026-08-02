-- ============================================================================
-- NABH Quality Indicator Engine — 5/7: scheduling and 12-month backfill
-- ============================================================================
-- Uses the SQL-RPC cron pattern of 20261008000085_budget_actuals.sql, which
-- calls a Postgres function directly and needs no credential. The HTTP-triggered
-- jobs in this project are all gated behind a manual vault.create_secret() step
-- (see 20261008000100_cron_jobs_use_vault.sql); the two SQL-RPC jobs never were.
-- Collection must not depend on that manual step.
-- ============================================================================

-- ─── Backfill: 12 trailing monthly periods ──────────────────────────────────
-- NABH assessors expect trend evidence, and a run chart needs history that does
-- not exist yet. Everything is recomputed from transactional data, so this is
-- safe to re-run.
CREATE OR REPLACE FUNCTION public.backfill_quality_indicators(
  p_hospital_id uuid,
  p_months      integer DEFAULT 12
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period date; v_total integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND p_hospital_id IS DISTINCT FROM public.get_user_hospital_id()
     AND NOT public.is_aumrti_admin() THEN
    RAISE EXCEPTION 'not authorised for hospital %', p_hospital_id USING ERRCODE = '42501';
  END IF;

  IF p_months < 1 OR p_months > 60 THEN
    RAISE EXCEPTION 'p_months must be between 1 and 60' USING ERRCODE = '22023';
  END IF;

  -- Oldest first so trend series build in chronological order.
  FOR v_period IN
    SELECT (date_trunc('month', current_date) - (n || ' months')::interval)::date
    FROM generate_series(p_months - 1, 0, -1) AS n
  LOOP
    v_total := v_total + public.run_quality_indicator_collection(p_hospital_id, v_period, 'monthly');
  END LOOP;

  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.backfill_quality_indicators(uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.backfill_quality_indicators(uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.backfill_quality_indicators(uuid, integer) IS
  'Recomputes the trailing N monthly periods for one hospital so trend and run '
  'charts have history immediately. Idempotent.';

-- ─── Scheduled collection ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron is not enabled — skipping quality-indicator schedules. '
      'To enable: Supabase Dashboard > Database > Extensions > pg_cron > Enable, '
      'then re-run this migration. Until then use the Recalculate button in '
      'Quality > Quality Indicators, or call '
      'public.run_quality_indicator_collection_all() from a scheduler.';
    RETURN;
  END IF;

  BEGIN PERFORM cron.unschedule('aumrti-monthly-qi-close');   EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('aumrti-nightly-qi-refresh'); EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Monthly close: 02:00 on the 2nd (19:30 UTC on the 1st is 01:00 IST on the
  -- 2nd). Recomputes the month that just ended, once late data has landed.
  -- This is the figure that gets reported, so it is sealed separately from the
  -- running current month.
  PERFORM cron.schedule(
    'aumrti-monthly-qi-close',
    '30 19 1 * *',
    $cron_body$
      SELECT public.run_quality_indicator_collection_all(
        (date_trunc('month', current_date) - interval '1 month')::date, 'monthly');
    $cron_body$
  );

  -- In-month refresh so the dashboard is never more than a day stale. Only ever
  -- touches the current, still-open month.
  PERFORM cron.schedule(
    'aumrti-nightly-qi-refresh',
    '45 1 * * *',
    $cron_body$
      SELECT public.run_quality_indicator_collection_all(
        date_trunc('month', current_date)::date, 'monthly');
    $cron_body$
  );

  RAISE NOTICE 'Scheduled aumrti-monthly-qi-close and aumrti-nightly-qi-refresh.';
END;
$$;
