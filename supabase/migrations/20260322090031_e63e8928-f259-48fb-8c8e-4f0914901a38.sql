ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS subdomain text UNIQUE;

-- Allow reading hospital branding info for login page (public/anonymous access)
CREATE POLICY "Anyone can read hospital branding" ON public.hospitals
  FOR SELECT TO anon
  USING (is_active = true);
