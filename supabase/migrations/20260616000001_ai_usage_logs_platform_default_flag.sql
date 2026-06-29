-- Tracks whether an AI call was served by Aumrti's platform-default key
-- (hospital had no provider configured) vs the hospital's own configured key.
-- Lets Aumrti later decide whether to bill, cap, or keep platform-default usage free
-- without re-instrumenting ai-proxy.
ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS used_platform_default boolean NOT NULL DEFAULT false;
