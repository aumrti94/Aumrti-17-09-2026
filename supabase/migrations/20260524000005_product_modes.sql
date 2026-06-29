-- ─────────────────────────────────────────────────────────────────────────────
-- Product Mode / SKU Configuration
-- One row per hospital. mode determines the default module set; enabled_modules
-- is the actual list used at runtime (admin can override defaults).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_modes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     UUID        NOT NULL UNIQUE REFERENCES public.hospitals(id) ON DELETE CASCADE,
  mode            TEXT        NOT NULL DEFAULT 'hospital',
  -- mode: 'clinic' | 'hospital' | 'diagnostic' | 'pharmacy' | 'institute'
  enabled_modules JSONB       NOT NULL DEFAULT '["opd","ipd","lab","radiology","pharmacy","billing","insurance","hr","inventory","analytics","quality","telemedicine","mrd","emergency","ot","nursing","ipc","fms","crm","assets","patients"]',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_modes ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_modes_hospital_policy
  ON public.product_modes
  FOR ALL
  TO authenticated
  USING (
    hospital_id IN (
      SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
    )
  );
