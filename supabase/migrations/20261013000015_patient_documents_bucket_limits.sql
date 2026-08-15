-- Aumrti security audit — server-side backstop for patient document uploads.
--
-- src/components/clinical/PatientHistoryUploadPanel.tsx enforces MAX_FILE_BYTES (50MB) and
-- MAX_FILES (40) client-side only (lines 38-39, 168-175). A caller that bypasses the UI and
-- calls supabase.storage.from('patient-documents').upload(...) directly is not blocked by
-- anything server-side — Supabase Storage itself accepts any size/type unless the bucket says
-- otherwise. This sets the same ceiling at the bucket level, which the Storage API enforces
-- regardless of caller. File COUNT per patient is a job/DB-level concern (patient_history_
-- ingest_jobs), not something storage.buckets can express, so it is not addressed here.

UPDATE storage.buckets
SET
  file_size_limit = 52428800, -- 50MB, matches MAX_FILE_BYTES in PatientHistoryUploadPanel.tsx
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv'
  ]
WHERE id = 'patient-documents';
