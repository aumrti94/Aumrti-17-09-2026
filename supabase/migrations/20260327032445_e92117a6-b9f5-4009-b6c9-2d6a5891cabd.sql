
ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS accent_color text DEFAULT '#0E7B7B',
  ADD COLUMN IF NOT EXISTS font_family text DEFAULT 'Inter',
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS branding_config jsonb DEFAULT '{}'::jsonb;

INSERT INTO storage.buckets (id, name, public)
VALUES ('hospital-assets', 'hospital-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload hospital assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hospital-assets');

CREATE POLICY "Anyone can view hospital assets"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'hospital-assets');

CREATE POLICY "Authenticated users can update hospital assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'hospital-assets');

CREATE POLICY "Authenticated users can delete hospital assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hospital-assets');
