-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: leakage_reports
-- Purpose  : Persistent store for daily automated leakage scan results, plus
--            a pg_cron schedule that fires the daily-leakage-scan Edge Function
--            at 06:00 IST (00:30 UTC) every day.
-- Idempotent: IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. leakage_reports ───────────────────────────────────────────────────────
-- One row per (hospital, report_date). Holds aggregate counts, estimated revenue
-- at risk, and a JSONB detail array for the CEO dashboard and billing drilldown.

CREATE TABLE IF NOT EXISTS public.leakage_reports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       uuid        NOT NULL REFERENCES public.hospitals(id),
  report_date       date        NOT NULL DEFAULT (CURRENT_DATE - 1),
  lab_count         int         NOT NULL DEFAULT 0,
  radiology_count   int         NOT NULL DEFAULT 0,
  pharmacy_count    int         NOT NULL DEFAULT 0,
  ot_count          int         NOT NULL DEFAULT 0,
  total_items       int         NOT NULL DEFAULT 0,
  estimated_amount  numeric(14,2) NOT NULL DEFAULT 0,
  items             jsonb       NOT NULL DEFAULT '[]',
  scan_completed_at timestamptz NOT NULL DEFAULT now(),
  notified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leakage_reports_unique UNIQUE (hospital_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_leakage_reports_hospital_date
  ON public.leakage_reports (hospital_id, report_date DESC);

ALTER TABLE public.leakage_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leakage_reports_select" ON public.leakage_reports;
DROP POLICY IF EXISTS "leakage_reports_all"    ON public.leakage_reports;

CREATE POLICY "leakage_reports_select" ON public.leakage_reports
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "leakage_reports_all" ON public.leakage_reports
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 2. pg_cron schedule ──────────────────────────────────────────────────────
-- 00:30 UTC = 06:00 IST. Calls daily-leakage-scan Edge Function via pg_net.
-- Idempotent: unschedule existing job with the same name before re-creating.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron extension is not enabled — skipping daily-leakage-scan schedule. '
      'To enable: Supabase Dashboard → Database → Extensions → pg_cron → Enable. '
      'Then re-run this migration or run the PERFORM cron.schedule(...) block manually.';
    RETURN;
  END IF;

  -- Unschedule any existing job with the same name (ignore error if absent)
  BEGIN
    PERFORM cron.unschedule('daily-leakage-scan');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'daily-leakage-scan',
    '30 0 * * *',
    $cron$
      SELECT pg_net.http_post(
        url     := current_setting('app.supabase_functions_url', true) || '/daily-leakage-scan',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
        ),
        body    := '{"action":"daily_scan"}'::jsonb
      );
    $cron$
  );

  RAISE NOTICE 'pg_cron job daily-leakage-scan scheduled at 00:30 UTC (06:00 IST) daily.';
END $$;
