ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS social_linkedin text,
  ADD COLUMN IF NOT EXISTS social_facebook text,
  ADD COLUMN IF NOT EXISTS social_instagram text,
  ADD COLUMN IF NOT EXISTS social_x text,
  ADD COLUMN IF NOT EXISTS demo_button_url text,
  ADD COLUMN IF NOT EXISTS demo_button_enabled boolean DEFAULT true;

-- Public function to get just the public-facing settings safely
CREATE OR REPLACE FUNCTION public.get_public_platform_settings()
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
  AS $$ 
    SELECT jsonb_build_object(
      'contact_email', contact_email,
      'contact_phone', contact_phone,
      'social_linkedin', social_linkedin,
      'social_facebook', social_facebook,
      'social_instagram', social_instagram,
      'social_x', social_x,
      'demo_button_url', demo_button_url,
      'demo_button_enabled', demo_button_enabled
    )
    FROM public.platform_settings 
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO anon, authenticated;
