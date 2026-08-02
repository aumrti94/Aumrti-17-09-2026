-- Translation pricing table.
--
-- NOTE: renumbered from 20261007000000 → 20261009000179 to resolve a duplicate
-- migration version. Two files shared 20261007000000
-- (appointments_active_slot_unique + translate_pricing); the second to apply
-- collided on schema_migrations_pkey and aborted the push. This is the same
-- file, re-versioned to the next free slot and made fully idempotent so it
-- applies cleanly regardless of any prior partial state.
--
-- Translation (Indian language → English) is priced per 1 000 characters,
-- which is fundamentally different from LLM pricing (per token) and ASR
-- pricing (per audio minute). A dedicated table keeps the pricing model
-- clean and editable from /platform.
--
-- Bhashini (MeitY) is government-subsidised and currently free. Sarvam's
-- mayura:v1 model is approximately ₹0.10 per 1 000 characters.

CREATE TABLE IF NOT EXISTS translate_pricing (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL UNIQUE,                    -- 'sarvam' | 'bhashini'
  cost_per_1000_chars_inr NUMERIC(8,4) NOT NULL DEFAULT 0.10,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO translate_pricing (provider, cost_per_1000_chars_inr) VALUES
  ('sarvam',   0.10),
  ('bhashini', 0.00)
ON CONFLICT (provider) DO NOTHING;

-- RLS: service_role only (platform admin operations).
ALTER TABLE translate_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages translate pricing" ON translate_pricing;
CREATE POLICY "Service role manages translate pricing"
  ON translate_pricing FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
    OR auth.role() = 'service_role'
  );

-- Trigger to auto-update updated_at on changes.
CREATE OR REPLACE FUNCTION update_translate_pricing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_translate_pricing_updated_at ON translate_pricing;
CREATE TRIGGER trg_translate_pricing_updated_at
  BEFORE UPDATE ON translate_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_translate_pricing_updated_at();
