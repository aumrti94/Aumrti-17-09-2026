-- ============================================================
-- Real dollar-weighted NRR — snapshot infrastructure
-- ============================================================
-- hospital_subscriptions only stores each hospital's CURRENT price — there
-- is no price history, so true dollar-weighted NRR cannot be computed
-- retroactively. This table starts accumulating monthly MRR snapshots so a
-- real NRR becomes computable ~12 months from when this migration ships.
-- Until then compute_dollar_nrr() honestly returns NULL ("insufficient
-- data") rather than a fabricated number — see the UI on
-- RevenueDashboardPage, which must show that state explicitly.
-- The 12-Month Logo Retention metric (headcount, not dollars) remains the
-- only retention number available today — see platform_metrics_registry.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mrr_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  snapshot_month date NOT NULL, -- always first-of-month
  mrr_amount     numeric(12,2) NOT NULL DEFAULT 0, -- 0 if not actively paying that month
  status         text NOT NULL,
  plan_id        uuid REFERENCES public.subscription_plans(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, snapshot_month)
);

CREATE INDEX IF NOT EXISTS idx_mrr_snapshots_month ON public.mrr_snapshots (snapshot_month);

ALTER TABLE public.mrr_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mrr_snapshots_admin_read" ON public.mrr_snapshots;
CREATE POLICY "mrr_snapshots_admin_read" ON public.mrr_snapshots
  FOR SELECT TO authenticated USING (public.is_aumrti_admin());

-- Insert/update is service-role only (the scheduled edge function).

-- ─────────────────────────────────────────────────────────────────────────────
-- compute_dollar_nrr() — real dollar-weighted Net Revenue Retention.
-- Compares the most recent snapshot month against the snapshot from ~12
-- months before it. Churned hospitals (no row in the current month, or a
-- row with mrr_amount = 0) contribute 0 to the numerator, exactly as NRR
-- requires. Returns NULL if no cohort exists 12 months back yet — this is
-- the honest "insufficient data" state, not a bug.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.compute_dollar_nrr()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_month AS (
    SELECT MAX(snapshot_month) AS m FROM public.mrr_snapshots
  ),
  cohort_month AS (
    SELECT (m - interval '12 months')::date AS m FROM latest_month
  ),
  base AS (
    SELECT hospital_id, mrr_amount AS base_mrr
    FROM public.mrr_snapshots
    WHERE snapshot_month = (SELECT m FROM cohort_month)
      AND mrr_amount > 0
  ),
  current AS (
    SELECT hospital_id, mrr_amount AS current_mrr
    FROM public.mrr_snapshots
    WHERE snapshot_month = (SELECT m FROM latest_month)
  )
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM base) = 0 THEN NULL
    WHEN SUM(b.base_mrr) = 0 THEN NULL
    ELSE ROUND(SUM(COALESCE(c.current_mrr, 0)) / SUM(b.base_mrr) * 100, 1)
  END
  FROM base b
  LEFT JOIN current c ON c.hospital_id = b.hospital_id;
$$;

REVOKE ALL    ON FUNCTION public.compute_dollar_nrr() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_dollar_nrr() TO authenticated;

-- Earliest snapshot month, so the UI can tell the user exactly when real
-- NRR will become accurate ("since <date>, accurate from <date+12mo>").
CREATE OR REPLACE FUNCTION public.mrr_snapshots_since()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT MIN(snapshot_month) FROM public.mrr_snapshots;
$$;

REVOKE ALL    ON FUNCTION public.mrr_snapshots_since() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mrr_snapshots_since() TO authenticated;
