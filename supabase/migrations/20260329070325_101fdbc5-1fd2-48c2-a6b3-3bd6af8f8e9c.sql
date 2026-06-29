-- Create storage bucket for migration files
INSERT INTO storage.buckets (id, name, public)
VALUES ('migration-files', 'migration-files', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: allow authenticated users to upload to migration-files
CREATE POLICY "Authenticated users can upload migration files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'migration-files');

CREATE POLICY "Authenticated users can read migration files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'migration-files');