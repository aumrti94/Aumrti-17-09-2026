-- ASR (speech-to-text) pricing table.
--
-- supabase/functions/_shared/asr-metering.ts has always read `asr_pricing` for
-- `cost_per_minute_inr` and `assumed_bitrate_kbps`, but NO migration ever created the
-- table. Every Sarvam/Bhashini transcription therefore metered at ₹0: the row landed in
-- ai_usage_logs, the wallet debit computed zero, and a dictated encounter only ever
-- counted its LLM half. That gap matters more now that the voice-scribe pipeline has
-- been reworked to move translation into the ASR call — without real rates there is no
-- baseline to measure the change against.
--
-- ASR is billed per AUDIO MINUTE, which is a third pricing model alongside LLM tokens
-- (COST_PER_1K in _shared/ai-config.ts) and translation characters (translate_pricing).
-- A dedicated table keeps each model clean and editable from /platform.
--
-- `assumed_bitrate_kbps` exists because none of the ASR providers return an audio
-- duration, so asr-metering.ts infers seconds from the payload byte length. The browser
-- records webm/opus, which is typically ~24 kbps at speech settings.
--
-- Bhashini (MeitY) is government-subsidised and currently free. Sarvam's speech-to-text
-- is approximately ₹0.30 per audio minute — confirm against the current Sarvam price
-- list and update from /platform rather than editing this file.

CREATE TABLE IF NOT EXISTS asr_pricing (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             TEXT NOT NULL UNIQUE,              -- 'sarvam' | 'bhashini'
  cost_per_minute_inr  NUMERIC(8,4) NOT NULL DEFAULT 0.00,
  assumed_bitrate_kbps INTEGER NOT NULL DEFAULT 24,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO asr_pricing (provider, cost_per_minute_inr, assumed_bitrate_kbps) VALUES
  ('sarvam',   0.30, 24),
  ('bhashini', 0.00, 24)
ON CONFLICT (provider) DO NOTHING;

-- RLS: service_role only (platform admin operations), matching translate_pricing.
ALTER TABLE asr_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages ASR pricing" ON asr_pricing;
CREATE POLICY "Service role manages ASR pricing"
  ON asr_pricing FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
    OR auth.role() = 'service_role'
  );

-- Trigger to auto-update updated_at on changes.
CREATE OR REPLACE FUNCTION update_asr_pricing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asr_pricing_updated_at ON asr_pricing;
CREATE TRIGGER trg_asr_pricing_updated_at
  BEFORE UPDATE ON asr_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_asr_pricing_updated_at();
