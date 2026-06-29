CREATE TABLE IF NOT EXISTS public.service_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  item_code text NOT NULL,
  item_name text NOT NULL,
  item_type text NOT NULL,
  default_rate numeric(12,2) NOT NULL DEFAULT 0,
  gst_rate numeric(5,2) DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_rates_hospital_code_unique UNIQUE (hospital_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_service_rates_hospital_active
  ON public.service_rates(hospital_id, is_active);
CREATE INDEX IF NOT EXISTS idx_service_rates_lookup
  ON public.service_rates(hospital_id, item_code) WHERE is_active = true;

ALTER TABLE public.service_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hospital members manage their service rates" ON public.service_rates;
CREATE POLICY "Hospital members manage their service rates"
ON public.service_rates
FOR ALL
TO authenticated
USING (hospital_id = public.get_user_hospital_id())
WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_service_rates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS service_rates_touch_updated_at ON public.service_rates;
CREATE TRIGGER service_rates_touch_updated_at
  BEFORE UPDATE ON public.service_rates
  FOR EACH ROW EXECUTE FUNCTION public.touch_service_rates_updated_at();