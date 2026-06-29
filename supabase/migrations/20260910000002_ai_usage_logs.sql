-- ── Gap 4: AI Usage Logs + Daily Cost Tracking ──────────────────────────────
-- Tracks every AI call per hospital for cost monitoring and cache hit analytics.
-- Platform admin sees cost per hospital; hospital admin sees their own usage.

-- ── ai_usage_logs: one row per AI API call ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  feature_key           text NOT NULL,
  provider              text NOT NULL,
  model_name            text NOT NULL,
  tokens_input          integer NOT NULL DEFAULT 0,
  tokens_output         integer NOT NULL DEFAULT 0,
  cache_creation_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens     integer NOT NULL DEFAULT 0,
  cache_hit             boolean NOT NULL DEFAULT false,
  estimated_cost_usd    numeric(10, 6) NOT NULL DEFAULT 0,
  latency_ms            integer,
  success               boolean NOT NULL DEFAULT true,
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_hospital_date
  ON public.ai_usage_logs (hospital_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature
  ON public.ai_usage_logs (hospital_id, feature_key, created_at DESC);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_usage_logs_select_own" ON public.ai_usage_logs;
CREATE POLICY "ai_usage_logs_select_own" ON public.ai_usage_logs
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "ai_usage_logs_insert_service" ON public.ai_usage_logs;
CREATE POLICY "ai_usage_logs_insert_service" ON public.ai_usage_logs
  FOR INSERT TO service_role
  WITH CHECK (true);


-- ── ai_cost_daily: rolled-up daily cost per hospital per feature ─────────────
CREATE TABLE IF NOT EXISTS public.ai_cost_daily (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  date                date NOT NULL,
  feature_key         text NOT NULL,
  provider            text NOT NULL,
  total_calls         integer NOT NULL DEFAULT 0,
  total_tokens_input  integer NOT NULL DEFAULT 0,
  total_tokens_output integer NOT NULL DEFAULT 0,
  total_cache_reads   integer NOT NULL DEFAULT 0,
  cache_hit_count     integer NOT NULL DEFAULT 0,
  total_cost_usd      numeric(10, 6) NOT NULL DEFAULT 0,
  UNIQUE (hospital_id, date, feature_key, provider)
);

CREATE INDEX IF NOT EXISTS idx_ai_cost_daily_hospital_date
  ON public.ai_cost_daily (hospital_id, date DESC);

ALTER TABLE public.ai_cost_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_cost_daily_select_own" ON public.ai_cost_daily;
CREATE POLICY "ai_cost_daily_select_own" ON public.ai_cost_daily
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "ai_cost_daily_upsert_service" ON public.ai_cost_daily;
CREATE POLICY "ai_cost_daily_upsert_service" ON public.ai_cost_daily
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ── Rollup function: called by the edge function after each AI call ──────────
CREATE OR REPLACE FUNCTION public.upsert_ai_cost_daily(
  p_hospital_id         uuid,
  p_date                date,
  p_feature_key         text,
  p_provider            text,
  p_tokens_input        integer,
  p_tokens_output       integer,
  p_cache_read_tokens   integer,
  p_cache_hit           boolean,
  p_cost_usd            numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.ai_cost_daily (
    hospital_id, date, feature_key, provider,
    total_calls, total_tokens_input, total_tokens_output,
    total_cache_reads, cache_hit_count, total_cost_usd
  )
  VALUES (
    p_hospital_id, p_date, p_feature_key, p_provider,
    1, p_tokens_input, p_tokens_output,
    p_cache_read_tokens, CASE WHEN p_cache_hit THEN 1 ELSE 0 END,
    p_cost_usd
  )
  ON CONFLICT (hospital_id, date, feature_key, provider) DO UPDATE SET
    total_calls         = ai_cost_daily.total_calls + 1,
    total_tokens_input  = ai_cost_daily.total_tokens_input + EXCLUDED.total_tokens_input,
    total_tokens_output = ai_cost_daily.total_tokens_output + EXCLUDED.total_tokens_output,
    total_cache_reads   = ai_cost_daily.total_cache_reads + EXCLUDED.total_cache_reads,
    cache_hit_count     = ai_cost_daily.cache_hit_count + EXCLUDED.cache_hit_count,
    total_cost_usd      = ai_cost_daily.total_cost_usd + EXCLUDED.total_cost_usd;
END;
$$;
