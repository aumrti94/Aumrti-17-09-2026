-- ============================================================
-- Platform Metrics Registry — mirrors prompt_registry exactly
-- ============================================================
-- Documents the exact formula behind every number on RevenueDashboardPage
-- and ChurnRadarPage, so a tooltip can explain "how was this computed"
-- instead of showing a bare figure. This directly satisfies the hard rule
-- ("never show a risk score without explaining how it was computed") that
-- the original Platform Pod review flagged as violated.
-- Same shape and RLS split as prompt_registry: versioned, is_active-gated,
-- admin-write / authenticated-read.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_metrics_registry (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key               text        NOT NULL UNIQUE,
  display_name             text        NOT NULL,
  numerator_description    text        NOT NULL,
  denominator_description  text,
  period_description       text        NOT NULL,
  methodology_notes        text        NOT NULL,
  caveats                  text,
  version                  int         NOT NULL DEFAULT 1,
  is_active                boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_metrics_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_metrics_registry_read_all" ON public.platform_metrics_registry;
CREATE POLICY "platform_metrics_registry_read_all" ON public.platform_metrics_registry
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "platform_metrics_registry_admin_write" ON public.platform_metrics_registry;
CREATE POLICY "platform_metrics_registry_admin_write" ON public.platform_metrics_registry
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

CREATE OR REPLACE FUNCTION public.set_metrics_registry_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_metrics_registry_updated_at ON public.platform_metrics_registry;
CREATE TRIGGER trg_metrics_registry_updated_at
  BEFORE UPDATE ON public.platform_metrics_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_metrics_registry_updated_at();

CREATE INDEX IF NOT EXISTS idx_metrics_registry_key
  ON public.platform_metrics_registry (metric_key)
  WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: exact formulas as implemented in src/pages/platform/RevenueDashboardPage.tsx
-- and src/lib/platform-utils.ts computeHealthScore(), as of this migration.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.platform_metrics_registry
  (metric_key, display_name, numerator_description, denominator_description, period_description, methodology_notes, caveats) VALUES
  (
    'mrr',
    'Monthly Recurring Revenue',
    'Sum of subscription_plans.price_monthly for every hospital_subscriptions row with status = active',
    NULL,
    'Point-in-time snapshot, not a monthly total',
    'Only active, paying subscriptions count. Trial hospitals contribute ₹0 even if they will convert — MRR only reflects revenue already being collected, not pipeline.',
    'Does not net out mid-cycle plan changes, discounts, or partial-month proration — it is list price × active count.'
  ),
  (
    'arr',
    'Annual Run Rate',
    'mrr × 12',
    NULL,
    'Point-in-time snapshot, annualised',
    'A simple 12x multiplier of the current MRR snapshot — not a trailing-12-month sum of actual billed revenue.',
    'Assumes the current MRR holds flat for a year; will overstate ARR going into a growth month and understate it going into a churn month.'
  ),
  (
    'logo_retention_12mo',
    '12-Month Logo Retention',
    'Hospitals from the 12-months-ago cohort still in status active or trial today',
    'All hospitals whose hospital_subscriptions row was created more than 12 months ago',
    'Trailing 12 months, cohort-based',
    'Counts retained hospitals (logos), not retained revenue. A hospital that downgraded to the cheapest plan still counts as "retained" here.',
    'This was previously mislabeled "NRR" on the dashboard — it is not dollar-weighted and does not capture expansion or contraction revenue. See mrr_snapshots / compute_dollar_nrr() for the real dollar-weighted metric, which accumulates from when that table was introduced.'
  ),
  (
    'ltv',
    'Average Customer LTV',
    'ARPU (mrr / active hospital count) × max(avg active-hospital age in months × 2, 12)',
    NULL,
    'Point-in-time, blended across all active hospitals',
    'A heuristic, not a churn-rate-based LTV formula (LTV = ARPU / churn rate). Uses "2x current average tenure, floored at 12 months" as a stand-in because a reliable monthly churn rate cannot yet be computed from available data.',
    'Will be systematically low for a young customer base (most tenures are short) and is not comparable to a textbook churn-based LTV. Treat as a rough planning number, not a finance-grade figure.'
  ),
  (
    'trial_to_paid_conversion',
    'Trial → Paid Conversion',
    'Active hospital count',
    'Active hospital count + trial hospitals older than 14 days',
    'Point-in-time snapshot',
    'Trials younger than 14 days are excluded from the denominator entirely — a trial still has a chance to convert until it clears 14 days, so including it early would artificially depress the rate.',
    'Not a cohort conversion rate (it does not track a specific signup cohort over time) — it is a live snapshot of "how many currently-old-enough trials converted."'
  ),
  (
    'at_risk_mrr',
    'At-Risk MRR',
    'Sum of subscription_plans.price_monthly for every hospital_subscriptions row with status in (past_due, suspended)',
    NULL,
    'Point-in-time snapshot',
    'Flags revenue currently sitting in a failed-payment or suspended state — this is MRR the platform is at risk of losing, not revenue already lost.',
    NULL
  ),
  (
    'churn_health_score',
    'Churn Health / Risk Score',
    '0-100 composite: up to 30pts for OPD activity in the last 30 days + 20pts for billing activity in the last 30 days + up to 30pts for subscription status (active=30, trial=20, past_due=8, else 0) + up to 20pts for tenure (>180d=20, >90d=15, >30d=10, else 5)',
    NULL,
    'Rolling 30-day activity window, evaluated at scan time',
    'Hospitals younger than 14 days skip the full formula and get a flat lookup score by status (active=78, trial=72, past_due=30, suspended=10, else 55) — new hospitals are not penalised for not having activity history yet. Score < 40 triggers an automated check-in email (see churn_remediation_actions).',
    'A hospital with zero product usage but an active subscription can still score 30-50 purely from the payment-status and tenure components — the score reflects payment risk as much as engagement risk.'
  )
ON CONFLICT (metric_key) DO NOTHING;
