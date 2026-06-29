-- ══════════════════════════════════════════════════════════════════════════
-- Create missing storage buckets + hospital-isolated RLS
-- Buckets are global (not per-hospital); idempotent via ON CONFLICT DO NOTHING.
--
-- !! Ananya must review RLS policies before deploy !!
--
-- Known path-convention gaps flagged with FIXME comments below.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Part A: Buckets ────────────────────────────────────────────────────────

-- Private PHI bucket for insurance pre-auth / claim documents.
-- DocumentChecklist.tsx has been switched to createSignedUrl (see Part C).
INSERT INTO storage.buckets (id, name, public)
VALUES ('insurance-documents', 'insurance-documents', false)
ON CONFLICT (id) DO NOTHING;

-- hospital-assets already exists as public=true in an earlier migration.
-- Keep public so that getPublicUrl callers (branding, staff credentials,
-- expense receipts) continue to work.  The INSERT is a no-op on live envs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('hospital-assets', 'hospital-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Private bucket for goods-receipt invoice scans (GRNPanel.tsx).
INSERT INTO storage.buckets (id, name, public)
VALUES ('grn-invoices', 'grn-invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Private bucket for DICOM radiology images (DicomViewerPanel.tsx).
-- That component already uses createSignedUrl for viewing.
INSERT INTO storage.buckets (id, name, public)
VALUES ('dicom', 'dicom', false)
ON CONFLICT (id) DO NOTHING;

-- ── Part B: Hospital-isolated RLS ──────────────────────────────────────────
-- Convention: upload path always starts with ${hospitalId}/…
-- Policy check: (storage.foldername(name))[1] = get_user_hospital_id()::text
-- PostgreSQL arrays are 1-indexed; foldername splits on '/'.

-- ─── insurance-documents ──────────────────────────────────────────────────
-- Path: ${hospitalId}/${admissionId}/${docName}_${ts}.ext

CREATE POLICY "insurance_documents_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'insurance-documents'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "insurance_documents_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'insurance-documents'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "insurance_documents_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'insurance-documents'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "insurance_documents_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'insurance-documents'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

-- ─── hospital-assets ──────────────────────────────────────────────────────
-- Drop the earlier overly-permissive policies before replacing them.

DROP POLICY IF EXISTS "Authenticated users can upload hospital assets" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view hospital assets"                ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update hospital assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete hospital assets" ON storage.objects;

-- SELECT stays public: bucket is public=true, branding images must be readable
-- without auth (used in <img> tags, print views, etc.).
CREATE POLICY "hospital_assets_select" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'hospital-assets');

-- FIXME (Ananya review): Two callers do NOT put hospitalId as the first path
-- component and will be BLOCKED by the INSERT policy below until fixed:
--   • ExpensesTab.tsx   → uploads to  expense-receipts/${hospitalId}/…
--   • SettingsStaffPage → uploads to  credentials/${staffUserId}/…
-- SettingsBrandingPage path is ${hospitalId}/logo.ext and will work correctly.
-- Those two components must be updated to ${hospitalId}/expense-receipts/…
-- and ${hospitalId}/credentials/… respectively before go-live.

CREATE POLICY "hospital_assets_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hospital-assets'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "hospital_assets_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'hospital-assets'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "hospital_assets_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'hospital-assets'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

-- ─── grn-invoices ─────────────────────────────────────────────────────────
-- Path: ${hospitalId}/${grnNumber}.ext  (GRNPanel.tsx)

CREATE POLICY "grn_invoices_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'grn-invoices'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "grn_invoices_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'grn-invoices'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "grn_invoices_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'grn-invoices'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "grn_invoices_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'grn-invoices'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

-- ─── dicom ────────────────────────────────────────────────────────────────
-- Path: ${hospitalId}/${orderId}/${ts}_${filename}  (DicomViewerPanel.tsx)

CREATE POLICY "dicom_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dicom'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "dicom_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dicom'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "dicom_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dicom'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );

CREATE POLICY "dicom_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dicom'
    AND (storage.foldername(name))[1] = get_user_hospital_id()::text
  );
