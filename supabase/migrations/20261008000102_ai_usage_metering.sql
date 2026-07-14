-- ============================================================
-- AI usage-based billing — metering plumbing (Sprint 1, "starts")
-- ============================================================
-- This does NOT charge anything yet — actual overage pricing is a business
-- decision that needs Kavitha's sign-off (see her hard rule: every pricing
-- decision must be validated against unit economics at 50/200/500-bed scale
-- before it's a default plan feature). This migration adds the schema hook
-- a future billing decision would use, and the tenant-facing usage card
-- (SettingsPlanPage) reads it for observability only.
--
-- ai_included_budget_usd is left NULL for every existing plan deliberately —
-- NULL means "not yet metered" everywhere this is read, never "$0 included".
-- ============================================================

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS ai_included_budget_usd numeric(10, 2);

COMMENT ON COLUMN public.subscription_plans.ai_included_budget_usd IS
  'Monthly AI-cost budget (USD) included in this plan before overage billing would apply. NULL = AI usage is not metered for this plan (current default for every plan — a real value here is a pricing decision, not an engineering default).';
