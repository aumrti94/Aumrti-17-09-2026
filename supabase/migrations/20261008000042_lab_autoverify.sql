-- Phase 12 of Lab/Pathology/LIMS AI features: auto-verification (auto-release) engine.
--
-- Design note: this is a DETERMINISTIC RULE ENGINE, not an LLM call. Accredited-lab
-- autoverification (CLSI AUTO10-A) must be explainable and reproducible for audit —
-- an LLM deciding whether to release a patient result is not defensible. The "AI/
-- intelligent automation" value here is replacing a manual per-order button-click with
-- rule-based straight-through release for the subset of results that are unambiguously
-- safe to auto-release; genuinely AI/LLM-driven features (anomaly detection, sample
-- mix-up detection, differential interpretation) are separate, already-existing or
-- upcoming pieces that assist a human rather than release a result unattended.
--
-- Strictly opt-in and additive: autoverify_eligible defaults to false on every existing
-- test, so no hospital's behavior changes unless a supervisor explicitly enables it per
-- test in Settings → Lab Tests.

ALTER TABLE public.lab_test_master ADD COLUMN IF NOT EXISTS autoverify_eligible boolean NOT NULL DEFAULT false;

ALTER TABLE public.lab_order_items ADD COLUMN IF NOT EXISTS verification_method text NOT NULL DEFAULT 'manual';
ALTER TABLE public.lab_order_items ADD COLUMN IF NOT EXISTS autoverify_reason text;
ALTER TABLE public.lab_order_items ADD COLUMN IF NOT EXISTS autoverified_at timestamptz;

ALTER TABLE public.lab_order_items DROP CONSTRAINT IF EXISTS lab_order_items_verification_method_check;
ALTER TABLE public.lab_order_items
  ADD CONSTRAINT lab_order_items_verification_method_check
  CHECK (verification_method IN ('manual', 'auto'));
