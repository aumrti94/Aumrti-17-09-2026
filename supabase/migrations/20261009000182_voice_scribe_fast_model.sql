-- Point voice-scribe structuring at a FAST model, and give the audio-rescue tier its own row.
--
-- Doctors reported the "AI structuring your notes…" spinner wasting consultation time. The
-- single largest block is the LLM call itself: ~1200 output tokens on claude-sonnet-4-6 is
-- 10-20 s of generation. Structuring a transcript into a known set of fields is an
-- EXTRACTION task, not a reasoning task, so a fast model is well matched to it.
--
-- A second, quieter cost: no `voice_scribe` row ever existed, so resolveAiConfig's
-- feature-specific lookup missed on every single call and always paid for the extra
-- `global_default` lookup behind it. Seeding the row removes that miss as well.
--
-- The rescue tier needs the opposite thing: it re-listens to AUDIO, which most models in
-- this stack cannot accept at all (Claude has no audio input; OpenAI takes wav/mp3 while the
-- browser records webm). It is pinned to Gemini, the one provider here that accepts inline
-- webm — see callAiAudio in _shared/ai-config.ts.
--
-- Both rows are ordinary platform config, editable at /platform → AI Config. If extraction
-- quality regresses on real Telugu/Hindi dictations, rollback is a model-name edit, not a
-- code change.

-- Structuring: fast extraction model.
INSERT INTO public.platform_ai_provider_config
  (feature_key, provider, model_name, temperature, max_tokens, is_active)
VALUES
  ('voice_scribe', 'claude', 'claude-haiku-4-5-20251001', 0.2, 1200, true)
ON CONFLICT (feature_key) DO NOTHING;

-- Audio rescue: must be multimodal and accept webm.
INSERT INTO public.platform_ai_provider_config
  (feature_key, provider, model_name, temperature, max_tokens, is_active)
VALUES
  ('voice_scribe_rescue', 'gemini', 'gemini-2.0-flash', 0.1, 800, true)
ON CONFLICT (feature_key) DO NOTHING;
