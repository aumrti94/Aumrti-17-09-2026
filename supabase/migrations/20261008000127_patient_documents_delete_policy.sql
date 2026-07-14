-- Fix: patient documents could not be deleted.
--
-- The original table (migration 20260328142543) enabled RLS but shipped ONLY
-- SELECT and INSERT policies. With RLS on and no DELETE policy, Postgres denies
-- every delete silently (0 rows affected, no error returned to PostgREST), so the
-- UI appeared to delete a document while the row survived and reappeared on reload.
--
-- This adds the missing DELETE policy on the table (scoped to the user's hospital,
-- mirroring the existing SELECT policy) plus a matching storage-object delete policy
-- so the underlying file is removed too. Idempotent — safe to re-run.

DROP POLICY IF EXISTS "Users can delete patient documents for their hospital" ON public.patient_documents;
CREATE POLICY "Users can delete patient documents for their hospital"
  ON public.patient_documents FOR DELETE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

-- Storage: allow deleting files under the caller's own hospital folder.
-- Upload path is `${hospital_id}/${patient_id}/${ts}_${name}`, so foldername[1]
-- is the hospital id.
DROP POLICY IF EXISTS "Users delete patient-documents storage for their hospital" ON storage.objects;
CREATE POLICY "Users delete patient-documents storage for their hospital"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1] = public.get_user_hospital_id()::text
  );
