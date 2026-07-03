-- Phase 4 of nursing module completion plan: wound photo upload.
-- wound_assessments.wound_photo_url has existed since 20260910000008 with no upload UI anywhere
-- referencing it — this bucket + RLS makes it functional. Private (clinical images), matching
-- the insurance-documents/grn-invoices/dicom precedent (Ananya: no PHI-bearing image bucket in
-- this codebase is public). Path convention: ${hospitalId}/${admissionId}/${ts}_${filename}.

INSERT INTO storage.buckets (id, name, public)
VALUES ('wound-photos', 'wound-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "wound_photos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'wound-photos'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "wound_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'wound-photos'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "wound_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'wound-photos'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "wound_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'wound-photos'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );
