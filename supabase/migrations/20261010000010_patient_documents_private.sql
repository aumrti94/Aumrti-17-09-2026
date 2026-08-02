-- ══════════════════════════════════════════════════════════════════════════
-- patient-documents: close public PHI exposure + add tenant isolation
--
-- The bucket was created public=true (20260328142543 line 50) and
-- PatientDocuments.tsx persisted getPublicUrl(...) into patient_documents
-- .file_url, so prescriptions, discharge summaries, insurance cards and ID
-- proofs were fetchable by anyone holding the URL, unauthenticated.
--
-- Its storage RLS was also unscoped: the original SELECT/INSERT policies
-- checked only `bucket_id`, so any authenticated user of any hospital could
-- read and write every hospital's documents. The 20260613140000 hardening
-- pass covered insurance-documents / hospital-assets / grn-invoices / dicom
-- but skipped this bucket; only the DELETE policy (20261008000127) is scoped.
--
-- Idempotent — safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Part A: flip the bucket ────────────────────────────────────────────────
-- Deliberately an UPDATE. `INSERT ... ON CONFLICT (id) DO NOTHING` is a no-op
-- on any environment where the bucket already exists — that is exactly how
-- grn-invoices stayed public despite 20260613140000 lines 26-28 "fixing" it.

UPDATE storage.buckets SET public = false WHERE id = 'patient-documents';

-- ── Part B: hospital-isolated storage RLS ──────────────────────────────────
-- Convention (matches 20260613140000): upload path starts with ${hospitalId}/
-- PatientDocuments.tsx writes `${hospital_id}/${patient_id}/${ts}_${name}`.

DROP POLICY IF EXISTS "Authenticated users can upload patient documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view patient documents"   ON storage.objects;

DROP POLICY IF EXISTS "patient_documents_select" ON storage.objects;
CREATE POLICY "patient_documents_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1] = public.get_user_hospital_id()::text
  );

DROP POLICY IF EXISTS "patient_documents_insert" ON storage.objects;
CREATE POLICY "patient_documents_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1] = public.get_user_hospital_id()::text
  );

DROP POLICY IF EXISTS "patient_documents_update" ON storage.objects;
CREATE POLICY "patient_documents_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'patient-documents'
    AND (storage.foldername(name))[1] = public.get_user_hospital_id()::text
  );

-- DELETE is already covered by the scoped policy added in 20261008000127
-- ("Users delete patient-documents storage for their hospital") — left as-is.

-- ── Part C: backfill file_url from public URL to storage path ──────────────
-- Existing rows hold e.g.
--   https://<ref>.supabase.co/storage/v1/object/public/patient-documents/<hid>/<pid>/<file>
-- and need to become
--   <hid>/<pid>/<file>
-- so the client can sign them. Values stay percent-encoded exactly as
-- getPublicUrl produced them; resolveStorageUrl() decodes before signing.
--
-- No-op on an empty table and on rows already stored as paths.

UPDATE public.patient_documents
SET file_url = substring(
      file_url FROM position('/patient-documents/' IN file_url)
                    + length('/patient-documents/')
    )
WHERE file_url LIKE '%/patient-documents/%';
