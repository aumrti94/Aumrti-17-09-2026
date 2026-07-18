-- ============================================================
-- Plan-level TAB / ACTION defaults
-- ------------------------------------------------------------
-- plan_features already answers "is this MODULE on for this plan?" (is_enabled).
-- These two columns add the finer "within an enabled module, which TABS/BUTTONS
-- does this plan include by default?" — the plan-level twin of the per-hospital
-- hospital_module_entitlements (migration 131).
--
-- Semantics (same convention as the hospital layer):
--   • Absence of a key = ALLOWED (default open).
--   • Explicit `false` = withheld by default for hospitals on this plan.
-- A hospital can override either way via hospital_module_entitlements; the
-- effective value is resolved in HospitalContext as: hospitalExplicit ?? planDefault ?? allowed.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.plan_features
  ADD COLUMN IF NOT EXISTS tabs    jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.plan_features
  ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '{}'::jsonb;
