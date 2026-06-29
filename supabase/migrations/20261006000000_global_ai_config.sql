-- ─────────────────────────────────────────────────────────────────────────────
-- Global (platform-controlled) AI configuration
-- ─────────────────────────────────────────────────────────────────────────────
-- AI provider/model/key configuration moves from per-hospital
-- (ai_provider_config + api_configurations, scoped by hospital_id) to a single
-- GLOBAL configuration controlled from /platform and applied to every hospital.
--
-- These two tables already exist in the live (Lovable-managed) database; this
-- migration makes them reproducible from source and — critically — locks down
-- their RLS so the secret API keys in platform_ai_keys are never readable by
-- ordinary hospital users. Idempotent so it is safe to run against the live DB.
--
-- Edge functions read these tables with the service-role key and bypass RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── platform_ai_provider_config (non-secret: provider / model / temperature) ──
CREATE TABLE IF NOT EXISTS public.platform_ai_provider_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key   text NOT NULL,
  provider      text NOT NULL DEFAULT 'claude',
  model_name    text NOT NULL,
  api_key_ref   text,
  temperature   numeric DEFAULT 0.3,
  max_tokens    integer,
  is_active     boolean DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);

-- One row per feature_key globally (feature-specific override or 'global_default')
CREATE UNIQUE INDEX IF NOT EXISTS platform_ai_provider_config_feature_key_idx
  ON public.platform_ai_provider_config (feature_key);

-- ── platform_ai_keys (SECRET: holds third-party API keys) ─────────────────────
CREATE TABLE IF NOT EXISTS public.platform_ai_keys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key    text NOT NULL,
  service_name   text,
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active      boolean DEFAULT true,
  last_tested_at timestamptz,
  test_status    text,
  test_message   text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid
);

-- One row per service globally (anthropic, openai, gemini, sarvam, voice_asr_engine, ...)
CREATE UNIQUE INDEX IF NOT EXISTS platform_ai_keys_service_key_idx
  ON public.platform_ai_keys (service_key);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.platform_ai_provider_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ai_keys            ENABLE ROW LEVEL SECURITY;

-- platform_ai_provider_config: every authenticated user may READ (the client needs
-- provider/model to route an AI call) — it contains no secrets. Only Aumrti
-- platform admins may write.
DROP POLICY IF EXISTS "platform_ai_provider_config_read"   ON public.platform_ai_provider_config;
DROP POLICY IF EXISTS "platform_ai_provider_config_insert" ON public.platform_ai_provider_config;
DROP POLICY IF EXISTS "platform_ai_provider_config_update" ON public.platform_ai_provider_config;
DROP POLICY IF EXISTS "platform_ai_provider_config_delete" ON public.platform_ai_provider_config;

CREATE POLICY "platform_ai_provider_config_read"
  ON public.platform_ai_provider_config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "platform_ai_provider_config_insert"
  ON public.platform_ai_provider_config FOR INSERT TO authenticated
  WITH CHECK (public.is_aumrti_admin());

CREATE POLICY "platform_ai_provider_config_update"
  ON public.platform_ai_provider_config FOR UPDATE TO authenticated
  USING (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

CREATE POLICY "platform_ai_provider_config_delete"
  ON public.platform_ai_provider_config FOR DELETE TO authenticated
  USING (public.is_aumrti_admin());

-- platform_ai_keys: holds secret API keys → Aumrti platform admins ONLY for every
-- operation. Hospital users (and anon) get nothing. Edge functions use the
-- service-role key, which bypasses RLS.
DROP POLICY IF EXISTS "platform_ai_keys_admin_all" ON public.platform_ai_keys;
DROP POLICY IF EXISTS "platform_ai_keys_read_voice_engine" ON public.platform_ai_keys;

CREATE POLICY "platform_ai_keys_admin_all"
  ON public.platform_ai_keys FOR ALL TO authenticated
  USING (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

-- Narrow exception: the voice ASR engine PREFERENCE row holds no secret (just
-- {engine: 'sarvam'|'bhashini'|'web_speech'}) and the client needs it to pick the
-- right speech-to-text engine. Expose ONLY that row to authenticated users; every
-- secret API-key row stays admin-only via the policy above.
CREATE POLICY "platform_ai_keys_read_voice_engine"
  ON public.platform_ai_keys FOR SELECT TO authenticated
  USING (service_key = 'voice_asr_engine');

-- Table privileges (RLS still applies on top of these)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_ai_provider_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_ai_keys            TO authenticated;

-- ── Seed the global default from an existing hospital config (one-time) ───────
-- Copies the most recently updated per-hospital global_default into the new
-- global table so AI keeps working immediately after cut-over. No-op if a global
-- row already exists or if no per-hospital config exists.
INSERT INTO public.platform_ai_provider_config (feature_key, provider, model_name, api_key_ref, temperature, max_tokens, is_active)
SELECT 'global_default', provider, model_name, api_key_ref, temperature, max_tokens, true
FROM public.ai_provider_config
WHERE feature_key = 'global_default' AND is_active = true
LIMIT 1
ON CONFLICT (feature_key) DO NOTHING;
