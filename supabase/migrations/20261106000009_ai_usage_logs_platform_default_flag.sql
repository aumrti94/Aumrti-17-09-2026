-- Tracks whether an AI call was served by Aumrti's platform-default key
-- (hospital had no provider configured) vs the hospital's own configured key.
-- Lets Aumrti later decide whether to bill, cap, or keep platform-default usage free
-- without re-instrumenting ai-proxy.
--
-- ── Ordering fix (2026-09-12, same class as KNOWN-BUG-118) ──────────────────
-- Originally timestamped 20260616000001 — before `ai_usage_logs` existed
-- (created later in 20260910000002_ai_usage_logs.sql). Unguarded, so it hard-
-- failed `supabase db reset` with `relation "public.ai_usage_logs" does not
-- exist`. Renamed via `git mv` to sort after its dependency; content unchanged.
ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS used_platform_default boolean NOT NULL DEFAULT false;
