-- ────────────────────────────────────────────────────────────────────────────
-- Restore the AI INR-metering + budget schema (the never-committed "…167").
--
-- The application already DEPENDS on all of this but no migration ever defined
-- it, so it was silently broken:
--   • ai_usage_logs.estimated_cost_inr  — written by every metering caller
--     (ai-config.ts, asr-metering.ts, translate-text.ts) → INSERT failed silently
--     (fire-and-forget catch), so INR usage was never recorded.
--   • ai_cost_daily.total_cost_inr      — read by AIPerformancePage (the /platform
--     "AI Costs" page) → the page errored / showed nothing.
--   • upsert_ai_cost_daily(… p_cost_inr) — the metering callers pass a 10th arg
--     the deployed 9-arg function does not accept → the rollup upsert threw.
--   • subscription_plans.ai_included_budget_inr — read by aiBudget.ts / Plans
--     Manager / Settings → Plan; written by the Edit-Plan drawer.
--   • hospital_ai_budget_status (view)  — read by SettingsPlanPage, AIPerformancePage
--     and HospitalDetailPage → all three queried a non-existent view.
--
-- SAFETY INVARIANT: safety-class AI (drug interaction/ADR, deterioration early
-- warning, critical incidental findings) is reported but NEVER counted against
-- the budget. The safety list here is mirrored from src/lib/aiFeatures.ts
-- (SAFETY_AI_FEATURE_KEYS) — change both together.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. INR columns on the metering tables ──────────────────────────────────
ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS estimated_cost_inr numeric(14, 4) NOT NULL DEFAULT 0;

ALTER TABLE public.ai_cost_daily
  ADD COLUMN IF NOT EXISTS total_cost_inr numeric(14, 4) NOT NULL DEFAULT 0;

-- ── 2. Included AI budget on plans (NULL = not metered, never "zero allowed") ─
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS ai_included_budget_inr numeric(14, 2);

-- ── 3. Rollup RPC: add p_cost_inr and accumulate total_cost_inr ─────────────
-- p_cost_inr is optional (DEFAULT 0) so the older 9-arg callers (ai-proxy) keep
-- resolving to this single function; the newer callers pass all 10. Drop the old
-- 9-arg signature first so there is exactly one function and no overload ambiguity.
DROP FUNCTION IF EXISTS public.upsert_ai_cost_daily(
  uuid, date, text, text, integer, integer, integer, boolean, numeric);

CREATE OR REPLACE FUNCTION public.upsert_ai_cost_daily(
  p_hospital_id       uuid,
  p_date              date,
  p_feature_key       text,
  p_provider          text,
  p_tokens_input      integer,
  p_tokens_output     integer,
  p_cache_read_tokens integer,
  p_cache_hit         boolean,
  p_cost_usd          numeric,
  p_cost_inr          numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ai_cost_daily (
    hospital_id, date, feature_key, provider,
    total_calls, total_tokens_input, total_tokens_output,
    total_cache_reads, cache_hit_count, total_cost_usd, total_cost_inr
  )
  VALUES (
    p_hospital_id, p_date, p_feature_key, p_provider,
    1, p_tokens_input, p_tokens_output,
    p_cache_read_tokens, CASE WHEN p_cache_hit THEN 1 ELSE 0 END,
    p_cost_usd, COALESCE(p_cost_inr, 0)
  )
  ON CONFLICT (hospital_id, date, feature_key, provider) DO UPDATE SET
    total_calls         = ai_cost_daily.total_calls + 1,
    total_tokens_input  = ai_cost_daily.total_tokens_input + EXCLUDED.total_tokens_input,
    total_tokens_output = ai_cost_daily.total_tokens_output + EXCLUDED.total_tokens_output,
    total_cache_reads   = ai_cost_daily.total_cache_reads + EXCLUDED.total_cache_reads,
    cache_hit_count     = ai_cost_daily.cache_hit_count + EXCLUDED.cache_hit_count,
    total_cost_usd      = ai_cost_daily.total_cost_usd + EXCLUDED.total_cost_usd,
    total_cost_inr      = ai_cost_daily.total_cost_inr + EXCLUDED.total_cost_inr;
END;
$$;

-- ── 4. hospital_ai_budget_status view ──────────────────────────────────────
-- Month-to-date AI spend per hospital vs the plan's included budget, split into
-- metered (counts against the cap) and safety (reported, never counted).
--
-- Access control is enforced IN THE VIEW: a plain view runs with the owner's
-- rights and bypasses the base tables' RLS, and ai_cost_daily has no platform
-- admin read policy — so the WHERE clause scopes rows to the caller's own
-- hospital, or all rows for an Aumrti admin. The column set is the union of what
-- SettingsPlanPage, AIPerformancePage and HospitalDetailPage already select.
--
-- DROP first, not CREATE OR REPLACE: an earlier out-of-band version of this view
-- exists live with a USD column (budget_usd), and Postgres refuses to rename a
-- view column via REPLACE. Dropping it is safe — the app reads it directly and
-- selects the INR columns this definition provides.
DROP VIEW IF EXISTS public.hospital_ai_budget_status;
CREATE VIEW public.hospital_ai_budget_status AS
WITH mtd AS (
  SELECT
    d.hospital_id,
    COALESCE(SUM(d.total_cost_inr) FILTER (
      WHERE d.feature_key <> ALL (ARRAY[
        'drug_interaction_analysis','adr_detector',
        'sepsis_early_warning','critical_incidental_finder'])), 0) AS metered_cost_inr,
    COALESCE(SUM(d.total_cost_inr) FILTER (
      WHERE d.feature_key = ANY (ARRAY[
        'drug_interaction_analysis','adr_detector',
        'sepsis_early_warning','critical_incidental_finder'])), 0) AS safety_cost_inr,
    COALESCE(SUM(d.total_calls), 0) AS total_calls
  FROM public.ai_cost_daily d
  WHERE d.date >= date_trunc('month', current_date)::date
  GROUP BY d.hospital_id
)
SELECT
  h.id                          AS hospital_id,
  h.name                        AS hospital_name,
  p.slug                        AS plan_slug,
  p.ai_included_budget_inr      AS budget_inr,
  COALESCE(m.metered_cost_inr, 0) AS metered_cost_inr,
  COALESCE(m.safety_cost_inr, 0)  AS safety_cost_inr,
  COALESCE(m.total_calls, 0)      AS total_calls,
  CASE WHEN p.ai_included_budget_inr > 0
       THEN round((COALESCE(m.metered_cost_inr, 0) / p.ai_included_budget_inr) * 100, 4)
       ELSE NULL END            AS pct_used,
  (p.ai_included_budget_inr > 0
     AND COALESCE(m.metered_cost_inr, 0) > p.ai_included_budget_inr) AS over_budget,
  CASE WHEN p.ai_included_budget_inr > 0
       THEN GREATEST(COALESCE(m.metered_cost_inr, 0) - p.ai_included_budget_inr, 0)
       ELSE 0 END              AS overage_inr
FROM public.hospitals h
LEFT JOIN public.hospital_subscriptions hs ON hs.hospital_id = h.id
LEFT JOIN public.subscription_plans p      ON p.id = hs.plan_id
LEFT JOIN mtd m                            ON m.hospital_id = h.id
WHERE h.id = public.get_user_hospital_id() OR public.is_aumrti_admin();

REVOKE ALL ON public.hospital_ai_budget_status FROM anon;
GRANT SELECT ON public.hospital_ai_budget_status TO authenticated;
