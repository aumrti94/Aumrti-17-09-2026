
-- api_configurations table
CREATE TABLE public.api_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  service_name text NOT NULL,
  service_key text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  is_active boolean DEFAULT true,
  last_tested_at timestamptz,
  test_status text,
  test_message text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(hospital_id, service_key)
);

ALTER TABLE public.api_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_configurations_select" ON public.api_configurations
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "api_configurations_insert" ON public.api_configurations
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "api_configurations_update" ON public.api_configurations
  FOR UPDATE TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "api_configurations_delete" ON public.api_configurations
  FOR DELETE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

-- ai_provider_config table
CREATE TABLE public.ai_provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  feature_key text NOT NULL,
  provider text NOT NULL DEFAULT 'claude' CHECK (provider IN ('claude','openai','gemini','perplexity','ollama')),
  model_name text NOT NULL,
  api_key_ref text,
  temperature numeric(3,2) DEFAULT 0.3,
  max_tokens integer DEFAULT 1000,
  is_active boolean DEFAULT true,
  UNIQUE(hospital_id, feature_key)
);

ALTER TABLE public.ai_provider_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_provider_config_select" ON public.ai_provider_config
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "ai_provider_config_insert" ON public.ai_provider_config
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "ai_provider_config_update" ON public.ai_provider_config
  FOR UPDATE TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "ai_provider_config_delete" ON public.ai_provider_config
  FOR DELETE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

-- Seed default config for all existing hospitals
INSERT INTO public.ai_provider_config (hospital_id, feature_key, provider, model_name)
SELECT h.id, f.key, 'claude', 'claude-sonnet-4-20250514'
FROM public.hospitals h
CROSS JOIN (VALUES
  ('global_default'),
  ('voice_scribe'),
  ('radiology_impression'),
  ('ai_digest'),
  ('appeal_letter'),
  ('discharge_summary')
) AS f(key)
ON CONFLICT DO NOTHING;

-- Add provider tracking columns to ai_digests
ALTER TABLE public.ai_digests ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.ai_digests ADD COLUMN IF NOT EXISTS tokens_used integer;
