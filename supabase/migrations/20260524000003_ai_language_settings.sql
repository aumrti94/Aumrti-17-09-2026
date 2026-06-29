-- AI Language Packs: per-hospital, per-feature language configuration
-- Enables multi-language output for Voice Scribe, Token Display, Discharge Summary, etc.

CREATE TABLE IF NOT EXISTS public.ai_language_settings (
  id           UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  UUID      NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  feature_key  TEXT      NOT NULL,   -- 'voice_scribe' | 'token_display' | 'discharge_summary' | 'opd_notes' | 'patient_portal'
  language_code TEXT     NOT NULL DEFAULT 'en',  -- ISO 639-1: 'en','hi','te','ta','ml','kn','mr','bn','gu','pa'
  enabled      BOOLEAN   NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_lang_hospital_feature UNIQUE (hospital_id, feature_key)
);

ALTER TABLE public.ai_language_settings ENABLE ROW LEVEL SECURITY;

-- Hospital staff can manage their own settings
CREATE POLICY "Hospital staff manage ai_language_settings"
  ON public.ai_language_settings FOR ALL
  TO authenticated
  USING (
    hospital_id IN (
      SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    hospital_id IN (
      SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
    )
  );

-- Public read so TV display page (unauthenticated) can fetch token_display language
CREATE POLICY "Anyone can read ai_language_settings"
  ON public.ai_language_settings FOR SELECT USING (true);

-- Index for the most common query pattern: hospital + feature_key
CREATE INDEX IF NOT EXISTS idx_ai_language_settings_hospital_feature
  ON public.ai_language_settings(hospital_id, feature_key);
