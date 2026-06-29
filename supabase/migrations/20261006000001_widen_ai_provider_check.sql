-- Allow 'openrouter' (and 'azure_openai' on the legacy table) as a valid AI
-- provider. The original CHECK constraints predate these providers and rejected
-- them with: new row violates check constraint "..._provider_check".
-- Idempotent: drop-if-exists then recreate with the full allowed set.

ALTER TABLE public.platform_ai_provider_config
  DROP CONSTRAINT IF EXISTS platform_ai_provider_config_provider_check;
ALTER TABLE public.platform_ai_provider_config
  ADD CONSTRAINT platform_ai_provider_config_provider_check
  CHECK (provider IN ('claude','openai','azure_openai','gemini','perplexity','openrouter','ollama'));

ALTER TABLE public.ai_provider_config
  DROP CONSTRAINT IF EXISTS ai_provider_config_provider_check;
ALTER TABLE public.ai_provider_config
  ADD CONSTRAINT ai_provider_config_provider_check
  CHECK (provider IN ('claude','openai','azure_openai','gemini','perplexity','openrouter','ollama'));
