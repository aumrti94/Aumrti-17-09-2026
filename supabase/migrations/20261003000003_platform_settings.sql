-- Platform-level singleton settings (NOT hospital-scoped).
--
-- Holds the signup phone-verification master toggle and the platform WhatsApp (Meta Cloud
-- API) credentials used by the send-signup-otp edge function. There is exactly one row
-- (id = true). Only active Aumrti admins may read/write it via the app; the service-role
-- edge functions read it bypassing RLS. The unauthenticated /register page learns ONLY the
-- on/off toggle via the get_signup_otp_enabled() SECURITY DEFINER RPC — it can never read
-- meta_access_token.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),   -- singleton row guard
  signup_otp_enabled     boolean NOT NULL DEFAULT false,
  whatsapp_provider      text NOT NULL DEFAULT 'meta_cloud',
  meta_phone_number_id   text,
  meta_access_token      text,                                          -- admin/service-role only
  meta_otp_template      text,
  meta_otp_template_lang text DEFAULT 'en',
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid
);

INSERT INTO public.platform_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Only active Aumrti admins may read/write (mirrors the aumrti_admins guard). Service role
-- (edge functions) bypasses RLS.
DROP POLICY IF EXISTS "platform_settings_admin_all" ON public.platform_settings;
CREATE POLICY "platform_settings_admin_all" ON public.platform_settings
  USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

-- Public, safe read of just the toggle for the unauthenticated /register page.
CREATE OR REPLACE FUNCTION public.get_signup_otp_enabled()
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
  AS $$ SELECT COALESCE((SELECT signup_otp_enabled FROM public.platform_settings LIMIT 1), false) $$;

GRANT EXECUTE ON FUNCTION public.get_signup_otp_enabled() TO anon, authenticated;
