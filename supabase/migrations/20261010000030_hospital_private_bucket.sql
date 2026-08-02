-- ══════════════════════════════════════════════════════════════════════════
-- hospital-private: private bucket for staff PII and finance attachments
--
-- Staff ID proofs, PAN cards, education/experience certificates, credential
-- documents and expense receipts were all being written to `hospital-assets`,
-- which is public=true by design (branding logos must render in <img> tags and
-- print views without auth). That put personal documents behind nothing but an
-- unguessable URL.
--
-- Those three writers were ALSO blocked by hospital-assets' own INSERT policy,
-- because their paths don't start with ${hospitalId} — see the FIXME at
-- 20260613140000 lines 86-92 (which flagged two of the three; StaffDocumentsTab
-- was added later and went unnoticed). ExpensesTab swallowed the resulting
-- error and saved expenses with receipt_url = null.
--
-- This creates a private sibling bucket with the standard hospital-scoped
-- policies. hospital-assets stays public and keeps serving branding only.
--
-- NOTE: objects already written to hospital-assets are NOT moved — Postgres
-- can't copy bytes between buckets. Legacy rows keep their public URL and stay
-- readable (resolveStorageUrl passes non-matching URLs through), which means
-- previously uploaded staff PII remains publicly reachable until a one-time
-- copy script is run. Tracked separately.
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('hospital-private', 'hospital-private', false)
ON CONFLICT (id) DO NOTHING;

-- Belt and braces: if the bucket somehow already existed as public, fix it.
-- (This is the failure mode that left grn-invoices public for months.)
UPDATE storage.buckets SET public = false WHERE id = 'hospital-private';

-- ── Hospital-isolated RLS ──────────────────────────────────────────────────
-- Convention (matches 20260613140000): path always starts with ${hospitalId}/
--   ${hospitalId}/staff-documents/${userId}/${ts}_${name}
--   ${hospitalId}/credentials/${staffUserId}/${name}
--   ${hospitalId}/expense-receipts/${date}/${ts}-${name}

DROP POLICY IF EXISTS "hospital_private_select" ON storage.objects;
CREATE POLICY "hospital_private_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'hospital-private'
    AND (storage.foldername(name))[1] = public.get_user_hospital_id()::text
  );

DROP POLICY IF EXISTS "hospital_private_insert" ON storage.objects;
CREATE POLICY "hospital_private_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hospital-private'
    AND (storage.foldername(name))[1] = public.get_user_hospital_id()::text
  );

DROP POLICY IF EXISTS "hospital_private_update" ON storage.objects;
CREATE POLICY "hospital_private_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'hospital-private'
    AND (storage.foldername(name))[1] = public.get_user_hospital_id()::text
  );

DROP POLICY IF EXISTS "hospital_private_delete" ON storage.objects;
CREATE POLICY "hospital_private_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'hospital-private'
    AND (storage.foldername(name))[1] = public.get_user_hospital_id()::text
  );
