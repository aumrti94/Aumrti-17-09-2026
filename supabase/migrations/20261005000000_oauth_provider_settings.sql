-- Platform-level OAuth (social login) provider credentials — NOT hospital-scoped.
--
-- One row per provider (google | azure | facebook). The super-admin enters the
-- client id + secret in Platform → Settings → Social Login; the update-oauth-providers
-- edge function then pushes them to the Supabase project's GoTrue auth config via the
-- Management API (Supabase's built-in OAuth reads keys from project config, not from
-- this table — this table is the source of truth the edge function syncs FROM).
--
-- Only active Aumrti admins may read/write via the app; service-role edge functions
-- read it bypassing RLS. The unauthenticated /login page learns ONLY which providers
-- are enabled (never the secrets) via get_enabled_oauth_providers().

CREATE TABLE IF NOT EXISTS public.oauth_provider_settings (
  provider      text PRIMARY KEY CHECK (provider IN ('google', 'azure', 'facebook')),
  enabled       boolean NOT NULL DEFAULT false,
  client_id     text,
  client_secret text,                       -- admin/service-role only — never returned to the browser
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);

-- Seed the three supported providers (idempotent).
INSERT INTO public.oauth_provider_settings (provider) VALUES
  ('google'), ('azure'), ('facebook')
ON CONFLICT (provider) DO NOTHING;

ALTER TABLE public.oauth_provider_settings ENABLE ROW LEVEL SECURITY;

-- Only active Aumrti admins may read/write (mirrors the platform_settings guard).
DROP POLICY IF EXISTS "oauth_provider_settings_admin_all" ON public.oauth_provider_settings;
CREATE POLICY "oauth_provider_settings_admin_all" ON public.oauth_provider_settings
  USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

-- Public, safe read of just {provider, enabled} for the unauthenticated /login page so it
-- can decide which social buttons to render. Never exposes client_id / client_secret.
CREATE OR REPLACE FUNCTION public.get_enabled_oauth_providers()
  RETURNS TABLE (provider text, enabled boolean)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
  AS $$ SELECT provider, enabled FROM public.oauth_provider_settings $$;

GRANT EXECUTE ON FUNCTION public.get_enabled_oauth_providers() TO anon, authenticated;
