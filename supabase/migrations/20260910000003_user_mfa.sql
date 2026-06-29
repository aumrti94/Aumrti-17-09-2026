-- ── Gap 2: MFA Trusted Devices ───────────────────────────────────────────────
-- Supabase Auth manages TOTP factor storage natively.
-- We only store trusted device fingerprints to enable "Remember this device 30 days".

CREATE TABLE IF NOT EXISTS public.user_trusted_devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name      text,
  fingerprint_hash text NOT NULL,
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint_hash)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user
  ON public.user_trusted_devices (user_id, expires_at);

ALTER TABLE public.user_trusted_devices ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own trusted devices
DROP POLICY IF EXISTS "trusted_devices_select_own" ON public.user_trusted_devices;
CREATE POLICY "trusted_devices_select_own" ON public.user_trusted_devices
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "trusted_devices_insert_own" ON public.user_trusted_devices;
CREATE POLICY "trusted_devices_insert_own" ON public.user_trusted_devices
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "trusted_devices_delete_own" ON public.user_trusted_devices;
CREATE POLICY "trusted_devices_delete_own" ON public.user_trusted_devices
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Clean up expired devices (run via pg_cron or call manually)
CREATE OR REPLACE FUNCTION public.cleanup_expired_trusted_devices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.user_trusted_devices WHERE expires_at < now();
END;
$$;
